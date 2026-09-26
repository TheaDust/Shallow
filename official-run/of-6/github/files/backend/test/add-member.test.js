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
let carolCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-add-member-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signin = async (identifier, password) => {
    const res = await fetch(`${baseUrl}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  };

  ownerCookie = await signin('alice-dev', 'Valid-password-123!');
  memberCookie = await signin('bob-reviewer', 'Valid-password-123!');
  // carol-dev is seeded as a registered account that is NOT yet a member of
  // acme-demo (REQ-2-2-3 registered nonmember).
  carolCookie = await signin('carol-dev', 'Valid-password-123!');
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

const post = (url, body, cookie) => request('POST', url, body, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

test('adding an organization member requires authentication', async () => {
  const res = await post('/api/organizations/acme-demo/people', {
    identifier: 'carol-dev',
    role: 'member',
  });
  assert.equal(res.status, 401);
});

test('a plain organization member cannot add a member', async () => {
  const res = await post(
    '/api/organizations/acme-demo/people',
    { identifier: 'carol-dev', role: 'member' },
    memberCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.message, 'Access denied');
});

test('an empty identifier is rejected', async () => {
  const res = await post(
    '/api/organizations/acme-demo/people',
    { identifier: '', role: 'member' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.identifier, 'Username or email is required');
});

test('an unknown username is rejected with Account not found', async () => {
  const res = await post(
    '/api/organizations/acme-demo/people',
    { identifier: 'unknown-reviewer', role: 'member' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.identifier, 'Account not found');

  // Nothing was stored.
  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  assert.ok(!peoplePayload.members.some((m) => m.username === 'unknown-reviewer'));
});

test('an existing member is rejected with Account is already a member and stays unique', async () => {
  const res = await post(
    '/api/organizations/acme-demo/people',
    { identifier: 'bob-reviewer', role: 'member' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.identifier, 'Account is already a member');

  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  const matches = peoplePayload.members.filter((m) => m.username === 'bob-reviewer');
  assert.equal(matches.length, 1);
});

test('an unsupported or empty role is rejected and stores nothing', async () => {
  const unsupported = await post(
    '/api/organizations/acme-demo/people',
    { identifier: 'carol-dev', role: 'write' },
    ownerCookie
  );
  assert.equal(unsupported.status, 400);
  assert.equal((await unsupported.json()).errors.role, 'Role is invalid');

  const empty = await post(
    '/api/organizations/acme-demo/people',
    { identifier: 'carol-dev', role: '' },
    ownerCookie
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).errors.role, 'Role is required');

  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  assert.ok(!peoplePayload.members.some((m) => m.username === 'carol-dev'));
});

test('an Owner adds the registered nonmember by username with the Member role', async () => {
  const res = await post(
    '/api/organizations/acme-demo/people',
    { identifier: 'carol-dev', role: 'member' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.member.username, 'carol-dev');
  assert.equal(payload.member.role, 'member');

  // People lists the full username with the Member role.
  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  const carol = peoplePayload.members.find((m) => m.username === 'carol-dev');
  assert.ok(carol);
  assert.equal(carol.role, 'member');

  // The target account sees the organization in "Your organizations".
  const orgs = await get('/api/organizations', carolCookie);
  const orgsPayload = await orgs.json();
  assert.ok(orgsPayload.organizations.some((o) => o.name === 'acme-demo'));

  // The org overview reports the Member role for the new account.
  const overview = await get('/api/organizations/acme-demo', carolCookie);
  const overviewPayload = await overview.json();
  assert.equal(overviewPayload.role, 'member');
});

test('a plain Member gains no access to an ungranted private repository', async () => {
  // carol-dev is a Member: acme-internal has no direct or team grant.
  const repo = await get('/api/repositories/acme-demo/acme-internal', carolCookie);
  assert.equal(repo.status, 403);
  assert.equal((await repo.json()).error, 'Access denied');

  // The private repository is also filtered out of the repositories list.
  const repos = await get('/api/organizations/acme-demo/repositories', carolCookie);
  const reposPayload = await repos.json();
  assert.ok(!reposPayload.repositories.some((r) => r.name === 'acme-internal'));
  assert.ok(reposPayload.repositories.some((r) => r.name === 'acme-docs'));
});

test('adding the same account a second time is rejected and never duplicates', async () => {
  const res = await post(
    '/api/organizations/acme-demo/people',
    { identifier: 'carol-dev', role: 'owner' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.identifier, 'Account is already a member');

  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  const matches = peoplePayload.members.filter((m) => m.username === 'carol-dev');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].role, 'member');
});

test('an Owner added by verified email gains Owner role and repository Admin', async () => {
  // A fresh registered account; the Owner adds it by its verified email.
  const register = await post('/api/auth/register', {
    username: 'erin-dev',
    email: 'erin.dev@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  assert.equal(register.status, 201);

  const res = await post(
    '/api/organizations/acme-demo/people',
    { identifier: '  ERIN.DEV@EXAMPLE.TEST  ', role: 'owner' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.member.username, 'erin-dev');
  assert.equal(payload.member.role, 'owner');

  // The People list displays the full username with the Owner role.
  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  const erin = peoplePayload.members.find((m) => m.username === 'erin-dev');
  assert.ok(erin);
  assert.equal(erin.role, 'owner');

  // The Owner gains Admin permission over the organization's repositories.
  const erinSignin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'erin-dev', password: 'Valid-password-123!' }),
  });
  const erinCookie = erinSignin.headers.get('set-cookie').split(';')[0];

  const repo = await get('/api/repositories/acme-demo/acme-internal', erinCookie);
  assert.equal(repo.status, 200);
  const repoPayload = await repo.json();
  assert.equal(repoPayload.repository.role, 'admin');

  const repos = await get('/api/organizations/acme-demo/repositories', erinCookie);
  const reposPayload = await repos.json();
  assert.ok(reposPayload.repositories.some((r) => r.name === 'acme-internal'));
});

test('membership relationships survive a store reload; rejected attempts left no trace', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const org = store2.findOrganizationByName('acme-demo');
  const members = store2.getOrganizationMembers(org.id);
  const carol = store2.findAccountByUsername('carol-dev');
  const erin = store2.findAccountByUsername('erin-dev');
  const bob = store2.findAccountByUsername('bob-reviewer');

  const carolMemberships = members.filter((m) => m.accountId === carol.id);
  assert.equal(carolMemberships.length, 1);
  assert.equal(carolMemberships[0].role, 'member');

  const erinMemberships = members.filter((m) => m.accountId === erin.id);
  assert.equal(erinMemberships.length, 1);
  assert.equal(erinMemberships[0].role, 'owner');

  const bobMemberships = members.filter((m) => m.accountId === bob.id);
  assert.equal(bobMemberships.length, 1);

  // No record for unknown-reviewer or the failed role attempts.
  assert.ok(!store2.findAccountByUsername('unknown-reviewer'));
  assert.equal(members.filter((m) => m.role === 'write').length, 0);
});

test('unknown organization returns 404 for the add-member request', async () => {
  const res = await post(
    '/api/organizations/no-such-org/people',
    { identifier: 'carol-dev', role: 'member' },
    ownerCookie
  );
  assert.equal(res.status, 404);
});
