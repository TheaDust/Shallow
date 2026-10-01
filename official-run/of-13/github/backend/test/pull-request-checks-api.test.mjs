// REQ-6-1: the `Checks` area of one pull request.
//
// The area is attached to the current compare commit of the record: the `test`
// status starts as pending, only a repository Admin may store a new status
// together with the setter and the time, and a new commit of the compare branch
// starts as pending again — the earlier result never applies to the new
// revision.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };
const BOB = { username: "bob-reviewer", password: "Valid-password-123!" };
const REPOSITORY = "/api/repositories/acme-demo/acme-docs";
const PULLS = `${REPOSITORY}/pulls`;

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

test("the Checks area starts as pending for the current compare commit", async () => {
  await withApp(async (app) => {
    const detail = await call(app.baseUrl, `${PULLS}/7`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.checks.length, 1);
    const [check] = detail.body.checks;
    assert.equal(check.name, "test");
    assert.equal(check.status, "pending");
    assert.equal(check.updatedBy, null);
    assert.equal(check.updatedAt, null);
    assert.equal(check.commitId, detail.body.pullRequest.compareCommit.id);

    // The mergeable record starts from its stored success.
    const eligible = await call(app.baseUrl, `${PULLS}/6`);
    assert.equal(eligible.body.checks[0].status, "success");
    assert.equal(eligible.body.checks[0].updatedBy, "alice-dev");
    assert.ok(eligible.body.checks[0].updatedAt);
  });
});

test("only a repository Admin updates the test status and the result is persisted", async () => {
  await withApp(async (app) => {
    const visitor = await call(app.baseUrl, `${PULLS}/7/checks`, {
      method: "POST",
      body: { name: "test", status: "success" },
    });
    assert.equal(visitor.status, 401);

    const memberCookie = await signIn(app, BOB);
    const before = await stateSnapshot(app);
    const member = await call(app.baseUrl, `${PULLS}/7/checks`, {
      method: "POST",
      cookie: memberCookie,
      body: { name: "test", status: "success" },
    });
    assert.equal(member.status, 403);
    assert.equal(await stateSnapshot(app), before);
    const unchanged = await call(app.baseUrl, `${PULLS}/7`, { cookie: memberCookie });
    assert.equal(unchanged.body.checks[0].status, "pending");

    const cookie = await signIn(app, ALICE);
    const unsupported = await call(app.baseUrl, `${PULLS}/7/checks`, {
      method: "POST",
      cookie,
      body: { name: "test", status: "almost" },
    });
    assert.equal(unsupported.status, 400);
    assert.ok(unsupported.body.fieldErrors.status);

    const saved = await call(app.baseUrl, `${PULLS}/7/checks`, {
      method: "POST",
      cookie,
      body: { name: "test", status: "success" },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.checks[0].status, "success");
    assert.equal(saved.body.checks[0].updatedBy, "alice-dev");
    assert.ok(saved.body.checks[0].updatedAt);
    assert.equal(saved.body.checks[0].commitId, saved.body.pullRequest.compareCommit.id);

    // The stored result belongs to that compare commit and survives a restart.
    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, `${PULLS}/7`);
    assert.equal(reloaded.body.checks[0].status, "success");
    assert.equal(reloaded.body.checks[0].updatedBy, "alice-dev");
    assert.equal(reloaded.body.checks[0].commitId, reloaded.body.pullRequest.compareCommit.id);
  });
});

test("a new compare commit starts with pending and never reuses the old result", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const saved = await call(app.baseUrl, `${PULLS}/7/checks`, {
      method: "POST",
      cookie,
      body: { name: "test", status: "success" },
    });
    assert.equal(saved.status, 200);
    const previousCommit = saved.body.pullRequest.compareCommit.id;

    // The compare branch receives a new commit through the ordinary file
    // editor, so the pull request has to move to the new compare commit.
    const committed = await call(app.baseUrl, `${REPOSITORY}/files`, {
      method: "POST",
      cookie,
      body: {
        branch: "docs-polish",
        path: "docs/after.md",
        content: "A newer revision.",
        message: "Add docs/after.md",
      },
    });
    assert.equal(committed.status, 201);

    const after = await call(app.baseUrl, `${PULLS}/7`, { cookie });
    assert.notEqual(after.body.pullRequest.compareCommit.id, previousCommit);
    assert.equal(after.body.pullRequest.compareCommit.id, committed.body.commit.id);
    // The new compare commit starts as pending: the earlier success stays
    // attached to its own commit and can never be used for the merge.
    assert.equal(after.body.checks[0].status, "pending");
    assert.equal(after.body.checks[0].updatedBy, null);
    assert.equal(after.body.checks[0].commitId, committed.body.commit.id);

    // The next write persists the new compare commit and keeps the record of
    // the stale marking in the activity timeline.
    const savedAgain = await call(app.baseUrl, `${PULLS}/7/checks`, {
      method: "POST",
      cookie,
      body: { name: "test", status: "failure" },
    });
    assert.equal(savedAgain.status, 200);
    assert.equal(savedAgain.body.pullRequest.compareCommit.id, committed.body.commit.id);
    assert.equal(savedAgain.body.checks[0].status, "failure");
    assert.equal(savedAgain.body.checks[0].commitId, committed.body.commit.id);
    assert.equal(
      savedAgain.body.events.some((event) => event.type === "stale_reviews_marked"),
      true,
    );

    const baseUrl = await app.restart();
    const persisted = await call(baseUrl, `${PULLS}/7`);
    assert.equal(persisted.body.pullRequest.compareCommit.id, committed.body.commit.id);
    assert.equal(persisted.body.checks[0].status, "failure");
  });
});
