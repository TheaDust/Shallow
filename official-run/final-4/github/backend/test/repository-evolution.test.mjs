// REQ-3-1 evolution (repository search by name and description) and REQ-3-5
// (archive and restore a repository). The seeds, the search fields, the archive
// permission and the read-only rule of an archived repository are all checked
// through the public HTTP surface, including a restart over the same data
// directory.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const EVO_PASSWORD = "Evo-Password-987!";
const S1 = "/api/repositories/evo-archive-owner/evo-archive-repository-s1";
const S2 = "/api/repositories/evo-archive-owner/evo-archive-repository-s2";
const S3 = "/api/repositories/evo-archive-owner/evo-archive-repository-s3";

/** Starts the app over a data directory exactly like `server.mjs` does. */
async function startApp(dataDir) {
  const directory = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-evolution-")));
  const store = createAuthStore(directory);
  await store.ensureSeeded();
  const orgStore = createOrgStore(directory);
  await orgStore.ensureSeeded();
  const handler = createRequestHandler({ store, orgStore, staticRoot: join(directory, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir: directory,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function collectCookie(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
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
  assert.equal(result.status, 200, `sign-in of ${identifier} failed: ${JSON.stringify(result.body)}`);
  return result.cookie;
}

/** The repository names a query returns for the caller (a visitor when no cookie). */
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

test("repository search matches the name case-insensitively", async () => {
  const app = await startApp();
  try {
    // Scenario 1: an upper-case query still locates the exact repository.
    assert.deepEqual(await searchNames(app.baseUrl, "EVO-SEARCH-CATALOG-S1"), ["evo-search-catalog-s1"]);
    assert.deepEqual(await searchNames(app.baseUrl, "evo-search-catalog"), ["evo-search-catalog-s1"]);

    const result = await request(app.baseUrl, "GET", "/api/repositories?q=EVO-SEARCH-CATALOG-S1");
    const [repository] = result.body.repositories;
    assert.equal(repository.name, "evo-search-catalog-s1");
    assert.equal(repository.visibility, "public");
    assert.equal(repository.archived, false);
    assert.equal(repository.owner.displayName, "evo-search-owner");
    // The owner/name metadata the result row shows is the same identity the
    // overview is read by.
    const overview = await request(
      app.baseUrl,
      "GET",
      `/api/repositories/${repository.owner.id}/${repository.name}`,
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.repository.name, "evo-search-catalog-s1");
  } finally {
    await app.close();
  }
});

test("repository search matches the persisted description", async () => {
  const app = await startApp();
  try {
    // Scenario 2: only the description carries the query.
    assert.deepEqual(await searchNames(app.baseUrl, "evolution-notebook"), ["evo-search-notebook-s2"]);
    assert.deepEqual(await searchNames(app.baseUrl, "EVOLUTION-NOTEBOOK"), ["evo-search-notebook-s2"]);

    // Scenario 3: a query nothing matches reports no repositories.
    assert.deepEqual(await searchNames(app.baseUrl, "evo-search-empty-s3"), []);

    // The private repository stays outside the visitor's read scope.
    assert.deepEqual(await searchNames(app.baseUrl, "secret-research"), []);
  } finally {
    await app.close();
  }
});

test("the archive scenarios start from the provisioned statuses and files", async () => {
  const app = await startApp();
  try {
    const s1 = await request(app.baseUrl, "GET", S1);
    assert.equal(s1.status, 200);
    assert.equal(s1.body.repository.archived, false);

    for (const [path, name] of [
      [S2, "evo-archive-repository-s2"],
      [S3, "evo-archive-repository-s3"],
    ]) {
      const detail = await request(app.baseUrl, "GET", path);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.repository.name, name);
      assert.equal(detail.body.repository.archived, true);
      assert.equal(detail.body.repository.readmePath, "README.md");
      const blob = await request(app.baseUrl, "GET", `${path}/blob?path=README.md`);
      assert.equal(blob.status, 200);
      assert.match(blob.body.file.content, /evo-archive-repository/);
    }

    // The Member account reads the archived repository with its direct grant.
    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");
    const readable = await request(app.baseUrl, "GET", S2, undefined, viewer);
    assert.equal(readable.status, 200);
    assert.equal(readable.body.repository.archived, true);
    assert.equal(readable.body.repository.canWrite, false);

    // The Admin holds the repository-administrator permission as a grant.
    const admin = await signIn(app.baseUrl, "evo-archive-admin");
    const access = await request(app.baseUrl, "GET", `${S2}/access`, undefined, admin);
    assert.equal(access.status, 200);
    const own = access.body.access.find((entry) => entry.subjectName === "evo-archive-admin");
    assert.equal(own?.role, "Admin");
  } finally {
    await app.close();
  }
});

test("an administrator archives and restores a repository; the status persists", async () => {
  const app = await startApp();
  try {
    const anonymous = await request(app.baseUrl, "PATCH", `${S1}/archive`, { archived: true });
    assert.equal(anonymous.status, 401);

    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");
    const denied = await request(app.baseUrl, "PATCH", `${S1}/archive`, { archived: true }, viewer);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const admin = await signIn(app.baseUrl, "evo-archive-admin");
    const invalid = await request(app.baseUrl, "PATCH", `${S1}/archive`, { archived: "yes" }, admin);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.message, "Validation failed");

    const archived = await request(app.baseUrl, "PATCH", `${S1}/archive`, { archived: true }, admin);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.repository.archived, true);
    assert.equal(archived.body.repository.name, "evo-archive-repository-s1");

    // An archived repository stays readable but accepts no write, not even from
    // its administrator (scenario 2's read-only rule).
    const readable = await request(app.baseUrl, "GET", S1);
    assert.equal(readable.status, 200);
    assert.equal(readable.body.repository.archived, true);
    assert.equal(readable.body.repository.canWrite, false);
    const blockedFile = await request(
      app.baseUrl,
      "POST",
      `${S1}/files`,
      { path: "notes.md", content: "note", message: "Add notes" },
      admin,
    );
    assert.equal(blockedFile.status, 403);
    const blockedBranch = await request(app.baseUrl, "POST", `${S1}/branches`, { name: "topic" }, admin);
    assert.equal(blockedBranch.status, 403);
    const blockedIssue = await request(
      app.baseUrl,
      "POST",
      `${S1}/issues`,
      { title: "Archived", description: "" },
      admin,
    );
    assert.equal(blockedIssue.status, 403);
    const blockedPull = await request(
      app.baseUrl,
      "POST",
      `${S1}/pulls`,
      { title: "Archived", base: "main", compare: "main" },
      admin,
    );
    assert.equal(blockedPull.status, 403);

    // Scenario 1: the status survives a restart of the application.
    const restarted = await startApp(app.dataDir);
    try {
      const reloaded = await request(restarted.baseUrl, "GET", S1);
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.repository.archived, true);
      assert.deepEqual(await searchNames(restarted.baseUrl, "evo-archive-repository-s1"), [
        "evo-archive-repository-s1",
      ]);
    } finally {
      await restarted.close();
    }

    // Scenario 3: restoring returns the unchanged content and the write rule.
    const restored = await request(app.baseUrl, "PATCH", `${S1}/archive`, { archived: false }, admin);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.repository.archived, false);
    assert.equal(restored.body.repository.canWrite, true);
    const blob = await request(app.baseUrl, "GET", `${S1}/blob?path=README.md`);
    assert.equal(blob.status, 200);
    assert.match(blob.body.file.content, /evo-archive-repository-s1/);
    const written = await request(
      app.baseUrl,
      "POST",
      `${S1}/files`,
      { path: "restored.md", content: "restored", message: "Add restored notes" },
      admin,
    );
    assert.equal(written.status, 201);
  } finally {
    await app.close();
  }
});

test("the Member reads an archived repository without actionable write controls", async () => {
  const app = await startApp();
  try {
    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");

    const detail = await request(app.baseUrl, "GET", S2, undefined, viewer);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.repository.archived, true);
    assert.equal(detail.body.repository.canWrite, false);

    const branches = await request(app.baseUrl, "GET", `${S2}/branches`, undefined, viewer);
    assert.equal(branches.status, 200);
    assert.equal(branches.body.canWrite, false);

    const issues = await request(app.baseUrl, "GET", `${S2}/issues`, undefined, viewer);
    assert.equal(issues.status, 200);
    assert.equal(issues.body.canWrite, false);
    const newIssue = await request(
      app.baseUrl,
      "POST",
      `${S2}/issues`,
      { title: "Blocked", description: "" },
      viewer,
    );
    assert.equal(newIssue.status, 403);

    const pulls = await request(app.baseUrl, "GET", `${S2}/pulls`, undefined, viewer);
    assert.equal(pulls.status, 200);
    assert.equal(pulls.body.canWrite, false);
  } finally {
    await app.close();
  }
});

test("an inherited store keeps its records and gains this round's preset repositories", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-evolution-upgrade-"));
  // An older store: one user record (already archived by its owner) and the
  // seed keys the previous version recorded, but none of this round's preset
  // repositories.
  await writeFile(
    join(dataDir, "organizations.json"),
    `${JSON.stringify(
      {
        organizations: [{ id: "acme-demo", displayName: "Acme Demo" }],
        repositories: [
          {
            id: "repo-legacy-notes",
            ownerType: "account",
            ownerId: "account-evo-archive-owner",
            name: "legacy-notes",
            description: "Kept from the previous version.",
            visibility: "public",
            defaultBranch: "main",
            forkOfRepositoryId: null,
            archived: true,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
        appliedSeedKeys: ["organizations:acme-demo"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const app = await startApp(dataDir);
  try {
    // The user record and its archived status survive.
    const legacy = await request(app.baseUrl, "GET", "/api/repositories/evo-archive-owner/legacy-notes");
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.repository.archived, true);

    // The missing preset repositories of this round are appended by identity.
    for (const path of [S1, S2, S3]) {
      const detail = await request(app.baseUrl, "GET", path);
      assert.equal(detail.status, 200);
    }
    assert.deepEqual(await searchNames(app.baseUrl, "evo-archive-repository"), [
      "evo-archive-repository-s1",
      "evo-archive-repository-s2",
      "evo-archive-repository-s3",
    ]);

    // A second startup adds nothing twice.
    const restarted = await startApp(dataDir);
    try {
      assert.deepEqual(await searchNames(restarted.baseUrl, "evo-archive-repository"), [
        "evo-archive-repository-s1",
        "evo-archive-repository-s2",
        "evo-archive-repository-s3",
      ]);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});
