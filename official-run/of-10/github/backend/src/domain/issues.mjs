/**
 * Repository issues: the persistent work items of one repository (REQ-5).
 *
 * An issue is stored once per repository with a repository-scoped number, and
 * the list page and the detail page are two readings of that same record. Its
 * activity timeline is append-only: creation, title/description edits, comments,
 * assignment, label, milestone and status changes are all appended as records
 * that are never rewritten, so a refused operation leaves the timeline as it was.
 *
 * Roles are asked for per operation instead of being inferred from a role name:
 * Write, Maintain and Admin may create, edit and comment, while Triage, Maintain
 * and Admin may manage the metadata and the status of an issue. An organization
 * Owner acts with Admin permission through the shared role computation.
 */

import { REPOSITORY_ROLES, effectiveRepositoryRole } from "./repository-access.mjs";

export const ISSUE_TITLE_MAX_LENGTH = 256;
export const ISSUE_BODY_MAX_LENGTH = 65536;
export const ISSUE_COMMENT_MAX_LENGTH = 65536;

/**
 * The two persisted statuses of a work item. Closing and reopening store one of
 * them together with its operator and time; nothing else of the issue changes.
 */
export const ISSUE_STATUSES = ["open", "closed"];

/**
 * The reaction types a signed-in reader may attach to an issue or to one of its
 * comments. One record per user, target and type; selecting the same one again
 * removes it instead of storing a second record.
 */
export const ISSUE_REACTION_TYPES = [
  "+1",
  "-1",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
];

/** The exact messages of this feature; each is shown verbatim in the page. */
export const ISSUE_MESSAGES = {
  titleRequired: "Title is required",
  titleTooLong: `Title must be ${ISSUE_TITLE_MAX_LENGTH} characters or fewer`,
  descriptionTooLong: `Description must be ${ISSUE_BODY_MAX_LENGTH} characters or fewer`,
  commentRequired: "Comment is required",
  commentTooLong: `Comment must be ${ISSUE_COMMENT_MAX_LENGTH} characters or fewer`,
  reactionUnknown: "Unknown reaction",
  assigneeUnknown: "Unknown assignee",
  assigneeNotAssignable: "Not an assignable member",
  labelUnknown: "Unknown label",
  milestoneUnknown: "Unknown milestone",
  statusUnknown: "Unknown status",
  forbiddenWrite: "You need write permission to change this issue.",
  forbiddenManage: "You need triage permission to manage this issue.",
};

const WRITE_ROLES = new Set(["write", "maintain", "admin"]);
const MANAGE_ROLES = new Set(["triage", "maintain", "admin"]);

/** Write, Maintain and Admin may create issues, edit content and comment. */
export function canWriteIssues(state, repository, viewer) {
  return WRITE_ROLES.has(effectiveRepositoryRole(state, repository, viewer));
}

/** Triage, Maintain and Admin may assign, label, set a milestone and change status. */
export function canManageIssues(state, repository, viewer) {
  return MANAGE_ROLES.has(effectiveRepositoryRole(state, repository, viewer));
}

/** Normalizes a title: leading and trailing whitespace never counts. */
export function normalizeIssueTitle(value) {
  return String(value ?? "").trim();
}

/** Normalizes a description: it may be empty, its edges are trimmed. */
export function normalizeIssueDescription(value) {
  return String(value ?? "").trim();
}

export function issueTitleError(value) {
  const title = normalizeIssueTitle(value);
  if (!title) return ISSUE_MESSAGES.titleRequired;
  if (title.length > ISSUE_TITLE_MAX_LENGTH) return ISSUE_MESSAGES.titleTooLong;
  return null;
}

export function issueDescriptionError(value) {
  if (normalizeIssueDescription(value).length > ISSUE_BODY_MAX_LENGTH) {
    return ISSUE_MESSAGES.descriptionTooLong;
  }
  return null;
}

/** Normalizes a comment body: only surrounding whitespace is ignored. */
export function normalizeComment(value) {
  return String(value ?? "").trim();
}

/** The complaint of one comment body, or null when it may be stored. */
export function commentError(value) {
  const body = normalizeComment(value);
  if (!body) return ISSUE_MESSAGES.commentRequired;
  if (body.length > ISSUE_COMMENT_MAX_LENGTH) return ISSUE_MESSAGES.commentTooLong;
  return null;
}

/** Whether a value is one of the two statuses an issue can be stored in. */
export function isIssueStatus(value) {
  return ISSUE_STATUSES.includes(String(value ?? ""));
}

/** Whether a reaction type belongs to the reaction set of this feature. */
export function isReactionType(type) {
  return ISSUE_REACTION_TYPES.includes(String(type ?? ""));
}

/** A role is at least Triage when its rank reaches the Triage rank. */
function atLeastTriage(role) {
  const rank = REPOSITORY_ROLES.indexOf(role);
  return rank >= REPOSITORY_ROLES.indexOf("triage");
}

/**
 * Accounts that may be assigned to an issue of this repository: the accounts
 * that hold at least Triage permission on it. An account without any role on
 * the repository never appears here.
 */
export function assignableMemberLogins(state, repository) {
  return (state.accounts ?? [])
    .filter((account) => atLeastTriage(effectiveRepositoryRole(state, repository, account)))
    .map((account) => account.username)
    .sort((left, right) => left.localeCompare(right));
}

/** Labels configured in one repository; a label never crosses repositories. */
function repositoryLabels(state, repositoryId) {
  return (state.labels ?? []).filter((label) => label.repositoryId === repositoryId);
}

/** Milestones configured in one repository. */
function repositoryMilestones(state, repositoryId) {
  return (state.milestones ?? []).filter((milestone) => milestone.repositoryId === repositoryId);
}

/** Issues of one repository, oldest number first. */
export function issuesOfRepository(state, repositoryId) {
  return (state.issues ?? [])
    .filter((issue) => issue.repositoryId === repositoryId)
    .slice()
    .sort((left, right) => left.number - right.number);
}

/** One issue addressed by its repository-scoped number. */
export function findIssue(state, repositoryId, number) {
  const wanted = Number(number);
  if (!Number.isInteger(wanted)) return null;
  return (
    (state.issues ?? []).find(
      (issue) => issue.repositoryId === repositoryId && issue.number === wanted,
    ) ?? null
  );
}

/** The number the next issue of this repository receives. */
export function nextIssueNumber(state, repositoryId) {
  const numbers = issuesOfRepository(state, repositoryId).map((issue) => issue.number);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/** A stored issue, always Open and always with its creation activity. */
export function buildIssue({ id, repositoryId, number, title, description, authorId, createdAt }) {
  const issue = {
    id,
    repositoryId,
    number,
    title,
    description,
    status: "open",
    authorId,
    createdAt,
    updatedAt: createdAt,
    labelIds: [],
    assigneeIds: [],
    milestoneId: null,
    comments: [],
    activities: [],
  };
  appendActivity(issue, { id: `${id}-activity-1`, type: "created", actorId: authorId, createdAt });
  return issue;
}

/** Appends one immutable history record; existing records are never rewritten. */
export function appendActivity(issue, activity) {
  issue.activities = issue.activities ?? [];
  issue.activities.push(activity);
  return activity;
}

export function nextActivityId(issue) {
  return `${issue.id}-activity-${(issue.activities ?? []).length + 1}`;
}

function accountLogin(state, accountId) {
  const account = (state.accounts ?? []).find((candidate) => candidate.id === accountId);
  return account ? account.username : "";
}

/** Label badges of one issue, in the order they were configured. */
export function issueLabels(state, repositoryId, issue) {
  const configured = repositoryLabels(state, repositoryId);
  return (issue.labelIds ?? [])
    .map((id) => configured.find((label) => label.id === id) ?? null)
    .filter(Boolean)
    .map((label) => ({ id: label.id, name: label.name, color: label.color ?? "" }));
}

export function issueAssignees(state, issue) {
  return (issue.assigneeIds ?? [])
    .map((accountId) => {
      const account = (state.accounts ?? []).find((candidate) => candidate.id === accountId);
      return account ? { id: account.id, username: account.username } : null;
    })
    .filter(Boolean);
}

export function issueMilestone(state, repositoryId, issue) {
  if (!issue.milestoneId) return null;
  const milestone = repositoryMilestones(state, repositoryId).find(
    (candidate) => candidate.id === issue.milestoneId,
  );
  return milestone ? { id: milestone.id, title: milestone.title } : null;
}

/**
 * One row of the Issues list: the persisted number, title, status, author,
 * labels and update time (with the description so the list can filter by body
 * keywords without a second read).
 */
export function toIssueSummary(issue, state, repositoryId) {
  return {
    number: issue.number,
    title: issue.title,
    description: issue.description ?? "",
    status: issue.status,
    author: accountLogin(state, issue.authorId),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    labels: issueLabels(state, repositoryId, issue),
    assignees: issueAssignees(state, issue).map((assignee) => assignee.username),
    milestone: issueMilestone(state, repositoryId, issue),
  };
}

/** Every stored reaction of one target: the issue itself or one of its comments. */
export function reactionsOfTarget(state, issueId, commentId) {
  const wanted = commentId ?? null;
  return (state.reactions ?? []).filter(
    (reaction) => reaction.issueId === issueId && (reaction.commentId ?? null) === wanted,
  );
}

/**
 * The reaction summary of one target: one entry per reaction type with its count
 * and the accounts behind it, so the discussion can show the count and tell the
 * current viewer whether the association is already theirs.
 */
export function toReactions(reactions, state, viewerId) {
  const byType = new Map();
  for (const reaction of reactions) {
    const entry = byType.get(reaction.type) ?? { type: reaction.type, users: [], accountIds: [] };
    entry.users.push(accountLogin(state, reaction.accountId));
    entry.accountIds.push(reaction.accountId);
    byType.set(reaction.type, entry);
  }
  return ISSUE_REACTION_TYPES.filter((type) => byType.has(type)).map((type) => {
    const entry = byType.get(type);
    return {
      type,
      count: entry.users.length,
      reacted: viewerId ? entry.accountIds.includes(viewerId) : false,
      users: entry.users,
    };
  });
}

/** One comment as the discussion renders it, with its own reactions. */
export function toComment(comment, state, issueId, viewerId) {
  return {
    id: comment.id,
    author: accountLogin(state, comment.authorId),
    body: comment.body,
    createdAt: comment.createdAt,
    reactions: toReactions(reactionsOfTarget(state, issueId, comment.id), state, viewerId),
  };
}

/** One timeline record: who did what, when, and the value it introduced. */
export function toActivity(activity, state) {
  return {
    id: activity.id,
    type: activity.type,
    actor: accountLogin(state, activity.actorId),
    createdAt: activity.createdAt,
    ...(activity.to !== undefined ? { to: activity.to } : {}),
    ...(activity.from !== undefined ? { from: activity.from } : {}),
  };
}

/**
 * The complete read view of one issue (REQ-5-1-2), with the reactions of the
 * issue itself and of every comment for the viewer asking for it.
 */
export function toIssueDetail(issue, state, repositoryId, viewer = null) {
  const viewerId = viewer?.id ?? null;
  return {
    ...toIssueSummary(issue, state, repositoryId),
    reactions: toReactions(reactionsOfTarget(state, issue.id, null), state, viewerId),
    comments: (issue.comments ?? []).map((comment) =>
      toComment(comment, state, issue.id, viewerId),
    ),
    activities: (issue.activities ?? []).map((activity) => toActivity(activity, state)),
  };
}

/** Label and milestone options the detail page offers for this repository. */
export function toClassificationOptions(state, repositoryId) {
  return {
    labels: repositoryLabels(state, repositoryId).map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color ?? "",
    })),
    milestones: repositoryMilestones(state, repositoryId).map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
    })),
  };
}
