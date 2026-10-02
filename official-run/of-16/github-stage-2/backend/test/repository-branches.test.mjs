import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

const BRANCH_DEMO = "ownerKind=organization&owner=acme-demo&name=branch-switch-demo";
const DEFAULT_DEMO = "ownerKind=organization&owner=acme-demo&name=default-branch-demo";
const CONTRIBUTOR = { username: "branch-contributor", password: "Valid-password-123!" };
const ADMIN = { username: "default-branch-admin", password: "Valid-password-123!" };
const VIEWER = { username: "default-branch-viewer", password: "Valid-password-123!" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-branches-"));
  const store = createStateStore({ dataDir });
  const app = createApp({ store });
  const server = createServer((request, response) => {
    void app(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    store,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function call(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function signIn(baseUrl, account) {
  const response = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: account.username, password: account.password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

test("REQ-4-3-1 a visitor lists the seeded branches and switches the browsing snapshot", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  // The repository overview names the active branch and lists every branch.
  const overview = await call(app.baseUrl, `/api/organizations/acme-demo/repositories/branch-switch-demo`);
  assert.equal(overview.status, 200);
  assert.equal(overview.body.repository.defaultBranch, "main");
  assert.equal(overview.body.repository.branch, "main");
  assert.deepEqual(overview.body.repository.branches, ["main", "feature-search"]);
  assert.deepEqual(overview.body.repository.files.map((entry) => entry.name), ["README.md"]);

  // The target branch is read through the same read-only endpoints; its
  // snapshot additionally carries the target-only file.
  const target = await call(
    app.baseUrl,
    `/api/organizations/acme-demo/repositories/branch-switch-demo?branch=feature-search`,
  );
  assert.equal(target.status, 200);
  assert.equal(target.body.repository.branch, "feature-search");
  assert.deepEqual(target.body.repository.files.map((entry) => entry.name), ["main-only.md", "README.md"]);

  const targetRoot = await call(app.baseUrl, `/api/repositories/tree?${BRANCH_DEMO}&branch=feature-search`);
  assert.equal(targetRoot.status, 200);
  assert.deepEqual(targetRoot.body.directory.entries.map((entry) => entry.name), ["main-only.md", "README.md"]);

  const targetFile = await call(
    app.baseUrl,
    `/api/repositories/files?${BRANCH_DEMO}&branch=feature-search&path=main-only.md`,
  );
  assert.equal(targetFile.status, 200);
  assert.equal(targetFile.body.file.name, "main-only.md");
  assert.equal(targetFile.body.file.branch, "feature-search");
  assert.ok(targetFile.body.file.content.length > 0);

  // The default branch does not carry the target-only file, and switching back
  // reads its own snapshot again.
  const mainRoot = await call(app.baseUrl, `/api/repositories/tree?${BRANCH_DEMO}&branch=main`);
  assert.equal(mainRoot.status, 200);
  assert.deepEqual(mainRoot.body.directory.entries.map((entry) => entry.name), ["README.md"]);
  const missing = await call(
    app.baseUrl,
    `/api/repositories/files?${BRANCH_DEMO}&branch=main&path=main-only.md`,
  );
  assert.equal(missing.status, 404);
  const back = await call(app.baseUrl, `/api/organizations/acme-demo/repositories/branch-switch-demo`);
  assert.equal(back.body.repository.branch, "main");

  // Listing and switching never writes: the branches, commits and files of the
  // demo repository stay exactly as seeded.
  const state = await app.store.read();
  const repository = state.repositories.find((candidate) => candidate.name === "branch-switch-demo");
  assert.deepEqual(
    state.branches.filter((branch) => branch.repositoryId === repository.id).map((branch) => branch.name),
    ["main", "feature-search"],
  );
  assert.equal(state.commits.filter((commit) => commit.repositoryId === repository.id).length, 2);
  assert.deepEqual(
    state.repositoryFiles
      .filter((file) => file.repositoryId === repository.id)
      .map((file) => file.path)
      .sort(),
    ["README.md", "README.md", "main-only.md"],
  );
});

test("REQ-4-3-2 a Write contributor creates a branch from the current head and keeps it", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const cookie = await signIn(app.baseUrl, CONTRIBUTOR);
  const before = await app.store.read();
  const repository = before.repositories.find((candidate) => candidate.name === "branch-switch-demo");
  const mainBranchBefore = before.branches.find((branch) => branch.repositoryId === repository.id
    && branch.name === "main");
  const mainHead = mainBranchBefore.headCommitId;
  const commitsBefore = before.commits.filter((commit) => commit.repositoryId === repository.id).length;
  const mainFilesBefore = before.repositoryFiles
    .filter((file) => file.repositoryId === repository.id && file.branchId === mainBranchBefore.id)
    .map((file) => file.path)
    .sort();

  const created = await call(app.baseUrl, "/api/repositories/branches", {
    method: "POST",
    cookie,
    body: { ownerKind: "organization", owner: "acme-demo", name: "branch-switch-demo", branch: "pw-branch-1" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.repository.branch, "pw-branch-1");
  assert.deepEqual(created.body.repository.branches, ["main", "feature-search", "pw-branch-1"]);
  // The new branch browses the revision it was created from.
  assert.deepEqual(created.body.repository.files.map((entry) => entry.name), ["README.md"]);

  // The reference points at the head commit of the base branch and no commit or
  // base file was added or rewritten.
  const after = await app.store.read();
  const branch = after.branches.find((candidate) => candidate.repositoryId === repository.id
    && candidate.name === "pw-branch-1");
  assert.equal(branch.headCommitId, mainHead);
  assert.equal(after.commits.filter((commit) => commit.repositoryId === repository.id).length, commitsBefore);
  const mainBranch = after.branches.find((candidate) => candidate.repositoryId === repository.id
    && candidate.name === "main");
  assert.deepEqual(
    after.repositoryFiles.filter((file) => file.branchId === mainBranch.id).map((file) => file.path).sort(),
    mainFilesBefore,
  );
  // The new branch reads the same history as its base revision (the base branch
  // here is `main`, so the target branch's own commit is not part of it).
  const history = await call(
    app.baseUrl,
    "/api/repositories/commits?ownerKind=organization&owner=acme-demo&name=branch-switch-demo&branch=pw-branch-1",
  );
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.history.commits.map((commit) => commit.message), ["Initial commit"]);

  // Reopening reads the same created branch (a restart keeps it too).
  const reopened = await call(
    app.baseUrl,
    `/api/organizations/acme-demo/repositories/branch-switch-demo?branch=pw-branch-1`,
    { cookie },
  );
  assert.equal(reopened.body.repository.branch, "pw-branch-1");
  const restarted = createStateStore({ dataDir: app.dataDir });
  const persisted = await restarted.read();
  assert.equal(
    persisted.branches.filter((candidate) => candidate.repositoryId === repository.id
      && candidate.name === "pw-branch-1").length,
    1,
  );
});

test("REQ-4-3-2 invalid, duplicate or unauthorized names are rejected without state changes", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const cookie = await signIn(app.baseUrl, CONTRIBUTOR);
  const before = await app.store.read();
  const branchesBefore = before.branches.length;
  const commitsBefore = before.commits.length;
  const filesBefore = before.repositoryFiles.length;

  const create = (branch, options = {}) => call(app.baseUrl, "/api/repositories/branches", {
    method: "POST",
    cookie: options.cookie ?? cookie,
    body: { ownerKind: "organization", owner: "acme-demo", name: "branch-switch-demo", branch },
  });

  // Every rejected shape reports the exact message and creates no branch.
  for (const invalid of [
    "invalid..branch",
    "feature-search.",
    "feature-search/",
    "feature//search",
    "feature search",
    "",
    "a".repeat(256),
  ]) {
    const rejected = await create(invalid);
    assert.equal(rejected.status, 400, `rejects ${JSON.stringify(invalid)}`);
    assert.equal(rejected.body.errors.branch, "Invalid branch");
  }

  // A duplicate name is rejected as well, and nothing about the stored branch
  // changes.
  const duplicate = await create("feature-search");
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.errors.branch, "Branch name already exists");

  // A signed-in account without write permission may browse but not create.
  const viewerCookie = await signIn(app.baseUrl, VIEWER);
  const forbidden = await create("viewer-branch", { cookie: viewerCookie });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, "Access denied");

  // A visitor is not signed in at all.
  const anonymous = await create("visitor-branch", { cookie: "" });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "Sign in required");

  const after = await app.store.read();
  assert.equal(after.branches.length, branchesBefore);
  assert.equal(after.commits.length, commitsBefore);
  assert.equal(after.repositoryFiles.length, filesBefore);
});

test("REQ-4-3-3 an administrator changes the default branch and keeps every existing branch", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const visitorOverview = await call(
    app.baseUrl,
    "/api/organizations/acme-demo/repositories/default-branch-demo",
  );
  assert.equal(visitorOverview.status, 200);
  assert.equal(visitorOverview.body.repository.defaultBranch, "main");
  assert.deepEqual(visitorOverview.body.repository.branches, ["main", "release"]);

  const before = await app.store.read();
  const repository = before.repositories.find((candidate) => candidate.name === "default-branch-demo");
  const commitsBefore = before.commits.filter((commit) => commit.repositoryId === repository.id).length;
  const filesBefore = before.repositoryFiles.filter((file) => file.repositoryId === repository.id).length;

  const adminCookie = await signIn(app.baseUrl, ADMIN);
  const changed = await call(app.baseUrl, "/api/repositories/default-branch", {
    method: "POST",
    cookie: adminCookie,
    body: { ownerKind: "organization", owner: "acme-demo", name: "default-branch-demo", branch: "release" },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.repository.defaultBranch, "release");
  assert.equal(changed.body.repository.branch, "release");

  // Reopening the repository reads the new default branch, and the previous
  // branch is still offered with its own commits and files.
  const reopened = await call(
    app.baseUrl,
    "/api/organizations/acme-demo/repositories/default-branch-demo",
    { cookie: adminCookie },
  );
  assert.equal(reopened.body.repository.branch, "release");
  assert.deepEqual(reopened.body.repository.branches, ["release", "main"]);
  const main = await call(
    app.baseUrl,
    "/api/organizations/acme-demo/repositories/default-branch-demo?branch=main",
  );
  assert.equal(main.body.repository.branch, "main");
  assert.deepEqual(main.body.repository.files.map((entry) => entry.name), ["README.md"]);

  const after = await app.store.read();
  assert.equal(after.commits.filter((commit) => commit.repositoryId === repository.id).length, commitsBefore);
  assert.equal(after.repositoryFiles.filter((file) => file.repositoryId === repository.id).length, filesBefore);
  assert.equal(after.branches.filter((branch) => branch.repositoryId === repository.id).length, 2);

  // The setting survives a restart.
  const restarted = createStateStore({ dataDir: app.dataDir });
  const persisted = await restarted.read();
  assert.equal(
    persisted.repositories.find((candidate) => candidate.id === repository.id).defaultBranch,
    "release",
  );
});

test("REQ-4-3-3 non-administrators never change the default branch", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const update = (cookie) => call(app.baseUrl, "/api/repositories/default-branch", {
    method: "POST",
    cookie,
    body: { ownerKind: "organization", owner: "acme-demo", name: "default-branch-demo", branch: "release" },
  });

  // The readable non-administrator may open the repository but not change it.
  const viewerCookie = await signIn(app.baseUrl, VIEWER);
  const readable = await call(
    app.baseUrl,
    "/api/organizations/acme-demo/repositories/default-branch-demo",
    { cookie: viewerCookie },
  );
  assert.equal(readable.status, 200);
  assert.equal(readable.body.repository.canManage, false);
  const denied = await update(viewerCookie);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Access denied");

  // A visitor is not signed in, and an unknown branch is refused as well.
  const anonymous = await update("");
  assert.equal(anonymous.status, 401);
  const adminCookie = await signIn(app.baseUrl, ADMIN);
  const unknown = await call(app.baseUrl, "/api/repositories/default-branch", {
    method: "POST",
    cookie: adminCookie,
    body: { ownerKind: "organization", owner: "acme-demo", name: "default-branch-demo", branch: "does-not-exist" },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.errors.branch, "Branch not found");

  const state = await app.store.read();
  const repository = state.repositories.find((candidate) => candidate.name === "default-branch-demo");
  assert.equal(repository.defaultBranch, "main");
});
