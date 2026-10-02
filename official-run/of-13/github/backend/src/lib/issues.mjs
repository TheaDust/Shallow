// Issue model shared by the Issues list, the issue detail page and the issue
// writes.
//
// An issue is a numbered work item of exactly one repository: its number is
// unique inside that repository, its labels and its milestone are pre-existing
// repository records, and the activity timeline is append-only. Reads always
// resolve the viewer first, so an unreadable private repository answers 403 and
// an unknown one 404 without leaking stored content.

import {
  canBeAssignedToIssue,
  canTriageRepository,
  canWriteRepository,
  effectiveRepositoryRole,
} from "./access.mjs";
import { publicRepositoryPayload, resolveRepositoryForViewer } from "./repository-code.mjs";

function collection(state, key) {
  const value = state?.[key];
  return Array.isArray(value) ? value : [];
}

function accountUsername(state, accountId) {
  if (!accountId) return null;
  return (
    collection(state, "accounts").find((account) => account.id === accountId)?.username ?? null
  );
}

/** The classification names of one repository, sorted by name. */
export function labelsOfRepository(state, repositoryId) {
  return collection(state, "labels")
    .filter((label) => label.repositoryId === repositoryId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function labelById(state, labelId) {
  return collection(state, "labels").find((label) => label.id === labelId) ?? null;
}

export function milestonesOfRepository(state, repositoryId) {
  return collection(state, "milestones")
    .filter((milestone) => milestone.repositoryId === repositoryId)
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function milestoneById(state, milestoneId) {
  return collection(state, "milestones").find((milestone) => milestone.id === milestoneId) ?? null;
}

/** The issues of one repository, newest number first. */
export function issuesOfRepository(state, repositoryId) {
  return collection(state, "issues")
    .filter((issue) => issue.repositoryId === repositoryId)
    .sort((left, right) => right.number - left.number);
}

/** The issue addressed by its repository-scoped number; `#` is tolerated. */
export function issueByNumber(state, repositoryId, number) {
  const normalized = typeof number === "string" ? number.trim().replace(/^#/, "") : number;
  const parsed = typeof normalized === "number" ? normalized : Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed)) return null;
  return issuesOfRepository(state, repositoryId).find((issue) => issue.number === parsed) ?? null;
}

/**
 * The reaction types an account may attach to an issue or to one of its
 * comments. The order is the order every reaction summary is rendered in, so
 * the discussion stays stable between reads.
 */
export const ISSUE_REACTION_TYPES = [
  "thumbs_up",
  "heart",
  "hooray",
  "laugh",
  "confused",
  "rocket",
  "eyes",
];

/** The stored `subject-target-reaction` associations of one target. */
export function reactionsOfTarget(state, targetType, targetId) {
  return collection(state, "issueReactions").filter(
    (reaction) => reaction.targetType === targetType && reaction.targetId === targetId,
  );
}

/**
 * The reaction summary of one target: one entry per reaction type that at least
 * one account selected, with its count and whether the current viewer selected
 * it. An account appears at most once per target and reaction type.
 */
export function reactionSummaries(state, targetType, targetId, accountId = null) {
  const stored = reactionsOfTarget(state, targetType, targetId);
  return ISSUE_REACTION_TYPES.filter((type) =>
    stored.some((reaction) => reaction.reaction === type),
  ).map((type) => ({
    reaction: type,
    count: stored.filter((reaction) => reaction.reaction === type).length,
    reacted: Boolean(accountId) &&
      stored.some((reaction) => reaction.reaction === type && reaction.accountId === accountId),
  }));
}

/** The comments of one issue, oldest first. */
export function commentsOfIssue(state, issueId) {
  return collection(state, "issueComments")
    .filter((comment) => comment.issueId === issueId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/** The append-only activity history of one issue, oldest first. */
export function eventsOfIssue(state, issueId) {
  return collection(state, "issueEvents")
    .filter((event) => event.issueId === issueId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function labelPayload(label) {
  return {
    name: label.name,
    color: label.color ?? null,
    description: label.description ?? null,
  };
}

export function labelsOfIssue(state, issue) {
  return (issue?.labelIds ?? [])
    .map((labelId) => labelById(state, labelId))
    .filter((label) => label !== null)
    .map(labelPayload);
}

export function assigneesOfIssue(state, issue) {
  return (issue?.assigneeIds ?? [])
    .map((accountId) => accountUsername(state, accountId))
    .filter((username) => username !== null);
}

export function milestonePayload(milestone) {
  return { title: milestone.title, state: milestone.state ?? "open" };
}

/**
 * The accounts the Assignees picker may offer: every account that holds at
 * least Triage permission on this repository. An account outside the
 * repository collaborator scope is never a candidate.
 */
export function assignableMembersOfRepository(state, repository) {
  return collection(state, "accounts")
    .filter((account) => canBeAssignedToIssue(state, repository, account.id))
    .map((account) => account.username)
    .sort((left, right) => left.localeCompare(right));
}

export function milestoneOfIssue(state, issue) {
  const milestone = milestoneById(state, issue?.milestoneId);
  return milestone ? { title: milestone.title, state: milestone.state ?? "open" } : null;
}

/** One Issues list row: number, title, status, author, labels and update time. */
export function issueRow(state, issue) {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    // The body is part of the row so the keyword filter covers title and body.
    body: issue.body ?? "",
    state: issue.state,
    author: accountUsername(state, issue.authorId),
    labels: labelsOfIssue(state, issue),
    milestone: milestoneOfIssue(state, issue),
    commentCount: commentsOfIssue(state, issue.id).length,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

export function issueDetail(state, issue, accountId = null) {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    state: issue.state,
    author: accountUsername(state, issue.authorId),
    assignees: assigneesOfIssue(state, issue),
    labels: labelsOfIssue(state, issue),
    milestone: milestoneOfIssue(state, issue),
    reactions: reactionSummaries(state, "issue", issue.id, accountId),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt ?? null,
    closedBy: accountUsername(state, issue.closedById),
  };
}

/** The comment records of one issue with their own reactions. */
export function commentsPayload(state, issue, accountId = null) {
  return commentsOfIssue(state, issue.id).map((comment) => ({
    id: comment.id,
    author: accountUsername(state, comment.authorId),
    body: comment.body,
    createdAt: comment.createdAt,
    reactions: reactionSummaries(state, "comment", comment.id, accountId),
  }));
}

/** The append-only activity history of one issue, chronological. */
export function eventsPayload(state, issue) {
  return eventsOfIssue(state, issue.id).map((event) => ({
    id: event.id,
    type: event.type,
    actor: accountUsername(state, event.actorId),
    createdAt: event.createdAt,
    data: event.data ?? {},
  }));
}

/**
 * The complete payload of one issue detail page, shared by the read route and
 * by every successful write, so a write answer already carries the persisted
 * state of the page (details, discussion, timeline and the role gates).
 */
export function issueDetailPayload(state, repository, issue, accountId = null) {
  const canTriage = canTriageRepository(state, repository, accountId);
  return {
    repository: publicRepositoryPayload(state, repository, accountId),
    issue: issueDetail(state, issue, accountId),
    comments: commentsPayload(state, issue, accountId),
    events: eventsPayload(state, issue),
    viewerRole: effectiveRepositoryRole(state, repository, accountId),
    // Each operation reads its own stored relationship: Write covers creating,
    // editing and commenting; Triage covers the metadata operations. Neither
    // is implied by the other.
    canWrite: canWriteRepository(state, repository, accountId),
    canTriage,
    // The metadata pickers always list the records of this repository, so a
    // label or a milestone of another repository is never offered, and the
    // candidate members are hidden from viewers who cannot triage.
    labels: labelsOfRepository(state, repository.id).map(labelPayload),
    milestones: milestonesOfRepository(state, repository.id).map(milestonePayload),
    assigneeCandidates: canTriage ? assignableMembersOfRepository(state, repository) : [],
  };
}

function countsOf(issues) {
  return {
    open: issues.filter((issue) => issue.state === "open").length,
    closed: issues.filter((issue) => issue.state === "closed").length,
    all: issues.length,
  };
}

export function createIssueService(store) {
  async function listForViewer(owner, repositoryName, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;

    const issues = issuesOfRepository(state, repository.id);
    return {
      status: "ok",
      list: {
        repository: publicRepositoryPayload(state, repository, accountId),
        issues: issues.map((issue) => issueRow(state, issue)),
        labels: labelsOfRepository(state, repository.id).map(labelPayload),
        milestones: milestonesOfRepository(state, repository.id).map(milestonePayload),
        counts: countsOf(issues),
      },
    };
  }

  async function detailForViewer(owner, repositoryName, number, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;

    const issue = issueByNumber(state, repository.id, number);
    if (!issue) return { status: "not-found" };

    return { status: "ok", detail: issueDetailPayload(state, repository, issue, accountId) };
  }

  return { listForViewer, detailForViewer };
}
