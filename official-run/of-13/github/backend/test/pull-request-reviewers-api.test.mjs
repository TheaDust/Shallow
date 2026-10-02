// REQ-6-4 / REQ-6-6: the reviewer requests of one pull request (the pending
// review relationship shown in the `Reviewers` area) and the close/reopen
// transitions of an unmerged pull request.
//
// A request is never a submitted review decision: deleting it keeps the
// reviews, the comments and the activity records of that account. Every write
// re-checks the stored role of the session account inside one atomic update, so
// a refused request leaves the stored state exactly as it was.

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

/** The stored state text, or `null` while nothing has been written yet. */
async function stateSnapshot(app) {
  try {
    return await readFile(join(app.dataDir, "state.json"), "utf8");
  } catch {
    return null;
  }
}

async function storedState(app) {
  return JSON.parse(await stateSnapshot(app));
}

test("the seeded pull requests start without a reviewer request", async () => {
  await withApp(async (app) => {
    const detail = await call(app.baseUrl, `${PULLS}/1`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.pullRequest.reviewers, []);
    // The eligible candidate holds Write on the repository and is not the
    // author of the seeded pull request.
    assert.deepEqual(detail.body.reviewerCandidates, ["bob-reviewer", "carol-maintainer"]);
    assert.equal(detail.body.canRequestReviewers, false);
    assert.equal(detail.body.canClose, false);
    assert.equal(detail.body.canReopen, false);
    assert.deepEqual(
      detail.body.events.map((event) => event.type),
      ["created", "commented"],
    );
  });
});

test("the author requests a reviewer once and the request survives a restart", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const detail = await call(app.baseUrl, `${PULLS}/1`, { cookie });
    assert.equal(detail.body.canRequestReviewers, true);
    assert.equal(detail.body.canClose, true);

    const requested = await call(app.baseUrl, `${PULLS}/1/reviewers`, {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(requested.status, 201);
    assert.deepEqual(requested.body.pullRequest.reviewers, ["bob-reviewer"]);
    assert.deepEqual(
      requested.body.events.map((event) => event.type),
      ["created", "commented", "review_requested"],
    );
    const event = requested.body.events.at(-1);
    assert.equal(event.actor, "alice-dev");
    assert.equal(event.data.reviewer, "bob-reviewer");
    // The request is not a review decision and never approves anything.
    assert.deepEqual(requested.body.reviews, []);
    assert.equal(requested.body.pullRequest.reviewStatus, "review_required");

    // The same request twice stores one relationship and one activity record.
    const again = await call(app.baseUrl, `${PULLS}/1/reviewers`, {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(again.status, 201);
    assert.deepEqual(again.body.pullRequest.reviewers, ["bob-reviewer"]);
    assert.deepEqual(
      again.body.events.map((event) => event.type),
      ["created", "commented", "review_requested"],
    );

    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, `${PULLS}/1`);
    assert.deepEqual(reloaded.body.pullRequest.reviewers, ["bob-reviewer"]);
  });
});

test("removing a request keeps the submitted reviews, comments and activities", async () => {
  await withApp(async (app) => {
    const author = await signIn(app, ALICE);
    const reviewer = await signIn(app, BOB);

    const requested = await call(app.baseUrl, `${PULLS}/1/reviewers`, {
      method: "POST",
      cookie: author,
      body: { username: "bob-reviewer" },
    });
    assert.equal(requested.status, 201);

    // The requested reviewer submits an approval; the request is not needed for
    // that, and deleting the request must not delete the decision.
    const reviewed = await call(app.baseUrl, `${PULLS}/1/reviews`, {
      method: "POST",
      cookie: reviewer,
      body: { decision: "approve", body: "Looks good." },
    });
    assert.equal(reviewed.status, 201);
    assert.equal(reviewed.body.pullRequest.reviewStatus, "approved");

    const removed = await call(app.baseUrl, `${PULLS}/1/reviewers/bob-reviewer`, {
      method: "DELETE",
      cookie: author,
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.pullRequest.reviewers, []);
    // The review, the seeded discussion comment and the earlier activity stay.
    assert.equal(removed.body.reviews.length, 1);
    assert.equal(removed.body.reviews[0].reviewer, "bob-reviewer");
    assert.equal(removed.body.pullRequest.reviewStatus, "approved");
    assert.equal(removed.body.comments.length, 1);
    assert.deepEqual(
      removed.body.events.map((event) => event.type),
      ["created", "commented", "review_requested", "reviewed", "review_request_removed"],
    );

    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, `${PULLS}/1`);
    assert.deepEqual(reloaded.body.pullRequest.reviewers, []);
    assert.equal(reloaded.body.reviews.length, 1);
  });
});

test("only the author or a manager may change the requests and the candidates are eligible", async () => {
  await withApp(async (app) => {
    const author = await signIn(app, ALICE);
    const reviewer = await signIn(app, BOB);

    // A viewer who is neither the author nor a manager is refused.
    const before = await stateSnapshot(app);
    const viewer = await call(app.baseUrl, `${PULLS}/1/reviewers`, {
      method: "POST",
      cookie: reviewer,
      body: { username: "bob-reviewer" },
    });
    assert.equal(viewer.status, 403);
    assert.equal(await stateSnapshot(app), before);

    // The author of the pull request is not a candidate of itself.
    const self = await call(app.baseUrl, `${PULLS}/1/reviewers`, {
      method: "POST",
      cookie: author,
      body: { username: "alice-dev" },
    });
    assert.equal(self.status, 400);
    assert.equal(self.body.fieldErrors.username, "Member is not eligible to review this pull request");
    assert.equal(await stateSnapshot(app), before);

    // An unknown account is refused without storing anything.
    const unknown = await call(app.baseUrl, `${PULLS}/1/reviewers`, {
      method: "POST",
      cookie: author,
      body: { username: "carol-unknown" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(await stateSnapshot(app), before);

    // A collaborator below Write is not a candidate: `bob-reviewer` holds Write
    // now, so downgrading him to Read removes him from the picker.
    const downgraded = await call(app.baseUrl, `${REPOSITORY}/access`, {
      method: "PUT",
      cookie: author,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "read" },
    });
    assert.equal(downgraded.status, 200);
    const refused = await call(app.baseUrl, `${PULLS}/1/reviewers`, {
      method: "POST",
      cookie: author,
      body: { username: "bob-reviewer" },
    });
    assert.equal(refused.status, 400);
    const after = await call(app.baseUrl, `${PULLS}/1`, { cookie: author });
    assert.deepEqual(after.body.reviewerCandidates, ["carol-maintainer"]);
    assert.deepEqual(after.body.pullRequest.reviewers, []);

    // A Closed record accepts no reviewer request either.
    const closed = await call(app.baseUrl, `${PULLS}/2/reviewers`, {
      method: "POST",
      cookie: author,
      body: { username: "bob-reviewer" },
    });
    assert.equal(closed.status, 400);
  });
});

test("closing and reopening record both transitions and never rewrite a branch", async () => {
  await withApp(async (app) => {
    const author = await signIn(app, ALICE);
    const reviewer = await signIn(app, BOB);

    const opened = await storedState(app);
    const branchesBefore = JSON.stringify(opened.branches);

    // A viewer who is neither the author nor a manager cannot close.
    const denied = await call(app.baseUrl, `${PULLS}/1/close`, {
      method: "POST",
      cookie: reviewer,
    });
    assert.equal(denied.status, 403);
    const detailForViewer = await call(app.baseUrl, `${PULLS}/1`, { cookie: reviewer });
    assert.equal(detailForViewer.body.pullRequest.status, "open");
    assert.equal(detailForViewer.body.canClose, false);
    assert.equal(detailForViewer.body.canReopen, false);

    const closed = await call(app.baseUrl, `${PULLS}/1/close`, { method: "POST", cookie: author });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.pullRequest.status, "closed");
    assert.equal(closed.body.canClose, false);
    assert.equal(closed.body.canReopen, true);
    assert.equal(closed.body.events.at(-1).type, "closed");
    // The discussion, the diff and the branch references stay readable.
    assert.equal(closed.body.comments.length, 1);
    assert.ok(closed.body.comparison.files.length > 0);
    assert.equal(closed.body.pullRequest.sourceBranch, "release");
    assert.equal(closed.body.pullRequest.targetBranch, "main");

    // A closed record cannot be closed again, and a request is no longer open.
    const again = await call(app.baseUrl, `${PULLS}/1/close`, { method: "POST", cookie: author });
    assert.equal(again.status, 400);

    const reopened = await call(app.baseUrl, `${PULLS}/1/reopen`, {
      method: "POST",
      cookie: author,
    });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.pullRequest.status, "open");
    assert.deepEqual(
      reopened.body.events.map((event) => event.type),
      ["created", "commented", "closed", "reopened"],
    );
    assert.equal(reopened.body.canClose, true);
    assert.equal(reopened.body.canReopen, false);

    const stored = await storedState(app);
    assert.equal(JSON.stringify(stored.branches), branchesBefore);

    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, `${PULLS}/1`);
    assert.equal(reloaded.body.pullRequest.status, "open");
    assert.deepEqual(
      reloaded.body.events.map((event) => event.type),
      ["created", "commented", "closed", "reopened"],
    );
  });
});

test("Merged is terminal: the server refuses to close or reopen it", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const merged = await call(app.baseUrl, `${PULLS}/6/merge`, { method: "POST", cookie });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.status, "merged");
    assert.equal(merged.body.canClose, false);
    assert.equal(merged.body.canReopen, false);

    const before = await stateSnapshot(app);
    const close = await call(app.baseUrl, `${PULLS}/6/close`, { method: "POST", cookie });
    assert.equal(close.status, 400);
    const reopen = await call(app.baseUrl, `${PULLS}/6/reopen`, { method: "POST", cookie });
    assert.equal(reopen.status, 400);
    assert.equal(await stateSnapshot(app), before);
  });
});
