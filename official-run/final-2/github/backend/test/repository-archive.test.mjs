import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const EVOLUTION_PASSWORD = "Evo-Password-987!";
const ADMIN = "evo-archive-admin";
const VIEWER = "evo-archive-viewer";

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

async function signIn(baseUrl, identifier, password = EVOLUTION_PASSWORD) {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200);
  return result.cookie;
}

const repositoryPath = (name) => `/api/repositories/acme-demo/${name}`;

async function detail(baseUrl, name, cookie) {
  const result = await request(baseUrl, "GET", repositoryPath(name), undefined, cookie);
  assert.equal(result.status, 200);
  return result.body.repository;
}

test("an administrator archives a repository and the status survives a restart", async () => {
  const app = await startApp();
  try {
    assert.equal((await detail(app.baseUrl, "evo-archive-repository-s1")).archived, false);

    // A visitor can read the public repository but can never change its status.
    const anonymous = await request(app.baseUrl, "PATCH", `${repositoryPath("evo-archive-repository-s1")}/archive`, {
      archived: true,
    });
    assert.equal(anonymous.status, 401);

    // The readable Member of an archived repository holds no Admin grant.
    const viewer = await signIn(app.baseUrl, VIEWER);
    const denied = await request(
      app.baseUrl,
      "PATCH",
      `${repositoryPath("evo-archive-repository-s1")}/archive`,
      { archived: true },
      viewer,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const admin = await signIn(app.baseUrl, ADMIN);
    assert.equal((await detail(app.baseUrl, "evo-archive-repository-s1", admin)).canManage, true);

    const invalid = await request(
      app.baseUrl,
      "PATCH",
      `${repositoryPath("evo-archive-repository-s1")}/archive`,
      { archived: "yes" },
      admin,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.message, "Repository status is invalid");

    const archived = await request(
      app.baseUrl,
      "PATCH",
      `${repositoryPath("evo-archive-repository-s1")}/archive`,
      { archived: true },
      admin,
    );
    assert.equal(archived.status, 200);
    assert.equal(archived.body.repository.archived, true);
    assert.equal(archived.body.repository.canWrite, false);
    assert.equal(archived.body.repository.canManage, true);

    // Archived repositories stay readable to a visitor, and the marker the
    // overview renders comes from every read path.
    const visitorView = await detail(app.baseUrl, "evo-archive-repository-s1");
    assert.equal(visitorView.archived, true);
    const listed = await request(app.baseUrl, "GET", "/api/repositories?q=evo-archive-repository-s1");
    assert.equal(listed.body.repositories[0].archived, true);

    const restarted = await startDataDir(app.dataDir);
    try {
      assert.equal((await detail(restarted.baseUrl, "evo-archive-repository-s1")).archived, true);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("an archived repository stays readable while every write control is refused", async () => {
  const app = await startApp();
  try {
    const viewer = await signIn(app.baseUrl, VIEWER);
    const admin = await signIn(app.baseUrl, ADMIN);
    const path = repositoryPath("evo-archive-repository-s2");

    const view = await detail(app.baseUrl, "evo-archive-repository-s2", viewer);
    assert.equal(view.archived, true);
    assert.equal(view.canManage, false);
    assert.equal(view.canWrite, false);
    assert.equal(view.readmePath, "README.md");

    // The stored file still reads on the archived repository.
    const file = await request(app.baseUrl, "GET", `${path}/blob?path=README.md`, undefined, viewer);
    assert.equal(file.status, 200);
    assert.match(file.body.file.content, /evo-archive-repository/);
    const tree = await request(app.baseUrl, "GET", `${path}/tree`, undefined, viewer);
    assert.equal(tree.status, 200);
    assert.deepEqual(tree.body.entries.map((entry) => entry.name), ["README.md"]);

    // The administrator keeps the Admin permission, yet no write is accepted.
    for (const [method, sub, body] of [
      ["POST", "/branches", { name: "archived-branch" }],
      ["POST", "/files", { path: "later.md", content: "later", message: "Add later.md" }],
      ["POST", "/issues", { title: "Archived issue", description: "" }],
      ["POST", "/pulls", { title: "Archived pull request", base: "main", compare: "main" }],
    ]) {
      const refused = await request(app.baseUrl, method, `${path}${sub}`, body, admin);
      assert.equal(refused.status, 403, `${method} ${sub}`);
      assert.equal(refused.body.message, "Access denied");
    }

    // The refusals left the stored state untouched.
    const after = await request(app.baseUrl, "GET", `${path}/issues`, undefined, admin);
    assert.equal(after.status, 200);
    assert.equal(after.body.canWrite, false);
    assert.deepEqual(after.body.issues, []);
    const branches = await request(app.baseUrl, "GET", `${path}/branches`, undefined, admin);
    assert.deepEqual(branches.body.branches.map((branch) => branch.name), ["main"]);
  } finally {
    await app.close();
  }
});

test("restoring an archived repository clears the marker and keeps its content", async () => {
  const app = await startApp();
  try {
    const admin = await signIn(app.baseUrl, ADMIN);
    const visitor = await signIn(app.baseUrl, VIEWER);
    const path = repositoryPath("evo-archive-repository-s3");

    const before = await detail(app.baseUrl, "evo-archive-repository-s3", admin);
    assert.equal(before.archived, true);
    const branchesBefore = await request(app.baseUrl, "GET", `${path}/branches`, undefined, admin);
    const commitsBefore = await request(app.baseUrl, "GET", `${path}/commits`, undefined, admin);

    const restored = await request(app.baseUrl, "PATCH", `${path}/archive`, { archived: false }, admin);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.repository.archived, false);
    // The Admin grant is unchanged by the restore, so Settings stays reachable.
    assert.equal(restored.body.repository.canManage, true);

    const reloaded = await detail(app.baseUrl, "evo-archive-repository-s3");
    assert.equal(reloaded.archived, false);
    assert.equal(reloaded.readmePath, "README.md");

    const file = await request(app.baseUrl, "GET", `${path}/blob?path=README.md`, undefined, visitor);
    assert.equal(file.status, 200);
    assert.match(file.body.file.content, /evo-archive-repository/);

    const branchesAfter = await request(app.baseUrl, "GET", `${path}/branches`, undefined, admin);
    assert.deepEqual(
      branchesAfter.body.branches.map((branch) => branch.name),
      branchesBefore.body.branches.map((branch) => branch.name),
    );
    const commitsAfter = await request(app.baseUrl, "GET", `${path}/commits`, undefined, admin);
    assert.deepEqual(commitsAfter.body.commits, commitsBefore.body.commits);
  } finally {
    await app.close();
  }
});
