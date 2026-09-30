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
  return mkdtemp(join(tmpdir(), "shallowcode-repository-access-"));
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

async function registerAccount(baseUrl, username) {
  const response = await jsonRequest(baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username,
      email: `${username}@example.test`,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(response.status, 201);
}

/** A private organization repository without any grant yet. */
async function createPrivateRepository(baseUrl, cookie, name) {
  const response = await jsonRequest(baseUrl, "/api/repositories", {
    method: "POST",
    cookie,
    body: { owner: "acme-demo", name, visibility: "private", description: "", initializeWithReadme: false },
  });
  assert.equal(response.status, 201);
}

test("an organization Owner grants a team a role and the grant is replaced, not duplicated", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");
  await createPrivateRepository(app.baseUrl, cookie, "acme-private-notes");

  const before = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { cookie },
  );
  assert.equal(before.status, 200);
  const beforeBody = await before.json();
  assert.deepEqual(beforeBody.grants, []);
  assert.deepEqual(
    beforeBody.candidates.map((subject) => [subject.type, subject.name]),
    [
      ["account", "alice-dev"],
      ["account", "bob-reviewer"],
      ["team", "frontend-team"],
    ],
  );
  assert.equal(beforeBody.viewer.canAdminister, true);

  const granted = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { method: "POST", cookie, body: { subjectType: "team", subjectId: "frontend-team", role: "write" } },
  );
  assert.equal(granted.status, 201);

  const repeated = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { method: "POST", cookie, body: { subject: "team:frontend-team", role: "write" } },
  );
  assert.equal(repeated.status, 200);

  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const reloaded = await signIn(restarted.baseUrl, "alice-dev");
  const listed = await jsonRequest(
    restarted.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { cookie: reloaded },
  );
  const grants = (await listed.json()).grants;
  assert.equal(grants.length, 1);
  assert.deepEqual(
    grants.map((grant) => [grant.subjectType, grant.name, grant.role]),
    [["team", "frontend-team", "write"]],
  );

  const replaced = await jsonRequest(
    restarted.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { method: "POST", cookie: reloaded, body: { subjectType: "team", subjectId: "frontend-team", role: "read" } },
  );
  assert.equal(replaced.status, 200);
  const afterReplace = await jsonRequest(
    restarted.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { cookie: reloaded },
  );
  const replacedGrants = (await afterReplace.json()).grants;
  assert.equal(replacedGrants.length, 1);
  assert.equal(replacedGrants[0].role, "read");

  const invalidRole = await jsonRequest(
    restarted.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { method: "POST", cookie: reloaded, body: { subjectType: "team", subjectId: "frontend-team", role: "superuser" } },
  );
  assert.equal(invalidRole.status, 400);
  assert.equal((await invalidRole.json()).fields.role, "Choose a role");

  const unknownSubject = await jsonRequest(
    restarted.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { method: "POST", cookie: reloaded, body: { subjectType: "team", subjectId: "not-a-team", role: "read" } },
  );
  assert.equal(unknownSubject.status, 400);
  assert.ok((await unknownSubject.json()).fields.subject);
});

test("a private repository is readable only through an Owner, a direct grant or a direct team grant", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");
  await registerAccount(app.baseUrl, "dana-dev");
  await createPrivateRepository(app.baseUrl, alice, "acme-private-notes");

  // `dana-dev` becomes an ordinary organization member: membership alone grants
  // no access to a private repository.
  const membership = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members", {
    method: "POST",
    cookie: alice,
    body: { identifier: "dana-dev", role: "member" },
  });
  assert.equal(membership.status, 201);
  const dana = await signIn(app.baseUrl, "dana-dev");
  const denied = await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-private-notes", {
    cookie: dana,
  });
  assert.equal(denied.status, 403);

  // The team grant is what makes the direct team member able to read it.
  await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-private-notes/access", {
    method: "POST",
    cookie: alice,
    body: { subjectType: "team", subjectId: "frontend-team", role: "write" },
  });
  const stillDenied = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes",
    { cookie: dana },
  );
  assert.equal(stillDenied.status, 403);

  await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team/members", {
    method: "POST",
    cookie: alice,
    body: { username: "dana-dev" },
  });
  const grantedByTeam = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes",
    { cookie: dana },
  );
  assert.equal(grantedByTeam.status, 200);

  // The hierarchy contributes nothing: `bob-reviewer` in the child team of the
  // authorized team keeps no access, and the child team's own grant only helps
  // its own direct members.
  await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams", {
    method: "POST",
    cookie: alice,
    body: { name: "child-team", parentTeam: "frontend-team" },
  });
  await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/teams/child-team/members", {
    method: "POST",
    cookie: alice,
    body: { username: "bob-reviewer" },
  });
  await jsonRequest(
    app.baseUrl,
    "/api/organizations/acme-demo/teams/frontend-team/members/dana-dev",
    { method: "DELETE", cookie: alice },
  );
  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const childOnly = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes",
    { cookie: bob },
  );
  assert.equal(childOnly.status, 403);

  // A direct account grant is enough, and the anonymous visitor learns nothing.
  await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-private-notes/access", {
    method: "POST",
    cookie: alice,
    body: { subjectType: "account", subjectId: "bob-reviewer", role: "read" },
  });
  const directGrant = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes",
    { cookie: bob },
  );
  assert.equal(directGrant.status, 200);
  const anonymous = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes",
  );
  assert.equal(anonymous.status, 404);
});

test("only a repository administrator manages access", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");
  await createPrivateRepository(app.baseUrl, alice, "acme-private-notes");
  await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-private-notes/access", {
    method: "POST",
    cookie: alice,
    body: { subjectType: "account", subjectId: "bob-reviewer", role: "write" },
  });

  // A Write grant reads the repository but never manages its access.
  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const read = await jsonRequest(app.baseUrl, "/api/repositories/acme-demo/acme-private-notes", {
    cookie: bob,
  });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).repository.permissions.canAdminister, false);

  const refused = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    { cookie: bob },
  );
  assert.equal(refused.status, 403);
  const refusedWrite = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
    {
      method: "POST",
      cookie: bob,
      body: { subjectType: "account", subjectId: "bob-reviewer", role: "admin" },
    },
  );
  assert.equal(refusedWrite.status, 403);

  const anonymous = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-private-notes/access",
  );
  assert.equal(anonymous.status, 404);
});

test("a personal repository is managed by its owner through the owned organization subjects", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  const access = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research/access", {
    cookie: alice,
  });
  assert.equal(access.status, 200);
  const body = await access.json();
  assert.ok(body.candidates.some((subject) => subject.type === "team" && subject.name === "frontend-team"));

  // The seeded direct grant of `bob-reviewer` shows up as one existing row.
  assert.deepEqual(
    body.grants.map((grant) => [grant.subjectType, grant.name, grant.role]),
    [["account", "bob-reviewer", "write"]],
  );
});
