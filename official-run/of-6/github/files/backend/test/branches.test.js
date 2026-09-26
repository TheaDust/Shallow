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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-branches-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function get(url, cookie) {
  return fetch(`${baseUrl}${url}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test('REQ-4-3-1: the branch endpoint lists the default branch first and all branch names', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/branches');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.defaultBranch, 'main');
  assert.deepEqual(
    payload.branches.map((b) => b.name),
    // REQ-4-3-3: the seeded acme-docs repository also carries a release
    // branch (scenario 1 changes the default branch from main to release).
    // REQ-6-2-4: the ready-for-review seed PR needs the draft-feature branch.
    // REQ-6-3-3: the pending-comment seed PR needs the pending-review branch.
    ['main', 'draft-feature', 'feature-search', 'pending-review', 'release']
  );
  for (const branch of payload.branches) {
    assert.equal(typeof branch.name, 'string');
    assert.equal(typeof branch.headCommitId, 'string');
  }
});

test('REQ-4-3-1: feature-search contains main-only.md which is absent from main', async () => {
  const feature = await get(
    '/api/repositories/acme-demo/acme-docs/contents?branch=feature-search'
  );
  assert.equal(feature.status, 200);
  const featurePayload = await feature.json();
  const featurePaths = featurePayload.files.map((f) => f.path);
  assert.ok(featurePaths.includes('main-only.md'));
  assert.ok(featurePaths.includes('README.md'));

  const main = await get('/api/repositories/acme-demo/acme-docs/contents');
  assert.equal(main.status, 200);
  const mainPayload = await main.json();
  assert.ok(
    !mainPayload.files.some((f) => f.path === 'main-only.md'),
    'main-only.md must be absent from main'
  );
  // The two branches differ in the content of README.md.
  const featureReadme = featurePayload.files.find((f) => f.path === 'README.md');
  const mainReadme = mainPayload.files.find((f) => f.path === 'README.md');
  assert.notEqual(featureReadme.content, mainReadme.content);
});

test('REQ-4-3-1: listing branches is read-only and never changes branch heads', async () => {
  const { createStore } = require('../src/store');
  const store1 = createStore(dataDir);
  const repo = store1.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const beforeMain = store1.findBranchByRepositoryAndName(repo.id, 'main');
  const beforeFeature = store1.findBranchByRepositoryAndName(repo.id, 'feature-search');

  const res = await get('/api/repositories/acme-demo/acme-docs/branches');
  assert.equal(res.status, 200);

  const store2 = createStore(dataDir);
  const afterMain = store2.findBranchByRepositoryAndName(repo.id, 'main');
  const afterFeature = store2.findBranchByRepositoryAndName(repo.id, 'feature-search');
  assert.equal(afterMain.headCommitId, beforeMain.headCommitId);
  assert.equal(afterFeature.headCommitId, beforeFeature.headCommitId);
  // The seeded state is idempotent: a reload does not duplicate the
  // main-only.md commit or change the feature-search head.
  const featureFiles = store2.getFilesForBranch(repo.id, 'feature-search');
  assert.deepEqual(
    featureFiles.files.map((f) => f.path),
    ['README.md', 'main-only.md']
  );
  assert.equal(store2.getCommitHistory(repo.id, 'feature-search').length, 2);
});

test('REQ-4-3-1: an unauthorized private repository cannot list branches', async () => {
  const res = await get('/api/repositories/alice-dev/secret-research/branches');
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');
});
