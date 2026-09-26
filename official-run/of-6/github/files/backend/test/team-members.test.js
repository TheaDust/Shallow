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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-team-members-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ownerSignin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice-dev', password: 'Valid-password-123!' }),
  });
  assert.equal(ownerSignin.status, 200);
  ownerCookie = ownerSignin.headers.get('set-cookie').split(';')[0];

  const memberSignin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'bob-reviewer', password: 'Valid-password-123!' }),
  });
  assert.equal(memberSignin.status, 200);
  memberCookie = memberSignin.headers.get('set-cookie').split(';')[0];

  // A registered account that is NOT a member of acme-demo.
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'carol-dev',
      email: 'carol.dev@example.test',
      password: 'Valid-password-123!',
      confirmPassword: 'Valid-password-123!',
      agreeToTerms: true,
    }),
  });
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
const del = (url, cookie) => request('DELETE', url, undefined, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

test('adding a team member requires authentication', async () => {
  const res = await post('/api/organizations/acme-demo/teams/frontend-team/members', {
    username: 'bob-reviewer',
  });
  assert.equal(res.status, 401);
});

test('a plain organization member cannot add a team member', async () => {
  const res = await post(
    '/api/organizations/acme-demo/teams/frontend-team/members',
    { username: 'bob-reviewer' },
    memberCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.message, 'Access denied');
});

test('an empty username is rejected', async () => {
  const res = await post(
    '/api/organizations/acme-demo/teams/frontend-team/members',
    { username: '' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.username, 'Username is required');
});

test('a non-organization member cannot be added', async () => {
  // carol-dev exists but is not a member of acme-demo.
  const res = await post(
    '/api/organizations/acme-demo/teams/frontend-team/members',
    { username: 'carol-dev' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.username, 'User is not a member of this organization');

  const members = await get('/api/organizations/acme-demo/teams/frontend-team/members');
  const membersPayload = await members.json();
  assert.ok(!membersPayload.members.some((m) => m.username === 'carol-dev'));
});

test('an Owner adds a current organization member to the team', async () => {
  const res = await post(
    '/api/organizations/acme-demo/teams/frontend-team/members',
    { username: 'bob-reviewer' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.member.username, 'bob-reviewer');

  const members = await get('/api/organizations/acme-demo/teams/frontend-team/members');
  const membersPayload = await members.json();
  assert.deepEqual(membersPayload.members, [{ username: 'bob-reviewer' }]);
});

test('adding the same member twice keeps the username visible exactly once', async () => {
  const res = await post(
    '/api/organizations/acme-demo/teams/frontend-team/members',
    { username: 'bob-reviewer' },
    ownerCookie
  );
  assert.equal(res.status, 201);

  const members = await get('/api/organizations/acme-demo/teams/frontend-team/members');
  const membersPayload = await members.json();
  assert.equal(membersPayload.members.length, 1);
  assert.equal(membersPayload.members[0].username, 'bob-reviewer');
});

test('team membership is direct only: parent and child teams are unaffected', async () => {
  // frontend-team's parent is platform-team and its child is
  // frontend-core-team; adding bob-reviewer must not leak into either.
  const parentMembers = await get('/api/organizations/acme-demo/teams/platform-team/members');
  const childMembers = await get('/api/organizations/acme-demo/teams/frontend-core-team/members');
  assert.deepEqual((await parentMembers.json()).members, []);
  assert.deepEqual((await childMembers.json()).members, []);
});

test('removing a team member requires authentication and Owner permission', async () => {
  assert.equal(
    (await del('/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer')).status,
    401
  );
  const res = await del(
    '/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer',
    memberCookie
  );
  assert.equal(res.status, 403);
});

test('an Owner removes a team member immediately and reload keeps the username absent', async () => {
  const res = await del(
    '/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer',
    ownerCookie
  );
  assert.equal(res.status, 200);

  const members = await get('/api/organizations/acme-demo/teams/frontend-team/members');
  const membersPayload = await members.json();
  assert.deepEqual(membersPayload.members, []);

  // Reload the store: the removal is persisted; only this team's membership
  // changed — bob-reviewer is still an organization member.
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const org = store2.findOrganizationByName('acme-demo');
  const team = store2.findTeamByOrganizationAndName(org.id, 'frontend-team');
  assert.deepEqual(store2.getTeamDirectMembers(team.id).map((a) => a.username), []);
  assert.ok(store2.isOrganizationMember(org.id, store2.findAccountByUsername('bob-reviewer').id));
});

test('unknown organization or team returns 404 for member operations', async () => {
  const addRes = await post(
    '/api/organizations/no-such-org/teams/frontend-team/members',
    { username: 'bob-reviewer' },
    ownerCookie
  );
  assert.equal(addRes.status, 404);

  const teamRes = await post(
    '/api/organizations/acme-demo/teams/no-such-team/members',
    { username: 'bob-reviewer' },
    ownerCookie
  );
  assert.equal(teamRes.status, 404);
});

test('the seed hierarchy rejects a cyclic parent change and keeps the original parent', async () => {
  // frontend-team already has parent platform-team; frontend-core-team is its
  // descendant, so selecting it as the new parent must be rejected.
  const patchRes = await request(
    'PATCH',
    '/api/organizations/acme-demo/teams/frontend-team',
    { parentTeamName: 'frontend-core-team' },
    ownerCookie
  );
  assert.equal(patchRes.status, 400);
  const payload = await patchRes.json();
  assert.equal(payload.errors.parentTeam, 'Cyclic team hierarchy is not allowed');

  // The original parent is unchanged and survives reload.
  const detail = await get('/api/organizations/acme-demo/teams/frontend-team');
  const detailPayload = await detail.json();
  assert.equal(detailPayload.team.parentTeamName, 'platform-team');
  assert.deepEqual(detailPayload.team.ancestorNames, ['platform-team']);
});

test('an Owner changes the parent to an unrelated team (no cycle)', async () => {
  const res = await request(
    'PATCH',
    '/api/organizations/acme-demo/teams/frontend-team',
    { parentTeamName: 'design-team' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.team.parentTeamName, 'design-team');

  const detail = await get('/api/organizations/acme-demo/teams/frontend-team');
  const detailPayload = await detail.json();
  assert.equal(detailPayload.team.parentTeamName, 'design-team');
  assert.deepEqual(detailPayload.team.ancestorNames, ['design-team']);
});
