import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(dataDir) {
  const handler = createApp({ dataDir, staticRoot: join(dataDir, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function newDataDir() {
  return mkdtemp(join(tmpdir(), "shallowcode-organizations-"));
}

function jsonRequest(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(baseUrl, identifier, password = "Valid-password-123!") {
  const response = await jsonRequest(baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier, password },
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

function repositoryNames(body) {
  return body.repositories.map((repository) => repository.name);
}

test("the seeded organization is readable by anyone and lists its public repository", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const organization = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo");
  assert.equal(organization.status, 200);
  const body = await organization.json();
  assert.deepEqual(body.organization, {
    id: "org-acme-demo",
    login: "acme-demo",
    name: "Acme Demo",
    createdAt: "2024-01-03T00:00:00.000Z",
  });
  assert.deepEqual(body.viewer, { role: null, isMember: false, isOwner: false });

  const missing = await jsonRequest(app.baseUrl, "/api/organizations/nope-org");
  assert.equal(missing.status, 404);

  // A visitor sees the public repository only: filtering by the exact private
  // name never exposes it.
  const repositories = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/repositories");
  assert.equal(repositories.status, 200);
  assert.deepEqual(repositoryNames(await repositories.json()), ["acme-docs"]);

  // The signed-out visitor has no organization list and no People/Teams access.
  assert.equal((await jsonRequest(app.baseUrl, "/api/organizations")).status, 401);
  assert.equal((await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members")).status, 403);
  assert.equal((await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams")).status, 403);
});

test("the organization member reads the organization and its team list", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "bob-reviewer");

  const list = await jsonRequest(app.baseUrl, "/api/organizations", { cookie });
  const organizations = (await list.json()).organizations;
  assert.deepEqual(organizations, [
    {
      id: "org-acme-demo",
      login: "acme-demo",
      name: "Acme Demo",
      createdAt: "2024-01-03T00:00:00.000Z",
      viewerRole: "member",
    },
  ]);

  const teams = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", { cookie });
  assert.equal(teams.status, 200);
  const teamBody = await teams.json();
  assert.deepEqual(
    teamBody.teams.map((team) => [team.name, team.parent, team.organization.login]),
    [["frontend-team", null, "acme-demo"]],
  );

  const people = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members", { cookie });
  const peopleBody = await people.json();
  assert.deepEqual(
    peopleBody.members.map((member) => [member.username, member.role]),
    [
      ["alice-dev", "owner"],
      ["bob-reviewer", "member"],
    ],
  );
  assert.equal(peopleBody.viewer.isOwner, false);
});

test("an organization Owner sees every organization repository, a member only the granted ones", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  // The direct grant of `bob-reviewer` covers the private repository.
  const bobCookie = await signIn(app.baseUrl, "bob-reviewer");
  const bobList = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/repositories", {
    cookie: bobCookie,
  });
  assert.deepEqual(repositoryNames(await bobList.json()), ["acme-docs", "acme-internal"]);

  // A signed-in account that is no member of the organization reads the public
  // repository only.
  const registration = await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "carol-outsider",
      email: "carol@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(registration.status, 201);
  const carolCookie = await signIn(app.baseUrl, "carol-outsider");
  const carolList = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/repositories", {
    cookie: carolCookie,
  });
  assert.deepEqual(repositoryNames(await carolList.json()), ["acme-docs"]);

  // The same account is refused the private repository with an explicit denial.
  const denied = await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-internal", {
    cookie: carolCookie,
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "Access denied");
  const anonymous = await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-internal");
  assert.equal(anonymous.status, 404);
  assert.equal((await anonymous.json()).error, "Not found");
});

test("creating an organization stores it with the creator as Owner and Member", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const created = await jsonRequest(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie,
    body: { name: "mobile-guild", displayName: "Mobile Guild" },
  });
  assert.equal(created.status, 201);
  const organization = (await created.json()).organization;
  assert.equal(organization.login, "mobile-guild");
  assert.equal(organization.name, "Mobile Guild");
  assert.equal(organization.viewerRole, "owner");

  const overview = await jsonRequest(app.baseUrl, "/api/organizations/mobile-guild", { cookie });
  const overviewBody = await overview.json();
  assert.equal(overviewBody.organization.login, "mobile-guild");
  assert.deepEqual(overviewBody.viewer, { role: "owner", isMember: true, isOwner: true });

  const list = await jsonRequest(app.baseUrl, "/api/organizations", { cookie });
  assert.deepEqual(
    (await list.json()).organizations.map((entry) => [entry.login, entry.viewerRole]),
    [
      ["acme-demo", "owner"],
      ["mobile-guild", "owner"],
    ],
  );

  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const afterRestart = await jsonRequest(restarted.baseUrl, "/api/organizations/mobile-guild", {
    cookie: await signIn(restarted.baseUrl, "alice-dev"),
  });
  assert.equal(afterRestart.status, 200);
  assert.equal((await afterRestart.json()).organization.name, "Mobile Guild");
});

test("duplicate, malformed and incomplete organization input creates nothing", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const duplicate = await jsonRequest(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie,
    body: { name: "acme-demo", displayName: "" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal((await duplicate.json()).fields.name, "Organization name already exists");

  const malformed = await jsonRequest(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie,
    body: { name: "-invalid-organization", displayName: "Invalid" },
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).fields.name, "Organization name format is invalid");

  const blank = await jsonRequest(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie,
    body: { name: "blank-display", displayName: "   " },
  });
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).fields.displayName, "Display name is required");

  const overview = await jsonRequest(app.baseUrl, "/api/organizations/blank-display");
  assert.equal(overview.status, 404);
});

test("only an Owner creates a team and the parent stays inside the organization", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const ownerCookie = await signIn(app.baseUrl, "alice-dev");
  const memberCookie = await signIn(app.baseUrl, "bob-reviewer");

  const forbidden = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", {
    method: "POST",
    cookie: memberCookie,
    body: { name: "bob-team" },
  });
  assert.equal(forbidden.status, 403);

  const malformed = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "Mobile-Team" },
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).fields.name, "Team name format is invalid");

  const duplicate = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "frontend-team" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal((await duplicate.json()).fields.name, "Team name already exists");

  const foreignParent = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "foreign-child", parentTeam: "not-a-team" },
  });
  assert.equal(foreignParent.status, 400);
  assert.equal(
    (await foreignParent.json()).fields.parentTeam,
    "Parent team does not belong to this organization",
  );

  const created = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "mobile-team", description: "Mobile client team.", parentTeam: "frontend-team" },
  });
  assert.equal(created.status, 201);
  const team = (await created.json()).team;
  assert.equal(team.name, "mobile-team");
  assert.deepEqual(team.parent, { id: "team-acme-demo-frontend-team", name: "frontend-team" });
  assert.equal(team.organization.login, "acme-demo");

  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const cookie = await signIn(restarted.baseUrl, "alice-dev");
  const teams = await jsonRequest(restarted.baseUrl, "/api/organizations/acme-demo/teams", { cookie });
  const names = (await teams.json()).teams.map((entry) => [entry.name, entry.parent?.name ?? null]);
  assert.deepEqual(names, [
    ["frontend-team", null],
    ["mobile-team", "frontend-team"],
  ]);

  const teamPage = await jsonRequest(
    restarted.baseUrl,
    "/api/organizations/acme-demo/teams/mobile-team",
    { cookie },
  );
  assert.equal(teamPage.status, 200);
  const teamBody = await teamPage.json();
  assert.equal(teamBody.team.name, "mobile-team");
  assert.equal(teamBody.team.organization.login, "acme-demo");
  assert.equal(teamBody.team.parent.name, "frontend-team");
  assert.deepEqual(teamBody.members, []);
  // Every team of the organization is offered as a parent — including the team
  // itself: a cyclic assignment is a rejected save with a visible message, not
  // a hidden option.
  assert.deepEqual(
    teamBody.parentOptions.map((option) => option.name),
    ["frontend-team", "mobile-team"],
  );
});

test("a cyclic parent change is rejected and the original parent stays", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  for (const body of [
    { name: "child-team", parentTeam: "frontend-team" },
    { name: "grandchild-team", parentTeam: "child-team" },
  ]) {
    const created = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie,
      body,
    });
    assert.equal(created.status, 201);
  }

  const cyclic = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team/parent",
    { method: "POST", cookie, body: { parentTeam: "grandchild-team" } },
  );
  assert.equal(cyclic.status, 400);
  assert.equal((await cyclic.json()).fields.parentTeam, "Cyclic team hierarchy is not allowed");

  const self = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/child-team/parent",
    { method: "POST", cookie, body: { parentTeam: "child-team" } },
  );
  assert.equal(self.status, 400);
  assert.equal((await self.json()).fields.parentTeam, "Cyclic team hierarchy is not allowed");

  const unchanged = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/child-team",
    { cookie },
  );
  assert.equal((await unchanged.json()).team.parent.name, "frontend-team");
});

test("removing a member deletes the membership, team memberships and direct organization grants", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  // Before the removal the member reads the private organization repository and
  // the personal repository of the Owner through his own grant.
  const bobCookie = await signIn(app.baseUrl, "bob-reviewer");
  const beforeRemoval = await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-internal", {
    cookie: bobCookie,
  });
  assert.equal(beforeRemoval.status, 200);

  const removed = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members/bob-reviewer", {
    method: "DELETE",
    cookie,
  });
  assert.equal(removed.status, 200);

  const people = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members", { cookie });
  assert.deepEqual(
    (await people.json()).members.map((member) => member.username),
    ["alice-dev"],
  );

  // The removed account keeps its personal account and repository but loses the
  // organization membership, its organization visibility and the direct grant.
  const afterRemoval = await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-internal", {
    cookie: bobCookie,
  });
  assert.equal(afterRemoval.status, 403);
  const organizations = await jsonRequest(app.baseUrl, "/api/organizations", { cookie: bobCookie });
  assert.deepEqual((await organizations.json()).organizations, []);
  const teams = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", { cookie: bobCookie });
  assert.equal(teams.status, 403);

  const personal = await jsonRequest(app.baseUrl, "/api/repositories/bob-reviewer/bob-notes", {
    cookie: bobCookie,
  });
  assert.equal(personal.status, 200);
  // The grant on a repository that is not part of the organization survives.
  const personalGrant = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research", {
    cookie: bobCookie,
  });
  assert.equal(personalGrant.status, 200);

  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const afterRestart = await jsonRequest(
    restarted.baseUrl,
    "/api/organizations/acme-demo/members",
    { cookie: await signIn(restarted.baseUrl, "alice-dev") },
  );
  assert.deepEqual(
    (await afterRestart.json()).members.map((member) => member.username),
    ["alice-dev"],
  );
});

test("a non-Owner cannot remove a member and the last Owner is protected", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const memberCookie = await signIn(app.baseUrl, "bob-reviewer");
  const forbidden = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/members/alice-dev",
    { method: "DELETE", cookie: memberCookie },
  );
  assert.equal(forbidden.status, 403);

  const ownerCookie = await signIn(app.baseUrl, "alice-dev");
  const lastOwner = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/members/alice-dev",
    { method: "DELETE", cookie: ownerCookie },
  );
  assert.equal(lastOwner.status, 400);
  assert.equal((await lastOwner.json()).error, "An organization must keep at least one Owner");

  const people = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members", {
    cookie: ownerCookie,
  });
  assert.deepEqual(
    (await people.json()).members.map((member) => [member.username, member.role]),
    [
      ["alice-dev", "owner"],
      ["bob-reviewer", "member"],
    ],
  );
});

test("an Owner adds an existing account as a member without an invitation step", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "dana-dev",
      email: "dana@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const unknown = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members", {
    method: "POST",
    cookie,
    body: { identifier: "unknown-reviewer", role: "member" },
  });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).fields.identifier, "Account not found");

  const duplicate = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members", {
    method: "POST",
    cookie,
    body: { identifier: "bob.reviewer@example.test", role: "member" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal((await duplicate.json()).fields.identifier, "Account is already a member");

  const added = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members", {
    method: "POST",
    cookie,
    body: { identifier: "dana-dev", role: "member" },
  });
  assert.equal(added.status, 201);
  assert.deepEqual(await added.json().then((body) => [body.member.username, body.member.role]), [
    "dana-dev",
    "member",
  ]);

  // Membership alone still grants no access to the private repository.
  const danaCookie = await signIn(app.baseUrl, "dana-dev");
  const privateRepository = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-internal",
    { cookie: danaCookie },
  );
  assert.equal(privateRepository.status, 403);
});

test("an Owner maintains team members while non-members and outsiders are refused", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const ownerCookie = await signIn(app.baseUrl, "alice-dev");
  const memberCookie = await signIn(app.baseUrl, "bob-reviewer");

  // A registered account that is not an organization member cannot join a team.
  await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "dana-dev",
      email: "dana@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  const outsider = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team/members",
    { method: "POST", cookie: ownerCookie, body: { username: "dana-dev" } },
  );
  assert.equal(outsider.status, 400);
  assert.equal((await outsider.json()).fields.username, "Account is not an organization member");

  const unknown = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team/members",
    { method: "POST", cookie: ownerCookie, body: { username: "unknown-reviewer" } },
  );
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).fields.username, "Account not found");

  // Only an Owner maintains team members.
  const forbidden = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team/members",
    { method: "POST", cookie: memberCookie, body: { username: "bob-reviewer" } },
  );
  assert.equal(forbidden.status, 403);

  const added = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team/members",
    { method: "POST", cookie: ownerCookie, body: { username: "bob-reviewer" } },
  );
  assert.equal(added.status, 201);
  assert.equal((await added.json()).member.username, "bob-reviewer");

  const duplicate = await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team/members",
    { method: "POST", cookie: ownerCookie, body: { username: "bob.reviewer@example.test" } },
  );
  assert.equal(duplicate.status, 400);
  assert.equal((await duplicate.json()).fields.username, "Account is already a team member");

  // The hierarchy of another team never contributes a membership.
  const created = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "child-team", parentTeam: "frontend-team" },
  });
  assert.equal(created.status, 201);
  const child = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams/child-team", {
    cookie: ownerCookie,
  });
  assert.deepEqual((await child.json()).members, []);

  const team = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
    cookie: ownerCookie,
  });
  assert.deepEqual(
    (await team.json()).members.map((member) => member.username),
    ["bob-reviewer"],
  );

  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const cookie = await signIn(restarted.baseUrl, "alice-dev");
  const reloaded = await jsonRequest(
    restarted.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team",
    { cookie },
  );
  assert.deepEqual(
    (await reloaded.json()).members.map((member) => member.username),
    ["bob-reviewer"],
  );

  const removed = await jsonRequest(
    restarted.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer",
    { method: "DELETE", cookie },
  );
  assert.equal(removed.status, 200);
  const afterRemoval = await jsonRequest(
    restarted.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team",
    { cookie },
  );
  assert.deepEqual((await afterRemoval.json()).members, []);
  // The organization membership of the removed team member is untouched.
  const people = await jsonRequest(restarted.baseUrl, "/api/organizations/acme-demo/members", {
    cookie,
  });
  assert.ok((await people.json()).members.some((member) => member.username === "bob-reviewer"));
});
