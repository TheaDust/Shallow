import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";
import { removeOrganizationMember } from "../src/domain/organizations.mjs";

const OWNER = { username: "org-owner", password: "Valid-password-123!" };
const ORG_MEMBER = { username: "org-member", password: "Valid-password-123!" };
const MEMBERS_PATH = "/api/organizations/acme-demo/members";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-members-"));
  const store = createStateStore({ dataDir });
  const app = createApp({ store });
  const server = createServer((request, response) => {
    void app(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    store,
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

async function signIn(baseUrl, identifier, password) {
  const response = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null };
}

test("REQ-2-2-3 an Owner directly adds a non-member account and it persists without private access", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const owner = await signIn(app.baseUrl, OWNER.username, OWNER.password);
  assert.equal(owner.status, 200);

  const added = await call(app.baseUrl, MEMBERS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { identifier: "new-member", role: "member" },
  });
  assert.equal(added.status, 200);
  const addedRow = added.body.members.find((member) => member.username === "new-member");
  assert.deepEqual(addedRow, { username: "new-member", role: "member" });

  // The direct addition has no invitation state: the membership is stored at once.
  const restarted = createStateStore({ dataDir: app.dataDir });
  const persisted = await restarted.read();
  const organization = persisted.organizations.find((candidate) => candidate.slug === "acme-demo");
  const account = persisted.accounts.find((candidate) => candidate.username === "new-member");
  const membership = persisted.organizationMembers.find((candidate) => (
    candidate.organizationId === organization.id && candidate.accountId === account.id
  ));
  assert.equal(membership?.role, "member");
  assert.equal(membership?.status, undefined);

  // After signing in, the organization appears under "Your organizations".
  const member = await signIn(app.baseUrl, "new-member@example.test", "Valid-password-123!");
  assert.equal(member.status, 200);
  const mine = await call(app.baseUrl, "/api/organizations", { cookie: member.cookie });
  assert.deepEqual(mine.body.organizations.map((entry) => entry.slug), ["acme-demo"]);
  assert.equal(mine.body.organizations[0].role, "member");

  // Membership alone still does not grant the ungranted private repository.
  const denied = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/secret-research", {
    cookie: member.cookie,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Access denied");
  const visible = await call(app.baseUrl, "/api/organizations/acme-demo/repositories", { cookie: member.cookie });
  assert.deepEqual(visible.body.repositories.map((repository) => repository.name), ["acme-docs"]);
});

test("REQ-2-2-3 a duplicate or unknown identifier reports the exact message and stores nothing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const owner = await signIn(app.baseUrl, OWNER.username, OWNER.password);
  const before = await call(app.baseUrl, MEMBERS_PATH, { cookie: owner.cookie });

  const duplicate = await call(app.baseUrl, MEMBERS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { identifier: "existing-member", role: "member" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.errors.identifier, "Account is already a member");

  const duplicateByEmail = await call(app.baseUrl, MEMBERS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { identifier: "existing-member@example.test" },
  });
  assert.equal(duplicateByEmail.status, 400);
  assert.equal(duplicateByEmail.body.errors.identifier, "Account is already a member");

  const unknown = await call(app.baseUrl, MEMBERS_PATH, {
    method: "POST",
    cookie: owner.cookie,
    body: { identifier: "unknown-reviewer", role: "member" },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.errors.identifier, "Account not found");

  const after = await call(app.baseUrl, MEMBERS_PATH, { cookie: owner.cookie });
  assert.deepEqual(after.body.members, before.body.members);
  assert.equal(after.body.members.filter((entry) => entry.username === "existing-member").length, 1);
});

test("REQ-2-2-4 only an organization Owner may add or remove members", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const anonymous = await call(app.baseUrl, MEMBERS_PATH, {
    method: "POST",
    body: { identifier: "new-member", role: "member" },
  });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "Sign in required");

  const member = await signIn(app.baseUrl, ORG_MEMBER.username, ORG_MEMBER.password);
  assert.equal(member.status, 200);

  const added = await call(app.baseUrl, MEMBERS_PATH, {
    method: "POST",
    cookie: member.cookie,
    body: { identifier: "new-member", role: "member" },
  });
  assert.equal(added.status, 403);
  assert.equal(added.body.error, "Access denied");

  const removed = await call(app.baseUrl, `${MEMBERS_PATH}/existing-member`, {
    method: "DELETE",
    cookie: member.cookie,
  });
  assert.equal(removed.status, 403);
  assert.equal(removed.body.error, "Access denied");

  const anonymousRemoval = await call(app.baseUrl, `${MEMBERS_PATH}/existing-member`, { method: "DELETE" });
  assert.equal(anonymousRemoval.status, 401);

  const members = await call(app.baseUrl, MEMBERS_PATH, { cookie: member.cookie });
  assert.ok(members.body.members.some((entry) => entry.username === "existing-member"));
});

test("REQ-2-2-4 confirmed removal drops the membership and the team membership with it", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const owner = await signIn(app.baseUrl, OWNER.username, OWNER.password);

  // protected-member joins a team, so the removal has a team relationship to clean up.
  const teamAdded = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team/members", {
    method: "POST",
    cookie: owner.cookie,
    body: { username: "protected-member" },
  });
  assert.equal(teamAdded.status, 200);

  // The same account also belongs to a different organization.
  const other = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "second-org", displayName: "Second Org" },
  });
  assert.equal(other.status, 201);
  const otherAdded = await call(app.baseUrl, "/api/organizations/second-org/members", {
    method: "POST",
    cookie: owner.cookie,
    body: { identifier: "protected-member", role: "member" },
  });
  assert.equal(otherAdded.status, 200);

  const removed = await call(app.baseUrl, `${MEMBERS_PATH}/protected-member`, {
    method: "DELETE",
    cookie: owner.cookie,
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.members.some((entry) => entry.username === "protected-member"), false);

  const restarted = createStateStore({ dataDir: app.dataDir });
  const persisted = await restarted.read();
  const acme = persisted.organizations.find((candidate) => candidate.slug === "acme-demo");
  const second = persisted.organizations.find((candidate) => candidate.slug === "second-org");
  const account = persisted.accounts.find((candidate) => candidate.username === "protected-member");
  assert.ok(account, "the account itself is never deleted");
  assert.equal(persisted.organizationMembers.some((candidate) => (
    candidate.organizationId === acme.id && candidate.accountId === account.id
  )), false);
  assert.equal(persisted.organizationMembers.some((candidate) => (
    candidate.organizationId === second.id && candidate.accountId === account.id
  )), true, "memberships of other organizations stay");

  const frontendTeam = persisted.teams.find((team) => team.name === "frontend-team");
  assert.equal(persisted.teamMembers.some((candidate) => (
    candidate.teamId === frontendTeam.id && candidate.accountId === account.id
  )), false);
});

test("REQ-2-2-4 removing the last Owner is rejected and keeps every relationship", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const owner = await signIn(app.baseUrl, OWNER.username, OWNER.password);
  const created = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "solo-org", displayName: "Solo Org" },
  });
  assert.equal(created.status, 201);

  const rejected = await call(app.baseUrl, "/api/organizations/solo-org/members/org-owner", {
    method: "DELETE",
    cookie: owner.cookie,
  });
  assert.equal(rejected.status, 400);

  const members = await call(app.baseUrl, "/api/organizations/solo-org/members", { cookie: owner.cookie });
  assert.deepEqual(members.body.members, [{ username: "org-owner", role: "owner" }]);

  const mine = await call(app.baseUrl, "/api/organizations", { cookie: owner.cookie });
  assert.ok(mine.body.organizations.some((entry) => entry.slug === "solo-org"));
});

test("removing a member deletes its direct grants but keeps the grants held by teams", () => {
  const state = {
    accounts: [
      { id: "acc-1", username: "existing-member", email: "existing-member@example.test" },
      { id: "acc-2", username: "outsider", email: "outsider@example.test" },
    ],
    organizations: [{ id: "org-1", slug: "acme-demo" }],
    organizationMembers: [
      { id: "m1", organizationId: "org-1", accountId: "acc-1", role: "member" },
      { id: "m2", organizationId: "org-1", accountId: "acc-owner", role: "owner" },
    ],
    teams: [
      { id: "team-1", organizationId: "org-1", name: "frontend-team" },
      { id: "team-2", organizationId: "org-2", name: "other-team" },
    ],
    teamMembers: [
      { id: "tm1", teamId: "team-1", accountId: "acc-1" },
      { id: "tm2", teamId: "team-2", accountId: "acc-1" },
    ],
    repositories: [
      { id: "repo-1", organizationId: "org-1", visibility: "private" },
      { id: "repo-2", organizationId: "org-2", visibility: "private" },
    ],
    repositoryGrants: [
      { id: "g1", repositoryId: "repo-1", accountId: "acc-1" },
      { id: "g2", repositoryId: "repo-2", accountId: "acc-1" },
      { id: "g3", repositoryId: "repo-1", teamId: "team-1" },
    ],
  };

  const result = removeOrganizationMember(state, state.organizations[0], "existing-member");
  assert.equal(result.errors, undefined);
  assert.equal(state.organizationMembers.some((membership) => membership.accountId === "acc-1"), false);
  assert.deepEqual(state.teamMembers.map((membership) => membership.id), ["tm2"]);
  assert.deepEqual(state.repositoryGrants.map((grant) => grant.id), ["g2", "g3"]);
  assert.equal(state.accounts.length, 2);

  const unknown = removeOrganizationMember(state, state.organizations[0], "does-not-exist");
  assert.equal(unknown.errors.identifier, "Account not found");
  const nonMember = removeOrganizationMember(state, state.organizations[0], "outsider");
  assert.equal(nonMember.errors.identifier, "Account is not an organization member");
});
