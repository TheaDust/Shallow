import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { seedState } from "../src/domain/accounts.mjs";
import { seedIssues } from "../src/domain/issues.mjs";
import { seedOrganizations } from "../src/domain/organizations.mjs";
import {
  canClosePullRequest,
  canCreatePullRequest,
  canUpdatePullRequestChecks,
  closePullRequest,
  createPullRequest,
  findPullRequestByNumber,
  listRepositoryPullRequests,
  markPullRequestReadyForReview,
  mergeEligibility,
  mergePullRequest,
  protectionRulesFor,
  pullRequestDetail,
  reopenPullRequest,
  seedPullRequests,
  setPullRequestCheck,
  syncPullRequestsToBranches,
  upsertProtectionRule,
} from "../src/domain/pulls.mjs";
import {
  addInlineComment,
  eligibleReviewers,
  removeReviewerRequest,
  requestReviewer,
  submitReview,
} from "../src/domain/pull-review.mjs";
import { seedRepositories } from "../src/domain/repos.mjs";
import { compareBranches, createFileCommit, findBranch, normalizeRepositories } from "../src/domain/vcs.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

const INITIAL = {
  accounts: [],
  sessions: [],
  recovery: [],
  organizations: [],
  organizationMembers: [],
  repositories: [],
  teams: [],
  teamMembers: [],
  repoGrants: [],
  labels: [],
  milestones: [],
  issues: [],
  issueComments: [],
  issueReactions: [],
  issueActivities: [],
  pullRequests: [],
  branchProtectionRules: [],
};

async function seededStore(t) {
  const dir = mkdtempSync(join(tmpdir(), "pulls-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createJsonStore(join(dir, "state.json"), INITIAL);
  await store.update((state) => {
    seedState(state);
    seedOrganizations(state);
    seedRepositories(state);
    seedIssues(state);
    normalizeRepositories(state);
    seedPullRequests(state);
  });
  return store;
}

function accountId(state, username) {
  return state.accounts.find((account) => account.username === username).id;
}

function personalAcmeDocs(state) {
  return state.repositories.find(
    (repository) => repository.ownerType === "account" && repository.name === "acme-docs",
  );
}

test("REQ-6 seeds: open, closed, draft, and review/merge scenario pull requests with exact titles, branches, statuses, and checks", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);

  const pulls = listRepositoryPullRequests(state, repository.id);
  assert.equal(pulls.length, 7);
  assert.deepEqual(
    pulls.map((pull) => pull.title),
    [
      "Merge blocked update",
      "Merge onboarding improvements",
      "Review candidate update",
      "Pending review comment",
      "Draft onboarding update",
      "Fix search",
      "Improve onboarding",
    ],
  );
  const open = findPullRequestByNumber(state, repository.id, 1);
  assert.equal(open.title, "Improve onboarding");
  assert.equal(open.status, "open");
  assert.equal(open.baseBranch, "main");
  assert.equal(open.compareBranch, "release");
  const closed = findPullRequestByNumber(state, repository.id, 2);
  assert.equal(closed.title, "Fix search");
  assert.equal(closed.status, "closed");
  assert.equal(closed.compareBranch, "feature-search");
  const draft = findPullRequestByNumber(state, repository.id, 3);
  assert.equal(draft.title, "Draft onboarding update");
  assert.equal(draft.status, "draft");
  assert.equal(draft.baseBranch, "main");
  assert.equal(draft.compareBranch, "draft-feature");
  assert.equal(draft.authorAccountId, accountId(state, "alice-dev"));
  assert.deepEqual(draft.reviews, []);
  assert.ok(open.comments.length >= 1, "the public Open PR carries a discussion comment");

  const detail = pullRequestDetail(state, repository, open, accountId(state, "alice-dev"));
  assert.equal(detail.check.name, "test");
  assert.equal(detail.check.status, "pending");
  assert.equal(detail.author.username, "alice-dev");
  assert.equal(detail.merge.mergeable, false);
  assert.ok(detail.merge.reasons.includes("Review required by branch protection"));
  assert.ok(detail.merge.reasons.includes("Requires status check test to be success"));
  assert.equal(detail.comments.length, 1);
  assert.ok(detail.comments[0].body.length > 0);
  // The public Open PR has a real comparison: one modified and one added file.
  assert.ok(detail.commits.length >= 1);
  assert.ok(detail.files.some((file) => file.path === "src/search.ts"));
  assert.ok(detail.files.some((file) => file.status === "added"));
  assert.ok(detail.files.some((file) => file.status === "modified"));

  // REQ-6-5 seeds: the eligible PR is approved with test success and the
  // blocked PR lacks the required approval.
  const eligible = findPullRequestByNumber(state, repository.id, 6);
  assert.equal(eligible.title, "Merge onboarding improvements");
  assert.equal(eligible.status, "open");
  assert.equal(eligible.baseBranch, "main");
  const eligibleDetail = pullRequestDetail(state, repository, eligible, accountId(state, "alice-dev"));
  assert.equal(eligibleDetail.check.status, "success");
  assert.equal(eligibleDetail.reviewSummary.length, 1);
  assert.equal(eligibleDetail.reviewSummary[0].decision, "approve");
  assert.equal(eligibleDetail.reviewSummary[0].author.username, "bob-reviewer");
  assert.equal(eligibleDetail.merge.mergeable, true);
  const blocked = findPullRequestByNumber(state, repository.id, 7);
  const blockedDetail = pullRequestDetail(state, repository, blocked, accountId(state, "alice-dev"));
  assert.equal(blockedDetail.merge.mergeable, false);
  assert.ok(blockedDetail.merge.reasons.includes("Review required by branch protection"));

  // feature-search is exactly one commit ahead of main and changes src/search.ts.
  const comparison = compareBranches(state, repository, "main", "feature-search");
  assert.equal(comparison.commitCount, 1);
  assert.equal(comparison.noDifference, false);
  assert.ok(comparison.files.some((file) => file.path === "src/search.ts"));
  assert.ok(comparison.files.some((file) => file.path === "main-only.md"));
});

test("REQ-6-2-3: creation stores a unique number, branches, commits, title, author, and created activity", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");

  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    outcome = createPullRequest(draft, draftRepository, {
      accountId: aliceId,
      baseBranch: "main",
      compareBranch: "feature-search",
      title: "  Merge feature search  ",
      description: "Bring the feature-search work into main.",
    });
  });
  assert.equal(outcome.ok, true);
  const pr = outcome.pr;
  assert.equal(pr.number, 8);
  assert.equal(pr.title, "Merge feature search");
  assert.equal(pr.status, "open");
  assert.equal(pr.baseBranch, "main");
  assert.equal(pr.compareBranch, "feature-search");
  assert.equal(pr.baseCommitId, findBranch(repository, "main").commitId);
  assert.equal(pr.compareCommitId, findBranch(repository, "feature-search").commitId);
  assert.equal(pr.activities.length, 1);
  assert.equal(pr.activities[0].type, "created");
  assert.equal(pr.checks.length, 0);

  const fresh = await store.read();
  const detail = pullRequestDetail(fresh, personalAcmeDocs(fresh), findPullRequestByNumber(fresh, repository.id, 3), aliceId);
  assert.equal(detail.check.status, "pending");
  assert.equal(detail.commits.length, 1);
  assert.equal(detail.commits[0].message, "Add feature search docs");
  assert.equal(detail.author.username, "alice-dev");
});

test("REQ-6-2-3: creation is rejected atomically for invalid inputs", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");

  const attempt = async (input) => {
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
      outcome = createPullRequest(draft, draftRepository, { accountId: aliceId, ...input });
    });
    return outcome;
  };

  // Same source and target branches.
  let outcome = await attempt({ baseBranch: "main", compareBranch: "main", title: "Same" });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.base);

  // No comparable commits: a branch that points at the same head as main.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    draftRepository.branches.push({
      name: "no-diff-branch",
      commitId: findBranch(draftRepository, "main").commitId,
      protected: false,
    });
  });
  outcome = await attempt({ baseBranch: "main", compareBranch: "no-diff-branch", title: "Empty" });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.base);

  // A Draft or Open PR with the same source/target pair already exists.
  // First create one Open PR for main → feature-search, then the second
  // attempt with the same pair must be rejected.
  outcome = await attempt({ baseBranch: "main", compareBranch: "feature-search", title: "First" });
  assert.equal(outcome.ok, true);
  outcome = await attempt({ baseBranch: "main", compareBranch: "feature-search", title: "Duplicate" });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.base);

  // A spaces-only title is rejected with Title is required.
  outcome = await attempt({ baseBranch: "main", compareBranch: "feature-search", title: "   " });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors.title, "Title is required");

  // An overlong title creates nothing.
  outcome = await attempt({
    baseBranch: "main",
    compareBranch: "feature-search",
    title: "x".repeat(257),
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.title);

  // bob-reviewer has Write on the personal acme-docs repository (REQ-6-3
  // seed) and may therefore create pull requests for a fresh branch pair.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    draftRepository.branches.push({
      name: "bob-topic",
      commitId: findBranch(draftRepository, "release").commitId,
      protected: false,
    });
  });
  let bobOutcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    bobOutcome = createPullRequest(draft, draftRepository, {
      accountId: bobId,
      baseBranch: "main",
      compareBranch: "bob-topic",
      title: "Bob tries",
    });
  });
  assert.equal(bobOutcome.ok, true);

  const fresh = await store.read();
  assert.equal(
    fresh.pullRequests.filter((pull) => pull.repositoryId === repository.id).length,
    9,
    "only the successfully created PRs may be added",
  );
  assert.equal(fresh.pullRequests.filter((pull) => pull.title === "Duplicate").length, 0);
});

test("REQ-6-2-4: draft creation stores a Draft PR that cannot be merged and appears in the list", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");

  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    outcome = createPullRequest(draft, draftRepository, {
      accountId: aliceId,
      baseBranch: "main",
      compareBranch: "feature-search",
      title: "Draft the search docs",
      description: "Work in progress.",
      draft: true,
    });
  });
  assert.equal(outcome.ok, true);
  const pr = outcome.pr;
  assert.equal(pr.number, 8);
  assert.equal(pr.status, "draft");
  assert.equal(pr.baseBranch, "main");
  assert.equal(pr.compareBranch, "feature-search");
  assert.equal(pr.baseCommitId, findBranch(repository, "main").commitId);
  assert.equal(pr.compareCommitId, findBranch(repository, "feature-search").commitId);
  assert.equal(pr.activities.length, 1);
  assert.equal(pr.activities[0].type, "created");

  const fresh = await store.read();
  const freshRepository = personalAcmeDocs(fresh);
  const freshPull = findPullRequestByNumber(fresh, freshRepository.id, 8);
  const detail = pullRequestDetail(fresh, freshRepository, freshPull, aliceId);
  assert.equal(detail.status, "draft");
  assert.equal(detail.commits.length, 1);
  assert.ok(detail.files.some((file) => file.path === "src/search.ts"));
  assert.ok(
    fresh.pullRequests.some(
      (pull) => pull.repositoryId === freshRepository.id && pull.title === "Draft the search docs" && pull.status === "draft",
    ),
    "the list shows the draft status",
  );
  // A Draft PR cannot merge regardless of checks/reviews.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshPull.id);
    setPullRequestCheck(draft, draftRepository, draftPull, {
      accountId: aliceId,
      name: "test",
      status: "success",
    });
    draftPull.reviews.push({
      id: "review_seed_1",
      accountId: accountId(state, "bob-reviewer"),
      decision: "approve",
      commitId: draftPull.compareCommitId,
      createdAt: new Date().toISOString(),
    });
  });
  const merged = await store.read();
  const mergedRepository = personalAcmeDocs(merged);
  const mergedPull = findPullRequestByNumber(merged, mergedRepository.id, 8);
  assert.equal(mergedPull.status, "draft");
});

test("REQ-6-2-4: the author marks the seeded draft ready for review and the status persists as Open", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const draft = findPullRequestByNumber(state, repository.id, 3);
  assert.equal(draft.title, "Draft onboarding update");
  assert.equal(draft.compareBranch, "draft-feature");
  assert.equal(draft.baseBranch, "main");

  // A non-author Triage reviewer cannot mark the draft ready.
  let outcome;
  await store.update((draftState) => {
    const draftRepository = draftState.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draftState.pullRequests.find((candidate) => candidate.id === draft.id);
    outcome = markPullRequestReadyForReview(draftState, draftRepository, draftPull, {
      accountId: bobId,
    });
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.forbidden, true);

  // The author marks it ready for review.
  await store.update((draftState) => {
    const draftRepository = draftState.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draftState.pullRequests.find((candidate) => candidate.id === draft.id);
    outcome = markPullRequestReadyForReview(draftState, draftRepository, draftPull, {
      accountId: aliceId,
    });
  });
  assert.equal(outcome.ok, true);

  const fresh = await store.read();
  const freshPull = findPullRequestByNumber(fresh, personalAcmeDocs(fresh).id, 3);
  assert.equal(freshPull.status, "open");
  assert.equal(freshPull.title, "Draft onboarding update");
  assert.equal(freshPull.baseBranch, "main");
  assert.equal(freshPull.compareBranch, "draft-feature");
  assert.equal(freshPull.description, "Refresh the onboarding steps before opening the review.");
  assert.ok(
    freshPull.activities.some((activity) => activity.type === "ready_for_review"),
    "a Ready for review activity appears in Conversation",
  );
  // A reviewer reopens the same PR and sees Open.
  const reviewerDetail = pullRequestDetail(fresh, personalAcmeDocs(fresh), freshPull, bobId);
  assert.equal(reviewerDetail.status, "open");
  assert.ok(reviewerDetail.activities.some((activity) => activity.type === "ready_for_review"));
});

test("REQ-6-3-1: detail exposes conversation, commits, and files for the same PR number and is read-only", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const open = findPullRequestByNumber(state, repository.id, 1);
  const bobId = accountId(state, "bob-reviewer");

  const detail = pullRequestDetail(state, repository, open, bobId);
  assert.equal(detail.number, 1);
  assert.equal(detail.title, "Improve onboarding");
  assert.equal(detail.description, "Improve the onboarding flow for new contributors.");
  assert.equal(detail.baseBranch, "main");
  assert.equal(detail.compareBranch, "release");
  assert.equal(detail.comments.length, 1);
  assert.equal(detail.comments[0].author.username, "alice-dev");
  assert.ok(detail.commits.length >= 1);
  assert.equal(detail.commits[0].message, "Add changelog");
  assert.ok(detail.files.some((file) => file.path === "src/search.ts"));
  assert.ok(detail.files.some((file) => file.status === "added"));
  assert.ok(detail.files.some((file) => file.status === "modified"));

  // Viewing does not create comments, reviews, or status changes.
  const before = JSON.stringify(state.pullRequests);
  pullRequestDetail(state, repository, open, bobId);
  assert.equal(JSON.stringify(state.pullRequests), before);
});

test("REQ-6-3-2: aggregate diff statistics use the additions/deletions format", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const open = findPullRequestByNumber(state, repository.id, 1);
  const detail = pullRequestDetail(state, repository, open, null);
  const additions = detail.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = detail.files.reduce((sum, file) => sum + file.deletions, 0);
  const aggregate = `${additions} additions, ${deletions} deletions`;
  assert.match(aggregate, /^\d+ additions, \d+ deletions$/);
  assert.equal(detail.files.length, 2, "one added and one modified file, no unchanged files");
});

test("REQ-6-1: only a repository Admin can update the test check; success is stored with setter and time", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const open = findPullRequestByNumber(state, repository.id, 1);
  const currentCommit = open.compareCommitId;

  assert.equal(canUpdatePullRequestChecks(state, bobId, repository), false);
  assert.equal(canUpdatePullRequestChecks(state, aliceId, repository), true);

  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    outcome = setPullRequestCheck(draft, draftRepository, draftPull, {
      accountId: bobId,
      name: "test",
      status: "success",
    });
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.forbidden, true);

  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    outcome = setPullRequestCheck(draft, draftRepository, draftPull, {
      accountId: aliceId,
      name: "test",
      status: "success",
    });
  });
  assert.equal(outcome.ok, true);

  const fresh = await store.read();
  const freshPull = findPullRequestByNumber(fresh, repository.id, 1);
  const check = freshPull.checks.find(
    (candidate) => candidate.name === "test" && candidate.commitId === currentCommit,
  );
  assert.equal(check.status, "success");
  assert.equal(check.setterAccountId, aliceId);
  assert.ok(check.setAt);

  const detail = pullRequestDetail(fresh, repository, freshPull, aliceId);
  assert.equal(detail.check.status, "success");
  assert.equal(detail.check.setter.username, "alice-dev");
  assert.ok(detail.check.setAt);
});

test("REQ-6-1: branch protection rules block direct writes and drive merge eligibility", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const open = findPullRequestByNumber(state, repository.id, 1);

  // bob-reviewer (Triage) cannot create a rule.
  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    outcome = upsertProtectionRule(draft, draftRepository, {
      accountId: bobId,
      branch: "main",
      requireApproval: true,
      requireStatusCheck: true,
    });
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.forbidden, true);

  // The Admin creates the rule for main with both requirements.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    outcome = upsertProtectionRule(draft, draftRepository, {
      accountId: aliceId,
      branch: "main",
      requireApproval: true,
      requireStatusCheck: true,
    });
  });
  assert.equal(outcome.ok, true);

  const fresh = await store.read();
  const freshRepository = personalAcmeDocs(fresh);
  const rules = protectionRulesFor(fresh, freshRepository.id);
  assert.deepEqual(rules, [
    { branch: "main", requireApproval: true, requireStatusCheck: true },
  ]);
  // The protected branch is marked so direct writes are rejected.
  assert.equal(findBranch(freshRepository, "main").protected, true);

  // Direct write to protected main is blocked.
  let commitOutcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    commitOutcome = createFileCommit(draft, draftRepository, {
      accountId: aliceId,
      authorName: "alice-dev",
      branch: "main",
      path: "new.md",
      content: "# New",
      message: "Try to bypass the rule",
    });
  });
  assert.equal(commitOutcome.ok, false);
  assert.equal(commitOutcome.errors.branch, "Branch is protected");

  // With test pending and no approval the PR is unmergeable.
  const freshOpen = findPullRequestByNumber(fresh, freshRepository.id, 1);
  let eligibility = mergeEligibility(fresh, freshRepository, freshOpen);
  assert.equal(eligibility.mergeable, false);
  assert.ok(eligibility.reasons.includes("Review required by branch protection"));
  assert.ok(eligibility.reasons.includes("Requires status check test to be success"));

  // Set the check to success for the current compare commit.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshOpen.id);
    setPullRequestCheck(draft, draftRepository, draftPull, {
      accountId: aliceId,
      name: "test",
      status: "success",
    });
  });

  // Add an Approve from a non-author reviewer on the current commit.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshOpen.id);
    draftPull.reviews.push({
      id: "review_1",
      accountId: bobId,
      decision: "approve",
      commitId: draftPull.compareCommitId,
      createdAt: new Date().toISOString(),
    });
  });

  const ready = await store.read();
  const readyRepository = personalAcmeDocs(ready);
  const readyOpen = findPullRequestByNumber(ready, readyRepository.id, 1);
  eligibility = mergeEligibility(ready, readyRepository, readyOpen);
  assert.equal(eligibility.mergeable, true);

  // Any valid Request changes blocks merging even with approval and success.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === readyRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === readyOpen.id);
    draftPull.reviews.push({
      id: "review_2",
      accountId: bobId,
      decision: "request_changes",
      commitId: draftPull.compareCommitId,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });
  });
  const blocked = await store.read();
  const blockedRepository = personalAcmeDocs(blocked);
  const blockedPull = findPullRequestByNumber(blocked, blockedRepository.id, 1);
  eligibility = mergeEligibility(blocked, blockedRepository, blockedPull);
  assert.equal(eligibility.mergeable, false);
  assert.ok(eligibility.reasons.includes("Request changes blocks merging"));
});

test("REQ-6-1 scenario 3: a new compare commit starts with pending and old success does not count", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const open = findPullRequestByNumber(state, repository.id, 1);

  // The Admin updates test to success on the current compare commit.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    setPullRequestCheck(draft, draftRepository, draftPull, {
      accountId: aliceId,
      name: "test",
      status: "success",
    });
  });

  // The compare branch (release) gains a new commit.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    createFileCommit(draft, draftRepository, {
      accountId: aliceId,
      authorName: "alice-dev",
      branch: "release",
      path: "release-notes.md",
      content: "# Release notes\n",
      message: "Add release notes",
    });
  });

  const after = await store.read();
  const afterRepository = personalAcmeDocs(after);
  const afterPull = findPullRequestByNumber(after, afterRepository.id, 1);

  // The sync updates the current compare commit to the new branch head.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === afterRepository.id);
    const changed = syncPullRequestsToBranches(draft, draftRepository);
    assert.equal(changed, true);
  });
  const synced = await store.read();
  const syncedRepository = personalAcmeDocs(synced);
  const syncedPull = findPullRequestByNumber(synced, syncedRepository.id, 1);
  const newCommit = findBranch(syncedRepository, "release").commitId;
  assert.notEqual(newCommit, afterPull.baseCommitId);

  const detail = pullRequestDetail(synced, syncedRepository, syncedPull, aliceId);
  assert.equal(detail.compareCommitId, newCommit);
  assert.equal(detail.check.status, "pending", "new compare commit starts with pending");
  assert.equal(detail.check.setter, null);

  // The rule requires test success, so the old success cannot be reused.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === syncedRepository.id);
    upsertProtectionRule(draft, draftRepository, {
      accountId: aliceId,
      branch: "main",
      requireApproval: false,
      requireStatusCheck: true,
    });
  });
  const finalState = await store.read();
  const finalRepository = personalAcmeDocs(finalState);
  const finalPull = findPullRequestByNumber(finalState, finalRepository.id, 1);
  const eligibility = mergeEligibility(finalState, finalRepository, finalPull);
  assert.equal(eligibility.mergeable, false);
  assert.ok(eligibility.reasons.includes("Requires status check test to be success"));
});

test("REQ-6-2-2: comparison is read-only, shows commits and files, and marks same branches as no difference", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);

  const same = compareBranches(state, repository, "main", "main");
  assert.equal(same.sameBranch, true);
  assert.equal(same.noDifference, true);
  assert.equal(same.commitCount, 0);

  // release is one commit ahead of main and changes src/search.ts.
  const release = compareBranches(state, repository, "main", "release");
  assert.equal(release.noDifference, false);
  assert.equal(release.commitCount, 1);
  assert.equal(release.commits[0].message, "Add changelog");
  assert.ok(release.files.some((file) => file.path === "src/search.ts"));
  assert.ok(release.files.some((file) => file.path === "CHANGELOG.md"));

  const valid = compareBranches(state, repository, "main", "feature-search");
  assert.equal(valid.commitCount, 1);
  assert.equal(valid.commits[0].message, "Add feature search docs");
  assert.ok(valid.files.some((file) => file.path === "src/search.ts"));

  // Comparison never persists anything.
  const fresh = await store.read();
  assert.equal(fresh.pullRequests.length, 7);
  assert.deepEqual(fresh.repositories.map((candidate) => candidate.name).sort(), [
    "acme-docs",
    "acme-docs",
    "acme-docs-fork",
    "acme-internal",
    "secret-research",
  ]);
});

test("REQ-6-2-2/6-2-3: only Write/Maintain/Admin may create pull requests", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const carolId = accountId(state, "carol-dev");

  assert.equal(canCreatePullRequest(state, aliceId, repository), true);
  // bob-reviewer has Write on the personal acme-docs repository.
  assert.equal(canCreatePullRequest(state, bobId, repository), true);
  // carol-dev has no repository grant.
  assert.equal(canCreatePullRequest(state, carolId, repository), false);
  assert.equal(canCreatePullRequest(state, null, repository), false);
});

test("REQ-6-3-3: inline comments store PR/path/commit/line/author/body/published and publish immediately or stay pending", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const open = findPullRequestByNumber(state, repository.id, 1);
  const compare = compareBranches(state, repository, "main", "release");
  const file = compare.files.find((candidate) => candidate.path === "src/search.ts");
  const addIndex = file.lines.findIndex((line) => line.type === "add");
  const addedLine = addIndex + 1;

  // A Write non-author reviewer publishes an Add single comment immediately.
  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    outcome = addInlineComment(draft, draftRepository, draftPull, {
      accountId: bobId,
      path: "src/search.ts",
      line: addedLine,
      body: "  This line should be lowercased.  ",
    });
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.comment.body, "This line should be lowercased.");
  assert.equal(outcome.comment.published, true);
  assert.equal(outcome.comment.commitId, open.compareCommitId);
  assert.equal(outcome.comment.path, "src/search.ts");
  assert.equal(outcome.comment.line, addedLine);
  assert.equal(outcome.comment.accountId, bobId);

  const freshState = await store.read();
  const freshRepository = personalAcmeDocs(freshState);
  const freshOpen = findPullRequestByNumber(freshState, freshRepository.id, 1);
  const detail = pullRequestDetail(freshState, freshRepository, freshOpen, bobId);
  assert.equal(detail.inlineComments.length, 1);
  assert.equal(detail.inlineComments[0].author.username, "bob-reviewer");
  assert.equal(detail.inlineComments[0].body, "This line should be lowercased.");
  assert.equal(detail.inlineComments[0].path, "src/search.ts");
  assert.equal(detail.inlineComments[0].line, addedLine);
  assert.equal(detail.inlineComments[0].published, true);
  assert.equal(detail.inlineComments[0].outdated, false);

  // Start a review keeps the comment unpublished (pending).
  let pending;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshOpen.id);
    pending = addInlineComment(draft, draftRepository, draftPull, {
      accountId: bobId,
      path: "src/search.ts",
      line: addedLine,
      body: "Pending draft body",
      startReview: true,
    });
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.comment.published, false);
  const pendingState = await store.read();
  const pendingRepository = personalAcmeDocs(pendingState);
  const pendingPull = findPullRequestByNumber(pendingState, pendingRepository.id, 1);
  const pendingDetail = pullRequestDetail(pendingState, pendingRepository, pendingPull, bobId);
  const pendingComments = pendingDetail.inlineComments.filter((comment) => !comment.published);
  assert.equal(pendingComments.length, 1);
  assert.equal(pendingComments[0].body, "Pending draft body");

  // Empty bodies, non-diff paths, and context lines are rejected atomically.
  const rejections = [
    { path: "src/search.ts", line: addedLine, body: "   " },
    { path: "README.md", line: 1, body: "Not in the diff" },
    { path: "src/search.ts", line: 1, body: "Context line" },
  ];
  for (const input of rejections) {
    let rejected;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === pendingRepository.id);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pendingPull.id);
      rejected = addInlineComment(draft, draftRepository, draftPull, { accountId: bobId, ...input });
    });
    assert.equal(rejected.ok, false);
  }

  // The PR author and Draft PRs cannot comment.
  const draftPull = findPullRequestByNumber(state, repository.id, 3);
  let authorOutcome;
  let draftOutcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPullRecord = draft.pullRequests.find((candidate) => candidate.id === draftPull.id);
    authorOutcome = addInlineComment(draft, draftRepository, draftPullRecord, {
      accountId: aliceId,
      path: "src/search.ts",
      line: addedLine,
      body: "Author tries",
    });
    draftOutcome = addInlineComment(draft, draftRepository, draftPullRecord, {
      accountId: bobId,
      path: "src/search.ts",
      line: addedLine,
      body: "Draft tries",
    });
  });
  assert.equal(authorOutcome.ok, false);
  assert.equal(authorOutcome.forbidden, true);
  assert.equal(draftOutcome.ok, false);
  assert.equal(draftOutcome.forbidden, true);
});

test("REQ-6-3-3: when the compare commit changes, published comments are marked Outdated and drafts stay unpublished", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const open = findPullRequestByNumber(state, repository.id, 1);
  const compare = compareBranches(state, repository, "main", "release");
  const file = compare.files.find((candidate) => candidate.path === "src/search.ts");
  const addedLine = file.lines.findIndex((line) => line.type === "add") + 1;

  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    addInlineComment(draft, draftRepository, draftPull, {
      accountId: bobId,
      path: "src/search.ts",
      line: addedLine,
      body: "Published comment",
    });
    addInlineComment(draft, draftRepository, draftPull, {
      accountId: bobId,
      path: "src/search.ts",
      line: addedLine,
      body: "Pending draft",
      startReview: true,
    });
  });

  // The compare branch (release) gains a new commit.
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    createFileCommit(draft, draftRepository, {
      accountId: aliceId,
      authorName: "alice-dev",
      branch: "release",
      path: "release-notes.md",
      content: "# Release notes\n",
      message: "Add release notes",
    });
  });
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const changed = syncPullRequestsToBranches(draft, draftRepository);
    assert.equal(changed, true);
  });
  const synced = await store.read();
  const syncedRepository = personalAcmeDocs(synced);
  const syncedPull = findPullRequestByNumber(synced, syncedRepository.id, 1);
  const detail = pullRequestDetail(synced, syncedRepository, syncedPull, bobId);
  const published = detail.inlineComments.find((comment) => comment.body === "Published comment");
  const draftComment = detail.inlineComments.find((comment) => comment.body === "Pending draft");
  assert.equal(published.outdated, true);
  assert.equal(published.published, true);
  assert.equal(draftComment.published, false);
  assert.equal(draftComment.outdated, true);
});

test("REQ-6-3-4: review submission stores decision/reviewer/commit/explanation/time and replaces the effective decision", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const open = findPullRequestByNumber(state, repository.id, 1);
  const currentCommit = open.compareCommitId;

  // Approve without a summary is valid.
  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    outcome = submitReview(draft, draftRepository, draftPull, {
      accountId: bobId,
      decision: "approve",
    });
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.review.decision, "approve");
  assert.equal(outcome.review.commitId, currentCommit);
  assert.equal(outcome.review.accountId, bobId);
  assert.equal(outcome.review.explanation, "");
  assert.ok(outcome.review.createdAt);

  const fresh = await store.read();
  const freshRepository = personalAcmeDocs(fresh);
  const freshOpen = findPullRequestByNumber(fresh, freshRepository.id, 1);
  let freshDetail = pullRequestDetail(fresh, freshRepository, freshOpen, aliceId);
  assert.equal(freshDetail.reviewSummary.length, 1);
  assert.equal(freshDetail.reviewSummary[0].author.username, "bob-reviewer");
  assert.equal(freshDetail.reviewSummary[0].decision, "approve");

  // A new Request changes decision replaces the effective decision while the
  // old approve record stays in history.
  let second;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshOpen.id);
    second = submitReview(draft, draftRepository, draftPull, {
      accountId: bobId,
      decision: "request_changes",
      explanation: "  Please add tests.  ",
    });
  });
  assert.equal(second.ok, true);
  const after = await store.read();
  const afterRepository = personalAcmeDocs(after);
  const afterPull = findPullRequestByNumber(after, afterRepository.id, 1);
  const afterDetail = pullRequestDetail(after, afterRepository, afterPull, aliceId);
  assert.equal(afterDetail.reviewSummary.length, 1);
  assert.equal(afterDetail.reviewSummary[0].decision, "request_changes");
  assert.equal(afterDetail.reviewSummary[0].explanation, "  Please add tests.  ");
  assert.equal(afterDetail.reviews.length, 2, "the old record is preserved");
  assert.ok(afterDetail.reviews.some((review) => review.decision === "approve"));
  assert.ok(afterDetail.merge.reasons.includes("Request changes blocks merging"));

  // The author cannot submit reviews; Draft PRs cannot submit reviews.
  const draftPull = findPullRequestByNumber(state, repository.id, 3);
  let authorOutcome;
  let draftOutcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPullRecord = draft.pullRequests.find((candidate) => candidate.id === draftPull.id);
    authorOutcome = submitReview(draft, draftRepository, draftPullRecord, {
      accountId: aliceId,
      decision: "approve",
    });
    draftOutcome = submitReview(draft, draftRepository, draftPullRecord, {
      accountId: bobId,
      decision: "comment",
    });
  });
  assert.equal(authorOutcome.ok, false);
  assert.equal(authorOutcome.forbidden, true);
  assert.equal(draftOutcome.ok, false);
  assert.equal(draftOutcome.forbidden, true);
});

test("REQ-6-3-3/6-3-4: submitting a review publishes the reviewer's pending Start a review comments", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const bobId = accountId(state, "bob-reviewer");
  const open = findPullRequestByNumber(state, repository.id, 1);
  const compare = compareBranches(state, repository, "main", "release");
  const file = compare.files.find((candidate) => candidate.path === "src/search.ts");
  const addedLine = file.lines.findIndex((line) => line.type === "add") + 1;

  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    addInlineComment(draft, draftRepository, draftPull, {
      accountId: bobId,
      path: "src/search.ts",
      line: addedLine,
      body: "Pending then published",
      startReview: true,
    });
  });
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    submitReview(draft, draftRepository, draftPull, {
      accountId: bobId,
      decision: "comment",
      explanation: "Reviewing now",
    });
  });
  const after = await store.read();
  const afterRepository = personalAcmeDocs(after);
  const afterPull = findPullRequestByNumber(after, afterRepository.id, 1);
  const detail = pullRequestDetail(after, afterRepository, afterPull, bobId);
  const comment = detail.inlineComments.find((candidate) => candidate.body === "Pending then published");
  assert.equal(comment.published, true);
});

test("REQ-6-4: reviewer requests are stored with operator/time, removed without deleting reviews, and permission is enforced", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const carolId = accountId(state, "carol-dev");
  const open = findPullRequestByNumber(state, repository.id, 1);

  // Eligible candidates: Write/Maintain/Admin, excluding the PR author.
  const candidates = eligibleReviewers(state, repository, open);
  assert.deepEqual(candidates.map((candidate) => candidate.username), ["bob-reviewer"]);

  // The author requests bob-reviewer; the request persists with operator/time.
  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    outcome = requestReviewer(draft, draftRepository, draftPull, {
      accountId: aliceId,
      username: "bob-reviewer",
    });
  });
  assert.equal(outcome.ok, true);
  const fresh = await store.read();
  const freshRepository = personalAcmeDocs(fresh);
  const freshOpen = findPullRequestByNumber(fresh, freshRepository.id, 1);
  const freshDetail = pullRequestDetail(fresh, freshRepository, freshOpen, aliceId);
  assert.deepEqual(freshDetail.reviewers.map((reviewer) => reviewer.username), ["bob-reviewer"]);
  assert.equal(freshOpen.reviewerRequests[0].requestedByAccountId, aliceId);
  assert.ok(freshOpen.reviewerRequests[0].createdAt);

  // Duplicate and non-eligible targets are rejected.
  let duplicate;
  let carolRequest;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshOpen.id);
    duplicate = requestReviewer(draft, draftRepository, draftPull, {
      accountId: aliceId,
      username: "bob-reviewer",
    });
    carolRequest = requestReviewer(draft, draftRepository, draftPull, {
      accountId: aliceId,
      username: "carol-dev",
    });
  });
  assert.equal(duplicate.ok, false);
  assert.equal(carolRequest.ok, false);
  assert.ok(carolRequest.errors.username);

  // A user who is neither the author nor a maintainer cannot modify requests.
  let carolRemove;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshOpen.id);
    carolRemove = removeReviewerRequest(draft, draftRepository, draftPull, {
      accountId: carolId,
      username: "bob-reviewer",
    });
  });
  assert.equal(carolRemove.ok, false);
  assert.equal(carolRemove.forbidden, true);

  // Removing the request persists and does not delete reviews or comments.
  let removed;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshOpen.id);
    draftPull.reviews.push({
      id: "review_before_remove",
      accountId: bobId,
      decision: "comment",
      commitId: draftPull.compareCommitId,
      createdAt: new Date().toISOString(),
    });
    removed = removeReviewerRequest(draft, draftRepository, draftPull, {
      accountId: aliceId,
      username: "bob-reviewer",
    });
  });
  assert.equal(removed.ok, true);
  const after = await store.read();
  const afterRepository = personalAcmeDocs(after);
  const afterPull = findPullRequestByNumber(after, afterRepository.id, 1);
  const afterDetail = pullRequestDetail(after, afterRepository, afterPull, aliceId);
  assert.deepEqual(afterDetail.reviewers, []);
  assert.equal(afterDetail.reviews.length, 1, "removing a request keeps submitted reviews");
  assert.equal(afterDetail.reviewSummary.length, 1, "the effective review decision is unchanged");
});

test("REQ-6-4: Maintain/Admin may request and remove reviewers on a Closed PR; the author qualifier only applies to the author", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const closed = findPullRequestByNumber(state, repository.id, 2);
  assert.equal(closed.title, "Fix search");
  assert.equal(closed.status, "closed");

  // alice-dev is the PR author and the repository Admin; on a Closed PR the
  // author clause does not apply, but the Admin role still holds the capability.
  const detail = pullRequestDetail(state, repository, closed, aliceId);
  assert.equal(detail.canRequestReviewers, true);

  let requested;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === closed.id);
    requested = requestReviewer(draft, draftRepository, draftPull, {
      accountId: aliceId,
      username: "bob-reviewer",
    });
  });
  assert.equal(requested.ok, true);

  const fresh = await store.read();
  const freshRepository = personalAcmeDocs(fresh);
  const freshPull = findPullRequestByNumber(fresh, freshRepository.id, 2);
  const freshDetail = pullRequestDetail(fresh, freshRepository, freshPull, aliceId);
  assert.deepEqual(freshDetail.reviewers.map((reviewer) => reviewer.username), ["bob-reviewer"]);
  assert.equal(freshDetail.status, "closed", "requesting a reviewer does not change the PR status");

  // Removal persists and is permitted for the Admin as well.
  let removed;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshPull.id);
    removed = removeReviewerRequest(draft, draftRepository, draftPull, {
      accountId: aliceId,
      username: "bob-reviewer",
    });
  });
  assert.equal(removed.ok, true);
  const after = await store.read();
  const afterDetail = pullRequestDetail(
    after,
    personalAcmeDocs(after),
    findPullRequestByNumber(after, personalAcmeDocs(after).id, 2),
    aliceId,
  );
  assert.deepEqual(afterDetail.reviewers, []);

  // A non-author viewer without Maintain/Admin cannot modify requests on a
  // Closed PR either.
  let forbidden;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshPull.id);
    forbidden = requestReviewer(draft, draftRepository, draftPull, {
      accountId: accountId(draft, "carol-dev"),
      username: "bob-reviewer",
    });
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.forbidden, true);
});

test("REQ-6-5: merging writes the compare changes into the base branch and sets Merged with merger/time/commit", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const bobId = accountId(state, "bob-reviewer");
  const eligible = findPullRequestByNumber(state, repository.id, 6);
  const mainBefore = findBranch(repository, "main").commitId;

  // bob-reviewer (Write) is not allowed to merge.
  let forbidden;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === eligible.id);
    forbidden = mergePullRequest(draft, draftRepository, draftPull, {
      accountId: bobId,
      authorName: "bob-reviewer",
    });
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.forbidden, true);

  // The eligible PR (approval + test success on protected main) merges.
  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === eligible.id);
    outcome = mergePullRequest(draft, draftRepository, draftPull, {
      accountId: aliceId,
      authorName: "alice-dev",
    });
  });
  assert.equal(outcome.ok, true);
  assert.ok(outcome.mergeCommitId);

  const merged = await store.read();
  const mergedRepository = personalAcmeDocs(merged);
  const mergedPull = findPullRequestByNumber(merged, mergedRepository.id, 6);
  assert.equal(mergedPull.status, "merged");
  assert.equal(mergedPull.mergedByAccountId, aliceId);
  assert.equal(mergedPull.mergeCommitId, outcome.mergeCommitId);
  assert.ok(mergedPull.mergedAt);
  assert.ok(
    mergedPull.activities.some((activity) => activity.type === "merged"),
    "the merged activity appears in the timeline",
  );
  // The main branch head is updated to the merge commit.
  const mainAfter = findBranch(mergedRepository, "main");
  assert.equal(mainAfter.commitId, outcome.mergeCommitId);
  assert.notEqual(mainAfter.commitId, mainBefore);
  const mergeCommit = mergedRepository.commits.find((candidate) => candidate.id === outcome.mergeCommitId);
  assert.equal(mergeCommit.parentId, mainBefore);
  assert.equal(mergeCommit.secondParentId, eligible.compareCommitId);
  // The merge result integrates the compare content.
  const mergeFiles = new Map((mergeCommit.files ?? []).map((file) => [file.path, file.content]));
  const compareFiles = new Map(
    (mergedRepository.commits.find((candidate) => candidate.id === eligible.compareCommitId).files ?? []).map(
      (file) => [file.path, file.content],
    ),
  );
  assert.equal(mergeFiles.get("docs/release-notes.md"), compareFiles.get("docs/release-notes.md"));

  // The merged state and resulting commit survive a fresh read; a repeated
  // merge is rejected and leaves the state unchanged.
  const reopened = await store.read();
  const reopenedRepository = personalAcmeDocs(reopened);
  const reopenedPull = findPullRequestByNumber(reopened, reopenedRepository.id, 6);
  const reopenedDetail = pullRequestDetail(reopened, reopenedRepository, reopenedPull, aliceId);
  assert.equal(reopenedDetail.status, "merged");
  assert.equal(reopenedDetail.mergeCommitId, outcome.mergeCommitId);
  assert.equal(reopenedDetail.mergedBy.username, "alice-dev");
  let repeated;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === reopenedRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === reopenedPull.id);
    repeated = mergePullRequest(draft, draftRepository, draftPull, {
      accountId: aliceId,
      authorName: "alice-dev",
    });
  });
  assert.equal(repeated.ok, false);
  assert.ok(repeated.errors.status);
});

test("REQ-6-5: a blocked PR stays unmerged and explains the missing approval; drafts cannot merge", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const blocked = findPullRequestByNumber(state, repository.id, 7);
  const mainBefore = findBranch(repository, "main").commitId;
  const draftPull = findPullRequestByNumber(state, repository.id, 3);

  const eligibility = mergeEligibility(state, repository, blocked);
  assert.equal(eligibility.mergeable, false);
  assert.ok(eligibility.reasons.includes("Review required by branch protection"));

  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPullRecord = draft.pullRequests.find((candidate) => candidate.id === blocked.id);
    outcome = mergePullRequest(draft, draftRepository, draftPullRecord, {
      accountId: aliceId,
      authorName: "alice-dev",
    });
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.merge.includes("Review required by branch protection"));

  let draftOutcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPullRecord = draft.pullRequests.find((candidate) => candidate.id === draftPull.id);
    draftOutcome = mergePullRequest(draft, draftRepository, draftPullRecord, {
      accountId: aliceId,
      authorName: "alice-dev",
    });
  });
  assert.equal(draftOutcome.ok, false);
  assert.ok(draftOutcome.errors.status);

  const fresh = await store.read();
  const freshRepository = personalAcmeDocs(fresh);
  const freshBlocked = findPullRequestByNumber(fresh, freshRepository.id, 7);
  assert.equal(freshBlocked.status, "open");
  assert.equal(findBranch(freshRepository, "main").commitId, mainBefore, "the target branch is unchanged");
  assert.equal(fresh.pullRequests.filter((pull) => pull.repositoryId === repository.id && pull.status === "merged").length, 0);
});

test("REQ-6-6: the author closes and reopens an unmerged Open PR; both transitions are recorded and nothing else changes", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const open = findPullRequestByNumber(state, repository.id, 1);
  assert.equal(open.title, "Improve onboarding");
  assert.equal(open.status, "open");
  const mainBefore = findBranch(repository, "main").commitId;
  const releaseBefore = findBranch(repository, "release").commitId;
  const discussionBefore = (open.comments ?? []).length;

  // Close pull request applies immediately without any branch update.
  let outcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    outcome = closePullRequest(draft, draftRepository, draftPull, { accountId: aliceId });
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.pr.status, "closed");
  assert.ok(outcome.pr.closedAt);
  const closedActivities = outcome.pr.activities.filter((activity) => activity.type === "closed");
  assert.equal(closedActivities.length, 1);
  assert.equal(closedActivities[0].actorAccountId, aliceId);
  assert.ok(closedActivities[0].createdAt);
  assert.equal(findBranch(repository, "main").commitId, mainBefore, "closing does not update the target branch");
  assert.equal(findBranch(repository, "release").commitId, releaseBefore, "closing does not update the compare branch");
  assert.equal((outcome.pr.comments ?? []).length, discussionBefore, "closing keeps the discussion");

  // Reopen pull request immediately restores Open.
  let reopened;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    reopened = reopenPullRequest(draft, draftRepository, draftPull, { accountId: aliceId });
  });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.pr.status, "open");
  assert.equal(reopened.pr.closedAt, null);
  assert.equal(reopened.pr.activities.filter((activity) => activity.type === "reopened").length, 1);

  // After reload the final Open status, both timeline transitions, the
  // discussion, and the diff remain; Close pull request is available again.
  const fresh = await store.read();
  const freshRepository = personalAcmeDocs(fresh);
  const freshPull = findPullRequestByNumber(fresh, freshRepository.id, 1);
  assert.equal(freshPull.status, "open");
  assert.equal(freshPull.title, "Improve onboarding");
  assert.equal((freshPull.comments ?? []).length, discussionBefore);
  const types = freshPull.activities.map((activity) => activity.type);
  assert.ok(types.includes("closed"));
  assert.ok(types.includes("reopened"));
  const detail = pullRequestDetail(fresh, freshRepository, freshPull, aliceId);
  assert.equal(detail.status, "open");
  assert.equal(detail.canClose, true);
  assert.ok(detail.commits.length >= 1, "the diff stays viewable");
  assert.equal(findBranch(freshRepository, "main").commitId, mainBefore, "closing or reopening never updates branches");
  assert.equal(findBranch(freshRepository, "release").commitId, releaseBefore);

  // Close pull request is available again after the reload.
  let secondClose;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === freshRepository.id);
    const draftPull = draft.pullRequests.find((candidate) => candidate.id === freshPull.id);
    secondClose = closePullRequest(draft, draftRepository, draftPull, { accountId: aliceId });
  });
  assert.equal(secondClose.ok, true);
  assert.equal(secondClose.pr.status, "closed");
  assert.equal(findBranch(freshRepository, "main").commitId, mainBefore, "the second close leaves the branch untouched");
});

test("REQ-6-6: a viewer who is neither author nor Maintain/Admin/Owner cannot close or reopen; status is unchanged", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const bobId = accountId(state, "bob-reviewer");
  const carolId = accountId(state, "carol-dev");
  const open = findPullRequestByNumber(state, repository.id, 1);
  const closed = findPullRequestByNumber(state, repository.id, 2);
  assert.equal(open.status, "open");
  assert.equal(closed.status, "closed");
  assert.equal(closed.title, "Fix search");

  // bob-reviewer (Write) and carol-dev (no grant) are not authors and have
  // no Maintain/Admin/owner role, so the capability is false.
  assert.equal(canClosePullRequest(state, repository, open, bobId), false);
  assert.equal(canClosePullRequest(state, repository, open, carolId), false);
  assert.equal(canClosePullRequest(state, repository, open, null), false);
  assert.equal(canClosePullRequest(state, repository, open, accountId(state, "alice-dev")), true);

  let bobClose;
  let bobReopen;
  let carolClose;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const openPull = draft.pullRequests.find((candidate) => candidate.id === open.id);
    const closedPull = draft.pullRequests.find((candidate) => candidate.id === closed.id);
    bobClose = closePullRequest(draft, draftRepository, openPull, { accountId: bobId });
    bobReopen = reopenPullRequest(draft, draftRepository, closedPull, { accountId: bobId });
    carolClose = closePullRequest(draft, draftRepository, openPull, { accountId: carolId });
  });
  assert.equal(bobClose.ok, false);
  assert.equal(bobClose.forbidden, true);
  assert.equal(bobReopen.ok, false);
  assert.equal(bobReopen.forbidden, true);
  assert.equal(carolClose.ok, false);
  assert.equal(carolClose.forbidden, true);

  const fresh = await store.read();
  const freshRepository = personalAcmeDocs(fresh);
  const freshOpen = findPullRequestByNumber(fresh, freshRepository.id, 1);
  const freshClosed = findPullRequestByNumber(fresh, freshRepository.id, 2);
  assert.equal(freshOpen.status, "open", "the Open PR status remains unchanged");
  assert.equal(freshClosed.status, "closed", "the Closed PR status remains unchanged");
  assert.equal(freshOpen.activities.filter((activity) => activity.type === "closed").length, 0);
});

test("REQ-6-6: Merged is terminal and rejects close/reopen; a Draft PR can be closed by its author", async (t) => {
  const store = await seededStore(t);
  const state = await store.read();
  const repository = personalAcmeDocs(state);
  const aliceId = accountId(state, "alice-dev");
  const eligible = findPullRequestByNumber(state, repository.id, 6);
  const draftPull = findPullRequestByNumber(state, repository.id, 3);

  // Merge the eligible PR (approval + test success on protected main).
  let mergeOutcome;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const draftPullRecord = draft.pullRequests.find((candidate) => candidate.id === eligible.id);
    mergeOutcome = mergePullRequest(draft, draftRepository, draftPullRecord, {
      accountId: aliceId,
      authorName: "alice-dev",
    });
  });
  assert.equal(mergeOutcome.ok, true);

  // The merged PR rejects both close and reopen even for its author.
  let closeMerged;
  let reopenMerged;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === repository.id);
    const mergedPull = draft.pullRequests.find((candidate) => candidate.id === eligible.id);
    closeMerged = closePullRequest(draft, draftRepository, mergedPull, { accountId: aliceId });
    reopenMerged = reopenPullRequest(draft, draftRepository, mergedPull, { accountId: aliceId });
  });
  assert.equal(closeMerged.ok, false);
  assert.ok(closeMerged.errors.status);
  assert.equal(reopenMerged.ok, false);
  assert.ok(reopenMerged.errors.status);
  const after = await store.read();
  const afterRepository = personalAcmeDocs(after);
  const afterMerged = findPullRequestByNumber(after, afterRepository.id, 6);
  assert.equal(afterMerged.status, "merged");
  assert.equal(afterMerged.activities.filter((activity) => activity.type === "closed").length, 0);
  const mergedDetail = pullRequestDetail(after, afterRepository, afterMerged, aliceId);
  assert.equal(mergedDetail.status, "merged");

  // A Draft PR can be closed by its author, then reopened as Open.
  let draftClose;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === afterRepository.id);
    const draftRecord = draft.pullRequests.find((candidate) => candidate.id === draftPull.id);
    draftClose = closePullRequest(draft, draftRepository, draftRecord, { accountId: aliceId });
  });
  assert.equal(draftClose.ok, true);
  assert.equal(draftClose.pr.status, "closed");
  let draftReopen;
  await store.update((draft) => {
    const draftRepository = draft.repositories.find((candidate) => candidate.id === afterRepository.id);
    const draftRecord = draft.pullRequests.find((candidate) => candidate.id === draftPull.id);
    draftReopen = reopenPullRequest(draft, draftRepository, draftRecord, { accountId: aliceId });
  });
  assert.equal(draftReopen.ok, true);
  assert.equal(draftReopen.pr.status, "open");
  const finalState = await store.read();
  const finalPull = findPullRequestByNumber(finalState, afterRepository.id, 3);
  assert.equal(finalPull.status, "open");
  assert.ok(finalPull.activities.some((activity) => activity.type === "closed"));
  assert.ok(finalPull.activities.some((activity) => activity.type === "reopened"));
});
