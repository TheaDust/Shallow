import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };
const BOB = { username: "bob-reviewer", password: "Valid-password-123!" };

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, account) {
  const response = await call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier: account.username, password: account.password },
  });
  assert.equal(response.status, 200);
  return response.setCookie?.split(";")[0] ?? null;
}

test("an initialized private repository stores README, commit and default branch", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const created = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie,
      body: {
        owner: "alice-dev",
        name: "playwright-repo",
        description: "Repository created by Playwright",
        visibility: "private",
        initializeReadme: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.repository.owner, "alice-dev");
    assert.equal(created.body.repository.name, "playwright-repo");
    assert.equal(created.body.repository.visibility, "private");
    assert.equal(created.body.repository.description, "Repository created by Playwright");
    assert.equal(created.body.repository.defaultBranch, "main");
    assert.equal(created.body.repository.createdBy, "account-alice-dev");
    assert.equal(created.body.repository.source, null);

    const tree = await call(app.baseUrl, "/api/repositories/alice-dev/playwright-repo/tree", {
      cookie,
    });
    assert.equal(tree.status, 200);
    assert.equal(tree.body.repository.visibility, "private");
    assert.equal(tree.body.branch, "main");
    assert.deepEqual(
      tree.body.entries.map((entry) => entry.path),
      ["README.md"],
    );

    const blob = await call(
      app.baseUrl,
      "/api/repositories/alice-dev/playwright-repo/blob?path=README.md",
      { cookie },
    );
    assert.equal(blob.status, 200);
    assert.equal(blob.body.commit.message, "Initial commit");
    assert.equal(blob.body.commit.author, "alice-dev");

    // The new repository belongs to the personal namespace list too.
    const mine = await call(app.baseUrl, "/api/repositories", { cookie });
    assert.equal(mine.status, 200);
    assert.deepEqual(
      mine.body.repositories.map((repository) => repository.name),
      ["acme-docs-fork", "playwright-repo"],
    );

    // Everything survives reopening the application on the same state.
    await app.restart();
    const afterRestart = await call(
      app.baseUrl,
      "/api/repositories/alice-dev/playwright-repo/tree",
      { cookie },
    );
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.repository.visibility, "private");
    assert.deepEqual(
      afterRestart.body.entries.map((entry) => entry.path),
      ["README.md"],
    );
  });
});

test("a repository created without initialization is still browsable and empty", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const created = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie,
      body: { name: "empty-project", visibility: "public" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.repository.owner, "alice-dev");
    assert.equal(created.body.repository.visibility, "public");
    assert.equal(created.body.repository.defaultBranch, "main");

    const tree = await call(app.baseUrl, "/api/repositories/alice-dev/empty-project/tree");
    assert.equal(tree.status, 200);
    assert.equal(tree.body.branch, "main");
    assert.deepEqual(tree.body.entries, []);

    const missingReadme = await call(
      app.baseUrl,
      "/api/repositories/alice-dev/empty-project/blob?path=README.md",
    );
    assert.equal(missingReadme.status, 404);
  });
});

test("empty, malformed and duplicate names are rejected without creating anything", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);

    const empty = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie,
      body: { owner: "alice-dev", name: "", visibility: "private", initializeReadme: true },
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.fieldErrors.name, "Repository name is required");

    const malformed = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie,
      body: { owner: "alice-dev", name: "bad name", initializeReadme: true },
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.fieldErrors.name, "Repository name format is invalid");

    // `acme-docs-fork` already exists in the same personal namespace.
    const duplicate = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie,
      body: {
        owner: "alice-dev",
        name: "acme-docs-fork",
        visibility: "public",
        initializeReadme: true,
      },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Repository name already exists");

    const mine = await call(app.baseUrl, "/api/repositories", { cookie });
    assert.deepEqual(
      mine.body.repositories.map((repository) => repository.name),
      ["acme-docs-fork"],
    );

    // The seeded fork keeps its own single initialization commit.
    const forkTree = await call(app.baseUrl, "/api/repositories/alice-dev/acme-docs-fork/tree", {
      cookie,
    });
    assert.equal(forkTree.status, 200);
    assert.equal(forkTree.body.repository.source.owner, "acme-demo");
    assert.equal(forkTree.body.repository.source.name, "acme-docs");
  });
});

test("the personal namespace is the default owner and its own repositories stay private", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const created = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie,
      body: { name: "default-owner-repo", initializeReadme: true },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.repository.owner, "alice-dev");

    // The seeded private personal fork is readable by its owner only.
    const visitor = await call(app.baseUrl, "/api/repositories/alice-dev/acme-docs-fork/tree");
    assert.equal(visitor.status, 403);
    const owner = await call(app.baseUrl, "/api/repositories/alice-dev/acme-docs-fork/tree", {
      cookie,
    });
    assert.equal(owner.status, 200);

    const search = await call(app.baseUrl, "/api/search?q=acme-docs");
    assert.deepEqual(
      search.body.results.map((result) => result.name),
      ["acme-docs"],
    );
  });
});

test("creating inside an organization namespace requires Owner status", async () => {
  await withApp(async (app) => {
    const aliceCookie = await signIn(app, ALICE);
    const ownerCreated = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie: aliceCookie,
      body: {
        owner: "acme-demo",
        name: "org-playground",
        visibility: "private",
        initializeReadme: true,
      },
    });
    assert.equal(ownerCreated.status, 201);
    assert.equal(ownerCreated.body.repository.owner, "acme-demo");

    const organizationList = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/repositories",
      { cookie: aliceCookie },
    );
    assert.ok(
      organizationList.body.repositories.some(
        (repository) => repository.name === "org-playground",
      ),
    );

    // `bob-reviewer` is only an organization Member.
    const bobCookie = await signIn(app, BOB);
    const denied = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie: bobCookie,
      body: { owner: "acme-demo", name: "bob-playground", visibility: "public" },
    });
    assert.equal(denied.status, 400);
    assert.equal(
      denied.body.fieldErrors.owner,
      "You do not have permission to create a repository for this owner",
    );

    const unknownOwner = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      cookie: bobCookie,
      body: { owner: "nobody-here", name: "nowhere" },
    });
    assert.equal(unknownOwner.status, 400);
    assert.equal(unknownOwner.body.fieldErrors.owner, "Owner is invalid");
  });
});

test("repository writes require a session", async () => {
  await withApp(async (app) => {
    const creating = await call(app.baseUrl, "/api/repositories", {
      method: "POST",
      body: { name: "anonymous-repo" },
    });
    assert.equal(creating.status, 401);
    assert.equal(creating.body.error, "Not authenticated");

    const listing = await call(app.baseUrl, "/api/repositories");
    assert.equal(listing.status, 401);

    const forking = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/forks", {
      method: "POST",
      body: { name: "anonymous-fork" },
    });
    assert.equal(forking.status, 401);
  });
});

test("a fork copies the readable history and keeps the source link", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const forked = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/forks", {
      method: "POST",
      cookie,
      body: { owner: "alice-dev", name: "acme-docs-copy", visibility: "public" },
    });
    assert.equal(forked.status, 201);
    assert.equal(forked.body.repository.owner, "alice-dev");
    assert.equal(forked.body.repository.name, "acme-docs-copy");
    assert.equal(forked.body.repository.visibility, "public");
    assert.deepEqual(forked.body.repository.source, { owner: "acme-demo", name: "acme-docs" });

    const forkTree = await call(app.baseUrl, "/api/repositories/alice-dev/acme-docs-copy/tree");
    assert.equal(forkTree.status, 200);
    assert.deepEqual(
      forkTree.body.entries.map((entry) => entry.path),
      ["docs", "src", "README.md"],
    );
    assert.deepEqual(forkTree.body.repository.source, { owner: "acme-demo", name: "acme-docs" });

    const sourceBlob = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?path=docs/search.md",
    );
    const forkBlob = await call(
      app.baseUrl,
      "/api/repositories/alice-dev/acme-docs-copy/blob?path=docs/search.md",
    );
    assert.equal(forkBlob.status, 200);
    assert.match(forkBlob.body.content, /Type a repository name/);
    // The copy is independent: the fork owns its own commit records.
    assert.notEqual(forkBlob.body.commit.id, sourceBlob.body.commit.id);

    // The source repository is untouched by the copy.
    const sourceTree = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/tree");
    assert.deepEqual(
      sourceTree.body.entries.map((entry) => entry.path),
      ["docs", "src", "README.md"],
    );
    assert.equal(sourceTree.body.repository.source, null);
  });
});

test("a fork keeps a private source private and rejects conflicts or unreachable sources", async () => {
  await withApp(async (app) => {
    const aliceCookie = await signIn(app, ALICE);

    const privateFork = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/forks",
      {
        method: "POST",
        cookie: aliceCookie,
        body: { owner: "alice-dev", name: "secret-research-copy", visibility: "public" },
      },
    );
    assert.equal(privateFork.status, 201);
    assert.equal(privateFork.body.repository.visibility, "private");

    const conflict = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/forks", {
      method: "POST",
      cookie: aliceCookie,
      body: { owner: "alice-dev", name: "acme-docs-fork" },
    });
    assert.equal(conflict.status, 400);
    assert.equal(conflict.body.fieldErrors.name, "Repository name already exists");

    const unknownSource = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/not-there/forks",
      { method: "POST", cookie: aliceCookie, body: { owner: "alice-dev", name: "nothing" } },
    );
    assert.equal(unknownSource.status, 404);

    // `bob-reviewer` cannot read the private source, so no fork is created.
    const bobCookie = await signIn(app, BOB);
    const denied = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/forks",
      {
        method: "POST",
        cookie: bobCookie,
        body: { owner: "bob-reviewer", name: "bob-secret-copy" },
      },
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "Access denied");

    const bobList = await call(app.baseUrl, "/api/repositories", { cookie: bobCookie });
    assert.deepEqual(
      bobList.body.repositories.map((repository) => repository.name),
      ["bob-notes"],
    );
  });
});
