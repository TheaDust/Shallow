'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

let dataDir;
let server;
let baseUrl;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-merge-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(method, url, body, cookie) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = (url, cookie) => request('GET', url, undefined, cookie);
const post = (url, body, cookie) => request('POST', url, body, cookie);
const patch = (url, body, cookie) => request('PATCH', url, body, cookie);

async function signIn(username) {
  const res = await post('/api/auth/signin', {
    identifier: username,
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

const repo = '/api/repositories/acme-demo/acme-docs';
const pullUrl = (number) => `${repo}/pulls/${number}`;
const mergeUrl = (number) => `${repo}/pulls/${number}/merge`;
const reviewUrl = (number) => `${repo}/pulls/${number}/reviews`;

async function detail(number, cookie) {
  const res = await get(pullUrl(number), cookie);
  assert.equal(res.status, 200);
  return (await res.json()).pull;
}

async function mainHead() {
  const branches = await get(`${repo}/branches`);
  assert.equal(branches.status, 200);
  const list = (await branches.json()).branches;
  const main = list.find((b) => b.name === 'main');
  assert.ok(main, 'main branch must exist');
  return main.headCommitId;
}

test('REQ-6-5 scenario 1: an eligible PR (protected main, non-author approval, test success, no conflicts) merges with “Create a merge commit” and persists', async () => {
  const alice = await signIn('alice-dev');
  const bob = await signIn('bob-reviewer');

  // GIVEN: the target `main` branch is protected (both rule requirements
  // enabled), the PR has 1 valid non-author Approve for the current compare
  // commit, `test` is success in Checks, and the diff has no conflicts.
  const rule = await post(
    `${repo}/branch-protection`,
    { branchName: 'main', requireApproval: true, requireStatusCheck: true },
    alice
  );
  assert.equal(rule.status, 201);

  const approve = await post(
    reviewUrl(1),
    { decision: 'approve' },
    bob
  );
  assert.equal(approve.status, 201);

  const check = await patch(
    `${pullUrl(1)}/checks`,
    { status: 'success' },
    alice
  );
  assert.equal(check.status, 200);

  const before = await detail(1, alice);
  assert.equal(before.status, 'open');
  assert.equal(before.mergeable, true);
  assert.deepEqual(before.blockedReasons, []);
  assert.ok(
    before.mergeConditions.every((c) => c.satisfied),
    'every merge condition is satisfied on the eligible PR'
  );
  const targetHeadBefore = await mainHead();

  // WHEN: the maintainer confirms the merge (the only selectable method is
  // “Create a merge commit”) — POST /pulls/1/merge.
  const merge = await post(mergeUrl(1), {}, alice);
  assert.equal(merge.status, 200);
  const payload = await merge.json();
  const merged = payload.pull;
  assert.equal(merged.status, 'merged');
  assert.equal(merged.mergedBy, 'alice-dev');
  assert.ok(merged.mergedAt, 'the merge time is stored');
  assert.ok(merged.mergeCommitId, 'the resulting commit identifier is stored');
  assert.equal(merged.mergeable, false);

  // THEN: the `main` branch head is updated to the merge result, whose
  // parents are the target-branch head at merge time and the current
  // compare commit, and whose snapshot integrates the compare content.
  const newHead = await mainHead();
  assert.notEqual(newHead, targetHeadBefore);
  assert.equal(newHead, merged.mergeCommitId);

  const commitDetail = await get(`${repo}/commits/${newHead}`, alice);
  assert.equal(commitDetail.status, 200);
  const commit = (await commitDetail.json()).commit;
  assert.equal(commit.message, 'Merge pull request #1 from release');
  assert.equal(commit.author, 'alice-dev');
  assert.deepEqual(
    commit.parents.map((p) => p.id),
    [targetHeadBefore, before.currentCompareCommitId]
  );

  // The merged snapshot contains the compare-side content: the
  // onboarding-guide.md added by the release branch is now on main.
  const guide = await get(`${repo}/contents/main/onboarding-guide.md`, alice);
  assert.equal(guide.status, 200);
  assert.match((await guide.json()).file.content, /Onboarding guide/);

  // A `merged` activity record appears in the Conversation timeline and the
  // merged state, merger, time, and commit identifier remain after reload.
  const activity = (await detail(1, alice)).activity;
  assert.ok(
    activity.some((e) => e.type === 'merged' && e.actor === 'alice-dev'),
    'the merge adds a merged activity record'
  );
  const reloaded = await detail(1, alice);
  assert.equal(reloaded.status, 'merged');
  assert.equal(reloaded.mergedBy, 'alice-dev');
  assert.equal(reloaded.mergeCommitId, newHead);

  // The compare branch keeps its head; only the target branch moved.
  const branches = await get(`${repo}/branches`);
  const list = (await branches.json()).branches;
  const release = list.find((b) => b.name === 'release');
  assert.equal(release.headCommitId, before.currentCompareCommitId);
});

test('REQ-6-5 scenario 2: a blocked PR targeting protected main without the required valid approval keeps a disabled merge entry and “Review required by branch protection”; nothing changes', async () => {
  const alice = await signIn('alice-dev');
  // `Pending review scenario` (#4) is an Open PR targeting main; main is
  // protected (rule created in the previous test) and the PR has no valid
  // non-author approval — only a pending `test` check.
  const blocked = await detail(4, alice);
  assert.equal(blocked.status, 'open');
  assert.equal(blocked.mergeable, false);
  assert.ok(
    blocked.blockedReasons.includes('Review required by branch protection'),
    'a missing required approval displays the exact reason'
  );
  assert.ok(
    blocked.blockedReasons.includes('Required status check "test" is not successful.')
  );
  assert.ok(
    blocked.mergeConditions.some((c) => !c.satisfied),
    'the confirmation area lists the unsatisfied conditions'
  );

  const headBefore = await mainHead();
  const merge = await post(mergeUrl(4), {}, alice);
  assert.equal(merge.status, 400);
  const body = await merge.json();
  assert.ok(
    body.reasons.includes('Review required by branch protection')
  );
  assert.equal((await detail(4, alice)).status, 'open');
  assert.equal(await mainHead(), headBefore, 'the target branch is unchanged');
});

test('REQ-6-5: a valid Request changes decision blocks merging until it is resolved', async () => {
  const alice = await signIn('alice-dev');
  const bob = await signIn('bob-reviewer');
  const changes = await post(
    reviewUrl(4),
    { decision: 'request_changes', explanation: 'Please adjust the copy.' },
    bob
  );
  assert.equal(changes.status, 201);

  const state = await detail(4, alice);
  assert.ok(state.blockedReasons.includes('Requested changes must be resolved.'));
  const headBefore = await mainHead();
  const merge = await post(mergeUrl(4), {}, alice);
  assert.equal(merge.status, 400);
  assert.ok((await merge.json()).reasons.includes('Requested changes must be resolved.'));
  assert.equal((await detail(4, alice)).status, 'open');
  assert.equal(await mainHead(), headBefore);
});

test('REQ-6-5: a failed `test` check blocks merging even with a valid approval', async () => {
  const alice = await signIn('alice-dev');
  const bob = await signIn('bob-reviewer');
  // Bob replaces his request-changes decision with an Approve on the
  // current compare commit (the old record stays in the timeline), and the
  // Admin marks the check as failure.
  const approve = await post(reviewUrl(4), { decision: 'approve' }, bob);
  assert.equal(approve.status, 201);
  const check = await patch(`${pullUrl(4)}/checks`, { status: 'failure' }, alice);
  assert.equal(check.status, 200);

  const state = await detail(4, alice);
  assert.ok(
    state.blockedReasons.includes('Required status check "test" is not successful.')
  );
  const headBefore = await mainHead();
  const merge = await post(mergeUrl(4), {}, alice);
  assert.equal(merge.status, 400);
  assert.ok(
    (await merge.json()).reasons.includes('Required status check "test" is not successful.')
  );
  assert.equal((await detail(4, alice)).status, 'open');
  assert.equal(await mainHead(), headBefore);
});

test('REQ-6-5: a merge conflict between the target and compare branches blocks merging', async () => {
  const alice = await signIn('alice-dev');
  // Two branches diverge from the same base by writing the same file
  // differently — merging them must be refused as a conflict.
  const branchA = await post(
    `${repo}/branches`,
    { name: 'merge-conflict-a', base: 'main' },
    alice
  );
  const branchB = await post(
    `${repo}/branches`,
    { name: 'merge-conflict-b', base: 'main' },
    alice
  );
  assert.equal(branchA.status, 201);
  assert.equal(branchB.status, 201);
  const writeA = await post(
    `${repo}/contents`,
    { branch: 'merge-conflict-a', path: 'conflict.md', content: 'version A', message: 'Write A' },
    alice
  );
  const writeB = await post(
    `${repo}/contents`,
    { branch: 'merge-conflict-b', path: 'conflict.md', content: 'version B', message: 'Write B' },
    alice
  );
  assert.equal(writeA.status, 201);
  assert.equal(writeB.status, 201);
  const branchesAfterWrites = await get(`${repo}/branches`);
  const listAfterWrites = (await branchesAfterWrites.json()).branches;
  const headA = listAfterWrites.find((b) => b.name === 'merge-conflict-a').headCommitId;
  const headB = listAfterWrites.find((b) => b.name === 'merge-conflict-b').headCommitId;
  assert.ok(headA && headB && headA !== headB, 'both branches advanced independently');

  const create = await post(
    `${repo}/pulls`,
    { title: 'Conflict PR', description: '', base: 'merge-conflict-a', compare: 'merge-conflict-b' },
    alice
  );
  assert.equal(create.status, 201);
  const number = (await create.json()).pull.number;

  const state = await detail(number, alice);
  assert.equal(state.mergeable, false);
  assert.ok(state.blockedReasons.includes('This branch has conflicts that must be resolved.'));

  const merge = await post(mergeUrl(number), {}, alice);
  assert.equal(merge.status, 400);
  assert.ok(
    (await merge.json()).reasons.includes('This branch has conflicts that must be resolved.')
  );
  const after = await detail(number, alice);
  assert.equal(after.status, 'open');
  // Neither branch moved: the target head is still the version-A commit
  // and the compare head is still the version-B commit.
  const branches = await get(`${repo}/branches`);
  const list = (await branches.json()).branches;
  assert.equal(
    list.find((b) => b.name === 'merge-conflict-a').headCommitId,
    headA
  );
  assert.equal(
    list.find((b) => b.name === 'merge-conflict-b').headCommitId,
    headB
  );
});

test('REQ-6-5: an unprotected target merges without any approval-count or check-success requirement', async () => {
  const alice = await signIn('alice-dev');
  // `unprotected-base` has no branch-protection rule (the rule is bound to
  // the exact branch name `main`), so no approval or check success is
  // required; merging still needs no conflicts and no valid Request
  // changes.
  const create = await post(
    `${repo}/branches`,
    { name: 'unprotected-base', base: 'main' },
    alice
  );
  assert.equal(create.status, 201);
  const pr = await post(
    `${repo}/pulls`,
    { title: 'Unprotected merge', description: '', base: 'unprotected-base', compare: 'pending-review' },
    alice
  );
  assert.equal(pr.status, 201);
  const number = (await pr.json()).pull.number;

  const state = await detail(number, alice);
  assert.equal(state.mergeable, true, 'an unprotected target needs no approval or check');
  assert.deepEqual(state.blockedReasons, []);
  assert.ok(
    state.mergeConditions.every((c) => c.satisfied),
    'only the conflict and request-changes conditions apply'
  );

  const merge = await post(mergeUrl(number), {}, alice);
  assert.equal(merge.status, 200);
  assert.equal((await merge.json()).pull.status, 'merged');
});

test('REQ-6-5: only Maintain, Admin, or the organization Owner may merge — anonymous, Read, and Write are rejected', async () => {
  const carol = await signIn('carol-dev');
  const bob = await signIn('bob-reviewer');
  const anonymous = await post(mergeUrl(4), {}, undefined);
  assert.equal(anonymous.status, 401);
  const read = await post(mergeUrl(4), {}, carol);
  assert.equal(read.status, 403);
  const write = await post(mergeUrl(4), {}, bob);
  assert.equal(write.status, 403);
});

test('REQ-6-5: Draft and Closed PRs cannot be merged and Merged is terminal', async () => {
  const alice = await signIn('alice-dev');
  const draft = await post(mergeUrl(3), {}, alice);
  assert.equal(draft.status, 400);
  assert.ok((await draft.json()).reasons.includes('Pull request is not open.'));
  const closed = await post(mergeUrl(2), {}, alice);
  assert.equal(closed.status, 400);
  assert.ok((await closed.json()).reasons.includes('Pull request is not open.'));

  // PR 1 was merged in scenario 1 — Merged is terminal: a second merge is
  // rejected and the target branch head stays at the first merge result.
  const head = await mainHead();
  const again = await post(mergeUrl(1), {}, alice);
  assert.equal(again.status, 400);
  assert.ok((await again.json()).reasons.includes('Pull request is not open.'));
  assert.equal(await mainHead(), head, 'the target branch is unchanged');
});
