import { randomUUID } from "node:crypto";

import { effectiveRepositoryRole } from "./organizations.mjs";
import { compareBranches, findBranch } from "./vcs.mjs";
import { PULL_DESCRIPTION_MAX, REVIEW_DECISIONS } from "./pulls.mjs";

/** Roles allowed to review and comment on pull requests (REQ-6-3). */
export const REVIEW_WRITE_ROLES = new Set(["write", "maintain", "admin"]);

/** Roles allowed to merge an eligible pull request (REQ-6-5). */
const MERGE_ROLES = new Set(["maintain", "admin"]);

/**
 * Review capability for one pull request (REQ-6-3): a user with Write,
 * Maintain, or Admin who is not the PR author may comment on an Open PR and
 * submit Comment/Approve/Request changes. Draft pull requests do not allow
 * review submission or inline comments.
 */
export function canReviewPullRequest(state, repository, pr, accountId) {
  if (!accountId || !repository || !pr) return false;
  if (pr.status !== "open") return false;
  if (pr.authorAccountId === accountId) return false;
  return REVIEW_WRITE_ROLES.has(effectiveRepositoryRole(state, accountId, repository));
}

/**
 * Merge capability (REQ-6-5): only Maintain, Admin, or organization Owner may
 * merge from the PR detail page. The status check happens separately.
 */
export function canMergePullRequest(state, accountId, repository) {
  if (!accountId || !repository) return false;
  return MERGE_ROLES.has(effectiveRepositoryRole(state, accountId, repository));
}

/**
 * Reviewer-request capability (REQ-6-4): the author of an Open or Draft PR,
 * Maintain, Admin, or organization Owner may create or delete the request.
 * The Open/Draft qualifier applies to the PR-author capability; Maintain,
 * Admin, and organization Owner hold the capability by role regardless of
 * PR status, and each listed role is an independent grant.
 */
export function canRequestReviewers(state, repository, pr, accountId) {
  if (!accountId || !repository || !pr) return false;
  const role = effectiveRepositoryRole(state, accountId, repository);
  if (role === "maintain" || role === "admin") return true;
  if (pr.authorAccountId === accountId) {
    return pr.status === "open" || pr.status === "draft";
  }
  return false;
}

/**
 * Accounts eligible to be requested as reviewers (REQ-6-4): a distinct
 * non-author collaborator with Write, Maintain, or Admin on the repository.
 */
export function eligibleReviewers(state, repository, pr) {
  const candidates = [];
  for (const candidate of state.accounts ?? []) {
    if (pr && candidate.id === pr.authorAccountId) continue;
    const role = effectiveRepositoryRole(state, candidate.id, repository);
    if (REVIEW_WRITE_ROLES.has(role)) {
      candidates.push({ username: candidate.username });
    }
  }
  return candidates.sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * Stores one inline review comment anchored to a file path, the PR's current
 * compare commit, and a specific added/deleted line of the diff (REQ-6-3-3).
 * `startReview` keeps the comment unpublished (a pending review draft) until a
 * review is submitted; `Add single comment` publishes it immediately. The PR,
 * file path, compare commit, line position, author, body, and publication
 * state are stored together.
 */
export function addInlineComment(
  state,
  repository,
  pr,
  { accountId, path, line, body, startReview = false } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  if (!canReviewPullRequest(state, repository, pr, accountId)) {
    return { ok: false, forbidden: true };
  }
  const errors = {};
  const filePath = typeof path === "string" ? path : "";
  const comparison = compareBranches(state, repository, pr.baseBranch, pr.compareBranch);
  const file = (comparison?.files ?? []).find((candidate) => candidate.path === filePath);
  if (!file) {
    errors.path = "File is not part of this pull request";
  }
  const lineNumber = Number(line);
  if (!file || !Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > (file.lines ?? []).length) {
    errors.line = "Line is invalid";
  } else if (file.lines[lineNumber - 1].type === "context") {
    errors.line = "Line is not a changed line";
  }
  const bodyValue = typeof body === "string" ? body.trim() : "";
  if (bodyValue.length === 0) {
    errors.body = "Comment is required";
  } else if (bodyValue.length > PULL_DESCRIPTION_MAX) {
    errors.body = "Comment is too long";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  const now = new Date().toISOString();
  const comment = {
    id: `comment_${randomUUID()}`,
    accountId,
    path: filePath,
    line: lineNumber,
    commitId: pr.compareCommitId,
    body: bodyValue,
    published: startReview !== true,
    reviewId: null,
    createdAt: now,
  };
  pr.inlineComments = [...(pr.inlineComments ?? []), comment];
  pr.updatedAt = now;
  return { ok: true, comment };
}

/**
 * Submits one review decision (Comment, Approve, or Request changes) on the
 * PR's current compare commit (REQ-6-3-4). Only a non-author Write/Maintain/
 * Admin may submit on an Open PR. A new decision by the same reviewer
 * replaces that reviewer's effective decision for the current commit while
 * the old records are preserved. Submitting a review publishes every pending
 * inline comment of that reviewer (the Start a review drafts).
 */
export function submitReview(
  state,
  repository,
  pr,
  { accountId, decision, explanation } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  if (!canReviewPullRequest(state, repository, pr, accountId)) {
    return { ok: false, forbidden: true };
  }
  const errors = {};
  if (!REVIEW_DECISIONS.has(decision)) {
    errors.decision = "Decision is invalid";
  }
  const explanationValue = typeof explanation === "string" ? explanation : "";
  if (explanationValue.length > PULL_DESCRIPTION_MAX) {
    errors.explanation = "Summary is too long";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  const now = new Date().toISOString();
  const review = {
    id: `review_${randomUUID()}`,
    accountId,
    decision,
    commitId: pr.compareCommitId,
    explanation: explanationValue,
    createdAt: now,
  };
  pr.reviews = [...(pr.reviews ?? []), review];
  for (const comment of pr.inlineComments ?? []) {
    if (comment.accountId === accountId && comment.published === false) {
      comment.published = true;
      comment.reviewId = review.id;
    }
  }
  pr.updatedAt = now;
  return { ok: true, review };
}

/**
 * Creates a pending-reviewer request between a PR and a candidate reviewer
 * account (REQ-6-4), stored together with the operator and time. The author of
 * an Open or Draft PR, Maintain, Admin, or organization Owner may do this.
 */
export function requestReviewer(
  state,
  repository,
  pr,
  { accountId, username } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  if (!canRequestReviewers(state, repository, pr, accountId)) {
    return { ok: false, forbidden: true };
  }
  const target = (state.accounts ?? []).find((candidate) => candidate.username === username);
  if (!target) {
    return { ok: false, errors: { username: "Reviewer not found" } };
  }
  if (pr.authorAccountId === target.id) {
    return { ok: false, errors: { username: "The PR author cannot be requested as a reviewer" } };
  }
  const role = effectiveRepositoryRole(state, target.id, repository);
  if (!REVIEW_WRITE_ROLES.has(role)) {
    return { ok: false, errors: { username: "Reviewer is not eligible" } };
  }
  if ((pr.reviewerRequests ?? []).some((candidate) => candidate.accountId === target.id)) {
    return { ok: false, errors: { username: "Reviewer is already requested" } };
  }
  const now = new Date().toISOString();
  pr.reviewerRequests = [
    ...(pr.reviewerRequests ?? []),
    {
      id: `reviewer_request_${randomUUID()}`,
      accountId: target.id,
      requestedByAccountId: accountId,
      createdAt: now,
    },
  ];
  pr.updatedAt = now;
  return { ok: true, request: { username: target.username } };
}

/**
 * True when applying the PR's compare commit onto the current base head
 * conflicts with the base branch's own movement since the PR's creation-time
 * base commit (REQ-6-5). A conflict exists only when the base branch has
 * moved and changed one of the PR's changed files to different content than
 * the compare commit (modify/modify, add/add, or delete-vs-modify).
 */
export function mergeConflict(repository, pr) {
  const baseBranch = findBranch(repository, pr.baseBranch);
  if (!baseBranch) return true;
  const baseCommit = (repository.commits ?? []).find(
    (candidate) => candidate.id === pr.baseCommitId,
  );
  const compareCommit = (repository.commits ?? []).find(
    (candidate) => candidate.id === pr.compareCommitId,
  );
  if (!baseCommit || !compareCommit) return true;
  if (baseBranch.commitId === pr.baseCommitId) return false;
  const headCommit = (repository.commits ?? []).find(
    (candidate) => candidate.id === baseBranch.commitId,
  );
  if (!headCommit) return true;
  const baseSnapshot = new Map((baseCommit.files ?? []).map((file) => [file.path, file.content]));
  const headSnapshot = new Map((headCommit.files ?? []).map((file) => [file.path, file.content]));
  const compareSnapshot = new Map((compareCommit.files ?? []).map((file) => [file.path, file.content]));
  const paths = new Set([
    ...(baseCommit.files ?? []).map((file) => file.path),
    ...(compareCommit.files ?? []).map((file) => file.path),
  ]);
  for (const path of paths) {
    const baseContent = baseSnapshot.get(path) ?? null;
    const compareContent = compareSnapshot.get(path) ?? null;
    if (baseContent === compareContent) continue;
    const headContent = headSnapshot.get(path) ?? null;
    if (headContent !== baseContent && headContent !== compareContent) return true;
  }
  return false;
}

/**
 * Removes a pending-reviewer request (REQ-6-4). Removing a request never
 * deletes reviews, comments, or activity records already submitted by that
 * user and does not change the user's effective review decision.
 */
export function removeReviewerRequest(
  state,
  repository,
  pr,
  { accountId, username } = {},
) {
  if (!pr) return { ok: false, notFound: true };
  if (!canRequestReviewers(state, repository, pr, accountId)) {
    return { ok: false, forbidden: true };
  }
  const target = (state.accounts ?? []).find((candidate) => candidate.username === username);
  if (!target) {
    return { ok: false, errors: { username: "Reviewer not found" } };
  }
  const before = (pr.reviewerRequests ?? []).length;
  pr.reviewerRequests = (pr.reviewerRequests ?? []).filter(
    (candidate) => candidate.accountId !== target.id,
  );
  if (pr.reviewerRequests.length === before) {
    return { ok: false, errors: { username: "No review request exists" } };
  }
  pr.updatedAt = new Date().toISOString();
  return { ok: true, request: { username: target.username } };
}
