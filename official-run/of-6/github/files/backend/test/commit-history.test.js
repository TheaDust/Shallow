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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-commit-history-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function get(url) {
  return fetch(`${baseUrl}${url}`);
}

test('REQ-4-2-1: the branch history lists commits newest first with short hash, message, author, time, parents and changed files', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/commits');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.branch.name, 'main');
  assert.equal(payload.commits.length, 2);

  const [newest, oldest] = payload.commits;
  assert.equal(newest.message, 'Document search flow');
  assert.equal(newest.author, 'alice-dev');
  assert.equal(typeof newest.shortId, 'string');
  assert.equal(newest.shortId.length, 7);
  assert.equal(typeof newest.createdAt, 'string');
  // Every record references its parent commit and changed files.
  assert.equal(newest.parents.length, 1);
  assert.equal(newest.parents[0].shortId.length, 7);
  assert.equal(newest.parents[0].message, 'Initial commit');
  assert.deepEqual([...newest.files].sort(), ['README.md', 'src/search.ts']);

  assert.equal(oldest.message, 'Initial commit');
  assert.equal(oldest.author, 'alice-dev');
  assert.deepEqual(oldest.parents, []);
  assert.deepEqual(oldest.files, ['README.md']);

  // Seed history uses past timestamps so the relative time contains "ago",
  // and the newer commit carries the later timestamp.
  const now = Date.now();
  for (const commit of payload.commits) {
    assert.ok(
      new Date(commit.createdAt).getTime() < now - 24 * 60 * 60 * 1000,
      `seed commit ${commit.message} must be at least a day in the past`
    );
  }
  assert.ok(
    new Date(payload.commits[0].createdAt).getTime() >
      new Date(payload.commits[1].createdAt).getTime(),
    'the newest commit has the later timestamp'
  );
});

test('REQ-4-2-1: the file-scoped history only displays commits that modified the file', async () => {
  // README.md is present in the snapshots of both seeded commits.
  const readme = await get(
    '/api/repositories/acme-demo/acme-docs/commits?branch=main&path=README.md'
  );
  assert.equal(readme.status, 200);
  const readmePayload = await readme.json();
  assert.deepEqual(
    readmePayload.commits.map((c) => c.message),
    ['Document search flow', 'Initial commit']
  );

  // src/search.ts was added by the later commit only.
  const search = await get(
    '/api/repositories/acme-demo/acme-docs/commits?branch=main&path=src%2Fsearch.ts'
  );
  assert.equal(search.status, 200);
  const searchPayload = await search.json();
  assert.deepEqual(searchPayload.commits.map((c) => c.message), [
    'Document search flow',
  ]);

  // A branch whose history does not contain the file yields no commits for it.
  const feature = await get(
    '/api/repositories/acme-demo/acme-docs/commits?branch=feature-search&path=src%2Fsearch.ts'
  );
  assert.equal(feature.status, 200);
  const featurePayload = await feature.json();
  assert.deepEqual(featurePayload.commits, []);
  assert.equal(featurePayload.branch.name, 'feature-search');
});

test('REQ-4-2-1: the commit detail exposes the parent revision and changed files', async () => {
  const list = await get('/api/repositories/acme-demo/acme-docs/commits');
  const newest = (await list.json()).commits[0];

  const res = await get(
    `/api/repositories/acme-demo/acme-docs/commits/${newest.id}`
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.commit.message, 'Document search flow');
  assert.equal(payload.commit.shortId, newest.shortId);
  assert.equal(payload.commit.author, 'alice-dev');
  assert.equal(payload.commit.parents.length, 1);
  assert.equal(payload.commit.parents[0].id, newest.parents[0].id);
  assert.equal(payload.commit.parents[0].message, 'Initial commit');

  const paths = payload.commit.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['README.md', 'src/search.ts']);
  const searchTs = payload.commit.files.find((f) => f.path === 'src/search.ts');
  assert.ok(searchTs.content.includes('Search flow'));
});

test('REQ-4-2-1: the root commit has no parent and unknown commits are 404', async () => {
  const list = await get('/api/repositories/acme-demo/acme-docs/commits');
  const oldest = (await list.json()).commits[1];

  const res = await get(
    `/api/repositories/acme-demo/acme-docs/commits/${oldest.id}`
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.commit.message, 'Initial commit');
  assert.deepEqual(payload.commit.parents, []);
  assert.deepEqual(payload.commit.files.map((f) => f.path), ['README.md']);

  const missing = await get(
    '/api/repositories/acme-demo/acme-docs/commits/does-not-exist'
  );
  assert.equal(missing.status, 404);
  const missingPayload = await missing.json();
  assert.equal(missingPayload.error, 'Commit not found');
});

test('REQ-4-2-1: a commit of another repository is not reachable under this repository', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const secret = store2.findRepositoryByOwnerAndName('alice-dev', 'secret-research');
  assert.ok(secret, 'secret-research must be seeded');
  const secretCommit = store2.getCommitHistory(secret.id, 'main')[0];
  assert.ok(secretCommit, 'secret-research must carry an initial commit');

  const res = await get(
    `/api/repositories/acme-demo/acme-docs/commits/${secretCommit.id}`
  );
  assert.equal(res.status, 404);
});

test('REQ-4-2-1: commit history and detail follow repository visibility', async () => {
  const history = await get('/api/repositories/alice-dev/secret-research/commits');
  assert.equal(history.status, 403);
  const detail = await get(
    '/api/repositories/alice-dev/secret-research/commits/any-id'
  );
  assert.equal(detail.status, 403);
});
