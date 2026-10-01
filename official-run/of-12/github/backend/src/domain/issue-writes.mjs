/**
 * Issue writes (REQ-5-2).
 *
 * Every write is one atomic store update: the target issue, its timeline, its
 * comments, its reactions and the repository number sequence either change
 * together or not at all, so a rejected submission (missing permission, invalid
 * title, overlong input, unknown comment) never allocates an issue number,
 * overwrites a stored description or appends a partial comment.
 *
 * The role lists are those of the module, not a cumulative ladder (REQ-5):
 * creating an issue, editing its title or description and commenting need
 * Write, Maintain or Admin; adding or removing one's own reaction only needs a
 * signed-in viewer who may view the issue.
 */

import { randomUUID } from "node:crypto";

import { effectiveRepositoryRole } from "./repository-access.mjs";
import {
  COMMENT_MAX,
  ISSUE_CONTENT_ROLES,
  ISSUE_MESSAGES,
  REACTION_TYPES,
  commentError,
  issueDescriptionError,
  issueTitleError,
  normalizeCommentBody,
  normalizeIssueDescription,
  normalizeIssueTitle,
} from "./issues.mjs";
import {
  appendIssueEvent as appendEvent,
  nextIssueNumber,
  runIssueMutation,
} from "./issue-mutations.mjs";

function trimmed(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Creates one issue in the repository: the number continues the repository
 * sequence, the record stores the repository identifier, the trimmed title, the
 * description, the author, the creation time and the Open status, and the
 * timeline receives the creation activity.
 */
export async function createRepositoryIssue(store, repositoryId, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account || !ISSUE_CONTENT_ROLES.includes(effectiveRepositoryRole(draft, repository, accountId))) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const errors = {};
    const titleError = issueTitleError(input.title);
    if (titleError) errors.title = titleError;
    const descriptionError = issueDescriptionError(input.description);
    if (descriptionError) errors.description = descriptionError;
    if (Object.keys(errors).length > 0) {
      outcome = { ok: false, errors };
      return undefined;
    }

    const createdAt = new Date().toISOString();
    const issue = {
      id: randomUUID(),
      repositoryId: repository.id,
      number: nextIssueNumber(draft, repository),
      title: normalizeIssueTitle(input.title),
      body: normalizeIssueDescription(input.description),
      status: "open",
      authorId: account.id,
      author: account.username,
      labels: [],
      assignees: [],
      milestone: null,
      createdAt,
      updatedAt: createdAt,
      comments: [],
      reactions: [],
      timeline: [],
    };
    appendEvent(issue, "created", account.username, "opened this issue", createdAt);
    if (!Array.isArray(draft.issues)) draft.issues = [];
    draft.issues.push(issue);
    outcome = { ok: true, number: issue.number, id: issue.id };
    return draft;
  });
  return outcome;
}

/** Updates only the title of the target issue and records the edit (REQ-5-2-2). */
export async function editRepositoryIssueTitle(store, repositoryId, accountId, number, input) {
  return runIssueMutation(store, repositoryId, accountId, number, ISSUE_CONTENT_ROLES, (draft, repository, issue, account) => {
    const error = issueTitleError(input.title);
    if (error) return { ok: false, errors: { title: error } };
    const title = normalizeIssueTitle(input.title);
    if (title === (issue.title ?? "")) return { ok: true, unchanged: true };
    const at = new Date().toISOString();
    const previous = issue.title ?? "";
    issue.title = title;
    issue.updatedAt = at;
    appendEvent(issue, "edited", account.username, `changed the title from “${previous}” to “${title}”`, at);
    repository.updatedAt = at;
    return { ok: true };
  });
}

/** Updates only the description of the target issue and records the edit (REQ-5-2-2). */
export async function editRepositoryIssueDescription(store, repositoryId, accountId, number, input) {
  return runIssueMutation(store, repositoryId, accountId, number, ISSUE_CONTENT_ROLES, (draft, repository, issue, account) => {
    const error = issueDescriptionError(input.description);
    if (error) return { ok: false, errors: { description: error } };
    const body = normalizeIssueDescription(input.description);
    if (body === (issue.body ?? "")) return { ok: true, unchanged: true };
    const at = new Date().toISOString();
    issue.body = body;
    issue.updatedAt = at;
    appendEvent(issue, "edited", account.username, "updated the issue description", at);
    repository.updatedAt = at;
    return { ok: true };
  });
}

/** Appends one stored comment and its activity record (REQ-5-2-3). */
export async function addIssueComment(store, repositoryId, accountId, number, input) {
  return runIssueMutation(store, repositoryId, accountId, number, ISSUE_CONTENT_ROLES, (draft, repository, issue, account) => {
    const error = commentError(input.body);
    if (error) return { ok: false, errors: { comment: error } };
    const body = normalizeCommentBody(input.body);
    if (body.length > COMMENT_MAX) return { ok: false, errors: { comment: ISSUE_MESSAGES.commentTooLong } };
    const at = new Date().toISOString();
    const comment = {
      id: randomUUID(),
      authorId: account.id,
      author: account.username,
      body,
      createdAt: at,
    };
    if (!Array.isArray(issue.comments)) issue.comments = [];
    issue.comments.push(comment);
    issue.updatedAt = at;
    appendEvent(issue, "commented", account.username, "commented", at);
    repository.updatedAt = at;
    return { ok: true, commentId: comment.id };
  });
}

/**
 * Adds or removes one “subject-target-reaction type” association (REQ-5-2-3).
 * The same account, target and reaction type is stored once; selecting it a
 * second time removes the association again.
 */
export async function toggleIssueReaction(store, repositoryId, accountId, number, input) {
  return runIssueMutation(store, repositoryId, accountId, number, null, (draft, repository, issue, account) => {
    const type = trimmed(input.type);
    if (!REACTION_TYPES.includes(type)) return { ok: false, errors: { reaction: ISSUE_MESSAGES.unknownReaction } };
    const commentId = trimmed(input.commentId);
    let targetType = "issue";
    let targetId = issue.id;
    if (commentId) {
      const comment = (issue.comments ?? []).find((candidate) => candidate.id === commentId);
      if (!comment) return { ok: false, missing: true, errors: { comment: ISSUE_MESSAGES.commentNotFound } };
      targetType = "comment";
      targetId = comment.id;
    }
    if (!Array.isArray(issue.reactions)) issue.reactions = [];
    const index = issue.reactions.findIndex(
      (reaction) =>
        reaction.targetType === targetType
        && reaction.targetId === targetId
        && reaction.accountId === account.id
        && reaction.type === type,
    );
    const at = new Date().toISOString();
    if (index >= 0) {
      issue.reactions.splice(index, 1);
      appendEvent(issue, "reacted", account.username, `removed the ${type} reaction`, at);
    } else {
      issue.reactions.push({
        id: randomUUID(),
        targetType,
        targetId,
        accountId: account.id,
        type,
        createdAt: at,
      });
      appendEvent(issue, "reacted", account.username, `reacted with ${type}`, at);
    }
    issue.updatedAt = at;
    repository.updatedAt = at;
    return { ok: true, removed: index >= 0 };
  });
}
