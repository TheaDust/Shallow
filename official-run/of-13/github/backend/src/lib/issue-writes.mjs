// Web issue collaboration: creating an issue, editing its title or its
// description, appending a discussion comment and toggling a reaction.
//
// Every operation is one indivisible write on the trusted side. Permission is
// re-read from the stored relationship (Write or higher creates, edits and
// comments; any signed-in reader may react to what they can view), the rules of
// the fields are validated before anything is stored, and the number of a new
// issue is derived inside the same update that appends it, so a refused
// submission never allocates a number and never leaves a partial record.

import { randomUUID } from "node:crypto";

import { canWriteRepository } from "./access.mjs";
import {
  ISSUE_REACTION_TYPES,
  commentsOfIssue,
  issueByNumber,
  issueDetailPayload,
} from "./issues.mjs";
import { collection, resolveRepositoryForViewer } from "./repository-code.mjs";

export const ISSUE_MESSAGES = {
  notAuthenticated: "Not authenticated",
  notFound: "Not found",
  accessDenied: "Access denied",
  titleRequired: "Title is required",
  titleTooLong: "Title must be 256 characters or fewer",
  descriptionTooLong: "Description must be 65536 characters or fewer",
  commentRequired: "Comment is required",
  commentTooLong: "Comment must be 65536 characters or fewer",
  reactionUnsupported: "Reaction is not supported",
  issueNotCreated: "Issue not created",
  issueNotSaved: "Issue not saved",
  commentNotAdded: "Comment not added",
  reactionNotSaved: "Reaction not saved",
};

export const ISSUE_TITLE_MAX_LENGTH = 256;
export const ISSUE_DESCRIPTION_MAX_LENGTH = 65536;
export const ISSUE_COMMENT_MAX_LENGTH = 65536;

let clock = () => new Date().toISOString();

/**
 * The reason an issue title is unusable, or null when it holds 1–256 non-empty
 * characters after trimming the leading and trailing whitespace.
 */
export function issueTitleError(value) {
  if (typeof value !== "string") return ISSUE_MESSAGES.titleRequired;
  const trimmed = value.trim();
  if (trimmed.length === 0) return ISSUE_MESSAGES.titleRequired;
  if (trimmed.length > ISSUE_TITLE_MAX_LENGTH) return ISSUE_MESSAGES.titleTooLong;
  return null;
}

/**
 * The reason an issue description is unusable, or null otherwise. A description
 * may be empty; it is stored as written and is at most 65536 characters.
 */
export function issueDescriptionError(value) {
  if (typeof value !== "string") return null;
  if (value.length > ISSUE_DESCRIPTION_MAX_LENGTH) return ISSUE_MESSAGES.descriptionTooLong;
  return null;
}

/**
 * The reason a comment is unusable, or null when it holds 1–65536 non-empty
 * characters after trimming the leading and trailing whitespace.
 */
export function issueCommentError(value) {
  if (typeof value !== "string") return ISSUE_MESSAGES.commentRequired;
  const trimmed = value.trim();
  if (trimmed.length === 0) return ISSUE_MESSAGES.commentRequired;
  if (trimmed.length > ISSUE_COMMENT_MAX_LENGTH) return ISSUE_MESSAGES.commentTooLong;
  return null;
}

/** The reason a reaction type cannot be used, or null when it is supported. */
export function issueReactionError(value) {
  if (typeof value !== "string" || !ISSUE_REACTION_TYPES.includes(value)) {
    return ISSUE_MESSAGES.reactionUnsupported;
  }
  return null;
}

function hasField(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function event(type, issueId, actorId, createdAt, data = {}) {
  return {
    id: `issue-event-${randomUUID()}`,
    issueId,
    type,
    actorId,
    createdAt,
    data,
  };
}

export function createIssueWriteService(store) {
  /**
   * Creates one issue in the addressed repository. The number is the highest
   * stored number of that repository plus one, computed inside the same update
   * that appends the issue, its author and its creation activity.
   */
  async function createForViewer(owner, repositoryName, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const source = input ?? {};
    const rawTitle = typeof source.title === "string" ? source.title : "";
    const rawDescription =
      typeof source.description === "string"
        ? source.description
        : typeof source.body === "string"
          ? source.body
          : "";

    const fieldErrors = {};
    const titleReason = issueTitleError(rawTitle);
    if (titleReason) fieldErrors.title = titleReason;
    const descriptionReason = issueDescriptionError(rawDescription);
    if (descriptionReason) fieldErrors.description = descriptionReason;
    if (Object.keys(fieldErrors).length > 0) {
      return { status: "invalid", error: ISSUE_MESSAGES.issueNotCreated, fieldErrors };
    }

    const title = rawTitle.trim();
    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      if (!canWriteRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }

      const issues = collection(state, "issues").filter(
        (candidate) => candidate.repositoryId === repository.id,
      );
      const number = issues.reduce((max, candidate) => Math.max(max, candidate.number ?? 0), 0) + 1;
      const createdAt = clock();
      const issue = {
        id: `issue-${randomUUID()}`,
        repositoryId: repository.id,
        number,
        title,
        body: rawDescription,
        state: "open",
        authorId: accountId,
        assigneeIds: [],
        labelIds: [],
        milestoneId: null,
        createdAt,
        updatedAt: createdAt,
        closedAt: null,
        closedById: null,
      };
      state.issues = [...collection(state, "issues"), issue];
      state.issueEvents = [
        ...collection(state, "issueEvents"),
        event("created", issue.id, accountId, createdAt),
      ];
      outcome = { status: "ok", detail: issueDetailPayload(state, repository, issue, accountId) };
    });
    return outcome;
  }

  /**
   * Saves the submitted fields of one issue. Only the fields present in the
   * request are touched, so saving the title and saving the description stay
   * two independent actions; a refused save leaves the stored issue untouched.
   */
  async function updateForViewer(owner, repositoryName, number, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const source = input ?? {};
    const wantsTitle = hasField(source, "title");
    const wantsDescription = hasField(source, "description") || hasField(source, "body");
    if (!wantsTitle && !wantsDescription) {
      return {
        status: "invalid",
        error: ISSUE_MESSAGES.issueNotSaved,
        fieldErrors: { title: ISSUE_MESSAGES.titleRequired },
      };
    }

    const fieldErrors = {};
    if (wantsTitle) {
      const reason = issueTitleError(source.title);
      if (reason) fieldErrors.title = reason;
    }
    if (wantsDescription) {
      const description = typeof source.description === "string" ? source.description : source.body;
      const reason = issueDescriptionError(description);
      if (reason) fieldErrors.description = reason;
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { status: "invalid", error: ISSUE_MESSAGES.issueNotSaved, fieldErrors };
    }

    const nextTitle = wantsTitle ? source.title.trim() : null;
    const nextDescription = wantsDescription
      ? typeof source.description === "string"
        ? source.description
        : source.body
      : null;

    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      if (!canWriteRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      const stored = issueByNumber(state, repository.id, number);
      if (!stored) {
        outcome = { status: "not-found" };
        return;
      }

      // Each saved field is one activity record: saving the title and saving
      // the description stay two separate actions of the same issue.
      const editedFields = [];
      if (wantsTitle) editedFields.push({ field: "title", title: nextTitle });
      if (wantsDescription) editedFields.push({ field: "description" });

      const updatedAt = clock();
      const updated = {
        ...stored,
        ...(wantsTitle ? { title: nextTitle } : {}),
        ...(wantsDescription ? { body: nextDescription } : {}),
        updatedAt,
      };
      state.issues = collection(state, "issues").map((candidate) =>
        candidate.id === stored.id ? updated : candidate,
      );
      state.issueEvents = [
        ...collection(state, "issueEvents"),
        ...editedFields.map((data) => event("edited", stored.id, accountId, updatedAt, data)),
      ];
      outcome = { status: "ok", detail: issueDetailPayload(state, repository, updated, accountId) };
    });
    return outcome;
  }

  /** Appends one discussion comment with its author, body and creation time. */
  async function commentForViewer(owner, repositoryName, number, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const source = input ?? {};
    const rawBody =
      typeof source.body === "string"
        ? source.body
        : typeof source.comment === "string"
          ? source.comment
          : "";
    const reason = issueCommentError(rawBody);
    if (reason) {
      return {
        status: "invalid",
        error: ISSUE_MESSAGES.commentNotAdded,
        fieldErrors: { comment: reason },
      };
    }
    const body = rawBody.trim();

    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      if (!canWriteRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      const issue = issueByNumber(state, repository.id, number);
      if (!issue) {
        outcome = { status: "not-found" };
        return;
      }

      const createdAt = clock();
      const comment = {
        id: `issue-comment-${randomUUID()}`,
        issueId: issue.id,
        authorId: accountId,
        body,
        createdAt,
      };
      state.issueComments = [...collection(state, "issueComments"), comment];
      state.issueEvents = [
        ...collection(state, "issueEvents"),
        event("commented", issue.id, accountId, createdAt, { commentId: comment.id }),
      ];
      outcome = {
        status: "ok",
        detail: issueDetailPayload(state, repository, issue, accountId),
      };
    });
    return outcome;
  }

  /**
   * Toggles one reaction of the signed-in account on an issue or on one of its
   * comments: an association that already exists is removed, otherwise it is
   * stored. The same account, target and reaction type never yield two
   * associations, and every target stays inside the addressed issue.
   */
  async function reactForViewer(owner, repositoryName, number, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const source = input ?? {};
    const reaction = typeof source.reaction === "string" ? source.reaction : "";
    const reason = issueReactionError(reaction);
    if (reason) {
      return {
        status: "invalid",
        error: ISSUE_MESSAGES.reactionNotSaved,
        fieldErrors: { reaction: reason },
      };
    }
    const commentId =
      typeof source.commentId === "string" && source.commentId.length > 0
        ? source.commentId
        : null;

    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      const issue = issueByNumber(state, repository.id, number);
      if (!issue) {
        outcome = { status: "not-found" };
        return;
      }
      if (commentId !== null && !commentsOfIssue(state, issue.id).some((c) => c.id === commentId)) {
        outcome = { status: "not-found" };
        return;
      }

      const targetType = commentId === null ? "issue" : "comment";
      const targetId = commentId ?? issue.id;
      const stored = collection(state, "issueReactions");
      const existing = stored.find(
        (candidate) =>
          candidate.accountId === accountId &&
          candidate.targetType === targetType &&
          candidate.targetId === targetId &&
          candidate.reaction === reaction,
      );

      const createdAt = clock();
      if (existing) {
        state.issueReactions = stored.filter((candidate) => candidate.id !== existing.id);
      } else {
        state.issueReactions = [
          ...stored,
          {
            id: `reaction-${randomUUID()}`,
            accountId,
            targetType,
            targetId,
            reaction,
            createdAt,
          },
        ];
      }
      state.issueEvents = [
        ...collection(state, "issueEvents"),
        event(existing ? "unreacted" : "reacted", issue.id, accountId, createdAt, {
          reaction,
          target: targetType,
        }),
      ];
      outcome = {
        status: "ok",
        removed: Boolean(existing),
        detail: issueDetailPayload(state, repository, issue, accountId),
      };
    });
    return outcome;
  }

  return { createForViewer, updateForViewer, commentForViewer, reactForViewer };
}
