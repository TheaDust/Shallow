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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-repo-visibility-test-'));
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

test('secret-research starts private: the owner sees it, a visitor is denied, and it contains public-ready content', async () => {
  const ownerView = await get('/api/repositories/alice-dev/secret-research', ownerCookie);
  assert.equal(ownerView.status, 200);
  const ownerPayload = await ownerView.json();
  assert.equal(ownerPayload.repository.visibility, 'private');
  assert.equal(ownerPayload.repository.role, 'admin');

  const visitorView = await get('/api/repositories/alice-dev/secret-research');
  assert.equal(visitorView.status, 403);

  // REQ-3-4 seed: the private repository contains files and a description
  // suitable for public display.
  const contents = await get('/api/repositories/alice-dev/secret-research/contents', ownerCookie);
  assert.equal(contents.status, 200);
  const contentPayload = await contents.json();
  assert.equal(contentPayload.branch.name, 'main');
  assert.ok(contentPayload.files.some((f) => f.path === 'README.md'));
  assert.ok(ownerPayload.repository.description.length > 0);
});

test('changing visibility requires authentication', async () => {
  const res = await patch(
    '/api/repositories/alice-dev/secret-research/visibility',
    { visibility: 'public' }
  );
  assert.equal(res.status, 401);
});

test('a non-Admin collaborator cannot change visibility', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/visibility',
    { visibility: 'private' },
    memberCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');

  // The repository is unchanged.
  const view = await get('/api/repositories/acme-demo/acme-docs');
  assert.equal((await view.json()).repository.visibility, 'public');
});

test('a mismatched confirmation text blocks the change and visibility stays Private', async () => {
  const res = await patch(
    '/api/repositories/alice-dev/secret-research/visibility',
    { visibility: 'public', confirmation: 'wrong-name' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.confirmation, 'Repository name does not match');

  const view = await get('/api/repositories/alice-dev/secret-research', ownerCookie);
  assert.equal((await view.json()).repository.visibility, 'private');
});

test('an invalid visibility value is rejected', async () => {
  const res = await patch(
    '/api/repositories/alice-dev/secret-research/visibility',
    { visibility: 'internal' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.visibility, 'Visibility is invalid');
});

test('an Admin changes a private repository to Public and a visitor can then read it', async () => {
  const res = await patch(
    '/api/repositories/alice-dev/secret-research/visibility',
    { visibility: 'public', confirmation: 'secret-research' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.repository.visibility, 'public');
  assert.equal(payload.repository.owner, 'alice-dev');
  assert.equal(payload.repository.name, 'secret-research');

  // The unauthenticated visitor can now open the same address and read the
  // repository content (heading data, files, commits).
  const visitorView = await get('/api/repositories/alice-dev/secret-research');
  assert.equal(visitorView.status, 200);
  const visitorPayload = await visitorView.json();
  assert.equal(visitorPayload.repository.visibility, 'public');

  const contents = await get('/api/repositories/alice-dev/secret-research/contents');
  assert.equal(contents.status, 200);
  const contentPayload = await contents.json();
  assert.ok(contentPayload.files.some((f) => f.path === 'README.md'));

  const commits = await get('/api/repositories/alice-dev/secret-research/commits');
  assert.equal(commits.status, 200);
  assert.equal((await commits.json()).commits.length, 1);
});

test('search and repository lists expose the repository under the public-access rule', async () => {
  const search = await get('/api/search/repositories?q=secret-research');
  assert.equal(search.status, 200);
  const searchPayload = await search.json();
  const found = searchPayload.repositories.find(
    (r) => r.owner === 'alice-dev' && r.name === 'secret-research'
  );
  assert.ok(found, 'search must expose the now-public repository to visitors');
  assert.equal(found.visibility, 'public');

  const list = await get('/api/repositories?owner=alice-dev');
  assert.equal(list.status, 200);
  const listPayload = await list.json();
  const listed = listPayload.repositories.find((r) => r.name === 'secret-research');
  assert.ok(listed, 'the personal repository list must show the public repository');
  assert.equal(listed.visibility, 'public');
});

test('the new visibility is persisted across a store reload', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const repo = store2.findRepositoryByOwnerAndName('alice-dev', 'secret-research');
  assert.ok(repo);
  assert.equal(repo.visibility, 'public');
  const files = store2.getFilesForBranch(repo.id, 'main');
  assert.equal(files.files.length, 1, 'the seeded content survives the reload');
});

test('an Admin can change visibility back to Private; a visitor is denied again', async () => {
  const res = await patch(
    '/api/repositories/alice-dev/secret-research/visibility',
    { visibility: 'private', confirmation: 'alice-dev/secret-research' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.repository.visibility, 'private');

  const visitorView = await get('/api/repositories/alice-dev/secret-research');
  assert.equal(visitorView.status, 403);

  const search = await get('/api/search/repositories?q=secret-research');
  const searchPayload = await search.json();
  assert.ok(
    !searchPayload.repositories.some((r) => r.name === 'secret-research'),
    'private repositories disappear from visitor search again'
  );
});
