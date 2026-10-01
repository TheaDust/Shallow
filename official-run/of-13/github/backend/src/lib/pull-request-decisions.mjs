// The persisted review decisions and status checks of one pull request.
//
// A review decision counts only while it belongs to the current compare commit
// (a new commit of the compare branch makes every earlier decision stale), was
// not replaced by a newer decision of the same reviewer for that very commit
// and was not marked stale in the stored record. The `test` status check always
// belongs to the current compare commit of the pull request: a commit without a
// stored result starts as `pending`, so a new compare commit can never reuse
// the status of the previous one. These readers are shared by the pull-request
// model, the transition service, the review service, the Checks area and the
// branch-protection rules; only `pull-requests.mjs` decides the current compare
// commit of a record, so every reader receives an already resolved record.

import { collection } from "./repository-code.mjs";

/** The one status check this product supports. */
export const CHECK_NAME = "test";
export const CHECK_STATUSES = ["pending", "success", "failure"];
export const DEFAULT_CHECK_STATUS = "pending";

export function usernameOf(state, accountId) {
  return (
    collection(state, "accounts").find((account) => account.id === accountId)?.username ?? null
  );
}

/** Every stored status check of one compare commit, in insertion order. */
export function checkRecordsOf(state, pullRequest) {
  return collection(state, "pullRequestChecks").filter(
    (check) =>
      check.pullRequestId === pullRequest.id &&
      check.commitId === (pullRequest.compareCommitId ?? null),
  );
}

/**
 * The `test` status of the current compare commit together with its setter and
 * time. A commit the area has never stored a result for answers `pending`, so
 * a fresh compare commit always starts as pending.
 */
export function testCheckPayload(state, pullRequest) {
  const stored =
    checkRecordsOf(state, pullRequest).find((check) => check.name === CHECK_NAME) ?? null;
  return {
    id: stored?.id ?? `pull-request-check-${pullRequest.id}-${CHECK_NAME}`,
    name: CHECK_NAME,
    status: stored?.status ?? DEFAULT_CHECK_STATUS,
    commitId: pullRequest.compareCommitId ?? null,
    updatedBy: stored?.updatedById ? usernameOf(state, stored.updatedById) : null,
    updatedAt: stored?.updatedAt ?? null,
  };
}

export function testStatusOf(state, pullRequest) {
  return testCheckPayload(state, pullRequest).status;
}

/** The status checks of the current compare commit, as the Checks area reads them. */
export function checkPayloadsOf(state, pullRequest) {
  return [testCheckPayload(state, pullRequest)];
}

/** Every stored review record of one pull request, oldest first. */
export function reviewsOf(state, pullRequestId) {
  return collection(state, "pullRequestReviews")
    .filter((review) => review.pullRequestId === pullRequestId)
    .slice()
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

/** A stored decision of an earlier compare commit never counts any more. */
export function isStaleReview(review, pullRequest) {
  return review.stale === true || review.commitId !== (pullRequest.compareCommitId ?? null);
}

/** An inline comment of an earlier compare commit stays readable as `Outdated`. */
export function isOutdatedComment(comment, pullRequest) {
  return comment.outdated === true || comment.commitId !== (pullRequest.compareCommitId ?? null);
}

/** The decisions of the current compare commit that still count. */
export function effectiveReviews(state, pullRequest) {
  return reviewsOf(state, pullRequest.id).filter(
    (review) => review.superseded !== true && !isStaleReview(review, pullRequest),
  );
}

/** The decisions of the effective reviews of the current compare commit. */
export function effectiveDecisions(state, pullRequest) {
  return effectiveReviews(state, pullRequest).map((review) => review.decision);
}

/**
 * The effective review state of one pull request: a valid `Request changes`
 * blocks the merge, otherwise a valid `Approve` approves it.
 */
export function reviewStatusOf(state, pullRequest) {
  const decisions = effectiveDecisions(state, pullRequest);
  if (decisions.includes("changes_requested")) return "changes_requested";
  if (decisions.includes("approved")) return "approved";
  return "review_required";
}

/**
 * The accounts whose current decision on the current compare commit approves
 * the pull request. The author of the pull request can never satisfy the
 * approval requirement, not even with their own stored decision.
 */
export function approversOf(state, pullRequest) {
  const reviewers = effectiveReviews(state, pullRequest)
    .filter((review) => review.decision === "approved")
    .map((review) => review.reviewerId);
  return [...new Set(reviewers)].filter(
    (reviewerId) => reviewerId && reviewerId !== pullRequest.authorId,
  );
}
