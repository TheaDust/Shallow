import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { branchNameError } from "../src/domain/repository-branch-writes.mjs";
import { createAppStore, createSeedData } from "../src/domain/store.mjs";

let app;
let dataDir;

function startApp(directory) {
  const store = createAppStore(directory);
  const handler = createRequestHandler({ store, staticRoot: join(directory, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        server,
        store,
        async request(path, { method = "GET", body, cookie } = {}) {
          const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
              ...(body === undefined ? {} : { "content-type": "application/json" }),
              ...(cookie ? { cookie } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const setCookie = response.headers.get("set-cookie") ?? "";
          const text = await response.text();
          return {
            status: response.status,
            cookie: setCookie.split(";")[0],
            body: text ? JSON.parse(text) : null,
          };
        },
        async signIn(identifier, password) {
          const response = await this.request("/api/sessions", {
            method: "POST",
            body: { identifier, password },
          });
          return response.cookie;
        },
      });
    });
  });
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-code-branches-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");
/** The seeded account that holds no role on any repository. */
const outsiderCookie = () => app.signIn("dana-observer", "Valid-password-123!");

async function storedRepository(name = "acme-docs") {
  let document;
  try {
    document = JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    document = createSeedData();
  }
  return document.repositories.find((repository) => repository.name === name);
}

const branchNames = (repository) => repository.branches.map((branch) => branch.name);
const headOf = (repository, name) => repository.branches.find((branch) => branch.name === name)?.headId;

describe("REQ-4-3-1 list and switch repository branches", () => {
  it("serves the seeded branches of the repository with the default branch first", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(response.status, 200);
    assert.equal(response.body.repository.defaultBranch, "main");
    assert.deepEqual(
      branchNames(response.body.repository),
      ["main", "feature-search", "release", "onboarding-docs", "draft-feature"],
    );

    // Switching a branch only changes the snapshot a page reads: the file the
    // `feature-search` branch carries is absent from `main`.
    const onMain = await app.request("/api/repositories/alice-dev/acme-docs/contents?branch=main");
    assert.ok(onMain.body.entries.some((entry) => entry.name === "README.md"));
    assert.ok(!onMain.body.entries.some((entry) => entry.name === "main-only.md"));

    const onTarget = await app.request("/api/repositories/alice-dev/acme-docs/contents?branch=feature-search");
    assert.equal(onTarget.body.branch, "feature-search");
    assert.ok(onTarget.body.entries.some((entry) => entry.name === "main-only.md"));
    assert.ok(onTarget.body.entries.some((entry) => entry.name === "README.md"));
  });

  it("keeps every branch readable after a visitor reads the page", async () => {
    const before = JSON.stringify(await storedRepository());
    await app.request("/api/repositories/alice-dev/acme-docs/contents?branch=release");
    assert.equal(JSON.stringify(await storedRepository()), before);
  });
});

describe("REQ-4-3-2 create a branch from an existing revision", () => {
  it("creates a branch at the current head for a writer and stores creator and time", async () => {
    const cookie = await aliceCookie();
    const before = await storedRepository();
    const mainHead = headOf(before, "main");

    const response = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      cookie,
      body: { name: "feature/api-v2", base: "main" },
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.repository.defaultBranch, "main");
    assert.deepEqual(branchNames(response.body.repository), [
      "main",
      "feature-search",
      "release",
      "onboarding-docs",
      "draft-feature",
      "feature/api-v2",
    ]);

    const stored = await storedRepository();
    const created = stored.branches.find((branch) => branch.name === "feature/api-v2");
    assert.equal(created.headId, mainHead);
    assert.equal(created.baseBranch, "main");
    assert.equal(created.createdBy, "account-alice-dev");
    assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    // Nothing is copied and no history is rewritten: the original branches keep
    // their heads and the commits are untouched.
    assert.equal(headOf(await storedRepository(), "main"), mainHead);
    assert.equal(headOf(await storedRepository(), "feature-search"), "d7b2a08-acme-docs-branch-notes");
    assert.equal(headOf(await storedRepository(), "release"), mainHead);
    assert.equal((await storedRepository()).commits.length, 5);

    // The new branch reads the snapshot of its base commit.
    const contents = await app.request("/api/repositories/alice-dev/acme-docs/contents?branch=feature/api-v2");
    assert.equal(contents.status, 200);
    assert.deepEqual(
      contents.body.entries.map((entry) => entry.name).sort(),
      ["CONTRIBUTING.md", "README.md", "docs", "src"],
    );
  });

  it("keeps the new branch after the store is reopened", async () => {
    const reopened = await startApp(dataDir);
    try {
      const response = await reopened.request("/api/repositories/alice-dev/acme-docs");
      assert.ok(branchNames(response.body.repository).includes("feature/api-v2"));
      const contents = await reopened.request(
        "/api/repositories/alice-dev/acme-docs/contents?branch=feature/api-v2&path=README.md",
      );
      assert.equal(contents.status, 200);
      assert.match(contents.body.file.content, /Documentation for the Acme Demo platform/);
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("accepts a commit identifier and the default branch as the base", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      cookie,
      body: { name: "point-at-initial", base: "4a1f7c2-acme-docs-initial" },
    });
    assert.equal(response.status, 201);
    const stored = await storedRepository();
    assert.equal(headOf(stored, "point-at-initial"), "4a1f7c2-acme-docs-initial");

    const withoutBase = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      cookie,
      body: { name: "from-default" },
    });
    assert.equal(withoutBase.status, 201);
    assert.equal(headOf(await storedRepository(), "from-default"), headOf(await storedRepository(), "main"));
  });

  it("rejects an invalid name, a duplicate name and an unknown base without creating a branch", async () => {
    const cookie = await aliceCookie();
    const before = await storedRepository();

    for (const name of ["invalid..branch", "bad name", "trailing/", "trailing.", "double//slash", "bad~name", ""]) {
      const response = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
        method: "POST",
        cookie,
        body: { name, base: "main" },
      });
      assert.equal(response.status, 400, `${name} should be refused`);
      assert.equal(response.body.fields.name, "Invalid branch");
    }

    const duplicate = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      cookie,
      body: { name: "main", base: "main" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fields.name, "Branch already exists");

    const unknownBase = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      cookie,
      body: { name: "from-nowhere", base: "no-such-revision" },
    });
    assert.equal(unknownBase.status, 400);
    assert.equal(unknownBase.body.fields.base, "Base revision not found");

    const tooLong = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      cookie,
      body: { name: "a".repeat(256), base: "main" },
    });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.fields.name, "Invalid branch");

    const after = await storedRepository();
    assert.deepEqual(branchNames(after), branchNames(before));
    assert.equal(after.commits.length, before.commits.length);
  });

  it("refuses a visitor and a reader", async () => {
    const before = await storedRepository();

    const anonymous = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      body: { name: "anonymous-branch", base: "main" },
    });
    assert.equal(anonymous.status, 401);

    // `dana-observer` may read this public repository but holds no role on it.
    const reader = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      cookie: await outsiderCookie(),
      body: { name: "reader-branch", base: "main" },
    });
    assert.equal(reader.status, 403);

    const after = await storedRepository();
    assert.deepEqual(branchNames(after), branchNames(before));
  });

  it("accepts a name ending in a digit and a generated unique name", async () => {
    const cookie = await aliceCookie();
    const generated = `pw-branch-${Date.now().toString(36)}`;
    const response = await app.request("/api/repositories/alice-dev/acme-docs/branches", {
      method: "POST",
      cookie,
      body: { name: generated, base: "main" },
    });
    assert.equal(response.status, 201);
    assert.ok(branchNames(await storedRepository()).includes(generated));
  });

  it("applies the documented branch-name rule", () => {
    assert.equal(branchNameError("main"), null);
    assert.equal(branchNameError("feature/api-v2"), null);
    assert.equal(branchNameError("release-1.2_x"), null);
    assert.equal(branchNameError("a".repeat(255)), null);
    assert.equal(branchNameError(""), "Invalid branch");
    assert.equal(branchNameError("a".repeat(256)), "Invalid branch");
    assert.equal(branchNameError("invalid..branch"), "Invalid branch");
    assert.equal(branchNameError("ends/"), "Invalid branch");
    assert.equal(branchNameError("ends."), "Invalid branch");
    assert.equal(branchNameError("two//slashes"), "Invalid branch");
    assert.equal(branchNameError("sp ace"), "Invalid branch");
    assert.equal(branchNameError("tilde~name"), "Invalid branch");
  });
});

describe("REQ-4-3-3 change the repository default branch", () => {
  it("shows the branch roles of the viewer on the overview read", async () => {
    const visitor = await app.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(visitor.body.repository.canChangeDefaultBranch, false);

    const reader = await app.request("/api/repositories/alice-dev/acme-docs", { cookie: await outsiderCookie() });
    assert.equal(reader.body.repository.canChangeDefaultBranch, false);

    const admin = await app.request("/api/repositories/alice-dev/acme-docs", { cookie: await aliceCookie() });
    assert.equal(admin.body.repository.canChangeDefaultBranch, true);
  });

  it("stores the new default branch with the operator and the time", async () => {
    const cookie = await aliceCookie();
    const before = await storedRepository();
    const mainHead = headOf(before, "main");

    const response = await app.request("/api/repositories/alice-dev/acme-docs/default-branch", {
      method: "POST",
      cookie,
      body: { branch: "release" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.repository.defaultBranch, "release");

    const stored = await storedRepository();
    assert.equal(stored.defaultBranch, "release");
    assert.equal(stored.defaultBranchUpdatedBy, "account-alice-dev");
    assert.match(stored.defaultBranchUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
    // The previous default branch and every commit stay available.
    for (const name of ["main", "feature-search", "release"]) {
      assert.ok(branchNames(stored).includes(name), `${name} should still exist`);
    }
    assert.equal(headOf(stored, "main"), mainHead);
    assert.equal(stored.commits.length, before.commits.length);

    // A page entry without a branch now reads `release`, while the selector
    // still offers the old default branch.
    const overview = await app.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(overview.body.repository.defaultBranch, "release");
    assert.ok(branchNames(overview.body.repository).includes("main"));

    // Reopening the store keeps the stored default branch.
    const reopened = await startApp(dataDir);
    try {
      const again = await reopened.request("/api/repositories/alice-dev/acme-docs");
      assert.equal(again.body.repository.defaultBranch, "release");
      assert.equal(again.body.repository.entries.length > 0, true);
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("refuses a non-Admin and a visitor without changing the stored default branch", async () => {
    const before = await storedRepository();

    const anonymous = await app.request("/api/repositories/alice-dev/acme-docs/default-branch", {
      method: "POST",
      body: { branch: "main" },
    });
    assert.equal(anonymous.status, 401);

    const reader = await app.request("/api/repositories/alice-dev/acme-docs/default-branch", {
      method: "POST",
      cookie: await outsiderCookie(),
      body: { branch: "main" },
    });
    assert.equal(reader.status, 403);

    assert.equal((await storedRepository()).defaultBranch, before.defaultBranch);
  });

  it("refuses an unknown branch", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs/default-branch", {
      method: "POST",
      cookie: await aliceCookie(),
      body: { branch: "no-such-branch" },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.fields.branch, "Branch not found");
    assert.equal((await storedRepository()).defaultBranch, "release");
  });
});
