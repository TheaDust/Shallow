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

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-repo-search-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice-dev', password: 'Valid-password-123!' }),
  });
  assert.equal(res.status, 200);
  ownerCookie = res.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function search(query, cookie) {
  return fetch(`${baseUrl}/api/search/repositories?q=${encodeURIComponent(query)}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function names(payload) {
  return payload.repositories.map((r) => `${r.owner}/${r.name}`);
}

test('a visitor sees only the public matching repository', async () => {
  const res = await search('acme');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(names(payload), ['acme-demo/acme-docs']);
  const docs = payload.repositories[0];
  assert.equal(docs.name, 'acme-docs');
  assert.equal(docs.owner, 'acme-demo');
  assert.equal(docs.ownerType, 'organization');
  assert.equal(docs.visibility, 'public');
  assert.equal(docs.description, 'Documentation for the Acme platform');
  assert.equal(typeof docs.updatedAt, 'string');
});

test('searching the private repository name exposes no result link for a visitor', async () => {
  const res = await search('secret-research');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.repositories, []);
});

test('searching by the private keyword exposes nothing for a visitor', async () => {
  const res = await search('secret');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.repositories, []);
});

test('an empty query returns no results', async () => {
  const res = await search('');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.repositories, []);
});

test('an authorized Owner sees their private repositories in search results', async () => {
  const res = await search('secret', ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(names(payload), ['alice-dev/secret-research']);
  const repo = payload.repositories[0];
  assert.equal(repo.ownerType, 'user');
  assert.equal(repo.visibility, 'private');
});

test('an Owner sees both public and private organization repositories and their private personal seeds', async () => {
  const res = await search('acme', ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  // REQ-3-2-2: the fork-conflict seed acme-docs-fork is a private personal
  // repository of alice-dev, so the Owner's "acme" search includes it.
  assert.deepEqual(names(payload), [
    'acme-demo/acme-docs',
    'alice-dev/acme-docs-fork',
    'acme-demo/acme-internal',
  ]);
});

test('search matches the full owner/name address for authorized users', async () => {
  const res = await search('alice-dev/secret-research', ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(names(payload), ['alice-dev/secret-research']);
});

test('search results are filtered on the server, not by the client', async () => {
  // A signed-in account without access (bob-reviewer) must not find
  // alice-dev's private personal repository.
  const signin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'bob-reviewer', password: 'Valid-password-123!' }),
  });
  assert.equal(signin.status, 200);
  const bobCookie = signin.headers.get('set-cookie').split(';')[0];
  const res = await search('secret', bobCookie);
  const payload = await res.json();
  assert.deepEqual(payload.repositories, []);
});
