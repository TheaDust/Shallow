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
let aliceCookie;
let bobCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-fork-repo-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const aliceSignin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice-dev', password: 'Valid-password-123!' }),
  });
  assert.equal(aliceSignin.status, 200);
  aliceCookie = aliceSignin.headers.get('set-cookie').split(';')[0];

  const bobSignin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'bob-reviewer', password: 'Valid-password-123!' }),
  });
  assert.equal(bobSignin.status, 200);
  bobCookie = bobSignin.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function post(url, body, cookie) {
  return fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function get(url, cookie) {
  return fetch(`${baseUrl}${url}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test('forking a repository requires authentication', async () => {
  const res = await post('/api/repositories/acme-demo/acme-docs/forks', {
    owner: 'alice-dev',
    name: 'acme-docs',
    visibility: 'public',
  });
  assert.equal(res.status, 401);
});

test('the fork-conflict seed name already exists in the target personal namespace', async () => {
  const res = await get('/api/repositories/alice-dev/acme-docs-fork', aliceCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.repository.name, 'acme-docs-fork');
});

test('alice forks the public acme-docs repository into her personal namespace', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/forks',
    {
      owner: 'alice-dev',
      name: 'acme-docs',
      description: 'My own copy of the docs',
      visibility: 'public',
    },
    aliceCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.repository.owner, 'alice-dev');
  assert.equal(payload.repository.ownerType, 'user');
  assert.equal(payload.repository.name, 'acme-docs');
  assert.equal(payload.repository.visibility, 'public');
  assert.equal(payload.repository.defaultBranch, 'main');
  assert.equal(payload.repository.description, 'My own copy of the docs');
  assert.deepEqual(payload.repository.forkedFrom, {
    owner: 'acme-demo',
    name: 'acme-docs',
  });

  // The fork overview reports the source-repository link.
  const overview = await get('/api/repositories/alice-dev/acme-docs', aliceCookie);
  assert.equal(overview.status, 200);
  const overviewPayload = await overview.json();
  assert.equal(overviewPayload.repository.owner, 'alice-dev');
  assert.deepEqual(overviewPayload.repository.forkedFrom, {
    owner: 'acme-demo',
    name: 'acme-docs',
  });

  // The default branch contains the copied README file and the REQ-4-1
  // seed file src/search.ts.
  const contents = await get('/api/repositories/alice-dev/acme-docs/contents', aliceCookie);
  assert.equal(contents.status, 200);
  const contentsPayload = await contents.json();
  assert.equal(contentsPayload.branch.name, 'main');
  assert.equal(contentsPayload.files.length, 2);
  assert.ok(contentsPayload.files.some((f) => f.path === 'README.md' && f.content.includes('acme-docs')));
  assert.ok(contentsPayload.files.some((f) => f.path === 'src/search.ts'));

  // The accessible history is copied (newest first: the REQ-4-1 seed commit
  // on top of the Initial commit, both by alice-dev).
  const commits = await get('/api/repositories/alice-dev/acme-docs/commits', aliceCookie);
  assert.equal(commits.status, 200);
  const commitsPayload = await commits.json();
  assert.equal(commitsPayload.commits.length, 2);
  assert.equal(commitsPayload.commits[0].message, 'Document search flow');
  assert.equal(commitsPayload.commits[0].author, 'alice-dev');
  assert.equal(commitsPayload.commits[1].message, 'Initial commit');
  assert.equal(commitsPayload.commits[1].author, 'alice-dev');
});

test('the fork is an independent copy: new commit records, source untouched', async () => {
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const source = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const fork = store.findRepositoryByOwnerAndName('alice-dev', 'acme-docs');
  assert.ok(source);
  assert.ok(fork);
  assert.equal(fork.sourceRepositoryId, source.id, 'fork must record the source id');

  const sourceHistory = store.getCommitHistory(source.id, 'main');
  const forkHistory = store.getCommitHistory(fork.id, 'main');
  assert.equal(sourceHistory.length, 2);
  assert.equal(forkHistory.length, 2);
  assert.notEqual(
    forkHistory[0].id,
    sourceHistory[0].id,
    'fork commits must be independent records'
  );
  assert.equal(forkHistory[0].authorId, sourceHistory[0].authorId);
  assert.equal(forkHistory[0].message, sourceHistory[0].message);
  assert.equal(forkHistory[1].authorId, sourceHistory[1].authorId);
  assert.equal(forkHistory[1].message, sourceHistory[1].message);

  const sourceFiles = store.getFilesForBranch(source.id, 'main');
  const forkFiles = store.getFilesForBranch(fork.id, 'main');
  assert.equal(sourceFiles.files.length, 2);
  assert.equal(forkFiles.files.length, 2);
  assert.notEqual(forkFiles.files[0].id, sourceFiles.files[0].id);
  assert.equal(forkFiles.files[0].content, sourceFiles.files[0].content);
});

test('the fork appears in the target personal repository list', async () => {
  const list = await get('/api/repositories?owner=alice-dev', aliceCookie);
  const payload = await list.json();
  assert.ok(payload.repositories.some((r) => r.name === 'acme-docs'));
  assert.ok(payload.repositories.some((r) => r.name === 'acme-docs-fork'));
});

test('a conflicting fork name in the target namespace is rejected and nothing is created', async () => {
  const before = await get('/api/repositories?owner=alice-dev', aliceCookie);
  const beforePayload = await before.json();

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/forks',
    { owner: 'alice-dev', name: 'acme-docs-fork', visibility: 'public' },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.name, 'Repository name already exists');

  const after = await get('/api/repositories?owner=alice-dev', aliceCookie);
  const afterPayload = await after.json();
  assert.deepEqual(
    afterPayload.repositories.map((r) => r.name).sort(),
    beforePayload.repositories.map((r) => r.name).sort()
  );
});

test('an empty fork name is rejected with the required message', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/forks',
    { owner: 'alice-dev', name: '', visibility: 'public' },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.name, 'Repository name is required');
});

test('an organization Owner forks into an organization namespace', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/forks',
    { owner: 'acme-demo', name: 'docs-org-fork', visibility: 'private' },
    aliceCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.repository.owner, 'acme-demo');
  assert.equal(payload.repository.ownerType, 'organization');
  assert.equal(payload.repository.visibility, 'private');
  assert.deepEqual(payload.repository.forkedFrom, {
    owner: 'acme-demo',
    name: 'acme-docs',
  });

  const orgRepos = await get('/api/organizations/acme-demo/repositories', aliceCookie);
  const orgReposPayload = await orgRepos.json();
  assert.ok(orgReposPayload.repositories.some((r) => r.name === 'docs-org-fork'));
});

test('an organization member without Owner permission cannot fork into the organization', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/forks',
    { owner: 'acme-demo', name: 'sneaky-fork', visibility: 'public' },
    bobCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.errors.owner, 'Access denied');

  const orgRepos = await get('/api/organizations/acme-demo/repositories', bobCookie);
  const orgReposPayload = await orgRepos.json();
  assert.ok(!orgReposPayload.repositories.some((r) => r.name === 'sneaky-fork'));
});

test('a user cannot fork into another user namespace', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/forks',
    { owner: 'bob-reviewer', name: 'bobs-fork', visibility: 'public' },
    aliceCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.errors.owner, 'Access denied');
});

test('an unknown target namespace is rejected with Owner not found', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/forks',
    { owner: 'no-such-owner', name: 'some-fork', visibility: 'public' },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.owner, 'Owner not found');
});

test('a source repository without read access cannot be forked', async () => {
  // bob-reviewer has no access to alice-dev's private secret-research.
  const res = await post(
    '/api/repositories/alice-dev/secret-research/forks',
    { owner: 'bob-reviewer', name: 'stolen-research', visibility: 'private' },
    bobCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');

  const list = await get('/api/repositories?owner=bob-reviewer', bobCookie);
  const listPayload = await list.json();
  assert.ok(!listPayload.repositories.some((r) => r.name === 'stolen-research'));
});

test('a private source can only be forked as Private', async () => {
  const res = await post(
    '/api/repositories/alice-dev/secret-research/forks',
    { owner: 'alice-dev', name: 'secret-research-fork', visibility: 'public' },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.visibility, 'Visibility is invalid');
  assert.ok(!payload.errors.name, 'no fork name error for the public request');
});

test('an authorized owner forks a private source as Private with the copied history', async () => {
  const res = await post(
    '/api/repositories/alice-dev/secret-research/forks',
    { owner: 'alice-dev', name: 'secret-research-fork', visibility: 'private' },
    aliceCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.repository.owner, 'alice-dev');
  assert.equal(payload.repository.name, 'secret-research-fork');
  assert.equal(payload.repository.visibility, 'private');
  assert.deepEqual(payload.repository.forkedFrom, {
    owner: 'alice-dev',
    name: 'secret-research',
  });

  // The fork of a private source stays private: bob cannot read it.
  const overview = await get('/api/repositories/alice-dev/secret-research-fork', bobCookie);
  assert.equal(overview.status, 403);
  const contents = await get('/api/repositories/alice-dev/secret-research-fork/contents', bobCookie);
  assert.equal(contents.status, 403);
});

test('fork records and copied history survive a store reload', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const fork = store2.findRepositoryByOwnerAndName('alice-dev', 'acme-docs');
  assert.ok(fork, 'fork must persist');
  assert.equal(fork.visibility, 'public');
  const source = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  assert.equal(fork.sourceRepositoryId, source.id);

  const files = store2.getFilesForBranch(fork.id, 'main');
  assert.equal(files.files.length, 2);
  assert.ok(files.files.some((f) => f.path === 'README.md'));
  assert.ok(files.files.some((f) => f.path === 'src/search.ts'));
  const commits = store2.getCommitHistory(fork.id, 'main');
  assert.equal(commits.length, 2);
  assert.equal(commits[0].message, 'Document search flow');
  assert.equal(commits[1].message, 'Initial commit');
});

test('rejected fork attempts leave the original state unchanged', async () => {
  const beforeSource = await get('/api/repositories/acme-demo/acme-docs/contents');
  const beforeSourcePayload = await beforeSource.json();

  await post(
    '/api/repositories/acme-demo/acme-docs/forks',
    { owner: 'alice-dev', name: 'acme-docs-fork', visibility: 'public' },
    aliceCookie
  );
  await post(
    '/api/repositories/alice-dev/secret-research/forks',
    { owner: 'alice-dev', name: 'secret-research-fork', visibility: 'public' },
    aliceCookie
  );

  const afterSource = await get('/api/repositories/acme-demo/acme-docs/contents');
  const afterSourcePayload = await afterSource.json();
  assert.deepEqual(afterSourcePayload.files, beforeSourcePayload.files);
});
