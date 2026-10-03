import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startServer(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallow-code-")));
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

async function readmeEntry(baseUrl, query = "") {
  const detail = await request(baseUrl, "GET", `/api/repositories/acme-demo/acme-docs${query}`);
  assert.equal(detail.status, 200);
  return detail.payload;
}

test("a visitor browses the branch and files of a public repository", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const detail = await readmeEntry(app.baseUrl);
  assert.equal(detail.repository.name, "acme-docs");
  assert.equal(detail.repository.visibility, "public");
  assert.equal(detail.branch, "main");
  assert.deepEqual(detail.branches, [{ name: "main" }]);
  assert.deepEqual(
    detail.files.map((file) => file.path),
    ["README.md", "src/README.md", "src/search.ts"],
  );
  const srcReadme = detail.files.find((file) => file.path === "src/README.md");
  assert.equal(srcReadme.content, "Document search flow\n");
  assert.ok(detail.files.find((file) => file.path === "README.md").content.includes("Document search flow"));

  // The organization-scoped detail stays the same view of the same branch.
  const organizationDetail = await request(
    app.baseUrl,
    "GET",
    "/api/organizations/acme-demo/repositories/acme-docs",
  );
  assert.equal(organizationDetail.status, 200);
  assert.equal(organizationDetail.payload.branch, "main");
  assert.deepEqual(
    organizationDetail.payload.files.map((file) => file.path),
    ["README.md", "src/README.md", "src/search.ts"],
  );

  // An unknown branch falls back to the repository's default branch rather than
  // inventing a branch.
  const unknownBranch = await readmeEntry(app.baseUrl, "?branch=no-such-branch");
  assert.equal(unknownBranch.branch, "main");
  assert.equal(unknownBranch.files.length, 3);
});

test("the commit history is newest first and names its author", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const history = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/commits");
  assert.equal(history.status, 200);
  assert.equal(history.payload.branch, "main");
  assert.deepEqual(
    history.payload.commits.map((commit) => commit.message),
    ["Document search flow", "Document installation", "Initial commit"],
  );
  const newest = history.payload.commits[0];
  assert.equal(newest.author, "alice-dev");
  assert.equal(newest.parentId, "commit-acme-docs-2");
  assert.ok(newest.createdAt);
  assert.ok(newest.changedFiles.includes("src/search.ts"));

  // The history of one file keeps only the commits that changed it.
  const fileHistory = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/acme-demo/acme-docs/commits?path=src/search.ts",
  );
  assert.deepEqual(
    fileHistory.payload.commits.map((commit) => commit.message),
    ["Document search flow"],
  );

  // A restart of the same data directory reads the same history.
  const restarted = await startServer(app.dataDir);
  t.after(() => restarted.close());
  const persisted = await request(restarted.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/commits");
  assert.deepEqual(
    persisted.payload.commits.map((commit) => commit.message),
    ["Document search flow", "Document installation", "Initial commit"],
  );
});

test("a commit detail compares the change with its parent revision", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const detail = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/commit/commit-acme-docs-3");
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.commit.message, "Document search flow");
  assert.equal(detail.payload.commit.author, "alice-dev");
  assert.equal(detail.payload.commit.parentId, "commit-acme-docs-2");
  assert.deepEqual(
    detail.payload.files.map((file) => file.path),
    ["README.md", "src/README.md", "src/search.ts"],
  );
  const changedFile = detail.payload.files.find((file) => file.path === "src/search.ts");
  assert.ok(changedFile.additions > 0);
  assert.equal(changedFile.deletions, 0);
  assert.ok(changedFile.lines.some((line) => line.type === "addition"));
  const readme = detail.payload.files.find((file) => file.path === "README.md");
  assert.ok(readme.additions > 0);
  assert.ok(readme.deletions > 0);
  assert.equal(detail.payload.totals.files, 3);
  assert.ok(detail.payload.totals.additions > 0);
  assert.ok(detail.payload.totals.deletions > 1);
  assert.equal(
    detail.payload.totals.additions,
    detail.payload.files.reduce((total, file) => total + file.additions, 0),
  );
  assert.equal(
    detail.payload.totals.deletions,
    detail.payload.files.reduce((total, file) => total + file.deletions, 0),
  );

  const missing = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/commit/no-such-commit");
  assert.equal(missing.status, 404);
});

test("code search matches readable file content inside the browsed directory", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const match = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/code-search?q=search+flow");
  assert.equal(match.status, 200);
  assert.equal(match.payload.query, "search flow");
  assert.equal(match.payload.path, null);
  assert.deepEqual(
    match.payload.results.map((result) => result.path),
    ["README.md"],
  );
  assert.ok(match.payload.results[0].lines.some((line) => line.includes("search flow")));

  // Inside a directory the same query reads that directory's files only.
  const insideSrc = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/acme-demo/acme-docs/code-search?q=search+flow&path=src",
  );
  assert.equal(insideSrc.payload.path, "src");
  assert.deepEqual(
    insideSrc.payload.results.map((result) => result.path),
    ["src/README.md"],
  );

  const absent = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/acme-demo/acme-docs/code-search?q=no-such-token",
  );
  assert.deepEqual(absent.payload.results, []);
  assert.equal(absent.payload.query, "no-such-token");

  // An empty query searches nothing and the private repository is never
  // searchable by a visitor.
  assert.deepEqual(
    (await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/code-search?q=")).payload.results,
    [],
  );
  const privateSearch = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/acme-demo/secret-research/code-search?q=Confidential",
  );
  assert.equal(privateSearch.status, 403);
  assert.equal(privateSearch.payload.error, "Access denied");

  // Reading commits and searching never changes files, history or the branch.
  const before = await readmeEntry(app.baseUrl);
  const after = await readmeEntry(app.baseUrl);
  assert.deepEqual(after.files, before.files);
  assert.deepEqual(after.commits, before.commits);
  assert.equal(after.branch, "main");
});

test("a signed-in reader of a private repository can browse its code", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const visitor = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research");
  assert.equal(visitor.status, 403);

  const cookie = await signIn(app.baseUrl, "org-owner");
  const detail = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research", {
    cookies: cookie,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.branch, "main");
  assert.deepEqual(
    detail.payload.files.map((file) => file.path),
    ["README.md"],
  );
  const history = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research/commits", {
    cookies: cookie,
  });
  assert.equal(history.status, 200);
  assert.equal(history.payload.commits[0].message, "Initial commit");
  const search = await request(
    app.baseUrl,
    "GET",
    "/api/repositories/acme-demo/secret-research/code-search?q=confidential",
    { cookies: cookie },
  );
  assert.deepEqual(
    search.payload.results.map((result) => result.path),
    ["README.md"],
  );});

test("code browsing of a missing repository answers 404 without failing the server", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const missing = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/no-such-repo");
  assert.equal(missing.status, 404);
  const missingCommits = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/no-such-repo/commits");
  assert.equal(missingCommits.status, 404);
  const missingSearch = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/no-such-repo/code-search?q=a");
  assert.equal(missingSearch.status, 404);
  assert.equal((await request(app.baseUrl, "GET", "/health")).status, 200);
});
