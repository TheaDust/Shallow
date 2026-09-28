import { randomUUID } from "node:crypto";

import { effectiveRepositoryRole, hasRepositoryRoleAtLeast } from "./organizations.mjs";

export const ISSUE_TITLE_MAX = 256;
export const DESCRIPTION_MAX = 65536;
export const COMMENT_MAX = 65536;

/** Reactions supported by the reaction menu, in display order. */
export const REACTION_TYPES = ["👍", "👎", "😄", "🎉", "😕", "❤️"];

/** Roles allowed to create issues, edit titles/descriptions, and comment. */
export const ISSUE_WRITE_ROLES = new Set(["write", "maintain", "admin"]);

/** Roles allowed to manage assignees, labels, and milestones on an issue. */
export const ISSUE_METADATA_ROLES = new Set(["triage", "maintain", "admin"]);

/** Roles allowed to close or reopen an issue (REQ-5-4). */
export const ISSUE_STATE_ROLES = new Set(["triage", "maintain", "admin"]);

/** The minimum effective role an account needs to be assignable to an issue. */
export const ASSIGNEE_MIN_ROLE = "triage";

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Seeds the REQ-5 issue records into every seeded public repository named
 * `acme-docs` (the personal `alice-dev/acme-docs` from the REQ-3-3 context
 * and the organization `acme-demo/acme-docs`): the `bug` and
 * `documentation` labels, the `Q3 launch` milestone, the open issue
 * `Improve onboarding` with description, metadata, an assignee, and one
 * comment, and the closed issue `Legacy welcome text` carrying the `bug`
 * label. Only runs when no issue exists yet so user changes survive
 * restarts.
 */
export function seedIssues(state) {
  if (state.issues.length > 0) return;
  const alice = state.accounts.find((account) => account.username === "alice-dev");
  const bob = state.accounts.find((account) => account.username === "bob-reviewer");
  if (!alice) return;
  const now = new Date().toISOString();
  for (const repository of state.repositories.filter(
    (candidate) => candidate.name === "acme-docs",
  )) {
    seedRepositoryIssues(state, repository, alice);
    // bob-reviewer is a non-author reviewer (Write) on the personal acme-docs
    // repository (REQ-6-3/6-4 seed) and an assignable member (Triage or
    // higher) on the organization acme-docs repository (REQ-5 seed).
    if (bob) {
      state.repoGrants.push({
        repositoryId: repository.id,
        subjectType: "account",
        subjectId: bob.id,
        role: repository.ownerType === "account" ? "write" : "triage",
        grantorAccountId: alice.id,
        createdAt: now,
      });
    }
  }
  seedExternalIssueClassification(state, now);
}

/**
 * Seeds labels and a milestone into `acme-internal` (a different repository)
 * so the acme-docs pickers can be verified to offer only classifications of
 * the current repository and never create cross-repository associations.
 */
function seedExternalIssueClassification(state, now) {
  const repository = state.repositories.find(
    (candidate) => candidate.ownerType === "organization" && candidate.name === "acme-internal",
  );
  if (!repository) return;
  state.labels.push(
    {
      id: `label_${randomUUID()}`,
      repositoryId: repository.id,
      name: "bug",
      color: "#d73a4a",
      createdAt: now,
    },
    {
      id: `label_${randomUUID()}`,
      repositoryId: repository.id,
      name: "priority-high",
      color: "#b60205",
      createdAt: now,
    },
  );
  state.milestones.push({
    id: `milestone_${randomUUID()}`,
    repositoryId: repository.id,
    title: "Backlog",
    description: "Future work for Acme Internal.",
    state: "open",
    createdAt: now,
    updatedAt: now,
  });
}

function seedRepositoryIssues(state, repository, alice) {
  const now = new Date().toISOString();
  const bugLabel = {
    id: `label_${randomUUID()}`,
    repositoryId: repository.id,
    name: "bug",
    color: "#d73a4a",
    createdAt: now,
  };
  const docsLabel = {
    id: `label_${randomUUID()}`,
    repositoryId: repository.id,
    name: "documentation",
    color: "#0075ca",
    createdAt: now,
  };
  state.labels.push(bugLabel, docsLabel);

  const milestone = {
    id: `milestone_${randomUUID()}`,
    repositoryId: repository.id,
    title: "Q3 launch",
    description: "Milestone for the Q3 release.",
    state: "open",
    createdAt: now,
    updatedAt: now,
  };
  const v1Milestone = {
    id: `milestone_${randomUUID()}`,
    repositoryId: repository.id,
    title: "v1.0",
    description: "First stable release.",
    state: "open",
    createdAt: now,
    updatedAt: now,
  };
  state.milestones.push(milestone, v1Milestone);

  const openIssue = {
    id: `issue_${randomUUID()}`,
    repositoryId: repository.id,
    number: 1,
    title: "Improve onboarding",
    description: "Describe the onboarding improvement.",
    authorAccountId: alice.id,
    state: "open",
    assigneeAccountIds: [alice.id],
    labelIds: [bugLabel.id, docsLabel.id],
    milestoneId: milestone.id,
    createdAt: daysAgo(4),
    updatedAt: daysAgo(3),
    closedAt: null,
  };
  state.issues.push(openIssue);
  state.issueActivities.push({
    id: `activity_${randomUUID()}`,
    issueId: openIssue.id,
    type: "created",
    actorAccountId: alice.id,
    createdAt: daysAgo(4),
  });

  const comment = {
    id: `comment_${randomUUID()}`,
    issueId: openIssue.id,
    authorAccountId: alice.id,
    body: "Let's add a quick-start guide to the README.",
    createdAt: daysAgo(3),
  };
  state.issueComments.push(comment);
  state.issueActivities.push({
    id: `activity_${randomUUID()}`,
    issueId: openIssue.id,
    type: "commented",
    actorAccountId: alice.id,
    commentId: comment.id,
    createdAt: daysAgo(3),
  });

  const closedIssue = {
    id: `issue_${randomUUID()}`,
    repositoryId: repository.id,
    number: 2,
    title: "Legacy welcome text",
    description: "The welcome text on the home page is outdated.",
    authorAccountId: alice.id,
    state: "closed",
    assigneeAccountIds: [],
    labelIds: [bugLabel.id],
    milestoneId: null,
    createdAt: daysAgo(8),
    updatedAt: daysAgo(5),
    closedAt: daysAgo(5),
  };
  state.issues.push(closedIssue);
  state.issueActivities.push({
    id: `activity_${randomUUID()}`,
    issueId: closedIssue.id,
    type: "created",
    actorAccountId: alice.id,
    createdAt: daysAgo(8),
  });
  state.issueActivities.push({
    id: `activity_${randomUUID()}`,
    issueId: closedIssue.id,
    type: "closed",
    actorAccountId: alice.id,
    createdAt: daysAgo(5),
  });

  // REQ-5-2-2 invalid-edit seed: a separate issue whose original title must
  // survive failed edits. It also serves the REQ-5-3 metadata scenarios as a
  // target issue with no labels, milestone, or assignees yet.
  const invalidEditIssue = {
    id: `issue_${randomUUID()}`,
    repositoryId: repository.id,
    number: 3,
    title: "Original issue title",
    description: "An issue used to verify title editing validation.",
    authorAccountId: alice.id,
    state: "open",
    assigneeAccountIds: [],
    labelIds: [],
    milestoneId: null,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    closedAt: null,
  };
  state.issues.push(invalidEditIssue);
  state.issueActivities.push({
    id: `activity_${randomUUID()}`,
    issueId: invalidEditIssue.id,
    type: "created",
    actorAccountId: alice.id,
    createdAt: daysAgo(2),
  });
}

/** Write, Maintain, and Admin may create issues, edit, and comment. */
export function canWriteIssue(state, accountId, repository) {
  if (!accountId || !repository) return false;
  return ISSUE_WRITE_ROLES.has(effectiveRepositoryRole(state, accountId, repository));
}

/** Triage, Maintain, and Admin may assign participants, apply labels, and set milestones. */
export function canManageIssueMetadata(state, accountId, repository) {
  if (!accountId || !repository) return false;
  return ISSUE_METADATA_ROLES.has(effectiveRepositoryRole(state, accountId, repository));
}

/**
 * Only Triage, Maintain, and Admin may close or reopen an issue; Write and
 * Read users may only view the status (REQ-5-4).
 */
export function canChangeIssueState(state, accountId, repository) {
  if (!accountId || !repository) return false;
  return ISSUE_STATE_ROLES.has(effectiveRepositoryRole(state, accountId, repository));
}

/**
 * Accounts that may appear in the assignee selector of an issue: every
 * account whose effective role on the issue's repository is at least Triage,
 * sorted by username. Non-assignable accounts are never listed.
 */
export function issueAssignableMembers(state, issue) {
  const repository = state.repositories.find((candidate) => candidate.id === issue.repositoryId);
  if (!repository) return [];
  return state.accounts
    .filter((account) => hasRepositoryRoleAtLeast(state, account.id, repository, ASSIGNEE_MIN_ROLE))
    .map((account) => account.username)
    .sort();
}

export function findIssueByNumber(state, repositoryId, number) {
  const value = Number(number);
  if (!Number.isInteger(value) || value <= 0) return null;
  return (
    state.issues.find(
      (candidate) => candidate.repositoryId === repositoryId && candidate.number === value,
    ) ?? null
  );
}

function accountName(state, accountId) {
  return state.accounts.find((candidate) => candidate.id === accountId)?.username ?? "unknown";
}

export function repositoryLabels(state, repositoryId) {
  return state.labels
    .filter((label) => label.repositoryId === repositoryId)
    .map((label) => ({ name: label.name, color: label.color }));
}

export function repositoryMilestones(state, repositoryId) {
  return state.milestones
    .filter((milestone) => milestone.repositoryId === repositoryId)
    .map((milestone) => ({ id: milestone.id, title: milestone.title, state: milestone.state }));
}

export function issueLabels(state, issue) {
  return (issue.labelIds ?? [])
    .map((labelId) => state.labels.find((label) => label.id === labelId))
    .filter(Boolean)
    .map((label) => ({ name: label.name, color: label.color }));
}

export function issueMilestone(state, issue) {
  if (!issue.milestoneId) return null;
  const milestone = state.milestones.find((candidate) => candidate.id === issue.milestoneId);
  if (!milestone) return null;
  return { id: milestone.id, title: milestone.title, state: milestone.state };
}

export function issueAssignees(state, issue) {
  return (issue.assigneeAccountIds ?? [])
    .map((accountId) => accountName(state, accountId))
    .filter((username) => username !== "unknown");
}

export function issueCommentsCount(state, issueId) {
  return state.issueComments.filter((comment) => comment.issueId === issueId).length;
}

/**
 * The reactions of one target (the issue itself or a comment) grouped by
 * reaction with the count and whether the current viewer has reacted.
 */
export function targetReactions(state, issueId, targetType, targetId, accountId) {
  const grouped = new Map();
  for (const record of state.issueReactions) {
    if (
      record.issueId !== issueId ||
      record.targetType !== targetType ||
      record.targetId !== targetId
    ) {
      continue;
    }
    const entry = grouped.get(record.reaction) ?? { count: 0, viewerReacted: false };
    entry.count += 1;
    if (record.accountId === accountId) entry.viewerReacted = true;
    grouped.set(record.reaction, entry);
  }
  return REACTION_TYPES.filter((reaction) => grouped.has(reaction)).map((reaction) => ({
    reaction,
    count: grouped.get(reaction).count,
    viewerReacted: grouped.get(reaction).viewerReacted,
  }));
}

/** Summary payload used by the Issues list rows and creation responses. */
export function issueSummary(state, issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    description: issue.description ?? "",
    author: { username: accountName(state, issue.authorAccountId) },
    labels: issueLabels(state, issue),
    milestone: issueMilestone(state, issue),
    assignees: issueAssignees(state, issue),
    updatedAt: issue.updatedAt,
    commentsCount: issueCommentsCount(state, issue.id),
  };
}

export function listRepositoryIssues(state, repositoryId) {
  return state.issues
    .filter((issue) => issue.repositoryId === repositoryId)
    .sort((a, b) => b.number - a.number)
    .map((issue) => issueSummary(state, issue));
}

export function commentPayload(state, comment, accountId) {
  return {
    id: comment.id,
    author: { username: accountName(state, comment.authorAccountId) },
    body: comment.body,
    createdAt: comment.createdAt,
    reactions: targetReactions(state, comment.issueId, "comment", comment.id, accountId),
  };
}

export function activityPayload(state, activity) {
  const payload = {
    id: activity.id,
    type: activity.type,
    actor: { username: accountName(state, activity.actorAccountId) },
    createdAt: activity.createdAt,
    commentId: activity.commentId ?? null,
  };
  if (activity.type === "commented" && activity.commentId) {
    const comment = state.issueComments.find((candidate) => candidate.id === activity.commentId);
    payload.body = comment ? comment.body : null;
  }
  if (activity.assignee !== undefined) payload.assignee = activity.assignee;
  if (activity.label !== undefined) payload.label = activity.label;
  if (activity.milestone !== undefined) payload.milestone = activity.milestone;
  if (activity.field !== undefined) payload.field = activity.field;
  if (activity.value !== undefined) payload.value = activity.value;
  return payload;
}

/** Complete detail payload for one issue with comments and the timeline. */
export function issueDetailPayload(state, issue, accountId) {
  const summary = issueSummary(state, issue);
  const comments = state.issueComments
    .filter((comment) => comment.issueId === issue.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((comment) => commentPayload(state, comment, accountId));
  const activities = state.issueActivities
    .filter((activity) => activity.issueId === issue.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((activity) => activityPayload(state, activity));
  return {
    issue: {
      ...summary,
      id: issue.id,
      createdAt: issue.createdAt,
      reactions: targetReactions(state, issue.id, "issue", issue.id, accountId),
    },
    comments,
    activities,
    labels: repositoryLabels(state, issue.repositoryId),
    milestones: repositoryMilestones(state, issue.repositoryId),
    assignableMembers: issueAssignableMembers(state, issue),
  };
}

/**
 * Creates an issue in a repository: assigns the next incrementing
 * repository-scoped number and stores the repository, title, description,
 * author, creation time, and Open status plus a creation activity. All
 * validation happens before anything is stored, so a failed submission
 * never allocates a number or persists partial data.
 */
export function createIssue(state, { repositoryId, accountId, title, description } = {}) {
  const errors = {};
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (trimmedTitle.length === 0) {
    errors.title = "Title is required";
  } else if (trimmedTitle.length > ISSUE_TITLE_MAX) {
    errors.title = `Title must be at most ${ISSUE_TITLE_MAX} characters`;
  }
  const descriptionValue = typeof description === "string" ? description : "";
  if (descriptionValue.length > DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${DESCRIPTION_MAX} characters`;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const numbers = state.issues
    .filter((issue) => issue.repositoryId === repositoryId)
    .map((issue) => issue.number);
  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  const now = new Date().toISOString();
  const issue = {
    id: `issue_${randomUUID()}`,
    repositoryId,
    number: nextNumber,
    title: trimmedTitle,
    description: descriptionValue,
    authorAccountId: accountId,
    state: "open",
    assigneeAccountIds: [],
    labelIds: [],
    milestoneId: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
  state.issues.push(issue);
  state.issueActivities.push({
    id: `activity_${randomUUID()}`,
    issueId: issue.id,
    type: "created",
    actorAccountId: accountId,
    createdAt: now,
  });
  return { ok: true, issue };
}

/**
 * Appends a comment to an issue discussion and its activity timeline with
 * author and creation time; the issue update time advances. A blank comment
 * (after trimming) or an overlong one stores nothing.
 */
export function addIssueComment(state, { issueId, accountId, body } = {}) {
  const errors = {};
  const trimmedBody = typeof body === "string" ? body.trim() : "";
  if (trimmedBody.length === 0) {
    errors.body = "Comment is required";
  } else if (trimmedBody.length > COMMENT_MAX) {
    errors.body = `Comment must be at most ${COMMENT_MAX} characters`;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const now = new Date().toISOString();
  const comment = {
    id: `comment_${randomUUID()}`,
    issueId,
    authorAccountId: accountId,
    body: trimmedBody,
    createdAt: now,
  };
  state.issueComments.push(comment);
  state.issueActivities.push({
    id: `activity_${randomUUID()}`,
    issueId,
    type: "commented",
    actorAccountId: accountId,
    commentId: comment.id,
    createdAt: now,
  });
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (issue) issue.updatedAt = now;
  return { ok: true, comment };
}

/** Appends an activity record and advances the issue update time. */
function pushIssueActivity(state, { issueId, actorAccountId, type, extra = {} }) {
  const activity = {
    id: `activity_${randomUUID()}`,
    issueId,
    type,
    actorAccountId,
    createdAt: new Date().toISOString(),
    ...extra,
  };
  state.issueActivities.push(activity);
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (issue) issue.updatedAt = activity.createdAt;
  return activity;
}

/**
 * Edits only the title of the target issue: stores the editor, the edit
 * time, and the new value in the issue and an activity record. A blank or
 * overlong title changes nothing and returns the field error; the original
 * value is retained on any validation failure.
 */
export function updateIssueTitle(state, { issueId, accountId, title } = {}) {
  const errors = {};
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (trimmed.length === 0) {
    errors.title = "Title is required";
  } else if (trimmed.length > ISSUE_TITLE_MAX) {
    errors.title = `Title must be at most ${ISSUE_TITLE_MAX} characters`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return { ok: false, errors: { title: "Issue not found" } };
  issue.title = trimmed;
  const activity = pushIssueActivity(state, {
    issueId,
    actorAccountId: accountId,
    type: "edited",
    extra: { field: "title", value: trimmed },
  });
  return { ok: true, issue, activity };
}

/**
 * Edits only the description of the target issue (empty descriptions are
 * valid, overlong ones are rejected without changing the stored value) and
 * records the editor, edit time, and new value in the activity timeline.
 */
export function updateIssueDescription(state, { issueId, accountId, description } = {}) {
  const errors = {};
  const value = typeof description === "string" ? description : "";
  if (value.length > DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${DESCRIPTION_MAX} characters`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return { ok: false, errors: { description: "Issue not found" } };
  issue.description = value;
  const activity = pushIssueActivity(state, {
    issueId,
    actorAccountId: accountId,
    type: "edited",
    extra: { field: "description", value },
  });
  return { ok: true, issue, activity };
}

/**
 * Closes or reopens the target issue: stores the new Open/Closed status,
 * the operator, the time, and a closed/reopened activity record. The
 * transition never touches the title, description, comments, labels,
 * assignees, or milestone; requesting the current state is a no-op that
 * stores nothing. Closing records the close time; reopening clears it.
 */
export function setIssueState(state, { issueId, accountId, state: nextState } = {}) {
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return { ok: false, errors: { state: "Issue not found" } };
  if (nextState !== "open" && nextState !== "closed") {
    return { ok: false, errors: { state: "State is invalid" } };
  }
  if (issue.state === nextState) return { ok: true, activity: null };
  const now = new Date().toISOString();
  issue.state = nextState;
  issue.closedAt = nextState === "closed" ? now : null;
  const activity = pushIssueActivity(state, {
    issueId,
    actorAccountId: accountId,
    type: nextState === "closed" ? "closed" : "reopened",
  });
  return { ok: true, activity };
}

/**
 * Assigns an account to an issue. Only accounts with at least Triage
 * permission on the current repository are assignable; assigning the same
 * account twice is a no-op. Stores the relationship plus an assignment
 * activity with the operator and time.
 */
export function assignIssueParticipant(state, { issueId, operatorAccountId, username } = {}) {
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return { ok: false, errors: { username: "Issue not found" } };
  const repository = state.repositories.find((candidate) => candidate.id === issue.repositoryId);
  const account = state.accounts.find((candidate) => candidate.username === username);
  if (!account) return { ok: false, errors: { username: "Account not found" } };
  if (!repository || !hasRepositoryRoleAtLeast(state, account.id, repository, ASSIGNEE_MIN_ROLE)) {
    return { ok: false, errors: { username: "Account is not assignable" } };
  }
  if ((issue.assigneeAccountIds ?? []).includes(account.id)) return { ok: true, activity: null };
  issue.assigneeAccountIds = [...(issue.assigneeAccountIds ?? []), account.id];
  const activity = pushIssueActivity(state, {
    issueId,
    actorAccountId: operatorAccountId,
    type: "assigned",
    extra: { assignee: username },
  });
  return { ok: true, activity };
}

/**
 * Removes the issue-account relationship of an assigned participant; the
 * account and its repository permission are untouched. Removing an account
 * that is not assigned is a no-op. Stores an unassignment activity.
 */
export function unassignIssueParticipant(state, { issueId, operatorAccountId, username } = {}) {
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return { ok: false, errors: { username: "Issue not found" } };
  const account = state.accounts.find((candidate) => candidate.username === username);
  if (!account) return { ok: false, errors: { username: "Account not found" } };
  if (!(issue.assigneeAccountIds ?? []).includes(account.id)) return { ok: true, activity: null };
  issue.assigneeAccountIds = issue.assigneeAccountIds.filter((id) => id !== account.id);
  const activity = pushIssueActivity(state, {
    issueId,
    actorAccountId: operatorAccountId,
    type: "unassigned",
    extra: { assignee: username },
  });
  return { ok: true, activity };
}

/**
 * Applies or removes a label of the current repository on an issue. The
 * label is resolved by name within the issue's repository only, so labels of
 * other repositories are never offered or associated; nothing is created.
 * Toggling stores the relationship and an applied/removed activity.
 */
export function toggleIssueLabel(state, { issueId, accountId, name } = {}) {
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return { ok: false, errors: { label: "Issue not found" } };
  const label = state.labels.find(
    (candidate) => candidate.repositoryId === issue.repositoryId && candidate.name === name,
  );
  if (!label) return { ok: false, errors: { label: "Label not found" } };
  const applied = (issue.labelIds ?? []).includes(label.id);
  if (applied) {
    issue.labelIds = issue.labelIds.filter((id) => id !== label.id);
    const activity = pushIssueActivity(state, {
      issueId,
      actorAccountId: accountId,
      type: "unlabeled",
      extra: { label: name },
    });
    return { ok: true, activity };
  }
  issue.labelIds = [...(issue.labelIds ?? []), label.id];
  const activity = pushIssueActivity(state, {
    issueId,
    actorAccountId: accountId,
    type: "labeled",
    extra: { label: name },
  });
  return { ok: true, activity };
}

/**
 * Sets the milestone of a work item (at most one per issue) from the current
 * repository's milestone list. A null/`None` value removes the association.
 * The selector never sees milestones of other repositories; the association
 * activity records the operator and time.
 */
export function setIssueMilestone(state, { issueId, accountId, milestoneTitle } = {}) {
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return { ok: false, errors: { milestone: "Issue not found" } };
  if (milestoneTitle === null || milestoneTitle === undefined) {
    if (!issue.milestoneId) return { ok: true, activity: null };
    const previous = state.milestones.find((candidate) => candidate.id === issue.milestoneId);
    issue.milestoneId = null;
    const activity = pushIssueActivity(state, {
      issueId,
      actorAccountId: accountId,
      type: "demilestoned",
      extra: { milestone: previous?.title ?? null },
    });
    return { ok: true, activity };
  }
  const milestone = state.milestones.find(
    (candidate) => candidate.repositoryId === issue.repositoryId && candidate.title === milestoneTitle,
  );
  if (!milestone) return { ok: false, errors: { milestone: "Milestone not found" } };
  if (issue.milestoneId === milestone.id) return { ok: true, activity: null };
  issue.milestoneId = milestone.id;
  const activity = pushIssueActivity(state, {
    issueId,
    actorAccountId: accountId,
    type: "milestoned",
    extra: { milestone: milestoneTitle },
  });
  return { ok: true, activity };
}

/**
 * Toggles one reaction of the current user on an issue or comment: only one
 * association is stored per user, target, and reaction, and selecting the
 * same reaction a second time removes it. Returns the updated reaction list.
 */
export function toggleIssueReaction(state, { issueId, accountId, targetType, targetId, reaction } = {}) {
  const errors = {};
  if (targetType !== "issue" && targetType !== "comment") {
    errors.target = "Target is invalid";
  } else if (targetType === "comment") {
    const exists = state.issueComments.some(
      (comment) => comment.id === targetId && comment.issueId === issueId,
    );
    if (!exists) errors.target = "Target not found";
  } else if (targetId !== issueId) {
    errors.target = "Target not found";
  }
  if (!REACTION_TYPES.includes(reaction)) {
    errors.reaction = "Reaction is invalid";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const index = state.issueReactions.findIndex(
    (record) =>
      record.issueId === issueId &&
      record.targetType === targetType &&
      record.targetId === targetId &&
      record.accountId === accountId &&
      record.reaction === reaction,
  );
  if (index !== -1) {
    state.issueReactions.splice(index, 1);
  } else {
    state.issueReactions.push({
      id: `reaction_${randomUUID()}`,
      issueId,
      targetType,
      targetId,
      accountId,
      reaction,
      createdAt: new Date().toISOString(),
    });
  }
  return { ok: true };
}
