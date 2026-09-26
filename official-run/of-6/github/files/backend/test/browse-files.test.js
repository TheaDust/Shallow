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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-browse-files-test-'));
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

test('REQ-4-1: the default branch root lists the seeded directory and file as exact-name entries', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/contents');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.branch.name, 'main');
  assert.ok(payload.entries.length >= 2, 'root must list the nested directory and the README');
  const names = payload.entries.map((e) => e.name);
  assert.ok(names.includes('README.md'));
  assert.ok(names.includes('src'));
  const src = payload.entries.find((e) => e.name === 'src');
  assert.equal(src.type, 'directory');
  assert.equal(src.path, 'src');
  const readme = payload.entries.find((e) => e.name === 'README.md');
  assert.equal(readme.type, 'file');
  // Directories sort before files.
  assert.equal(payload.entries[0].name, 'src');
});

test('REQ-4-1: the tree endpoint lists the branch root and the nested directory', async () => {
  const root = await get('/api/repositories/acme-demo/acme-docs/tree/main');
  assert.equal(root.status, 200);
  const rootPayload = await root.json();
  assert.equal(rootPayload.branch.name, 'main');
  assert.equal(rootPayload.path, '');
  assert.ok(rootPayload.entries.some((e) => e.name === 'src' && e.type === 'directory'));

  const nested = await get('/api/repositories/acme-demo/acme-docs/tree/main/src');
  assert.equal(nested.status, 200);
  const nestedPayload = await nested.json();
  assert.equal(nestedPayload.path, 'src');
  assert.deepEqual(
    nestedPayload.entries.map((e) => ({ name: e.name, type: e.type })),
    [{ name: 'search.ts', type: 'file' }]
  );
  assert.equal(nestedPayload.entries[0].path, 'src/search.ts');
});

test('REQ-4-1: the file page endpoint returns the saved content and the most recent commit', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/contents/main/src/search.ts');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.branch, 'main');
  assert.equal(payload.file.path, 'src/search.ts');
  assert.ok(payload.file.content.includes('Search flow'));
  assert.equal(payload.commit.message, 'Document search flow');
  assert.equal(payload.commit.author, 'alice-dev');
  assert.equal(typeof payload.commit.createdAt, 'string');
});

test('REQ-4-1: a branch without the file does not display it', async () => {
  const fileRes = await get(
    '/api/repositories/acme-demo/acme-docs/contents/feature-search/src/search.ts'
  );
  assert.equal(fileRes.status, 404);
  const filePayload = await fileRes.json();
  assert.equal(filePayload.error, 'File not found');

  const treeRes = await get('/api/repositories/acme-demo/acme-docs/tree/feature-search');
  assert.equal(treeRes.status, 200);
  const treePayload = await treeRes.json();
  assert.ok(!treePayload.entries.some((e) => e.name === 'src'));
  assert.ok(!treePayload.entries.some((e) => e.name === 'search.ts'));
  assert.ok(treePayload.entries.some((e) => e.name === 'README.md'));

  const contentsRes = await get('/api/repositories/acme-demo/acme-docs/contents?branch=feature-search');
  assert.equal(contentsRes.status, 200);
  const contentsPayload = await contentsRes.json();
  assert.equal(contentsPayload.branch.name, 'feature-search');
  assert.deepEqual(
    contentsPayload.files.map((f) => f.path),
    ['README.md', 'main-only.md']
  );
});

test('REQ-4-1: an unknown directory path returns 404 without crashing', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/tree/main/no-such-dir');
  assert.equal(res.status, 404);
  const payload = await res.json();
  assert.equal(payload.error, 'Path not found');
});

test('REQ-4-1: unauthorized private repositories cannot be browsed', async () => {
  const res = await get('/api/repositories/alice-dev/secret-research/tree/main');
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');
});
