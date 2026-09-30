import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(dataDir) {
  const handler = createApp({ dataDir, staticRoot: join(dataDir, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function newDataDir() {
  return mkdtemp(join(tmpdir(), "shallowcode-repository-code-"));
}

function jsonRequest(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(baseUrl, identifier) {
  const response = await jsonRequest(baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier, password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

const DOCS_PATH = "docs/README.md";

test("a directory page lists only the entries directly inside that directory", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const root = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs");
  assert.equal(root.status, 200);
  const rootView = (await root.json()).repository;
  assert.equal(rootView.branch, "main");
  assert.equal(rootView.path, "");
  assert.deepEqual(
    rootView.entries.map((entry) => [entry.type, entry.name, entry.path]),
    [
      ["dir", "docs", "docs"],
      ["dir", "src", "src"],
      ["file", "README.md", "README.md"],
    ],
  );
  assert.deepEqual(
    rootView.branches.map((branch) => branch.name),
    ["main", "feature-search", "release", "draft-feature"],
  );

  const directory = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs?branch=main&path=docs",
  );
  assert.equal(directory.status, 200);
  const directoryView = (await directory.json()).repository;
  assert.equal(directoryView.path, "docs");
  assert.deepEqual(
    directoryView.entries.map((entry) => [entry.type, entry.name, entry.path]),
    [["file", "README.md", DOCS_PATH]],
  );

  // The branch snapshot of the other branch adds the file `main-only.md` that
  // `main` does not have while the rest of the snapshot is the same.
  const featureBranch = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs?branch=feature-search",
  );
  assert.equal(featureBranch.status, 200);
  assert.deepEqual(
    (await featureBranch.json()).repository.entries.map((entry) => [entry.type, entry.name]),
    [
      ["dir", "docs"],
      ["dir", "src"],
      ["file", "main-only.md"],
      ["file", "README.md"],
    ],
  );

  for (const path of [
    "/api/repositories/alice-dev/acme-docs?branch=main&path=main-only.md",
    "/api/repositories/alice-dev/acme-docs?branch=missing-branch",
  ]) {
    const refused = await jsonRequest(app.baseUrl, path);
    assert.equal(refused.status, 404);
  }
});

test("a file page reads the stored content and its file-scoped commit", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const response = await jsonRequest(
    app.baseUrl,
    `/api/repositories/alice-dev/acme-docs/file?branch=main&path=${encodeURIComponent(DOCS_PATH)}`,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.file.path, DOCS_PATH);
  assert.equal(payload.file.name, "README.md");
  assert.equal(payload.file.branch, "main");
  assert.match(payload.file.content, /Getting started/);
  assert.equal(payload.file.commit.message, "Document search flow");
  assert.equal(payload.file.commit.author, "alice-dev");

  // The branch that does not contain the file keeps the repository context so
  // the page can show the file as absent on that branch: `main-only.md` lives on
  // `feature-search` only, so `main` answers 404 with its context.
  const absent = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/file?branch=main&path=main-only.md",
  );
  assert.equal(absent.status, 404);
  const absentBody = await absent.json();
  assert.equal(absentBody.repository.branch, "main");
  assert.equal(absentBody.file, undefined);

  // Reading a file creates no commit and leaves both branches where they were.
  const after = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs");
  const afterView = (await after.json()).repository;
  assert.deepEqual(
    afterView.commits.map((commit) => commit.message),
    ["Add search loader", "Document search flow", "Initial commit"],
  );
});

test("commit history is newest first and scoped by file or branch", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const branchHistory = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/commits?branch=main",
  );
  assert.equal(branchHistory.status, 200);
  const history = await branchHistory.json();
  assert.equal(history.path, "");
  assert.deepEqual(
    history.commits.map((commit) => commit.message),
    ["Add search loader", "Document search flow", "Initial commit"],
  );
  assert.deepEqual(history.files, [
    "README.md",
    "docs/README.md",
    "src/loader.ts",
    "src/search.ts",
  ]);
  const [latest] = history.commits;
  assert.equal(latest.author, "alice-dev");
  assert.ok(latest.id.startsWith(latest.shortId));
  assert.equal(latest.shortId.length, 7);
  assert.equal(latest.parentShortId.length, 7);
  assert.notEqual(latest.shortId, latest.parentShortId);
  assert.deepEqual(latest.changedFiles, ["src/loader.ts", "src/search.ts"]);

  const known = history.commits.find((commit) => commit.message === "Document search flow");
  assert.equal(known.author, "alice-dev");
  assert.equal(known.createdAt, "2024-02-12T09:30:00.000Z");
  assert.deepEqual(known.changedFiles, ["README.md", "docs/README.md", "src/search.ts"]);

  // A file scope keeps only the commits that changed that file: the newest
  // commit of the branch touched only `src/`, so it is left out of the README
  // history, while both commits that wrote `src/search.ts` stay in its own.
  const fileHistory = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/commits?branch=main&path=README.md",
  );
  const scoped = await fileHistory.json();
  assert.equal(scoped.path, "README.md");
  assert.deepEqual(
    scoped.commits.map((commit) => commit.message),
    ["Document search flow", "Initial commit"],
  );

  const sourceHistory = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/commits?branch=main&path=src/search.ts",
  );
  assert.deepEqual(
    (await sourceHistory.json()).commits.map((commit) => commit.message),
    ["Add search loader", "Document search flow"],
  );

  const untouched = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/commits?branch=main&path=docs/README.md",
  );
  assert.deepEqual(
    (await untouched.json()).commits.map((commit) => commit.message),
    ["Document search flow"],
  );

  const featureHistory = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/commits?branch=feature-search",
  );
  assert.deepEqual(
    (await featureHistory.json()).commits.map((commit) => commit.message),
    ["Add main-only notes", "Add search loader", "Document search flow", "Initial commit"],
  );
});

test("a commit entry exposes its parent, changed files and line diff", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const history = await fetchJson(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/commits?branch=main",
  );
  const known = history.commits.find((commit) => commit.message === "Document search flow");

  const detail = await jsonRequest(
    app.baseUrl,
    `/api/repositories/alice-dev/acme-docs/commits/${known.shortId}`,
  );
  assert.equal(detail.status, 200);
  const payload = await detail.json();
  assert.equal(payload.commit.message, "Document search flow");
  assert.equal(payload.commit.parent.shortId, known.parentShortId);
  assert.equal(payload.commit.base.shortId, known.parentShortId);
  assert.equal(payload.commit.compare.shortId, known.shortId);
  assert.deepEqual(
    payload.commit.changedFiles.map((file) => [file.path, file.changeType]),
    [
      ["README.md", "modified"],
      ["docs/README.md", "added"],
      ["src/search.ts", "added"],
    ],
  );
  const searchTs = payload.commit.changedFiles.find((file) => file.path === "src/search.ts");
  assert.equal(searchTs.deletions, 0);
  assert.ok(searchTs.additions > 0);
  assert.ok(searchTs.diff.every((row) => row.kind === "add"));

  const readme = payload.commit.changedFiles.find((file) => file.path === "README.md");
  assert.ok(readme.diff.some((row) => row.kind === "context"));
  assert.ok(readme.diff.some((row) => row.kind === "add" && /search flow/i.test(row.text)));

  // A single changed file can be addressed on its own.
  const single = await jsonRequest(
    app.baseUrl,
    `/api/repositories/alice-dev/acme-docs/commits/${known.shortId}?path=src/search.ts`,
  );
  const singleBody = await single.json();
  assert.deepEqual(
    singleBody.commit.changedFiles.map((file) => file.path),
    ["src/search.ts"],
  );
  // The scoped diff reports that file's own numbers, not the whole commit.
  assert.equal(singleBody.commit.filesChanged, 1);
  assert.equal(singleBody.commit.additions, searchTs.additions);
  assert.equal(singleBody.commit.deletions, 0);

  // The newest commit of the branch changed `src/` only, so the unchanged
  // `README.md` never appears in its changed-file list while the added and the
  // modified file both do.
  const newest = await jsonRequest(
    app.baseUrl,
    `/api/repositories/alice-dev/acme-docs/commits/${history.commits[0].shortId}`,
  );
  const newestBody = await newest.json();
  assert.deepEqual(
    newestBody.commit.changedFiles.map((file) => [file.path, file.changeType]),
    [
      ["src/loader.ts", "added"],
      ["src/search.ts", "modified"],
    ],
  );

  const unknown = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/commits/doesnotexist",
  );
  assert.equal(unknown.status, 404);
});

test("comparing two revisions lists base, compare and changed files", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const history = await fetchJson(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/commits?branch=main",
  );
  const known = history.commits.find((commit) => commit.message === "Document search flow");
  const parent = history.commits.find((commit) => commit.message === "Initial commit");

  const comparison = await jsonRequest(
    app.baseUrl,
    `/api/repositories/alice-dev/acme-docs/compare?base=${parent.id}&compare=${known.id}`,
  );
  assert.equal(comparison.status, 200);
  const body = await comparison.json();
  assert.equal(body.base.id, parent.id);
  assert.equal(body.compare.id, known.id);
  assert.equal(body.filesChanged, 3);
  assert.ok(body.additions > 0);
  assert.equal(body.deletions, 0);
  assert.deepEqual(
    body.changedFiles.map((file) => file.path),
    ["README.md", "docs/README.md", "src/search.ts"],
  );

  // The commit against its own parent equals the commit entry's own diff.
  const newest = history.commits[0];
  const newestComparison = await jsonRequest(
    app.baseUrl,
    `/api/repositories/alice-dev/acme-docs/compare?base=${newest.parentId}&compare=${newest.id}`,
  );
  const newestBody = await newestComparison.json();
  assert.deepEqual(
    newestBody.changedFiles.map((file) => file.path),
    ["src/loader.ts", "src/search.ts"],
  );
  assert.ok(!newestBody.changedFiles.some((file) => file.path === "README.md"));

  // A branch reference and a commit reference name the same revisions.
  const byBranch = await jsonRequest(
    app.baseUrl,
    `/api/repositories/alice-dev/acme-docs/compare?base=feature-search&compare=main`,
  );
  assert.equal(byBranch.status, 200);
  const branchBody = await byBranch.json();
  assert.equal(branchBody.compare.ref, "main");
  assert.equal(branchBody.base.ref, "feature-search");
  assert.deepEqual(
    branchBody.changedFiles.map((file) => [file.path, file.changeType]),
    [
      ["main-only.md", "deleted"],
      ["src/search.ts", "modified"],
    ],
  );

  // Comparing a revision with itself changes nothing.
  const identical = await jsonRequest(
    app.baseUrl,
    `/api/repositories/alice-dev/acme-docs/compare?base=main&compare=main`,
  );
  assert.deepEqual((await identical.json()).changedFiles, []);

  const unknown = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/compare?base=main&compare=nope",
  );
  assert.equal(unknown.status, 404);
});

test("code search reads only the readable content of the current repository", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const visitor = await jsonRequest(
    app.baseUrl,
    "/api/search?q=search%20flow&type=code&repo=alice-dev%2Facme-docs",
  );
  assert.equal(visitor.status, 200);
  const visitorBody = await visitor.json();
  assert.equal(visitorBody.type, "code");
  assert.equal(visitorBody.repository.fullName, "alice-dev/acme-docs");
  assert.equal(visitorBody.repository.branch, "main");
  assert.deepEqual(
    visitorBody.results.map((result) => result.path),
    ["README.md", "src/search.ts"],
  );
  assert.equal(visitorBody.results[0].name, "README.md");
  assert.match(visitorBody.results[0].snippet, /search flow/i);
  assert.ok(visitorBody.results[0].line > 0);
  // No content of another repository, public or private, appears.
  assert.ok(!JSON.stringify(visitorBody).includes("secret-research"));

  const srcScoped = await jsonRequest(
    app.baseUrl,
    "/api/search?q=search%20flow&type=code&repo=alice-dev%2Facme-docs&path=src%2F",
  );
  assert.equal(srcScoped.status, 200);
  const srcBody = await srcScoped.json();
  assert.deepEqual(
    srcBody.results.map((result) => result.path),
    ["src/search.ts"],
  );
  assert.equal(srcBody.results[0].repository.fullName, "alice-dev/acme-docs");

  // Without a named repository the search stays inside the repositories the
  // viewer may read, and the private one stays invisible to a visitor.
  const unscoped = await jsonRequest(app.baseUrl, "/api/search?q=search%20flow&type=code");
  assert.equal(unscoped.status, 200);
  const unscopedBody = await unscoped.json();
  assert.equal(unscopedBody.repository, null);
  assert.deepEqual(
    unscopedBody.results.map((result) => result.repository.fullName).filter(Boolean),
    ["alice-dev/acme-docs", "alice-dev/acme-docs"],
  );

  // The private repository is searchable for its owner only.
  const privateAsVisitor = await jsonRequest(
    app.baseUrl,
    "/api/search?q=search%20flow&type=code&repo=alice-dev%2Fsecret-research",
  );
  const privateVisitorBody = await privateAsVisitor.json();
  assert.equal(privateVisitorBody.repository, null);
  assert.deepEqual(privateVisitorBody.results, []);

  const alice = await signIn(app.baseUrl, "alice-dev");
  const privateAsOwner = await jsonRequest(
    app.baseUrl,
    "/api/search?q=search%20flow&type=code&repo=alice-dev%2Fsecret-research",
    { cookie: alice },
  );
  const ownerBody = await privateAsOwner.json();
  assert.deepEqual(
    ownerBody.results.map((result) => result.path),
    ["notes/search-flow.md"],
  );

  // An absent term returns nothing and the search writes nothing.
  const absent = await jsonRequest(
    app.baseUrl,
    "/api/search?q=no-such-token&type=code&repo=alice-dev%2Facme-docs",
  );
  assert.deepEqual((await absent.json()).results, []);

  const overview = await fetchJson(app.baseUrl, "/api/repositories/alice-dev/acme-docs");
  assert.deepEqual(
    overview.repository.commits.map((commit) => commit.message),
    ["Add search loader", "Document search flow", "Initial commit"],
  );
});

test("commit, comparison and search views follow repository visibility", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const privateRepository = "alice-dev/secret-research";
  // A visitor learns nothing: the commit and comparison views answer like any
  // other unknown address, and the code search returns no scope and no result.
  for (const path of [
    `/api/repositories/${privateRepository}/commits?branch=main`,
    `/api/repositories/${privateRepository}/compare?base=main&compare=main`,
  ]) {
    const response = await jsonRequest(app.baseUrl, path);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "Not found");
  }
  const visitorSearch = await jsonRequest(
    app.baseUrl,
    "/api/search?q=search&type=code&repo=alice-dev%2Fsecret-research",
  );
  assert.equal(visitorSearch.status, 200);
  const visitorSearchBody = await visitorSearch.json();
  assert.equal(visitorSearchBody.repository, null);
  assert.deepEqual(visitorSearchBody.results, []);

  // A signed-in viewer who may not read the repository is refused explicitly,
  // and the file content of the other revision is never returned.
  const outsider = await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "outsider-reader",
      email: "outsider-reader@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(outsider.status, 201);
  const cookie = await signIn(app.baseUrl, "outsider-reader");
  const denied = await jsonRequest(
    app.baseUrl,
    `/api/repositories/${privateRepository}/commits?branch=main`,
    { cookie },
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "Access denied");

  // A viewer holding a grant on the repository reads the same views.
  const collaborator = await signIn(app.baseUrl, "bob-reviewer");
  const readable = await jsonRequest(
    app.baseUrl,
    `/api/repositories/${privateRepository}/commits?branch=main&path=notes/search-flow.md`,
    { cookie: collaborator },
  );
  assert.equal(readable.status, 200);
  const readableBody = await readable.json();
  assert.deepEqual(
    readableBody.commits.map((commit) => commit.message),
    ["Draft the search flow findings"],
  );
  const readableFile = await jsonRequest(
    app.baseUrl,
    `/api/repositories/${privateRepository}/file?branch=main&path=README.md`,
    { cookie: collaborator },
  );
  assert.equal(readableFile.status, 200);
  assert.match((await readableFile.json()).file.content, /secret-research/);
});

async function fetchJson(baseUrl, path) {
  const response = await jsonRequest(baseUrl, path);
  assert.equal(response.status, 200);
  return response.json();
}
