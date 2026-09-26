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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-repo-overview-test-'));
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

test('a visitor can read the seeded public repository overview without sign-in', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.repository.owner, 'acme-demo');
  assert.equal(payload.repository.ownerType, 'organization');
  assert.equal(payload.repository.name, 'acme-docs');
  assert.equal(payload.repository.visibility, 'public');
  assert.equal(payload.repository.description, 'Documentation for the Acme platform');
  assert.equal(payload.repository.defaultBranch, 'main');
  assert.equal(typeof payload.repository.updatedAt, 'string');
});

test('the seeded public repository has a default branch with at least one file', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/contents');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.branch.name, 'main');
  assert.ok(payload.files.length >= 1, 'acme-docs must contain at least one file');
  const readme = payload.files.find((f) => f.path === 'README.md');
  assert.ok(readme, 'README.md must be listed');
  assert.ok(readme.content.includes('acme-docs'));
});

test('a visitor can open the file-content endpoint of the seeded README', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/contents/main/README.md');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.branch, 'main');
  assert.equal(payload.file.path, 'README.md');
  assert.ok(payload.file.content.includes('Documentation for the Acme platform'));
});

test('the seeded repository commit history contains the REQ-4-1 seed commits', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/commits');
  assert.equal(res.status, 200);
  const payload = await res.json();
  // REQ-4-1 seed: main carries "Document search flow" (newest) on top of the
  // REQ-3-3 "Initial commit" (oldest), both authored by alice-dev.
  assert.equal(payload.commits.length, 2);
  assert.equal(payload.commits[0].message, 'Document search flow');
  assert.equal(payload.commits[0].author, 'alice-dev');
  assert.equal(payload.commits[1].message, 'Initial commit');
  assert.equal(payload.commits[1].author, 'alice-dev');
});

test('a visitor without authorization cannot read the private repository content', async () => {
  const overview = await get('/api/repositories/alice-dev/secret-research');
  assert.equal(overview.status, 403);
  const payload = await overview.json();
  assert.equal(payload.error, 'Access denied');

  const contents = await get('/api/repositories/alice-dev/secret-research/contents');
  assert.equal(contents.status, 403);
});

test('the seeded repository content survives a store reload', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const repo = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  assert.ok(repo, 'acme-docs must persist');
  const files = store2.getFilesForBranch(repo.id, 'main');
  assert.equal(files.branch.name, 'main');
  // REQ-4-1 seed: README.md plus the nested src/search.ts file.
  assert.equal(files.files.length, 2);
  assert.ok(files.files.some((f) => f.path === 'README.md'));
  assert.ok(files.files.some((f) => f.path === 'src/search.ts'));
  const commits = store2.getCommitHistory(repo.id, 'main');
  assert.equal(commits.length, 2);
  assert.equal(commits[0].message, 'Document search flow');
  assert.equal(commits[1].message, 'Initial commit');
});

test('an older store without repository content is backfilled idempotently', async () => {
  // Simulate a store written before the REQ-3-3 seed: repositories exist but
  // the branches/commits/files arrays are empty. Reloading the store must
  // provision the main branch + README for acme-docs, then the REQ-4-1 seed
  // (Document search flow commit + src/search.ts + feature-search branch),
  // and a second reload must not duplicate records.
  const dataFile = path.join(dataDir, 'data.json');
  const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  raw.branches = [];
  raw.commits = [];
  raw.commitFiles = [];
  fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2), 'utf8');

  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const repo = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  assert.ok(repo, 'acme-docs must persist');
  const first = store2.getFilesForBranch(repo.id, 'main');
  assert.equal(first.branch.name, 'main');
  assert.equal(first.files.length, 2);
  assert.ok(first.files.some((f) => f.path === 'README.md'));
  assert.ok(first.files.some((f) => f.path === 'src/search.ts'));
  const feature = store2.findBranchByRepositoryAndName(repo.id, 'feature-search');
  assert.ok(feature, 'feature-search branch must be seeded');

  const store3 = createStore(dataDir);
  const second = store3.getFilesForBranch(repo.id, 'main');
  assert.equal(second.files.length, 2, 'backfill must not duplicate records');
  assert.equal(store3.getCommitHistory(repo.id, 'main').length, 2);
  assert.ok(store3.findBranchByRepositoryAndName(repo.id, 'feature-search'));
});
