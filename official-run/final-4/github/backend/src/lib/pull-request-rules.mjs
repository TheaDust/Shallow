// Input rules and exact user-visible messages of the pull-request operations
// (REQ-6). Kept in one module so the frontend-visible contract and the
// server-side validation cannot drift apart.

export const PULL_TITLE_MAX = 256;
export const PULL_BODY_MAX = 65536;

export const PULL_MESSAGES = {
  titleRequired: "Title is required",
  titleTooLong: "Title must be 256 characters or fewer",
  descriptionTooLong: "Description must be 65536 characters or fewer",
  branchMissing: "Branch not found",
  identical: "No differences between these branches",
  statusInvalid: "Status is invalid",
  transitionInvalid: "Status transition is not allowed",
  pullNotFound: "Pull request not found",
  checkMissing: "Check not found",
  checkStatusInvalid: "Check status is invalid",
  reviewNotAllowed: "Review is not allowed",
  commentRequired: "Comment is required",
  mergeNotAllowed: "This pull request cannot be merged",
  decisionInvalid: "Review decision is invalid",
  summaryTooLong: "Review summary must be 65536 characters or fewer",
  reviewerInvalid: "Reviewer is invalid",
};

/**
 * The exact reasons a merge is refused (REQ-6-5). `reviewRequired` is the
 * message a missing protected-branch approval must display before any click.
 */
export const MERGE_MESSAGES = {
  notOpen: "This pull request cannot be merged",
  archived: "Repository is archived",
  conflict: "This branch has conflicts that must be resolved",
  changesRequested: "Changes requested",
  reviewRequired: "Review required by branch protection",
  checkRequired: "Required status check is not successful",
  branchMissing: "Branch not found",
};

/** The persisted review decisions of the compare revision (REQ-6-3-4). */
export const REVIEW_DECISIONS = ["approved", "changes-requested"];

/** The only persisted statuses of a pull request (Merged is terminal). */
export const PULL_STATUSES = ["draft", "open", "closed", "merged"];

/** The transitions the status route accepts. */
export const PULL_TRANSITIONS = ["open", "closed"];

/** Statuses a check of the compare commit may carry. */
export const CHECK_STATUSES = ["pending", "success", "failure"];

/** "ok", "required" or "too-long": 1-256 non-empty characters after trimming. */
export function validatePullTitle(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return "required";
  if (value.length > PULL_TITLE_MAX) return "too-long";
  return "ok";
}

/** The description may be empty and is at most 65536 characters. */
export function validatePullDescription(raw) {
  if (raw === undefined || raw === null) return true;
  return (typeof raw === "string" ? raw : "").length <= PULL_BODY_MAX;
}

/** A review line comment is 1-65536 non-empty characters after trimming. */
export function validateReviewComment(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return "required";
  if (value.length > PULL_BODY_MAX) return "too-long";
  return "ok";
}

export function isValidPullTransition(raw) {
  return PULL_TRANSITIONS.includes(raw);
}

export function isValidCheckStatus(raw) {
  return CHECK_STATUSES.includes(raw);
}

/** One submitted review decision is `approved` or `changes-requested`. */
export function isValidReviewDecision(raw) {
  return REVIEW_DECISIONS.includes(raw);
}

/** The optional review summary may be empty and is at most 65536 characters. */
export function validateReviewSummary(raw) {
  if (raw === undefined || raw === null) return true;
  return (typeof raw === "string" ? raw : "").length <= PULL_BODY_MAX;
}
