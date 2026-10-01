import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, { username, password }) {
  const response = await call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier: username, password },
  });
  assert.equal(response.status, 200);
  return response.setCookie?.split(";")[0] ?? null;
}

/** `null` while no write has happened yet, else the stored state text. */
async function stateSnapshot(app) {
  try {
    return await readFile(join(app.dataDir, "state.json"), "utf8");
  } catch {
    return null;
  }
}

test("a visitor reads the branch history newest first with message, author, time and parent", async () => {
  await withApp(async (app) => {
    const history = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/commits");
    assert.equal(history.status, 200);
    assert.equal(history.body.repository.name, "acme-docs");
    assert.equal(history.body.branch, "main");
    assert.equal(history.body.path, "");
    assert.equal(history.body.commitCount, 2);
    assert.deepEqual(
      history.body.commits.map((commit) => commit.message),
      ["Document search flow", "Initial commit"],
    );

    const [newest, oldest] = history.body.commits;
    assert.equal(newest.sha, "d4e5f6a");
    assert.equal(newest.shortSha, "d4e5f6a");
    assert.equal(newest.author, "alice-dev");
    assert.equal(newest.parentSha, "a1b2c3d");
    assert.deepEqual(newest.changedFiles, [
      "docs/getting-started.md",
      "docs/search.md",
      "README.md",
      "src/search.ts",
    ]);
    assert.equal(oldest.parentSha, null);
    // The first revision only carried the getting-started guide.
    assert.deepEqual(oldest.changedFiles, ["docs/getting-started.md"]);

    // The branch selector of the history page reads the same stored branches.
    assert.deepEqual(history.body.branches, [
      "docs-polish",
      "draft-feature",
      "feature-search",
      "main",
      "release",
      "search-filters",
      "search-fixes",
      "search-ranking",
    ]);

    const withBranch = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=feature-search",
    );
    assert.equal(withBranch.status, 200);
    assert.equal(withBranch.body.branch, "feature-search");
    assert.equal(withBranch.body.commits[0].message, "Draft search prototype");
  });
});

test("a file-scoped history only lists the commits that changed that file", async () => {
  await withApp(async (app) => {
    const readme = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?path=README.md",
    );
    assert.equal(readme.status, 200);
    assert.equal(readme.body.path, "README.md");
    // `README.md` only exists since the later commit, so the initial commit -
    // which did not change it - is not part of the file-scoped history.
    assert.deepEqual(
      readme.body.commits.map((commit) => commit.message),
      ["Document search flow"],
    );
    assert.equal(readme.body.commitCount, 2);

    // `docs/search.md` only exists since the later commit.
    const guide = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?path=docs%2Fsearch.md",
    );
    assert.equal(guide.status, 200);
    assert.deepEqual(
      guide.body.commits.map((commit) => commit.message),
      ["Document search flow"],
    );

    // A file that only exists on `main` has no history on the other branch.
    const otherBranch = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=feature-search&path=docs%2Fsearch.md",
    );
    assert.equal(otherBranch.status, 404);

    const unknownBranch = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=not-a-branch",
    );
    assert.equal(unknownBranch.status, 404);
  });
});

test("a commit entry keeps its parent revision and the diff against it", async () => {
  await withApp(async (app) => {
    const committed = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits/d4e5f6a",
    );
    assert.equal(committed.status, 200);
    assert.equal(committed.body.commit.sha, "d4e5f6a");
    assert.equal(committed.body.commit.author, "alice-dev");
    assert.equal(committed.body.commit.parentSha, "a1b2c3d");

    const comparison = committed.body.comparison;
    assert.equal(comparison.base.sha, "a1b2c3d");
    assert.equal(comparison.compare.sha, "d4e5f6a");
    assert.equal(comparison.changedFileCount, 4);
    assert.deepEqual(
      comparison.files.map((file) => `${file.status}:${file.path}`),
      [
        "modified:docs/getting-started.md",
        "added:docs/search.md",
        "added:README.md",
        "added:src/search.ts",
      ],
    );
    assert.ok(comparison.additions > 0);
    assert.ok(comparison.deletions >= 0);

    const addedFile = comparison.files.find((file) => file.path === "src/search.ts");
    assert.equal(addedFile.status, "added");
    assert.equal(addedFile.deletions, 0);
    assert.equal(addedFile.lines.every((line) => line.type === "add"), true);

    // A single-file view keeps the same identifiers and only that file.
    const fileView = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits/d4e5f6a?path=src%2Fsearch.ts",
    );
    assert.equal(fileView.status, 200);
    assert.equal(fileView.body.comparison.path, "src/search.ts");
    assert.deepEqual(
      fileView.body.comparison.files.map((file) => file.path),
      ["src/search.ts"],
    );
    assert.equal(fileView.body.comparison.changedFileCount, 4);

    const initial = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits/a1b2c3d",
    );
    assert.equal(initial.status, 200);
    assert.equal(initial.body.comparison.base, null);

    const unknown = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits/deadbee",
    );
    assert.equal(unknown.status, 404);
  });
});

test("two revisions compare line by line without touching the stored repository", async () => {
  await withApp(async (app) => {
    const before = await stateSnapshot(app);

    const defaultComparison = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/compare",
    );
    assert.equal(defaultComparison.status, 200);
    assert.equal(defaultComparison.body.base.sha, "a1b2c3d");
    assert.equal(defaultComparison.body.compare.sha, "d4e5f6a");

    const chosen = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/compare?base=a1b2c3d&compare=d4e5f6a&path=README.md",
    );
    assert.equal(chosen.status, 200);
    assert.equal(chosen.body.base.shortSha, "a1b2c3d");
    assert.equal(chosen.body.compare.shortSha, "d4e5f6a");
    assert.deepEqual(
      chosen.body.files.map((file) => file.path),
      ["README.md"],
    );
    const lines = chosen.body.files[0].lines;
    assert.ok(lines.some((line) => line.type === "add"));
    assert.deepEqual(
      lines.filter((line) => line.type === "add").map((line) => line.text),
      ["# Acme Docs", "", "Documentation for the Acme Demo platform.", "", "The search flow starts in the search box at the top of every page."],
    );
    assert.equal(chosen.body.files[0].status, "added");
    assert.equal(chosen.body.files[0].additions, 5);
    assert.equal(chosen.body.files[0].deletions, 0);
    // The summary still describes the whole comparison.
    assert.equal(chosen.body.changedFileCount, 4);
    assert.equal(chosen.body.additions, 13);
    assert.equal(chosen.body.deletions, 1);

    // A branch name is a revision too; that comparison also removes files.
    const byBranch = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/compare?base=feature-search&compare=main",
    );
    assert.equal(byBranch.status, 200);
    assert.equal(byBranch.body.base.sha, "f7a8b9c");
    assert.equal(byBranch.body.compare.sha, "d4e5f6a");
    assert.deepEqual(
      byBranch.body.files.map((file) => `${file.status}:${file.path}`),
      [
        "added:docs/getting-started.md",
        "added:docs/search.md",
        "removed:main-only.md",
        "removed:prototype/search.ts",
        "modified:README.md",
        "added:src/search.ts",
      ],
    );
    assert.ok(byBranch.body.deletions > 0);
    assert.ok(byBranch.body.additions > 0);

    // Revisions offered for the comparison selects.
    assert.deepEqual(
      chosen.body.revisions.map((revision) => revision.value),
      ["f2a3b4c", "e1f2a3b", "d0e1f2a", "c9d0e1f", "b8c9d0e", "f7a8b9c", "d4e5f6a", "a1b2c3d"],
    );

    const unknown = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/compare?base=a1b2c3d&compare=deadbee",
    );
    assert.equal(unknown.status, 404);

    // Reading a comparison never writes state.
    assert.equal(await stateSnapshot(app), before);
  });
});

test("history, commit and comparison follow repository read permission", async () => {
  await withApp(async (app) => {
    for (const path of [
      "/api/repositories/acme-demo/secret-research/commits",
      "/api/repositories/acme-demo/secret-research/commits/b2c3d4e",
      "/api/repositories/acme-demo/secret-research/compare",
    ]) {
      const denied = await call(app.baseUrl, path);
      assert.equal(denied.status, 403, path);
    }

    const missing = await call(app.baseUrl, "/api/repositories/acme-demo/not-there/commits");
    assert.equal(missing.status, 404);

    const cookie = await signIn(app, ALICE);
    const readable = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/commits",
      { cookie },
    );
    assert.equal(readable.status, 200);
    assert.equal(readable.body.commits[0].message, "Start research notes");
  });
});
