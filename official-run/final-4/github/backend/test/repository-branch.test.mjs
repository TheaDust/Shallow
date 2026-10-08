// REQ-4-3 (branch management) and REQ-4-4 (web file management) over the real
// HTTP surface: branch listing and switching, branch creation and its
// permission/validation rules, the repository default branch and the file
// commit written by the web editor.

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
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-branch-"));
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

const branchNames = (body) => body.branches.map((branch) => branch.name);
const fileNames = (body) => body.entries.map((entry) => entry.name);

test("a visitor lists the seeded branches and reads the branch-only file", async () => {
  const app = await startApp();
  try {
    const branches = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/branch-switch-demo/branches");
    assert.equal(branches.status, 200);
    assert.equal(branches.body.defaultBranch, "main");
    assert.deepEqual(branchNames(branches.body), ["main", "feature-search"]);
    assert.equal(branches.body.canWrite, false);

    const main = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-switch-demo/tree?branch=main",
    );
    assert.equal(main.status, 200);
    assert.equal(main.body.branch, "main");
    assert.deepEqual(fileNames(main.body), ["README.md"]);
    assert.equal(main.body.defaultBranch, "main");

    // Without an explicit branch the default branch is read.
    const fallback = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/branch-switch-demo/tree");
    assert.deepEqual(fileNames(fallback.body), ["README.md"]);

    const target = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-switch-demo/tree?branch=feature-search",
    );
    assert.equal(target.status, 200);
    assert.equal(target.body.branch, "feature-search");
    assert.deepEqual(fileNames(target.body), ["main-only.md", "README.md"]);

    const file = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-switch-demo/blob?branch=feature-search&path=main-only.md",
    );
    assert.equal(file.status, 200);
    assert.equal(file.body.file.branch, "feature-search");
    assert.match(file.body.file.content, /feature-search/);

    // Switching branches is read-only and the target-only file stays on the
    // target branch only.
    assert.equal(
      (await request(app.baseUrl, "GET", "/api/repositories/acme-demo/branch-switch-demo/blob?path=main-only.md"))
        .status,
      404,
    );
  } finally {
    await app.close();
  }
});

test("a Write contributor creates a branch from the current revision and keeps it after restart", async () => {
  const app = await startApp();
  try {
    const visitor = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-switch-demo/branches",
      { name: "visitor-branch", base: "main" },
    );
    assert.equal(visitor.status, 401);

    const cookie = await signIn(app.baseUrl, "branch-contributor");
    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-switch-demo/branches",
      { name: "pw-branch-1", base: "feature-search" },
      cookie,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.branch.name, "pw-branch-1");

    const branches = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-switch-demo/branches",
      undefined,
      cookie,
    );
    assert.equal(branches.body.canWrite, true);
    assert.deepEqual(branchNames(branches.body), ["main", "feature-search", "pw-branch-1"]);

    // The new branch starts from the base head revision without copying files
    // and without rewriting the base branch.
    const head = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-switch-demo/tree?branch=pw-branch-1",
    );
    assert.deepEqual(fileNames(head.body), ["main-only.md", "README.md"]);
    const base = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-switch-demo/branches",
    );
    assert.equal(
      base.body.branches.find((branch) => branch.name === "feature-search").headCommitId,
      branches.body.branches.find((branch) => branch.name === "pw-branch-1").headCommitId,
    );

    // Duplicate, invalid and unauthorized creations are rejected.
    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-switch-demo/branches",
      { name: "pw-branch-1", base: "main" },
      cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Branch name already exists");

    for (const invalid of ["invalid..branch", "topic/", "topic.", "a//b", ""]) {
      const rejected = await request(
        app.baseUrl,
        "POST",
        "/api/repositories/acme-demo/branch-switch-demo/branches",
        { name: invalid, base: "main" },
        cookie,
      );
      assert.equal(rejected.status, 400, `expected ${invalid} to be rejected`);
      assert.equal(rejected.body.fieldErrors.name, "Invalid branch");
    }

    const readerCookie = await signIn(app.baseUrl, "collaborator");
    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-switch-demo/branches",
      { name: "reader-branch", base: "main" },
      readerCookie,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");
  } finally {
    await app.close();
  }
});

test("the created branch survives a restart of the application", async () => {
  const app = await startApp();
  const cookie = await signIn(app.baseUrl, "branch-contributor");
  await request(
    app.baseUrl,
    "POST",
    "/api/repositories/acme-demo/branch-switch-demo/branches",
    { name: "pw-branch-restart", base: "main" },
    cookie,
  );
  await app.close();

  const restarted = await startDataDir(app.dataDir);
  try {
    const branches = await request(
      restarted.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-switch-demo/branches",
    );
    assert.ok(branchNames(branches.body).includes("pw-branch-restart"));
  } finally {
    await restarted.close();
  }
});

test("an administrator moves the default branch without touching the other branches", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/default-branch-demo");
    assert.equal(before.status, 200);
    assert.equal(before.body.repository.defaultBranch, "main");

    const viewerCookie = await signIn(app.baseUrl, "default-branch-viewer");
    const denied = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/default-branch-demo/default-branch",
      { branch: "release" },
      viewerCookie,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const adminCookie = await signIn(app.baseUrl, "default-branch-admin");
    const saved = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/default-branch-demo/default-branch",
      { branch: "release" },
      adminCookie,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.repository.defaultBranch, "release");

    // The repository now opens on `release` while `main` stays available.
    const tree = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/default-branch-demo/tree");
    assert.equal(tree.body.branch, "release");
    assert.deepEqual(fileNames(tree.body), ["README.md", "release-notes.md"]);
    const branches = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/default-branch-demo/branches",
    );
    assert.deepEqual(branchNames(branches.body), ["main", "release"]);
    const main = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/default-branch-demo/tree?branch=main",
    );
    assert.deepEqual(fileNames(main.body), ["README.md"]);

    const invalid = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/default-branch-demo/default-branch",
      { branch: "does-not-exist" },
      adminCookie,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.branch, "Default branch is invalid");
  } finally {
    await app.close();
  }
});

test("Read and Triage may browse but never write", async () => {
  const app = await startApp();
  try {
    // The organization Owner may administer the repository, so it hands out a
    // Read and a Triage grant on the same repository.
    const ownerCookie = await signIn(app.baseUrl, "org-owner");
    for (const [identifier, role] of [
      ["collaborator", "Read"],
      ["repo-admin", "Triage"],
    ]) {
      const granted = await request(
        app.baseUrl,
        "POST",
        "/api/repositories/acme-demo/branch-switch-demo/access",
        { subjectType: "account", subjectName: identifier, role },
        ownerCookie,
      );
      assert.equal(granted.status, 201);

      const cookie = await signIn(app.baseUrl, identifier);
      const tree = await request(
        app.baseUrl,
        "GET",
        "/api/repositories/acme-demo/branch-switch-demo/tree?branch=feature-search",
        undefined,
        cookie,
      );
      assert.equal(tree.status, 200, `${identifier} should read the repository`);
      assert.equal(tree.body.canWrite, undefined);

      const branch = await request(
        app.baseUrl,
        "POST",
        "/api/repositories/acme-demo/branch-switch-demo/branches",
        { name: `${identifier}-branch`, base: "main" },
        cookie,
      );
      assert.equal(branch.status, 403, `${identifier} must not create branches`);

      const file = await request(
        app.baseUrl,
        "POST",
        "/api/repositories/acme-demo/branch-switch-demo/files",
        { path: `${identifier}.md`, content: "nope", message: "Nope", branch: "main" },
        cookie,
      );
      assert.equal(file.status, 403, `${identifier} must not write files`);
    }
  } finally {
    await app.close();
  }
});

test("an organization Owner may also change the default branch", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "org-owner");
    const saved = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/branch-switch-demo/default-branch",
      { branch: "feature-search" },
      cookie,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.repository.defaultBranch, "feature-search");
    const main = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-switch-demo/tree?branch=main",
    );
    assert.deepEqual(fileNames(main.body), ["README.md"]);
  } finally {
    await app.close();
  }
});

test("a Write contributor adds a file through the API and the commit joins the history", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "file-contributor");
    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/file-management-demo/files",
      {
        path: "pw-file-1.md",
        content: "added through the web editor",
        message: "Add pw-file-1.md",
        branch: "main",
      },
      cookie,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.branch, "main");
    assert.equal(created.body.commit.message, "Add pw-file-1.md");
    assert.equal(created.body.commit.authorName, "file-contributor");
    assert.ok(created.body.commit.parentCommitId);

    const file = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/file-management-demo/blob?path=pw-file-1.md",
    );
    assert.equal(file.status, 200);
    assert.equal(file.body.file.content, "added through the web editor");
    assert.equal(file.body.file.branch, "main");

    const scoped = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/file-management-demo/commits?path=pw-file-1.md",
    );
    assert.deepEqual(scoped.body.commits.map((commit) => commit.message), ["Add pw-file-1.md"]);

    const history = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/file-management-demo/commits",
    );
    assert.deepEqual(history.body.commits.map((commit) => commit.message), [
      "Add pw-file-1.md",
      "Initial commit",
    ]);
  } finally {
    await app.close();
  }
});

test("an invalid file submission reports the reason and changes nothing", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "file-contributor");
    const before = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/file-management-demo/commits",
    );

    const invalidPath = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/file-management-demo/files",
      { path: "../invalid.md", content: "must not be saved", message: "", branch: "main" },
      cookie,
    );
    assert.equal(invalidPath.status, 400);
    assert.equal(invalidPath.body.fieldErrors.path, "Invalid file path");
    assert.equal(invalidPath.body.fieldErrors.message, "Commit message is required");

    const blankMessage = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/file-management-demo/files",
      { path: "notes.md", content: "content", message: "   ", branch: "main" },
      cookie,
    );
    assert.equal(blankMessage.status, 400);
    assert.equal(blankMessage.body.fieldErrors.message, "Commit message is required");

    const longMessage = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/file-management-demo/files",
      { path: "notes.md", content: "content", message: "x".repeat(73), branch: "main" },
      cookie,
    );
    assert.equal(longMessage.status, 400);
    assert.equal(longMessage.body.fieldErrors.message, "Commit message must be 72 characters or fewer");

    const conflict = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/file-management-demo/files",
      { path: "README.md", content: "overwrite", message: "Overwrite readme", branch: "main" },
      cookie,
    );
    assert.equal(conflict.status, 400);
    assert.equal(conflict.body.fieldErrors.path, "Invalid file path");

    const after = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/file-management-demo/commits",
    );
    assert.deepEqual(after.body.commits, before.body.commits);
    assert.equal(
      (await request(app.baseUrl, "GET", "/api/repositories/acme-demo/file-management-demo/blob?path=notes.md"))
        .status,
      404,
    );

    // A Read-only account may browse but never write.
    const readerCookie = await signIn(app.baseUrl, "collaborator");
    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/file-management-demo/files",
      { path: "reader.md", content: "nope", message: "Reader file", branch: "main" },
      readerCookie,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");
  } finally {
    await app.close();
  }
});
