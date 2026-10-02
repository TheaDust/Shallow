import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

const OWNER = { username: "org-owner", password: "Valid-password-123!" };
const TEAM_MAINTAINER = { username: "team-maintainer", password: "Valid-password-123!" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-teams-"));
  const store = createStateStore({ dataDir });
  const app = createApp({ store });
  const server = createServer((request, response) => {
    void app(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function call(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function signIn(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: username, password }),
  });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null };
}

const TEAMS_PATH = "/api/organizations/acme-demo/teams";

test("seeded team hierarchy is stored and survives a restart", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const teams = await call(app.baseUrl, TEAMS_PATH);
  assert.equal(teams.status, 200);
  const byName = new Map(teams.body.teams.map((team) => [team.name, team]));
  assert.deepEqual(
    [...byName.keys()].sort(),
    ["access-role-team", "frontend-child", "frontend-team", "platform-team"],
  );
  assert.equal(byName.get("platform-team").parentTeamId, null);
  assert.equal(byName.get("frontend-team").parentTeamId, byName.get("platform-team").id);
  assert.equal(byName.get("frontend-child").parentTeamId, byName.get("frontend-team").id);

  // A fresh store over the same data directory reads the same hierarchy.
  const restarted = createStateStore({ dataDir: app.dataDir });
  const state = await restarted.read();
  const stored = new Map(state.teams.map((team) => [team.name, team]));
  assert.equal(stored.get("frontend-team").parentTeamId, stored.get("platform-team").id);
  assert.equal(stored.get("frontend-child").parentTeamId, stored.get("frontend-team").id);
  const org = state.organizations.find((candidate) => candidate.slug === "acme-demo");
  assert.ok(state.teams.every((team) => team.organizationId === org.id));
});

test("an Owner creates a valid team and a malformed name is rejected with the exact message", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const anonymous = await call(app.baseUrl, TEAMS_PATH, { method: "POST", body: { name: "anonymous-team" } });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "Sign in required");

  const owner = await signIn(app.baseUrl, OWNER.username, OWNER.password);
  const invalid = await call(app.baseUrl, TEAMS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "-invalid-team" },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.errors.name, "Team name is invalid");

  const trailing = await call(app.baseUrl, TEAMS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "invalid-team-" },
  });
  assert.equal(trailing.status, 400);
  assert.equal(trailing.body.errors.name, "Team name is invalid");

  const upper = await call(app.baseUrl, TEAMS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Mobile-Team" },
  });
  assert.equal(upper.status, 400);
  assert.equal(upper.body.errors.name, "Team name is invalid");

  const created = await call(app.baseUrl, TEAMS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "mobile-team" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.team.name, "mobile-team");
  assert.equal(created.body.team.parentTeamId, null);

  const duplicate = await call(app.baseUrl, TEAMS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "mobile-team" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.errors.name, "Team name already exists");

  const overview = await call(app.baseUrl, `${TEAMS_PATH}/mobile-team`, { cookie: owner.cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.team.name, "mobile-team");
  assert.equal(overview.body.organization.name, "Acme Demo");
  assert.equal(overview.body.role, "owner");

  const list = await call(app.baseUrl, TEAMS_PATH);
  const names = list.body.teams.map((team) => team.name);
  assert.ok(names.includes("mobile-team"));
  assert.equal(names.includes("-invalid-team"), false);
  assert.equal(names.includes("invalid-team-"), false);

  // The name space is scoped to one organization: another organization can reuse it.
  const other = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "second-org", displayName: "Second Org" },
  });
  assert.equal(other.status, 201);
  const sameInOther = await call(app.baseUrl, "/api/organizations/second-org/teams", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "mobile-team" },
  });
  assert.equal(sameInOther.status, 201);
});

test("only an organization Owner may create teams or change the team hierarchy", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const outsider = await call(app.baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      username: "sam-outsider",
      email: "sam-outsider@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
  });
  assert.equal(outsider.status, 201);
  const session = await signIn(app.baseUrl, "sam-outsider", "Valid-password-123!");

  const created = await call(app.baseUrl, TEAMS_PATH, {
    method: "POST",
    cookie: session.cookie,
    body: { name: "outsider-team" },
  });
  assert.equal(created.status, 403);
  assert.equal(created.body.error, "Access denied");

  const removed = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team/members/bob-reviewer`, {
    method: "DELETE",
    cookie: session.cookie,
  });
  assert.equal(removed.status, 403);

  const list = await call(app.baseUrl, TEAMS_PATH);
  assert.equal(list.body.teams.some((team) => team.name === "outsider-team"), false);

  // The team overview is readable, but reports the viewer's organization role.
  const overview = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team`, { cookie: session.cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.role, null);
});

test("team membership is added and removed independently of the organization membership", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const maintainer = await signIn(app.baseUrl, TEAM_MAINTAINER.username, TEAM_MAINTAINER.password);
  assert.equal(maintainer.status, 200);

  const before = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team/members`, { cookie: maintainer.cookie });
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.members, []);

  const unknown = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team/members`, {
    method: "POST",
    cookie: maintainer.cookie,
    body: { username: "ghost-account" },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.errors.username, "Account not found");

  const nonMember = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team/members`, {
    method: "POST",
    cookie: maintainer.cookie,
    body: { username: "alice-dev" },
  });
  assert.equal(nonMember.status, 400);
  assert.equal(nonMember.body.errors.username, "Account is not an organization member");

  const added = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team/members`, {
    method: "POST",
    cookie: maintainer.cookie,
    body: { username: "bob-reviewer" },
  });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.members, [{ username: "bob-reviewer" }]);

  // The hierarchy never copies members between related teams.
  const parentMembers = await call(app.baseUrl, `${TEAMS_PATH}/platform-team/members`, { cookie: maintainer.cookie });
  assert.deepEqual(parentMembers.body.members, []);

  const reloaded = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team/members`, { cookie: maintainer.cookie });
  assert.deepEqual(reloaded.body.members, [{ username: "bob-reviewer" }]);

  const removed = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team/members/bob-reviewer`, {
    method: "DELETE",
    cookie: maintainer.cookie,
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.members, []);

  const after = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team/members`, { cookie: maintainer.cookie });
  assert.deepEqual(after.body.members, []);
  // The removed account is still an organization member.
  const members = await call(app.baseUrl, "/api/organizations/acme-demo/members", { cookie: maintainer.cookie });
  assert.ok(members.body.members.some((member) => member.username === "bob-reviewer"));
});

test("a parent change that would create a cycle is rejected and keeps the saved parent", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const maintainer = await signIn(app.baseUrl, TEAM_MAINTAINER.username, TEAM_MAINTAINER.password);

  const overview = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team`, { cookie: maintainer.cookie });
  assert.equal(overview.body.parentTeam.name, "platform-team");
  const optionNames = overview.body.teams.map((team) => team.name);
  assert.deepEqual(
    optionNames.sort(),
    ["access-role-team", "frontend-child", "frontend-team", "platform-team"],
  );

  const cycle = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team`, {
    method: "PATCH",
    cookie: maintainer.cookie,
    body: { parentTeamName: "frontend-child" },
  });
  assert.equal(cycle.status, 400);
  assert.equal(cycle.body.errors.parentTeam, "Cyclic team hierarchy is not allowed");

  const self = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team`, {
    method: "PATCH",
    cookie: maintainer.cookie,
    body: { parentTeamName: "frontend-team" },
  });
  assert.equal(self.status, 400);
  assert.equal(self.body.errors.parentTeam, "Cyclic team hierarchy is not allowed");

  // The previously saved parent is untouched after the rejection.
  const afterCycle = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team`, { cookie: maintainer.cookie });
  assert.equal(afterCycle.body.parentTeam.name, "platform-team");
  const restarted = createStateStore({ dataDir: app.dataDir });
  const persisted = await restarted.read();
  const frontendTeam = persisted.teams.find((team) => team.name === "frontend-team");
  const platformTeam = persisted.teams.find((team) => team.name === "platform-team");
  assert.equal(frontendTeam.parentTeamId, platformTeam.id);

  // A valid change is saved, an empty value clears the parent, and a team of
  // another organization is never an acceptable parent.
  const moved = await call(app.baseUrl, `${TEAMS_PATH}/frontend-child`, {
    method: "PATCH",
    cookie: maintainer.cookie,
    body: { parentTeamName: "platform-team" },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.team.parentTeamId, platformTeam.id);

  const cleared = await call(app.baseUrl, `${TEAMS_PATH}/frontend-child`, {
    method: "PATCH",
    cookie: maintainer.cookie,
    body: { parentTeamName: "" },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.team.parentTeamId, null);

  const other = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: maintainer.cookie,
    body: { name: "second-org", displayName: "Second Org" },
  });
  assert.equal(other.status, 201);
  await call(app.baseUrl, "/api/organizations/second-org/teams", {
    method: "POST",
    cookie: maintainer.cookie,
    body: { name: "foreign-team" },
  });
  const foreign = await call(app.baseUrl, `${TEAMS_PATH}/frontend-team`, {
    method: "PATCH",
    cookie: maintainer.cookie,
    body: { parentTeamName: "foreign-team" },
  });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.errors.parentTeam, "Parent team is invalid");
});

test("an unknown team address answers 404", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const missing = await call(app.baseUrl, `${TEAMS_PATH}/does-not-exist`);
  assert.equal(missing.status, 404);
  const missingOfMissingOrganization = await call(app.baseUrl, "/api/organizations/nope/teams/nope");
  assert.equal(missingOfMissingOrganization.status, 404);
});
