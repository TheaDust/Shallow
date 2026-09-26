'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { createStore } = require('../src/store');

let dataDir;
let server;
let baseUrl;
let ownerCookie;
let memberCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-remove-member-test-'));

  // Provision the authorization relationships the removal scenario needs
  // (bob-reviewer is a direct member of frontend-team and holds both a direct
  // grant and a team grant on the private acme-internal repository), then
  // start the server over the same persisted store.
  const setup = createStore(dataDir);
  const org = setup.findOrganizationByName('acme-demo');
  const alice = setup.findAccountByUsername('alice-dev');
  const bob = setup.findAccountByUsername('bob-reviewer');
  const frontendTeam = setup.findTeamByOrganizationAndName(org.id, 'frontend-team');
  const internalRepo = setup.findRepositoryByOwnerAndName('acme-demo', 'acme-internal');
  setup.addTeamMember(frontendTeam.id, org.id, bob.id);
  setup.addRepoAccess({
    repositoryId: internalRepo.id,
    subjectType: 'user',
    subjectId: bob.id,
    role: 'write',
    grantorId: alice.id,
  });
  setup.addRepoAccess({
    repositoryId: internalRepo.id,
    subjectType: 'team',
    subjectId: frontendTeam.id,
    role: 'read',
    grantorId: alice.id,
  });

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

const get = (url, cookie) => request('GET', url, undefined, cookie);
const post = (url, body, cookie) => request('POST', url, body, cookie);
const del = (url, cookie) => request('DELETE', url, undefined, cookie);

test('removing a member requires authentication', async () => {
  const res = await del('/api/organizations/acme-demo/people/bob-reviewer');
  assert.equal(res.status, 401);
});

test('a plain organization member cannot remove anyone', async () => {
  const res = await del('/api/organizations/acme-demo/people/alice-dev', memberCookie);
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.message, 'Access denied');

  // After the rejected attempt the member still belongs to the organization.
  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  assert.ok(peoplePayload.members.some((m) => m.username === 'alice-dev'));
  assert.ok(peoplePayload.members.some((m) => m.username === 'bob-reviewer'));
});

test('an unknown organization or username returns 404', async () => {
  const orgRes = await del('/api/organizations/no-such-org/people/bob-reviewer', ownerCookie);
  assert.equal(orgRes.status, 404);

  const userRes = await del('/api/organizations/acme-demo/people/unknown-reviewer', ownerCookie);
  assert.equal(userRes.status, 404);
});

test('the last Owner cannot be removed and nothing changes', async () => {
  const res = await del('/api/organizations/acme-demo/people/alice-dev', ownerCookie);
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.message, 'The last organization Owner cannot be removed');

  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  const alice = peoplePayload.members.find((m) => m.username === 'alice-dev');
  assert.ok(alice);
  assert.equal(alice.role, 'owner');
  const bob = peoplePayload.members.find((m) => m.username === 'bob-reviewer');
  assert.ok(bob);
});

test('before removal the granted member can access the private repository', async () => {
  const repo = await get('/api/repositories/acme-demo/acme-internal', memberCookie);
  assert.equal(repo.status, 200);
  const payload = await repo.json();
  assert.equal(payload.repository.role, 'write');
});

test('removal deletes membership, team memberships and direct grants but preserves the account, personal repository, other organizations, teams and team grants', async () => {
  // Give bob-reviewer a relationship with a second organization so the
  // removal of the acme-demo membership must leave it untouched.
  const createOrg = await post(
    '/api/organizations',
    { name: 'acme-aux', displayName: 'Acme Aux' },
    ownerCookie
  );
  assert.equal(createOrg.status, 201);
  const addToAux = await post(
    '/api/organizations/acme-aux/people',
    { identifier: 'bob-reviewer', role: 'member' },
    ownerCookie
  );
  assert.equal(addToAux.status, 201);

  // The Owner removes bob-reviewer from acme-demo.
  const remove = await del('/api/organizations/acme-demo/people/bob-reviewer', ownerCookie);
  assert.equal(remove.status, 200);

  // The complete username is absent from the People list immediately.
  const people = await get('/api/organizations/acme-demo/people');
  const peoplePayload = await people.json();
  assert.ok(!peoplePayload.members.some((m) => m.username === 'bob-reviewer'));
  assert.ok(peoplePayload.members.some((m) => m.username === 'alice-dev'));

  // Access obtained solely through the membership is revoked: the direct
  // grant was deleted and the team membership that carried the team grant is
  // gone, so effective permission is recalculated to denied.
  const repo = await get('/api/repositories/acme-demo/acme-internal', memberCookie);
  assert.equal(repo.status, 403);
  assert.equal((await repo.json()).error, 'Access denied');
  const repos = await get('/api/organizations/acme-demo/repositories', memberCookie);
  const reposPayload = await repos.json();
  assert.ok(!reposPayload.repositories.some((r) => r.name === 'acme-internal'));

  // The account can still sign in and its personal repository still exists
  // and remains accessible.
  const signin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'bob-reviewer', password: 'Valid-password-123!' }),
  });
  assert.equal(signin.status, 200);
  const personalRepo = await get('/api/repositories/bob-reviewer/bob-notes', memberCookie);
  assert.equal(personalRepo.status, 200);
  assert.equal((await personalRepo.json()).repository.ownerType, 'user');

  // The relationship with the other organization is untouched.
  const auxPeople = await get('/api/organizations/acme-aux/people', ownerCookie);
  const auxPayload = await auxPeople.json();
  assert.ok(auxPayload.members.some((m) => m.username === 'bob-reviewer'));
  const myOrgs = await get('/api/organizations', memberCookie);
  const myOrgsPayload = await myOrgs.json();
  assert.ok(myOrgsPayload.organizations.some((o) => o.name === 'acme-aux'));
  assert.ok(!myOrgsPayload.organizations.some((o) => o.name === 'acme-demo'));

  // Reload from the persisted store: the removal is durable; teams and team
  // grants survive; the account and its personal repository survive.
  const store = createStore(dataDir);
  const org = store.findOrganizationByName('acme-demo');
  const bob = store.findAccountByUsername('bob-reviewer');
  const frontendTeam = store.findTeamByOrganizationAndName(org.id, 'frontend-team');
  const internalRepo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-internal');

  assert.ok(!store.isOrganizationMember(org.id, bob.id));
  assert.equal(
    store.getTeamDirectMembers(frontendTeam.id).some((a) => a.id === bob.id),
    false
  );
  assert.equal(store.getDirectGrant(internalRepo.id, bob.id), null);
  // Teams themselves remain (including the one bob was a member of).
  assert.ok(frontendTeam);
  assert.ok(store.findTeamByOrganizationAndName(org.id, 'platform-team'));
  assert.equal(store.getOrganizationTeams(org.id).length, 4);
  // The account and its personal repository remain.
  assert.ok(store.findAccountByUsername('bob-reviewer'));
  const personal = store.findRepositoryByOwnerAndName('bob-reviewer', 'bob-notes');
  assert.ok(personal);
  assert.equal(personal.ownerType, 'user');
  // The team grant record itself was not deleted (only the direct user grant
  // and the team membership were removed).
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8'));
  const directGrants = persisted.repoAccess.filter(
    (g) => g.subjectType === 'user' && g.subjectId === bob.id
  );
  assert.equal(directGrants.length, 0);
  const teamGrant = persisted.repoAccess.find(
    (g) =>
      g.subjectType === 'team' &&
      g.subjectId === frontendTeam.id &&
      g.repositoryId === internalRepo.id
  );
  assert.ok(teamGrant);
  assert.equal(teamGrant.role, 'read');
  // bob-reviewer's membership in the other organization is also durable.
  const aux = store.findOrganizationByName('acme-aux');
  assert.ok(aux);
  assert.ok(store.isOrganizationMember(aux.id, bob.id));
});
