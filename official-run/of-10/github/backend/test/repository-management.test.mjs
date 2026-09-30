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
  return mkdtemp(join(tmpdir(), "shallowcode-repository-create-"));
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

test("an anonymous visitor cannot create a repository", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const response = await jsonRequest(app.baseUrl, "/api/repositories", {
    method: "POST",
    body: { name: "pw-anon-repo", visibility: "public" },
  });
  assert.equal(response.status, 401);
});

test("creating a private repository with a README stores one initialization commit", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const created = await jsonRequest(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie,
    body: {
      owner: "alice-dev",
      name: "pw-private-notes",
      description: "Repository created by Playwright",
      visibility: "private",
      initializeWithReadme: true,
    },
  });
  assert.equal(created.status, 201);
  const { repository } = await created.json();
  assert.equal(repository.fullName, "alice-dev/pw-private-notes");
  assert.equal(repository.visibility, "private");
  assert.equal(repository.description, "Repository created by Playwright");
  assert.equal(repository.defaultBranch, "main");
  assert.equal(repository.branch, "main");
  assert.deepEqual(
    repository.entries.map((entry) => [entry.type, entry.name]),
    [["file", "README.md"]],
  );
  assert.equal(repository.commits.length, 1);
  assert.equal(repository.commits[0].message, "Initial commit");
  assert.equal(repository.commits[0].author, "alice-dev");
  assert.equal(repository.permissions.role, "admin");
  assert.equal(repository.permissions.canAdminister, true);

  // The owner's repository list contains it and the visitor never sees it.
  const list = await jsonRequest(app.baseUrl, "/api/repositories?owner=alice-dev", { cookie });
  const names = (await list.json()).repositories.map((entry) => entry.name);
  assert.ok(names.includes("pw-private-notes"));
  assert.ok(names.includes("secret-research"));

  const visitorList = await jsonRequest(app.baseUrl, "/api/repositories?owner=alice-dev");
  const visitorNames = (await visitorList.json()).repositories.map((entry) => entry.name);
  assert.deepEqual(visitorNames, ["acme-docs"]);
});

test("a repository without initialization keeps an empty default branch", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const response = await jsonRequest(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie,
    body: { name: "pw-empty-repo", visibility: "public" },
  });
  assert.equal(response.status, 201);
  const { repository } = await response.json();
  assert.deepEqual(repository.entries, []);
  assert.deepEqual(repository.commits, []);
  assert.equal(repository.defaultBranch, "main");
});

test("empty and duplicated names are rejected without creating anything", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const empty = await jsonRequest(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie,
    body: { name: "   ", visibility: "private" },
  });
  assert.equal(empty.status, 400);
  const emptyBody = await empty.json();
  assert.equal(emptyBody.fields.name, "Repository name is required");

  const duplicate = await jsonRequest(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie,
    body: { name: "acme-docs", visibility: "public" },
  });
  assert.equal(duplicate.status, 400);
  const duplicateBody = await duplicate.json();
  assert.match(duplicateBody.fields.name, /already exists/);

  const list = await jsonRequest(app.baseUrl, "/api/repositories?owner=alice-dev", { cookie });
  const names = (await list.json()).repositories.map((entry) => entry.name);
  assert.deepEqual(names, ["acme-docs", "acme-docs-fork", "secret-research"]);

  const invalid = await jsonRequest(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie,
    body: { name: "not a name", visibility: "public" },
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).fields.name, "Repository name is invalid");
});

test("a repository another account owns is refused", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "bob-reviewer");

  const response = await jsonRequest(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie,
    body: { owner: "alice-dev", name: "pw-not-mine", visibility: "public" },
  });
  assert.equal(response.status, 403);
  const list = await jsonRequest(app.baseUrl, "/api/repositories?owner=alice-dev", { cookie });
  const names = (await list.json()).repositories.map((entry) => entry.name);
  // The collaborator grant makes the private repository readable for bob.
  assert.deepEqual(names, ["acme-docs", "secret-research"]);
  const bobList = await jsonRequest(app.baseUrl, "/api/repositories?owner=bob-reviewer", { cookie });
  // The member keeps his own personal repository; the organization repository
  // list is a separate namespace.
  assert.deepEqual(
    (await bobList.json()).repositories.map((entry) => entry.name),
    ["bob-notes"],
  );
});

test("namespaces list the personal namespace of the signed-in account", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const anonymous = await jsonRequest(app.baseUrl, "/api/namespaces");
  assert.equal(anonymous.status, 401);

  const cookie = await signIn(app.baseUrl, "alice-dev");
  const response = await jsonRequest(app.baseUrl, "/api/namespaces", { cookie });
  assert.equal(response.status, 200);
  // The personal namespace stays first; the organization namespace follows
  // because the account is its Owner (REQ-2).
  assert.deepEqual((await response.json()).namespaces, [
    { type: "user", login: "alice-dev" },
    { type: "organization", login: "acme-demo", name: "Acme Demo" },
  ]);
});

test("forking copies the source history and records the source link", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const defaults = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/forks?namespace=alice-dev",
    { cookie },
  );
  assert.equal(defaults.status, 200);
  const suggested = await defaults.json();
  assert.deepEqual(suggested.namespace, { type: "user", login: "alice-dev" });
  assert.equal(suggested.name, "acme-docs-1");
  assert.equal(suggested.visibility, "public");

  const created = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs/forks", {
    method: "POST",
    cookie,
    body: { owner: "alice-dev", name: "acme-docs-1", visibility: "public" },
  });
  assert.equal(created.status, 201);
  const { repository } = await created.json();
  assert.equal(repository.fullName, "alice-dev/acme-docs-1");
  assert.deepEqual(repository.forkedFrom, {
    id: "repo-alice-dev-acme-docs",
    owner: "alice-dev",
    name: "acme-docs",
    fullName: "alice-dev/acme-docs",
  });
  assert.deepEqual(
    repository.entries.map((entry) => entry.name),
    ["docs", "src", "README.md"],
  );

  // The fork is a separate repository: the source keeps its own identity and
  // history and is never modified by the fork.
  const source = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs");
  const sourceBody = await source.json();
  assert.equal(repository.commits.length, sourceBody.repository.commits.length);
  assert.equal(sourceBody.repository.forkedFrom, null);
  assert.equal(sourceBody.repository.id, "repo-alice-dev-acme-docs");
  assert.notEqual(sourceBody.repository.id, repository.id);
  assert.deepEqual(
    sourceBody.repository.commits.map((commit) => commit.message),
    ["Add search loader", "Document search flow", "Initial commit"],
  );
});

test("a fork name conflict in the target namespace creates nothing", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const response = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs/forks", {
    method: "POST",
    cookie,
    body: { owner: "alice-dev", name: "acme-docs-fork", visibility: "public" },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.fields.name, /already exists/);

  const overview = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs-fork", {
    cookie,
  });
  const existing = await overview.json();
  assert.equal(existing.repository.visibility, "private");
  assert.equal(existing.repository.forkedFrom.name, "acme-docs");
});

test("a private source cannot produce a public fork", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const response = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/secret-research/forks",
    {
      method: "POST",
      cookie,
      body: { owner: "alice-dev", name: "pw-secret-fork", visibility: "public" },
    },
  );
  assert.equal(response.status, 201);
  const { repository } = await response.json();
  assert.equal(repository.visibility, "private");

  const anonymous = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/pw-secret-fork");
  assert.equal(anonymous.status, 404);
});

test("a visitor cannot fork and a foreign namespace is refused", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const anonymous = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/forks",
    { method: "POST", body: { name: "pw-visitor-fork" } },
  );
  assert.equal(anonymous.status, 401);

  const cookie = await signIn(app.baseUrl, "bob-reviewer");
  // Bob has no personal namespace for alice-dev, so the target is refused.
  const foreign = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/forks",
    { method: "POST", cookie, body: { owner: "alice-dev", name: "pw-bob-fork" } },
  );
  assert.equal(foreign.status, 403);

  // A readable source and his own namespace are allowed.
  const allowed = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/forks",
    { method: "POST", cookie, body: { owner: "bob-reviewer", name: "pw-bob-fork" } },
  );
  assert.equal(allowed.status, 201);
  const { repository } = await allowed.json();
  assert.equal(repository.fullName, "bob-reviewer/pw-bob-fork");
  assert.equal(repository.forkedFrom.fullName, "alice-dev/acme-docs");
});

test("an administrator changes visibility and the access rule follows", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "alice-dev");

  const before = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research");
  assert.equal(before.status, 404);

  const changed = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/secret-research/visibility",
    { method: "POST", cookie, body: { visibility: "public", confirmationName: "secret-research" } },
  );
  assert.equal(changed.status, 200);
  const { repository } = await changed.json();
  assert.equal(repository.visibility, "public");
  assert.equal(repository.permissions.canAdminister, true);

  const visitor = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research");
  assert.equal(visitor.status, 200);
  assert.equal((await visitor.json()).repository.fullName, "alice-dev/secret-research");

  const search = await jsonRequest(
    app.baseUrl,
    "/api/search?q=secret-research&type=repositories",
  );
  assert.deepEqual(
    (await search.json()).repositories.map((entry) => entry.name),
    ["secret-research"],
  );
});

test("a non-Admin collaborator and a mismatched confirmation are rejected", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const denied = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/secret-research/visibility",
    { method: "POST", cookie: bob, body: { visibility: "public" } },
  );
  assert.equal(denied.status, 403);

  const alice = await signIn(app.baseUrl, "alice-dev");
  const mismatch = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/secret-research/visibility",
    { method: "POST", cookie: alice, body: { visibility: "public", confirmationName: "wrong-name" } },
  );
  assert.equal(mismatch.status, 400);
  const stillPrivate = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research", {
    cookie: alice,
  });
  assert.equal((await stillPrivate.json()).repository.visibility, "private");

  // Without any confirmation text the change completes (no retyping required).
  const direct = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/secret-research/visibility",
    { method: "POST", cookie: alice, body: { visibility: "public" } },
  );
  assert.equal(direct.status, 200);
  assert.equal((await direct.json()).repository.visibility, "public");
});

test("created and forked repositories survive a restart", async (t) => {
  const dataDir = await newDataDir();
  const first = await startApp(dataDir);
  const cookie = await signIn(first.baseUrl, "alice-dev");
  await jsonRequest(first.baseUrl, "/api/repositories", {
    method: "POST",
    cookie,
    body: { name: "pw-persisted", visibility: "private", initializeWithReadme: true },
  });
  await jsonRequest(first.baseUrl, "/api/repositories/alice-dev/acme-docs/forks", {
    method: "POST",
    cookie,
    body: { owner: "alice-dev", name: "pw-fork-persisted" },
  });
  await first.close();

  const second = await startApp(dataDir);
  t.after(() => second.close());
  const cookieAgain = await signIn(second.baseUrl, "alice-dev");
  const list = await jsonRequest(second.baseUrl, "/api/repositories?owner=alice-dev", {
    cookie: cookieAgain,
  });
  const names = (await list.json()).repositories.map((entry) => entry.name);
  assert.ok(names.includes("pw-persisted"));
  assert.ok(names.includes("pw-fork-persisted"));

  const fork = await jsonRequest(second.baseUrl, "/api/repositories/alice-dev/pw-fork-persisted", {
    cookie: cookieAgain,
  });
  const { repository } = await fork.json();
  assert.equal(repository.forkedFrom.fullName, "alice-dev/acme-docs");
  assert.ok(repository.commits.length >= 2);
  assert.ok(repository.entries.some((entry) => entry.name === "docs"));
});
