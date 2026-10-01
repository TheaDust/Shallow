import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const OWNER = { username: "alice-dev", password: "Valid-password-123!" };

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

test("a visitor reads the seeded public repository tree and file content", async () => {
  await withApp(async (app) => {
    const tree = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/tree");
    assert.equal(tree.status, 200);
    assert.equal(tree.body.repository.owner, "acme-demo");
    assert.equal(tree.body.repository.name, "acme-docs");
    assert.equal(tree.body.repository.visibility, "public");
    assert.equal(tree.body.repository.defaultBranch, "main");
    assert.equal(tree.body.branch, "main");
    assert.equal(tree.body.path, "");
    assert.deepEqual(
      tree.body.entries.map((entry) => `${entry.type}:${entry.name}`),
      ["directory:docs", "directory:src", "file:README.md"],
    );
    assert.deepEqual(tree.body.branches, [
      "docs-polish",
      "draft-feature",
      "feature-search",
      "main",
      "release",
      "search-filters",
      "search-fixes",
      "search-ranking",
    ]);

    const nested = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/tree?branch=main&path=docs",
    );
    assert.equal(nested.status, 200);
    assert.equal(nested.body.path, "docs");
    assert.deepEqual(
      nested.body.entries.map((entry) => `${entry.type}:${entry.path}`),
      ["file:docs/getting-started.md", "file:docs/search.md"],
    );

    const blob = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=main&path=docs/search.md",
    );
    assert.equal(blob.status, 200);
    assert.equal(blob.body.path, "docs/search.md");
    assert.equal(blob.body.branch, "main");
    assert.match(blob.body.content, /Type a repository name/);
    assert.equal(blob.body.commit.message, "Document search flow");
    assert.equal(blob.body.commit.author, "alice-dev");
  });
});

test("switching branch changes the file snapshot read by the page", async () => {
  await withApp(async (app) => {
    const main = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/blob?path=docs/search.md");
    assert.equal(main.status, 200);

    // `feature-search` holds a snapshot without the `docs` directory and with
    // a `main-only.md` that does not exist on `main`.
    const trees = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/tree?branch=feature-search",
    );
    assert.equal(trees.status, 200);
    assert.equal(trees.body.branch, "feature-search");
    assert.deepEqual(
      trees.body.entries.map((entry) => entry.path),
      ["prototype", "main-only.md", "README.md"],
    );

    const mainOnly = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=main-only.md",
    );
    assert.equal(mainOnly.status, 200);
    assert.match(mainOnly.body.content, /only exists on the feature-search branch/);
    const missingOnMain = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=main&path=main-only.md",
    );
    assert.equal(missingOnMain.status, 404);

    // The two branches differ in the content of the known file.
    const readmeMain = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=main&path=README.md",
    );
    const readmeFeature = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=README.md",
    );
    assert.notEqual(readmeMain.body.content, readmeFeature.body.content);

    const missingFile = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=docs/search.md",
    );
    assert.equal(missingFile.status, 404);

    const unknownBranch = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/tree?branch=not-a-branch",
    );
    assert.equal(unknownBranch.status, 404);
  });
});

test("repository code follows the same access rule as the repository page", async () => {
  await withApp(async (app) => {
    const denied = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research/tree");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "Access denied");

    const missing = await call(app.baseUrl, "/api/repositories/acme-demo/not-there/tree");
    assert.equal(missing.status, 404);
    const missingOwner = await call(app.baseUrl, "/api/repositories/nobody/acme-docs/tree");
    assert.equal(missingOwner.status, 404);

    const cookie = await signIn(app, OWNER);
    const ownerTree = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/tree",
      { cookie },
    );
    assert.equal(ownerTree.status, 200);
    assert.equal(ownerTree.body.branch, "main");
    assert.equal(ownerTree.body.repository.visibility, "private");
    assert.deepEqual(
      ownerTree.body.entries.map((entry) => entry.path),
      ["research", "README.md"],
    );

    const ownerBlob = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/blob?path=research/notes.md",
      { cookie },
    );
    assert.equal(ownerBlob.status, 200);
    assert.match(ownerBlob.body.content, /Research questions/);
  });
});

test("a personal public repository is browsable and a path escape is rejected", async () => {
  await withApp(async (app) => {
    const tree = await call(app.baseUrl, "/api/repositories/bob-reviewer/bob-notes/tree");
    assert.equal(tree.status, 200);
    assert.equal(tree.body.repository.owner, "bob-reviewer");
    assert.deepEqual(
      tree.body.entries.map((entry) => entry.path),
      ["README.md"],
    );

    const escape = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/tree?path=..%2F..",
    );
    assert.equal(escape.status, 404);
  });
});
