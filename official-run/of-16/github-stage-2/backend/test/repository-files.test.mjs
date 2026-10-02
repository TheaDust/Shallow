import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

/** The seeded repository and the contributor that may write to it. */
const REPOSITORY = {
  ownerKind: "account",
  owner: "file-contributor",
  name: "file-management-demo",
};
const CONTRIBUTOR = { username: "file-contributor", password: "Valid-password-123!" };
const BROWSER = { username: "default-branch-viewer", password: "Valid-password-123!" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-repository-files-"));
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

function addFile(baseUrl, cookie, overrides = {}) {
  return call(baseUrl, "/api/repositories/files", {
    method: "POST",
    cookie,
    body: {
      ...REPOSITORY,
      branch: "main",
      path: "notes.md",
      content: "Notes\n",
      message: "Add notes.md",
      ...overrides,
    },
  });
}

/** Branch head, files and commit history of the seeded repository. */
async function readRepository(app) {
  const state = await app.store.read();
  const repository = state.repositories.find((entry) => entry.name === "file-management-demo");
  const branch = state.branches.find((entry) => (
    entry.repositoryId === repository.id && entry.name === repository.defaultBranch
  ));
  return {
    state,
    repository,
    branch,
    commits: state.commits.filter((commit) => commit.repositoryId === repository.id),
    files: state.repositoryFiles.filter((file) => file.repositoryId === repository.id),
  };
}

test("REQ-4-4 scenario 1: the Write contributor adds a file through one commit and reads it back", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await readRepository(app);
  const cookie = await signIn(app.baseUrl, CONTRIBUTOR);

  const created = await call(app.baseUrl, "/api/repositories/files", {
    method: "POST",
    cookie,
    body: {
      ...REPOSITORY,
      branch: "main",
      path: "pw-file-1.md",
      content: "Added through the web interface\n",
      message: "Add pw-file-1.md",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.file.name, "pw-file-1.md");
  assert.equal(created.body.file.path, "pw-file-1.md");
  assert.equal(created.body.file.branch, "main");
  assert.equal(created.body.file.content, "Added through the web interface\n");
  assert.equal(created.body.file.repository, "file-management-demo");
  assert.deepEqual(created.body.file.owner, { kind: "account", name: "file-contributor", slug: "file-contributor" });

  // Exactly one commit was appended to the branch: it carries the path, the
  // content, the message, the author, the previous head as parent and the
  // target branch, and the branch reference advanced to it.
  const after = await readRepository(app);
  assert.equal(after.commits.length, before.commits.length + 1);
  const commit = after.commits.find((entry) => entry.id === created.body.commit.id);
  assert.ok(commit);
  assert.equal(commit.message, "Add pw-file-1.md");
  assert.equal(commit.authorName, "file-contributor");
  assert.equal(commit.parentId, before.branch.headCommitId);
  assert.equal(after.branch.headCommitId, commit.id);
  assert.equal(commit.branchId, after.branch.id);
  assert.deepEqual(commit.changes.map((change) => change.path), ["pw-file-1.md"]);
  assert.equal(commit.changes[0].after, "Added through the web interface\n");
  assert.equal(commit.changes[0].before, null);

  // The stored file is readable and the directory of the branch lists it.
  const file = await call(
    app.baseUrl,
    `/api/repositories/files?ownerKind=account&owner=file-contributor&name=file-management-demo`
      + "&branch=main&path=pw-file-1.md",
  );
  assert.equal(file.status, 200);
  assert.equal(file.body.file.content, "Added through the web interface\n");
  const root = await call(
    app.baseUrl,
    "/api/repositories/tree?ownerKind=account&owner=file-contributor&name=file-management-demo&branch=main",
  );
  assert.deepEqual(root.body.directory.entries.map((entry) => entry.name).sort(), ["README.md", "pw-file-1.md"]);

  // The history of that very path exposes the submitted message first.
  const history = await call(
    app.baseUrl,
    "/api/repositories/commits?ownerKind=account&owner=file-contributor&name=file-management-demo"
      + "&branch=main&path=pw-file-1.md",
  );
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.history.commits.map((entry) => entry.message), ["Add pw-file-1.md"]);

  // Reload (a fresh store over the same data dir) keeps the added file.
  const restarted = createStateStore({ dataDir: app.dataDir });
  const restartedState = await restarted.read();
  const stored = restartedState.repositoryFiles.find((entry) => entry.path === "pw-file-1.md");
  assert.equal(stored.content, "Added through the web interface\n");
});

test("REQ-4-4 scenario 2: an invalid path with a missing message changes nothing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const cookie = await signIn(app.baseUrl, CONTRIBUTOR);
  const before = await readRepository(app);
  const commitsBefore = before.commits.length;
  const filesBefore = before.files.length;
  const headBefore = before.branch.headCommitId;

  const rejected = await addFile(app.baseUrl, cookie, {
    path: "../invalid.md",
    content: "must not be saved",
    message: "",
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.errors.path, "Invalid file path");
  assert.equal(rejected.body.errors.message, "Commit message is required");

  // The branch head, the stored files and the commit history stay as they were
  // and the rejected content is nowhere in the repository.
  const after = await readRepository(app);
  assert.equal(after.commits.length, commitsBefore);
  assert.equal(after.files.length, filesBefore);
  assert.equal(after.branch.headCommitId, headBefore);
  assert.equal(after.files.some((file) => file.content.includes("must not be saved")), false);
  assert.equal(after.files.some((file) => file.path.includes("invalid")), false);
});

test("REQ-4-4 the file path and commit message rules are enforced without partial writes", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const cookie = await signIn(app.baseUrl, CONTRIBUTOR);
  const before = await readRepository(app);

  const invalid = [
    { path: "", message: "Add file", expected: "Invalid file path" },
    { path: "   ", message: "Add file", expected: "Invalid file path" },
    { path: "/absolute.md", message: "Add file", expected: "Invalid file path" },
    { path: "docs/../escape.md", message: "Add file", expected: "Invalid file path" },
    { path: "README.md", message: "Add file", expected: "Invalid file path" },
    { path: "notes.md", message: "", expected: "Commit message is required" },
    { path: "notes.md", message: "   ", expected: "Commit message is required" },
    { path: "notes.md", message: "x".repeat(73), expected: "Commit message must be 72 characters or less" },
  ];
  for (const entry of invalid) {
    const rejected = await addFile(app.baseUrl, cookie, { path: entry.path, message: entry.message });
    assert.equal(rejected.status, 400, `${entry.path || "<empty>"} is rejected`);
    assert.ok(
      Object.values(rejected.body.errors).includes(entry.expected),
      `${entry.path || "<empty>"} reports ${entry.expected}`,
    );
  }

  // A directory path that already organizes a stored file is a conflict too.
  const directory = await addFile(app.baseUrl, cookie, {
    path: "docs/notes.md",
    content: "Nested\n",
    message: "Add docs/notes.md",
  });
  assert.equal(directory.status, 201);
  const conflict = await addFile(app.baseUrl, cookie, { path: "docs", message: "Add docs" });
  assert.equal(conflict.status, 400);
  assert.equal(conflict.body.errors.path, "Invalid file path");

  // The message limit is inclusive: 72 characters after trimming are accepted.
  const longest = "y".repeat(72);
  const accepted = await addFile(app.baseUrl, cookie, { path: "long-message.md", message: `  ${longest}  ` });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.commit.message, longest);

  // Two accepted submissions and no rejected one reached the history.
  const after = await readRepository(app);
  assert.equal(after.commits.length, before.commits.length + 2);
  assert.deepEqual(
    after.commits.map((commit) => commit.message).slice(-2),
    ["Add docs/notes.md", longest],
  );
});

test("REQ-4-4 only Write, Maintain, Admin or organization Owner may submit file changes", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await readRepository(app);

  // A visitor is refused before anything is resolved.
  const visitor = await addFile(app.baseUrl, "");
  assert.equal(visitor.status, 401);

  // A signed-in account without a write role on the public repository browses
  // it but may not add a file.
  const browser = await signIn(app.baseUrl, BROWSER);
  const readOnly = await addFile(app.baseUrl, browser, { path: "pw-file-denied.md" });
  assert.equal(readOnly.status, 403);
  assert.equal(readOnly.body.error, "Access denied");

  // Neither attempt stored a file or moved the branch.
  const after = await readRepository(app);
  assert.equal(after.commits.length, before.commits.length);
  assert.equal(after.branch.headCommitId, before.branch.headCommitId);
  assert.equal(after.files.some((file) => file.path === "pw-file-denied.md"), false);

  // An unknown repository is not resolved into another one.
  const missing = await call(app.baseUrl, "/api/repositories/files", {
    method: "POST",
    cookie: browser,
    body: { ...REPOSITORY, name: "no-such-repository", path: "pw-file-2.md", content: "x", message: "Add" },
  });
  assert.equal(missing.status, 404);
});
