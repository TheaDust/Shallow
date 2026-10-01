// REQ-6-5: merging an eligible pull request.
//
// Merge is the only write operation that writes the current compare commit's
// changes into the base branch: it creates one merge commit whose parents are
// the target-branch head at merge time and the current compare commit, moves
// the target branch to it and marks the pull request Merged with the merger,
// the time and the resulting commit identifier. Every condition is reread
// inside the same atomic update, so a blocked record changes neither the branch
// nor the record itself.

import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };
const BOB = { username: "bob-reviewer", password: "Valid-password-123!" };
const CAROL = { username: "carol-maintainer", password: "Valid-password-123!" };
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

async function branchHead(app, branch) {
  const history = await call(app.baseUrl, `${REPOSITORY}/commits?branch=${branch}`);
  assert.equal(history.status, 200);
  return history.body.commits[0];
}

test("the eligible record merges with one merge commit and moves the target branch", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const mainBefore = await branchHead(app, "main");
    const sourceBefore = await branchHead(app, "search-fixes");

    const detail = await call(app.baseUrl, `${PULLS}/6`, { cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.canMerge, true);
    assert.equal(detail.body.mergeable, true);
    assert.equal(detail.body.mergeBlocker, null);
    // The merge area displays every condition with its state.
    assert.deepEqual(
      detail.body.mergeConditions.map((condition) => `${condition.id}:${condition.satisfied}`),
      ["changes_requested:true", "approval:true", "status_check:true", "conflicts:true"],
    );
    assert.deepEqual(detail.body.targetProtection, {
      branchName: "main",
      requireApproval: true,
      requireStatusCheck: true,
    });

    const merged = await call(app.baseUrl, `${PULLS}/6/merge`, { method: "POST", cookie });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.status, "merged");
    assert.equal(merged.body.pullRequest.mergedBy, "alice-dev");
    assert.ok(merged.body.pullRequest.mergedAt);
    assert.ok(merged.body.pullRequest.mergeCommitSha);
    assert.equal(merged.body.canMerge, false);
    assert.deepEqual(
      merged.body.events.map((event) => event.type),
      ["created", "reviewed", "merged"],
    );

    // The target branch head moved to the merge commit, whose parents are the
    // target-branch head at merge time and the current compare commit.
    const mainAfter = await branchHead(app, "main");
    assert.notEqual(mainAfter.id, mainBefore.id);
    assert.equal(mainAfter.message, "Merge pull request #6 from search-fixes into main");
    const mergeCommit = await call(app.baseUrl, `${REPOSITORY}/commits/${mainAfter.sha}`);
    assert.equal(mergeCommit.status, 200);
    assert.equal(mergeCommit.body.commit.parentId, mainBefore.id);
    assert.equal(mergeCommit.body.commit.sha, mainAfter.sha);

    // The content of the source branch is integrated: the file the compare
    // branch added is readable on `main` and the modified file carries the
    // compared revision.
    const added = await call(
      app.baseUrl,
      `${REPOSITORY}/blob?branch=main&path=src%2Fmatching.ts`,
    );
    assert.equal(added.status, 200);
    assert.equal(added.body.content, "export const matches = true;\n");
    const modified = await call(
      app.baseUrl,
      `${REPOSITORY}/blob?branch=main&path=src%2Fsearch.ts`,
    );
    assert.match(modified.body.content, /const fixed = query\.trim\(\);/);

    // The compare branch itself is untouched by the merge.
    const sourceAfter = await branchHead(app, "search-fixes");
    assert.equal(sourceAfter.sha, sourceBefore.sha);

    // Merged is terminal and survives a restart.
    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, `${PULLS}/6`);
    assert.equal(reloaded.body.pullRequest.status, "merged");
    assert.equal(reloaded.body.pullRequest.mergeCommitSha, merged.body.pullRequest.mergeCommitSha);
    const reloadedMain = await branchHead(app, "main");
    assert.equal(reloadedMain.id, mainAfter.id);
  });
});

test("a blocked record explains the unmet protection condition and changes nothing", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const mainBefore = await branchHead(app, "main");

    const detail = await call(app.baseUrl, `${PULLS}/7`, { cookie });
    assert.equal(detail.body.canMerge, false);
    assert.equal(detail.body.mergeable, false);
    assert.equal(detail.body.mergeBlocker, "Review required by branch protection");
    assert.deepEqual(
      detail.body.mergeConditions.map((condition) => `${condition.id}:${condition.satisfied}`),
      ["changes_requested:true", "approval:false", "status_check:false", "conflicts:true"],
    );

    const refused = await call(app.baseUrl, `${PULLS}/7/merge`, { method: "POST", cookie });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.fieldErrors.merge, "Review required by branch protection");
    assert.equal(refused.body.pullRequest, undefined);

    const mainAfter = await branchHead(app, "main");
    assert.equal(mainAfter.id, mainBefore.id);
    const reloaded = await call(app.baseUrl, `${PULLS}/7`, { cookie });
    assert.equal(reloaded.body.pullRequest.status, "open");
  });
});

test("a failing check or a valid Request changes keeps the merge blocked", async () => {
  await withApp(async (app) => {
    const reviewerCookie = await signIn(app, BOB);
    const cookie = await signIn(app, ALICE);

    // A valid `Request changes` decision blocks even a record whose approval
    // and check requirements hold.
    const requested = await call(app.baseUrl, `${PULLS}/6/reviews`, {
      method: "POST",
      cookie: reviewerCookie,
      body: { decision: "request_changes", body: "Please adjust the search fix." },
    });
    assert.equal(requested.status, 201);
    assert.equal(requested.body.canMerge, false);
    assert.equal(
      requested.body.mergeConditions[0].satisfied,
      false,
    );
    const blocked = await call(app.baseUrl, `${PULLS}/6/merge`, { method: "POST", cookie });
    assert.equal(blocked.status, 400);
    assert.equal(
      blocked.body.fieldErrors.merge,
      "Changes requested must be resolved before merging",
    );

    // A failed `test` status blocks the check requirement of the rule, and the
    // record becomes mergeable again once the reviewer approves the current
    // compare commit and the check succeeds.
    const approved = await call(app.baseUrl, `${PULLS}/6/reviews`, {
      method: "POST",
      cookie: reviewerCookie,
      body: { decision: "approve" },
    });
    assert.equal(approved.status, 201);
    const failed = await call(app.baseUrl, `${PULLS}/6/checks`, {
      method: "POST",
      cookie,
      body: { name: "test", status: "failure" },
    });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.canMerge, false);
    const refused = await call(app.baseUrl, `${PULLS}/6/merge`, { method: "POST", cookie });
    assert.equal(refused.status, 400);
    assert.match(refused.body.fieldErrors.merge, /check/i);

    const succeeded = await call(app.baseUrl, `${PULLS}/6/checks`, {
      method: "POST",
      cookie,
      body: { name: "test", status: "success" },
    });
    assert.equal(succeeded.status, 200);
    assert.equal(succeeded.body.canMerge, true);
  });
});

test("an unprotected target needs no approval or check success, but no conflicts", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);

    // `release` carries no rule: a Maintain, Admin or Owner merges its Open
    // pull request without an approval or a successful check.
    const created = await call(app.baseUrl, PULLS, {
      method: "POST",
      cookie,
      body: { base: "release", compare: "search-fixes", title: "Ship into release" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.targetProtection, null);
    assert.deepEqual(
      created.body.mergeConditions.map((condition) => condition.id),
      ["changes_requested", "conflicts"],
    );
    assert.equal(created.body.canMerge, true);

    const merged = await call(app.baseUrl, `${PULLS}/${created.body.pullRequest.number}/merge`, {
      method: "POST",
      cookie,
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.status, "merged");
  });

  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);

    // A conflict appears when the target branch moved on and both revisions
    // changed the same file differently: the merge is refused and no branch
    // moves.
    const created = await call(app.baseUrl, PULLS, {
      method: "POST",
      cookie,
      body: { base: "release", compare: "search-fixes", title: "Ship into release" },
    });
    assert.equal(created.status, 201);
    const releaseBefore = await branchHead(app, "release");
    const committed = await call(app.baseUrl, `${REPOSITORY}/files`, {
      method: "POST",
      cookie,
      body: {
        branch: "release",
        path: "src/search.ts",
        previousPath: "src/search.ts",
        content: "export const conflicting = true;\n",
        message: "Change the search source",
      },
    });
    assert.equal(committed.status, 201);

    const detail = await call(app.baseUrl, `${PULLS}/${created.body.pullRequest.number}`, {
      cookie,
    });
    assert.equal(detail.body.canMerge, false);
    assert.match(detail.body.mergeBlocker, /conflict/i);

    const refused = await call(app.baseUrl, `${PULLS}/${created.body.pullRequest.number}/merge`, {
      method: "POST",
      cookie,
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.fieldErrors.merge, /conflict/i);
    const releaseAfter = await branchHead(app, "release");
    assert.equal(releaseAfter.id, committed.body.commit.id);
    assert.notEqual(releaseAfter.id, releaseBefore.id);
  });
});

test("only Maintain, Admin or the organization Owner may merge", async () => {
  await withApp(async (app) => {
    const memberCookie = await signIn(app, BOB);
    const denied = await call(app.baseUrl, `${PULLS}/6/merge`, {
      method: "POST",
      cookie: memberCookie,
    });
    assert.equal(denied.status, 403);

    const maintainerCookie = await signIn(app, CAROL);
    const merged = await call(app.baseUrl, `${PULLS}/6/merge`, {
      method: "POST",
      cookie: maintainerCookie,
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.mergedBy, "carol-maintainer");
  });
});
