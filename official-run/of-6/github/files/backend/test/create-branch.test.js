'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { isValidBranchName } = require('../src/validation');

let dataDir;
let server;
let baseUrl;
let ownerCookie;
let memberCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-create-branch-test-'));
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
  // REQ-6-3-3: bob-reviewer holds the seeded Write reviewer grant; a Read
  // user (carol-dev) plays the rejected Read fixture of the branch rules.
  memberCookie = await signin('carol-dev');
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

const post = (url, body, cookie) => request('POST', url, body, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

async function mainHead() {
  const res = await get('/api/repositories/acme-demo/acme-docs/branches');
  assert.equal(res.status, 200);
  const payload = await res.json();
  const main = payload.branches.find((b) => b.name === 'main');
  return { head: main.headCommitId, payload };
}

test('isValidBranchName implements the REQ-4-3 name rules', () => {
  for (const valid of ['feature/api-v2', 'pw-branch-abc123', 'main', 'a.b_c-d/1', 'x', 'A']) {
    assert.equal(isValidBranchName(valid), true, valid);
  }
  for (const invalid of [
    '',
    '..',
    'invalid..branch',
    'ends.',
    'ends/',
    'has//slash',
    'has space',
    'has!bang',
    'a'.repeat(256),
  ]) {
    assert.equal(isValidBranchName(invalid), false, JSON.stringify(invalid));
  }
});

test('REQ-4-3-2: alice-dev (organization Owner) can create a branch from the main head', async () => {
  const { head: mainHeadCommit } = await mainHead();

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/branches',
    { name: 'feature/api-v2', base: 'main' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.branch.name, 'feature/api-v2');
  assert.equal(payload.branch.headCommitId, mainHeadCommit);

  // The new branch is listed with the same head and the base history/files
  // are untouched: main's head is unchanged and the new branch reads the
  // same snapshot as main (README.md + src/search.ts, no main-only.md).
  const listRes = await get('/api/repositories/acme-demo/acme-docs/branches');
  const list = await listRes.json();
  const names = list.branches.map((b) => b.name);
  assert.ok(names.includes('feature/api-v2'));
  assert.deepEqual(list.branches.find((b) => b.name === 'feature/api-v2').headCommitId, mainHeadCommit);
  assert.deepEqual(list.branches.find((b) => b.name === 'main').headCommitId, mainHeadCommit);

  const featureContents = await get(
    '/api/repositories/acme-demo/acme-docs/contents?branch=feature/api-v2'
  );
  assert.equal(featureContents.status, 200);
  const featureFiles = (await featureContents.json()).files.map((f) => f.path);
  assert.deepEqual(featureFiles, ['README.md', 'src/search.ts']);

  // The original branch history is not rewritten: main keeps 2 commits.
  const mainCommits = await get('/api/repositories/acme-demo/acme-docs/commits');
  const history = await mainCommits.json();
  assert.deepEqual(
    history.commits.map((c) => c.message),
    ['Document search flow', 'Initial commit']
  );
});

test('REQ-4-3-2: a rejected creation leaves the original state unchanged', async () => {
  const before = await get('/api/repositories/acme-demo/acme-docs/branches');
  const beforePayload = await before.json();

  const cases = [
    { name: '' },
    { name: 'invalid..branch' },
    { name: 'ends.' },
    { name: 'ends/' },
    { name: 'has//slash' },
    { name: 'main' }, // duplicate
    { name: 'bad name!' },
    { name: 'a'.repeat(256) },
  ];
  for (const body of cases) {
    const res = await post(
      '/api/repositories/acme-demo/acme-docs/branches',
      body,
      ownerCookie
    );
    assert.equal(res.status, 400, JSON.stringify(body));
    const payload = await res.json();
    if (body.name === 'main') {
      assert.equal(payload.errors.name, 'Branch already exists');
    } else {
      assert.equal(payload.errors.name, 'Invalid branch', JSON.stringify(body));
    }
  }

  const after = await get('/api/repositories/acme-demo/acme-docs/branches');
  const afterPayload = await after.json();
  assert.deepEqual(
    afterPayload.branches.map((b) => b.name).sort(),
    beforePayload.branches.map((b) => b.name).sort()
  );
});

test('REQ-4-3-2: an unknown base branch is rejected and nothing is stored', async () => {
  const before = await get('/api/repositories/acme-demo/acme-docs/branches');
  const beforePayload = await before.json();

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/branches',
    { name: 'from-nowhere', base: 'no-such-branch' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.base, 'Base branch not found');

  const after = await get('/api/repositories/acme-demo/acme-docs/branches');
  const afterPayload = await after.json();
  assert.equal(afterPayload.branches.length, beforePayload.branches.length);
});

test('REQ-4-3-2: omitting the base defaults to the repository default branch', async () => {
  const { head: mainHeadCommit } = await mainHead();
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/branches',
    { name: 'pw-branch-abc123' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.branch.name, 'pw-branch-abc123');
  assert.equal(payload.branch.headCommitId, mainHeadCommit);
});

test('REQ-4-3-2: carol-dev (Read) and anonymous users cannot create branches', async () => {
  const before = await get('/api/repositories/acme-demo/acme-docs/branches');
  const beforeCount = (await before.json()).branches.length;

  const memberRes = await post(
    '/api/repositories/acme-demo/acme-docs/branches',
    { name: 'member-branch', base: 'main' },
    memberCookie
  );
  assert.equal(memberRes.status, 403);
  assert.equal((await memberRes.json()).error, 'Access denied');

  const anonymousRes = await post(
    '/api/repositories/acme-demo/acme-docs/branches',
    { name: 'anon-branch', base: 'main' }
  );
  assert.equal(anonymousRes.status, 401);
  assert.equal((await anonymousRes.json()).error, 'Authentication required');

  const after = await get('/api/repositories/acme-demo/acme-docs/branches');
  assert.equal((await after.json()).branches.length, beforeCount);
});

test('REQ-4-3-2: the branch list reports canCreate from the effective role', async () => {
  const anonymous = await get('/api/repositories/acme-demo/acme-docs/branches');
  assert.equal((await anonymous.json()).canCreate, false);

  const member = await get('/api/repositories/acme-demo/acme-docs/branches', memberCookie);
  assert.equal((await member.json()).canCreate, false);

  const owner = await get('/api/repositories/acme-demo/acme-docs/branches', ownerCookie);
  assert.equal((await owner.json()).canCreate, true);
});

test('REQ-4-3-2: the new branch persists across a fresh store read', async () => {
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const created = store.findBranchByRepositoryAndName(repo.id, 'feature/api-v2');
  assert.ok(created);
  assert.equal(created.headCommitId, store.findBranchByRepositoryAndName(repo.id, 'main').headCommitId);
  assert.equal(typeof created.creatorId, 'string');
  assert.equal(typeof created.createdAt, 'string');
});
