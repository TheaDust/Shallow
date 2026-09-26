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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-compare-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const get = (url, cookie) => request('GET', url, undefined, cookie);

function request(method, url, body, cookie) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function signIn(username) {
  const res = await request('POST', '/api/auth/signin', {
    identifier: username,
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

test('REQ-6-2-2: an unauthenticated visitor cannot enter the creation-comparison flow', async () => {
  const res = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/compare?base=main&compare=feature-search'
  );
  assert.equal(res.status, 401);
});

test('REQ-6-2-2: Read and Triage may not compare branches (403), even on a public repository', async () => {
  // REQ-6-3-3: bob-reviewer holds the seeded Write reviewer grant, so a
  // Read user (carol-dev) plays the rejected Read fixture.
  const readCookie = await signIn('carol-dev');
  const readRes = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/compare?base=main&compare=feature-search',
    readCookie
  );
  assert.equal(readRes.status, 403);

  const triageCookie = await signIn('dana-triage');
  const triageRes = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/compare?base=main&compare=feature-search',
    triageCookie
  );
  assert.equal(triageRes.status, 403);
});

test('REQ-6-2-2 scenario 1: a Write/Maintain/Admin/Owner user compares main with feature-search', async () => {
  const cookie = await signIn('alice-dev');
  const res = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/compare?base=main&compare=feature-search',
    cookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.role, 'admin');
  assert.equal(payload.base.name, 'main');
  assert.equal(payload.compare.name, 'feature-search');
  // feature-search is one commit ahead of main: the single comparable commit
  // is the “Add main-only.md” seed commit.
  assert.equal(payload.commitCount, 1);
  assert.equal(payload.commits.length, 1);
  assert.equal(payload.commits[0].message, 'Add main-only.md');
  assert.ok(payload.commits[0].id.length > 0);
  assert.ok(payload.commits[0].shortId.length > 0);
  assert.equal(payload.commits[0].author, 'alice-dev');
  // The seeded changed-file path for the comparison is src/search.ts — it
  // must appear verbatim among the changed files, with per-file counts and
  // the aggregate diff summary.
  const paths = payload.files.map((f) => f.path);
  assert.ok(paths.includes('src/search.ts'), 'src/search.ts must be a changed file');
  for (const file of payload.files) {
    assert.ok(Array.isArray(file.lines), 'each changed file carries diff lines');
    assert.equal(typeof file.additions, 'number');
    assert.equal(typeof file.deletions, 'number');
  }
  assert.equal(typeof payload.additions, 'number');
  assert.equal(typeof payload.deletions, 'number');
  assert.equal(payload.additions + payload.deletions > 0, true);
});

test('REQ-6-2-2: comparing a branch with itself yields no comparable commits and no changed files', async () => {
  const cookie = await signIn('alice-dev');
  const res = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/compare?base=main&compare=main',
    cookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.commitCount, 0);
  assert.deepEqual(payload.commits, []);
  assert.deepEqual(payload.files, []);
  assert.equal(payload.additions, 0);
  assert.equal(payload.deletions, 0);
});

test('REQ-6-2-2: distinct branches pointing at the same commit have no differences', async () => {
  const cookie = await signIn('alice-dev');
  // The seeded draft-feature branch points at the feature-search head commit
  // (REQ-6-2-4), so comparing the distinct names feature-search and
  // draft-feature yields no comparable commits and no changed files (the
  // creation entry must be disabled). (REQ-6-3-1 moved the release seed one
  // commit ahead of main so the seeded Open PR has comparable commits.)
  const res = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/compare?base=feature-search&compare=draft-feature',
    cookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.base.name, 'feature-search');
  assert.equal(payload.compare.name, 'draft-feature');
  assert.equal(payload.commitCount, 0);
  assert.deepEqual(payload.files, []);
});

test('REQ-6-2-2: an unknown base or compare branch is rejected without any side effect', async () => {
  const cookie = await signIn('alice-dev');
  const res = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/compare?base=nope&compare=feature-search',
    cookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.errors.base, 'Branch not found');
});

test('REQ-6-2-2: comparison is read-only — no PR, commit, or branch changes are saved', async () => {
  const cookie = await signIn('alice-dev');
  const beforePulls = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforePullsPayload = await beforePulls.json();
  const beforeBranches = await get('/api/repositories/acme-demo/acme-docs/branches', cookie);
  const beforeBranchesPayload = await beforeBranches.json();

  const res = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/compare?base=main&compare=feature-search',
    cookie
  );
  assert.equal(res.status, 200);

  const afterPulls = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const afterPullsPayload = await afterPulls.json();
  assert.deepEqual(
    afterPullsPayload.pulls.map((p) => [p.number, p.status]),
    beforePullsPayload.pulls.map((p) => [p.number, p.status])
  );
  const afterBranches = await get('/api/repositories/acme-demo/acme-docs/branches', cookie);
  const afterBranchesPayload = await afterBranches.json();
  assert.deepEqual(
    afterBranchesPayload.branches.map((b) => [b.name, b.headCommitId]),
    beforeBranchesPayload.branches.map((b) => [b.name, b.headCommitId])
  );
});

test('REQ-6-2-2: a private repository without permission is rejected even for a signed-in reader', async () => {
  const cookie = await signIn('bob-reviewer');
  const res = await get(
    '/api/repositories/acme-demo/acme-internal/pulls/compare?base=main&compare=main',
    cookie
  );
  assert.equal(res.status, 403);
});
