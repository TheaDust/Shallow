// REQ-3-5 archive and restore: an administrator flips the Archive state through
// the settings surface, an archived repository stays readable for every account
// while every write is refused, and the stored flag survives a restart.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const ADMIN_PASSWORD = "Evo-Password-987!";
const OWNER = "evo-archive-admin";
const ACTIVE_REPOSITORY = "evo-archive-repository-s1";
const ARCHIVED_REPOSITORY = "evo-archive-repository-s2";
const RESTORED_REPOSITORY = "evo-archive-repository-s3";

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

async function signIn(baseUrl, identifier, password = ADMIN_PASSWORD) {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200);
  return result.cookie;
}

const repositoryUrl = (name) => `/api/repositories/${OWNER}/${name}`;

async function archivedFlag(baseUrl, name, cookie) {
  const result = await request(baseUrl, "GET", repositoryUrl(name), undefined, cookie);
  assert.equal(result.status, 200);
  return result.body.repository.archived;
}

test("an administrator archives an active repository and the marker persists", async () => {
  const app = await startApp();
  try {
    const visitor = await request(app.baseUrl, "GET", repositoryUrl(ACTIVE_REPOSITORY));
    assert.equal(visitor.status, 200);
    assert.equal(visitor.body.repository.archived, false);

    // Archiving is an administrator operation: an unrelated account and an
    // anonymous caller are both refused and nothing is written.
    const anonymous = await request(app.baseUrl, "POST", `${repositoryUrl(ACTIVE_REPOSITORY)}/archive`);
    assert.equal(anonymous.status, 401);
    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");
    const denied = await request(
      app.baseUrl,
      "POST",
      `${repositoryUrl(ACTIVE_REPOSITORY)}/archive`,
      undefined,
      viewer,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");
    assert.equal(await archivedFlag(app.baseUrl, ACTIVE_REPOSITORY, viewer), false);

    const admin = await signIn(app.baseUrl, OWNER);
    const archived = await request(
      app.baseUrl,
      "POST",
      `${repositoryUrl(ACTIVE_REPOSITORY)}/archive`,
      undefined,
      admin,
    );
    assert.equal(archived.status, 200);
    assert.equal(archived.body.repository.archived, true);
    assert.equal(archived.body.repository.canManage, true);

    // The stored flag is what a reload reads.
    assert.equal(await archivedFlag(app.baseUrl, ACTIVE_REPOSITORY, admin), true);

    // And it survives a restart over the same data directory.
    const restarted = await startDataDir(app.dataDir);
    try {
      const restartedAdmin = await signIn(restarted.baseUrl, OWNER);
      assert.equal(await archivedFlag(restarted.baseUrl, ACTIVE_REPOSITORY, restartedAdmin), true);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("an archived repository stays readable while every write is refused", async () => {
  const app = await startApp();
  try {
    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");

    const overview = await request(app.baseUrl, "GET", repositoryUrl(ARCHIVED_REPOSITORY), undefined, viewer);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.repository.archived, true);
    assert.equal(overview.body.repository.name, ARCHIVED_REPOSITORY);

    // The stored README of the archived repository stays readable.
    const file = await request(
      app.baseUrl,
      "GET",
      `${repositoryUrl(ARCHIVED_REPOSITORY)}/blob?path=README.md`,
      undefined,
      viewer,
    );
    assert.equal(file.status, 200);
    assert.equal(file.body.file.path, "README.md");
    assert.ok(file.body.file.content.length > 0);

    // It still joins the readable search scope and the repository list.
    const search = await request(app.baseUrl, "GET", `/api/repositories?q=${ARCHIVED_REPOSITORY}`);
    assert.deepEqual(search.body.repositories.map((repository) => repository.name), [ARCHIVED_REPOSITORY]);

    // Every write control is unavailable to every account, including the
    // repository administrator: file editing, branch creation, issue creation
    // and pull-request creation.
    const admin = await signIn(app.baseUrl, OWNER);
    const writes = [
      {
        path: `${repositoryUrl(ARCHIVED_REPOSITORY)}/files`,
        body: { path: "notes.md", content: "placeholder", message: "Add notes" },
      },
      { path: `${repositoryUrl(ARCHIVED_REPOSITORY)}/branches`, body: { name: "feature" } },
      { path: `${repositoryUrl(ARCHIVED_REPOSITORY)}/issues`, body: { title: "New issue" } },
      {
        path: `${repositoryUrl(ARCHIVED_REPOSITORY)}/pulls`,
        body: { title: "New pull request", base: "main", compare: "main" },
      },
    ];
    for (const cookie of [viewer, admin]) {
      for (const write of writes) {
        const refused = await request(app.baseUrl, "POST", write.path, write.body, cookie);
        assert.equal(refused.status, 403, `${write.path} must be refused`);
        assert.equal(refused.body.message, "Access denied");
      }
    }

    // The refused writes changed nothing: no extra branch, commit or issue.
    const branches = await request(
      app.baseUrl,
      "GET",
      `${repositoryUrl(ARCHIVED_REPOSITORY)}/branches`,
      undefined,
      admin,
    );
    assert.deepEqual(branches.body.branches.map((branch) => branch.name), ["main"]);
    assert.equal(branches.body.canWrite, false);
    const commits = await request(
      app.baseUrl,
      "GET",
      `${repositoryUrl(ARCHIVED_REPOSITORY)}/commits`,
      undefined,
      admin,
    );
    assert.equal(commits.body.commits.length, 1);
    const issues = await request(
      app.baseUrl,
      "GET",
      `${repositoryUrl(ARCHIVED_REPOSITORY)}/issues`,
      undefined,
      admin,
    );
    assert.deepEqual(issues.body.issues, []);
    assert.equal(issues.body.canWrite, false);
  } finally {
    await app.close();
  }
});

test("restoring an archived repository keeps its content", async () => {
  const app = await startApp();
  try {
    const anonymous = await request(app.baseUrl, "POST", `${repositoryUrl(RESTORED_REPOSITORY)}/restore`);
    assert.equal(anonymous.status, 401);

    const admin = await signIn(app.baseUrl, OWNER);
    const before = await request(
      app.baseUrl,
      "GET",
      `${repositoryUrl(RESTORED_REPOSITORY)}/blob?path=README.md`,
      undefined,
      admin,
    );
    assert.equal(before.status, 200);
    assert.equal(await archivedFlag(app.baseUrl, RESTORED_REPOSITORY, admin), true);

    const restored = await request(
      app.baseUrl,
      "POST",
      `${repositoryUrl(RESTORED_REPOSITORY)}/restore`,
      undefined,
      admin,
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.body.repository.archived, false);

    // The reloaded overview is Active and the existing content is unchanged.
    assert.equal(await archivedFlag(app.baseUrl, RESTORED_REPOSITORY, admin), false);
    const after = await request(
      app.baseUrl,
      "GET",
      `${repositoryUrl(RESTORED_REPOSITORY)}/blob?path=README.md`,
      undefined,
      admin,
    );
    assert.equal(after.status, 200);
    assert.equal(after.body.file.content, before.body.file.content);

    // The administrator keeps the write permission it had before archiving.
    const branches = await request(
      app.baseUrl,
      "GET",
      `${repositoryUrl(RESTORED_REPOSITORY)}/branches`,
      undefined,
      admin,
    );
    assert.equal(branches.body.canWrite, true);
  } finally {
    await app.close();
  }
});
