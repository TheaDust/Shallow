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
let sessionCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-org-create-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice-dev', password: 'Valid-password-123!' }),
  });
  assert.equal(signin.status, 200);
  sessionCookie = signin.headers.get('set-cookie').split(';')[0];
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

test('creating an organization requires authentication', async () => {
  const res = await post('/api/organizations', {
    name: 'mobile-guild',
    displayName: 'Mobile Guild',
  });
  assert.equal(res.status, 401);
});

test('a signed-in user creates a unique organization and becomes its Owner', async () => {
  const res = await post(
    '/api/organizations',
    { name: 'mobile-guild', displayName: 'Mobile Guild' },
    sessionCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.organization.name, 'mobile-guild');
  assert.equal(payload.organization.displayName, 'Mobile Guild');
  assert.equal(typeof payload.organization.createdAt, 'string');

  // The overview is reachable with the identifier heading data.
  const overview = await get('/api/organizations/mobile-guild');
  assert.equal(overview.status, 200);
  const overviewPayload = await overview.json();
  assert.equal(overviewPayload.organization.name, 'mobile-guild');
  assert.equal(overviewPayload.organization.displayName, 'Mobile Guild');

  // The creator is shown as Owner on People and the org appears in the list.
  const people = await get('/api/organizations/mobile-guild/people', sessionCookie);
  const peoplePayload = await people.json();
  const alice = peoplePayload.members.find((m) => m.username === 'alice-dev');
  assert.ok(alice, 'creator must be listed as a member');
  assert.equal(alice.role, 'owner');

  const list = await get('/api/organizations', sessionCookie);
  const listPayload = await list.json();
  assert.ok(listPayload.organizations.some((o) => o.name === 'mobile-guild'));
  assert.ok(listPayload.organizations.some((o) => o.name === 'acme-demo'));
});

test('a duplicate identifier reports the conflict even when the display name is missing', async () => {
  const res = await post(
    '/api/organizations',
    { name: 'acme-demo', displayName: '' },
    sessionCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.errors.name, 'Organization name already exists');
  assert.equal(payload.errors.displayName, 'Display name is required');

  // No second organization object was created.
  const list = await get('/api/organizations', sessionCookie);
  const listPayload = await list.json();
  const matches = listPayload.organizations.filter((o) => o.name === 'acme-demo');
  assert.equal(matches.length, 1);
});

test('a malformed identifier is rejected with the format message', async () => {
  const res = await post(
    '/api/organizations',
    { name: '-invalid-organization', displayName: 'Whatever' },
    sessionCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.name, 'Organization name format is invalid');
});

test('uppercase, underscore and empty identifiers are rejected as malformed', async () => {
  for (const name of ['MobileGuild', 'mobile_guild', '', 'mobile-guild-', '-mobile']) {
    const res = await post(
      '/api/organizations',
      { name, displayName: 'Mobile Guild' },
      sessionCookie
    );
    assert.equal(res.status, 400);
    const payload = await res.json();
    assert.equal(payload.errors.name, 'Organization name format is invalid');
  }
});

test('a whitespace-only display name is rejected with the required message', async () => {
  const res = await post(
    '/api/organizations',
    { name: 'mobile-tools', displayName: '   ' },
    sessionCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.displayName, 'Display name is required');
  assert.equal(payload.errors.name, undefined);

  const overview = await get('/api/organizations/mobile-tools');
  assert.equal(overview.status, 404);
});

test('a display name longer than 100 characters is rejected', async () => {
  const res = await post(
    '/api/organizations',
    { name: 'mobile-tools', displayName: 'x'.repeat(101) },
    sessionCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.displayName, 'Display name is too long');
});

test('display name surrounding whitespace is trimmed before storage', async () => {
  const res = await post(
    '/api/organizations',
    { name: 'mobile-lab', displayName: '  Mobile Lab  ' },
    sessionCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.organization.displayName, 'Mobile Lab');
});

test('rejected attempts leave the original state unchanged (no partial creation)', async () => {
  const before = await get('/api/organizations', sessionCookie);
  const beforePayload = await before.json();

  await post('/api/organizations', { name: 'acme-demo', displayName: '' }, sessionCookie);
  await post('/api/organizations', { name: '-invalid-organization', displayName: '' }, sessionCookie);
  await post('/api/organizations', { name: 'mobile-x', displayName: '   ' }, sessionCookie);

  const after = await get('/api/organizations', sessionCookie);
  const afterPayload = await after.json();
  assert.deepEqual(
    afterPayload.organizations.map((o) => o.name).sort(),
    beforePayload.organizations.map((o) => o.name).sort()
  );
});

test('created organization and owner membership survive a store reload', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const org = store2.findOrganizationByName('mobile-guild');
  assert.ok(org, 'organization must persist');
  assert.equal(org.displayName, 'Mobile Guild');
  const members = store2.getOrganizationMembers(org.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].role, 'owner');
  const alice = store2.findAccountByUsername('alice-dev');
  assert.equal(members[0].accountId, alice.id);
});
