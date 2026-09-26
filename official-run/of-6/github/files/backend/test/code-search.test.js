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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-code-search-test-'));
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
  const headers = cookie ? { cookie } : undefined;
  return fetch(`${baseUrl}${url}`, { headers });
}

function post(url, body, cookie) {
  return fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('REQ-4-2-3: seed data provides the known query in README.md and in src/ on the default branch', async () => {
  // README.md contains the query as a complete text value.
  const readme = await get('/api/repositories/acme-demo/acme-docs/contents/main/README.md');
  assert.equal(readme.status, 200);
  const readmePayload = await readme.json();
  assert.ok(readmePayload.file.content.includes('Search flow'));

  // The second matching file lives under src/ on the default branch.
  const searchTs = await get('/api/repositories/acme-demo/acme-docs/contents/main/src/search.ts');
  assert.equal(searchTs.status, 200);
  const searchTsPayload = await searchTs.json();
  assert.ok(searchTsPayload.file.content.includes('Search flow'));
});

test('REQ-4-2-3: the seeded unauthorized private repository contains the term but stays denied for visitors', async () => {
  // A visitor cannot browse the private repository at all.
  const denied = await get('/api/repositories/acme-demo/acme-internal/contents');
  assert.equal(denied.status, 403);
  const deniedPayload = await denied.json();
  assert.equal(deniedPayload.error, 'Access denied');

  // alice (organization Owner) can read it, and its content contains the term.
  const signin = await post('/api/auth/signin', {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  assert.equal(signin.status, 200);
  const aliceCookie = signin.headers.get('set-cookie').split(';')[0];
  const internal = await get(
    '/api/repositories/acme-demo/acme-internal/contents',
    aliceCookie
  );
  assert.equal(internal.status, 200);
  const internalPayload = await internal.json();
  assert.ok(
    internalPayload.files.some(
      (f) => f.path === 'README.md' && f.content.includes('Search flow')
    ),
    'acme-internal must contain the searchable term'
  );
});

test('REQ-4-2-3: repository code search returns matching files with snippets, paths, and branch context', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/search?q=search%20flow');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.repository.owner, 'acme-demo');
  assert.equal(payload.repository.name, 'acme-docs');
  assert.equal(payload.branch.name, 'main');
  assert.equal(payload.query, 'search flow');
  assert.deepEqual(
    payload.results.map((r) => r.path),
    ['README.md', 'src/search.ts']
  );
  const readme = payload.results.find((r) => r.path === 'README.md');
  assert.equal(readme.name, 'README.md');
  assert.ok(readme.snippet.includes('Search flow'), 'snippet shows the matched text');
  assert.equal(typeof readme.line, 'number');
  assert.ok(readme.line >= 1);
  assert.equal(readme.branch, 'main');
  const searchTs = payload.results.find((r) => r.path === 'src/search.ts');
  assert.equal(searchTs.name, 'search.ts');
  assert.ok(searchTs.snippet.includes('Search flow'));
  // The language filter options are derived from the repository files.
  assert.ok(payload.languages.includes('Markdown'));
  assert.ok(payload.languages.includes('TypeScript'));
});

test('REQ-4-2-3: the path filter limits results to files under that directory', async () => {
  const res = await get(
    '/api/repositories/acme-demo/acme-docs/search?q=search%20flow&path=src/'
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.path, 'src/');
  assert.deepEqual(
    payload.results.map((r) => r.path),
    ['src/search.ts']
  );
});

test('REQ-4-2-3: the language filter limits results by file extension', async () => {
  const ts = await get(
    '/api/repositories/acme-demo/acme-docs/search?q=search%20flow&lang=TypeScript'
  );
  assert.equal(ts.status, 200);
  assert.deepEqual((await ts.json()).results.map((r) => r.path), ['src/search.ts']);

  const md = await get(
    '/api/repositories/acme-demo/acme-docs/search?q=search%20flow&lang=Markdown'
  );
  assert.equal(md.status, 200);
  assert.deepEqual((await md.json()).results.map((r) => r.path), ['README.md']);
});

test('REQ-4-2-3: an absent query yields no code results', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/search?q=no-such-token');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.query, 'no-such-token');
  assert.deepEqual(payload.results, []);
});

test('REQ-4-2-3: an unfiltered search opens a result whose exact name is the matching file name', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/search?q=search%20flow');
  const payload = await res.json();
  const readme = payload.results.find((r) => r.path === 'README.md');
  assert.equal(readme.name, 'README.md');
  const searchTs = payload.results.find((r) => r.path === 'src/search.ts');
  assert.equal(searchTs.name, 'search.ts');
});

test('REQ-4-2-3: search is read-only and never creates commits or changes files', async () => {
  const before = await get('/api/repositories/acme-demo/acme-docs/commits');
  const beforePayload = await before.json();
  const beforeReadme = await get(
    '/api/repositories/acme-demo/acme-docs/contents/main/README.md'
  );
  const beforeReadmePayload = await beforeReadme.json();

  const res = await get(
    '/api/repositories/acme-demo/acme-docs/search?q=search%20flow&path=src/'
  );
  assert.equal(res.status, 200);
  await get('/api/repositories/acme-demo/acme-docs/search?q=no-such-token');

  const after = await get('/api/repositories/acme-demo/acme-docs/commits');
  const afterPayload = await after.json();
  assert.equal(afterPayload.commits.length, beforePayload.commits.length);
  const afterReadme = await get(
    '/api/repositories/acme-demo/acme-docs/contents/main/README.md'
  );
  const afterReadmePayload = await afterReadme.json();
  assert.equal(afterReadmePayload.file.content, beforeReadmePayload.file.content);
});

test('REQ-4-2-3: an unauthorized private repository is never searched (403) and leaks no content', async () => {
  const res = await get('/api/repositories/acme-demo/acme-internal/search?q=search%20flow');
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');
});

test('REQ-4-2-3: a signed-in authorized account can search a private repository', async () => {
  const signin = await post('/api/auth/signin', {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  assert.equal(signin.status, 200);
  const aliceCookie = signin.headers.get('set-cookie').split(';')[0];

  const res = await get(
    '/api/repositories/acme-demo/acme-internal/search?q=search%20flow',
    aliceCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.repository.name, 'acme-internal');
  assert.ok(payload.results.length >= 1);
  const readme = payload.results.find((r) => r.path === 'README.md');
  assert.ok(readme && readme.snippet.includes('Search flow'));
});

test('REQ-4-2-3: unknown repositories return 404 for code search', async () => {
  const res = await get('/api/repositories/acme-demo/no-such-repo/search?q=search%20flow');
  assert.equal(res.status, 404);
  const payload = await res.json();
  assert.equal(payload.error, 'Repository not found');
});

test('REQ-4-2-3: an empty query yields no code results', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/search?q=');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.results, []);
});
