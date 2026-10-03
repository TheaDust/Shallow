import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startServer() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallow-access-"));
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

test("an Owner directly adds a registered account as a member", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await signIn(app.baseUrl, "org-owner");

  const added = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/members", {
    cookies: owner,
    body: { identifier: "new-member", role: "member" },
  });
  assert.equal(added.status, 201);
  assert.deepEqual(
    added.payload.members.find((member) => member.username === "new-member"),
    { username: "new-member", role: "member" },
  );

  // The membership is saved immediately and survives a reload of the reader.
  const reloaded = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/members", { cookies: owner });
  assert.ok(reloaded.payload.members.some((member) => member.username === "new-member"));

  // The new member sees the organization but gets no access to the private repository.
  const member = await signIn(app.baseUrl, "new-member");
  const mine = await request(app.baseUrl, "GET", "/api/organizations", { cookies: member });
  assert.deepEqual(
    mine.payload.organizations.map((organization) => organization.name),
    ["acme-demo"],
  );
  const denied = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/secret-research", {
    cookies: member,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.error, "Access denied");
});

test("adding a member accepts an email and rejects duplicates and unknown accounts", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await signIn(app.baseUrl, "org-owner");

  const duplicate = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/members", {
    cookies: owner,
    body: { identifier: "existing-member@example.test", role: "member" },
  });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.payload.error, "Account is already a member");

  const unknown = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/members", {
    cookies: owner,
    body: { identifier: "unknown-reviewer", role: "member" },
  });
  assert.equal(unknown.status, 422);
  assert.equal(unknown.payload.error, "Account not found");

  // A plain member cannot add anyone.
  const member = await signIn(app.baseUrl, "bob-reviewer");
  const forbidden = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/members", {
    cookies: member,
    body: { identifier: "new-member", role: "member" },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.payload.error, "Access denied");

  const people = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/members", { cookies: owner });
  assert.equal(people.payload.members.filter((entry) => entry.username === "existing-member").length, 1);
  assert.ok(!people.payload.members.some((entry) => entry.username === "unknown-reviewer"));
});

test("removing a member atomically drops memberships and keeps team grants", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await signIn(app.baseUrl, "org-owner");

  // Build up the relationships a removal must clean up: a team membership and a
  // direct repository grant for the account being removed.
  await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams/frontend-team/members", {
    cookies: owner,
    body: { username: "bob-reviewer" },
  });
  const statePath = join(app.dataDir, "organizations.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.repositoryGrants.push({
    id: "grant-test-bob",
    repositoryId: "repo-acme-demo-secret-research",
    accountId: "account-bob-reviewer",
    role: "read",
    createdAt: "2024-03-03T00:00:00.000Z",
  });
  await writeFile(statePath, JSON.stringify(state));

  const removed = await request(app.baseUrl, "DELETE", "/api/organizations/acme-demo/members/bob-reviewer", {
    cookies: owner,
  });
  assert.equal(removed.status, 200);
  assert.ok(!removed.payload.members.some((member) => member.username === "bob-reviewer"));

  const teamMembers = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team/members", {
    cookies: owner,
  });
  assert.deepEqual(teamMembers.payload.members, []);

  const after = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(!after.repositoryGrants.some((grant) => grant.accountId === "account-bob-reviewer"));
  // Team grants themselves are retained.
  assert.ok(after.repositoryGrants.some((grant) => grant.id === "grant-acme-docs-access-role-team"));

  // The account itself is untouched: it can still sign in.
  const cookie = await signIn(app.baseUrl, "bob-reviewer");
  assert.ok(cookie.length > 0);
});

test("removal is rejected when it would leave the organization without an Owner", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await signIn(app.baseUrl, "org-owner");

  const other = await request(app.baseUrl, "DELETE", "/api/organizations/acme-demo/members/team-maintainer", {
    cookies: owner,
  });
  assert.equal(other.status, 200);

  const rejected = await request(app.baseUrl, "DELETE", "/api/organizations/acme-demo/members/org-owner", {
    cookies: owner,
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.payload.error, "An organization must keep at least one Owner");

  const people = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/members", { cookies: owner });
  assert.ok(people.payload.members.some((member) => member.username === "org-owner" && member.role === "owner"));
});

test("a non-Owner cannot see or change organization members", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const member = await signIn(app.baseUrl, "org-member");

  // The member may read the People list but has no management controls.
  const people = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/members", { cookies: member });
  assert.equal(people.status, 200);
  assert.equal(people.payload.canManage, false);
  assert.ok(people.payload.members.some((entry) => entry.username === "protected-member"));

  const removed = await request(app.baseUrl, "DELETE", "/api/organizations/acme-demo/members/protected-member", {
    cookies: member,
  });
  assert.equal(removed.status, 403);
  assert.equal(removed.payload.error, "Access denied");
});

test("a repository Admin lists, grants and updates team access", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const admin = await signIn(app.baseUrl, "repo-admin");

  const before = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/acme-docs/access", {
    cookies: admin,
  });
  assert.equal(before.status, 200);
  assert.equal(before.payload.canManage, true);
  assert.deepEqual(
    before.payload.grants.map((grant) => [grant.name, grant.role]).sort(),
    [
      ["access-role-team", "write"],
      ["repo-admin", "admin"],
    ],
  );
  assert.deepEqual(before.payload.teams.map((team) => team.name), [
    "access-role-team",
    "frontend-child",
    "frontend-team",
    "platform-team",
  ]);

  const added = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/repositories/acme-docs/access", {
    cookies: admin,
    body: { teamName: "frontend-team", role: "write" },
  });
  assert.equal(added.status, 201);
  assert.deepEqual(
    added.payload.grants.map((grant) => [grant.name, grant.role]).sort(),
    [
      ["access-role-team", "write"],
      ["frontend-team", "write"],
      ["repo-admin", "admin"],
    ],
  );

  const grant = added.payload.grants.find((entry) => entry.name === "access-role-team");
  const saved = await request(
    app.baseUrl,
    "PUT",
    `/api/organizations/acme-demo/repositories/acme-docs/access/${grant.id}`,
    { cookies: admin, body: { role: "read" } },
  );
  assert.equal(saved.status, 200);
  const rows = saved.payload.grants.filter((entry) => entry.name === "access-role-team");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "read");
});

test("a non-Admin cannot read or change repository access", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const member = await signIn(app.baseUrl, "bob-reviewer");

  const read = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/acme-docs/access", {
    cookies: member,
  });
  assert.equal(read.status, 403);
  assert.equal(read.payload.error, "Access denied");

  const write = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/repositories/acme-docs/access", {
    cookies: member,
    body: { teamName: "frontend-team", role: "write" },
  });
  assert.equal(write.status, 403);
});
