// REQ-4-3-1 (branch listing and switching, evolution seeds) and REQ-4-5
// (repository releases) over the real HTTP surface: the seeded branch pairs of
// the three branch-switch repositories, the published release a visitor reads,
// the release a Write grant publishes, the duplicate-tag refusal and the
// permission checks of the publishing operation.

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
  let closed = false;
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      if (closed) return;
      closed = true;
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

const releasesPath = (name) => `/api/repositories/acme-demo/${name}/releases`;
const branchNames = (body) => body.branches.map((branch) => branch.name);
const fileNames = (body) => body.entries.map((entry) => entry.name);

test("a visitor reads the branches and the branch-only file of every seeded repository", async () => {
  const app = await startApp();
  try {
    const specs = [
      { name: "evo-branch-switch-s1", active: "evo-main-s1", target: "evo-feature-s1", file: "evo-target-s1.md" },
      { name: "evo-branch-switch-s2", active: "evo-main-s2", target: "evo-feature-s2", file: null },
      { name: "evo-branch-switch-s3", active: "evo-main-s3", target: "evo-feature-s3", file: "evo-target-s3.md" },
    ];
    for (const spec of specs) {
      const branches = await request(app.baseUrl, "GET", `/api/repositories/acme-demo/${spec.name}/branches`);
      assert.equal(branches.status, 200);
      assert.equal(branches.body.defaultBranch, spec.active);
      assert.deepEqual(branchNames(branches.body), [spec.active, spec.target]);
      assert.equal(branches.body.canWrite, false);

      // The default branch is read when no branch is named.
      const active = await request(app.baseUrl, "GET", `/api/repositories/acme-demo/${spec.name}/tree`);
      assert.equal(active.body.branch, spec.active);
      assert.deepEqual(fileNames(active.body), ["README.md"]);

      const target = await request(
        app.baseUrl,
        "GET",
        `/api/repositories/acme-demo/${spec.name}/tree?branch=${spec.target}`,
      );
      assert.equal(target.status, 200);
      assert.equal(target.body.branch, spec.target);
      if (spec.file) {
        assert.deepEqual(fileNames(target.body), [spec.file, "README.md"]);
        assert.equal(
          (await request(app.baseUrl, "GET", `/api/repositories/acme-demo/${spec.name}/blob?path=${spec.file}`))
            .status,
          404,
        );
      }
    }
  } finally {
    await app.close();
  }
});

test("a visitor reads the published release of one repository", async () => {
  const app = await startApp();
  try {
    const list = await request(app.baseUrl, "GET", releasesPath("evo-release-repository-s2"));
    assert.equal(list.status, 200);
    assert.equal(list.body.canWrite, false);
    assert.equal(list.body.repository.name, "evo-release-repository-s2");
    assert.deepEqual(
      list.body.releases.map((release) => release.tag),
      ["evo-v0-1-s2"],
    );

    const detail = await request(
      app.baseUrl,
      "GET",
      `${releasesPath("evo-release-repository-s2")}/evo-v0-1-s2`,
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.tag, "evo-v0-1-s2");
    assert.equal(detail.body.release.title, "Existing Evolution Release");
    assert.equal(detail.body.release.targetBranch, "evo-main-s2");
    assert.equal(typeof detail.body.release.description, "string");
    assert.ok(detail.body.release.description.length > 0);

    // A repository without a published tag starts with an empty list, and an
    // unknown tag is not readable.
    const empty = await request(app.baseUrl, "GET", releasesPath("evo-release-repository-s1"));
    assert.deepEqual(empty.body.releases, []);
    assert.equal(
      (await request(app.baseUrl, "GET", releasesPath("evo-release-repository-s2") + "/evo-missing-s2")).status,
      404,
    );
  } finally {
    await app.close();
  }
});

test("the release Owner publishes one release and it survives a restart", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.release.owner@evolution.test", "Evo-Password-987!");
    const created = await request(
      app.baseUrl,
      "POST",
      releasesPath("evo-release-repository-s1"),
      {
        tag: "evo-v0-1-s1",
        title: "Evolution Preview",
        description: "Evolution release description",
        branch: "evo-main-s1",
      },
      cookie,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.release.tag, "evo-v0-1-s1");
    assert.equal(created.body.release.targetBranch, "evo-main-s1");

    const detail = await request(
      app.baseUrl,
      "GET",
      `${releasesPath("evo-release-repository-s1")}/evo-v0-1-s1`,
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.release.title, "Evolution Preview");
    assert.equal(detail.body.release.description, "Evolution release description");
    assert.equal(detail.body.release.targetBranch, "evo-main-s1");

    // The published tag is the stored record, so a second app over the same
    // data directory reads the same release.
    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const after = await request(
        restarted.baseUrl,
        "GET",
        `${releasesPath("evo-release-repository-s1")}/evo-v0-1-s1`,
      );
      assert.equal(after.status, 200);
      assert.equal(after.body.release.title, "Evolution Preview");
      assert.equal(after.body.release.targetBranch, "evo-main-s1");
      assert.equal((await request(restarted.baseUrl, "GET", releasesPath("evo-release-repository-s1"))).body
        .releases.length, 1);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a published tag is refused and creates no second release", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-release-owner", "Evo-Password-987!");
    const rejected = await request(
      app.baseUrl,
      "POST",
      releasesPath("evo-release-repository-s3"),
      {
        tag: "evo-v0-1-s3",
        title: "Duplicate attempt",
        description: "Must not be stored.",
        branch: "evo-main-s3",
      },
      cookie,
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.message, "Tag already exists");
    assert.equal(rejected.body.fieldErrors.tag, "Tag already exists");

    const list = await request(app.baseUrl, "GET", releasesPath("evo-release-repository-s3"));
    assert.equal(list.body.releases.length, 1);
    assert.equal(list.body.releases[0].title, "Existing Evolution Release");
  } finally {
    await app.close();
  }
});

test("only a writer may publish and the target branch has to exist", async () => {
  const app = await startApp();
  try {
    // An unauthenticated visitor is refused.
    const visitor = await request(app.baseUrl, "POST", releasesPath("evo-release-repository-s1"), {
      tag: "evo-v0-1-s1",
      title: "Visitor release",
      description: "",
      branch: "evo-main-s1",
    });
    assert.equal(visitor.status, 401);

    // A signed-in account without a write grant on this repository is refused.
    const reader = await signIn(app.baseUrl, "alice-dev", "Valid-password-123!");
    const refused = await request(
      app.baseUrl,
      "POST",
      releasesPath("evo-release-repository-s1"),
      { tag: "evo-v0-1-s1", title: "Reader release", description: "", branch: "evo-main-s1" },
      reader,
    );
    assert.equal(refused.status, 403);

    // The Write grant is not enough for a branch that does not exist, and a
    // rejected request stores nothing.
    const owner = await signIn(app.baseUrl, "evo-release-owner", "Evo-Password-987!");
    const invalid = await request(
      app.baseUrl,
      "POST",
      releasesPath("evo-release-repository-s1"),
      { tag: "evo-v0-1-s1", title: "Invalid branch", description: "", branch: "missing-branch" },
      owner,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.branch, "Target branch does not exist");
    assert.deepEqual(
      (await request(app.baseUrl, "GET", releasesPath("evo-release-repository-s1"))).body.releases,
      [],
    );

    // A missing tag is refused as well.
    const noTag = await request(
      app.baseUrl,
      "POST",
      releasesPath("evo-release-repository-s1"),
      { tag: "   ", title: "No tag", description: "", branch: "evo-main-s1" },
      owner,
    );
    assert.equal(noTag.status, 400);
    assert.equal(noTag.body.fieldErrors.tag, "Tag name is required");
  } finally {
    await app.close();
  }
});
