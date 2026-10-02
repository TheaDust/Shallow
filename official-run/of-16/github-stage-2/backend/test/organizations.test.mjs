import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";
import { canReadRepository } from "../src/domain/repositories.mjs";

const ORG_OWNER = { username: "org-owner", email: "org-owner@example.test", password: "Valid-password-123!" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-organizations-"));
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

async function signIn(baseUrl, identifier, password) {
  const headers = { "content-type": "application/json" };
  const response = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    headers,
    body: JSON.stringify({ identifier, password }),
  });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null };
}

test("seed organization exposes public repositories to a visitor and membership alone adds nothing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const directory = await call(app.baseUrl, "/api/explore/organizations");
  assert.equal(directory.status, 200);
  assert.deepEqual(directory.body.organizations.map((organization) => organization.slug), ["acme-demo"]);

  const overview = await call(app.baseUrl, "/api/organizations/acme-demo");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.organization.name, "Acme Demo");
  assert.equal(overview.body.role, null);

  const list = await call(app.baseUrl, "/api/organizations/acme-demo/repositories");
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.repositories.map((repository) => repository.name),
    ["acme-docs", "branch-switch-demo", "default-branch-demo"],
  );
  const [publicRepository] = list.body.repositories;
  assert.equal(publicRepository.visibility, "public");
  assert.ok(publicRepository.description.length > 0);
  assert.ok(publicRepository.updatedAt);

  // The private repository is invisible to the visitor, both in the list and by name.
  assert.equal(list.body.repositories.some((repository) => repository.name === "secret-research"), false);
  const privateOverview = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/secret-research");
  assert.equal(privateOverview.status, 404);

  const publicOverview = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/acme-docs");
  assert.equal(publicOverview.status, 200);
  assert.equal(publicOverview.body.repository.name, "acme-docs");
  assert.equal(publicOverview.body.repository.organization.name, "Acme Demo");

  // A signed-in account without any grant sees the same public list only.
  const registered = await call(app.baseUrl, "/api/auth/register", {
    method: "POST",
    body: { username: "sam-outsider", email: "sam-outsider@example.test", password: "Valid-password-123!", confirmPassword: "Valid-password-123!", agreeToTerms: true },
  });
  assert.equal(registered.status, 201);
  const signedIn = await signIn(app.baseUrl, "sam-outsider", "Valid-password-123!");
  const memberList = await call(app.baseUrl, "/api/organizations/acme-demo/repositories", { cookie: signedIn.cookie });
  assert.deepEqual(
    memberList.body.repositories.map((repository) => repository.name),
    ["acme-docs", "branch-switch-demo", "default-branch-demo"],
  );
  assert.equal((await call(app.baseUrl, "/api/organizations/acme-demo", { cookie: signedIn.cookie })).body.role, null);
});

test("organization Owner reads every repository and 'Your organizations' lists the membership", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const anonymous = await call(app.baseUrl, "/api/organizations");
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "Sign in required");

  const session = await signIn(app.baseUrl, ORG_OWNER.username, ORG_OWNER.password);
  assert.equal(session.status, 200);

  const mine = await call(app.baseUrl, "/api/organizations", { cookie: session.cookie });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.organizations.length, 1);
  assert.equal(mine.body.organizations[0].slug, "acme-demo");
  assert.equal(mine.body.organizations[0].displayName, "Acme Demo");
  assert.equal(mine.body.organizations[0].role, "owner");

  const list = await call(app.baseUrl, "/api/organizations/acme-demo/repositories", { cookie: session.cookie });
  assert.deepEqual(
    list.body.repositories.map((repository) => repository.name).sort(),
    ["acme-docs", "branch-switch-demo", "default-branch-demo", "secret-research"],
  );

  const privateOverview = await call(
    app.baseUrl,
    "/api/organizations/acme-demo/repositories/secret-research",
    { cookie: session.cookie },
  );
  assert.equal(privateOverview.status, 200);
  assert.equal(privateOverview.body.repository.visibility, "private");

  const members = await call(app.baseUrl, "/api/organizations/acme-demo/members", { cookie: session.cookie });
  assert.deepEqual(members.body.members, [
    { username: "org-owner", role: "owner" },
    { username: "team-maintainer", role: "owner" },
    { username: "bob-reviewer", role: "member" },
    { username: "existing-member", role: "member" },
    { username: "org-member", role: "member" },
    { username: "protected-member", role: "member" },
    { username: "repo-admin", role: "member" },
  ]);
});

// REQ-2-3: the repository Admin reaches its repository through "Your
// organizations" (the organization must be listed for that account) while
// membership alone still never opens another private repository.
test("the seeded repository Admin belongs to the organization without extra private access", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, "repo-admin", "Valid-password-123!");
  assert.equal(session.status, 200);

  const mine = await call(app.baseUrl, "/api/organizations", { cookie: session.cookie });
  assert.deepEqual(
    mine.body.organizations.map((organization) => [organization.slug, organization.role]),
    [["acme-demo", "member"]],
  );

  const visible = await call(app.baseUrl, "/api/organizations/acme-demo/repositories", { cookie: session.cookie });
  assert.deepEqual(
    visible.body.repositories.map((repository) => repository.name),
    ["acme-docs", "branch-switch-demo", "default-branch-demo"],
  );

  const granted = await call(
    app.baseUrl,
    "/api/organizations/acme-demo/repositories/acme-docs",
    { cookie: session.cookie },
  );
  assert.equal(granted.status, 200);
  assert.equal(granted.body.repository.canManageAccess, true);

  const ungrantedPrivate = await call(
    app.baseUrl,
    "/api/organizations/acme-demo/repositories/secret-research",
    { cookie: session.cookie },
  );
  assert.equal(ungrantedPrivate.status, 403);
  assert.equal(ungrantedPrivate.body.error, "Access denied");
});

test("creating an organization stores the object and the Owner membership across reloads", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, ORG_OWNER.email, ORG_OWNER.password);
  const created = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: session.cookie,
    body: { name: "mobile-guild", displayName: "  Mobile Guild  " },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.organization.slug, "mobile-guild");
  assert.equal(created.body.organization.name, "mobile-guild");
  assert.equal(created.body.organization.displayName, "Mobile Guild");

  const overview = await call(app.baseUrl, "/api/organizations/mobile-guild", { cookie: session.cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.organization.name, "mobile-guild");
  assert.equal(overview.body.role, "owner");

  const mine = await call(app.baseUrl, "/api/organizations", { cookie: session.cookie });
  assert.equal(mine.body.organizations.length, 2);

  // A store reopened on the same data directory reads the persisted organization.
  const restarted = createStateStore({ dataDir: app.dataDir });
  const persisted = await restarted.read();
  assert.ok(persisted.organizations.some((organization) => organization.slug === "mobile-guild"));
  const membership = persisted.organizationMembers.find((candidate) => {
    const organization = persisted.organizations.find((item) => item.id === candidate.organizationId);
    return organization?.slug === "mobile-guild";
  });
  assert.equal(membership?.role, "owner");
  const owner = persisted.accounts.find((account) => account.id === membership?.accountId);
  assert.equal(owner.username, "org-owner");
});

test("rejected organization submissions report the exact messages and create nothing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const anonymous = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    body: { name: "anonymous-org", displayName: "Anonymous Org" },
  });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "Sign in required");

  const session = await signIn(app.baseUrl, ORG_OWNER.username, ORG_OWNER.password);

  const duplicate = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: session.cookie,
    body: { name: "Acme Demo", displayName: "" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.errors.name, "Organization name already exists");

  const duplicateSlug = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: session.cookie,
    body: { name: "acme-demo", displayName: "Another Acme" },
  });
  assert.equal(duplicateSlug.status, 400);
  assert.equal(duplicateSlug.body.errors.name, "Organization name already exists");

  const invalid = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: session.cookie,
    body: { name: "-invalid-organization", displayName: "   " },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.errors.name, "Organization name format is invalid");
  assert.equal(invalid.body.errors.displayName, "Display name is required");

  const tooLong = await call(app.baseUrl, "/api/organizations", {
    method: "POST",
    cookie: session.cookie,
    body: { name: "long-name-org", displayName: "x".repeat(101) },
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.errors.displayName, "Display name is invalid");

  const directory = await call(app.baseUrl, "/api/explore/organizations");
  assert.deepEqual(directory.body.organizations.map((organization) => organization.slug), ["acme-demo"]);
});

test("repository read access follows Owner status, direct grants and team grants", () => {
  const state = {
    organizations: [
      { id: "org-1", slug: "acme-demo", name: "Acme Demo" },
      { id: "org-2", slug: "other", name: "other" },
    ],
    organizationMembers: [
      { id: "m1", organizationId: "org-1", accountId: "owner", role: "owner" },
      { id: "m2", organizationId: "org-1", accountId: "member", role: "member" },
    ],
    teams: [
      { id: "team-1", organizationId: "org-1", name: "frontend-team" },
      { id: "team-2", organizationId: "org-2", name: "foreign-team" },
    ],
    teamMembers: [
      { id: "tm1", teamId: "team-1", accountId: "team-member" },
      { id: "tm2", teamId: "team-2", accountId: "foreign-member" },
    ],
    repositoryGrants: [
      { id: "g1", repositoryId: "private-repo", accountId: "granted" },
      { id: "g2", repositoryId: "private-repo", teamId: "team-1" },
      { id: "g3", repositoryId: "private-repo", teamId: "team-2" },
    ],
  };
  const privateRepository = { id: "private-repo", organizationId: "org-1", visibility: "private" };
  const publicRepository = { id: "public-repo", organizationId: "org-1", visibility: "public" };

  assert.equal(canReadRepository(state, publicRepository, null), true);
  assert.equal(canReadRepository(state, privateRepository, null), false);
  assert.equal(canReadRepository(state, privateRepository, "outsider"), false);
  assert.equal(canReadRepository(state, privateRepository, "owner"), true);
  assert.equal(canReadRepository(state, privateRepository, "member"), false);
  assert.equal(canReadRepository(state, privateRepository, "granted"), true);
  assert.equal(canReadRepository(state, privateRepository, "team-member"), true);
  // A grant held by a team of another organization never leaks access.
  assert.equal(canReadRepository(state, privateRepository, "foreign-member"), false);
});
