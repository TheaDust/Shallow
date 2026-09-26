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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-team-create-test-'));
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
const patch = (url, body, cookie) => request('PATCH', url, body, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

test('creating a team requires authentication', async () => {
  const res = await post('/api/organizations/acme-demo/teams', { name: 'mobile-team' });
  assert.equal(res.status, 401);
});

test('a plain organization member cannot create a team', async () => {
  const res = await post(
    '/api/organizations/acme-demo/teams',
    { name: 'mobile-team' },
    memberCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.message, 'Access denied');
});

test('an Owner creates a team without description or parent', async () => {
  const res = await post('/api/organizations/acme-demo/teams', { name: 'mobile-team' }, ownerCookie);
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.team.name, 'mobile-team');
  assert.equal(payload.team.parentTeamName, null);

  // The team page detail is reachable and the tree shows only the organization.
  const detail = await get('/api/organizations/acme-demo/teams/mobile-team');
  assert.equal(detail.status, 200);
  const detailPayload = await detail.json();
  assert.equal(detailPayload.team.name, 'mobile-team');
  assert.equal(detailPayload.team.organization.name, 'acme-demo');
  assert.equal(detailPayload.team.organization.displayName, 'Acme Demo');
  assert.equal(detailPayload.team.parentTeamName, null);
  assert.deepEqual(detailPayload.team.ancestorNames, []);
  assert.equal(detailPayload.team.creator, 'alice-dev');

  // The Teams list reflects the new team.
  const teams = await get('/api/organizations/acme-demo/teams');
  const teamsPayload = await teams.json();
  assert.ok(teamsPayload.teams.some((t) => t.name === 'mobile-team'));
});

test('an Owner creates a team with a description and a parent from the same organization', async () => {
  const res = await post(
    '/api/organizations/acme-demo/teams',
    { name: 'mobile-ios', description: 'iOS app team', parentTeamName: 'mobile-team' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.team.parentTeamName, 'mobile-team');

  const detail = await get('/api/organizations/acme-demo/teams/mobile-ios');
  const detailPayload = await detail.json();
  assert.equal(detailPayload.team.description, 'iOS app team');
  assert.equal(detailPayload.team.parentTeamName, 'mobile-team');
  assert.deepEqual(detailPayload.team.ancestorNames, ['mobile-team']);
});

test('empty and malformed team names are rejected with the format/required messages', async () => {
  const cases = [
    { name: '', expected: 'Team name is required' },
    { name: 'MobileTeam', expected: 'Team name format is invalid' },
    { name: 'mobile_team', expected: 'Team name format is invalid' },
    { name: '-mobile', expected: 'Team name format is invalid' },
    { name: 'mobile-', expected: 'Team name format is invalid' },
    { name: 'a'.repeat(51), expected: 'Team name format is invalid' },
    { name: 'mobile team', expected: 'Team name format is invalid' },
  ];
  for (const { name, expected } of cases) {
    const res = await post('/api/organizations/acme-demo/teams', { name }, ownerCookie);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(name)}`);
    const payload = await res.json();
    assert.equal(payload.errors.name, expected);
  }

  // None of the rejected names were created.
  const teams = await get('/api/organizations/acme-demo/teams');
  const teamsPayload = await teams.json();
  for (const { name } of cases) {
    assert.ok(!teamsPayload.teams.some((t) => t.name === name));
  }
});

test('consecutive hyphens inside a team name are allowed (letters, digits, or hyphens)', async () => {
  const res = await post('/api/organizations/acme-demo/teams', { name: 'a--b-9' }, ownerCookie);
  assert.equal(res.status, 201);
});

test('a duplicated team name within the organization is rejected', async () => {
  const res = await post(
    '/api/organizations/acme-demo/teams',
    { name: 'frontend-team' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.name, 'Team name already exists');
});

test('a parent team from another organization is rejected and no team is created', async () => {
  // Create a second organization and a team inside it.
  await post(
    '/api/organizations',
    { name: 'other-org', displayName: 'Other Org' },
    ownerCookie
  );
  await post('/api/organizations/other-org/teams', { name: 'other-team' }, ownerCookie);

  const res = await post(
    '/api/organizations/acme-demo/teams',
    { name: 'cross-org-team', parentTeamName: 'other-team' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.parentTeam, 'Parent team is not in this organization');

  const teams = await get('/api/organizations/acme-demo/teams');
  const teamsPayload = await teams.json();
  assert.ok(!teamsPayload.teams.some((t) => t.name === 'cross-org-team'));
});

test('an unknown organization or team returns 404', async () => {
  assert.equal((await post('/api/organizations/no-such-org/teams', { name: 'x' }, ownerCookie)).status, 404);
  assert.equal((await get('/api/organizations/acme-demo/teams/no-such-team')).status, 404);
  assert.equal((await get('/api/organizations/acme-demo/teams/no-such-team/members')).status, 404);
});

test('team detail includes direct members (empty for a new team)', async () => {
  const res = await get('/api/organizations/acme-demo/teams/mobile-team/members');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.members, []);
});

test('created teams and parent relationships survive a store reload', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const org = store2.findOrganizationByName('acme-demo');
  const mobile = store2.findTeamByOrganizationAndName(org.id, 'mobile-team');
  assert.ok(mobile, 'mobile-team must persist');
  const ios = store2.findTeamByOrganizationAndName(org.id, 'mobile-ios');
  assert.ok(ios, 'mobile-ios must persist');
  assert.equal(ios.parentTeamId, mobile.id);
  assert.deepEqual(store2.getTeamAncestorNames(ios.id), ['mobile-team']);
  assert.equal(store2.findTeamByOrganizationAndName(org.id, 'a--b-9').name, 'a--b-9');
});

test('the organization overview exposes the signed-in role (owner/member/null)', async () => {
  const visitor = await get('/api/organizations/acme-demo');
  assert.equal((await visitor.json()).role, null);

  const owner = await get('/api/organizations/acme-demo', ownerCookie);
  assert.equal((await owner.json()).role, 'owner');

  const member = await get('/api/organizations/acme-demo', memberCookie);
  assert.equal((await member.json()).role, 'member');
});

test('Settings: an Owner changes the parent team of a team', async () => {
  const res = await patch(
    '/api/organizations/acme-demo/teams/mobile-ios',
    { parentTeamName: 'mobile-team' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.team.parentTeamName, 'mobile-team');
});

test('Settings: a non-owner cannot change the parent team', async () => {
  const res = await patch(
    '/api/organizations/acme-demo/teams/mobile-ios',
    { parentTeamName: null },
    memberCookie
  );
  assert.equal(res.status, 403);
});

test('Settings: a parent outside the organization is rejected', async () => {
  const res = await patch(
    '/api/organizations/acme-demo/teams/mobile-team',
    { parentTeamName: 'other-team' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.parentTeam, 'Parent team is not in this organization');
});

test('Settings: a cyclic hierarchy is rejected and the original parent is kept', async () => {
  // mobile-team -> mobile-ios makes the team its own ancestor.
  const res = await patch(
    '/api/organizations/acme-demo/teams/mobile-team',
    { parentTeamName: 'mobile-ios' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.parentTeam, 'Cyclic team hierarchy is not allowed');

  // The original hierarchy is unchanged.
  const detail = await get('/api/organizations/acme-demo/teams/mobile-team');
  const detailPayload = await detail.json();
  assert.equal(detailPayload.team.parentTeamName, null);
  assert.deepEqual(detailPayload.team.ancestorNames, []);
});

test('Settings: clearing the parent team works and reload keeps it', async () => {
  const res = await patch(
    '/api/organizations/acme-demo/teams/mobile-ios',
    { parentTeamName: '' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.team.parentTeamName, null);

  const detail = await get('/api/organizations/acme-demo/teams/mobile-ios');
  const detailPayload = await detail.json();
  assert.equal(detailPayload.team.parentTeamName, null);
});
