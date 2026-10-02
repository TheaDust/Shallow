import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

const REPO_ADMIN = { username: "repo-admin", password: "Valid-password-123!" };
const ORG_OWNER = { username: "org-owner", password: "Valid-password-123!" };
const ORG_MEMBER = { username: "bob-reviewer", password: "Valid-password-123!" };

const ACCESS_PATH = "/api/organizations/acme-demo/repositories/acme-docs/access";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-repo-access-"));
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

async function signIn(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: username, password }),
  });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null };
}

test("seed pre-provisions a repository Admin and a Write team grant without duplicating it", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const repoAdmin = await signIn(app.baseUrl, REPO_ADMIN.username, REPO_ADMIN.password);
  assert.equal(repoAdmin.status, 200);

  const access = await call(app.baseUrl, ACCESS_PATH, { cookie: repoAdmin.cookie });
  assert.equal(access.status, 200);
  assert.equal(access.body.canManageAccess, true);

  const teamRows = access.body.grants.filter((grant) => grant.kind === "team");
  assert.deepEqual(teamRows, [{ id: "seed-grant-acme-demo-acme-docs-access-role-team", kind: "team", name: "access-role-team", role: "write" }]);
  // frontend-team is pre-seeded without any direct grant on acme-docs.
  assert.equal(access.body.grants.some((grant) => grant.name === "frontend-team"), false);
  assert.ok(access.body.grants.some((grant) => grant.kind === "account" && grant.name === "repo-admin" && grant.role === "admin"));
  assert.ok(access.body.teams.some((team) => team.name === "frontend-team"));
});

test("scenario 1: adding a team with Write shows the exact name and role and survives a reload", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const repoAdmin = await signIn(app.baseUrl, REPO_ADMIN.username, REPO_ADMIN.password);

  const added = await call(app.baseUrl, ACCESS_PATH, {
    method: "POST",
    cookie: repoAdmin.cookie,
    body: { teamName: "frontend-team", role: "write" },
  });
  assert.equal(added.status, 200);
  const row = added.body.grants.find((grant) => grant.name === "frontend-team");
  assert.deepEqual({ kind: row.kind, name: row.name, role: row.role }, { kind: "team", name: "frontend-team", role: "write" });

  // Reloading the access list reads the stored grant back.
  const reloaded = await call(app.baseUrl, ACCESS_PATH, { cookie: repoAdmin.cookie });
  const persisted = reloaded.body.grants.filter((grant) => grant.name === "frontend-team");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].role, "write");

  // Adding the same team again updates the same record instead of duplicating it.
  const updated = await call(app.baseUrl, ACCESS_PATH, {
    method: "POST",
    cookie: repoAdmin.cookie,
    body: { teamName: "frontend-team", role: "maintain" },
  });
  assert.equal(updated.body.grants.filter((grant) => grant.name === "frontend-team").length, 1);
});

test("scenario 2: saving a role changes the single existing row from Write to Read", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const repoAdmin = await signIn(app.baseUrl, REPO_ADMIN.username, REPO_ADMIN.password);
  const access = await call(app.baseUrl, ACCESS_PATH, { cookie: repoAdmin.cookie });
  const target = access.body.grants.find((grant) => grant.name === "access-role-team");
  assert.equal(target.role, "write");

  const saved = await call(app.baseUrl, `${ACCESS_PATH}/${target.id}`, {
    method: "PATCH",
    cookie: repoAdmin.cookie,
    body: { role: "read" },
  });
  assert.equal(saved.status, 200);
  const rows = saved.body.grants.filter((grant) => grant.name === "access-role-team");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "read");

  // A restart over the same data directory keeps the changed role.
  const restarted = createStateStore({ dataDir: app.dataDir });
  const state = await restarted.read();
  const storedGrant = state.repositoryGrants.find((grant) => grant.id === target.id);
  assert.equal(storedGrant.role, "read");
  assert.equal(state.repositoryGrants.filter((grant) => grant.teamId).length, 1);
});

test("access management is limited to an organization Owner or a repository Admin", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const anonymous = await call(app.baseUrl, ACCESS_PATH);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "Sign in required");

  const member = await signIn(app.baseUrl, ORG_MEMBER.username, ORG_MEMBER.password);
  const denied = await call(app.baseUrl, ACCESS_PATH, { cookie: member.cookie });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Access denied");

  const memberWrite = await call(app.baseUrl, ACCESS_PATH, {
    method: "POST",
    cookie: member.cookie,
    body: { teamName: "frontend-team", role: "write" },
  });
  assert.equal(memberWrite.status, 403);

  // An organization Owner manages access without holding an explicit Admin grant.
  const owner = await signIn(app.baseUrl, ORG_OWNER.username, ORG_OWNER.password);
  const ownerAccess = await call(app.baseUrl, ACCESS_PATH, { cookie: owner.cookie });
  assert.equal(ownerAccess.status, 200);

  const missingRepository = await call(
    app.baseUrl,
    "/api/organizations/acme-demo/repositories/not-a-repository/access",
    { cookie: owner.cookie },
  );
  assert.equal(missingRepository.status, 404);
});

test("an unknown team name and an unknown grant id are rejected without writing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const repoAdmin = await signIn(app.baseUrl, REPO_ADMIN.username, REPO_ADMIN.password);

  const unknownTeam = await call(app.baseUrl, ACCESS_PATH, {
    method: "POST",
    cookie: repoAdmin.cookie,
    body: { teamName: "not-a-team", role: "write" },
  });
  assert.equal(unknownTeam.status, 400);
  assert.equal(unknownTeam.body.errors.teamName, "Team not found");

  const unknownGrant = await call(app.baseUrl, `${ACCESS_PATH}/missing-grant`, {
    method: "PATCH",
    cookie: repoAdmin.cookie,
    body: { role: "read" },
  });
  assert.equal(unknownGrant.status, 400);
  assert.equal(unknownGrant.body.errors.role, "Access grant not found");

  const reloaded = await call(app.baseUrl, ACCESS_PATH, { cookie: repoAdmin.cookie });
  assert.equal(reloaded.body.grants.some((grant) => grant.name === "not-a-team"), false);
});
