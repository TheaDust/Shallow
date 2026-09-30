import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(dataDir) {
  const handler = createApp({ dataDir, staticRoot: join(dataDir, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function newDataDir() {
  return mkdtemp(join(tmpdir(), "shallowcode-pulls-"));
}

function jsonRequest(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(baseUrl, identifier) {
  const response = await jsonRequest(baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier, password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

/**
 * A signed-in account without any role on the seeded repositories. Every seeded
 * account collaborates on `alice-dev/acme-docs` (`alice-dev` owns it, and
 * `bob-reviewer` and `carol-dev` hold a Write grant, REQ-6), so a case that needs
 * a viewer outside the collaborator scope registers its own account.
 */
let outsiderCount = 0;
async function signInOutsider(baseUrl) {
  outsiderCount += 1;
  const username = `pw-outsider-${outsiderCount}`;
  const registered = await jsonRequest(baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username,
      email: `${username}@example.test`,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(registered.status, 201);
  return { cookie: await signIn(baseUrl, username), username };
}

const ACME = "/api/repositories/alice-dev/acme-docs";

test("the seeded pull request list is public and carries every record", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const response = await jsonRequest(app.baseUrl, `${ACME}/pulls`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.repository.fullName, "alice-dev/acme-docs");
  assert.deepEqual(
    payload.pullRequests.map((pullRequest) => [
      pullRequest.number,
      pullRequest.title,
      pullRequest.status,
      pullRequest.author,
      pullRequest.compareBranch,
      pullRequest.baseBranch,
    ]),
    [
      // The blocked merge seed of the same comparison (REQ-6-5) and the
      // dedicated ready-for-review seed of REQ-6-2-4 are separate records of
      // the list and filter scenarios.
      [4, "Add search flow notes", "open", "carol-dev", "feature-search", "main"],
      [3, "Draft onboarding update", "draft", "carol-dev", "draft-feature", "main"],
      [2, "Fix search", "open", "alice-dev", "feature-search", "main"],
      [1, "Improve onboarding", "closed", "alice-dev", "feature-search", "main"],
    ],
  );

  // A reader of another repository only sees that repository's records.
  const other = await jsonRequest(app.baseUrl, "/api/repositories/bob-reviewer/bob-notes/pulls");
  assert.equal(other.status, 200);
  assert.deepEqual((await other.json()).pullRequests, []);

  const unknown = await jsonRequest(app.baseUrl, "/api/repositories/nobody/nothing/pulls");
  assert.equal(unknown.status, 404);
});

test("the comparison before creation derives commits and changed files read-only", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const comparison = await jsonRequest(
    app.baseUrl,
    `${ACME}/pulls/compare?base=main&compare=feature-search`,
  );
  assert.equal(comparison.status, 200);
  const payload = await comparison.json();
  assert.equal(payload.base.name, "main");
  assert.equal(payload.compare.name, "feature-search");
  assert.equal(payload.sameBranch, false);
  assert.equal(payload.commitCount, 1);
  // The seeded comparison of the pull requests: one added file and one modified
  // file, the known changed-file path `src/search.ts` among them (REQ-6-3-2).
  assert.deepEqual(
    payload.changedFiles.map((file) => [file.path, file.changeType, file.additions, file.deletions]),
    [
      ["main-only.md", "added", 3, 0],
      ["src/search.ts", "modified", 0, 1],
    ],
  );
  assert.equal(payload.filesChanged, 2);
  assert.equal(payload.additions, 3);
  assert.equal(payload.deletions, 1);
  assert.ok(payload.filesChanged > 0);
  assert.equal(payload.canCreate, false, "a visitor may not enter the creation flow");

  const writer = await jsonRequest(
    app.baseUrl,
    `${ACME}/pulls/compare?base=main&compare=feature-search`,
    { cookie: alice },
  );
  assert.equal((await writer.json()).canCreate, true);

  // The same branch on both sides explains the empty comparison without storing
  // anything; a branch that is not ahead cannot be created from either.
  const same = await jsonRequest(app.baseUrl, `${ACME}/pulls/compare?base=main&compare=main`, {
    cookie: alice,
  });
  const samePayload = await same.json();
  assert.equal(samePayload.sameBranch, true);
  assert.equal(samePayload.commitCount, 0);
  assert.deepEqual(samePayload.changedFiles, []);
  assert.equal(samePayload.canCreate, false);

  const behind = await jsonRequest(
    app.baseUrl,
    `${ACME}/pulls/compare?base=main&compare=release`,
    { cookie: alice },
  );
  assert.equal((await behind.json()).canCreate, false);

  const unknownBranch = await jsonRequest(
    app.baseUrl,
    `${ACME}/pulls/compare?base=main&compare=nope`,
    { cookie: alice },
  );
  assert.equal(unknownBranch.status, 404);

  // Comparing stores nothing.
  const list = await jsonRequest(app.baseUrl, `${ACME}/pulls`);
  assert.equal((await list.json()).pullRequests.length, 4);
});

test("creating a pull request stores the branches and opens its detail page", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const created = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "main" },
  });
  assert.equal(created.status, 201);
  const { pullRequest } = await created.json();
  assert.equal(pullRequest.number, 5);
  assert.equal(pullRequest.status, "open");
  assert.equal(pullRequest.baseBranch, "release");
  assert.equal(pullRequest.compareBranch, "main");
  assert.equal(pullRequest.author, "alice-dev");
  assert.equal(pullRequest.title, "Add search loader");
  assert.equal(pullRequest.commitCount, 1);
  assert.ok(pullRequest.changedFiles.some((file) => file.path === "src/search.ts"));

  // The stored record is read back by number and by the list.
  const reread = await jsonRequest(app.baseUrl, `${ACME}/pulls/5`);
  assert.equal(reread.status, 200);
  assert.equal((await reread.json()).pullRequest.number, 5);

  const draft = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "main", compare: "release", draft: true },
  });
  assert.equal(draft.status, 400, "a branch that is not ahead cannot be created from");

  const secondDraft = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "feature-search", draft: true },
  });
  assert.equal(secondDraft.status, 201);
  assert.equal((await secondDraft.json()).pullRequest.status, "draft");
});

test("a creation requires a trimmed title of at most 256 characters", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const statuses = async () =>
    (await (await jsonRequest(app.baseUrl, `${ACME}/pulls`)).json()).pullRequests.map(
      (pullRequest) => pullRequest.number,
    );
  const before = await statuses();

  // A title of only spaces is empty after trimming: it creates nothing.
  const blank = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "main", title: "   " },
  });
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).fields.title, "Title is required");

  const empty = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "main", title: "" },
  });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).fields.title, "Title is required");

  const overlong = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "main", title: "t".repeat(257) },
  });
  assert.equal(overlong.status, 400);
  assert.equal(
    (await overlong.json()).fields.title,
    "Title is too long (256 characters maximum)",
  );

  // A refused creation allocates no number and leaves no record behind.
  assert.deepEqual(await statuses(), before);

  // 256 characters are accepted and the stored title keeps the trimmed value.
  const accepted = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "main", title: `  ${"t".repeat(256)}  ` },
  });
  assert.equal(accepted.status, 201);
  const { pullRequest } = await accepted.json();
  assert.equal(pullRequest.number, before.length + 1);
  assert.equal(pullRequest.title, "t".repeat(256));
  assert.equal(pullRequest.status, "open");
  assert.equal(pullRequest.author, "alice-dev");
  assert.equal(pullRequest.baseBranch, "release");
  assert.equal(pullRequest.compareBranch, "main");
  assert.equal(pullRequest.compareCommit.id, pullRequest.currentCompareCommitId);
  assert.equal(pullRequest.creationBaseCommitId, pullRequest.baseCommit.id);
  assert.equal(pullRequest.activities.length, 1);
  assert.equal(pullRequest.activities[0].type, "created");
});

test("an overlong description is refused without a record", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const before = (await (await jsonRequest(app.baseUrl, `${ACME}/pulls`)).json()).pullRequests
    .length;

  const refused = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: {
      base: "release",
      compare: "main",
      title: "Too long",
      description: "d".repeat(65_537),
    },
  });
  assert.equal(refused.status, 400);
  assert.equal(
    (await refused.json()).fields.description,
    "Description is too long (65536 characters maximum)",
  );
  assert.equal(
    (await (await jsonRequest(app.baseUrl, `${ACME}/pulls`)).json()).pullRequests.length,
    before,
  );

  const accepted = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: {
      base: "release",
      compare: "main",
      title: "Long but fitting",
      description: "d".repeat(65_536),
    },
  });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).pullRequest.description.length, 65_536);
});

test("a refused creation leaves no record", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  // A signed-in account without any role on this repository may not create one.
  const outsider = await signInOutsider(app.baseUrl);

  const same = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "main", compare: "main" },
  });
  assert.equal(same.status, 400);

  const duplicate = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "main", compare: "feature-search" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(
    (await duplicate.json()).fields.compare,
    "A pull request already exists for these branches",
  );

  const noCommits = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "main", compare: "release" },
  });
  assert.equal(noCommits.status, 400);

  // A signed-in account without a role may not create one.
  const forbidden = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: outsider.cookie,
    body: { base: "release", compare: "main" },
  });
  assert.equal(forbidden.status, 403);

  const anonymous = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    body: { base: "release", compare: "main" },
  });
  assert.equal(anonymous.status, 401);

  const list = await jsonRequest(app.baseUrl, `${ACME}/pulls`);
  assert.deepEqual(
    (await list.json()).pullRequests.map((pullRequest) => pullRequest.number),
    [4, 3, 2, 1],
  );
});

test("only a repository admin stores the test result of the current compare commit", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const carol = await signIn(app.baseUrl, "carol-dev");
  const bob = await signIn(app.baseUrl, "bob-reviewer");

  // `Fix search` carries the seeded successful result of the eligible merge seed
  // (REQ-6-5); the second Open proposal of the same comparison starts without a
  // stored result and drives the update flow below.
  const seeded = await jsonRequest(app.baseUrl, `${ACME}/pulls/2`, { cookie: bob });
  const seededCheck = (await seeded.json()).pullRequest.checks[0];
  assert.equal(seededCheck.name, "test");
  assert.equal(seededCheck.status, "success");
  assert.equal(seededCheck.setBy, "alice-dev");

  const initial = await jsonRequest(app.baseUrl, `${ACME}/pulls/4`, { cookie: bob });
  const initialChecks = (await initial.json()).pullRequest.checks;
  assert.deepEqual(
    initialChecks.map((check) => [check.name, check.status, check.setBy, check.setAt]),
    [["test", "pending", null, null]],
  );

  for (const cookie of [carol, bob]) {
    const refused = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/checks`, {
      method: "POST",
      cookie,
      body: { status: "success" },
    });
    assert.equal(refused.status, 403);
  }

  const unknown = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/checks`, {
    method: "POST",
    cookie: alice,
    body: { status: "green" },
  });
  assert.equal(unknown.status, 400);

  const saved = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/checks`, {
    method: "POST",
    cookie: alice,
    body: { status: "success" },
  });
  assert.equal(saved.status, 200);
  const check = (await saved.json()).pullRequest.checks[0];
  assert.equal(check.status, "success");
  assert.equal(check.setBy, "alice-dev");
  assert.ok(check.setAt);
  assert.equal(check.commitId, "8a7b6c5d4e3f2a1908b7c6d5e4f3a2b190807162");

  // A second read of the same commit keeps the stored result.
  const reread = await jsonRequest(app.baseUrl, `${ACME}/pulls/4`);
  assert.equal((await reread.json()).pullRequest.checks[0].status, "success");

  // A new commit on the compare branch moves the current compare commit, so the
  // new commit reads as pending and the stored result stays with the old one.
  const commit = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: {
      branch: "feature-search",
      path: "notes/follow-up.md",
      content: "# Follow up\n",
      message: "Follow up the search notes",
    },
  });
  assert.equal(commit.status, 201);

  const moved = await jsonRequest(app.baseUrl, `${ACME}/pulls/4`);
  const movedPayload = (await moved.json()).pullRequest;
  assert.notEqual(movedPayload.checks[0].commitId, check.commitId);
  assert.equal(movedPayload.checks[0].status, "pending");
  assert.equal(movedPayload.checks[0].setBy, null);
  assert.equal(movedPayload.commitCount, 2);
});

test("status transitions follow the required rules and merged is terminal", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const carol = await signIn(app.baseUrl, "carol-dev");

  const draft = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "feature-search", draft: true },
  });
  const draftNumber = (await draft.json()).pullRequest.number;

  // The author marks the draft ready for review.
  const ready = await jsonRequest(app.baseUrl, `${ACME}/pulls/${draftNumber}/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "open" },
  });
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).pullRequest.status, "open");

  // A writer who is neither the author nor a maintainer may not close it.
  const refused = await jsonRequest(app.baseUrl, `${ACME}/pulls/${draftNumber}/status`, {
    method: "POST",
    cookie: carol,
    body: { status: "closed" },
  });
  assert.equal(refused.status, 403);

  const closed = await jsonRequest(app.baseUrl, `${ACME}/pulls/${draftNumber}/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "closed" },
  });
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).pullRequest.status, "closed");

  const reopened = await jsonRequest(app.baseUrl, `${ACME}/pulls/${draftNumber}/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "open" },
  });
  assert.equal((await reopened.json()).pullRequest.status, "open");

  const unknownStatus = await jsonRequest(app.baseUrl, `${ACME}/pulls/${draftNumber}/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "ready" },
  });
  assert.equal(unknownStatus.status, 400);
});

test("comments, reviews and requested reviewers are stored with the compare commit", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const carol = await signIn(app.baseUrl, "carol-dev");
  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const outsider = await signInOutsider(app.baseUrl);

  const comment = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/comments`, {
    method: "POST",
    cookie: carol,
    body: { body: "Please add a regression test." },
  });
  assert.equal(comment.status, 201);
  const body = (await comment.json()).pullRequest;
  assert.deepEqual(
    body.comments.map((entry) => [entry.author, entry.body]),
    [["carol-dev", "Please add a regression test."]],
  );

  const empty = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/comments`, {
    method: "POST",
    cookie: carol,
    body: { body: "   " },
  });
  assert.equal(empty.status, 400);

  // An account without a role on the repository writes nothing.
  const readOnly = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/comments`, {
    method: "POST",
    cookie: outsider.cookie,
    body: { body: "not allowed" },
  });
  assert.equal(readOnly.status, 403);

  // Requesting reviewers needs the author or a maintainer.
  const requested = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/reviewers`, {
    method: "POST",
    cookie: bob,
    body: { username: "bob-reviewer" },
  });
  assert.equal(requested.status, 403);
  const byAuthor = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/reviewers`, {
    method: "POST",
    cookie: carol,
    body: { username: "bob-reviewer" },
  });
  assert.equal(byAuthor.status, 201);
  assert.deepEqual((await byAuthor.json()).pullRequest.requestedReviewers, ["bob-reviewer"]);

  // A review decision counts for the current compare commit; a second decision
  // of the same reviewer replaces the previous one for that commit.
  const approve = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/reviews`, {
    method: "POST",
    cookie: bob,
    body: { decision: "approve" },
  });
  assert.equal(approve.status, 201);
  const changed = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/reviews`, {
    method: "POST",
    cookie: bob,
    body: { decision: "request_changes", body: "One nit." },
  });
  assert.equal(changed.status, 201);
  const reviews = (await changed.json()).pullRequest.reviews;
  assert.equal(reviews.length, 2);
  assert.deepEqual(
    reviews.map((review) => [review.reviewer, review.decision]),
    [
      ["bob-reviewer", "approve"],
      ["bob-reviewer", "request_changes"],
    ],
  );

  const unknown = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/reviews`, {
    method: "POST",
    cookie: bob,
    body: { decision: "reject" },
  });
  assert.equal(unknown.status, 400);

  // The stored decision belongs to the compare commit it was made on: a new
  // commit makes it stale while the record stays in the timeline.
  await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: {
      branch: "feature-search",
      path: "notes/review-follow-up.md",
      content: "# Follow up\n",
      message: "Follow up after the review",
    },
  });
  const moved = await jsonRequest(app.baseUrl, `${ACME}/pulls/4`);
  const movedReviews = (await moved.json()).pullRequest.reviews;
  assert.equal(movedReviews.length, 2);
  assert.ok(movedReviews.every((review) => review.stale === true));
});

test("a protection rule decides merge eligibility and only a maintainer may merge", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const carol = await signIn(app.baseUrl, "carol-dev");
  const bob = await signIn(app.baseUrl, "bob-reviewer");

  // The seed protects `main` and stores the `test` result of the eligible merge
  // seed, so the blocked proposal of the same comparison shows what is missing.
  const protectedRule = await jsonRequest(app.baseUrl, `${ACME}/branch-protection`);
  assert.deepEqual(
    (await protectedRule.json()).rules.map((rule) => [
      rule.branchName,
      rule.requireApproval,
      rule.requireStatusCheck,
    ]),
    [["main", true, true]],
  );

  const before = await jsonRequest(app.baseUrl, `${ACME}/pulls/4`);
  const beforeMergeability = (await before.json()).pullRequest.mergeability;
  assert.equal(beforeMergeability.mergeable, false);
  assert.equal(beforeMergeability.protectedBranch, true);
  assert.deepEqual(beforeMergeability.conflicts, []);
  assert.ok(beforeMergeability.reasons.includes("Review required by branch protection"));
  assert.equal(beforeMergeability.reasons.length, 2);
  assert.deepEqual(
    beforeMergeability.conditions.map((condition) => [condition.id, condition.satisfied]),
    [
      ["open", true],
      ["approval", false],
      ["check", false],
      ["review", true],
      ["conflicts", true],
    ],
  );

  // A writer who may not maintain the repository cannot merge either.
  const refusedMerge = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/merge`, {
    method: "POST",
    cookie: bob,
    body: { method: "merge" },
  });
  assert.equal(refusedMerge.status, 403);

  // The check succeeds, but the missing non-author approval still blocks.
  await jsonRequest(app.baseUrl, `${ACME}/pulls/4/checks`, {
    method: "POST",
    cookie: alice,
    body: { status: "success" },
  });
  const stillBlocked = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/merge`, {
    method: "POST",
    cookie: alice,
    body: { method: "merge" },
  });
  assert.equal(stillBlocked.status, 400);
  assert.equal((await stillBlocked.json()).fields.status, "Review required by branch protection");

  // The author cannot satisfy the approval requirement with their own review.
  await jsonRequest(app.baseUrl, `${ACME}/pulls/4/reviews`, {
    method: "POST",
    cookie: carol,
    body: { decision: "approve" },
  });
  const selfApproval = await jsonRequest(app.baseUrl, `${ACME}/pulls/4`, { cookie: alice });
  assert.equal((await selfApproval.json()).pullRequest.mergeability.mergeable, false);

  // A valid non-author approval satisfies the rule, so the merge is applied to
  // the base branch and the pull request becomes terminal.
  await jsonRequest(app.baseUrl, `${ACME}/pulls/4/reviews`, {
    method: "POST",
    cookie: bob,
    body: { decision: "approve" },
  });
  const eligible = await jsonRequest(app.baseUrl, `${ACME}/pulls/4`, { cookie: alice });
  const eligiblePayload = (await eligible.json()).pullRequest;
  assert.equal(eligiblePayload.mergeability.mergeable, true);
  assert.deepEqual(eligiblePayload.mergeability.reasons, []);
  assert.ok(eligiblePayload.mergeability.conditions.every((condition) => condition.satisfied));

  const merged = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/merge`, {
    method: "POST",
    cookie: alice,
    body: { method: "merge" },
  });
  assert.equal(merged.status, 200);
  const mergedPayload = (await merged.json()).pullRequest;
  assert.equal(mergedPayload.status, "merged");
  assert.equal(mergedPayload.merge.by, "alice-dev");
  assert.ok(mergedPayload.merge.at);
  assert.equal(mergedPayload.merge.method, "Create a merge commit");
  assert.ok(mergedPayload.merge.commitId);
  assert.deepEqual(mergedPayload.mergeability.reasons, ["The pull request is already merged."]);

  const overview = await jsonRequest(app.baseUrl, `${ACME}?branch=main`);
  const mainFiles = (await overview.json()).repository.entries.map((entry) => entry.name);
  assert.ok(mainFiles.includes("main-only.md"), "the merge brought the compare content in");

  const terminal = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "closed" },
  });
  assert.equal(terminal.status, 400);
});

test("a draft creation stores a Draft proposal that cannot be reviewed or merged", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const carol = await signIn(app.baseUrl, "carol-dev");

  const created = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: carol,
    body: {
      base: "release",
      compare: "main",
      draft: true,
      title: "Draft search loader",
      description: "First pass for the loader.",
    },
  });
  assert.equal(created.status, 201);
  const { pullRequest } = await created.json();
  assert.equal(pullRequest.status, "draft");
  assert.equal(pullRequest.statusLabel, "Draft");
  assert.equal(pullRequest.title, "Draft search loader");
  assert.equal(pullRequest.description, "First pass for the loader.");
  assert.equal(pullRequest.author, "carol-dev");
  assert.equal(pullRequest.baseBranch, "release");
  assert.equal(pullRequest.compareBranch, "main");
  assert.ok(pullRequest.baseCommit.id, "the creation-time base commit is stored");
  assert.equal(pullRequest.compareCommit.id, pullRequest.currentCompareCommitId);
  assert.equal(pullRequest.creationCompareCommitId, pullRequest.compareCommit.id);
  assert.equal(pullRequest.commitCount, 1);

  // A draft is neither mergeable nor reviewable, and the server refuses both.
  assert.equal(pullRequest.mergeability.mergeable, false);
  assert.equal(pullRequest.permissions.canReview, false);
  const refusedMerge = await jsonRequest(
    app.baseUrl,
    `${ACME}/pulls/${pullRequest.number}/status`,
    { method: "POST", cookie: carol, body: { status: "merged" } },
  );
  assert.equal(refusedMerge.status, 403);
  const refusedReview = await jsonRequest(app.baseUrl, `${ACME}/pulls/${pullRequest.number}/reviews`, {
    method: "POST",
    cookie: carol,
    body: { decision: "approve" },
  });
  assert.equal(refusedReview.status, 403);

  // The refusals left the stored record untouched, and the list shows the Draft
  // status of the same record.
  const stored = await jsonRequest(app.baseUrl, `${ACME}/pulls/${pullRequest.number}`);
  const record = (await stored.json()).pullRequest;
  assert.equal(record.status, "draft");
  assert.equal(record.reviews.length, 0);
  const list = await jsonRequest(app.baseUrl, `${ACME}/pulls`);
  const row = (await list.json()).pullRequests.find((entry) => entry.number === pullRequest.number);
  assert.equal(row.status, "draft");
  assert.equal(row.statusLabel, "Draft");

  // The pair of the seeded draft belongs to the dedicated ready-for-review seed,
  // so a second Draft or Open proposal for it is refused.
  const duplicate = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: carol,
    body: { base: "main", compare: "draft-feature", draft: true, title: "Another draft" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(
    (await duplicate.json()).fields.compare,
    "A pull request already exists for these branches",
  );
});

test("the dedicated seed draft becomes Open for its author and stays Open", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  const carol = await signIn(app.baseUrl, "carol-dev");
  const bob = await signIn(app.baseUrl, "bob-reviewer");

  const seeded = await jsonRequest(app.baseUrl, `${ACME}/pulls/3`, { cookie: carol });
  assert.equal(seeded.status, 200);
  const draft = (await seeded.json()).pullRequest;
  assert.equal(draft.title, "Draft onboarding update");
  assert.equal(draft.status, "draft");
  assert.equal(draft.statusLabel, "Draft");
  assert.equal(draft.author, "carol-dev");
  assert.equal(draft.baseBranch, "main");
  assert.equal(draft.compareBranch, "draft-feature");
  assert.deepEqual(draft.reviews, [], "the seed draft starts without a review");
  assert.equal(draft.permissions.canReview, false);

  // A signed-in reader who is neither the author nor a maintainer cannot mark it
  // ready, and the stored record stays a draft.
  const refused = await jsonRequest(app.baseUrl, `${ACME}/pulls/3/status`, {
    method: "POST",
    cookie: bob,
    body: { status: "open" },
  });
  assert.equal(refused.status, 403);
  const untouched = await jsonRequest(app.baseUrl, `${ACME}/pulls/3`);
  assert.equal((await untouched.json()).pullRequest.status, "draft");

  const ready = await jsonRequest(app.baseUrl, `${ACME}/pulls/3/status`, {
    method: "POST",
    cookie: carol,
    body: { status: "open" },
  });
  assert.equal(ready.status, 200);
  const updated = (await ready.json()).pullRequest;
  assert.equal(updated.number, 3, "the same proposal keeps its number");
  assert.equal(updated.status, "open");
  assert.equal(updated.statusLabel, "Open");
  assert.equal(updated.title, "Draft onboarding update");
  assert.equal(updated.description, draft.description);
  assert.equal(updated.baseBranch, "main");
  assert.equal(updated.compareBranch, "draft-feature");
  assert.equal(updated.compareCommit.id, draft.compareCommit.id);
  assert.equal(updated.baseCommit.id, draft.baseCommit.id);
  assert.deepEqual(
    updated.activities.map((activity) => activity.type),
    ["created", "ready_for_review"],
  );

  // The change is persisted: a restart reads the same Open proposal.
  await app.close();
  const second = await startApp(dataDir);
  t.after(() => second.close());
  const reread = await jsonRequest(second.baseUrl, `${ACME}/pulls/3`, { cookie: bob });
  const afterRestart = (await reread.json()).pullRequest;
  assert.equal(afterRestart.status, "open");
  assert.equal(afterRestart.title, "Draft onboarding update");
  assert.equal(afterRestart.compareBranch, "draft-feature");
});

/**
 * REQ-6-3-1: the detail page of a seeded public Open pull request is the unified
 * read view of that number — its title, description, discussion, comparable
 * commits and changed files come from one stored record and reading it writes
 * nothing.
 */
test("the seeded public pull request reads without sign-in and stays read-only", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const anonymous = await jsonRequest(app.baseUrl, `${ACME}/pulls/2`);
  assert.equal(anonymous.status, 200);
  const { repository, pullRequest } = await anonymous.json();
  assert.equal(repository.fullName, "alice-dev/acme-docs");
  assert.equal(pullRequest.number, 2);
  assert.equal(pullRequest.title, "Fix search");
  assert.equal(pullRequest.status, "open");
  assert.equal(pullRequest.baseBranch, "main");
  assert.equal(pullRequest.compareBranch, "feature-search");
  assert.equal(
    pullRequest.description,
    "Search must read the branch that is currently browsed.",
  );
  assert.deepEqual(
    pullRequest.comments.map((comment) => [comment.author, comment.body]),
    [["bob-reviewer", "The helper looks right; please add a check for the loader."]],
  );
  assert.ok(pullRequest.commitCount >= 1);
  assert.ok(
    pullRequest.commits.some((commit) => commit.message === "Add main-only notes"),
  );
  assert.ok(pullRequest.changedFiles.some((file) => file.changeType === "added"));
  assert.deepEqual(
    pullRequest.changedFiles.map((file) => [file.path, file.changeType]),
    [
      ["main-only.md", "added"],
      ["src/search.ts", "modified"],
    ],
  );
  assert.equal(pullRequest.filesChanged, 2);
  assert.equal(pullRequest.additions, 3);
  assert.equal(pullRequest.deletions, 1);
  assert.equal(pullRequest.checks[0].name, "test");
  // The eligible merge seed stores the successful `test` result of the current
  // compare commit together with the non-author approval (REQ-6-5).
  assert.equal(pullRequest.checks[0].status, "success");
  assert.equal(pullRequest.checks[0].setBy, "alice-dev");
  assert.deepEqual(
    pullRequest.reviews.map((review) => [review.reviewer, review.decision]),
    [["carol-dev", "approve"]],
  );
  assert.equal(pullRequest.mergeability.mergeable, true);
  assert.equal(pullRequest.merge, null);
  assert.equal(pullRequest.permissions.canWrite, false);
  assert.equal(pullRequest.permissions.canMerge, false);

  // The same address reads the same persisted record...
  const repeated = await jsonRequest(app.baseUrl, `${ACME}/pulls/2`);
  assert.deepEqual((await repeated.json()).pullRequest, pullRequest);
  // ...and the read stored nothing: the state file of the seeded application is
  // still absent, so no comment, review, check or status record was written.
  let stored = null;
  try {
    stored = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  } catch (error) {
    assert.equal(error.code, "ENOENT");
  }
  if (stored) {
    const pull = stored.pullRequests.find((record) => record.number === 2);
    assert.equal(pull.status, "open");
    assert.equal(pull.comments.length, 1);
    assert.equal(pull.reviews.length, 1);
  }
});

test("the diff of a private pull request stays unreadable for everyone else", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const SECRET = "/api/repositories/alice-dev/secret-research";
  const alice = await signIn(app.baseUrl, "alice-dev");
  const branch = await jsonRequest(app.baseUrl, `${SECRET}/branches`, {
    method: "POST",
    cookie: alice,
    body: { name: "secret-topic", baseBranch: "main" },
  });
  assert.equal(branch.status, 201);
  const change = await jsonRequest(app.baseUrl, `${SECRET}/file`, {
    method: "POST",
    cookie: alice,
    body: {
      branch: "secret-topic",
      path: "notes/secret.md",
      content: "# Secret\n",
      message: "Write the secret note",
    },
  });
  assert.equal(change.status, 201);
  const created = await jsonRequest(app.baseUrl, `${SECRET}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "main", compare: "secret-topic" },
  });
  assert.equal(created.status, 201);
  const { pullRequest } = await created.json();
  assert.deepEqual(
    pullRequest.changedFiles.map((file) => file.path),
    ["notes/secret.md"],
  );

  // A visitor and a signed-in outsider cannot obtain the persisted proposal or
  // its diff; the collaborator with a Write grant may read it.
  const anonymous = await jsonRequest(app.baseUrl, `${SECRET}/pulls/1`);
  assert.equal(anonymous.status, 404);
  const carol = await signIn(app.baseUrl, "carol-dev");
  const outsider = await jsonRequest(app.baseUrl, `${SECRET}/pulls/1`, { cookie: carol });
  assert.equal(outsider.status, 403);
  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const collaborator = await jsonRequest(app.baseUrl, `${SECRET}/pulls/1`, { cookie: bob });
  assert.equal(collaborator.status, 200);
  assert.ok((await collaborator.json()).pullRequest.changedFiles.length > 0);
});

test("a missing pull request keeps the repository context", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const missing = await jsonRequest(app.baseUrl, `${ACME}/pulls/99`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).repository.fullName, "alice-dev/acme-docs");

  const unknownRepo = await jsonRequest(app.baseUrl, "/api/repositories/nobody/nothing/pulls/1");
  assert.equal(unknownRepo.status, 404);
});
