import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const EVO_PASSWORD = "Evo-Password-987!";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-archive-"));
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

async function signIn(baseUrl, identifier, password = EVO_PASSWORD) {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200, `sign-in failed for ${identifier}`);
  return result.cookie;
}

test("an administrator archives and restores a repository; archived status persists", async () => {
  const app = await startApp();
  try {
    const path = "/api/repositories/acme-demo/evo-archive-repository-s1";

    // Archive is an administrator operation: the viewer of the repository and
    // an anonymous browser may not change it.
    const member = await signIn(app.baseUrl, "evo-archive-viewer");
    const denied = await request(app.baseUrl, "PATCH", `${path}/archive`, { archived: true }, member);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");
    const anonymous = await request(app.baseUrl, "PATCH", `${path}/archive`, { archived: true });
    assert.equal(anonymous.status, 401);

    const admin = await signIn(app.baseUrl, "evo-archive-admin");
    const before = await request(app.baseUrl, "GET", path, undefined, admin);
    assert.equal(before.status, 200);
    assert.equal(before.body.repository.archived, false);
    assert.equal(before.body.repository.canManage, true);
    assert.equal(before.body.repository.canWrite, true);

    const invalid = await request(app.baseUrl, "PATCH", `${path}/archive`, { archived: "yes" }, admin);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.message, "Archived status is invalid");
    assert.equal(
      (await request(app.baseUrl, "GET", path, undefined, admin)).body.repository.archived,
      false,
    );

    const archived = await request(app.baseUrl, "PATCH", `${path}/archive`, { archived: true }, admin);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.repository.archived, true);
    assert.equal(archived.body.repository.name, "evo-archive-repository-s1");
    assert.equal(archived.body.repository.canManage, true);
    // Archived repositories are read-only for every user, the Admin included.
    assert.equal(archived.body.repository.canWrite, false);

    // Every write control of the archived repository is refused at the server.
    const branch = await request(
      app.baseUrl,
      "POST",
      `${path}/branches`,
      { name: "archived-branch", base: "main" },
      admin,
    );
    assert.equal(branch.status, 403);
    const file = await request(
      app.baseUrl,
      "POST",
      `${path}/files`,
      { path: "notes.md", content: "n", message: "Add notes" },
      admin,
    );
    assert.equal(file.status, 403);
    const issue = await request(app.baseUrl, "POST", `${path}/issues`, { title: "Archived" }, admin);
    assert.equal(issue.status, 403);
    const pull = await request(app.baseUrl, "POST", `${path}/pulls`, { title: "Archived" }, admin);
    assert.equal(pull.status, 403);

    // The record survives a restart, and the repository keeps its content.
    const restarted = await startDataDir(app.dataDir);
    try {
      const reloaded = await request(
        restarted.baseUrl,
        "GET",
        path,
        undefined,
        await signIn(restarted.baseUrl, "evo-archive-admin"),
      );
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.repository.archived, true);
      assert.equal(reloaded.body.repository.readmePath, "README.md");

      const restored = await request(
        restarted.baseUrl,
        "PATCH",
        `${path}/archive`,
        { archived: false },
        await signIn(restarted.baseUrl, "evo-archive-admin"),
      );
      assert.equal(restored.status, 200);
      assert.equal(restored.body.repository.archived, false);
      assert.equal(restored.body.repository.canWrite, true);
      assert.equal(restored.body.repository.readmePath, "README.md");

      const writableAgain = await request(
        restarted.baseUrl,
        "POST",
        `${path}/files`,
        { path: "notes.md", content: "n", message: "Add notes" },
        await signIn(restarted.baseUrl, "evo-archive-admin"),
      );
      assert.equal(writableAgain.status, 201);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a seeded archived repository stays readable to its granted account and offers no write path", async () => {
  const app = await startApp();
  try {
    const path = "/api/repositories/acme-demo/evo-archive-repository-s2";
    assert.equal((await request(app.baseUrl, "GET", path)).status, 200);

    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");
    const view = await request(app.baseUrl, "GET", path, undefined, viewer);
    assert.equal(view.status, 200);
    assert.equal(view.body.repository.archived, true);
    assert.equal(view.body.repository.canWrite, false);
    assert.equal(view.body.repository.readmePath, "README.md");

    const listing = await request(app.baseUrl, "GET", path, undefined, viewer);
    assert.equal(listing.body.repository.archived, true);
    const denied = await request(app.baseUrl, "POST", `${path}/issues`, { title: "No" }, viewer);
    assert.equal(denied.status, 403);
  } finally {
    await app.close();
  }
});
