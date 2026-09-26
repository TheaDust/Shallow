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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-state-test-'));
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
const stateUrl = (number) => `${repo}/pulls/${number}/state`;
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

async function branchHead(name) {
  const branches = await get(`${repo}/branches`);
  assert.equal(branches.status, 200);
  const list = (await branches.json()).branches;
  const branch = list.find((b) => b.name === name);
  assert.ok(branch, `branch ${name} must exist`);
  return branch.headCommitId;
}

test('REQ-6-6 scenario 1: the author closes an unmerged Open PR with “Close pull request”, sees Closed, reopens it with “Reopen pull request”, and the timeline records both transitions; branches, discussion, and diff stay intact and reload keeps Open', async () => {
  const alice = await signIn('alice-dev');

  // GIVEN: the authored Open seed PR `Improve onboarding` (#1, main←release,
  // author alice-dev) with its discussion and source/target branches.
  const before = await detail(1, alice);
  assert.equal(before.status, 'open');
  assert.ok(before.comments.length > 0, 'the PR has its original discussion');
  assert.ok(
    before.activity.some((e) => e.type === 'created'),
    'the creation activity is present before the cycle'
  );
  const baseHeadBefore = await branchHead('main');
  const compareHeadBefore = await branchHead('release');
  const filesBefore = before.filesChanged;

  // WHEN: the author clicks “Close pull request” — the transition is
  // immediate (no extra confirmation dialog) — the status becomes Closed.
  const close = await post(stateUrl(1), { state: 'closed' }, alice);
  assert.equal(close.status, 200);
  const closed = (await close.json()).pull;
  assert.equal(closed.status, 'closed');
  assert.ok(
    closed.activity.some(
      (e) => e.type === 'closed' && e.actor === 'alice-dev'
    ),
    'closing records a closed transition in the timeline'
  );

  // THEN: closing does not merge commits, does not update the target
  // branch, and does not delete the discussion or the diff.
  assert.equal(await branchHead('main'), baseHeadBefore);
  assert.equal(await branchHead('release'), compareHeadBefore);
  assert.deepEqual(closed.filesChanged, filesBefore, 'the diff stays viewable');
  assert.deepEqual(
    closed.comments,
    before.comments,
    'the original discussion is preserved'
  );
  assert.equal(closed.baseBranch, 'main');
  assert.equal(closed.compareBranch, 'release');

  // The viewer then clicks “Reopen pull request” — the status immediately
  // restores Open and the timeline records the reopen transition.
  const reopen = await post(stateUrl(1), { state: 'open' }, alice);
  assert.equal(reopen.status, 200);
  const reopened = (await reopen.json()).pull;
  assert.equal(reopened.status, 'open');
  assert.ok(
    reopened.activity.some(
      (e) => e.type === 'reopened' && e.actor === 'alice-dev'
    ),
    'reopening records a reopened transition in the timeline'
  );
  assert.ok(
    reopened.activity.some((e) => e.type === 'closed'),
    'both transitions are recorded in the timeline'
  );

  // THEN: after refreshing the detail page the final Open status and the
  // original discussion remain; no branch moved.
  const reloaded = await detail(1, alice);
  assert.equal(reloaded.status, 'open');
  assert.deepEqual(reloaded.comments, before.comments);
  assert.equal(await branchHead('main'), baseHeadBefore);
  assert.equal(await branchHead('release'), compareHeadBefore);
});

test('REQ-6-6 scenario 2: a signed-in viewer who is neither the PR author nor a maintainer cannot close or reopen a readable Open PR — both operations are rejected and the status remains unchanged', async () => {
  const bob = await signIn('bob-reviewer'); // Write grant, not the author
  const carol = await signIn('carol-dev'); // Read-only (registered, no grant)
  const alice = await signIn('alice-dev');

  // The authored Open PR `Improve onboarding` and the separate Open PR
  // `Pending review scenario` (#4) are both readable by the viewers.
  for (const number of [1, 4]) {
    const viewerDetail = await detail(number, bob);
    assert.equal(viewerDetail.status, 'open');
    const before = viewerDetail.activity.length;

    const bobClose = await post(stateUrl(number), { state: 'closed' }, bob);
    assert.equal(bobClose.status, 403);
    const bobReopen = await post(stateUrl(number), { state: 'open' }, bob);
    assert.equal(bobReopen.status, 403);

    const carolClose = await post(stateUrl(number), { state: 'closed' }, carol);
    assert.equal(carolClose.status, 403);

    const after = await detail(number, bob);
    assert.equal(after.status, 'open', 'the PR status remains unchanged');
    assert.equal(
      after.activity.length,
      before,
      'no transition is recorded by a rejected viewer request'
    );
  }

  // Unauthenticated callers get 401.
  const anon = await post(stateUrl(1), { state: 'closed' });
  assert.equal(anon.status, 401);

  // The author (alice) is still able to transition the PR.
  const close = await post(stateUrl(1), { state: 'closed' }, alice);
  assert.equal(close.status, 200);
  assert.equal((await close.json()).pull.status, 'closed');
  const reopen = await post(stateUrl(1), { state: 'open' }, alice);
  assert.equal(reopen.status, 200);
  assert.equal((await reopen.json()).pull.status, 'open');
});

test('REQ-6-6: the author may close a Draft PR; requesting Open on a Draft through the state endpoint is rejected; invalid states and duplicate transitions are no-ops', async () => {
  const alice = await signIn('alice-dev');

  // #3 `Draft onboarding update` is a Draft PR authored by alice-dev.
  const draft = await detail(3, alice);
  assert.equal(draft.status, 'draft');

  // A Draft cannot be transitioned to Open through the close/reopen state
  // endpoint (Draft → Open is the Ready-for-review transition).
  const draftOpen = await post(stateUrl(3), { state: 'open' }, alice);
  assert.equal(draftOpen.status, 400);
  assert.equal((await detail(3, alice)).status, 'draft');

  // The author may close an unmerged Draft PR without merging.
  const close = await post(stateUrl(3), { state: 'closed' }, alice);
  assert.equal(close.status, 200);
  const closed = (await close.json()).pull;
  assert.equal(closed.status, 'closed');
  assert.ok(
    closed.activity.some((e) => e.type === 'closed' && e.actor === 'alice-dev')
  );

  // Closing an already-closed PR is an idempotent no-op (no duplicate
  // activity record).
  const activityAfterFirstClose = closed.activity.length;
  const closeAgain = await post(stateUrl(3), { state: 'closed' }, alice);
  assert.equal(closeAgain.status, 200);
  assert.equal((await closeAgain.json()).pull.status, 'closed');
  assert.equal(
    (await detail(3, alice)).activity.length,
    activityAfterFirstClose,
    'a duplicate close adds no activity record'
  );

  // Reopening the closed draft restores Open.
  const reopen = await post(stateUrl(3), { state: 'open' }, alice);
  assert.equal(reopen.status, 200);
  assert.equal((await reopen.json()).pull.status, 'open');

  // An invalid state string is rejected and changes nothing.
  const invalid = await post(stateUrl(3), { state: 'bogus' }, alice);
  assert.equal(invalid.status, 400);
  assert.equal((await detail(3, alice)).status, 'open');

  // Reopening an already-open PR is an idempotent no-op.
  const activityBefore = (await detail(3, alice)).activity.length;
  const reopenAgain = await post(stateUrl(3), { state: 'open' }, alice);
  assert.equal(reopenAgain.status, 200);
  assert.equal(
    (await detail(3, alice)).activity.length,
    activityBefore,
    'a duplicate reopen adds no activity record'
  );
});

test('REQ-6-6: Merged is terminal — the server rejects every status change of a merged PR and the PR stays Merged', async () => {
  const alice = await signIn('alice-dev');
  const bob = await signIn('bob-reviewer');

  // Build a Merged PR: protect `main`, get a valid non-author Approve and a
  // successful `test` check, then merge the untouched Open seed PR
  // `Pending review scenario` (#4, main←pending-review) — the same
  // operations the merge feature performs.
  const rule = await post(
    `${repo}/branch-protection`,
    { branchName: 'main', requireApproval: true, requireStatusCheck: true },
    alice
  );
  assert.equal(rule.status, 201);
  const approve = await post(reviewUrl(4), { decision: 'approve' }, bob);
  assert.equal(approve.status, 201);
  const check = await patch(
    `${pullUrl(4)}/checks`,
    { status: 'success' },
    alice
  );
  assert.equal(check.status, 200);
  const merge = await post(`${pullUrl(4)}/merge`, {}, alice);
  assert.equal(merge.status, 200);
  assert.equal((await merge.json()).pull.status, 'merged');

  // Closing and reopening a merged PR are both rejected and nothing changes.
  const close = await post(stateUrl(4), { state: 'closed' }, alice);
  assert.equal(close.status, 400);
  assert.match(await close.text(), /Pull request is merged/);
  const reopen = await post(stateUrl(4), { state: 'open' }, alice);
  assert.equal(reopen.status, 400);

  const after = await detail(4, alice);
  assert.equal(after.status, 'merged');
  assert.ok(
    !after.activity.some((e) => e.type === 'closed' || e.type === 'reopened'),
    'no close/reopen transition is recorded on a merged PR'
  );
  assert.equal(await branchHead('main'), after.mergeCommitId);
});
