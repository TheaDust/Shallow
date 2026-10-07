import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";
import { diffContent, diffFileSnapshots } from "../src/lib/text-diff.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-code-"));
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

async function request(baseUrl, method, path) {
  const response = await fetch(`${baseUrl}${path}`, { method });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

test("a visitor browses the seeded directory and file of the public repository", async () => {
  const app = await startApp();
  try {
    const root = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/tree");
    assert.equal(root.status, 200);
    assert.equal(root.body.branch, "main");
    assert.deepEqual(
      root.body.entries.map((entry) => [entry.name, entry.type]),
      [["src", "directory"], ["README.md", "file"]],
    );

    const directory = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/tree?path=src");
    assert.equal(directory.status, 200);
    assert.equal(directory.body.path, "src");
    assert.deepEqual(
      directory.body.entries.map((entry) => [entry.name, entry.path, entry.type]),
      [
        ["index.js", "src/index.js", "file"],
        ["README.md", "src/README.md", "file"],
        ["search.ts", "src/search.ts", "file"],
      ],
    );

    const file = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/blob?path=src/README.md");
    assert.equal(file.status, 200);
    assert.equal(file.body.file.name, "README.md");
    assert.equal(file.body.file.path, "src/README.md");
    assert.equal(file.body.file.branch, "main");
    assert.equal(file.body.file.content, "Document search flow");

    // Browsing is read-only: the same content is served again.
    const again = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/blob?path=src/README.md");
    assert.equal(again.body.file.content, "Document search flow");
  } finally {
    await app.close();
  }
});

test("the commit history exposes the seeded message, author and parent", async () => {
  const app = await startApp();
  try {
    const history = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/commits");
    assert.equal(history.status, 200);
    assert.equal(history.body.branch, "main");
    assert.deepEqual(
      history.body.commits.map((commit) => commit.message),
      ["Document search flow", "Initial commit"],
    );
    const [latest] = history.body.commits;
    assert.equal(latest.authorName, "alice-dev");
    assert.equal(latest.parentCommitId, "commit-repo-acme-docs-1");
    assert.ok(!Number.isNaN(Date.parse(latest.createdAt)));
    assert.ok(Date.parse(latest.createdAt) > Date.parse(history.body.commits[1].createdAt));

    // A file-scoped history only lists the commits that changed that file.
    const scoped = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/commits?path=src/search.ts",
    );
    assert.equal(scoped.status, 200);
    assert.deepEqual(
      scoped.body.commits.map((commit) => commit.message),
      ["Document search flow", "Initial commit"],
    );
    const unrelated = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/commits?path=src/README.md",
    );
    assert.deepEqual(unrelated.body.commits.map((commit) => commit.message), ["Initial commit"]);
  } finally {
    await app.close();
  }
});

test("a commit detail compares the revision with its parent revision", async () => {
  const app = await startApp();
  try {
    const detail = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/commit/commit-repo-acme-docs-2",
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.branch, "main");
    assert.equal(detail.body.commit.message, "Document search flow");
    assert.equal(detail.body.commit.authorName, "alice-dev");
    assert.equal(detail.body.base.id, "commit-repo-acme-docs-1");
    assert.deepEqual(
      detail.body.changes.map((change) => [change.path, change.status]),
      [["src/search.ts", "modified"]],
    );
    const searchFile = detail.body.changes.find((change) => change.path === "src/search.ts");
    assert.ok(searchFile.additions > 0);
    assert.ok(searchFile.deletions > 0);
    assert.equal(
      detail.body.totals.additions,
      detail.body.changes.reduce((total, change) => total + change.additions, 0),
    );
    assert.equal(
      detail.body.totals.deletions,
      detail.body.changes.reduce((total, change) => total + change.deletions, 0),
    );
    assert.ok(searchFile.lines.some((line) => line.type === "added"));
    assert.ok(searchFile.lines.some((line) => line.type === "removed"));

    // The root commit has no parent revision, so its whole content is added.
    const root = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/commit/commit-repo-acme-docs-1",
    );
    assert.equal(root.status, 200);
    assert.equal(root.body.base, null);
    assert.deepEqual(
      root.body.changes.map((change) => change.path),
      ["README.md", "src/README.md", "src/index.js", "src/search.ts"],
    );
    assert.ok(root.body.changes.every((change) => change.status === "added"));

    const missing = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/commit/commit-does-not-exist",
    );
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test("code search matches readable content only and keeps the absent query empty", async () => {
  const app = await startApp();
  try {
    const match = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/code-search?q=search%20flow",
    );
    assert.equal(match.status, 200);
    assert.equal(match.body.query, "search flow");
    assert.equal(match.body.branch, "main");
    assert.deepEqual(match.body.matches.map((entry) => entry.path), ["src/README.md"]);
    assert.equal(match.body.matches[0].name, "README.md");
    assert.ok(match.body.matches[0].lines[0].text.includes("Document search flow"));

    // The file name carries the word "search" but its content does not.
    assert.deepEqual(
      (await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/code-search?q=search%20flow"))
        .body.matches.map((entry) => entry.path),
      ["src/README.md"],
    );

    const absent = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/code-search?q=no-such-token",
    );
    assert.equal(absent.status, 200);
    assert.deepEqual(absent.body.matches, []);
    assert.equal(absent.body.query, "no-such-token");
  } finally {
    await app.close();
  }
});

test("the line diff reports unchanged, removed and added lines", () => {
  const diff = diffContent("one\ntwo\nthree\n", "one\nthree\nfour\n");
  assert.deepEqual(diff.lines.map((line) => [line.type, line.text]), [
    ["context", "one"],
    ["removed", "two"],
    ["context", "three"],
    ["added", "four"],
  ]);
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 1);

  const snapshots = diffFileSnapshots(
    [
      { path: "keep.md", content: "same" },
      { path: "gone.md", content: "bye" },
      { path: "edit.md", content: "before" },
    ],
    [
      { path: "keep.md", content: "same" },
      { path: "edit.md", content: "after" },
      { path: "new.md", content: "hello" },
    ],
  );
  assert.deepEqual(
    snapshots.files.map((file) => [file.path, file.status]),
    [["edit.md", "modified"], ["gone.md", "removed"], ["new.md", "added"]],
  );
  assert.deepEqual(snapshots.totals, { files: 3, additions: 2, deletions: 2 });
  assert.deepEqual(diffFileSnapshots([], []).totals, { files: 0, additions: 0, deletions: 0 });
});
