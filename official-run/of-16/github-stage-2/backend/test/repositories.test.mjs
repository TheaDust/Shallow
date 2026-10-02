import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

const REPO_OWNER = { username: "repo-owner", email: "repo-owner@example.test", password: "Valid-password-123!" };
const FORK_USER = { username: "fork-user", email: "fork-user@example.test", password: "Valid-password-123!" };
const OUTSIDER = { username: "alice-dev", email: "alice.dev@example.test", password: "Valid-password-123!" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-repositories-"));
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

test("REQ-3-3 a visitor reads the seeded public repository overview", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const overview = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/acme-docs");
  assert.equal(overview.status, 200);
  const repository = overview.body.repository;
  assert.equal(repository.name, "acme-docs");
  assert.equal(repository.visibility, "public");
  assert.equal(repository.defaultBranch, "main");
  assert.deepEqual(repository.owner, { kind: "organization", name: "Acme Demo", slug: "acme-demo" });
  assert.equal(repository.organization.name, "Acme Demo");
  assert.deepEqual(repository.files.map((entry) => entry.path), ["src", "README.md"]);
  assert.equal(repository.files[0].kind, "directory");
  assert.equal(repository.latestCommit.message, "Document search flow");
  assert.equal(repository.latestCommit.authorName, "alice-dev");
  assert.equal(repository.commitCount, 2);
  assert.equal(repository.canManage, false);
  assert.equal(repository.forkSource, null);

  // The public directory lists every public repository, including the ones the
  // branch scenarios browse and the file-management repository.
  const directory = await call(app.baseUrl, "/api/explore/repositories");
  assert.equal(directory.status, 200);
  assert.deepEqual(directory.body.repositories.map((entry) => `${entry.owner.name}/${entry.name}`), [
    "Acme Demo/acme-docs",
    "Acme Demo/branch-switch-demo",
    "Acme Demo/default-branch-demo",
    "file-contributor/file-management-demo",
  ]);

  // The read-only file content is reachable without a session.
  const file = await call(
    app.baseUrl,
    "/api/repositories/files?ownerKind=organization&owner=acme-demo&name=acme-docs&branch=main&path=src%2FREADME.md",
  );
  assert.equal(file.status, 200);
  assert.equal(file.body.file.path, "src/README.md");
  assert.equal(file.body.file.branch, "main");
  assert.equal(file.body.file.content, "Document search flow");
  const rootFile = await call(
    app.baseUrl,
    "/api/repositories/files?ownerKind=organization&owner=acme-demo&name=acme-docs&branch=main&path=README.md",
  );
  assert.equal(rootFile.status, 200);
  assert.equal(rootFile.body.file.content.includes("Document search flow"), false);

  const privateFile = await call(
    app.baseUrl,
    "/api/repositories/files?ownerKind=organization&owner=acme-demo&name=secret-research&branch=main&path=README.md",
  );
  assert.equal(privateFile.status, 404);
});

test("REQ-3-3 a private personal repository is readable only by its owner", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const anonymous = await call(app.baseUrl, "/api/users/repo-owner/repositories/acme-docs");
  assert.equal(anonymous.status, 404);

  const outsider = await signIn(app.baseUrl, OUTSIDER);
  const denied = await call(app.baseUrl, "/api/users/repo-owner/repositories/acme-docs", { cookie: outsider });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Access denied");

  const owner = await signIn(app.baseUrl, REPO_OWNER);
  const own = await call(app.baseUrl, "/api/users/repo-owner/repositories/acme-docs", { cookie: owner });
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.repository.owner, { kind: "account", name: "repo-owner", slug: "repo-owner" });
  assert.equal(own.body.repository.visibility, "private");
  assert.deepEqual(own.body.repository.files.map((entry) => entry.path), ["README.md"]);

  // The personal namespace keeps its own `acme-docs` next to the organization one.
  const list = await call(app.baseUrl, "/api/users/repo-owner/repositories", { cookie: owner });
  assert.deepEqual(list.body.repositories.map((entry) => entry.name), ["acme-docs"]);

  const missing = await call(app.baseUrl, "/api/users/does-not-exist/repositories", { cookie: owner });
  assert.equal(missing.status, 404);
});

test("REQ-3-2-1 a repository is created with owner, visibility and initialization options", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, REPO_OWNER);
  const created = await call(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie: session,
    body: {
      ownerKind: "account",
      owner: "repo-owner",
      name: "release-toolkit",
      description: "Repository created by Playwright",
      visibility: "private",
      initializeWithReadme: true,
    },
  });
  assert.equal(created.status, 201);
  const repository = created.body.repository;
  assert.equal(repository.name, "release-toolkit");
  assert.equal(repository.description, "Repository created by Playwright");
  assert.equal(repository.visibility, "private");
  assert.equal(repository.defaultBranch, "main");
  assert.deepEqual(repository.owner, { kind: "account", name: "repo-owner", slug: "repo-owner" });
  assert.deepEqual(repository.files.map((entry) => entry.path), ["README.md"]);
  assert.equal(repository.latestCommit.message, "Initial commit");
  assert.equal(repository.commitCount, 1);

  // The repository appears in the owner's repository list and survives a reopen.
  const list = await call(app.baseUrl, "/api/users/repo-owner/repositories", { cookie: session });
  assert.deepEqual(
    list.body.repositories.map((entry) => entry.name).sort(),
    ["acme-docs", "release-toolkit"],
  );

  const reopened = createStateStore({ dataDir: app.dataDir });
  const state = await reopened.read();
  const stored = state.repositories.find((entry) => entry.name === "release-toolkit");
  assert.ok(stored);
  assert.equal(stored.visibility, "private");
  assert.equal(stored.defaultBranch, "main");
  assert.equal(state.branches.filter((branch) => branch.repositoryId === stored.id).length, 1);
  assert.equal(state.repositoryFiles.filter((file) => file.repositoryId === stored.id).length, 1);
  assert.equal(state.commits.filter((commit) => commit.repositoryId === stored.id).length, 1);

  // Without initialization there is no branch, file or commit.
  const plain = await call(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie: session,
    body: { ownerKind: "account", owner: "repo-owner", name: "empty-shell", visibility: "public" },
  });
  assert.equal(plain.status, 201);
  assert.deepEqual(plain.body.repository.files, []);
  assert.equal(plain.body.repository.latestCommit, null);
  assert.equal(plain.body.repository.commitCount, 0);
});

test("REQ-3-2-1 rejected creations report a reason and leave no partial repository", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const anonymous = await call(app.baseUrl, "/api/repositories", {
    method: "POST",
    body: { ownerKind: "account", owner: "repo-owner", name: "anonymous-repo" },
  });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "Sign in required");

  const session = await signIn(app.baseUrl, REPO_OWNER);

  const empty = await call(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie: session,
    body: { ownerKind: "account", owner: "repo-owner", name: "   ", visibility: "private" },
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.errors.name, "Repository name is required");

  const duplicate = await call(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie: session,
    body: { ownerKind: "account", owner: "repo-owner", name: "acme-docs", visibility: "private" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.errors.name, "Repository name already exists");

  // An organization namespace the account does not own is refused.
  const foreign = await call(app.baseUrl, "/api/repositories", {
    method: "POST",
    cookie: session,
    body: { ownerKind: "organization", owner: "acme-demo", name: "release-toolkit" },
  });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.errors.owner, "You cannot create repositories in this namespace");

  const reopened = createStateStore({ dataDir: app.dataDir });
  const state = await reopened.read();
  assert.deepEqual(
    state.repositories.filter((entry) => entry.ownerAccountId === storedOwnerId(state)).map((entry) => entry.name),
    ["acme-docs"],
  );
});

function storedOwnerId(state) {
  return state.accounts.find((account) => account.username === "repo-owner").id;
}

test("REQ-3-2-2 a fork copies the default branch, records its source and stays independent", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, FORK_USER);
  const forked = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/acme-docs/fork", {
    method: "POST",
    cookie: session,
    body: { ownerKind: "account", owner: "fork-user", name: "acme-docs-copy", visibility: "public" },
  });
  assert.equal(forked.status, 201);
  const fork = forked.body.repository;
  assert.equal(fork.name, "acme-docs-copy");
  assert.equal(fork.visibility, "public");
  assert.deepEqual(fork.owner, { kind: "account", name: "fork-user", slug: "fork-user" });
  assert.deepEqual(fork.forkSource, {
    owner: { kind: "organization", name: "Acme Demo", slug: "acme-demo" },
    name: "acme-docs",
  });
  assert.deepEqual(fork.files.map((entry) => entry.path), ["src", "README.md"]);
  assert.equal(fork.latestCommit.message, "Document search flow");
  assert.equal(fork.commitCount, 2);

  const copiedFile = await call(
    app.baseUrl,
    "/api/repositories/files?ownerKind=account&owner=fork-user&name=acme-docs-copy&branch=main&path=src%2FREADME.md",
  );
  assert.equal(copiedFile.status, 200);
  assert.equal(copiedFile.body.file.content, "Document search flow");

  // The fork holds its own objects: nothing of the source changed.
  const state = await app.store.read();
  const source = state.repositories.find((entry) => (
    entry.organizationId && entry.name === "acme-docs"
  ));
  const copied = state.repositories.find((entry) => entry.name === "acme-docs-copy");
  assert.notEqual(source.id, copied.id);
  assert.equal(copied.forkedFromRepositoryId, source.id);
  assert.equal(state.commits.filter((commit) => commit.repositoryId === source.id).length, 2);
  assert.notEqual(
    state.commits.find((commit) => commit.repositoryId === copied.id).id,
    state.commits.find((commit) => commit.repositoryId === source.id).id,
  );

  // The fork is listed for its owner and survives a reopen.
  const list = await call(app.baseUrl, "/api/users/fork-user/repositories", { cookie: session });
  assert.deepEqual(
    list.body.repositories.map((entry) => entry.name).sort(),
    ["acme-docs-copy", "acme-docs-fork"],
  );
  const reopened = createStateStore({ dataDir: app.dataDir });
  const stored = await reopened.read();
  assert.ok(stored.repositories.some((entry) => entry.name === "acme-docs-copy"));
});

test("REQ-3-2-2 a conflicting fork name or an unreadable source creates nothing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const outsider = await signIn(app.baseUrl, OUTSIDER);
  const denied = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/secret-research/fork", {
    method: "POST",
    cookie: outsider,
    body: { ownerKind: "account", owner: "alice-dev", name: "secret-research-fork", visibility: "private" },
  });
  assert.equal(denied.status, 403);

  const session = await signIn(app.baseUrl, FORK_USER);
  const conflict = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/acme-docs/fork", {
    method: "POST",
    cookie: session,
    body: { ownerKind: "account", owner: "fork-user", name: "acme-docs-fork", visibility: "private" },
  });
  assert.equal(conflict.status, 400);
  assert.equal(conflict.body.errors.name, "Repository name already exists");

  const foreign = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/acme-docs/fork", {
    method: "POST",
    cookie: session,
    body: { ownerKind: "organization", owner: "acme-demo", name: "acme-docs-org-fork" },
  });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.errors.owner, "You cannot create repositories in this namespace");

  const reopened = createStateStore({ dataDir: app.dataDir });
  const state = await reopened.read();
  const names = state.repositories.map((entry) => entry.name);
  assert.equal(names.includes("secret-research-fork"), false);
  assert.equal(names.includes("acme-docs-org-fork"), false);
  assert.equal(names.filter((name) => name === "acme-docs-fork").length, 1);
});

test("REQ-3-2-2 a private source always produces a private fork", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const owner = await signIn(app.baseUrl, REPO_OWNER);
  const forked = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/secret-research/fork", {
    method: "POST",
    cookie: owner,
    body: {
      ownerKind: "account",
      owner: "repo-owner",
      name: "secret-research-mirror",
      visibility: "public",
    },
  });
  // repo-owner cannot read the organization's private repository at all.
  assert.equal(forked.status, 403);

  const orgOwner = await signIn(app.baseUrl, {
    username: "org-owner",
    password: "Valid-password-123!",
  });
  const privateFork = await call(app.baseUrl, "/api/organizations/acme-demo/repositories/secret-research/fork", {
    method: "POST",
    cookie: orgOwner,
    body: {
      ownerKind: "account",
      owner: "org-owner",
      name: "secret-research-mirror",
      visibility: "public",
    },
  });
  assert.equal(privateFork.status, 201);
  assert.equal(privateFork.body.repository.visibility, "private");
  assert.deepEqual(privateFork.body.repository.forkSource, {
    owner: { kind: "organization", name: "Acme Demo", slug: "acme-demo" },
    name: "secret-research",
  });
});
