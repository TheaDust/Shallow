import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

const ORG_REPOSITORY = "ownerKind=organization&owner=acme-demo&name=acme-docs";
const OUTSIDER = { username: "alice-dev", password: "Valid-password-123!" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-repository-code-"));
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

test("REQ-4-1 a visitor browses the directory hierarchy and the stored file", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  // The root of the Code page lists the seeded directory and the root file.
  const root = await call(app.baseUrl, `/api/repositories/tree?${ORG_REPOSITORY}&branch=main`);
  assert.equal(root.status, 200);
  assert.equal(root.body.directory.repository, "acme-docs");
  assert.deepEqual(root.body.directory.owner, { kind: "organization", name: "Acme Demo", slug: "acme-demo" });
  assert.equal(root.body.directory.branch, "main");
  assert.equal(root.body.directory.path, "");
  assert.deepEqual(
    root.body.directory.entries,
    [
      { kind: "directory", name: "src", path: "src" },
      { kind: "file", name: "README.md", path: "README.md" },
    ],
  );

  // Opening the directory identifies the current path and lists its files.
  const directory = await call(app.baseUrl, `/api/repositories/tree?${ORG_REPOSITORY}&branch=main&path=src`);
  assert.equal(directory.status, 200);
  assert.equal(directory.body.directory.path, "src");
  assert.deepEqual(
    directory.body.directory.entries.map((entry) => `${entry.kind}:${entry.name}`),
    ["file:README.md", "file:search.ts"],
  );

  // Opening the file returns the stored name, path, branch and readable content.
  const file = await call(
    app.baseUrl,
    `/api/repositories/files?${ORG_REPOSITORY}&branch=main&path=src%2FREADME.md`,
  );
  assert.equal(file.status, 200);
  assert.equal(file.body.file.name, "README.md");
  assert.equal(file.body.file.path, "src/README.md");
  assert.equal(file.body.file.branch, "main");
  assert.equal(file.body.file.content, "Document search flow");

  // Reading again (a reload) serves exactly the same stored content.
  const reloaded = await call(
    app.baseUrl,
    `/api/repositories/files?${ORG_REPOSITORY}&branch=main&path=src%2FREADME.md`,
  );
  assert.equal(reloaded.body.file.content, "Document search flow");

  // A file path is not a directory and an unknown file never resolves.
  const fileAsDirectory = await call(
    app.baseUrl,
    `/api/repositories/tree?${ORG_REPOSITORY}&branch=main&path=README.md`,
  );
  assert.equal(fileAsDirectory.status, 404);
  const missing = await call(
    app.baseUrl,
    `/api/repositories/files?${ORG_REPOSITORY}&branch=main&path=src%2Fmissing.md`,
  );
  assert.equal(missing.status, 404);

  // The seeded private repository stays unreadable for a visitor.
  const privateRoot = await call(
    app.baseUrl,
    "/api/repositories/tree?ownerKind=organization&owner=acme-demo&name=secret-research&branch=main",
  );
  assert.equal(privateRoot.status, 404);
});

test("REQ-4-2-1 the readable branch exposes its commit history without signing in", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const history = await call(app.baseUrl, `/api/repositories/commits?${ORG_REPOSITORY}&branch=main`);
  assert.equal(history.status, 200);
  assert.equal(history.body.history.repository, "acme-docs");
  assert.equal(history.body.history.branch, "main");
  const commits = history.body.history.commits;
  assert.equal(commits.length, 2);
  // Newest first, immutable records with identity, author, time and parent.
  assert.equal(commits[0].message, "Document search flow");
  assert.equal(commits[0].authorName, "alice-dev");
  assert.equal(commits[1].message, "Initial commit");
  assert.equal(commits[0].parentId, commits[1].id);
  assert.equal(commits[1].parentId, null);
  assert.ok(commits[0].id.length > 0);
  assert.ok(commits[0].changedFiles.includes("src/search.ts"));
  // The newest record is recent enough to read as a relative timestamp.
  assert.ok(Date.now() - Date.parse(commits[0].committedAt) < 24 * 3_600_000);
  assert.ok(Date.now() - Date.parse(commits[1].committedAt) > 30 * 24 * 3_600_000);

  // The history of one file path only lists the commits that changed it.
  const fileHistory = await call(
    app.baseUrl,
    `/api/repositories/commits?${ORG_REPOSITORY}&branch=main&path=src%2FREADME.md`,
  );
  assert.deepEqual(fileHistory.body.history.commits.map((commit) => commit.message), ["Initial commit"]);

  // An unknown branch never falls back to another revision.
  const unknownBranch = await call(app.baseUrl, `/api/repositories/commits?${ORG_REPOSITORY}&branch=nope`);
  assert.equal(unknownBranch.status, 404);

  const privateHistory = await call(
    app.baseUrl,
    "/api/repositories/commits?ownerKind=organization&owner=acme-demo&name=secret-research&branch=main",
  );
  assert.equal(privateHistory.status, 404);
});

test("REQ-4-2-2 a commit comparison shows changed files and numeric additions and deletions", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const history = await call(app.baseUrl, `/api/repositories/commits?${ORG_REPOSITORY}&branch=main`);
  const before = await app.store.read();
  const commitsBefore = before.commits.length;
  const filesBefore = before.repositoryFiles.length;
  const branchesBefore = before.branches.length;

  for (const record of history.body.history.commits) {
    const detail = await call(app.baseUrl, `/api/repositories/commit?${ORG_REPOSITORY}&id=${record.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.commit.message, record.message);
    assert.equal(detail.body.commit.repository, "acme-docs");
    assert.equal(detail.body.commit.branch, "main");
    assert.equal(detail.body.commit.owner.slug, "acme-demo");
    const changed = detail.body.commit.files.map((file) => file.path);
    assert.ok(changed.includes("src/search.ts"), `${record.message} exposes src/search.ts`);
    assert.equal(detail.body.commit.additions, detail.body.commit.files
      .reduce((total, file) => total + file.additions, 0));
    assert.equal(detail.body.commit.deletions, detail.body.commit.files
      .reduce((total, file) => total + file.deletions, 0));
    assert.ok(Number.isInteger(detail.body.commit.additions));
    assert.ok(Number.isInteger(detail.body.commit.deletions));
  }

  // The comparison is a line-by-line view of the parent revision and the
  // commit: the tip both adds and removes lines.
  const tip = await call(app.baseUrl, `/api/repositories/commit?${ORG_REPOSITORY}&id=${history.body.history.commits[0].id}`);
  const searchFile = tip.body.commit.files.find((file) => file.path === "src/search.ts");
  assert.ok(searchFile.additions > 0);
  assert.ok(searchFile.deletions > 0);
  assert.ok(searchFile.lines.some((line) => line.type === "add"));
  assert.ok(searchFile.lines.some((line) => line.type === "remove"));
  assert.ok(searchFile.lines.some((line) => line.type === "context"));

  // An unknown commit identifier is not found instead of reading another one.
  const missing = await call(app.baseUrl, `/api/repositories/commit?${ORG_REPOSITORY}&id=does-not-exist`);
  assert.equal(missing.status, 404);

  // The comparison never creates a review, comment, commit or branch change.
  const after = await app.store.read();
  assert.equal(after.commits.length, commitsBefore);
  assert.equal(after.repositoryFiles.length, filesBefore);
  assert.equal(after.branches.length, branchesBefore);
});

test("REQ-4-2-3 code search stays inside the readable repository content", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const found = await call(app.baseUrl, `/api/repositories/code-search?${ORG_REPOSITORY}&q=search%20flow`);
  assert.equal(found.status, 200);
  assert.equal(found.body.search.query, "search flow");
  assert.equal(found.body.search.repository, "acme-docs");
  // Exactly the seeded file with that text matches, so the results view offers
  // one entry whose name is the file name.
  assert.equal(found.body.search.total, 1);
  const readme = found.body.search.results[0];
  assert.equal(readme.name, "README.md");
  assert.equal(readme.path, "src/README.md");
  assert.ok(readme.lines.some((line) => line.text.includes("search flow")));

  // A query that does not occur in the readable code returns no result.
  const absent = await call(app.baseUrl, `/api/repositories/code-search?${ORG_REPOSITORY}&q=no-such-token`);
  assert.equal(absent.status, 200);
  assert.equal(absent.body.search.query, "no-such-token");
  assert.equal(absent.body.search.total, 0);
  assert.deepEqual(absent.body.search.results, []);

  // The root readme does not carry the searched phrase, so only one file is a
  // match and the results view never has to disambiguate two equal names.
  const root = await call(
    app.baseUrl,
    `/api/repositories/files?${ORG_REPOSITORY}&branch=main&path=README.md`,
  );
  assert.equal(root.body.file.content.toLowerCase().includes("search flow"), false);

  // Private repository content is never searchable by a visitor, and a signed-in
  // account without read permission is refused as well.
  const denied = await call(
    app.baseUrl,
    "/api/repositories/code-search?ownerKind=organization&owner=acme-demo&name=secret-research&q=Confidential",
  );
  assert.equal(denied.status, 404);
  const outsider = await signIn(app.baseUrl, OUTSIDER);
  const deniedSignedIn = await call(
    app.baseUrl,
    "/api/repositories/code-search?ownerKind=organization&owner=acme-demo&name=secret-research&q=Confidential",
    { cookie: outsider },
  );
  assert.equal(deniedSignedIn.status, 403);

  // Searching only reads: no commit, file or branch changes.
  const state = await app.store.read();
  const acmeDocs = state.repositories.find((entry) => entry.organizationId && entry.name === "acme-docs");
  assert.equal(state.commits.filter((commit) => commit.repositoryId === acmeDocs.id).length, 2);
  assert.equal(state.repositoryFiles.filter((file) => file.repositoryId === acmeDocs.id).length, 3);
  assert.equal(state.branches.filter((branch) => branch.repositoryId === acmeDocs.id).length, 1);
});

test("the seeded Code page content survives a restart", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const root = await call(app.baseUrl, `/api/repositories/tree?${ORG_REPOSITORY}&branch=main`);
  assert.deepEqual(root.body.directory.entries.map((entry) => entry.name), ["src", "README.md"]);

  const reopened = createStateStore({ dataDir: app.dataDir });
  const state = await reopened.read();
  const repository = state.repositories.find((entry) => entry.organizationId && entry.name === "acme-docs");
  assert.equal(state.commits.filter((commit) => commit.repositoryId === repository.id).length, 2);
  assert.deepEqual(
    state.repositoryFiles
      .filter((file) => file.repositoryId === repository.id)
      .map((file) => file.path)
      .sort(),
    ["README.md", "src/README.md", "src/search.ts"],
  );
  assert.equal(
    state.repositoryFiles.find((file) => file.path === "src/README.md").content,
    "Document search flow",
  );});
