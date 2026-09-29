import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAccountsDomain } from "../src/domain/accounts.mjs";
import { createIssuesDomain } from "../src/domain/issues.mjs";
import { createOrganizationsDomain } from "../src/domain/organizations.mjs";
import { createPullsDomain } from "../src/domain/pulls.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function createDomains() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pulls-"));
  const store = createJsonStore(join(directory, "state.json"), {
    accounts: {},
    sessions: {},
    organizations: {},
    memberships: {},
    teams: {},
    teamMembers: {},
    repositories: {},
    grants: {},
    git: {},
    issues: {},
    labels: {},
    milestones: {},
    timelines: {},
    comments: {},
    reactions: {},
    pullRequests: {},
    pullRequestTimelines: {},
    pullRequestComments: {},
    pullRequestReviews: {},
    pullRequestReviewers: {},
    pullRequestChecks: {},
  });
  const accounts = createAccountsDomain(store);
  const organizations = createOrganizationsDomain(store);
  const issues = createIssuesDomain(store);
  const pulls = createPullsDomain(store);
  await accounts.seedIfEmpty();
  await organizations.seedIfEmpty();
  await issues.seedIfEmpty();
  await pulls.seedIfEmpty();
  return { directory, store, accounts, organizations, issues, pulls };
}

test("seed provisions Open, Draft and Closed pull requests with pending test checks on every acme-docs repository", async () => {
  const { store, pulls } = await createDomains();

  for (const repoId of ["acme-demo:acme-docs", "alice-dev:acme-docs"]) {
    const list = await pulls.listPullRequests(repoId.split(":")[0], repoId.split(":")[1], null);
    assert.equal(list.ok, undefined);
    assert.deepEqual(
      list.pulls.map((pull) => pull.title),
      [
        "Merge blocked changes",
        "Merge eligible changes",
        "Search result pagination",
        "Draft onboarding update",
        "Fix search",
        "Improve onboarding",
      ],
    );
    const open = list.pulls.find((pull) => pull.number === 1);
    assert.equal(open.status, "open");
    assert.equal(open.author, "alice-dev");
    assert.equal(open.baseBranch, "main");
    assert.equal(open.compareBranch, "release");
    const closed = list.pulls.find((pull) => pull.number === 2);
    assert.equal(closed.status, "closed");
    const draft = list.pulls.find((pull) => pull.number === 3);
    assert.equal(draft.status, "draft");
    assert.equal(draft.title, "Draft onboarding update");
    assert.equal(draft.compareBranch, "draft-feature");
    const pending = list.pulls.find((pull) => pull.number === 4);
    assert.equal(pending.status, "open");
    assert.equal(pending.author, "carol-dev");
    const eligible = list.pulls.find((pull) => pull.number === 5);
    assert.equal(eligible.status, "open");
    assert.equal(eligible.compareBranch, "merge-ready");
    const blocked = list.pulls.find((pull) => pull.number === 6);
    assert.equal(blocked.status, "open");
    assert.equal(blocked.compareBranch, "merge-blocked");
  }

  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 1, null);
  assert.equal(detail.pull.title, "Improve onboarding");
  assert.equal(detail.pull.status, "open");
  assert.equal(detail.pull.checks.status, "pending");
  assert.equal(detail.pull.checks.setter, null);
  assert.equal(detail.pull.comments.length, 1);
  assert.equal(detail.pull.comments[0].author, "bob-reviewer");
  assert.equal(detail.myRole, null);
  // `main` is protected in the seed (REQ-6-5): the Open PR without approval
  // and with a pending check has two unmet conditions.
  assert.equal(detail.mergeEligibility.eligible, false);
  assert.ok(detail.mergeEligibility.reasons.includes("Review required by branch protection"));
  assert.ok(detail.mergeEligibility.reasons.includes("Required status check test must be successful"));
  assert.deepEqual(detail.mergeEligibility.conditions, [
    { label: "No merge conflicts", satisfied: true },
    { label: "No valid Request changes", satisfied: true },
    { label: "1 approval", satisfied: false },
    { label: "Status check test is success", satisfied: false },
  ]);
  // Commits relative to base are present for the Open PR.
  assert.equal(detail.commits.length, 1);
  assert.equal(detail.commits[0].message, "Prepare release");
  // The public PR diff contains the known changed path and one added file
  // (REQ-6-3-2 aggregate: 3 additions, 1 deletions).
  assert.deepEqual(
    detail.files.files.map((file) => file.path),
    ["release-notes.md", "src/search.ts"],
  );
  assert.equal(detail.files.totalAdditions, 3);
  assert.equal(detail.files.totalDeletions, 1);
  // The dedicated Draft seed PR has no submitted reviews.
  const draftDetail = await pulls.getPullRequest("acme-demo", "acme-docs", 3, null);
  assert.equal(draftDetail.pull.status, "draft");
  assert.equal(draftDetail.pull.title, "Draft onboarding update");
  assert.deepEqual(draftDetail.pull.reviewSummary, []);
  assert.deepEqual(draftDetail.pull.inlineComments, []);

  // REQ-6-5 merge seed states: #5 is eligible (approval + check success,
  // protected main, no conflicts); #6 is blocked by the missing approval only.
  const eligibleDetail = await pulls.getPullRequest("acme-demo", "acme-docs", 5, null);
  assert.equal(eligibleDetail.pull.status, "open");
  assert.equal(eligibleDetail.pull.checks.status, "success");
  assert.deepEqual(
    eligibleDetail.pull.reviewSummary.map((entry) => ({
      reviewer: entry.reviewer,
      decision: entry.decision,
    })),
    [{ reviewer: "bob-reviewer", decision: "approve" }],
  );
  assert.equal(eligibleDetail.mergeEligibility.eligible, true);
  assert.deepEqual(eligibleDetail.mergeEligibility.reasons, []);

  const blockedDetail = await pulls.getPullRequest("acme-demo", "acme-docs", 6, null);
  assert.equal(blockedDetail.pull.status, "open");
  assert.equal(blockedDetail.pull.checks.status, "success");
  assert.deepEqual(blockedDetail.pull.reviewSummary, []);
  assert.equal(blockedDetail.mergeEligibility.eligible, false);
  assert.deepEqual(blockedDetail.mergeEligibility.reasons, ["Review required by branch protection"]);
});

test("PR list and detail are viewable publicly and denied for private repositories", async () => {
  const { pulls } = await createDomains();

  const denied = await pulls.listPullRequests("acme-demo", "acme-private", null);
  assert.equal(denied.denied, true);

  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 1, "bob-reviewer");
  assert.equal(detail.denied, undefined);
  assert.equal(detail.myRole, "write");
  // bob-reviewer is eligible to review alice-dev's Open PR.
  assert.ok(detail.eligibleReviewers.includes("bob-reviewer"));
  assert.ok(detail.eligibleReviewers.includes("carol-dev") === false);

  const missing = await pulls.getPullRequest("acme-demo", "acme-docs", 99, null);
  assert.equal(missing.notFound, true);
});

test("comparison data shows branch selection, commit count and changed files for writers", async () => {
  const { pulls } = await createDomains();

  const compared = await pulls.getComparisonData(
    "acme-demo",
    "acme-docs",
    { base: "main", compare: "feature-search" },
    "bob-reviewer",
  );
  assert.equal(compared.ok, undefined);
  assert.equal(compared.valid, true);
  assert.equal(compared.reason, null);
  assert.equal(compared.commitCount, 1);
  assert.deepEqual(
    compared.files.map((file) => file.path),
    ["main-only.md", "src/search.ts"],
  );
  assert.equal(compared.baseCommit, "c2");
  assert.equal(compared.compareCommit, "c3");

  const same = await pulls.getComparisonData(
    "acme-demo",
    "acme-docs",
    { base: "main", compare: "main" },
    "bob-reviewer",
  );
  assert.equal(same.valid, false);
  assert.equal(same.reason, "same_branch");

  // Read and Triage cannot enter the creation-comparison flow.
  const forbidden = await pulls.getComparisonData(
    "acme-demo",
    "acme-docs",
    { base: "main", compare: "feature-search" },
    "carol-dev",
  );
  assert.equal(forbidden.denied, true);
});

test("creating a pull request persists an Open PR and rejects invalid pairs atomically", async () => {
  const { store, pulls } = await createDomains();

  const created = await pulls.createPullRequest("bob-reviewer", "acme-demo", "acme-docs", {
    base: "main",
    compare: "feature-search",
    title: "  Search improvements  ",
    description: "Return results for non-empty queries.",
  });
  assert.equal(created.ok, true);
  assert.equal(created.pull.number, 7);
  assert.equal(created.pull.title, "Search improvements");
  assert.equal(created.pull.status, "open");
  assert.equal(created.pull.author, "bob-reviewer");
  assert.equal(created.pull.baseBranch, "main");
  assert.equal(created.pull.compareBranch, "feature-search");
  assert.equal(created.pull.currentCompareCommit, "c3");

  // The detail and the list both see the new PR after refresh.
  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 7, null);
  assert.equal(detail.pull.title, "Search improvements");
  const list = await pulls.listPullRequests("acme-demo", "acme-docs", null);
  assert.equal(list.pulls.length, 7);

  // Duplicate Open pair is rejected without a partial record.
  const duplicate = await pulls.createPullRequest("bob-reviewer", "acme-demo", "acme-docs", {
    base: "main",
    compare: "feature-search",
    title: "Duplicate",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.branch, "A pull request already exists for these branches");

  const sameBranch = await pulls.createPullRequest("bob-reviewer", "acme-demo", "acme-docs", {
    base: "main",
    compare: "main",
    title: "Same branch",
  });
  assert.equal(sameBranch.ok, false);
  assert.equal(sameBranch.errors.branch, "Base and compare branches must be different");

  const blankTitle = await pulls.createPullRequest("bob-reviewer", "acme-demo", "acme-docs", {
    base: "main",
    compare: "release",
    title: "   ",
  });
  assert.equal(blankTitle.ok, false);
  assert.equal(blankTitle.errors.title, "Title is required");

  const overlong = await pulls.createPullRequest("bob-reviewer", "acme-demo", "acme-docs", {
    base: "main",
    compare: "release",
    title: "x".repeat(257),
  });
  assert.equal(overlong.ok, false);
  assert.equal(overlong.errors.title, "Title must be at most 256 characters");

  const noPermission = await pulls.createPullRequest("carol-dev", "acme-demo", "acme-docs", {
    base: "main",
    compare: "feature-search",
    title: "No write",
  });
  assert.equal(noPermission.forbidden, true);

  const state = await store.read();
  assert.deepEqual(Object.keys(state.pullRequests["acme-demo:acme-docs"]), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("reviewers can be requested and removed only by the author or Maintain/Admin", async () => {
  const { store, pulls } = await createDomains();

  const requested = await pulls.requestReviewer("alice-dev", "acme-demo", "acme-docs", 1, "bob-reviewer");
  assert.equal(requested.ok, true);
  assert.deepEqual(requested.pull.requestedReviewers.map((r) => r.username), ["bob-reviewer"]);

  // Persists after reload.
  const after = await pulls.getPullRequest("acme-demo", "acme-docs", 1, "alice-dev");
  assert.deepEqual(after.pull.requestedReviewers.map((r) => r.username), ["bob-reviewer"]);
  // No longer offered as a candidate.
  assert.ok(after.eligibleReviewers.includes("bob-reviewer") === false);

  const duplicate = await pulls.requestReviewer("alice-dev", "acme-demo", "acme-docs", 1, "bob-reviewer");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.reviewers, "Reviewer already requested");

  // A viewer who is neither author nor Maintain/Admin cannot request.
  const forbidden = await pulls.requestReviewer("bob-reviewer", "acme-demo", "acme-docs", 2, "alice-dev");
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.forbidden, true);

  // carol-dev is not eligible (no Write or higher on the repository).
  const ineligible = await pulls.requestReviewer("alice-dev", "acme-demo", "acme-docs", 1, "carol-dev");
  assert.equal(ineligible.ok, false);
  assert.equal(ineligible.errors.reviewers, "Account is not eligible to review this repository");

  // The author cannot request themselves.
  const self = await pulls.requestReviewer("alice-dev", "acme-demo", "acme-docs", 1, "alice-dev");
  assert.equal(self.ok, false);
  assert.equal(self.errors.reviewers, "The pull request author cannot be requested as a reviewer");

  const removed = await pulls.removeReviewer("alice-dev", "acme-demo", "acme-docs", 1, "bob-reviewer");
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.pull.requestedReviewers, []);
  const refreshed = await pulls.getPullRequest("acme-demo", "acme-docs", 1, "alice-dev");
  assert.deepEqual(refreshed.pull.requestedReviewers, []);
  assert.ok(refreshed.eligibleReviewers.includes("bob-reviewer"));
  // The request record stays with the operator/time but is no longer pending.
  const state = await store.read();
  const record = state.pullRequestReviewers["acme-demo:acme-docs:1"][0];
  assert.equal(record.removedBy, "alice-dev");
  assert.ok(record.removedAt);
});

test("close and reopen persist status transitions and do not touch branches", async () => {
  const { store, pulls, organizations } = await createDomains();

  const closed = await pulls.setPullRequestStatus("alice-dev", "acme-demo", "acme-docs", 1, {
    status: "closed",
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.pull.status, "closed");
  assert.deepEqual(
    closed.pull.timeline.map((entry) => entry.type),
    ["created", "comment", "closed"],
  );

  const state = await store.read();
  assert.equal(state.git["acme-demo:acme-docs"].branches.main, "c2");

  const reopened = await pulls.setPullRequestStatus("alice-dev", "acme-demo", "acme-docs", 1, {
    status: "open",
  });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.pull.status, "open");

  // A Read-only viewer cannot close or reopen.
  const forbidden = await pulls.setPullRequestStatus("carol-dev", "acme-demo", "acme-docs", 1, {
    status: "closed",
  });
  assert.equal(forbidden.forbidden, true);

  // Invalid statuses are rejected.
  const invalid = await pulls.setPullRequestStatus("alice-dev", "acme-demo", "acme-docs", 1, {
    status: "merged",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.status, "Status is invalid");
});

test("only a repository Admin may update the test check for the current compare commit", async () => {
  const { store, pulls } = await createDomains();

  const forbidden = await pulls.updatePullRequestCheck("bob-reviewer", "acme-demo", "acme-docs", 1, {
    status: "success",
  });
  assert.equal(forbidden.forbidden, true);

  const updated = await pulls.updatePullRequestCheck("alice-dev", "acme-demo", "acme-docs", 1, {
    status: "success",
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.checks.status, "success");
  assert.equal(updated.checks.setter, "alice-dev");
  assert.ok(updated.checks.setAt);

  // Persists for that compare commit after reload.
  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 1, null);
  assert.equal(detail.pull.checks.status, "success");
  assert.equal(detail.pull.checks.setter, "alice-dev");
  const state = await store.read();
  const key = "acme-demo:acme-docs:1";
  assert.equal(state.pullRequestChecks[key][detail.pull.currentCompareCommit].test.status, "success");

  const invalid = await pulls.updatePullRequestCheck("alice-dev", "acme-demo", "acme-docs", 1, {
    status: "blocked",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.status, "Status is invalid");
});

test("a Write reviewer submits an Approve without a summary and the decision persists", async () => {
  const { store, pulls } = await createDomains();

  // bob-reviewer is a non-author Write reviewer; PR #1 has no decision yet.
  const submitted = await pulls.submitPullRequestReview("bob-reviewer", "acme-demo", "acme-docs", 1, {
    decision: "approve",
    summary: "",
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.review.reviewer, "bob-reviewer");
  assert.equal(submitted.review.decision, "approve");
  assert.equal(submitted.review.explanation, "");
  assert.ok(submitted.review.createdAt);
  assert.equal(submitted.review.commitId, submitted.pull.currentCompareCommit);
  assert.deepEqual(
    submitted.pull.reviewSummary.map((entry) => entry.decision),
    ["approve"],
  );
  assert.deepEqual(
    submitted.pull.timeline.map((entry) => entry.type),
    ["created", "comment", "review"],
  );

  // The decision survives a reload and the branch-protection eligibility reads it.
  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 1, null);
  assert.deepEqual(detail.pull.reviewSummary.map((entry) => entry.decision), ["approve"]);
  assert.ok(detail.mergeEligibility.conditions.some((condition) => condition.label === "1 approval"));
  const approvalCondition = detail.mergeEligibility.conditions.find(
    (condition) => condition.label === "1 approval",
  );
  assert.equal(approvalCondition.satisfied, true);

  // A new Request changes decision by the same reviewer replaces the effective
  // decision while the old record stays in the store.
  const changed = await pulls.submitPullRequestReview("bob-reviewer", "acme-demo", "acme-docs", 1, {
    decision: "request_changes",
    summary: "Please adjust the copy",
  });
  assert.equal(changed.ok, true);
  assert.deepEqual(
    changed.pull.reviewSummary.map((entry) => entry.decision),
    ["request_changes"],
  );
  assert.deepEqual(
    changed.pull.reviewSummary.map((entry) => entry.explanation),
    ["Please adjust the copy"],
  );
  const state = await store.read();
  const key = "acme-demo:acme-docs:1";
  assert.equal(Object.keys(state.pullRequestReviews[key]).length, 2);
  const records = Object.values(state.pullRequestReviews[key]);
  assert.deepEqual(
    records.map((record) => record.decision).sort(),
    ["approve", "request_changes"],
  );
});

test("review submission rejects the author, Draft PRs, non-writers and invalid decisions", async () => {
  const { pulls } = await createDomains();

  // The PR author cannot submit a review.
  const author = await pulls.submitPullRequestReview("alice-dev", "acme-demo", "acme-docs", 1, {
    decision: "approve",
    summary: "",
  });
  assert.equal(author.ok, false);
  assert.equal(author.forbidden, true);

  // A viewer without Write or higher cannot submit.
  const noPermission = await pulls.submitPullRequestReview("carol-dev", "acme-demo", "acme-docs", 1, {
    decision: "comment",
    summary: "",
  });
  assert.equal(noPermission.forbidden, true);

  // Draft PRs do not allow review submission.
  const draft = await pulls.submitPullRequestReview("bob-reviewer", "acme-demo", "acme-docs", 3, {
    decision: "approve",
    summary: "",
  });
  assert.equal(draft.ok, false);
  assert.equal(draft.errors.review, "Only Open pull requests accept review submissions");

  // A closed PR is not reviewable either.
  const closed = await pulls.submitPullRequestReview("bob-reviewer", "acme-demo", "acme-docs", 2, {
    decision: "comment",
    summary: "",
  });
  assert.equal(closed.ok, false);
  assert.equal(closed.errors.review, "Only Open pull requests accept review submissions");

  // An unknown decision is rejected and no record is created.
  const invalid = await pulls.submitPullRequestReview("bob-reviewer", "acme-demo", "acme-docs", 1, {
    decision: "looks-good",
    summary: "",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.decision, "Decision is invalid");
});

test("submitting a review publishes the reviewer's pending inline comments", async () => {
  const { store, pulls } = await createDomains();

  const pending = await pulls.addInlineComment("bob-reviewer", "acme-demo", "acme-docs", 1, {
    path: "release-notes.md",
    line: 1,
    body: "Pending note",
    draft: true,
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.comment.state, "pending");

  const before = await pulls.getPullRequest("acme-demo", "acme-docs", 1, null);
  assert.equal(before.pull.inlineComments[0].state, "pending");

  const submitted = await pulls.submitPullRequestReview("bob-reviewer", "acme-demo", "acme-docs", 1, {
    decision: "approve",
    summary: "Looks good",
  });
  assert.equal(submitted.ok, true);

  const after = await pulls.getPullRequest("acme-demo", "acme-docs", 1, null);
  assert.equal(after.pull.inlineComments[0].state, "published");
  const state = await store.read();
  const key = "acme-demo:acme-docs:1";
  assert.equal(Object.values(state.pullRequestInlineComments[key])[0].state, "published");
});

test("an Approve recorded against the current commit satisfies the protected-branch rule", async () => {
  const { pulls } = await createDomains();

  // PR #1 targets protected `main`; `test` must be success and the reviewer
  // must approve before the merge is allowed.
  const blocked = await pulls.mergePullRequest("alice-dev", "acme-demo", "acme-docs", 1);
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.reasons.includes("Review required by branch protection"));
  assert.ok(blocked.reasons.includes("Required status check test must be successful"));

  await pulls.updatePullRequestCheck("alice-dev", "acme-demo", "acme-docs", 1, {
    status: "success",
  });
  await pulls.submitPullRequestReview("bob-reviewer", "acme-demo", "acme-docs", 1, {
    decision: "approve",
    summary: "Approved",
  });

  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 1, null);
  assert.equal(detail.mergeEligibility.eligible, true);

  const merged = await pulls.mergePullRequest("alice-dev", "acme-demo", "acme-docs", 1);
  assert.equal(merged.ok, true);
  assert.equal(merged.pull.status, "merged");
  assert.equal(merged.pull.mergedBy, "alice-dev");
});

test("branch protection rules are admin-only, persist and block direct writes", async () => {
  const { pulls, organizations, store } = await createDomains();

  const forbidden = await pulls.setProtectionRule("bob-reviewer", "acme-demo", "acme-docs", {
    branch: "main",
    requireApproval: true,
    requireCheck: true,
  });
  assert.equal(forbidden.forbidden, true);

  const created = await pulls.setProtectionRule("alice-dev", "acme-demo", "acme-docs", {
    branch: "main",
    requireApproval: true,
    requireCheck: true,
  });
  assert.equal(created.ok, true);
  assert.equal(created.rule.branch, "main");
  assert.equal(created.rule.requireApproval, true);
  assert.equal(created.rule.requireCheck, true);

  const list = await pulls.listProtectionRules("acme-demo", "acme-docs", "alice-dev");
  assert.equal(list.rules.length, 1);
  assert.equal(list.rules[0].branch, "main");

  // Non-Admin cannot list rules either.
  const listForbidden = await pulls.listProtectionRules("acme-demo", "acme-docs", "bob-reviewer");
  assert.equal(listForbidden.forbidden, true);

  // An exact branch name is required; wildcards are not a branch name.
  const noBranch = await pulls.setProtectionRule("alice-dev", "acme-demo", "acme-docs", {
    branch: "release/*",
    requireApproval: false,
    requireCheck: false,
  });
  assert.equal(noBranch.ok, false);
  assert.equal(noBranch.errors.branch, "Branch not found");

  // Direct writes to the protected branch are blocked.
  const commit = await organizations.createRepositoryCommit("alice-dev", "acme-demo", "acme-docs", {
    branch: "main",
    path: "bypass.md",
    content: "x",
    message: "Bypass protection",
  });
  assert.equal(commit.ok, false);
  assert.equal(commit.errors.branch, "This branch is protected");
  const state = await store.read();
  assert.equal(state.git["acme-demo:acme-docs"].branches.main, "c2");
});

test("a new compare commit starts with pending and old check success is not reused", async () => {
  const { store, pulls, organizations } = await createDomains();

  // PR #2 (Fix search) compares feature-search into main. Set test success for
  // the current compare commit, then push a new commit to feature-search.
  const updated = await pulls.updatePullRequestCheck("alice-dev", "acme-demo", "acme-docs", 2, {
    status: "success",
  });
  assert.equal(updated.ok, true);
  const oldCommit = updated.commitId;

  const pushed = await organizations.createRepositoryCommit("alice-dev", "acme-demo", "acme-docs", {
    branch: "feature-search",
    path: "extra.md",
    content: "Extra file on the feature branch.\n",
    message: "Add extra notes",
  });
  assert.equal(pushed.ok, true);

  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 2, null);
  assert.notEqual(detail.pull.currentCompareCommit, oldCommit);
  // The checks area for the new compare commit starts with pending.
  assert.equal(detail.pull.checks.status, "pending");
  assert.equal(detail.pull.checks.setter, null);
  // The old success remains stored for its own commit.
  const state = await store.read();
  const key = "acme-demo:acme-docs:2";
  assert.equal(state.pullRequestChecks[key][oldCommit].test.status, "success");
});

test("merge is blocked without approval and succeeds with a valid non-author approval and successful check", async () => {
  const { store, pulls } = await createDomains();

  // Protect main with both requirements.
  await pulls.setProtectionRule("alice-dev", "acme-demo", "acme-docs", {
    branch: "main",
    requireApproval: true,
    requireCheck: true,
  });
  // PR #1 targets main (compare release) with test pending.
  const blocked = await pulls.mergePullRequest("alice-dev", "acme-demo", "acme-docs", 1);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.reasons.includes("Review required by branch protection"));

  await pulls.updatePullRequestCheck("alice-dev", "acme-demo", "acme-docs", 1, {
    status: "success",
  });
  const stillBlocked = await pulls.mergePullRequest("alice-dev", "acme-demo", "acme-docs", 1);
  assert.equal(stillBlocked.blocked, true);
  assert.ok(stillBlocked.reasons.includes("Review required by branch protection"));

  // Inject a valid non-author Approve review for the current compare commit
  // (review submission is REQ-6-3-4; the eligibility computation reads the
  // stored decision records).
  const state1 = await store.read();
  const key = "acme-demo:acme-docs:1";
  const commitId = state1.pullRequests["acme-demo:acme-docs"][1].compareCommit;
  state1.pullRequestReviews[key] = {
    [`${key}:review:1`]: {
      id: `${key}:review:1`,
      prKey: key,
      reviewer: "bob-reviewer",
      commitId,
      decision: "approve",
      explanation: "Looks good",
      createdAt: new Date().toISOString(),
    },
  };
  await store.update(async () => state1);

  const merged = await pulls.mergePullRequest("alice-dev", "acme-demo", "acme-docs", 1);
  assert.equal(merged.ok, true);
  assert.equal(merged.pull.status, "merged");
  assert.equal(merged.pull.mergedBy, "alice-dev");
  assert.ok(merged.pull.mergeCommitId);

  const state = await store.read();
  const git = state.git["acme-demo:acme-docs"];
  assert.equal(git.branches.main, merged.pull.mergeCommitId);
  // The merged branch contains the release changes: the modified
  // `src/search.ts` and the added `release-notes.md`.
  assert.ok(git.files.main["src/search.ts"].content.includes("release result"));
  assert.ok(git.files.main["release-notes.md"].content.includes("Release notes"));

  // Merged is terminal: close/reopen and merge are rejected.
  const closed = await pulls.setPullRequestStatus("alice-dev", "acme-demo", "acme-docs", 1, {
    status: "closed",
  });
  assert.equal(closed.ok, false);
  assert.equal(closed.errors.status, "Merged pull requests cannot be closed or reopened");
  const again = await pulls.mergePullRequest("alice-dev", "acme-demo", "acme-docs", 1);
  assert.equal(again.ok, false);
  assert.equal(again.errors.merge, "This pull request has already been merged");
});

test("request changes blocks merging until a new decision for the current commit", async () => {
  const { store, pulls } = await createDomains();

  const key = "acme-demo:acme-docs:1";
  const state1 = await store.read();
  const commitId = state1.pullRequests["acme-demo:acme-docs"][1].compareCommit;
  state1.pullRequestReviews[key] = {
    [`${key}:review:1`]: {
      id: `${key}:review:1`,
      prKey: key,
      reviewer: "bob-reviewer",
      commitId,
      decision: "request_changes",
      explanation: "Please adjust",
      createdAt: new Date().toISOString(),
    },
  };
  await store.update(async () => state1);

  const blocked = await pulls.mergePullRequest("alice-dev", "acme-demo", "acme-docs", 1);
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.reasons.includes("Requested changes must be resolved"));

  // A newer Approve by the same reviewer on the same commit replaces the
  // blocking decision (only the latest decision counts).
  const state2 = await store.read();
  state2.pullRequestReviews[key][`${key}:review:2`] = {
    id: `${key}:review:2`,
    prKey: key,
    reviewer: "bob-reviewer",
    commitId,
    decision: "approve",
    explanation: "Approved after the fix",
    createdAt: new Date(Date.now() + 1000).toISOString(),
  };
  await store.update(async () => state2);

  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 1, null);
  assert.deepEqual(detail.pull.reviewSummary.map((entry) => entry.decision), ["approve"]);
});

test("draft pull requests are created in Draft state and cannot be merged", async () => {
  const { pulls } = await createDomains();

  const created = await pulls.createPullRequest("bob-reviewer", "acme-demo", "acme-docs", {
    base: "main",
    compare: "feature-search",
    title: "Draft work",
    description: "Work in progress.",
    draft: true,
  });
  assert.equal(created.ok, true);
  assert.equal(created.pull.number, 7);
  assert.equal(created.pull.status, "draft");
  assert.equal(created.pull.author, "bob-reviewer");
  assert.equal(created.pull.baseBranch, "main");
  assert.equal(created.pull.compareBranch, "feature-search");

  // The list shows the draft status and the pair is now occupied.
  const list = await pulls.listPullRequests("acme-demo", "acme-docs", null);
  const draftEntry = list.pulls.find((pull) => pull.number === 7);
  assert.equal(draftEntry.status, "draft");

  const duplicate = await pulls.createPullRequest("bob-reviewer", "acme-demo", "acme-docs", {
    base: "main",
    compare: "feature-search",
    title: "Duplicate draft",
    draft: true,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.branch, "A pull request already exists for these branches");

  // A draft cannot be merged even by an Admin.
  const merged = await pulls.mergePullRequest("alice-dev", "acme-demo", "acme-docs", 7);
  assert.equal(merged.ok, false);
  assert.equal(merged.errors.merge, "Draft pull requests cannot be merged");
});

test("ready for review converts the seeded Draft PR to Open and records the activity", async () => {
  const { pulls } = await createDomains();

  const ready = await pulls.readyForReview("alice-dev", "acme-demo", "acme-docs", 3);
  assert.equal(ready.ok, true);
  assert.equal(ready.pull.status, "open");
  assert.equal(ready.pull.title, "Draft onboarding update");
  assert.equal(ready.pull.baseBranch, "main");
  assert.equal(ready.pull.compareBranch, "draft-feature");
  assert.equal(ready.pull.number, 3);
  assert.deepEqual(
    ready.pull.timeline.map((entry) => entry.type),
    ["created", "ready-for-review"],
  );

  // Persists after reload.
  const detail = await pulls.getPullRequest("acme-demo", "acme-docs", 3, null);
  assert.equal(detail.pull.status, "open");
  assert.equal(detail.pull.title, "Draft onboarding update");

  // Only the author, Maintain, Admin or Owner may convert; a Write reviewer
  // without those roles cannot.
  const forbidden = await pulls.readyForReview("bob-reviewer", "acme-demo", "acme-docs", 3);
  assert.equal(forbidden.forbidden, true);

  // A non-draft PR cannot be converted.
  const notDraft = await pulls.readyForReview("alice-dev", "acme-demo", "acme-docs", 1);
  assert.equal(notDraft.ok, false);
  assert.equal(notDraft.errors.status, "Only draft pull requests can be marked as ready for review");
});

test("list summaries carry review status data for filtering without writing anything", async () => {
  const { store, pulls } = await createDomains();

  const list = await pulls.listPullRequests("acme-demo", "acme-docs", null);
  const openEntry = list.pulls.find((pull) => pull.number === 1);
  assert.deepEqual(openEntry.reviews, []);
  assert.equal(openEntry.reviewRequested, false);

  // The read-only list call did not create any records for the Open PR under
  // test (the seeded merge PR carries its own review, untouched by reads).
  let state = await store.read();
  assert.equal(state.pullRequestReviews["acme-demo:acme-docs:1"], undefined);
  assert.equal(state.pullRequestReviewers["acme-demo:acme-docs:1"], undefined);

  await pulls.requestReviewer("alice-dev", "acme-demo", "acme-docs", 1, "bob-reviewer");
  const afterList = await pulls.listPullRequests("acme-demo", "acme-docs", null);
  const after = afterList.pulls.find((pull) => pull.number === 1);
  assert.equal(after.reviewRequested, true);

  state = await store.read();
  assert.ok(state.pullRequestReviewers["acme-demo:acme-docs:1"].length === 1);
  assert.equal(state.pullRequestReviews["acme-demo:acme-docs:1"], undefined);
});
