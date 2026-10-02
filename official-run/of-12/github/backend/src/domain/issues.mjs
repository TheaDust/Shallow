/**
 * Issue read model and permission rules (REQ-5, REQ-5-1).
 *
 * An issue is a persistent work item of exactly one repository, identified by a
 * number unique within that repository. The record keeps its title, its
 * description, its status, its author, the labels and assignees it references,
 * the milestone it belongs to, its comments and its append-only activity
 * timeline, so the list page and the detail page read the same stored data.
 *
 * The role lists below are operation-specific, not a cumulative ladder
 * (REQ-5): Write, Maintain and Admin may create issues, edit titles and
 * descriptions and comment, while Triage, Maintain and Admin may assign
 * participants, apply labels, set milestones and close or reopen an issue. Read
 * may only view. An organization Owner holds an Admin repository role, so the
 * Owner qualifies for both lists through `effectiveRepositoryRole`.
 */

import { effectiveRepositoryRole } from "./repository-access.mjs";

/** Roles that may create, edit and comment (REQ-5). */
export const ISSUE_CONTENT_ROLES = ["Write", "Maintain", "Admin"];

/** Roles that may assign, label, set a milestone and change the status (REQ-5). */
export const ISSUE_TRIAGE_ROLES = ["Triage", "Maintain", "Admin"];

/**
 * Roles an account of the repository may hold to be picked as an assignee
 * (REQ-5-3-1): every role of at least Triage permission — that is, every role
 * above Read. The rank list makes the “at least” relation explicit instead of
 * reproducing a role ladder by name.
 */
export const ISSUE_ASSIGNABLE_ROLES = ["Triage", "Write", "Maintain", "Admin"];

/** The length and text rules of an issue title, a description and a comment. */
export const ISSUE_TITLE_MAX = 256;
export const ISSUE_BODY_MAX = 65536;
export const COMMENT_MAX = 65536;

/**
 * The reaction types a signed-in viewer may attach to an issue or a comment
 * (REQ-5-2-3). They are stored as the “subject-target-reaction type”
 * association and rendered by their emoji.
 */
export const REACTION_TYPES = ["👍", "👎", "😄", "🎉", "😕", "❤", "🚀", "👀"];

/** Verbatim messages of the issue workflow (REQ-5-2). */
export const ISSUE_MESSAGES = {
  titleRequired: "Title is required",
  titleTooLong: `Title must be ${ISSUE_TITLE_MAX} characters or fewer`,
  descriptionTooLong: `Description must be ${ISSUE_BODY_MAX} characters or fewer`,
  commentRequired: "Comment is required",
  commentTooLong: `Comment must be ${COMMENT_MAX} characters or fewer`,
  issueNotFound: "Issue not found",
  createForbidden: "You need write access to create an issue in this repository",
  editForbidden: "You do not have permission to edit this issue",
  commentForbidden: "You do not have permission to comment on this issue",
  reactionForbidden: "You do not have permission to react on this issue",
  unknownReaction: "Unknown reaction",
  commentNotFound: "Comment not found",
  metadataForbidden: "You do not have permission to change the issue metadata",
  statusForbidden: "You do not have permission to change the issue status",
  unknownAssignee: "No account with that username is an assignable member of this repository",
  unknownLabel: "Unknown label",
  unknownMilestone: "Unknown milestone",
  unknownStatus: "Unknown status",
};

/** The two stored statuses of a work item (REQ-5-4). */
export const ISSUE_STATUSES = ["open", "closed"];

function trimmedText(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/** The stored title of a raw submission, or null when it is invalid. */
export function issueTitleError(raw) {
  const title = trimmedText(raw);
  if (title.length === 0) return ISSUE_MESSAGES.titleRequired;
  if (title.length > ISSUE_TITLE_MAX) return ISSUE_MESSAGES.titleTooLong;
  return null;
}

/** The description is optional: only its length is constrained (REQ-5-2). */
export function issueDescriptionError(raw) {
  const description = typeof raw === "string" ? raw : "";
  if (description.length > ISSUE_BODY_MAX) return ISSUE_MESSAGES.descriptionTooLong;
  return null;
}

/** A comment needs 1–65536 non-empty characters after trimming. */
export function commentError(raw) {
  const comment = trimmedText(raw);
  if (comment.length === 0) return ISSUE_MESSAGES.commentRequired;
  if (comment.length > COMMENT_MAX) return ISSUE_MESSAGES.commentTooLong;
  return null;
}

export function normalizeIssueTitle(raw) {
  return trimmedText(raw);
}

export function normalizeIssueDescription(raw) {
  return typeof raw === "string" ? raw : "";
}

export function normalizeCommentBody(raw) {
  return trimmedText(raw);
}

function includesRole(roles, role) {
  return role !== null && role !== undefined && roles.includes(role);
}

/**
 * What the caller may do with the issues of this repository. Every operation is
 * answered separately, so a Write collaborator can comment without being
 * allowed to label, assign or close.
 */
export function issuePermissions(data, repository, accountId = null) {
  const role = effectiveRepositoryRole(data, repository, accountId);
  return {
    canCreateIssue: includesRole(ISSUE_CONTENT_ROLES, role),
    canEditIssue: includesRole(ISSUE_CONTENT_ROLES, role),
    canComment: includesRole(ISSUE_CONTENT_ROLES, role),
    canAssignParticipants: includesRole(ISSUE_TRIAGE_ROLES, role),
    canApplyLabels: includesRole(ISSUE_TRIAGE_ROLES, role),
    canSetMilestone: includesRole(ISSUE_TRIAGE_ROLES, role),
    canChangeStatus: includesRole(ISSUE_TRIAGE_ROLES, role),
  };
}

export function issueStatus(issue) {
  return issue?.status === "closed" ? "closed" : "open";
}

/**
 * The accounts that may be assigned to an issue of this repository (REQ-5-3-1):
 * every account holding at least Triage permission on it. An account without a
 * repository role — or with Read only — is not an assignable member and never
 * appears among the options, so the assignee selector cannot grant access.
 */
export function repositoryAssignableMembers(data, repository) {
  return (data.accounts ?? [])
    .filter((account) => ISSUE_ASSIGNABLE_ROLES.includes(effectiveRepositoryRole(data, repository, account.id)))
    .map((account) => account.username)
    .sort((left, right) => left.localeCompare(right));
}

function byCreatedAt(left, right) {
  return String(left?.createdAt ?? "").localeCompare(String(right?.createdAt ?? ""))
    || String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

/** Every issue of a repository, ordered by its repository-scoped number. */
export function repositoryIssues(data, repository) {
  if (!repository) return [];
  return (data.issues ?? [])
    .filter((issue) => issue.repositoryId === repository.id)
    .slice()
    .sort((left, right) => (left.number ?? 0) - (right.number ?? 0));
}

/** The issue carrying this number inside the repository, or null. */
export function findRepositoryIssue(data, repository, number) {
  if (!Number.isInteger(number)) return null;
  return repositoryIssues(data, repository).find((issue) => issue.number === number) ?? null;
}

/** The stored comments of an issue, oldest first. */
export function issueComments(issue) {
  return (issue?.comments ?? []).slice().sort(byCreatedAt);
}

/** The stored activity of an issue, oldest first (append-only history). */
export function issueTimeline(issue) {
  return (issue?.timeline ?? []).slice().sort(byCreatedAt);
}

/**
 * The reactions attached to one target of an issue, summed by type and flagged
 * for the caller (REQ-5-2-3): a stored association belongs to exactly one
 * account, one target and one reaction type, and a second selection removes it.
 */
export function reactionTally(reactions, targetType, targetId, accountId = null) {
  const counts = new Map();
  for (const reaction of reactions ?? []) {
    if (reaction?.targetType !== targetType || reaction?.targetId !== targetId) continue;
    const current = counts.get(reaction.type) ?? { type: reaction.type, count: 0, mine: false };
    current.count += 1;
    if (accountId && reaction.accountId === accountId) current.mine = true;
    counts.set(reaction.type, current);
  }
  const known = REACTION_TYPES.filter((type) => counts.has(type)).map((type) => counts.get(type));
  const extra = [...counts.values()].filter((entry) => !REACTION_TYPES.includes(entry.type));
  return [...known, ...extra];
}

/** The pre-existing colored label names of a repository (REQ-5). */
export function repositoryLabels(repository) {
  return (repository?.labels ?? []).map((label) => ({
    name: label.name,
    color: label.color ?? "",
    description: label.description ?? "",
  }));
}

/** The pre-existing milestone items of a repository (REQ-5). */
export function repositoryMilestones(repository) {
  return (repository?.milestones ?? []).map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    state: milestone.state ?? "open",
    description: milestone.description ?? "",
  }));
}

/**
 * The list row of an issue: the repository-scoped number, title, status, author,
 * labels and update time, plus the searchable body text the keyword filter
 * matches and the number of stored comments.
 */
export function issueSummary(issue) {
  return {
    number: issue.number,
    title: issue.title ?? "",
    body: issue.body ?? "",
    status: issueStatus(issue),
    author: issue.author ?? "",
    labels: [...(issue.labels ?? [])],
    assignees: [...(issue.assignees ?? [])],
    milestone: issue.milestone ?? null,
    createdAt: issue.createdAt ?? null,
    updatedAt: issue.updatedAt ?? issue.createdAt ?? null,
    commentCount: (issue.comments ?? []).length,
  };
}
