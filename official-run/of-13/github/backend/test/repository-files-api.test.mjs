// REQ-4-4: committing a file change through the web interface.
//
// One submission stores the new file snapshot as a commit whose parent is the
// branch head, records the author and message, and moves the branch to it. A
// rejected submission leaves the file, the branch head and the history as they
// were.

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

async function stateSnapshot(app) {
  try {
    return await readFile(join(app.dataDir, "state.json"), "utf8");
  } catch {
    return null;
  }
}

test("a Write contributor adds a file in one commit and reads it back", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const head = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=feature-search",
    );
    const parentId = head.body.commits[0].id;

    const saved = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie,
        body: {
          branch: "feature-search",
          path: "docs/guide.md",
          content: "Read the guide.",
          message: "Add docs/guide.md",
        },
      },
    );
    assert.equal(saved.status, 201);
    assert.equal(saved.body.path, "docs/guide.md");
    assert.equal(saved.body.branch, "feature-search");
    assert.equal(saved.body.commit.message, "Add docs/guide.md");
    assert.equal(saved.body.commit.parentId, parentId);
    assert.equal(saved.body.commit.author, "alice-dev");

    // The stored content is exactly what was submitted.
    const blob = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=docs%2Fguide.md",
    );
    assert.equal(blob.status, 200);
    assert.equal(blob.body.content, "Read the guide.");
    assert.equal(blob.body.commit.message, "Add docs/guide.md");
    assert.equal(blob.body.commit.author, "alice-dev");

    // The branch head moved to the new commit and the history records it.
    const history = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=feature-search",
    );
    assert.equal(history.body.commits[0].message, "Add docs/guide.md");
    assert.equal(history.body.commits[0].parentId, parentId);
    assert.equal(history.body.commitCount, head.body.commitCount + 1);
    assert.deepEqual(
      history.body.commits.slice(1).map((commit) => commit.message),
      head.body.commits.map((commit) => commit.message),
    );

    // The file-scoped history of the new file holds exactly that commit.
    const fileHistory = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=feature-search&path=docs%2Fguide.md",
    );
    assert.equal(fileHistory.status, 200);
    assert.deepEqual(
      fileHistory.body.commits.map((commit) => commit.message),
      ["Add docs/guide.md"],
    );

    // Everything survives a restart.
    const baseUrl = await app.restart();
    const reloaded = await call(
      baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=docs%2Fguide.md",
    );
    assert.equal(reloaded.body.content, "Read the guide.");
  });
});

test("an existing file is edited by a new commit, never rewritten", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const head = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=feature-search",
    );
    const originalSha = head.body.commits[0].sha;

    const saved = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie,
        body: {
          branch: "feature-search",
          path: "README.md",
          previousPath: "README.md",
          content: "# Acme Docs\n\nEdited through the web interface.\n",
          message: "Update README.md",
        },
      },
    );
    assert.equal(saved.status, 201);

    const blob = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=README.md",
    );
    assert.equal(blob.body.content, "# Acme Docs\n\nEdited through the web interface.\n");
    assert.equal(blob.body.commit.message, "Update README.md");

    // The older revision still holds its original content.
    const origin = await call(
      app.baseUrl,
      `/api/repositories/acme-demo/acme-docs/commits/${originalSha}`,
    );
    assert.equal(origin.status, 200);
    assert.match(origin.body.commit.message, /Draft search prototype/);
    const comparison = origin.body.comparison;
    assert.equal(
      comparison.files.some((file) => file.path === "README.md"),
      true,
    );
  });
});

test("an invalid path and a missing message change neither files nor history", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const before = await stateSnapshot(app);
    const head = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=feature-search",
    );

    const rejected = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie,
        body: {
          branch: "feature-search",
          path: "../invalid.md",
          content: "must not be saved",
          message: "",
        },
      },
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fieldErrors.path, "Invalid file path");
    assert.equal(rejected.body.fieldErrors.message, "Commit message is required");

    for (const path of ["", "/absolute.md", "docs/../escape.md", "docs//double.md", "docs/"]) {
      const response = await call(
        app.baseUrl,
        "/api/repositories/acme-demo/acme-docs/files",
        { method: "POST", cookie, body: { branch: "feature-search", path, content: "x", message: "Add file" } },
      );
      assert.equal(response.status, 400, path);
      assert.equal(response.body.fieldErrors.path, "Invalid file path", path);
    }

    const conflicting = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie,
        body: { branch: "feature-search", path: "README.md", content: "x", message: "Add README" },
      },
    );
    assert.equal(conflicting.status, 400);
    assert.equal(conflicting.body.fieldErrors.path, "Invalid file path");

    const directoryConflict = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie,
        body: { branch: "feature-search", path: "prototype", content: "x", message: "Add prototype" },
      },
    );
    assert.equal(directoryConflict.status, 400);

    const tooLong = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie,
        body: { branch: "feature-search", path: "docs/long.md", content: "x", message: "m".repeat(73) },
      },
    );
    assert.equal(tooLong.status, 400);
    assert.ok(tooLong.body.fieldErrors.message);

    // Nothing changed: same head, same history, same stored state.
    const after = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=feature-search",
    );
    assert.equal(after.body.commitCount, head.body.commitCount);
    assert.equal(after.body.commits[0].id, head.body.commits[0].id);
    const missingFile = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=feature-search&path=docs%2Flong.md",
    );
    assert.equal(missingFile.status, 404);
    assert.equal(await stateSnapshot(app), before);
  });
});

test("committing a file needs Write or higher", async () => {
  await withApp(async (app) => {
    const visitor = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        body: { branch: "feature-search", path: "docs/visitor.md", content: "x", message: "Add file" },
      },
    );
    assert.equal(visitor.status, 401);

    const memberCookie = await signIn(app, BOB);
    // `bob-reviewer` holds the seeded Write grant on `acme-docs`, so a member
    // with Write really commits; the private repository he holds no role on
    // stays read-only for him.
    const member = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie: memberCookie,
        body: { branch: "feature-search", path: "docs/member.md", content: "x", message: "Add file" },
      },
    );
    assert.equal(member.status, 201);

    const privateRepository = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/files",
      {
        method: "POST",
        cookie: memberCookie,
        body: { branch: "feature-search", path: "docs/member.md", content: "x", message: "Add file" },
      },
    );
    assert.equal(privateRepository.status, 403);

    const adminCookie = await signIn(app, ALICE);
    await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/access", {
      method: "PUT",
      cookie: adminCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "triage" },
    });
    const triage = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie: memberCookie,
        body: { branch: "feature-search", path: "docs/member.md", content: "x", message: "Add file" },
      },
    );
    assert.equal(triage.status, 403);
  });
});

test("a Write grant on a team is enough to commit a file", async () => {
  await withApp(async (app) => {
    const adminCookie = await signIn(app, ALICE);
    const memberCookie = await signIn(app, BOB);
    // `platform-team` holds the seeded Write grant; bob becomes a member.
    const added = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/teams/platform-team/members",
      { method: "POST", cookie: adminCookie, body: { username: "bob-reviewer" } },
    );
    assert.equal(added.status, 201);

    const saved = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie: memberCookie,
        body: { branch: "feature-search", path: "docs/team.md", content: "From the team.", message: "Add docs/team.md" },
      },
    );
    assert.equal(saved.status, 201);
    assert.equal(saved.body.commit.author, "bob-reviewer");
  });
});

test("a branch protection rule blocks direct writes to its exact branch", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const before = await stateSnapshot(app);
    const head = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=main",
    );

    // `main` is protected by the seeded rule, so a direct commit is refused
    // with the reason and neither the file nor the branch head changes.
    const blocked = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie,
        body: { branch: "main", path: "docs/bypass.md", content: "x", message: "Bypass the rule" },
      },
    );
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, "The branch is protected by a branch protection rule");

    const after = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/commits?branch=main",
    );
    assert.equal(after.body.commits[0].id, head.body.commits[0].id);
    const missing = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/blob?branch=main&path=docs%2Fbypass.md",
    );
    assert.equal(missing.status, 404);
    assert.equal(await stateSnapshot(app), before);

    // A branch whose name carries no rule stays writable: the same submission
    // succeeds on `feature-search`.
    const allowed = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/files",
      {
        method: "POST",
        cookie,
        body: {
          branch: "feature-search",
          path: "docs/bypass.md",
          content: "x",
          message: "Bypass the rule",
        },
      },
    );
    assert.equal(allowed.status, 201);
  });
});
