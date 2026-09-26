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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-overview-test-'));
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

async function signIn(username) {
  const res = await post('/api/auth/signin', {
    identifier: username,
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

test('REQ-6-3-1 scenario 1: a visitor reads the seeded Open PR detail — title, description, branches, discussion comment, commits and changed files', async () => {
  // A seeded public Open PR is directly viewable without sign-in.
  const res = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  const pull = payload.pull;
  assert.equal(pull.title, 'Improve onboarding');
  assert.equal(pull.status, 'open');
  assert.equal(pull.author, 'alice-dev');
  assert.equal(pull.baseBranch, 'main');
  assert.equal(pull.compareBranch, 'release');
  assert.equal(pull.description, 'Improve the onboarding experience for new contributors.');

  // Conversation: the PR carries one seeded discussion comment (author +
  // verbatim body) and the creation activity (status event).
  assert.ok(Array.isArray(pull.comments), 'comments is a list');
  assert.equal(pull.comments.length, 1, 'the Open PR has one discussion comment');
  assert.equal(pull.comments[0].author, 'alice-dev');
  assert.equal(
    pull.comments[0].body,
    'Looking good — the onboarding improvements are clear and easy to follow.'
  );
  assert.ok(pull.comments[0].createdAt);
  assert.ok(pull.activity.some((e) => e.type === 'created'), 'the creation status event exists');

  // Commits: the Open PR (main ← release) has at least one comparable
  // commit (the seeded "Add onboarding guide" commit is ahead of main).
  assert.ok(Array.isArray(pull.commits), 'commits is a list');
  assert.ok(pull.commits.length >= 1, 'the Open PR has at least one comparable commit');
  assert.equal(pull.commits[0].message, 'Add onboarding guide');
  assert.equal(pull.commits[0].author, 'alice-dev');

  // Files changed: the current diff of base vs compare has a change summary
  // with at least the seeded changed file.
  assert.ok(Array.isArray(pull.filesChanged), 'filesChanged is a list');
  assert.ok(pull.filesChanged.length >= 1, 'the Open PR has changed files');
  assert.ok(
    pull.filesChanged.some((f) => f.path === 'onboarding-guide.md'),
    'the seeded release commit changes onboarding-guide.md'
  );
  assert.equal(typeof pull.additions, 'number');
  assert.equal(typeof pull.deletions, 'number');
  assert.ok(pull.currentCompareCommitId, 'the current compare commit is derived');

  // The Checks area remains available with test pending on arrival.
  assert.equal(pull.checks.test.status, 'pending');
});

test("REQ-6-3-2 scenario 1: the public Open PR's Files changed diff shows src/search.ts and the aggregate statistics; unchanged files are absent", async () => {
  // The visitor activates the Files changed view of a visible public PR
  // entry without signing in.
  const res = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  assert.equal(res.status, 200);
  const payload = await res.json();
  const pull = payload.pull;

  // The comparison contains one added file (onboarding-guide.md) and one
  // modified file (src/search.ts — the known changed-file path supplied for
  // branch comparison, verbatim). README.md is identical in base and
  // compare, so it is never part of the diff.
  assert.deepEqual(
    pull.filesChanged.map((f) => f.path),
    ['onboarding-guide.md', 'src/search.ts'],
    'exactly one added file and one modified file (sorted by path)'
  );
  const searchTs = pull.filesChanged.find((f) => f.path === 'src/search.ts');
  assert.ok(searchTs, 'the known changed-file path src/search.ts appears verbatim');
  assert.equal(searchTs.additions, 1, 'src/search.ts has one added line');
  assert.equal(searchTs.deletions, 1, 'src/search.ts has one deleted line');
  assert.ok(
    searchTs.lines.some((l) => l.type === 'add'),
    'the modified file carries added lines'
  );
  assert.ok(
    searchTs.lines.some((l) => l.type === 'del'),
    'the modified file carries deleted lines'
  );
  const guide = pull.filesChanged.find((f) => f.path === 'onboarding-guide.md');
  assert.ok(guide, 'the added file onboarding-guide.md appears');
  assert.equal(guide.deletions, 0, 'an added file has no deletions');
  assert.ok(guide.additions >= 1, 'an added file has added lines');
  assert.ok(
    !pull.filesChanged.some((f) => f.path === 'README.md'),
    'unchanged files are not displayed'
  );

  // The aggregate statistics equal the current PR's per-file line counts in
  // the format used by the view (<additions> additions, <deletions>
  // deletions).
  assert.equal(
    pull.additions,
    pull.filesChanged.reduce((sum, f) => sum + f.additions, 0)
  );
  assert.equal(
    pull.deletions,
    pull.filesChanged.reduce((sum, f) => sum + f.deletions, 0)
  );
  assert.ok(pull.additions >= 1);
  assert.ok(pull.deletions >= 1);

  // The diff corresponds to the current base and compare commits: the same
  // persisted diff as a direct store computation between the creation-time
  // base commit and the current compare commit (the release branch head).
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const pullRequest = store.findPullRequestByNumber(repo.id, 1);
  const release = store.findBranchByRepositoryAndName(repo.id, 'release');
  assert.equal(pull.currentCompareCommitId, release.headCommitId);
  const direct = store.getCommitDiff(
    repo.id,
    pullRequest.baseCommitId,
    pull.currentCompareCommitId
  );
  assert.deepEqual(
    pull.filesChanged.map((f) => f.path),
    direct.files.map((f) => f.path)
  );
  assert.equal(pull.additions, direct.additions);
  assert.equal(pull.deletions, direct.deletions);

  // Re-reading the same PR returns the identical files and aggregate; the
  // PR status and review status stay unchanged (viewing is read-only).
  const again = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  const againPull = (await again.json()).pull;
  assert.equal(againPull.title, pull.title);
  assert.equal(againPull.status, pull.status);
  assert.deepEqual(
    againPull.filesChanged.map((f) => f.path),
    pull.filesChanged.map((f) => f.path)
  );
  assert.equal(againPull.additions, pull.additions);
  assert.equal(againPull.deletions, pull.deletions);
  assert.deepEqual(againPull.reviews, pull.reviews);
  assert.equal(
    store.getPullRequestComments(pullRequest.id).length,
    pull.comments.length,
    'viewing created no discussion comments'
  );
});

test('REQ-6-3-2: users without permission to view a private PR cannot obtain its diff content', async () => {
  const res = await get('/api/repositories/acme-demo/acme-internal/pulls/1');
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.ok(body.error, 'the 403 carries only the access error');
  assert.equal(body.pull, undefined, 'no diff content leaks to unauthorized users');
  assert.equal(body.filesChanged, undefined);
});

test('REQ-6-3-1: the Closed seed PR detail is also readable and keeps the same navigation data', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/pulls/2');
  assert.equal(res.status, 200);
  const pull = (await res.json()).pull;
  assert.equal(pull.title, 'Fix search');
  assert.equal(pull.status, 'closed');
  assert.equal(pull.baseBranch, 'main');
  assert.equal(pull.compareBranch, 'feature-search');
  assert.ok(pull.commits.length >= 1, 'Fix search has the feature-search commit');
  assert.ok(pull.filesChanged.length >= 1, 'Fix search has changed files');
  assert.ok(Array.isArray(pull.comments));
  assert.ok(Array.isArray(pull.reviews));
});

test('REQ-6-3-1: viewing is read-only — repeated reads return the same PR and create no comments, reviews, or branch updates', async () => {
  const { createStore } = require('../src/store');
  const store1 = createStore(dataDir);
  const repo = store1.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');

  const before = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  const beforePull = (await before.json()).pull;

  // Opening the tabs in sequence is the same read view; repeat the reads.
  for (let i = 0; i < 2; i += 1) {
    const res = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
    assert.equal(res.status, 200);
    const again = (await res.json()).pull;
    assert.equal(again.title, beforePull.title);
    assert.equal(again.baseBranch, beforePull.baseBranch);
    assert.equal(again.compareBranch, beforePull.compareBranch);
    assert.deepEqual(
      again.commits.map((c) => c.id),
      beforePull.commits.map((c) => c.id)
    );
  }

  const store2 = createStore(dataDir);
  const repo2 = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const pullRequest = store2.findPullRequestByNumber(repo2.id, 1);
  assert.equal(
    store2.getPullRequestComments(pullRequest.id).length,
    1,
    'viewing did not add discussion comments'
  );
  assert.equal(
    store2.getPullRequestReviewSummaries(pullRequest).length,
    0,
    'viewing did not add reviews'
  );
  const release = store2.findBranchByRepositoryAndName(repo2.id, 'release');
  assert.equal(release.headCommitId, pullRequest.compareCommitId, 'no branch was updated by viewing');
});

test('REQ-6-3-1 scenario 2: a signed-in user (alice-dev) views the same persisted PR; reloading keeps the result', async () => {
  const cookie = await signIn('alice-dev');

  const res = await get('/api/repositories/acme-demo/acme-docs/pulls/1', cookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.role, 'admin');
  const pull = payload.pull;
  assert.equal(pull.title, 'Improve onboarding');
  assert.equal(pull.status, 'open');
  assert.equal(pull.description, 'Improve the onboarding experience for new contributors.');
  assert.equal(pull.comments.length, 1);

  // Reloading the same visible page restores the same PR and allows the
  // same navigation (title, branches, commits unchanged).
  const reload = await get('/api/repositories/acme-demo/acme-docs/pulls/1', cookie);
  const reloaded = (await reload.json()).pull;
  assert.equal(reloaded.title, pull.title);
  assert.equal(reloaded.baseBranch, pull.baseBranch);
  assert.equal(reloaded.compareBranch, pull.compareBranch);
  assert.deepEqual(
    reloaded.commits.map((c) => c.id),
    pull.commits.map((c) => c.id)
  );
  assert.deepEqual(
    reloaded.filesChanged.map((f) => f.path),
    pull.filesChanged.map((f) => f.path)
  );
  assert.equal(reloaded.comments.length, pull.comments.length);

  // A rejected action (unknown PR) leaves the original state unchanged.
  const unknown = await get('/api/repositories/acme-demo/acme-docs/pulls/99', cookie);
  assert.equal(unknown.status, 404);
  const after = await get('/api/repositories/acme-demo/acme-docs/pulls/1', cookie);
  assert.equal((await after.json()).pull.title, 'Improve onboarding');
});

test('REQ-6-3-1: an unknown PR is a 404 and a private repository without permission is a 403', async () => {
  const unknown = await get('/api/repositories/acme-demo/acme-docs/pulls/424242');
  assert.equal(unknown.status, 404);

  // Visitors cannot read private repositories (same repository-view rule).
  const privateRes = await get('/api/repositories/acme-demo/acme-internal/pulls/1');
  assert.equal(privateRes.status, 403);
});

test('REQ-6-3-1: the seeded discussion comment is provisioned idempotently across reloads', async () => {
  const { createStore } = require('../src/store');
  const store1 = createStore(dataDir);
  const repo = store1.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const pullRequest = store1.findPullRequestByNumber(repo.id, 1);
  const comments = store1.getPullRequestComments(pullRequest.id);
  assert.equal(comments.length, 1);

  // Reopening the same store never duplicates the seed comment.
  const store2 = createStore(dataDir);
  const repo2 = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const pullRequest2 = store2.findPullRequestByNumber(repo2.id, 1);
  assert.equal(store2.getPullRequestComments(pullRequest2.id).length, 1);
});
