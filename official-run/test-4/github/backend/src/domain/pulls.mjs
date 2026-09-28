import { randomUUID } from "node:crypto";

import { effectiveRepositoryRole } from "./organizations.mjs";
import {
  canMergePullRequest,
  canRequestReviewers,
  canReviewPullRequest,
  eligibleReviewers,
  mergeConflict,
} from "./pull-review.mjs";
import {
  branchCommitIds,
  branchSnapshot,
  compareBranches,
  commitPayload,
  diffSnapshots,
  findBranch,
  makeSeedCommit,
} from "./vcs.mjs";

export const PULL_TITLE_MAX = 256;
export const PULL_DESCRIPTION_MAX = 65536;
export const PULL_STATUSES = new Set(["open", "draft", "closed", "merged"]);
export const CHECK_STATUSES = new Set(["pending", "success", "failure"]);
export const REVIEW_DECISIONS = new Set(["comment", "approve", "request_changes"]);

/** Roles allowed to create pull requests and enter the creation-comparison flow. */
const PULL_WRITE_ROLES = new Set(["write", "maintain", "admin"]);

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function accountName(state, accountId) {
  return state.accounts.find((candidate) => candidate.id === accountId)?.username ?? "unknown";
}

/**
 * Only Write, Maintain, Admin, or an organization Owner (effective role
 * write/maintain/admin) may compare branches and create pull requests. Read
 * and Triage may view existing pull requests but cannot enter the
 * creation-comparison flow (REQ-6-2-2).
 */
export function canCreatePullRequest(state, accountId, repository) {
  if (!accountId || !repository) return false;
  return PULL_WRITE_ROLES.has(effectiveRepositoryRole(state, accountId, repository));
}

/**
 * Only a repository Admin (effective role admin, which includes organization
 * Owners) may update the `test` check status from the Checks area (REQ-6-1).
 */
export function canUpdatePullRequestChecks(state, accountId, repository) {
  if (!accountId || !repository) return false;
  return effectiveRepositoryRole(state, accountId, repository) === "admin";
}

export function findPullRequestByNumber(state, repositoryId, number) {
  const value = Number(number);
  if (!Number.isInteger(value) || value <= 0) return null;
  return (
    (state.pullRequests ?? []).find(
      (candidate) => candidate.repositoryId === repositoryId && candidate.number === value,
    ) ?? null
  );
}

/** The stored `test` check for one compare commit, or null when none exists. */
export function testCheckForCommit(pr, commitId) {
  return (pr.checks ?? []).find(
    (candidate) => candidate.name === "test" && candidate.commitId === commitId,
  ) ?? null;
}

export function pullRequestSummary(state, pr) {
  return {
    number: pr.number,
    title: pr.title,
    status: pr.status,
    baseBranch: pr.baseBranch,
    compareBranch: pr.compareBranch,
    author: { username: accountName(state, pr.authorAccountId) },
    reviewed: (pr.reviews ?? []).some(
      (review) => review.commitId === pr.compareCommitId,
    ),
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  };
}

export function listRepositoryPullRequests(state, repositoryId) {
  return (state.pullRequests ?? [])
    .filter((pr) => pr.repositoryId === repositoryId)
    .sort((a, b) => b.number - a.number)
    .map((pr) => pullRequestSummary(state, pr));
}

/**
 * Read-only comparison of two branches for the pull-request creation page:
 * the commits on the compare branch that are not reachable from the base
 * branch, the per-file diff between the two branch heads, and the comparable
 * commit count. `noDifference` is true when the branches are the same or
 * there are no comparable commits.
 */
/**
 * Atomically creates a pull request (Open by default, Draft when `draft` is
 * true): a repository-scoped number, the source/target branches, the current
 * compare commit, the creation-time base commit, title, description, author,
 * creation time, and a created activity record. Every failure (permission,
 * same branches, no comparable commits, duplicate Draft/Open pair, invalid
 * title/description) happens before anything is pushed, so no partial record
 * survives.
 */
export function createPullRequest(
  state,
  repository,
  { accountId, baseBranch, compareBranch, title, description, draft = false } = {},
) {
  if (!canCreatePullRequest(state, accountId, repository)) {
    return { ok: false, forbidden: true };
  }
  const errors = {};
  const base = typeof baseBranch === "string" ? findBranch(repository, baseBranch) : null;
  const compare = typeof compareBranch === "string" ? findBranch(repository, compareBranch) : null;
  if (!base) errors.base = "Base branch not found";
  if (!compare) errors.compare = "Compare branch not found";
  if (!errors.base && !errors.compare && base.name === compare.name) {
    errors.base = "Base and compare branches must be different";
  }
  const titleValue = typeof title === "string" ? title.trim() : "";
  if (titleValue.length === 0) {
    errors.title = "Title is required";
  } else if (titleValue.length > PULL_TITLE_MAX) {
    errors.title = "Title is too long";
  }
  const descriptionValue = typeof description === "string" ? description : "";
  if (descriptionValue.length > PULL_DESCRIPTION_MAX) {
    errors.description = "Description is too long";
  }
  if (!errors.base && !errors.compare) {
    const baseIds = new Set(branchCommitIds(repository, base.name));
    const comparable = branchCommitIds(repository, compare.name).filter((id) => !baseIds.has(id));
    if (comparable.length === 0) {
      errors.base = "No comparable commits";
    }
  }
  if (!errors.base && !errors.compare) {
    const duplicate = (state.pullRequests ?? []).some(
      (pr) =>
        pr.repositoryId === repository.id &&
        pr.baseBranch === base.name &&
        pr.compareBranch === compare.name &&
        (pr.status === "open" || pr.status === "draft"),
    );
    if (duplicate) {
      errors.base = "A pull request already exists for these branches";
    }
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const numbers = (state.pullRequests ?? [])
    .filter((pr) => pr.repositoryId === repository.id)
    .map((pr) => pr.number);
  const number = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  const now = new Date().toISOString();
  const pr = {
    id: `pr_${randomUUID()}`,
    repositoryId: repository.id,
    number,
    title: titleValue,
    description: descriptionValue,
    authorAccountId: accountId,
    status: draft === true ? "draft" : "open",
    baseBranch: base.name,
    compareBranch: compare.name,
    baseCommitId: base.commitId,
    compareCommitId: compare.commitId,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    mergedAt: null,
    activities: [
      {
        id: `activity_${randomUUID()}`,
        type: "created",
        actorAccountId: accountId,
        createdAt: now,
      },
    ],
    reviews: [],
    comments: [],
    checks: [],
  };
  state.pullRequests.push(pr);
  return { ok: true, pr };
}

/**
 * Transitions a Draft pull request to Open (REQ-6-2-4): only the PR author or
 * a user with Maintain/Admin (including organization Owner) effective role may
 * mark a draft ready for review. The transition preserves the number, title,
 * description, and both branches and appends a `ready_for_review` activity.
 */
export function markPullRequestReadyForReview(
  state,
  repository,
  pr,
  { accountId } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  const isAuthor = pr.authorAccountId === accountId;
  const role = effectiveRepositoryRole(state, accountId, repository);
  const isMaintainer =
    role === "maintain" || role === "admin";
  if (!isAuthor && !isMaintainer) {
    return { ok: false, forbidden: true };
  }
  if (pr.status !== "draft") {
    return { ok: false, errors: { status: "Only draft pull requests can be marked ready for review" } };
  }
  const now = new Date().toISOString();
  pr.status = "open";
  pr.updatedAt = now;
  pr.activities.push({
    id: `activity_${randomUUID()}`,
    type: "ready_for_review",
    actorAccountId: accountId,
    createdAt: now,
  });
  return { ok: true, pr };
}

/**
 * Close/reopen capability for one pull request (REQ-6-6): the PR author or a
 * user with Maintain/Admin (including organization Owner) effective role may
 * transition an unmerged Open or Draft PR to Closed and a Closed PR back to
 * Open. Merged is terminal; every other viewer has no close or reopen
 * operation at all.
 */
export function canClosePullRequest(state, repository, pr, accountId) {
  if (!accountId || !repository || !pr) return false;
  if (pr.authorAccountId === accountId) return true;
  const role = effectiveRepositoryRole(state, accountId, repository);
  return role === "maintain" || role === "admin";
}

/**
 * Closes an unmerged Open or Draft pull request without merging (REQ-6-6):
 * the author or a Maintain/Admin/Owner may close it, and the transition
 * stores the new status, the operator, the time, and a closed activity record
 * while keeping the discussion, reviews, diff, and both branch references
 * viewable. Closing never updates any branch and Merged cannot be closed.
 */
export function closePullRequest(
  state,
  repository,
  pr,
  { accountId } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  if (!canClosePullRequest(state, repository, pr, accountId)) {
    return { ok: false, forbidden: true };
  }
  if (pr.status !== "open" && pr.status !== "draft") {
    return { ok: false, errors: { status: "Only Open or Draft pull requests can be closed" } };
  }
  const now = new Date().toISOString();
  pr.status = "closed";
  pr.closedAt = now;
  pr.updatedAt = now;
  pr.activities = [
    ...(pr.activities ?? []),
    {
      id: `activity_${randomUUID()}`,
      type: "closed",
      actorAccountId: accountId,
      createdAt: now,
    },
  ];
  return { ok: true, pr };
}

/**
 * Reopens a Closed pull request as Open (REQ-6-6): only the author or a
 * Maintain/Admin/Owner may do this. The transition stores the status, the
 * operator, the time, and a reopened activity record; it never updates any
 * branch and leaves the discussion, reviews, and diff untouched.
 */
export function reopenPullRequest(
  state,
  repository,
  pr,
  { accountId } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  if (!canClosePullRequest(state, repository, pr, accountId)) {
    return { ok: false, forbidden: true };
  }
  if (pr.status !== "closed") {
    return { ok: false, errors: { status: "Only Closed pull requests can be reopened" } };
  }
  const now = new Date().toISOString();
  pr.status = "open";
  pr.closedAt = null;
  pr.updatedAt = now;
  pr.activities = [
    ...(pr.activities ?? []),
    {
      id: `activity_${randomUUID()}`,
      type: "reopened",
      actorAccountId: accountId,
      createdAt: now,
    },
  ];
  return { ok: true, pr };
}

/**
 * Stores the `test` status (pending/success/failure) for the PR's current
 * compare commit together with the setter and time. Only a repository Admin
 * may call this; the caller resolves and syncs the repository first.
 */
export function setPullRequestCheck(
  state,
  repository,
  pr,
  { accountId, name, status } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  if (!canUpdatePullRequestChecks(state, accountId, repository)) {
    return { ok: false, forbidden: true };
  }
  const checkName = typeof name === "string" ? name.trim() : "";
  if (!checkName) return { ok: false, errors: { status: "Check name is required" } };
  if (!CHECK_STATUSES.has(status)) {
    return { ok: false, errors: { status: "Status is invalid" } };
  }
  const commitId = pr.compareCommitId;
  const now = new Date().toISOString();
  const existing = (pr.checks ?? []).find(
    (candidate) => candidate.name === checkName && candidate.commitId === commitId,
  );
  if (existing) {
    existing.status = status;
    existing.setterAccountId = accountId;
    existing.setAt = now;
  } else {
    pr.checks.push({
      name: checkName,
      commitId,
      status,
      setterAccountId: accountId,
      setAt: now,
    });
  }
  pr.updatedAt = now;
  return { ok: true, check: { name: checkName, status, commitId } };
}

/**
 * Merge eligibility of one pull request (REQ-6-1): on the same current
 * compare commit only each reviewer's latest decision among Comment, Approve,
 * and Request changes counts; the PR author cannot satisfy the approval
 * requirement; any valid Request changes blocks merging; and a branch
 * protection rule adds its independently selectable requirements (1 approval
 * and the `test` check success). Decisions on older commits are stale and do
 * not count.
 */
export function mergeEligibility(state, repository, pr) {
  const rule = (state.branchProtectionRules ?? []).find(
    (candidate) => candidate.repositoryId === repository.id && candidate.branch === pr.baseBranch,
  ) ?? null;
  const reasons = [];
  const latestByReviewer = new Map();
  for (const review of pr.reviews ?? []) {
    if (review.commitId !== pr.compareCommitId) continue;
    const existing = latestByReviewer.get(review.accountId);
    if (!existing || review.createdAt > existing.createdAt) {
      latestByReviewer.set(review.accountId, review);
    }
  }
  let approvals = 0;
  for (const review of latestByReviewer.values()) {
    if (review.decision === "request_changes") {
      reasons.push("Request changes blocks merging");
    }
    if (review.decision === "approve" && review.accountId !== pr.authorAccountId) {
      approvals += 1;
    }
  }
  if (rule?.requireApproval && approvals < 1) {
    reasons.push("Review required by branch protection");
  }
  if (rule?.requireStatusCheck) {
    const check = testCheckForCommit(pr, pr.compareCommitId);
    if (!check || check.status !== "success") {
      reasons.push("Requires status check test to be success");
    }
  }
  if (mergeConflict(repository, pr)) {
    reasons.push("Merge conflicts exist");
  }
  return { mergeable: reasons.length === 0, reasons };
}

/**
 * Merges an eligible Open pull request into its base branch (REQ-6-5): the
 * only supported method is a merge commit whose parents are the target-branch
 * head at merge time and the current compare commit. The target-branch head is
 * updated to the merge result, the PR becomes Merged, and the merger, time,
 * and resulting commit identifier are stored. Every condition is reread inside
 * the same update: permission, Open status, no valid Request changes, no merge
 * conflicts, and each enabled branch-protection requirement. Any unsatisfied
 * condition leaves both the target branch and the PR unchanged.
 */
export function mergePullRequest(
  state,
  repository,
  pr,
  { accountId, authorName } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  if (!canMergePullRequest(state, accountId, repository)) {
    return { ok: false, forbidden: true };
  }
  if (pr.status !== "open") {
    return { ok: false, errors: { status: "Only Open pull requests can be merged" } };
  }
  const eligibility = mergeEligibility(state, repository, pr);
  if (!eligibility.mergeable) {
    return { ok: false, errors: { merge: eligibility.reasons } };
  }
  const baseBranch = findBranch(repository, pr.baseBranch);
  if (!baseBranch) {
    return { ok: false, errors: { merge: ["Target branch not found"] } };
  }
  const compareCommit = (repository.commits ?? []).find(
    (candidate) => candidate.id === pr.compareCommitId,
  );
  if (!compareCommit) {
    return { ok: false, errors: { merge: ["Compare commit not found"] } };
  }
  const baseCommit = (repository.commits ?? []).find(
    (candidate) => candidate.id === baseBranch.commitId,
  );
  const now = new Date().toISOString();
  const mergeCommit = makeSeedCommit({
    repositoryId: repository.id,
    parentId: baseBranch.commitId,
    parentFiles: baseCommit ? baseCommit.files ?? [] : [],
    authorAccountId: accountId ?? null,
    authorName: authorName ?? accountName(state, accountId),
    message: `Merge pull request #${pr.number} from ${pr.compareBranch} into ${pr.baseBranch}`,
    createdAt: now,
    files: (compareCommit.files ?? []).map((file) => ({ path: file.path, content: file.content })),
  });
  mergeCommit.secondParentId = pr.compareCommitId;
  repository.commits = [...(repository.commits ?? []), mergeCommit];
  baseBranch.commitId = mergeCommit.id;
  repository.updatedAt = now;
  pr.status = "merged";
  pr.mergedAt = now;
  pr.mergeCommitId = mergeCommit.id;
  pr.mergedByAccountId = accountId ?? null;
  pr.updatedAt = now;
  pr.activities = [
    ...(pr.activities ?? []),
    {
      id: `activity_${randomUUID()}`,
      type: "merged",
      actorAccountId: accountId ?? null,
      createdAt: now,
    },
  ];
  return { ok: true, pr, mergeCommitId: mergeCommit.id };
}

/** The branch-protection rules of one repository for display. */
export function protectionRulesFor(state, repositoryId) {
  return (state.branchProtectionRules ?? [])
    .filter((rule) => rule.repositoryId === repositoryId)
    .map((rule) => ({
      branch: rule.branch,
      requireApproval: Boolean(rule.requireApproval),
      requireStatusCheck: Boolean(rule.requireStatusCheck),
    }))
    .sort((a, b) => a.branch.localeCompare(b.branch));
}

/**
 * Creates or updates the branch protection rule for one exact branch name
 * (REQ-6-1). Only a repository Admin (or organization Owner) may do this.
 * The rule stores the branch name and the two independently selectable
 * requirement toggles; the matching branch is marked protected so direct
 * writes are blocked while the rule exists.
 */
export function upsertProtectionRule(
  state,
  repository,
  { accountId, branch, requireApproval, requireStatusCheck } = {},
) {
  if (effectiveRepositoryRole(state, accountId, repository) !== "admin") {
    return { ok: false, forbidden: true };
  }
  const name = typeof branch === "string" ? branch.trim() : "";
  if (!name) {
    return { ok: false, errors: { branch: "Branch name pattern is required" } };
  }
  const now = new Date().toISOString();
  const existing = (state.branchProtectionRules ?? []).find(
    (rule) => rule.repositoryId === repository.id && rule.branch === name,
  );
  let rule;
  if (existing) {
    existing.requireApproval = Boolean(requireApproval);
    existing.requireStatusCheck = Boolean(requireStatusCheck);
    existing.updatedAt = now;
    rule = existing;
  } else {
    rule = {
      id: `rule_${randomUUID()}`,
      repositoryId: repository.id,
      branch: name,
      requireApproval: Boolean(requireApproval),
      requireStatusCheck: Boolean(requireStatusCheck),
      createdByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    };
    state.branchProtectionRules.push(rule);
  }
  const branchRecord = findBranch(repository, name);
  if (branchRecord && !branchRecord.protected) {
    branchRecord.protected = true;
  }
  return { ok: true, rule };
}

/**
 * True when the PR's stored current compare commit is behind its compare
 * branch head; the caller then persists the sync inside a store update.
 */
export function pullRequestNeedsSync(state, repository, pr) {
  const branch = findBranch(repository, pr.compareBranch);
  if (!branch || !branch.commitId) return false;
  return branch.commitId !== pr.compareCommitId;
}
export function syncPullRequestsToBranches(state, repository) {
  let changed = false;
  for (const pr of state.pullRequests ?? []) {
    if (pr.repositoryId !== repository.id) continue;
    const branch = findBranch(repository, pr.compareBranch);
    if (branch && branch.commitId && branch.commitId !== pr.compareCommitId) {
      pr.compareCommitId = branch.commitId;
      changed = true;
    }
  }
  return changed;
}

/** The full detail payload of one pull request for its detail page. */
export function pullRequestDetail(state, repository, pr, accountId) {
  const comparison = compareBranches(state, repository, pr.baseBranch, pr.compareBranch);
  const currentCheck = testCheckForCommit(pr, pr.compareCommitId);
  const check = currentCheck
    ? {
        name: currentCheck.name,
        status: currentCheck.status,
        setter: currentCheck.setterAccountId
          ? { username: accountName(state, currentCheck.setterAccountId) }
          : null,
        setAt: currentCheck.setAt ?? null,
      }
    : { name: "test", status: "pending", setter: null, setAt: null };
  const reviews = (pr.reviews ?? [])
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((review) => ({
      id: review.id,
      author: { username: accountName(state, review.accountId) },
      decision: review.decision,
      commitId: review.commitId,
      explanation: review.explanation ?? "",
      createdAt: review.createdAt,
      stale: review.commitId !== pr.compareCommitId,
    }));
  const inlineComments = (pr.inlineComments ?? [])
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((comment) => ({
      id: comment.id,
      author: { username: accountName(state, comment.accountId) },
      path: comment.path,
      line: comment.line,
      commitId: comment.commitId,
      body: comment.body,
      published: comment.published === true,
      outdated: comment.commitId !== pr.compareCommitId,
      createdAt: comment.createdAt,
    }));
  const reviewerRequests = (pr.reviewerRequests ?? [])
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((request) => ({
      id: request.id,
      username: accountName(state, request.accountId),
      requestedBy: { username: accountName(state, request.requestedByAccountId) },
      createdAt: request.createdAt,
    }));
  // Effective review summary: each reviewer's latest decision on the current
  // compare commit only.
  const latestByReviewer = new Map();
  for (const review of pr.reviews ?? []) {
    if (review.commitId !== pr.compareCommitId) continue;
    const existing = latestByReviewer.get(review.accountId);
    if (!existing || review.createdAt > existing.createdAt) {
      latestByReviewer.set(review.accountId, review);
    }
  }
  const reviewSummary = [...latestByReviewer.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((review) => ({
      id: review.id,
      author: { username: accountName(state, review.accountId) },
      decision: review.decision,
      explanation: review.explanation ?? "",
      createdAt: review.createdAt,
    }));
  const activities = (pr.activities ?? [])
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((activity) => ({
      id: activity.id,
      type: activity.type,
      actor: { username: accountName(state, activity.actorAccountId) },
      createdAt: activity.createdAt,
    }));
  const comments = (pr.comments ?? [])
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((comment) => ({
      id: comment.id,
      author: { username: accountName(state, comment.accountId) },
      body: comment.body,
      createdAt: comment.createdAt,
    }));
  return {
    number: pr.number,
    title: pr.title,
    description: pr.description ?? "",
    status: pr.status,
    author: { username: accountName(state, pr.authorAccountId) },
    baseBranch: pr.baseBranch,
    compareBranch: pr.compareBranch,
    baseCommitId: pr.baseCommitId,
    compareCommitId: pr.compareCommitId,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt ?? null,
    mergedBy: pr.mergedByAccountId
      ? { username: accountName(state, pr.mergedByAccountId) }
      : null,
    mergeCommitId: pr.mergeCommitId ?? null,
    check,
    reviews,
    inlineComments,
    reviewers: reviewerRequests,
    reviewSummary,
    reviewerCandidates: eligibleReviewers(state, repository, pr),
    comments,
    activities,
    commits: comparison?.commits ?? [],
    files: comparison?.files ?? [],
    merge: mergeEligibility(state, repository, pr),
    currentRole: effectiveRepositoryRole(state, accountId, repository),
    canClose: canClosePullRequest(state, repository, pr, accountId),
    canReview: canReviewPullRequest(state, repository, pr, accountId),
    canMerge: canMergePullRequest(state, accountId, repository),
    canRequestReviewers: canRequestReviewers(state, repository, pr, accountId),
  };
}

/**
 * Seeds the REQ-6 pull requests into the public personal `acme-docs`
 * repository (the repository that carries the `main`, `feature-search`,
 * `release`, `draft-feature`, `feature-review`, `review-candidate`,
 * `merge-ready`, and `merge-blocked` branches): an Open PR `Improve onboarding`
 * (main ← release) with one discussion comment, a Closed PR `Fix search`
 * (main ← feature-search), a Draft PR `Draft onboarding update`
 * (main ← draft-feature) that is ready for review (REQ-6-2-4), and the
 * REQ-6-3/6-4/6-5 scenario PRs: an Open PR for pending review comments
 * (main ← feature-review), an Open PR for Request-changes submission
 * (main ← review-candidate), an Open merge-eligible PR (main ← merge-ready)
 * with one non-author Approve and `test` success, and an Open merge-blocked
 * PR (main ← merge-blocked) without approval. `main` carries a pre-seeded
 * branch-protection rule (Require 1 approval + Require status check test) so
 * the merge scenario states exist on arrival; the Open PR's current compare
 * commit starts with the `test` check pending. Only runs when no pull request
 * exists yet so user changes survive restarts.
 */
export function seedPullRequests(state) {
  if ((state.pullRequests ?? []).length > 0) return;
  const alice = state.accounts.find((account) => account.username === "alice-dev");
  const bob = state.accounts.find((account) => account.username === "bob-reviewer");
  if (!alice) return;
  const repository = state.repositories.find(
    (candidate) => candidate.ownerType === "account" && candidate.name === "acme-docs",
  );
  if (!repository) return;
  const main = findBranch(repository, "main");
  const release = findBranch(repository, "release");
  const feature = findBranch(repository, "feature-search");
  const draftFeature = findBranch(repository, "draft-feature");
  const featureReview = findBranch(repository, "feature-review");
  const reviewCandidate = findBranch(repository, "review-candidate");
  const mergeReady = findBranch(repository, "merge-ready");
  const mergeBlocked = findBranch(repository, "merge-blocked");
  if (!main || !release || !feature || !draftFeature || !featureReview || !reviewCandidate || !mergeReady || !mergeBlocked) {
    return;
  }

  const created1 = daysAgo(1);
  const pr1 = {
    id: `pr_${randomUUID()}`,
    repositoryId: repository.id,
    number: 1,
    title: "Improve onboarding",
    description: "Improve the onboarding flow for new contributors.",
    authorAccountId: alice.id,
    status: "open",
    baseBranch: "main",
    compareBranch: "release",
    baseCommitId: main.commitId,
    compareCommitId: release.commitId,
    createdAt: created1,
    updatedAt: created1,
    closedAt: null,
    mergedAt: null,
    activities: [
      {
        id: `activity_${randomUUID()}`,
        type: "created",
        actorAccountId: alice.id,
        createdAt: created1,
      },
    ],
    reviews: [],
    inlineComments: [],
    comments: [
      {
        id: `comment_${randomUUID()}`,
        accountId: alice.id,
        body: "I will refine the search flow after this ships.",
        createdAt: daysAgo(0.5),
      },
    ],
    reviewerRequests: [],
    checks: [{ name: "test", commitId: release.commitId, status: "pending" }],
  };
  const created2 = daysAgo(4);
  const closed2 = daysAgo(3);
  const pr2 = {
    id: `pr_${randomUUID()}`,
    repositoryId: repository.id,
    number: 2,
    title: "Fix search",
    description: "Fix the search flow on the feature-search branch.",
    authorAccountId: alice.id,
    status: "closed",
    baseBranch: "main",
    compareBranch: "feature-search",
    baseCommitId: main.commitId,
    compareCommitId: feature.commitId,
    createdAt: created2,
    updatedAt: closed2,
    closedAt: closed2,
    mergedAt: null,
    activities: [
      {
        id: `activity_${randomUUID()}`,
        type: "created",
        actorAccountId: alice.id,
        createdAt: created2,
      },
      {
        id: `activity_${randomUUID()}`,
        type: "closed",
        actorAccountId: alice.id,
        createdAt: closed2,
      },
    ],
    reviews: [],
    inlineComments: [],
    comments: [],
    reviewerRequests: [],
    checks: [{ name: "test", commitId: feature.commitId, status: "pending" }],
  };
  const created3 = daysAgo(2);
  const pr3 = {
    id: `pr_${randomUUID()}`,
    repositoryId: repository.id,
    number: 3,
    title: "Draft onboarding update",
    description: "Refresh the onboarding steps before opening the review.",
    authorAccountId: alice.id,
    status: "draft",
    baseBranch: "main",
    compareBranch: "draft-feature",
    baseCommitId: main.commitId,
    compareCommitId: draftFeature.commitId,
    createdAt: created3,
    updatedAt: created3,
    closedAt: null,
    mergedAt: null,
    activities: [
      {
        id: `activity_${randomUUID()}`,
        type: "created",
        actorAccountId: alice.id,
        createdAt: created3,
      },
    ],
    reviews: [],
    comments: [],
    checks: [{ name: "test", commitId: draftFeature.commitId, status: "pending" }],
  };
  const now = new Date().toISOString();
  const created4 = daysAgo(0.8);
  const pr4 = {
    id: `pr_${randomUUID()}`,
    repositoryId: repository.id,
    number: 4,
    title: "Pending review comment",
    description: "Review draft comments land here before a review is submitted.",
    authorAccountId: alice.id,
    status: "open",
    baseBranch: "main",
    compareBranch: "feature-review",
    baseCommitId: main.commitId,
    compareCommitId: featureReview.commitId,
    createdAt: created4,
    updatedAt: created4,
    closedAt: null,
    mergedAt: null,
    activities: [
      {
        id: `activity_${randomUUID()}`,
        type: "created",
        actorAccountId: alice.id,
        createdAt: created4,
      },
    ],
    reviews: [],
    inlineComments: [],
    comments: [],
    reviewerRequests: [],
    checks: [{ name: "test", commitId: featureReview.commitId, status: "pending" }],
  };
  const created5 = daysAgo(0.7);
  const pr5 = {
    id: `pr_${randomUUID()}`,
    repositoryId: repository.id,
    number: 5,
    title: "Review candidate update",
    description: "A review decision can be submitted on this pull request.",
    authorAccountId: alice.id,
    status: "open",
    baseBranch: "main",
    compareBranch: "review-candidate",
    baseCommitId: main.commitId,
    compareCommitId: reviewCandidate.commitId,
    createdAt: created5,
    updatedAt: created5,
    closedAt: null,
    mergedAt: null,
    activities: [
      {
        id: `activity_${randomUUID()}`,
        type: "created",
        actorAccountId: alice.id,
        createdAt: created5,
      },
    ],
    reviews: [],
    inlineComments: [],
    comments: [],
    reviewerRequests: [],
    checks: [{ name: "test", commitId: reviewCandidate.commitId, status: "pending" }],
  };
  const created6 = daysAgo(0.6);
  const pr6 = {
    id: `pr_${randomUUID()}`,
    repositoryId: repository.id,
    number: 6,
    title: "Merge onboarding improvements",
    description: "Eligible merge target: approved and checks passing.",
    authorAccountId: alice.id,
    status: "open",
    baseBranch: "main",
    compareBranch: "merge-ready",
    baseCommitId: main.commitId,
    compareCommitId: mergeReady.commitId,
    createdAt: created6,
    updatedAt: created6,
    closedAt: null,
    mergedAt: null,
    activities: [
      {
        id: `activity_${randomUUID()}`,
        type: "created",
        actorAccountId: alice.id,
        createdAt: created6,
      },
    ],
    reviews: bob
      ? [
          {
            id: `review_${randomUUID()}`,
            accountId: bob.id,
            decision: "approve",
            commitId: mergeReady.commitId,
            explanation: "The release notes look good.",
            createdAt: daysAgo(0.3),
          },
        ]
      : [],
    inlineComments: [],
    comments: [],
    reviewerRequests: [],
    checks: [
      {
        name: "test",
        commitId: mergeReady.commitId,
        status: "success",
        setterAccountId: alice.id,
        setAt: daysAgo(0.3),
      },
    ],
  };
  const created7 = daysAgo(0.5);
  const pr7 = {
    id: `pr_${randomUUID()}`,
    repositoryId: repository.id,
    number: 7,
    title: "Merge blocked update",
    description: "Blocked by branch protection until a valid approval exists.",
    authorAccountId: alice.id,
    status: "open",
    baseBranch: "main",
    compareBranch: "merge-blocked",
    baseCommitId: main.commitId,
    compareCommitId: mergeBlocked.commitId,
    createdAt: created7,
    updatedAt: created7,
    closedAt: null,
    mergedAt: null,
    activities: [
      {
        id: `activity_${randomUUID()}`,
        type: "created",
        actorAccountId: alice.id,
        createdAt: created7,
      },
    ],
    reviews: [],
    inlineComments: [],
    comments: [],
    reviewerRequests: [],
    checks: [{ name: "test", commitId: mergeBlocked.commitId, status: "pending" }],
  };
  state.pullRequests.push(pr1, pr2, pr3, pr4, pr5, pr6, pr7);
  // The pre-seeded REQ-6-5 merge state: `main` is protected by a rule that
  // requires 1 approval and the `test` check, so the eligible PR can be
  // merged while the blocked PR explains its missing approval.
  if (!(state.branchProtectionRules ?? []).some((rule) => rule.repositoryId === repository.id && rule.branch === "main")) {
    state.branchProtectionRules.push({
      id: `rule_${randomUUID()}`,
      repositoryId: repository.id,
      branch: "main",
      requireApproval: true,
      requireStatusCheck: true,
      createdByAccountId: alice.id,
      createdAt: now,
      updatedAt: now,
    });
  }
  main.protected = true;
}
