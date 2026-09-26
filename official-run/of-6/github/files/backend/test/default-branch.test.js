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
let ownerCookie;
let memberCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-default-branch-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signin = async (identifier) => {
    const res = await fetch(`${baseUrl}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: 'Valid-password-123!' }),
    });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  };

  ownerCookie = await signin('alice-dev');
  memberCookie = await signin('bob-reviewer');
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

const patch = (url, body, cookie) => request('PATCH', url, body, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

test('REQ-4-3-3: the seeded acme-docs has main, feature-search and release branches with main as default', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/branches');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.defaultBranch, 'main');
  const names = payload.branches.map((b) => b.name);
  // REQ-6-3-3: the pending-comment seed PR adds the pending-review branch.
  assert.deepEqual(names.sort(), ['draft-feature', 'feature-search', 'main', 'pending-review', 'release']);
  for (const name of ['main', 'feature-search', 'release']) {
    assert.ok(names.includes(name), `${name} must be a stored branch`);
  }
});

test('REQ-4-3-3: changing the default branch requires authentication', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/default-branch',
    { branch: 'release' }
  );
  assert.equal(res.status, 401);
});

test('REQ-4-3-3: a non-Admin cannot change the default branch and the default stays unchanged', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/default-branch',
    { branch: 'release' },
    memberCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');

  const view = await get('/api/repositories/acme-demo/acme-docs');
  assert.equal((await view.json()).repository.defaultBranch, 'main');
});

test('REQ-4-3-3: an unknown branch is rejected and the default stays unchanged', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/default-branch',
    { branch: 'does-not-exist' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.branch, 'Branch not found');

  const view = await get('/api/repositories/acme-demo/acme-docs');
  assert.equal((await view.json()).repository.defaultBranch, 'main');
});

test('REQ-4-3-3: an Admin changes the default branch to release; the previous branch and its commits stay intact', async () => {
  const { createStore } = require('../src/store');
  const store1 = createStore(dataDir);
  const repo = store1.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const beforeMain = store1.findBranchByRepositoryAndName(repo.id, 'main');
  const beforeMainHistory = store1
    .getCommitHistory(repo.id, 'main')
    .map((c) => c.id);
  const beforeRelease = store1.findBranchByRepositoryAndName(repo.id, 'release');
  const beforeReleaseHistory = store1
    .getCommitHistory(repo.id, 'release')
    .map((c) => c.id);

  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/default-branch',
    { branch: 'release' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.repository.defaultBranch, 'release');

  // The previous default branch and both branch histories are never deleted
  // or rewritten by the default-branch change.
  const store2 = createStore(dataDir);
  const afterMain = store2.findBranchByRepositoryAndName(repo.id, 'main');
  assert.ok(afterMain, 'the old default branch still exists');
  assert.equal(afterMain.headCommitId, beforeMain.headCommitId);
  assert.deepEqual(
    store2.getCommitHistory(repo.id, 'main').map((c) => c.id),
    beforeMainHistory
  );
  const afterRelease = store2.findBranchByRepositoryAndName(repo.id, 'release');
  assert.equal(afterRelease.headCommitId, beforeRelease.headCommitId);
  assert.deepEqual(
    store2.getCommitHistory(repo.id, 'release').map((c) => c.id),
    beforeReleaseHistory
  );

  // The new default branch is stored together with the operator and time.
  const afterRepo = store2.findRepositoryById(repo.id);
  assert.equal(afterRepo.defaultBranch, 'release');
  assert.equal(
    afterRepo.defaultBranchOperatorId,
    store2.findAccountByUsername('alice-dev').id
  );
  assert.ok(afterRepo.defaultBranchChangedAt);
});

test('REQ-4-3-3: newly opened repository reads use the new default branch', async () => {
  const contents = await get('/api/repositories/acme-demo/acme-docs/contents');
  assert.equal(contents.status, 200);
  const contentPayload = await contents.json();
  assert.equal(contentPayload.branch.name, 'release');

  const commits = await get('/api/repositories/acme-demo/acme-docs/commits');
  assert.equal(commits.status, 200);
  const commitPayload = await commits.json();
  assert.equal(commitPayload.branch.name, 'release');
});

test('REQ-4-3-3: the old default branch remains available in the branch list', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/branches');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.defaultBranch, 'release');
  assert.ok(payload.branches.some((b) => b.name === 'main'));
  assert.ok(payload.branches.some((b) => b.name === 'feature-search'));
});

test('REQ-4-3-3: the new default branch survives a store reload (persisted)', async () => {
  const { createStore } = require('../src/store');
  const store3 = createStore(dataDir);
  const repo = store3.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  assert.equal(repo.defaultBranch, 'release');
  // Reloading never duplicates the release seed or rewrites branch heads.
  const releaseBranches = store3
    .getBranches(repo.id)
    .filter((b) => b.name === 'release');
  assert.equal(releaseBranches.length, 1);
});

test('REQ-4-3-3: a non-Admin update request leaves the saved default branch unchanged', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/default-branch',
    { branch: 'main' },
    memberCookie
  );
  assert.equal(res.status, 403);
  const view = await get('/api/repositories/acme-demo/acme-docs');
  assert.equal((await view.json()).repository.defaultBranch, 'release');
});
