import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp() {
  return startAppOn(await mkdtemp(join(tmpdir(), "shallowcode-code-")));
}

/** Starts the application on an existing data directory (a restart). */
async function startAppOn(dataDir) {
  const app = await createApp({ dataDir });
  const server = createServer((request, response) => {
    void app.handle(request, response);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    dataDir,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((done) => server.close(done));
    },
  };
}

async function call(base, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
    sessionCookie: (response.headers.getSetCookie?.() ?? [])
      .map((entry) => entry.split(";")[0])
      .join("; "),
  };
}

async function signIn(base, identifier) {
  return call(base, "/api/session", { method: "POST", body: { identifier, password: "Valid-password-123!" } });
}

/** The readable code views of the seeded public repository, without signing in. */
test("an anonymous visitor browses the seeded tree, file and branch snapshot", async () => {
  const app = await startApp();
  try {
    const root = await call(app.base, "/api/repositories/acme-demo/acme-docs/tree");
    assert.equal(root.status, 200);
    assert.equal(root.body.branch, "main");
    assert.equal(root.body.path, "");
    assert.deepEqual(root.body.entries, [{ name: "src", path: "src", type: "directory" }]);

    const directory = await call(app.base, "/api/repositories/acme-demo/acme-docs/tree/main/src");
    assert.equal(directory.status, 200);
    assert.equal(directory.body.path, "src");
    assert.deepEqual(
      directory.body.entries.map((entry) => [entry.name, entry.type]),
      [["README.md", "file"], ["search.ts", "file"]],
    );

    const file = await call(app.base, "/api/repositories/acme-demo/acme-docs/blob/main/src/README.md");
    assert.equal(file.status, 200);
    assert.equal(file.body.path, "src/README.md");
    assert.equal(file.body.branch, "main");
    assert.equal(file.body.content, "Document search flow");

    const unknownDirectory = await call(app.base, "/api/repositories/acme-demo/acme-docs/tree/main/no-such-directory");
    assert.equal(unknownDirectory.status, 404);
    const unknownBranch = await call(app.base, "/api/repositories/acme-demo/acme-docs/tree/missing-branch");
    assert.equal(unknownBranch.status, 404);
    const unknownFile = await call(app.base, "/api/repositories/acme-demo/acme-docs/blob/main/src/missing.md");
    assert.equal(unknownFile.status, 404);
  } finally {
    await app.close();
  }
});

test("code views follow repository visibility and access rules", async () => {
  const app = await startApp();
  try {
    // `secret-research` is private and granted to nobody.
    for (const path of ["tree", "tree/main", "blob/main/README.md", "commits/main", "search?q=secret"]) {
      const denied = await call(app.base, `/api/repositories/acme-demo/secret-research/${path}`);
      assert.equal(denied.status, 403, path);
    }
    const missing = await call(app.base, "/api/repositories/acme-demo/no-such-repository/tree");
    assert.equal(missing.status, 404);
    const unknownCommit = await call(app.base, "/api/repositories/acme-demo/acme-docs/commit/does-not-exist");
    assert.equal(unknownCommit.status, 404);

    // The organization Owner may read the private repository.
    const owner = await signIn(app.base, "org-owner");
    const readable = await call(app.base, "/api/repositories/acme-demo/secret-research/tree", {
      cookie: owner.sessionCookie,
    });
    assert.equal(readable.status, 200);
    assert.deepEqual(readable.body.entries, []);
  } finally {
    await app.close();
  }
});

test("the commit history lists the seeded records newest first", async () => {
  const app = await startApp();
  try {
    const history = await call(app.base, "/api/repositories/acme-demo/acme-docs/commits/main");
    assert.equal(history.status, 200);
    assert.equal(history.body.branch, "main");
    assert.equal(history.body.path, "");
    assert.equal(history.body.count, 2);
    assert.deepEqual(
      history.body.commits.map((commit) => [commit.message, commit.author, commit.createdAt]),
      [
        ["Document search flow", "alice-dev", "2024-05-01T10:00:00.000Z"],
        ["Initial commit", "alice-dev", "2024-04-20T09:15:00.000Z"],
      ],
    );
    const head = history.body.commits[0];
    assert.equal(head.parentId, history.body.commits[1].id);
    assert.equal(head.changedFiles, 2);

    // The history of one file path only contains the commits that changed it.
    const fileHistory = await call(app.base, "/api/repositories/acme-demo/acme-docs/commits/main/src/search.ts");
    assert.equal(fileHistory.status, 200);
    assert.equal(fileHistory.body.path, "src/search.ts");
    assert.equal(fileHistory.body.commits.length, 2);
    assert.equal(fileHistory.body.count, 2);

    const unreachable = await call(app.base, "/api/repositories/acme-demo/acme-docs/commits/missing-branch");
    assert.equal(unreachable.status, 404);
  } finally {
    await app.close();
  }
});

test("a commit detail shows the changed files with numeric additions and deletions", async () => {
  const app = await startApp();
  try {
    const history = await call(app.base, "/api/repositories/acme-demo/acme-docs/commits/main");
    const head = history.body.commits[0];

    const detail = await call(app.base, `/api/repositories/acme-demo/acme-docs/commit/${head.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.commit.message, "Document search flow");
    assert.equal(detail.body.commit.author, "alice-dev");
    assert.equal(detail.body.commit.branch, "main");
    assert.equal(detail.body.commit.parentId, history.body.commits[1].id);
    assert.deepEqual(
      detail.body.commit.changes.map((change) => change.path),
      ["src/README.md", "src/search.ts"],
    );

    const changed = detail.body.commit.changes.find((change) => change.path === "src/search.ts");
    assert.equal(changed.changeType, "modified");
    assert.ok(changed.additions > 0, "the seeded revision adds lines");
    assert.ok(changed.deletions > 0, "the seeded revision removes lines");
    assert.equal(
      changed.additions,
      changed.lines.filter((line) => line.type === "add").length,
    );
    assert.equal(
      changed.deletions,
      changed.lines.filter((line) => line.type === "remove").length,
    );
    assert.ok(changed.lines.some((line) => line.type === "context"), "the comparison keeps context");

    // The read-only comparison never rewrites the branch or the file snapshot.
    const after = await call(app.base, "/api/repositories/acme-demo/acme-docs/blob/main/src/search.ts");
    assert.equal(after.body.content, "import { searchIndex } from \"./index\";\n\nexport function searchDocuments(query: string) {\n  const results = searchIndex(query);\n  return results;\n}\n");

    // The head of the branch is not affected by reading the parent revision.
    const parent = await call(app.base, `/api/repositories/acme-demo/acme-docs/commit/${detail.body.commit.parentId}`);
    assert.equal(parent.status, 200);
    assert.ok(parent.body.commit.changes.some((change) => change.path === "src/search.ts"));
  } finally {
    await app.close();
  }
});

test("code search matches readable file content of the current repository only", async () => {
  const app = await startApp();
  try {
    const match = await call(app.base, "/api/repositories/acme-demo/acme-docs/search?q=search%20flow");
    assert.equal(match.status, 200);
    assert.equal(match.body.query, "search flow");
    assert.equal(match.body.branch, "main");
    assert.deepEqual(match.body.matches.map((entry) => entry.path), ["src/README.md"]);
    assert.deepEqual(match.body.matches[0].lines, [{ number: 1, text: "Document search flow" }]);

    const absent = await call(app.base, "/api/repositories/acme-demo/acme-docs/search?q=no-such-token");
    assert.equal(absent.status, 200);
    assert.deepEqual(absent.body.matches, []);

    // Repeating the same query answers the same empty result.
    const repeated = await call(app.base, "/api/repositories/acme-demo/acme-docs/search?q=no-such-token");
    assert.deepEqual(repeated.body.matches, []);

    // Matching is line-based and case-insensitive, and stays inside the branch
    // snapshot: only the file that holds the token is reported.
    const scoped = await call(app.base, "/api/repositories/acme-demo/acme-docs/search?q=searchIndex");
    assert.deepEqual(scoped.body.matches.map((entry) => entry.path), ["src/search.ts"]);
    assert.ok(scoped.body.matches[0].lines.every((line) => line.text.includes("searchIndex")));
  } finally {
    await app.close();
  }
});

test("browsing, history, diffs and code search leave the stored state untouched", async () => {
  const app = await startApp();
  try {
    const before = JSON.parse(await readFile(join(app.dataDir, "state.json"), "utf8"));
    await call(app.base, "/api/repositories/acme-demo/acme-docs/tree/main/src");
    await call(app.base, "/api/repositories/acme-demo/acme-docs/commits/main");
    const history = await call(app.base, "/api/repositories/acme-demo/acme-docs/commits/main");
    await call(app.base, `/api/repositories/acme-demo/acme-docs/commit/${history.body.commits[0].id}`);
    await call(app.base, "/api/repositories/acme-demo/acme-docs/search?q=search%20flow");
    const after = JSON.parse(await readFile(join(app.dataDir, "state.json"), "utf8"));

    assert.deepEqual(after.commits, before.commits);
    assert.deepEqual(after.files, before.files);
    assert.deepEqual(after.branches, before.branches);
  } finally {
    await app.close();
  }
});

test("the seeded snapshot stays readable after a restart", async () => {
  const app = await startApp();
  const restarted = await startAppOn(app.dataDir);
  try {
    const first = await call(app.base, "/api/repositories/acme-demo/acme-docs/blob/main/src/README.md");
    assert.equal(first.body.content, "Document search flow");

    const second = await call(restarted.base, "/api/repositories/acme-demo/acme-docs/blob/main/src/README.md");
    assert.equal(second.body.content, "Document search flow");
    const history = await call(restarted.base, "/api/repositories/acme-demo/acme-docs/commits/main");
    assert.equal(history.body.count, 2);
    const tree = await call(restarted.base, "/api/repositories/acme-demo/acme-docs/tree/main/src");
    assert.deepEqual(tree.body.entries.map((entry) => entry.name), ["README.md", "search.ts"]);
  } finally {
    await app.close();
    await restarted.close();
  }
});
