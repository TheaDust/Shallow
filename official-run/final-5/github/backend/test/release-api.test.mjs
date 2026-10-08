// REQ-4-5 (repository releases) and the REQ-4-3-1 evolution seeds over the real
// HTTP surface: the seeded branches of the branch-switching evolution
// repositories, the readable release details, the publish operation with its
// permission and tag-uniqueness rules, and the idempotent seed upgrade.

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

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-release-"));
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

async function signIn(baseUrl, identifier, password) {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200);
  return result.cookie;
}

const fileNames = (body) => body.entries.map((entry) => entry.name);

test("REQ-4-3-1: the evolution repositories are seeded with their own branch snapshots", async () => {
  const app = await startApp();
  try {
    for (const [repository, mainBranch, featureBranch, targetFile] of [
      ["evo-branch-switch-s1", "evo-main-s1", "evo-feature-s1", "evo-target-s1.md"],
      ["evo-branch-switch-s2", "evo-main-s2", "evo-feature-s2", null],
      ["evo-branch-switch-s3", "evo-main-s3", "evo-feature-s3", "evo-target-s3.md"],
    ]) {
      const branches = await request(app.baseUrl, "GET", `/api/repositories/acme-demo/${repository}/branches`);
      assert.equal(branches.status, 200);
      assert.equal(branches.body.defaultBranch, mainBranch);
      assert.deepEqual(
        branches.body.branches.map((branch) => branch.name),
        [mainBranch, featureBranch],
      );

      // The default branch read without an explicit branch is the seeded one.
      const fallback = await request(app.baseUrl, "GET", `/api/repositories/acme-demo/${repository}/tree`);
      assert.equal(fallback.body.branch, mainBranch);
      assert.deepEqual(fileNames(fallback.body), ["README.md"]);

      const target = await request(
        app.baseUrl,
        "GET",
        `/api/repositories/acme-demo/${repository}/tree?branch=${featureBranch}`,
      );
      assert.equal(target.body.branch, featureBranch);
      assert.deepEqual(
        fileNames(target.body).sort(),
        targetFile ? [targetFile, "README.md"].sort() : ["README.md"],
      );
      if (targetFile) {
        assert.equal(
          (
            await request(
              app.baseUrl,
              "GET",
              `/api/repositories/acme-demo/${repository}/blob?path=${targetFile}`,
            )
          ).status,
          404,
        );
      }
    }
  } finally {
    await app.close();
  }
});

test("REQ-4-5: the Owner publishes a release and its detail survives a restart", async () => {
  const app = await startApp();
  const cookie = await signIn(app.baseUrl, "evo.release.owner@evolution.test", EVO_PASSWORD);
  try {
    const before = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s1/releases",
      undefined,
      cookie,
    );
    assert.equal(before.status, 200);
    assert.equal(before.body.canWrite, true);
    assert.deepEqual(before.body.releases, []);
    assert.equal(before.body.repository.defaultBranch, "evo-main-s1");

    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s1/releases",
      {
        tagName: "evo-v0-1-s1",
        title: "Evolution Preview",
        description: "Evolution release description",
        targetBranch: "evo-main-s1",
      },
      cookie,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.release.tagName, "evo-v0-1-s1");

    const detail = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s1/releases/evo-v0-1-s1",
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.tagName, "evo-v0-1-s1");
    assert.equal(detail.body.release.title, "Evolution Preview");
    assert.equal(detail.body.release.description, "Evolution release description");
    assert.equal(detail.body.release.targetBranch, "evo-main-s1");

    // A tag the repository does not have is unknown, and the target branch must
    // be one of the existing revisions.
    assert.equal(
      (
        await request(
          app.baseUrl,
          "GET",
          "/api/repositories/acme-demo/evo-release-repository-s1/releases/evo-v0-9-s1",
        )
      ).status,
      404,
    );
    const unknownBranch = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s1/releases",
      { tagName: "evo-v0-2-s1", title: "Other", description: "", targetBranch: "does-not-exist" },
      cookie,
    );
    assert.equal(unknownBranch.status, 400);
    assert.equal(unknownBranch.body.fieldErrors.targetBranch, "Target branch is invalid");
  } finally {
    await app.close();
  }

  const restarted = await startDataDir(app.dataDir);
  try {
    const detail = await request(
      restarted.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s1/releases/evo-v0-1-s1",
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.title, "Evolution Preview");
    assert.equal(detail.body.release.targetBranch, "evo-main-s1");
  } finally {
    await restarted.close();
  }
});

test("REQ-4-5: a visitor reads a published release but can never publish one", async () => {
  const app = await startApp();
  try {
    const list = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases",
    );
    assert.equal(list.status, 200);
    assert.equal(list.body.canWrite, false);
    assert.deepEqual(
      list.body.releases.map((release) => release.tagName),
      ["evo-v0-1-s2"],
    );

    const detail = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases/evo-v0-1-s2",
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.title, "Existing Evolution Release");
    assert.equal(detail.body.release.targetBranch, "evo-main-s2");
    assert.equal(typeof detail.body.release.description, "string");
    assert.ok(detail.body.release.description.length > 0);

    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases",
      { tagName: "evo-v1-0-s2", title: "Nope", description: "", targetBranch: "evo-main-s2" },
    );
    assert.equal(denied.status, 401);

    // A reader whose account exists but holds no write grant is refused too.
    const cookie = await signIn(app.baseUrl, "collaborator", "Valid-password-123!");
    const refused = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases",
      { tagName: "evo-v1-0-s2", title: "Nope", description: "", targetBranch: "evo-main-s2" },
      cookie,
    );
    assert.equal(refused.status, 403);
    assert.equal(refused.body.message, "Access denied");
  } finally {
    await app.close();
  }
});

test("REQ-4-5: an already used tag is refused and creates no second release", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-release-owner", EVO_PASSWORD);
    const before = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s3/releases",
      undefined,
      cookie,
    );
    assert.deepEqual(
      before.body.releases.map((release) => release.tagName),
      ["evo-v0-1-s3"],
    );

    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s3/releases",
      {
        tagName: "evo-v0-1-s3",
        title: "Duplicate Evolution Release",
        description: "Must not be published",
        targetBranch: "evo-main-s3",
      },
      cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.message, "Tag already exists");
    assert.equal(duplicate.body.fieldErrors.tagName, "Tag already exists");

    const after = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s3/releases",
      undefined,
      cookie,
    );
    assert.deepEqual(
      after.body.releases.map((release) => release.tagName),
      ["evo-v0-1-s3"],
    );
    assert.equal(after.body.releases[0].title, "Seeded Evolution Release");
  } finally {
    await app.close();
  }
});

test("REQ-4-5: an existing store receives the release seeds once and keeps its records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-release-upgrade-"));
  // A store written by the previous build: the older seed version, a user
  // repository and a user release of that repository, and no release record.
  await writeFile(
    join(dataDir, "organizations.json"),
    JSON.stringify({
      seedVersion: 3,
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
          description: "Kept as it is.",
          visibility: "public",
          defaultBranch: "main",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      branches: [
        {
          id: "branch-repo-user-notes-main",
          repositoryId: "repo-user-notes",
          name: "main",
          headCommitId: null,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      commits: [],
      accessGrants: [],
      releases: [
        {
          id: "release-repo-user-notes-v1",
          repositoryId: "repo-user-notes",
          tagName: "v1",
          title: "User release",
          description: "Kept.",
          targetBranch: "main",
          authorName: "org-owner",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );

  const store = createOrgStore(dataDir);
  // The user record and the user release are kept.
  assert.equal((await store.getRepositoryById("repo-user-notes")).name, "user-notes");
  const userReleases = await store.listRepositoryReleases("repo-user-notes");
  assert.deepEqual(userReleases.map((release) => release.tagName), ["v1"]);

  // The evolution repositories arrive with their branches and default branch.
  for (const [repositoryId, mainBranch, featureBranch] of [
    ["repo-evo-branch-switch-s1", "evo-main-s1", "evo-feature-s1"],
    ["repo-evo-branch-switch-s2", "evo-main-s2", "evo-feature-s2"],
    ["repo-evo-branch-switch-s3", "evo-main-s3", "evo-feature-s3"],
  ]) {
    const listed = await store.listRepositoryBranches(repositoryId);
    assert.equal(listed.defaultBranch, mainBranch);
    assert.deepEqual(
      listed.branches.map((branch) => branch.name),
      [mainBranch, featureBranch],
    );
  }
  // The release seeds and their publish permission are present.
  assert.deepEqual(
    (await store.listRepositoryReleases("repo-evo-release-repository-s2")).map((release) => release.tagName),
    ["evo-v0-1-s2"],
  );
  assert.deepEqual(
    (await store.listRepositoryReleases("repo-evo-release-repository-s3")).map((release) => release.tagName),
    ["evo-v0-1-s3"],
  );
  assert.equal(
    (await store.listAccessGrants("repo-evo-release-repository-s1")).some(
      (grant) => grant.subjectId === "account-evo-release-owner" && grant.role === "Write",
    ),
    true,
  );

  // Restarting neither duplicates nor rewrites anything.
  const restarted = createOrgStore(dataDir);
  assert.equal((await restarted.listRepositoryReleases("repo-user-notes")).length, 1);
  assert.equal((await restarted.listRepositoryReleases("repo-evo-release-repository-s2")).length, 1);
  assert.equal((await restarted.listRepositoryReleases("repo-evo-release-repository-s3")).length, 1);
  assert.equal((await restarted.listRepositoryBranches("repo-evo-branch-switch-s1")).branches.length, 2);
  const names = (await restarted.listReadableRepositories(null)).map((repository) => repository.name);
  assert.equal(names.filter((name) => name === "evo-release-repository-s1").length, 1);
});
