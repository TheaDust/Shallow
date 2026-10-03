import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startServer() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallow-org-"));
  const handler = await createRequestHandler({ dataDir, staticRoot: dataDir });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    dataDir,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function request(baseUrl, method, path, { body, cookies = "" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookies ? { cookie: cookies } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    payload: text ? JSON.parse(text) : null,
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  };
}

async function signIn(baseUrl, identifier) {
  const response = await request(baseUrl, "POST", "/api/signin", {
    body: { identifier, password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200, `sign-in failed for ${identifier}`);
  return response.cookie;
}

test("a visitor only discovers public organization repositories", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const publicList = await request(app.baseUrl, "GET", "/api/public/organizations");
  assert.equal(publicList.status, 200);
  assert.deepEqual(publicList.payload.organizations, [
    { name: "acme-demo", displayName: "Acme Demo" },
    { name: "demo-labs", displayName: "Demo Labs" },
  ]);

  const repositories = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories");
  assert.equal(repositories.status, 200);
  assert.deepEqual(
    repositories.payload.repositories.map((repository) => [repository.name, repository.visibility]),
    [["acme-docs", "public"]],
  );

  const publicRepository = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/acme-docs");
  assert.equal(publicRepository.status, 200);
  assert.equal(publicRepository.payload.repository.name, "acme-docs");
  assert.equal(publicRepository.payload.organization.displayName, "Acme Demo");
  assert.ok(publicRepository.payload.repository.updatedAt);

  // The private repository is never readable by a visitor, even by direct URL.
  const privateRepository = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/secret-research");
  assert.equal(privateRepository.status, 403);
  assert.equal(privateRepository.payload.error, "Access denied");
});

test("an organization Owner additionally reads the private repository", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const cookie = await signIn(app.baseUrl, "org-owner");
  const repositories = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories", { cookies: cookie });
  assert.deepEqual(
    repositories.payload.repositories.map((repository) => repository.name),
    ["acme-docs", "secret-research", "visibility-demo"],
  );
  assert.equal(repositories.payload.viewer.role, "owner");

  const privateRepository = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/secret-research", {
    cookies: cookie,
  });
  assert.equal(privateRepository.status, 200);
});

test("plain organization membership does not grant the private repository", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const cookie = await signIn(app.baseUrl, "bob-reviewer");
  const repositories = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories", { cookies: cookie });
  assert.deepEqual(
    repositories.payload.repositories.map((repository) => repository.name),
    ["acme-docs"],
  );

  const privateRepository = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/secret-research", {
    cookies: cookie,
  });
  assert.equal(privateRepository.status, 403);
  assert.equal(privateRepository.payload.error, "Access denied");
});

test("organization creation validates duplicates, format and display name", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "org-owner");

  const duplicate = await request(app.baseUrl, "POST", "/api/organizations", {
    cookies: cookie,
    body: { name: "Acme Demo", displayName: "" },
  });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.payload.errors.name, "Organization name already exists");

  const invalid = await request(app.baseUrl, "POST", "/api/organizations", {
    cookies: cookie,
    body: { name: "-invalid-organization", displayName: "   " },
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.payload.errors.name, "Organization name format is invalid");
  assert.equal(invalid.payload.errors.displayName, "Display name is required");

  const created = await request(app.baseUrl, "POST", "/api/organizations", {
    cookies: cookie,
    body: { name: "mobile-guild", displayName: "Mobile Guild" },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.payload.organization, { name: "mobile-guild", displayName: "Mobile Guild" });

  const mine = await request(app.baseUrl, "GET", "/api/organizations", { cookies: cookie });
  assert.deepEqual(
    mine.payload.organizations.map((organization) => [organization.name, organization.role]),
    [["acme-demo", "owner"], ["mobile-guild", "owner"]],
  );

  // The rejected submissions created nothing, and the organization survives a
  // restart of the same data directory.
  const handler = await createRequestHandler({ dataDir: app.dataDir, staticRoot: app.dataDir });
  const server = createServer((request2, response2) => void handler(request2, response2));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const restarted = `http://127.0.0.1:${server.address().port}`;

  const persisted = await request(restarted, "GET", "/api/organizations/mobile-guild");
  assert.equal(persisted.status, 200);
  assert.equal(persisted.payload.organization.displayName, "Mobile Guild");
  const total = await request(restarted, "GET", "/api/public/organizations");
  assert.deepEqual(
    total.payload.organizations.map((organization) => organization.name),
    ["acme-demo", "demo-labs"],
  );
});

test("team creation validates the name and requires an Owner", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await signIn(app.baseUrl, "org-owner");

  const invalid = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", {
    cookies: owner,
    body: { name: "-invalid-team" },
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.payload.errors.name, "Team name is invalid");

  const created = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", {
    cookies: owner,
    body: { name: "mobile-team" },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.payload.team, { name: "mobile-team", parentTeamName: null });

  const duplicate = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", {
    cookies: owner,
    body: { name: "mobile-team" },
  });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.payload.errors.name, "Team name already exists");

  const teams = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams", { cookies: owner });
  assert.deepEqual(
    teams.payload.teams.map((team) => [team.name, team.parentTeamName]),
    [
      ["access-role-team", null],
      ["frontend-child", "frontend-team"],
      ["frontend-team", "platform-team"],
      ["mobile-team", null],
      ["platform-team", null],
    ],
  );

  // A plain member can read the list but cannot create a team.
  const member = await signIn(app.baseUrl, "bob-reviewer");
  const denied = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", {
    cookies: member,
    body: { name: "member-team" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.error, "Access denied");
});

test("team members can be added and removed", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await signIn(app.baseUrl, "team-maintainer");

  const before = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team/members", {
    cookies: owner,
  });
  assert.deepEqual(before.payload.members, []);
  assert.equal(before.payload.canManage, true);

  const added = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams/frontend-team/members", {
    cookies: owner,
    body: { username: "bob-reviewer" },
  });
  assert.equal(added.status, 201);
  assert.deepEqual(added.payload.members, [{ username: "bob-reviewer" }]);

  // A non-member account cannot be added to a team.
  const outsider = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams/frontend-team/members", {
    cookies: owner,
    body: { username: "alice-dev" },
  });
  assert.equal(outsider.status, 422);
  assert.equal(outsider.payload.error, "Account is not an organization member");

  const removed = await request(app.baseUrl, "DELETE", "/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer", {
    cookies: owner,
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.payload.members, []);

  const after = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team/members", {
    cookies: owner,
  });
  assert.deepEqual(after.payload.members, []);
});

test("a cyclic parent team change is rejected and keeps the saved parent", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await signIn(app.baseUrl, "team-maintainer");

  const team = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team", { cookies: owner });
  assert.equal(team.payload.team.parentTeamName, "platform-team");
  assert.deepEqual(
    team.payload.teams.map((option) => option.name),
    ["access-role-team", "frontend-child", "platform-team"],
  );

  const cyclic = await request(app.baseUrl, "PUT", "/api/organizations/acme-demo/teams/frontend-team", {
    cookies: owner,
    body: { parentTeam: "frontend-child" },
  });
  assert.equal(cyclic.status, 422);
  assert.equal(cyclic.payload.error, "Cyclic team hierarchy is not allowed");

  const after = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team", { cookies: owner });
  assert.equal(after.payload.team.parentTeamName, "platform-team");

  const saved = await request(app.baseUrl, "PUT", "/api/organizations/acme-demo/teams/frontend-team", {
    cookies: owner,
    body: { parentTeam: "" },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.team.parentTeamName, null);
});

test("organization pages are readable by members only where required", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const anonymousTeams = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams");
  assert.equal(anonymousTeams.status, 403);

  const anonymousOverview = await request(app.baseUrl, "GET", "/api/organizations/acme-demo");
  assert.equal(anonymousOverview.status, 200);
  assert.equal(anonymousOverview.payload.viewer.role, null);

  const member = await signIn(app.baseUrl, "bob-reviewer");
  const people = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/members", { cookies: member });
  assert.deepEqual(people.payload.members, [
    { username: "bob-reviewer", role: "member" },
    { username: "existing-member", role: "member" },
    { username: "org-member", role: "member" },
    { username: "org-owner", role: "owner" },
    { username: "protected-member", role: "member" },
    { username: "team-maintainer", role: "owner" },
  ]);

  const missing = await request(app.baseUrl, "GET", "/api/organizations/unknown-org");
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error, "Organization not found");
});
