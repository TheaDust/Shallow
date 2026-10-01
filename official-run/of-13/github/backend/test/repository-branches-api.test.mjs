// REQ-4-3-1 / REQ-4-3-2 / REQ-4-3-3: listing and switching branches, creating a
// branch from an existing revision and changing the repository default branch.
//
// The stored branches always come from the trusted state: creating one only
// adds a named reference at the base commit, and changing the default branch
// never deletes another branch or rewrites a commit.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

test("the seeded branches are readable and list the current branch of the Code page", async () => {
  await withApp(async (app) => {
    const settings = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
    );
    assert.equal(settings.status, 200);
    assert.deepEqual(settings.body.branches, [
      "docs-polish",
      "draft-feature",
      "feature-search",
      "main",
      "release",
      "search-filters",
      "search-fixes",
      "search-ranking",
    ]);
    assert.equal(settings.body.repository.defaultBranch, "main");
    assert.equal(settings.body.canAdminister, false);
    assert.equal(settings.body.canWrite, false);

    // The two branches differ in the content of the known file, and the target
    // branch carries `main-only.md`, which is absent from `main`.
    const main = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=main&path=README.md",
    );
    const feature = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=README.md",
    );
    assert.notEqual(main.body.content, feature.body.content);
    const mainOnly = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=main-only.md",
    );
    assert.equal(mainOnly.status, 200);

    const denied = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/settings/branches",
    );
    assert.equal(denied.status, 403);
    const missing = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/not-there/settings/branches",
    );
    assert.equal(missing.status, 404);
  });
});

test("a Write contributor creates a branch at the current branch head", async () => {
  await withApp(async (app) => {
    const before = await stateSnapshot(app);
    const cookie = await signIn(app, ALICE);

    const mainHead = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=main",
    );
    const headId = mainHead.body.commits[0].id;

    const created = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/branches",
      { method: "POST", cookie, body: { name: "feature/api-v2", base: "main" } },
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.branch.name, "feature/api-v2");
    assert.equal(created.body.branch.commitId, headId);
    assert.equal(created.body.branch.createdBy, "account-alice-dev");
    assert.ok(created.body.branch.createdAt);
    assert.equal(created.body.branches.length, 9);
    assert.equal(created.body.branches.includes("feature/api-v2"), true);

    // The new reference reads the same snapshot as its base; the base branch is
    // not rewritten and no commit was created.
    const tree = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/tree?branch=feature/api-v2",
    );
    assert.equal(tree.status, 200);
    assert.deepEqual(
      tree.body.entries.map((entry) => entry.path),
      ["docs", "src", "README.md"],
    );
    const afterCreate = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=main",
    );
    assert.equal(afterCreate.body.commitCount, mainHead.body.commitCount);
    assert.equal(afterCreate.body.commits[0].id, headId);

    // After a restart the branch list still contains the created reference.
    const baseUrl = await app.restart();
    const reloaded = await call(
      baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
    );
    assert.equal(reloaded.body.branches.includes("feature/api-v2"), true);
    assert.notEqual(await stateSnapshot(app), before);
  });
});

test("invalid, empty, over-long and duplicate branch names create nothing", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const before = await stateSnapshot(app);

    for (const name of [
      "",
      "invalid..branch",
      "double//slash",
      "trailing/",
      "trailing.",
      "bad name",
      "bad~name",
      "x".repeat(256),
      "main",
    ]) {
      const response = await call(
        app.baseUrl,
        "/api/repositories/acme-demo/acme-docs/branches",
        { method: "POST", cookie, body: { name } },
      );
      assert.equal(response.status, 400, name);
      assert.ok(response.body.fieldErrors.name, name);
    }

    const unknownBase = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/branches",
      { method: "POST", cookie, body: { name: "feature/ok", base: "not-a-branch" } },
    );
    assert.equal(unknownBase.status, 400);
    assert.ok(unknownBase.body.fieldErrors.base);

    const settings = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
    );
    assert.deepEqual(settings.body.branches, [
      "docs-polish",
      "draft-feature",
      "feature-search",
      "main",
      "release",
      "search-filters",
      "search-fixes",
      "search-ranking",
    ]);
    assert.equal(await stateSnapshot(app), before);
  });
});

test("creating a branch needs Write or higher, not organization membership alone", async () => {
  await withApp(async (app) => {
    const visitor = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/branches",
      { method: "POST", body: { name: "visitor-branch" } },
    );
    assert.equal(visitor.status, 401);

    // `bob-reviewer` holds the seeded Write grant of the requirements; a
    // member without it (the private repository, where nobody is granted a
    // role) may only browse.
    const memberCookie = await signIn(app, BOB);
    const memberWrite = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/branches",
      { method: "POST", cookie: memberCookie, body: { name: "member-branch" } },
    );
    assert.equal(memberWrite.status, 201);

    const privateRepository = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/branches",
      { method: "POST", cookie: memberCookie, body: { name: "member-branch" } },
    );
    assert.equal(privateRepository.status, 403);

    // A direct Read grant on the same repository still is not Write.
    const adminCookie = await signIn(app, ALICE);
    const granted = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/access",
      {
        method: "PUT",
        cookie: adminCookie,
        body: { subjectType: "account", subjectName: "bob-reviewer", role: "read" },
      },
    );
    assert.equal(granted.status, 200);
    const readOnly = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/branches",
      { method: "POST", cookie: memberCookie, body: { name: "read-branch" } },
    );
    assert.equal(readOnly.status, 403);

    const branches = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
      { cookie: memberCookie },
    );
    assert.equal(branches.body.canWrite, false);
    assert.equal(branches.body.canAdminister, false);
  });
});

test("an Admin changes the default branch without touching the other branches", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);

    const beforeMain = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=main",
    );

    const changed = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
      { method: "POST", cookie, body: { defaultBranch: "release" } },
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.body.repository.defaultBranch, "release");

    // A repository entry without a branch now opens the new default branch.
    const tree = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/tree");
    assert.equal(tree.body.branch, "release");
    assert.equal(tree.body.repository.defaultBranch, "release");

    // The previous default branch and its commits stay available.
    const main = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=main",
    );
    assert.equal(main.status, 200);
    assert.deepEqual(
      main.body.commits.map((commit) => commit.message),
      beforeMain.body.commits.map((commit) => commit.message),
    );
    const settings = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
      { cookie },
    );
    assert.deepEqual(settings.body.branches, [
      "docs-polish",
      "draft-feature",
      "feature-search",
      "main",
      "release",
      "search-filters",
      "search-fixes",
      "search-ranking",
    ]);
    assert.equal(settings.body.canAdminister, true);

    // The change survives a restart.
    const baseUrl = await app.restart();
    const reloaded = await call(
      baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
    );
    assert.equal(reloaded.body.repository.defaultBranch, "release");
  });
});

test("only an Admin changes the default branch and only to an existing branch", async () => {
  await withApp(async (app) => {
    const memberCookie = await signIn(app, BOB);
    const denied = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
      { method: "POST", cookie: memberCookie, body: { defaultBranch: "release" } },
    );
    assert.equal(denied.status, 403);

    const visitor = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
      { method: "POST", body: { defaultBranch: "release" } },
    );
    assert.equal(visitor.status, 401);

    const cookie = await signIn(app, ALICE);
    const unknown = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
      { method: "POST", cookie, body: { defaultBranch: "not-a-branch" } },
    );
    assert.equal(unknown.status, 400);
    assert.ok(unknown.body.fieldErrors.defaultBranch);

    const settings = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/settings/branches",
    );
    assert.equal(settings.body.repository.defaultBranch, "main");
  });
});
