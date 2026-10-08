import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const EVOLUTION_PASSWORD = "Evo-Password-987!";
const ARCHIVE_ORG = "evo-archive-org";
const ARCHIVE_S1 = "/api/repositories/evo-archive-org/evo-archive-repository-s1";
const ARCHIVE_S2 = "/api/repositories/evo-archive-org/evo-archive-repository-s2";
const ARCHIVE_S3 = "/api/repositories/evo-archive-org/evo-archive-repository-s3";

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

test("REQ-3-5: an Admin archives the active repository and the status survives a restart", async () => {
  const app = await startApp();
  try {
    // The pre-provisioned repository starts Active.
    const initial = await request(app.baseUrl, "GET", ARCHIVE_S1);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.repository.archived, false);
    assert.equal(initial.body.repository.canManage, false);

    // Only a repository administrator may archive it.
    const anonymous = await request(app.baseUrl, "PATCH", `${ARCHIVE_S1}/archive`, { archived: true });
    assert.equal(anonymous.status, 401);

    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");
    const denied = await request(
      app.baseUrl,
      "PATCH",
      `${ARCHIVE_S1}/archive`,
      { archived: true },
      viewer,
    );
    assert.equal(denied.status, 403);

    const admin = await signIn(app.baseUrl, "evo-archive-admin");
    const invalid = await request(app.baseUrl, "PATCH", `${ARCHIVE_S1}/archive`, { archived: "yes" }, admin);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.archived, "Archive state is invalid");

    const archived = await request(app.baseUrl, "PATCH", `${ARCHIVE_S1}/archive`, { archived: true }, admin);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.repository.archived, true);
    assert.equal(archived.body.repository.name, "evo-archive-repository-s1");
    assert.equal(archived.body.repository.owner.displayName, ARCHIVE_ORG);

    // The overview record and a direct read agree, and the marker persists.
    const visitor = await request(app.baseUrl, "GET", ARCHIVE_S1);
    assert.equal(visitor.status, 200);
    assert.equal(visitor.body.repository.archived, true);
    assert.equal(visitor.body.repository.visibility, "public");

    const restarted = await startDataDir(app.dataDir);
    try {
      const reloaded = await request(restarted.baseUrl, "GET", ARCHIVE_S1);
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.repository.archived, true);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("REQ-3-5: the archived repository stays readable while every content write is refused", async () => {
  const app = await startApp();
  try {
    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");
    const detail = await request(app.baseUrl, "GET", ARCHIVE_S2, undefined, viewer);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.repository.archived, true);
    // The Member actually holds the write rule, so the Archived status is what
    // makes the write controls non-actionable.
    assert.equal(detail.body.repository.canWrite, true);
    assert.equal(detail.body.repository.canManage, false);

    // The seeded file, the issue list and the pull-request list stay readable.
    const file = await request(app.baseUrl, "GET", `${ARCHIVE_S2}/blob?path=README.md`, undefined, viewer);
    assert.equal(file.status, 200);
    assert.match(file.body.file.content, /# Repository/);
    const issues = await request(app.baseUrl, "GET", `${ARCHIVE_S2}/issues`, undefined, viewer);
    assert.equal(issues.status, 200);
    const pulls = await request(app.baseUrl, "GET", `${ARCHIVE_S2}/pulls`, undefined, viewer);
    assert.equal(pulls.status, 200);

    // File editing, branch creation, issue creation and pull-request creation
    // are refused without touching the stored data.
    const fileWrite = await request(
      app.baseUrl,
      "POST",
      `${ARCHIVE_S2}/files`,
      { path: "notes.md", content: "notes\n", message: "Add notes" },
      viewer,
    );
    assert.equal(fileWrite.status, 403);
    assert.equal(fileWrite.body.message, "Repository is archived");

    const branchWrite = await request(app.baseUrl, "POST", `${ARCHIVE_S2}/branches`, { name: "archived" }, viewer);
    assert.equal(branchWrite.status, 403);

    const issueWrite = await request(app.baseUrl, "POST", `${ARCHIVE_S2}/issues`, { title: "Archived" }, viewer);
    assert.equal(issueWrite.status, 403);

    const pullWrite = await request(
      app.baseUrl,
      "POST",
      `${ARCHIVE_S2}/pulls`,
      { title: "Archived", base: "main", compare: "main" },
      viewer,
    );
    assert.equal(pullWrite.status, 403);

    const commits = await request(app.baseUrl, "GET", `${ARCHIVE_S2}/commits`, undefined, viewer);
    assert.equal(commits.body.commits.length, 1);
    assert.equal(commits.body.repository.archived, true);
  } finally {
    await app.close();
  }
});

test("REQ-3-5: an existing store keeps its records and receives the archive seeds once", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-archive-upgrade-"));
  // A store written by an older build: the baseline organization, a repository a
  // user created and no `seedVersion` marker.
  await writeFile(
    join(dataDir, "organizations.json"),
    JSON.stringify({
      organizations: [{ id: "acme-demo", displayName: "Acme Demo" }],
      memberships: [{ organizationId: "acme-demo", accountId: "account-org-owner", role: "Owner" }],
      teams: [],
      teamMembers: [],
      repositories: [
        {
          id: "repo-user-notes",
          ownerType: "organization",
          ownerId: "acme-demo",
          name: "user-notes",
          description: "A repository the user created earlier.",
          visibility: "public",
          defaultBranch: "main",
          forkOfRepositoryId: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      branches: [],
      commits: [],
      accessGrants: [],
    }),
    "utf8",
  );

  const store = createOrgStore(dataDir);
  const repositories = await store.listReadableRepositories(null);
  const byName = new Map(repositories.map((repository) => [repository.name, repository]));
  assert.equal(byName.get("user-notes")?.description, "A repository the user created earlier.");
  assert.equal(byName.get("evo-archive-repository-s2")?.archived, true);
  assert.equal(byName.get("evo-archive-repository-s3")?.archived, true);
  assert.equal(byName.get("evo-archive-repository-s1")?.archived, false);
  assert.equal(byName.get("evo-search-catalog-s1")?.visibility, "public");
  assert.equal((await store.getMembership("evo-archive-org", "account-evo-archive-viewer"))?.role, "Member");

  // Restarting against the same directory neither duplicates nor rewrites.
  const restarted = createOrgStore(dataDir);
  const again = await restarted.listReadableRepositories(null);
  assert.equal(again.length, repositories.length);
  assert.equal(again.filter((repository) => repository.name === "evo-archive-repository-s2").length, 1);
  assert.equal(again.filter((repository) => repository.name === "user-notes").length, 1);
});

test("REQ-3-5: an Admin restores the archived repository and its content stays", async () => {
  const app = await startApp();
  try {
    const admin = await signIn(app.baseUrl, "evo-archive-admin");
    const before = await request(app.baseUrl, "GET", ARCHIVE_S3, undefined, admin);
    assert.equal(before.status, 200);
    assert.equal(before.body.repository.archived, true);
    assert.equal(before.body.repository.readmePath, "README.md");
    const commitsBefore = await request(app.baseUrl, "GET", `${ARCHIVE_S3}/commits`, undefined, admin);

    const restored = await request(app.baseUrl, "PATCH", `${ARCHIVE_S3}/archive`, { archived: false }, admin);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.repository.archived, false);

    const after = await request(app.baseUrl, "GET", ARCHIVE_S3, undefined, admin);
    assert.equal(after.body.repository.archived, false);
    assert.equal(after.body.repository.readmePath, "README.md");
    const file = await request(app.baseUrl, "GET", `${ARCHIVE_S3}/blob?path=README.md`, undefined, admin);
    assert.equal(file.status, 200);
    assert.match(file.body.file.content, /# Repository/);
    const commitsAfter = await request(app.baseUrl, "GET", `${ARCHIVE_S3}/commits`, undefined, admin);
    assert.deepEqual(
      commitsAfter.body.commits.map((commit) => commit.id),
      commitsBefore.body.commits.map((commit) => commit.id),
    );

    // The repository is writable again.
    const fileWrite = await request(
      app.baseUrl,
      "POST",
      `${ARCHIVE_S3}/files`,
      { path: "restored.md", content: "restored\n", message: "Add restored notes" },
      admin,
    );
    assert.equal(fileWrite.status, 201);
    assert.equal(fileWrite.body.repository.archived, false);

    const restarted = await startDataDir(app.dataDir);
    try {
      const reloaded = await request(restarted.baseUrl, "GET", ARCHIVE_S3, undefined, admin);
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.repository.archived, false);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});
