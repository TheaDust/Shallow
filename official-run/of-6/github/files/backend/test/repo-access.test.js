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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-repo-access-test-'));
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
  carolCookie = await signin('carol-dev');
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

test('the access list requires authentication', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/access');
  assert.equal(res.status, 401);
});

test('a plain organization member cannot read the access list', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/access', memberCookie);
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');
});

test('an Owner sees the seeded dana-triage and bob-reviewer grants on acme-docs', async () => {
  // REQ-5-3-1: acme-docs carries the seeded assignable member dana-triage
  // (a Triage grant granted by the organization Owner alice-dev).
  // REQ-6-3-3: the seed also grants the review-comment reviewer
  // bob-reviewer Write (a non-author Write reviewer). Together they are the
  // only authorization records of the freshly seeded repository.
  const res = await get('/api/repositories/acme-demo/acme-docs/access', ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.grants.length, 2);
  const dana = payload.grants.find((g) => g.subjectName === 'dana-triage');
  assert.equal(dana.subjectType, 'user');
  assert.equal(dana.role, 'triage');
  assert.equal(dana.grantedBy, 'alice-dev');
  const bob = payload.grants.find((g) => g.subjectName === 'bob-reviewer');
  assert.equal(bob.subjectType, 'user');
  assert.equal(bob.role, 'write');
  assert.equal(bob.grantedBy, 'alice-dev');
});

test('an Owner grants Write to a team; the list shows the new record next to the seeded one', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'team', subjectName: 'frontend-team', role: 'write' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.grants.length, 3);
  const grant = payload.grants.find((g) => g.subjectName === 'frontend-team');
  assert.equal(grant.subjectType, 'team');
  assert.equal(grant.subjectName, 'frontend-team');
  assert.equal(grant.role, 'write');
  assert.equal(grant.grantedBy, 'alice-dev');
  assert.equal(typeof grant.updatedAt, 'string');
});

test('saving the same role again does not create a second record', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'team', subjectName: 'frontend-team', role: 'write' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  const teamGrants = payload.grants.filter((g) => g.subjectName === 'frontend-team');
  assert.equal(teamGrants.length, 1);
  assert.equal(teamGrants[0].role, 'write');
});

test('granting a member stores a separate user record; replacing its role keeps one record', async () => {
  const created = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'user', subjectName: 'bob-reviewer', role: 'read' },
    ownerCookie
  );
  assert.equal(created.status, 201);
  let grants = (await created.json()).grants;
  assert.equal(grants.length, 3);
  const bobGrant = grants.find((g) => g.subjectName === 'bob-reviewer');
  assert.equal(bobGrant.role, 'read');

  // Changing the role replaces the original role for the same subject.
  const replaced = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'user', subjectName: 'bob-reviewer', role: 'triage' },
    ownerCookie
  );
  assert.equal(replaced.status, 201);
  grants = (await replaced.json()).grants;
  assert.equal(grants.length, 3);
  const updatedBob = grants.find((g) => g.subjectName === 'bob-reviewer');
  assert.equal(updatedBob.role, 'triage');
});

test('PATCH replaces the stored role of an existing grant and keeps one record', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/access/team/frontend-team',
    { role: 'read' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  const teamGrants = payload.grants.filter((g) => g.subjectName === 'frontend-team');
  assert.equal(teamGrants.length, 1);
  assert.equal(teamGrants[0].role, 'read');
});

test('PATCH on a grant that does not exist returns 404', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/access/team/design-team',
    { role: 'read' },
    ownerCookie
  );
  assert.equal(res.status, 404);
});

test('grants survive a store reload (persistence)', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const repo = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const grants = store2.getRepoAccessGrants(repo.id);
  assert.equal(grants.length, 3);
  assert.equal(
    grants.find((g) => g.subjectName === 'dana-triage').role,
    'triage'
  );
  assert.equal(
    grants.find((g) => g.subjectName === 'frontend-team').role,
    'read'
  );
  assert.equal(
    grants.find((g) => g.subjectName === 'bob-reviewer').role,
    'triage'
  );
});

test('a non-owner cannot grant access', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'team', subjectName: 'frontend-team', role: 'write' },
    memberCookie
  );
  assert.equal(res.status, 403);
});

test('invalid subjects and roles are rejected without storing a grant', async () => {
  const cases = [
    { subjectType: '', subjectName: 'frontend-team', role: 'write', field: 'subjectType', expected: 'Subject type is required' },
    { subjectType: 'member', subjectName: 'bob-reviewer', role: 'write', field: 'subjectType', expected: 'Subject type is invalid' },
    { subjectType: 'user', subjectName: '', role: 'write', field: 'subjectName', expected: 'Subject is required' },
    // carol-dev is registered but not a member of acme-demo.
    { subjectType: 'user', subjectName: 'carol-dev', role: 'write', field: 'subjectName', expected: 'User is not a member of this organization' },
    // design-team exists but is not in this test's perspective; it IS in acme-demo, so use another org's team.
    { subjectType: 'user', subjectName: 'alice-dev', role: 'owner', field: 'role', expected: 'Role is invalid' },
    { subjectType: 'user', subjectName: 'bob-reviewer', role: '', field: 'role', expected: 'Role is required' },
  ];
  for (const { subjectType, subjectName, role, field, expected } of cases) {
    const res = await post(
      '/api/repositories/acme-demo/acme-docs/access',
      { subjectType, subjectName, role },
      ownerCookie
    );
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify({ subjectType, subjectName, role })}`);
    const payload = await res.json();
    assert.equal(payload.errors[field], expected);
  }

  const list = await get('/api/repositories/acme-demo/acme-docs/access', ownerCookie);
  const grants = (await list.json()).grants;
  assert.equal(grants.length, 3, 'rejected grants must not be stored');
});

test('a team from another organization is rejected', async () => {
  await post('/api/organizations', { name: 'other-org', displayName: 'Other Org' }, ownerCookie);
  await post('/api/organizations/other-org/teams', { name: 'other-team' }, ownerCookie);

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'team', subjectName: 'other-team', role: 'write' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.subjectName, 'Team is not in this organization');
});

test('a repository Admin grant authorizes Manage access while a plain Read does not', async () => {
  // alice-dev (Owner) grants admin to bob-reviewer on acme-docs.
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'user', subjectName: 'bob-reviewer', role: 'admin' },
    ownerCookie
  );
  assert.equal(res.status, 201);

  // bob can now read the access list of the repository.
  const list = await get('/api/repositories/acme-demo/acme-docs/access', memberCookie);
  assert.equal(list.status, 200);
  const payload = await list.json();
  assert.ok(payload.grants.some((g) => g.subjectName === 'bob-reviewer' && g.role === 'admin'));

  // bob (repository Admin) can grant access too.
  const grant = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'team', subjectName: 'frontend-team', role: 'write' },
    memberCookie
  );
  assert.equal(grant.status, 201);
});

test('private repository access follows the grant: team member gains Write, un-granted accounts stay denied', async () => {
  // acme-internal is private and has no grants yet: bob is denied initially.
  const before = await get('/api/repositories/acme-demo/acme-internal', memberCookie);
  assert.equal(before.status, 403);

  // Make bob a direct member of frontend-team via the team API, then grant
  // the team Write on the private repository.
  const added = await post(
    '/api/organizations/acme-demo/teams/frontend-team/members',
    { username: 'bob-reviewer' },
    ownerCookie
  );
  assert.equal(added.status, 201);
  const granted = await post(
    '/api/repositories/acme-demo/acme-internal/access',
    { subjectType: 'team', subjectName: 'frontend-team', role: 'write' },
    ownerCookie
  );
  assert.equal(granted.status, 201);

  // bob now has team-grant Write on acme-internal.
  const bobView = await get('/api/repositories/acme-demo/acme-internal', memberCookie);
  assert.equal(bobView.status, 200);
  const bobPayload = await bobView.json();
  assert.equal(bobPayload.repository.visibility, 'private');
  assert.equal(bobPayload.repository.role, 'write');

  // carol-dev is not a member and holds no grant: private stays denied.
  const carolView = await get('/api/repositories/acme-demo/acme-internal', carolCookie);
  assert.equal(carolView.status, 403);

  // alice (Owner) remains admin.
  const ownerView = await get('/api/repositories/acme-demo/acme-internal', ownerCookie);
  assert.equal((await ownerView.json()).repository.role, 'admin');
});

test('the effective role is the highest among grants and Owner status', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const repo = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-internal');
  const alice = store2.findAccountByUsername('alice-dev');
  const bob = store2.findAccountByUsername('bob-reviewer');
  assert.equal(store2.effectiveRepositoryRole(repo.id, alice.id), 'admin');
  // bob has only the team Write grant on acme-internal -> write.
  assert.equal(store2.effectiveRepositoryRole(repo.id, bob.id), 'write');

  // A higher direct grant raises the effective role; team hierarchy does not
  // propagate (frontend-core-team is a child of frontend-team but grants on
  // frontend-team do not flow to its members through the hierarchy).
  const bobAccount = store2.findAccountByUsername('bob-reviewer');
  const docs = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  assert.equal(store2.effectiveRepositoryRole(docs.id, bobAccount.id), 'admin');
});
