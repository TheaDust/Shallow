import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startServer(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallow-branches-")));
  const handler = await createRequestHandler({ dataDir: dir, staticRoot: dir });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    dataDir: dir,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function request(baseUrl, method, path, { body, cookies = "" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookies ? { cookie: cookies } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    payload: text ? JSON.parse(text) : null,
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  };
}

async function signIn(baseUrl, identifier) {
  const response = await request(baseUrl, "POST", "/api/signin", {
    body: { identifier, password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200, `sign-in failed for ${identifier}`);
  return response.cookie;
}

async function detail(baseUrl, repository, query = "", cookies = "") {
  const response = await request(
    baseUrl,
    "GET",
    `/api/repositories/demo-labs/${repository}${query}`,
    { cookies },
  );
  assert.equal(response.status, 200, `detail failed for ${repository}${query}`);
  return response.payload;
}

test("scenario 1: the branch selector lists the seeded branches and reads one snapshot", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  // The active branch is `main`; `feature-search` is available as a second
  // branch and carries the file that exists on that branch only.
  const onMain = await detail(app.baseUrl, "branch-switch-demo");
  assert.equal(onMain.branch, "main");
  assert.deepEqual(onMain.branches.map((branch) => branch.name), ["feature-search", "main"]);
  assert.deepEqual(onMain.files.map((file) => file.path), ["README.md"]);
  assert.equal(onMain.repository.defaultBranch, "main");

  const onTarget = await detail(app.baseUrl, "branch-switch-demo", "?branch=feature-search");
  assert.equal(onTarget.branch, "feature-search");
  assert.deepEqual(onTarget.files.map((file) => file.path), ["main-only.md", "README.md"]);

  // Switching a branch is read-only: it changes no branch, commit or file.
  const backOnMain = await detail(app.baseUrl, "branch-switch-demo");
  assert.deepEqual(backOnMain.files.map((file) => file.path), ["README.md"]);
});

test("scenario 1 and 2: a Write contributor creates a branch and reloads into it", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "branch-contributor");

  const created = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/branch-switch-demo/branches", {
    cookies: cookie,
    body: { name: "pw-branch-abc123" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.branch, "pw-branch-abc123");
  assert.deepEqual(created.payload.branches.map((branch) => branch.name), [
    "feature-search",
    "main",
    "pw-branch-abc123",
  ]);
  // The new reference starts at the base revision, so its snapshot matches the
  // branch it was created from.
  assert.deepEqual(created.payload.files.map((file) => file.path), ["README.md"]);

  const reloaded = await detail(app.baseUrl, "branch-switch-demo", "?branch=pw-branch-abc123");
  assert.equal(reloaded.branch, "pw-branch-abc123");
  assert.deepEqual(reloaded.files.map((file) => file.path), ["README.md"]);

  // The base branch keeps its files and its history.
  const main = await detail(app.baseUrl, "branch-switch-demo");
  assert.deepEqual(main.branches.map((branch) => branch.name), [
    "feature-search",
    "main",
    "pw-branch-abc123",
  ]);
  const mainHistory = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/demo-labs/branch-switch-demo/commits?branch=main",
  );
  assert.deepEqual(mainHistory.payload.commits.map((commit) => commit.message), ["Initial commit"]);

  // The name is refused rather than created twice.
  const duplicate = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/branch-switch-demo/branches", {
    cookies: cookie,
    body: { name: "pw-branch-abc123" },
  });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.payload.error, "Branch already exists");
});

test("scenario 2: an invalid branch name is refused and nothing is created", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "branch-contributor");

  for (const name of ["invalid..branch", "feature/", "release.", "feature//search", "with space", ""]) {
    const response = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/branch-switch-demo/branches", {
      cookies: cookie,
      body: { name },
    });
    assert.equal(response.status, 422, `accepted invalid branch name ${JSON.stringify(name)}`);
    assert.equal(response.payload.error, "Invalid branch");
  }

  const branches = await detail(app.baseUrl, "branch-switch-demo");
  assert.deepEqual(branches.branches.map((branch) => branch.name), ["feature-search", "main"]);
});

test("branch creation needs Write or higher: readers and visitors are refused", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const anonymous = await request(
    app.baseUrl,
    "POST",
    "/api/repositories/demo-labs/branch-switch-demo/branches",
    { body: { name: "pw-branch-anon" } },
  );
  assert.equal(anonymous.status, 401);

  // `default-branch-viewer` holds a Read grant on default-branch-demo: reading
  // is allowed, creating a branch is not.
  const viewer = await signIn(app.baseUrl, "default-branch-viewer");
  assert.equal((await detail(app.baseUrl, "default-branch-demo", "", viewer)).viewer.repositoryRole, "read");
  const denied = await request(
    app.baseUrl,
    "POST",
    "/api/repositories/demo-labs/default-branch-demo/branches",
    { cookies: viewer, body: { name: "pw-branch-denied" } },
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.error, "Access denied");

  // A signed-in account with no grant at all is refused the same way.
  const outsider = await signIn(app.baseUrl, "bob-reviewer");
  const outsiderDenied = await request(
    app.baseUrl,
    "POST",
    "/api/repositories/demo-labs/branch-switch-demo/branches",
    { cookies: outsider, body: { name: "pw-branch-outsider" } },
  );
  assert.equal(outsiderDenied.status, 403);
  assert.deepEqual((await detail(app.baseUrl, "branch-switch-demo")).branches.map((branch) => branch.name), [
    "feature-search",
    "main",
  ]);
});

test("scenario 1: a Write contributor adds one file and the branch head advances", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "file-contributor");

  const before = await detail(app.baseUrl, "file-management-demo", "", cookie);
  assert.equal(before.branch, "main");
  assert.deepEqual(before.files.map((file) => file.path), ["README.md"]);

  const created = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
    cookies: cookie,
    body: {
      path: "pw-file-unique.md",
      content: "Saved through the web editor\n",
      message: "Add pw-file-unique.md",
      branch: "main",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.path, "pw-file-unique.md");
  assert.equal(created.payload.content, "Saved through the web editor\n");
  assert.equal(created.payload.branch, "main");
  assert.equal(created.payload.commit.message, "Add pw-file-unique.md");
  assert.equal(created.payload.commit.author, "file-contributor");
  assert.ok(created.payload.commit.parentId, "the commit records its parent revision");

  // The saved file is part of the branch snapshot and its content is readable.
  const after = await detail(app.baseUrl, "file-management-demo", "", cookie);
  assert.deepEqual(after.files.map((file) => file.path), ["pw-file-unique.md", "README.md"]);
  const saved = after.files.find((file) => file.path === "pw-file-unique.md");
  assert.equal(saved.content, "Saved through the web editor\n");

  // The file's own history exposes the exact commit message.
  const history = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/demo-labs/file-management-demo/commits?path=pw-file-unique.md",
  );
  assert.equal(history.status, 200);
  assert.deepEqual(history.payload.commits.map((commit) => commit.message), ["Add pw-file-unique.md"]);

  // A restart of the same data directory keeps the file and its commit.
  const restarted = await startServer(app.dataDir);
  t.after(() => restarted.close());
  const persisted = await detail(restarted.baseUrl, "file-management-demo");
  assert.deepEqual(persisted.files.map((file) => file.path), ["pw-file-unique.md", "README.md"]);
  const persistedHistory = await request(
    restarted.baseUrl,
    "GET",
    "/api/repositories/demo-labs/file-management-demo/commits?path=pw-file-unique.md",
  );
  assert.deepEqual(persistedHistory.payload.commits.map((commit) => commit.message), ["Add pw-file-unique.md"]);
});

test("scenario 2: an invalid path and a missing message are reported and change nothing", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "file-contributor");

  const before = await detail(app.baseUrl, "file-management-demo", "", cookie);
  const beforeHistory = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/demo-labs/file-management-demo/commits",
  );

  const rejected = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
    cookies: cookie,
    body: { path: "../invalid.md", content: "must not be saved", message: "", branch: "main" },
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.payload.errors.path, "Invalid file path");
  assert.equal(rejected.payload.errors.message, "Commit message is required");

  const after = await detail(app.baseUrl, "file-management-demo", "", cookie);
  assert.deepEqual(after.files, before.files);
  const afterHistory = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/demo-labs/file-management-demo/commits",
  );
  assert.deepEqual(afterHistory.payload.commits, beforeHistory.payload.commits);
});

test("new file paths refuse empty, absolute, dot-dot and conflicting values", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "file-contributor");

  const invalidPaths = ["", "   ", "/absolute.md", "nested/../file.md", "..", "README.md", "README.md/inner.md"];
  for (const path of invalidPaths) {
    const response = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
      cookies: cookie,
      body: { path, content: "content", message: "Add a file", branch: "main" },
    });
    assert.equal(response.status, 422, `accepted invalid path ${JSON.stringify(path)}`);
    assert.equal(response.payload.errors.path, "Invalid file path");
  }

  // A path inside a new directory is accepted and listed under it.
  const nested = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
    cookies: cookie,
    body: { path: "docs/guide.md", content: "Guide\n", message: "Add docs/guide.md", branch: "main" },
  });
  assert.equal(nested.status, 201);

  // The directory path itself now conflicts with the file it holds.
  const conflict = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
    cookies: cookie,
    body: { path: "docs", content: "content", message: "Add docs", branch: "main" },
  });
  assert.equal(conflict.status, 422);
  assert.equal(conflict.payload.errors.path, "Invalid file path");
});

test("commit messages hold 1-72 non-empty characters after trimming", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "file-contributor");

  const tooLong = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
    cookies: cookie,
    body: { path: "pw-file-long.md", content: "content", message: "x".repeat(73), branch: "main" },
  });
  assert.equal(tooLong.status, 422);
  assert.equal(tooLong.payload.errors.message, "Commit message must be 72 characters or fewer");

  const atLimit = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
    cookies: cookie,
    body: { path: "pw-file-limit.md", content: "content", message: "y".repeat(72), branch: "main" },
  });
  assert.equal(atLimit.status, 201);
  assert.equal(atLimit.payload.commit.message, "y".repeat(72));

  // A whitespace-only message is the required-message case.
  const blank = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
    cookies: cookie,
    body: { path: "pw-file-blank.md", content: "content", message: "   ", branch: "main" },
  });
  assert.equal(blank.status, 422);
  assert.equal(blank.payload.errors.message, "Commit message is required");
});

test("only Write or higher may add files: visitors and readers are refused", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const anonymous = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/file-management-demo/files", {
    body: { path: "pw-file-anon.md", content: "content", message: "Add file", branch: "main" },
  });
  assert.equal(anonymous.status, 401);

  const viewer = await signIn(app.baseUrl, "default-branch-viewer");
  const denied = await request(app.baseUrl, "POST", "/api/repositories/demo-labs/default-branch-demo/files", {
    cookies: viewer,
    body: { path: "pw-file-denied.md", content: "content", message: "Add file", branch: "main" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.error, "Access denied");

  const unchanged = await detail(app.baseUrl, "default-branch-demo");
  assert.deepEqual(unchanged.files.map((file) => file.path), ["README.md"]);

  // A private repository is not even readable, so its content stays hidden.
  const outsider = await signIn(app.baseUrl, "bob-reviewer");
  const hidden = await request(app.baseUrl, "POST", "/api/repositories/acme-demo/secret-research/files", {
    cookies: outsider,
    body: { path: "notes.md", content: "content", message: "Add notes", branch: "main" },
  });
  assert.equal(hidden.status, 403);
});

test("scenario 1: an Admin changes the default branch and the choice persists", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "default-branch-admin");

  const before = await detail(app.baseUrl, "default-branch-demo", "", cookie);
  assert.equal(before.branch, "main");
  assert.equal(before.viewer.canManage, true);
  assert.deepEqual(before.branches.map((branch) => branch.name), ["main", "release"]);

  const updated = await request(
    app.baseUrl,
    "PUT",
    "/api/repositories/demo-labs/default-branch-demo/default-branch",
    { cookies: cookie, body: { branch: "release" } },
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.branch, "release");

  // Reopening the repository reads the new default branch while the previous
  // branch, its commits and its files stay exactly as they were.
  const reopened = await detail(app.baseUrl, "default-branch-demo", "", cookie);
  assert.equal(reopened.branch, "release");
  assert.equal(reopened.repository.defaultBranch, "release");
  assert.deepEqual(reopened.branches.map((branch) => branch.name), ["main", "release"]);
  assert.deepEqual(reopened.files.map((file) => file.path), ["README.md", "RELEASE.md"]);

  const main = await detail(app.baseUrl, "default-branch-demo", "?branch=main", cookie);
  assert.deepEqual(main.files.map((file) => file.path), ["README.md"]);
  const mainHistory = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/demo-labs/default-branch-demo/commits?branch=main",
  );
  assert.deepEqual(mainHistory.payload.commits.map((commit) => commit.message), ["Initial commit"]);

  // The setting belongs to the repository and survives a restart.
  const restarted = await startServer(app.dataDir);
  t.after(() => restarted.close());
  assert.equal((await detail(restarted.baseUrl, "default-branch-demo")).branch, "release");
});

test("scenario 2: a non-admin reader gets no default-branch control and no change", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await signIn(app.baseUrl, "default-branch-viewer");

  const loaded = await detail(app.baseUrl, "default-branch-demo", "", cookie);
  assert.equal(loaded.viewer.canManage, false);
  assert.equal(loaded.viewer.repositoryRole, "read");

  const denied = await request(
    app.baseUrl,
    "PUT",
    "/api/repositories/demo-labs/default-branch-demo/default-branch",
    { cookies: cookie, body: { branch: "release" } },
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.error, "Access denied");

  const anonymous = await request(
    app.baseUrl,
    "PUT",
    "/api/repositories/demo-labs/default-branch-demo/default-branch",
    { body: { branch: "release" } },
  );
  assert.equal(anonymous.status, 401);

  const unknownBranch = await request(
    app.baseUrl,
    "PUT",
    "/api/repositories/demo-labs/default-branch-demo/default-branch",
    { cookies: await signIn(app.baseUrl, "default-branch-admin"), body: { branch: "no-such-branch" } },
  );
  assert.equal(unknownBranch.status, 422);

  assert.equal((await detail(app.baseUrl, "default-branch-demo")).branch, "main");
});
