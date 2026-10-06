// REQ-4-5 (repository releases) and the branch-selector evolution seeds of
// REQ-4-3-1 over the real HTTP surface: the released tags of a public
// repository, publishing one release, the uniqueness of a tag inside its
// repository and the persisted release after a restart.

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

async function signIn(baseUrl, identifier, password = "Valid-password-123!") {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200);
  return result.cookie;
}

const releaseTags = (body) => body.releases.map((release) => release.tagName);

test("a visitor reads the published release of a public repository", async () => {
  const app = await startApp();
  try {
    const list = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases",
    );
    assert.equal(list.status, 200);
    assert.deepEqual(releaseTags(list.body), ["evo-v0-1-s2"]);
    assert.equal(list.body.canWrite, false);

    const detail = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases/evo-v0-1-s2",
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.tagName, "evo-v0-1-s2");
    assert.equal(detail.body.release.title, "Existing Evolution Release");
    assert.equal(detail.body.release.targetBranch, "evo-main-s2");
    assert.ok(detail.body.release.description.length > 0);

    // A tag that was never released stays unknown.
    assert.equal(
      (
        await request(
          app.baseUrl,
          "GET",
          "/api/repositories/acme-demo/evo-release-repository-s2/releases/no-such-tag",
        )
      ).status,
      404,
    );

    // A visitor may not publish.
    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases",
      { tagName: "evo-v0-2-s2", title: "Visitor release", description: "nope", targetBranch: "evo-main-s2" },
    );
    assert.equal(denied.status, 401);
  } finally {
    await app.close();
  }
});

test("the release Owner publishes one release and it survives a restart", async () => {
  const app = await startApp();
  const cookie = await signIn(app.baseUrl, "evo.release.owner@evolution.test", EVO_PASSWORD);
  try {
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
    assert.equal(created.body.release.targetBranch, "evo-main-s1");
    assert.equal(created.body.release.author, "evo-release-owner");

    const list = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s1/releases",
      undefined,
      cookie,
    );
    assert.deepEqual(releaseTags(list.body), ["evo-v0-1-s1"]);
    assert.equal(list.body.canWrite, true);
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
    assert.equal(detail.body.release.description, "Evolution release description");
  } finally {
    await restarted.close();
  }
});

test("an already used tag is refused and no second release is created", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-release-owner", EVO_PASSWORD);
    const before = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s3/releases",
    );
    assert.deepEqual(releaseTags(before.body), ["evo-v0-1-s3"]);

    const refused = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s3/releases",
      {
        tagName: "evo-v0-1-s3",
        title: "Second Evolution Release",
        description: "A second release for the same tag",
        targetBranch: "evo-main-s3",
      },
      cookie,
    );
    assert.equal(refused.status, 400);
    assert.equal(refused.body.message, "Tag already exists");
    assert.equal(refused.body.fieldErrors.tagName, "Tag already exists");

    // An unknown target branch and a missing tag are refused as well, and the
    // stored releases stay exactly as they were.
    const badBranch = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s3/releases",
      { tagName: "evo-v0-2-s3", title: "Release", description: "", targetBranch: "no-such-branch" },
      cookie,
    );
    assert.equal(badBranch.status, 400);
    assert.equal(badBranch.body.fieldErrors.targetBranch, "Target branch is invalid");

    const after = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s3/releases",
    );
    assert.deepEqual(after.body, before.body);
  } finally {
    await app.close();
  }
});

test("a read-only account may view releases but never publish one", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-archive-viewer", EVO_PASSWORD);
    const list = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases",
      undefined,
      cookie,
    );
    assert.equal(list.status, 200);
    assert.equal(list.body.canWrite, false);

    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/evo-release-repository-s2/releases",
      { tagName: "evo-v0-2-s2", title: "Reader release", description: "", targetBranch: "evo-main-s2" },
      cookie,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");
  } finally {
    await app.close();
  }
});

test("the evolution branch seeds keep their active and target branches apart", async () => {
  const app = await startApp();
  try {
    for (const [repository, base, target, targetFile] of [
      ["evo-branch-switch-s1", "evo-main-s1", "evo-feature-s1", "evo-target-s1.md"],
      ["evo-branch-switch-s3", "evo-main-s3", "evo-feature-s3", "evo-target-s3.md"],
    ]) {
      const branches = await request(app.baseUrl, "GET", `/api/repositories/acme-demo/${repository}/branches`);
      assert.equal(branches.status, 200);
      assert.equal(branches.body.defaultBranch, base);
      assert.deepEqual(branches.body.branches.map((branch) => branch.name), [base, target]);
      assert.equal(branches.body.canWrite, false);

      // The active branch is read by default and does not carry the
      // target-only file; the target branch does.
      const active = await request(app.baseUrl, "GET", `/api/repositories/acme-demo/${repository}/tree`);
      assert.equal(active.body.branch, base);
      assert.deepEqual(active.body.entries.map((entry) => entry.name), ["README.md"]);

      const selected = await request(
        app.baseUrl,
        "GET",
        `/api/repositories/acme-demo/${repository}/tree?branch=${target}`,
      );
      assert.equal(selected.body.branch, target);
      assert.ok(selected.body.entries.some((entry) => entry.name === targetFile));
    }

    // The unmatched-query repository exposes the available target branch too.
    const s2 = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/evo-branch-switch-s2/branches");
    assert.deepEqual(s2.body.branches.map((branch) => branch.name), ["evo-main-s2", "evo-feature-s2"]);
    assert.equal(
      (
        await request(
          app.baseUrl,
          "GET",
          "/api/repositories/acme-demo/evo-branch-switch-s2/tree?branch=evo-missing-s2",
        )
      ).status,
      404,
    );
  } finally {
    await app.close();
  }
});
