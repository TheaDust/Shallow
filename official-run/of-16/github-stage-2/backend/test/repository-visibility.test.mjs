import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

const ADMIN = { username: "visibility-admin", password: "Valid-password-123!" };
const COLLABORATOR = { username: "collaborator", password: "Valid-password-123!" };
const OUTSIDER = { username: "alice-dev", password: "Valid-password-123!" };

const REPOSITORY_PATH = "/api/users/visibility-admin/repositories/visibility-demo";
const VISIBILITY_PATH = "/api/repositories/visibility";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-repository-visibility-"));
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

async function signIn(baseUrl, account) {
  const response = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: account.username, password: account.password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function search(baseUrl, query, cookie) {
  const response = await call(baseUrl, `/api/search/repositories?q=${encodeURIComponent(query)}`, { cookie });
  assert.equal(response.status, 200);
  return response.body.repositories;
}

test("seed pre-provisions the private visibility-demo repository for its admin and collaborator", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  // A visitor learns nothing about the private repository.
  const visitor = await call(app.baseUrl, REPOSITORY_PATH);
  assert.equal(visitor.status, 404);
  assert.deepEqual(await search(app.baseUrl, "visibility-demo"), []);

  // The administrator reads it and may manage it.
  const adminCookie = await signIn(app.baseUrl, ADMIN);
  const admin = await call(app.baseUrl, REPOSITORY_PATH, { cookie: adminCookie });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.repository.visibility, "private");
  assert.equal(admin.body.repository.name, "visibility-demo");
  assert.equal(admin.body.repository.owner.name, "visibility-admin");
  assert.equal(admin.body.repository.canManage, true);

  // The collaborator holds a non-admin direct grant: readable, not manageable.
  const collaboratorCookie = await signIn(app.baseUrl, COLLABORATOR);
  const collaborator = await call(app.baseUrl, REPOSITORY_PATH, { cookie: collaboratorCookie });
  assert.equal(collaborator.status, 200);
  assert.equal(collaborator.body.repository.canManage, false);
  assert.equal((await search(app.baseUrl, "visibility-demo", collaboratorCookie)).length, 1);
});

test("REQ-3-4 scenario 1: the administrator makes the repository Public and a visitor reads it afterwards", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const adminCookie = await signIn(app.baseUrl, ADMIN);
  const changed = await call(app.baseUrl, VISIBILITY_PATH, {
    method: "POST",
    cookie: adminCookie,
    body: { ownerKind: "account", owner: "visibility-admin", name: "visibility-demo", visibility: "public" },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.repository.visibility, "public");
  assert.equal(changed.body.repository.canManage, true);

  // The change is stored, so a restart of the process reads the same value.
  const restarted = createStateStore({ dataDir: app.dataDir });
  const state = await restarted.read();
  const stored = state.repositories.find((repository) => repository.name === "visibility-demo");
  assert.equal(stored.visibility, "public");

  // Without any session cookie the repository is now readable and searchable.
  const visitor = await call(app.baseUrl, REPOSITORY_PATH);
  assert.equal(visitor.status, 200);
  assert.equal(visitor.body.repository.visibility, "public");
  assert.equal(visitor.body.repository.name, "visibility-demo");
  const results = await search(app.baseUrl, "visibility-demo");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "visibility-demo");
  assert.equal(results[0].owner.name, "visibility-admin");
});

test("REQ-3-4 scenario 2: the collaborator never gets administrator permission on the repository", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const collaboratorCookie = await signIn(app.baseUrl, COLLABORATOR);
  const denied = await call(app.baseUrl, VISIBILITY_PATH, {
    method: "POST",
    cookie: collaboratorCookie,
    body: { ownerKind: "account", owner: "visibility-admin", name: "visibility-demo", visibility: "public" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Access denied");

  // A failed change leaves the stored repository untouched, and the collaborator
  // stays without administrator permission even after the repository is public.
  const state = await app.store.read();
  const stored = state.repositories.find((repository) => repository.name === "visibility-demo");
  assert.equal(stored.visibility, "private");

  const adminCookie = await signIn(app.baseUrl, ADMIN);
  await call(app.baseUrl, VISIBILITY_PATH, {
    method: "POST",
    cookie: adminCookie,
    body: { ownerKind: "account", owner: "visibility-admin", name: "visibility-demo", visibility: "public" },
  });
  const collaborator = await call(app.baseUrl, REPOSITORY_PATH, { cookie: collaboratorCookie });
  assert.equal(collaborator.status, 200);
  assert.equal(collaborator.body.repository.canManage, false);
});

test("an unauthorized or invalid visibility change is rejected without partial state", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  // No session at all.
  const anonymous = await call(app.baseUrl, VISIBILITY_PATH, {
    method: "POST",
    body: { ownerKind: "account", owner: "visibility-admin", name: "visibility-demo", visibility: "public" },
  });
  assert.equal(anonymous.status, 401);

  // A signed-in outsider account is not the repository administrator either.
  const outsiderCookie = await signIn(app.baseUrl, OUTSIDER);
  const outsider = await call(app.baseUrl, VISIBILITY_PATH, {
    method: "POST",
    cookie: outsiderCookie,
    body: { ownerKind: "account", owner: "visibility-admin", name: "visibility-demo", visibility: "public" },
  });
  assert.equal(outsider.status, 403);

  // An unknown repository and an unsupported value are answered separately.
  const adminCookie = await signIn(app.baseUrl, ADMIN);
  const missing = await call(app.baseUrl, VISIBILITY_PATH, {
    method: "POST",
    cookie: adminCookie,
    body: { ownerKind: "account", owner: "visibility-admin", name: "no-such-repository", visibility: "public" },
  });
  assert.equal(missing.status, 404);
  const invalid = await call(app.baseUrl, VISIBILITY_PATH, {
    method: "POST",
    cookie: adminCookie,
    body: { ownerKind: "account", owner: "visibility-admin", name: "visibility-demo", visibility: "internal" },
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body.errors, { visibility: "Visibility is invalid" });

  const state = await app.store.read();
  const stored = state.repositories.find((repository) => repository.name === "visibility-demo");
  assert.equal(stored.visibility, "private");
});
