// REQ-4-3-1 evolution (the branch-switching fixtures and the branch a code view
// reads) and REQ-4-5 (publish and read repository releases).
//
// Everything is checked through the public HTTP surface: the preset repositories
// and branches of this round, the branch-scoped code views, the publication of a
// release on an existing branch, the duplicate-tag refusal, the read rule for
// visitors, and the upgrade of an inherited store that predates these seeds.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const OWNER_PASSWORD = "Evo-Password-987!";
const BRANCH_REPOSITORY = (index) => `/api/repositories/evo-branch-owner/evo-branch-switch-s${index}`;
const RELEASE_REPOSITORY = (index) =>
  `/api/repositories/evo-release-owner/evo-release-repository-s${index}`;

/** Starts the app over a data directory exactly like `server.mjs` does. */
async function startApp(dataDir) {
  const directory = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-releases-")));
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

async function signIn(baseUrl, identifier, password = OWNER_PASSWORD) {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200, `sign-in of ${identifier} failed: ${JSON.stringify(result.body)}`);
  return result.cookie;
}

test("the branch-switching fixtures start on the preset branches", async () => {
  const app = await startApp();
  try {
    // Scenario 1 and 3: the active branch is `evo-main-sN`, the target branch is
    // a second named reference and only the target branch carries the extra file.
    for (const [index, targetFile] of [
      [1, "evo-target-s1.md"],
      [3, "evo-target-s3.md"],
    ]) {
      const listed = await request(app.baseUrl, "GET", `${BRANCH_REPOSITORY(index)}/branches`);
      assert.equal(listed.status, 200);
      assert.equal(listed.body.repository.visibility, "public");
      assert.equal(listed.body.defaultBranch, `evo-main-s${index}`);
      assert.deepEqual(
        listed.body.branches.map((branch) => branch.name),
        [`evo-main-s${index}`, `evo-feature-s${index}`],
      );

      const active = await request(app.baseUrl, "GET", `${BRANCH_REPOSITORY(index)}/tree`);
      assert.equal(active.status, 200);
      assert.equal(active.body.branch, `evo-main-s${index}`);
      assert.deepEqual(active.body.entries.map((entry) => entry.name).sort(), ["README.md"]);

      const target = await request(
        app.baseUrl,
        "GET",
        `${BRANCH_REPOSITORY(index)}/tree?branch=evo-feature-s${index}`,
      );
      assert.equal(target.status, 200);
      assert.equal(target.body.branch, `evo-feature-s${index}`);
      assert.deepEqual(
        target.body.entries.map((entry) => entry.name).sort(),
        ["README.md", targetFile].sort(),
      );
    }

    // Scenario 2: the repository exists with both branches and no target file.
    const s2 = await request(app.baseUrl, "GET", `${BRANCH_REPOSITORY(2)}/branches`);
    assert.equal(s2.body.defaultBranch, "evo-main-s2");
    assert.deepEqual(
      s2.body.branches.map((branch) => branch.name),
      ["evo-main-s2", "evo-feature-s2"],
    );
    const unknown = await request(
      app.baseUrl,
      "GET",
      `${BRANCH_REPOSITORY(2)}/tree?branch=evo-missing-s2`,
    );
    assert.equal(unknown.status, 404);
  } finally {
    await app.close();
  }
});

test("a visitor reads the published release detail of a public repository", async () => {
  const app = await startApp();
  try {
    // Scenario 2 of REQ-4-5: the list and the detail are readable without a
    // session, and the publishing control is not offered.
    const listed = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(2)}/releases`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.canPublish, false);
    assert.equal(listed.body.repository.visibility, "public");
    assert.deepEqual(
      listed.body.releases.map((release) => release.tag),
      ["evo-v0-1-s2"],
    );

    const detail = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(2)}/releases/evo-v0-1-s2`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.tag, "evo-v0-1-s2");
    assert.equal(detail.body.release.title, "Existing Evolution Release");
    assert.equal(detail.body.release.branch, "evo-main-s2");
    assert.ok(detail.body.release.description.length > 0);

    // The existing tag of the third fixture is stored as well.
    const third = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(3)}/releases/evo-v0-1-s3`);
    assert.equal(third.status, 200);
    assert.equal(third.body.release.branch, "evo-main-s3");

    // An unknown tag is not a release of that repository.
    const missing = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(2)}/releases/evo-v9-9`);
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test("the owner publishes a release on an existing branch and it persists", async () => {
  const app = await startApp();
  try {
    const payload = {
      tag: "evo-v0-1-s1",
      title: "Evolution Preview",
      description: "Evolution release description",
      branch: "evo-main-s1",
    };

    // Scenario 1: publishing needs a signed-in caller holding the write rule.
    const anonymous = await request(app.baseUrl, "POST", `${RELEASE_REPOSITORY(1)}/releases`, payload);
    assert.equal(anonymous.status, 401);

    const viewer = await signIn(app.baseUrl, "evo-archive-viewer");
    const denied = await request(
      app.baseUrl,
      "POST",
      `${RELEASE_REPOSITORY(1)}/releases`,
      payload,
      viewer,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    // The target branch must already exist in the repository.
    const owner = await signIn(app.baseUrl, "evo-release-owner");
    const badBranch = await request(
      app.baseUrl,
      "POST",
      `${RELEASE_REPOSITORY(1)}/releases`,
      { ...payload, branch: "evo-missing-branch" },
      owner,
    );
    assert.equal(badBranch.status, 400);
    assert.equal(badBranch.body.fieldErrors.branch, "Target branch is invalid");

    const published = await request(
      app.baseUrl,
      "POST",
      `${RELEASE_REPOSITORY(1)}/releases`,
      payload,
      owner,
    );
    assert.equal(published.status, 201);
    assert.equal(published.body.release.tag, "evo-v0-1-s1");
    assert.equal(published.body.release.title, "Evolution Preview");
    assert.equal(published.body.release.branch, "evo-main-s1");

    // The detail reads the same stored release, and the write rule is offered.
    const detail = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(1)}/releases/evo-v0-1-s1`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.description, "Evolution release description");
    const ownerList = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(1)}/releases`, undefined, owner);
    assert.equal(ownerList.body.canPublish, true);

    // The published release survives a restart of the application, and a second
    // startup writes no duplicate.
    const restarted = await startApp(app.dataDir);
    try {
      const reloaded = await request(
        restarted.baseUrl,
        "GET",
        `${RELEASE_REPOSITORY(1)}/releases/evo-v0-1-s1`,
      );
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.release.title, "Evolution Preview");
      const list = await request(restarted.baseUrl, "GET", `${RELEASE_REPOSITORY(1)}/releases`);
      assert.deepEqual(
        list.body.releases.map((release) => release.tag),
        ["evo-v0-1-s1"],
      );
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("an existing tag is refused with the exact message and creates no second release", async () => {
  const app = await startApp();
  try {
    // Scenario 3: the owner submits the tag the preset repository already
    // published. The form message is the stored refusal, and the repository
    // still holds exactly one release for that tag.
    const owner = await signIn(app.baseUrl, "evo-release-owner");
    const before = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(3)}/releases`, undefined, owner);
    assert.deepEqual(
      before.body.releases.map((release) => release.tag),
      ["evo-v0-1-s3"],
    );
    assert.equal(before.body.canPublish, true);

    const duplicate = await request(
      app.baseUrl,
      "POST",
      `${RELEASE_REPOSITORY(3)}/releases`,
      {
        tag: "evo-v0-1-s3",
        title: "A second title",
        description: "Must not be stored",
        branch: "evo-main-s3",
      },
      owner,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.message, "Tag already exists");
    assert.equal(duplicate.body.fieldErrors.tag, "Tag already exists");

    const after = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(3)}/releases`);
    assert.deepEqual(
      after.body.releases.map((release) => release.tag),
      ["evo-v0-1-s3"],
    );
    const detail = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(3)}/releases/evo-v0-1-s3`);
    assert.notEqual(detail.body.release.title, "A second title");

    // The same tag is unique per repository, not globally.
    const reused = await request(
      app.baseUrl,
      "POST",
      `${RELEASE_REPOSITORY(1)}/releases`,
      { tag: "evo-v0-1-s3", title: "Shared tag", description: "", branch: "evo-main-s1" },
      owner,
    );
    assert.equal(reused.status, 201);
  } finally {
    await app.close();
  }
});

test("an inherited store keeps its records and gains this round's preset objects", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-releases-upgrade-"));
  // An older store: one user record plus the seed keys the previous version
  // recorded, but none of this round's repositories or releases.
  await writeFile(
    join(dataDir, "organizations.json"),
    `${JSON.stringify(
      {
        organizations: [{ id: "acme-demo", displayName: "Acme Demo" }],
        repositories: [
          {
            id: "repo-legacy-notes",
            ownerType: "account",
            ownerId: "account-evo-release-owner",
            name: "legacy-notes",
            description: "Kept from the previous version.",
            visibility: "public",
            defaultBranch: "main",
            forkOfRepositoryId: null,
            archived: false,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
        releases: [
          {
            id: "release-legacy",
            repositoryId: "repo-legacy-notes",
            tag: "legacy-v1",
            title: "Legacy release",
            description: "Published by the previous version.",
            branch: "main",
            authorName: "evo-release-owner",
            createdAt: "2024-01-02T00:00:00.000Z",
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
    // The user record and its own release survive the upgrade.
    const legacy = await request(app.baseUrl, "GET", "/api/repositories/evo-release-owner/legacy-notes");
    assert.equal(legacy.status, 200);
    const legacyReleases = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/legacy-notes/releases",
    );
    assert.deepEqual(
      legacyReleases.body.releases.map((release) => release.tag),
      ["legacy-v1"],
    );

    // The preset repositories and releases of this round are appended by
    // identity, and stay reachable through the public entry points.
    for (const index of [1, 2, 3]) {
      const branchDetail = await request(app.baseUrl, "GET", BRANCH_REPOSITORY(index));
      assert.equal(branchDetail.status, 200);
      const releaseDetail = await request(app.baseUrl, "GET", RELEASE_REPOSITORY(index));
      assert.equal(releaseDetail.status, 200);
    }
    const preset = await request(app.baseUrl, "GET", `${RELEASE_REPOSITORY(2)}/releases`);
    assert.deepEqual(
      preset.body.releases.map((release) => release.tag),
      ["evo-v0-1-s2"],
    );

    // A second startup over the same directory adds nothing twice.
    const restarted = await startApp(dataDir);
    try {
      const list = await request(restarted.baseUrl, "GET", `${RELEASE_REPOSITORY(2)}/releases`);
      assert.deepEqual(
        list.body.releases.map((release) => release.tag),
        ["evo-v0-1-s2"],
      );
      const branches = await request(restarted.baseUrl, "GET", `${BRANCH_REPOSITORY(2)}/branches`);
      assert.deepEqual(
        branches.body.branches.map((branch) => branch.name),
        ["evo-main-s2", "evo-feature-s2"],
      );
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});
