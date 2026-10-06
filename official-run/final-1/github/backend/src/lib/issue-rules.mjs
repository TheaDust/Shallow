// Input rules and exact messages of the issue operations (REQ-5). Kept in one
// module so the frontend-visible contract and the server validation of titles,
// descriptions and comments cannot drift apart.

export const ISSUE_TITLE_MAX = 256;
export const ISSUE_BODY_MAX = 65536;

/**
 * The reaction types a signed-in viewer may choose (REQ-5-5). The list is the
 * single source of the offered `menuitem` choices and of the server check, so a
 * type the menu never offers can never be stored.
 */
export const REACTION_TYPES = ["+1"];

/** True only for a reaction type this product defines. */
export function isValidReactionType(raw) {
  return typeof raw === "string" && REACTION_TYPES.includes(raw);
}

export const ISSUE_MESSAGES = {
  titleRequired: "Title is required",
  titleTooLong: "Title must be 256 characters or fewer",
  descriptionTooLong: "Description must be 65536 characters or fewer",
  commentRequired: "Comment is required",
  commentTooLong: "Comment must be 65536 characters or fewer",
  issueNotFound: "Issue not found",
  assigneeInvalid: "Assignee is invalid",
  labelInvalid: "Label is invalid",
  milestoneInvalid: "Milestone is invalid",
  statusInvalid: "Status is invalid",
  reactionInvalid: "Reaction is invalid",
};

/** "ok", "required" or "too-long": 1-256 non-empty characters after trimming. */
export function validateIssueTitle(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return "required";
  if (value.length > ISSUE_TITLE_MAX) return "too-long";
  return "ok";
}

/** The description may be empty and is at most 65536 characters. */
export function validateIssueDescription(raw) {
  if (raw === undefined || raw === null) return true;
  const value = typeof raw === "string" ? raw : "";
  return value.length <= ISSUE_BODY_MAX;
}

/** "ok", "required" or "too-long": 1-65536 non-empty characters after trimming. */
export function validateIssueComment(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return "required";
  if (value.length > ISSUE_BODY_MAX) return "too-long";
  return "ok";
}

/** The only issue statuses a transition may store: the `open`/`closed` pair. */
export function isValidIssueStatus(raw) {
  return raw === "open" || raw === "closed";
}
