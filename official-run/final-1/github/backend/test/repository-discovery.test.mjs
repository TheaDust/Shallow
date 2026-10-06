import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-discovery-"));
  return startDataDir(dataDir);
}

/** A second app over the same data directory models a restart. */
async function startDataDir(dataDir) {
  const store = createAuthStore(dataDir);
  const orgStore = createOrgStore(dataDir);
  const handler = createRequestHandler({ store, orgStore, staticRoot: join(dataDir, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function collectCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(baseUrl, method, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, cookie: collectCookie(response) };
}

async function signIn(baseUrl, identifier, password = "Valid-password-123!") {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200);
  return result.cookie;
}

async function searchNames(baseUrl, query, cookie) {
  const result = await request(
    baseUrl,
    "GET",
    `/api/repositories?q=${encodeURIComponent(query)}`,
    undefined,
    cookie,
  );
  assert.equal(result.status, 200);
  return result.body.repositories.map((repository) => repository.name);
}

test("global search only exposes repositories the caller may read", async () => {
  const app = await startApp();
  try {
    assert.deepEqual(await searchNames(app.baseUrl, "acme-docs"), ["acme-docs"]);
    assert.deepEqual(await searchNames(app.baseUrl, "secret-research"), []);
    assert.deepEqual(await searchNames(app.baseUrl, "visibility-demo"), []);
    assert.deepEqual(await searchNames(app.baseUrl, "no-such-repository"), []);

    const hits = await request(app.baseUrl, "GET", "/api/repositories?q=acme-docs");
    const [hit] = hits.body.repositories;
    assert.equal(hit.owner.displayName, "Acme Demo");
    assert.equal(hit.name, "acme-docs");
    assert.equal(hit.visibility, "public");

    // A signed-in account without a grant sees no more than the visitor.
    const collaborator = await signIn(app.baseUrl, "collaborator");
    assert.deepEqual(await searchNames(app.baseUrl, "secret-research", collaborator), []);
    assert.deepEqual(await searchNames(app.baseUrl, "visibility-demo", collaborator), ["visibility-demo"]);
  } finally {
    await app.close();
  }
});

test("repository search matches names and descriptions case-insensitively", async () => {
  const app = await startApp();
  try {
    // The name is matched whatever the casing of the query.
    assert.deepEqual(await searchNames(app.baseUrl, "EVO-SEARCH-CATALOG-S1"), ["evo-search-catalog-s1"]);
    // A phrase that only occurs in the persisted description is enough.
    assert.deepEqual(await searchNames(app.baseUrl, "evolution-notebook"), ["evo-search-notebook-s2"]);
    // And a query no seeded repository carries stays empty.
    assert.deepEqual(await searchNames(app.baseUrl, "evo-search-empty-s3"), []);

    const hits = await request(app.baseUrl, "GET", "/api/repositories?q=EVOLUTION-NOTEBOOK");
    const [hit] = hits.body.repositories;
    assert.equal(hit.name, "evo-search-notebook-s2");
    assert.equal(hit.owner.displayName, "Acme Demo");
    assert.equal(hit.visibility, "public");

    // The same rule applies to a private repository description: the visitor
    // sees no result even when it would match the text.
    assert.deepEqual(await searchNames(app.baseUrl, "Internal research notes"), []);
  } finally {
    await app.close();
  }
});

test("repository visibility changes are administrator-only and persist", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/visibility-demo");
    assert.equal(before.status, 403);

    const anonymous = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/visibility-demo/visibility",
      { visibility: "public" },
    );
    assert.equal(anonymous.status, 401);

    const collaborator = await signIn(app.baseUrl, "collaborator");
    const denied = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/visibility-demo/visibility",
      { visibility: "public" },
      collaborator,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const stillPrivate = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/visibility-demo",
      undefined,
      collaborator,
    );
    assert.equal(stillPrivate.status, 200);
    assert.equal(stillPrivate.body.repository.visibility, "private");
    assert.equal(stillPrivate.body.repository.canManage, false);
    assert.deepEqual(await searchNames(app.baseUrl, "visibility-demo"), []);

    const admin = await signIn(app.baseUrl, "visibility-admin");
    const invalid = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/visibility-demo/visibility",
      { visibility: "internal" },
      admin,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.message, "Visibility is invalid");

    const updated = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/visibility-demo/visibility",
      { visibility: "public" },
      admin,
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.repository.visibility, "public");
    assert.equal(updated.body.repository.name, "visibility-demo");
    assert.equal(updated.body.repository.owner.displayName, "Acme Demo");
    assert.equal(updated.body.repository.canManage, true);

    // Every read path now agrees with the new visibility.
    const visitor = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/visibility-demo");
    assert.equal(visitor.status, 200);
    assert.equal(visitor.body.repository.visibility, "public");
    assert.deepEqual(await searchNames(app.baseUrl, "visibility-demo"), ["visibility-demo"]);

    const restarted = await startDataDir(app.dataDir);
    try {
      const reloaded = await request(restarted.baseUrl, "GET", "/api/repositories/acme-demo/visibility-demo");
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.repository.visibility, "public");
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});
