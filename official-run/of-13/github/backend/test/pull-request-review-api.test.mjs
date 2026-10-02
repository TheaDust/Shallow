// REQ-6-3-1 / REQ-6-3-2 / REQ-6-3-3 / REQ-6-3-4: the read view of one pull
// request (Conversation, Commits, Files changed, Checks), the aggregate diff,
// the inline review comment anchored to a changed line and the review decision
// of a collaborator.
//
// The stored records always come from the trusted state: a read never writes a
// comment, a review, a branch or a commit, an inline comment of `Start a
// review` stays private to its author until the review is submitted, and a
// refused request leaves no partial record behind.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };
const BOB = { username: "bob-reviewer", password: "Valid-password-123!" };
const REPOSITORY = "/api/repositories/acme-demo/acme-docs";
const PULLS = `${REPOSITORY}/pulls`;
const DISCUSSED_PULL = `${PULLS}/1`;
const FILTER_PULL = `${PULLS}/4`;
const RANKING_PULL = `${PULLS}/5`;

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

/** Grants one account a role on `acme-docs`, replacing any earlier grant. */
async function grant(app, cookie, role) {
  const response = await call(app.baseUrl, `${REPOSITORY}/access`, {
    method: "PUT",
    cookie,
    body: { subjectType: "account", subjectName: "bob-reviewer", role },
  });
  assert.equal(response.status, 200);
}

async function stateSnapshot(app) {
  try {
    return await readFile(join(app.dataDir, "state.json"), "utf8");
  } catch {
    return null;
  }
}

test("the public pull request carries its comparison, discussion and check", async () => {
  await withApp(async (app) => {
    const before = await stateSnapshot(app);
    const detail = await call(app.baseUrl, DISCUSSED_PULL);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.pullRequest.title, "Improve onboarding");
    assert.equal(detail.body.pullRequest.status, "open");
    assert.equal(detail.body.pullRequest.sourceBranch, "release");
    assert.equal(detail.body.pullRequest.targetBranch, "main");

    // Conversation: the stored description and the discussion comment.
    assert.equal(detail.body.pullRequest.description, "Document the onboarding improvement.");
    assert.equal(detail.body.comments.length, 1);
    const comment = detail.body.comments[0];
    assert.equal(comment.author, "bob-reviewer");
    assert.equal(comment.path, null);
    assert.equal(comment.line, null);
    assert.equal(comment.pending, false);

    // Commits: the comparable commit of the compare branch relative to base.
    assert.equal(detail.body.comparison.commitCount, 1);
    assert.deepEqual(
      detail.body.comparison.commits.map((entry) => entry.message),
      ["Prepare release"],
    );

    // Files changed: one added file and the modified `src/search.ts`.
    assert.equal(detail.body.comparison.changedFileCount, 2);
    assert.equal(detail.body.comparison.additions, 3);
    assert.equal(detail.body.comparison.deletions, 1);
    assert.deepEqual(
      detail.body.comparison.files.map((file) => `${file.status}:${file.path}`),
      ["added:RELEASE.md", "modified:src/search.ts"],
    );

    // Checks: the `test` check of the current compare commit.
    assert.deepEqual(
      detail.body.checks.map((check) => `${check.name}:${check.status}`),
      ["test:pending"],
    );
    // The check belongs to the current compare commit of the record.
    assert.equal(
      detail.body.checks[0].commitId,
      detail.body.pullRequest.compareCommit.id,

    );

    // Reading never wrote a comment, a review or a branch.
    assert.equal(await stateSnapshot(app), before);
  });
});

test("every seeded Open pull request shows the same known changed file", async () => {
  await withApp(async (app) => {
    for (const [path, number] of [
      [DISCUSSED_PULL, 1],
      [FILTER_PULL, 4],
      [RANKING_PULL, 5],
    ]) {
      const detail = await call(app.baseUrl, path);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.pullRequest.status, "open");
      assert.equal(detail.body.pullRequest.number, number);
      const paths = detail.body.comparison.files.map((file) => file.path);
      assert.ok(paths.includes("src/search.ts"));
      const searchFile = detail.body.comparison.files.find(
        (file) => file.path === "src/search.ts",
      );
      assert.equal(searchFile.status, "modified");
      assert.equal(detail.body.comparison.additions, 3);
      assert.equal(detail.body.comparison.deletions, 1);
    }
  });
});

test("a Write reviewer publishes an inline comment anchored to a changed line", async () => {
  await withApp(async (app) => {
    const visitor = await call(app.baseUrl, `${DISCUSSED_PULL}/comments`, {
      method: "POST",
      body: { body: "Nope", path: "src/search.ts", line: 4 },
    });
    assert.equal(visitor.status, 401);

    const cookie = await signIn(app, BOB);
    const before = await stateSnapshot(app);

    // An empty body, an unknown path and a context line store nothing.
    const blank = await call(app.baseUrl, `${DISCUSSED_PULL}/comments`, {
      method: "POST",
      cookie,
      body: { body: "   ", path: "src/search.ts", line: 4 },
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.fieldErrors.body, "Comment is required");

    const unknownPath = await call(app.baseUrl, `${DISCUSSED_PULL}/comments`, {
      method: "POST",
      cookie,
      body: { body: "Off file", path: "docs/search.md", line: 1 },
    });
    assert.equal(unknownPath.status, 400);
    assert.ok(unknownPath.body.fieldErrors.path);
    assert.equal(unknownPath.body.pullRequest, undefined);

    const contextLine = await call(app.baseUrl, `${DISCUSSED_PULL}/comments`, {
      method: "POST",
      cookie,
      body: { body: "Not a changed line", path: "src/search.ts", line: 1 },
    });
    assert.equal(contextLine.status, 400);
    assert.ok(contextLine.body.fieldErrors.line);

    const reloadAfterFailures = await call(app.baseUrl, DISCUSSED_PULL);
    assert.equal(reloadAfterFailures.body.comments.length, 1);

    // The published comment is anchored to the pull request, the current
    // compare commit, the file and the changed line.
    const created = await call(app.baseUrl, `${DISCUSSED_PULL}/comments`, {
      method: "POST",
      cookie,
      body: { body: "  The trimmed query should be reused.  ", path: "src/search.ts", line: 4 },
    });
    assert.equal(created.status, 201);
    const published = created.body.comments.at(-1);
    assert.equal(published.body, "The trimmed query should be reused.");
    assert.equal(published.author, "bob-reviewer");
    assert.equal(published.path, "src/search.ts");
    assert.equal(published.line, 4);
    assert.equal(published.pending, false);
    assert.equal(published.outdated, false);
    assert.equal(published.commitId, created.body.pullRequest.compareCommit.id);
    assert.equal(created.body.events.at(-1).type, "commented");

    // Every reader sees it after a reload, including a visitor.
    const reloaded = await call(app.baseUrl, DISCUSSED_PULL);
    assert.equal(reloaded.body.comments.length, 2);
    assert.equal(reloaded.body.comments.at(-1).body, "The trimmed query should be reused.");
    assert.notEqual(await stateSnapshot(app), before);

    // A Read collaborator may read the diff but never comment on it.
    const aliceCookie = await signIn(app, ALICE);
    await grant(app, aliceCookie, "read");
    const readOnly = await call(app.baseUrl, `${DISCUSSED_PULL}/comments`, {
      method: "POST",
      cookie,
      body: { body: "Read attempt", path: "src/search.ts", line: 4 },
    });
    assert.equal(readOnly.status, 403);
    assert.equal(readOnly.body.error, "Access denied");
  });
});

test("Start a review keeps the inline comment pending until the review is submitted", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, BOB);
    const pending = await call(app.baseUrl, `${FILTER_PULL}/comments`, {
      method: "POST",
      cookie,
      body: {
        body: "Please reuse the filtered query.",
        path: "src/search.ts",
        line: 4,
        pending: true,
      },
    });
    assert.equal(pending.status, 201);
    const draft = pending.body.comments.at(-1);
    assert.equal(draft.pending, true);
    assert.equal(draft.author, "bob-reviewer");
    assert.equal(draft.path, "src/search.ts");

    // The draft is public to nobody but its author: a visitor and the author
    // of the pull request do not see it at all.
    const visitor = await call(app.baseUrl, FILTER_PULL);
    assert.equal(visitor.body.comments.filter((entry) => entry.body === draft.body).length, 0);
    const aliceCookie = await signIn(app, ALICE);
    const author = await call(app.baseUrl, FILTER_PULL, { cookie: aliceCookie });
    assert.equal(author.body.comments.filter((entry) => entry.body === draft.body).length, 0);
    assert.equal(
      author.body.events.filter((event) => event.type === "commented").length,
      0,
    );

    // It stays pending after a restart of the application.
    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, FILTER_PULL, { cookie });
    const kept = reloaded.body.comments.find((entry) => entry.body === draft.body);
    assert.ok(kept);
    assert.equal(kept.pending, true);

    // Submitting the review publishes the draft of that reviewer.
    const review = await call(baseUrl, `${FILTER_PULL}/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "comment", body: "One inline note." },
    });
    assert.equal(review.status, 201);
    const publicComment = review.body.comments.find((entry) => entry.body === draft.body);
    assert.equal(publicComment.pending, false);
    assert.ok(review.body.events.some((event) => event.type === "commented"));

    const afterReview = await call(baseUrl, FILTER_PULL);
    assert.equal(
      afterReview.body.comments.filter((entry) => entry.body === draft.body).length,
      1,
    );
  });
});

test("a review decision is stored, replaced and read back", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, BOB);

    const visitor = await call(app.baseUrl, `${FILTER_PULL}/reviews`, {
      method: "POST",
      body: { decision: "approve" },
    });
    assert.equal(visitor.status, 401);

    // The author of the pull request never reviews it.
    const aliceCookie = await signIn(app, ALICE);
    const author = await call(app.baseUrl, `${FILTER_PULL}/reviews`, {
      method: "POST",
      cookie: aliceCookie,
      body: { decision: "approve" },
    });
    assert.equal(author.status, 403);

    // Approving without a summary is valid.
    const approved = await call(app.baseUrl, `${FILTER_PULL}/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "approve" },
    });
    assert.equal(approved.status, 201);
    assert.equal(approved.body.pullRequest.reviewStatus, "approved");
    const decision = approved.body.reviews.at(-1);
    assert.equal(decision.reviewer, "bob-reviewer");
    assert.equal(decision.decision, "approved");
    assert.equal(decision.body, "");
    assert.equal(decision.stale, false);
    assert.equal(decision.commitId, approved.body.pullRequest.compareCommit.id);

    // The decision survives a restart of the application.
    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, FILTER_PULL);
    assert.equal(reloaded.body.pullRequest.reviewStatus, "approved");
    assert.equal(reloaded.body.reviews.length, 1);

    // Request changes with a summary replaces the effective decision and keeps
    // the earlier record in the timeline.
    const requested = await call(baseUrl, `${FILTER_PULL}/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "request_changes", body: "Reuse the filtered query." },
    });
    assert.equal(requested.status, 201);
    assert.equal(requested.body.pullRequest.reviewStatus, "changes_requested");
    assert.equal(requested.body.reviews.length, 2);
    assert.equal(requested.body.reviews[0].superseded, true);
    const effective = requested.body.reviews[1];
    assert.equal(effective.decision, "changes_requested");
    assert.equal(effective.body, "Reuse the filtered query.");
    assert.equal(effective.superseded, false);

    // `Request changes` blocks the merge of the current compare commit.
    const blockedMerge = await call(baseUrl, `${FILTER_PULL}/merge`, {
      method: "POST",
      cookie: aliceCookie,
    });
    assert.equal(blockedMerge.status, 400);
    assert.ok(blockedMerge.body.fieldErrors.merge);

    // A new decision of the same reviewer replaces it again, so the pull
    // request no longer carries an effective request for changes.
    const commented = await call(baseUrl, `${FILTER_PULL}/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "comment", body: "Checked the filter." },
    });
    assert.equal(commented.status, 201);
    assert.equal(commented.body.pullRequest.reviewStatus, "review_required");
    assert.equal(commented.body.reviews.length, 3);
    assert.deepEqual(
      commented.body.reviews.map((review) => review.superseded),
      [true, true, false],
    );

    // The target branch of this record is the protected `main`, so the merge
    // still waits for the enabled check requirement of the branch protection
    // rule; the review decision alone never merges it.
    const blocked = await call(baseUrl, `${FILTER_PULL}/merge`, {
      method: "POST",
      cookie: aliceCookie,
    });
    assert.equal(blocked.status, 400);
    assert.ok(blocked.body.fieldErrors.merge);
    assert.equal(blocked.body.pullRequest, undefined);

    // Once the Admin stores the successful `test` status and the reviewer
    // approves the same compare commit again, every condition of the protected
    // target branch holds and the merge goes through.
    const checked = await call(baseUrl, `${FILTER_PULL}/checks`, {
      method: "POST",
      cookie: aliceCookie,
      body: { name: "test", status: "success" },
    });
    assert.equal(checked.status, 200);
    assert.equal(checked.body.checks[0].status, "success");
    assert.equal(checked.body.checks[0].updatedBy, "alice-dev");

    const approvedAgain = await call(baseUrl, `${FILTER_PULL}/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "approve" },
    });
    assert.equal(approvedAgain.status, 201);
    assert.equal(approvedAgain.body.pullRequest.reviewStatus, "approved");

    const merged = await call(baseUrl, `${FILTER_PULL}/merge`, {
      method: "POST",
      cookie: aliceCookie,
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.status, "merged");
  });
});

test("a Draft pull request accepts no review submission and a decision needs a choice", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, BOB);
    const before = await stateSnapshot(app);

    const draft = await call(app.baseUrl, `${PULLS}/3/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "approve" },
    });
    assert.equal(draft.status, 400);
    assert.ok(draft.body.fieldErrors.status);
    assert.equal(draft.body.reviews, undefined);

    const undecided = await call(app.baseUrl, `${RANKING_PULL}/reviews`, {
      method: "POST",
      cookie,
      body: { body: "No choice" },
    });
    assert.equal(undecided.status, 400);
    assert.ok(undecided.body.fieldErrors.decision);

    const unknown = await call(app.baseUrl, `${PULLS}/99/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "approve" },
    });
    assert.equal(unknown.status, 404);

    const reloaded = await call(app.baseUrl, RANKING_PULL);
    assert.deepEqual(reloaded.body.reviews, []);
    // No refused submission stored a partial review or touched the state.
    assert.equal(await stateSnapshot(app), before);

    // The stored draft of `Improve onboarding` is untouched by all of this.
    const draftPull = await call(app.baseUrl, `${PULLS}/3`);
    assert.equal(draftPull.body.pullRequest.status, "draft");
  });
});
