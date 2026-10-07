// REQ-4-5 (create and view repository releases) over the real HTTP surface: the
// predefined published release a visitor reads, publishing a new release as its
// writer, the exact duplicate-tag refusal and the per-operation permission rule.

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

async function signIn(baseUrl, identifier, password = "Evo-Password-987!") {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200);
  return result.cookie;
}

test("a visitor reads the predefined published release of its repository", async () => {
  const app = await startApp();
  try {
    const list = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s2/releases",
    );
    assert.equal(list.status, 200);
    assert.equal(list.body.canWrite, false);
    assert.deepEqual(list.body.releases.map((release) => release.tag), ["evo-v0-1-s2"]);

    const detail = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s2/releases/evo-v0-1-s2",
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.tag, "evo-v0-1-s2");
    assert.equal(detail.body.release.title, "Existing Evolution Release");
    assert.equal(detail.body.release.targetBranch, "evo-main-s2");
    assert.equal(typeof detail.body.release.description, "string");
    assert.ok(detail.body.release.description.length > 0);

    // `-s1` holds no release yet, and an unknown tag is not found.
    const empty = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s1/releases",
    );
    assert.deepEqual(empty.body.releases, []);
    const missing = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s1/releases/nope",
    );
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test("the Owner publishes a release onto an existing branch and it survives a restart", async () => {
  const app = await startApp();
  const cookie = await signIn(app.baseUrl, "evo-release-owner");
  const published = await request(
    app.baseUrl,
    "POST",
    "/api/repositories/evo-release-owner/evo-release-repository-s1/releases",
    {
      tag: "evo-v0-1-s1",
      title: "Evolution Preview",
      description: "Evolution release description",
      targetBranch: "evo-main-s1",
    },
    cookie,
  );
  assert.equal(published.status, 201);
  assert.equal(published.body.release.tag, "evo-v0-1-s1");
  assert.equal(published.body.release.title, "Evolution Preview");
  assert.equal(published.body.release.description, "Evolution release description");
  assert.equal(published.body.release.targetBranch, "evo-main-s1");

  const reread = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/evo-release-owner/evo-release-repository-s1/releases/evo-v0-1-s1",
  );
  assert.equal(reread.status, 200);
  assert.equal(reread.body.release.title, "Evolution Preview");
  await app.close();

  const restarted = await startDataDir(app.dataDir);
  try {
    const after = await request(
      restarted.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s1/releases/evo-v0-1-s1",
    );
    assert.equal(after.status, 200);
    assert.equal(after.body.release.title, "Evolution Preview");
    assert.equal(after.body.release.description, "Evolution release description");
    assert.equal(after.body.release.targetBranch, "evo-main-s1");
  } finally {
    await restarted.close();
  }
});

test("a duplicate tag is refused with the exact message and creates no second release", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-release-owner");
    const before = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s3/releases",
    );
    assert.equal(before.body.releases.length, 1);

    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/evo-release-owner/evo-release-repository-s3/releases",
      {
        tag: "evo-v0-1-s3",
        title: "Another title",
        description: "Another description",
        targetBranch: "evo-main-s3",
      },
      cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.tag, "Tag already exists");

    const after = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s3/releases",
    );
    assert.deepEqual(after.body.releases, before.body.releases);

    // An unknown branch and a blank tag are rejected without writing.
    const unknownBranch = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/evo-release-owner/evo-release-repository-s1/releases",
      { tag: "evo-v0-1-bad", title: "Title", description: "", targetBranch: "nope" },
      cookie,
    );
    assert.equal(unknownBranch.status, 400);
    assert.equal(unknownBranch.body.fieldErrors.targetBranch, "Target branch is invalid");

    const blankTag = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/evo-release-owner/evo-release-repository-s1/releases",
      { tag: "   ", title: "Title", description: "", targetBranch: "evo-main-s1" },
      cookie,
    );
    assert.equal(blankTag.status, 400);
    assert.equal(blankTag.body.fieldErrors.tag, "Tag name is required");
    assert.deepEqual(
      (await request(app.baseUrl, "GET", "/api/repositories/evo-release-owner/evo-release-repository-s1/releases"))
        .body.releases,
      [],
    );
  } finally {
    await app.close();
  }
});

test("publishing needs the write permission, which the server re-checks", async () => {
  const app = await startApp();
  try {
    const anonymous = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/evo-release-owner/evo-release-repository-s1/releases",
      { tag: "evo-v0-1-anon", title: "Title", description: "", targetBranch: "evo-main-s1" },
    );
    assert.equal(anonymous.status, 401);

    // A signed-in account without any grant on the public repository may read
    // it but not publish into it.
    const readerCookie = await signIn(app.baseUrl, "evo-archive-viewer");
    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/evo-release-owner/evo-release-repository-s1/releases",
      { tag: "evo-v0-1-read", title: "Title", description: "", targetBranch: "evo-main-s1" },
      readerCookie,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const readable = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s1/releases",
      undefined,
      readerCookie,
    );
    assert.equal(readable.status, 200);
    assert.equal(readable.body.canWrite, false);
  } finally {
    await app.close();
  }
});

test("the branch-switch evolution repositories expose their active and target branches", async () => {
  const app = await startApp();
  try {
    const branches = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-branch-switch-owner/evo-branch-switch-s1/branches",
    );
    assert.equal(branches.status, 200);
    assert.equal(branches.body.defaultBranch, "evo-main-s1");
    assert.deepEqual(branches.body.branches.map((branch) => branch.name), ["evo-main-s1", "evo-feature-s1"]);

    const main = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-branch-switch-owner/evo-branch-switch-s1/tree?branch=evo-main-s1",
    );
    assert.deepEqual(main.body.entries.map((entry) => entry.name), ["README.md"]);
    const target = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-branch-switch-owner/evo-branch-switch-s1/tree?branch=evo-feature-s1",
    );
    assert.ok(target.body.entries.some((entry) => entry.name === "evo-target-s1.md"));

    const s2 = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-branch-switch-owner/evo-branch-switch-s2/branches",
    );
    assert.deepEqual(s2.body.branches.map((branch) => branch.name), ["evo-main-s2", "evo-feature-s2"]);

    const s3 = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-branch-switch-owner/evo-branch-switch-s3/branches",
    );
    assert.deepEqual(s3.body.branches.map((branch) => branch.name), ["evo-main-s3", "evo-feature-s3"]);
  } finally {
    await app.close();
  }
});
