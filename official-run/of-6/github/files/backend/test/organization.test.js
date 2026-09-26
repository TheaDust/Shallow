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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-org-test-'));
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

function get(url, cookie) {
  return fetch(`${baseUrl}${url}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test('seed provisions organization Acme Demo with owner, member, team and repositories', async () => {
  const res = await get('/api/organizations/acme-demo');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.organization.name, 'acme-demo');
  assert.equal(payload.organization.displayName, 'Acme Demo');

  const peopleRes = await get('/api/organizations/acme-demo/people');
  const people = await peopleRes.json();
  const usernames = people.members.map((m) => m.username);
  assert.ok(usernames.includes('alice-dev'));
  assert.ok(usernames.includes('bob-reviewer'));
  assert.equal(
    people.members.find((m) => m.username === 'alice-dev').role,
    'owner'
  );
  assert.equal(
    people.members.find((m) => m.username === 'bob-reviewer').role,
    'member'
  );

  const teamsRes = await get('/api/organizations/acme-demo/teams');
  const teams = await teamsRes.json();
  assert.ok(teams.teams.some((t) => t.name === 'frontend-team'));
});

test('visitor sees only the public repository on the organization Repositories view', async () => {
  const res = await get('/api/organizations/acme-demo/repositories');
  assert.equal(res.status, 200);
  const payload = await res.json();
  const names = payload.repositories.map((r) => r.name);
  assert.ok(names.includes('acme-docs'));
  assert.ok(!names.includes('acme-internal'), 'private repo must be hidden from visitors');
  const docs = payload.repositories.find((r) => r.name === 'acme-docs');
  assert.equal(docs.visibility, 'public');
  assert.equal(typeof docs.description, 'string');
  assert.equal(typeof docs.updatedAt, 'string');
});

test('organization Owner (signed in) sees both the public and the private repository', async () => {
  const res = await get('/api/organizations/acme-demo/repositories', sessionCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  const names = payload.repositories.map((r) => r.name);
  assert.ok(names.includes('acme-docs'));
  assert.ok(names.includes('acme-internal'));
  assert.equal(
    payload.repositories.find((r) => r.name === 'acme-internal').visibility,
    'private'
  );
});

test('a signed-in plain member sees only the public repository', async () => {
  const signin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'bob-reviewer', password: 'Valid-password-123!' }),
  });
  assert.equal(signin.status, 200);
  const memberCookie = signin.headers.get('set-cookie').split(';')[0];

  const res = await get('/api/organizations/acme-demo/repositories', memberCookie);
  const payload = await res.json();
  const names = payload.repositories.map((r) => r.name);
  assert.ok(names.includes('acme-docs'));
  assert.ok(!names.includes('acme-internal'));
});

test('the public repository overview is open to visitors with the owner/name heading data', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.repository.owner, 'acme-demo');
  assert.equal(payload.repository.name, 'acme-docs');
  assert.equal(payload.repository.visibility, 'public');
  assert.equal(payload.repository.defaultBranch, 'main');
});

test('a visitor opening the private repository directly is denied access', async () => {
  const res = await get('/api/repositories/acme-demo/acme-internal');
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');
});

test('the organization Owner can open the private repository overview', async () => {
  const res = await get('/api/repositories/acme-demo/acme-internal', sessionCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.repository.owner, 'acme-demo');
  assert.equal(payload.repository.name, 'acme-internal');
  assert.equal(payload.repository.visibility, 'private');
});

test('unknown organization and repository return 404', async () => {
  assert.equal((await get('/api/organizations/no-such-org')).status, 404);
  assert.equal((await get('/api/repositories/acme-demo/no-such-repo')).status, 404);
  assert.equal((await get('/api/repositories/no-such-owner/no-such-repo')).status, 404);
});

test('Your organizations lists acme-demo for the signed-in Owner', async () => {
  const res = await get('/api/organizations', sessionCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.ok(payload.organizations.some((o) => o.name === 'acme-demo'));
  assert.equal(
    payload.organizations.find((o) => o.name === 'acme-demo').displayName,
    'Acme Demo'
  );
});

test('Your organizations requires authentication', async () => {
  const res = await get('/api/organizations');
  assert.equal(res.status, 401);
});

test('seed data survives a store reload (persistence)', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const org = store2.findOrganizationByName('acme-demo');
  assert.ok(org);
  assert.ok(store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs'));
  assert.ok(store2.findRepositoryByOwnerAndName('acme-demo', 'acme-internal'));
  assert.equal(store2.getOrganizationMembers(org.id).length, 2);
  assert.equal(store2.getOrganizationTeams(org.id).length, 4);

  // REQ-2-2-2 seed hierarchy: frontend-team has an existing parent and a
  // descendant (for the cycle scenario), design-team is an unrelated team
  // usable as the candidate parent in the membership scenario.
  const frontend = store2.findTeamByOrganizationAndName(org.id, 'frontend-team');
  const platform = store2.findTeamByOrganizationAndName(org.id, 'platform-team');
  const core = store2.findTeamByOrganizationAndName(org.id, 'frontend-core-team');
  assert.equal(frontend.parentTeamId, platform.id);
  assert.equal(core.parentTeamId, frontend.id);
  // bob-reviewer is an organization member who has not joined any team.
  assert.equal(store2.getTeamDirectMembers(frontend.id).length, 0);
});
