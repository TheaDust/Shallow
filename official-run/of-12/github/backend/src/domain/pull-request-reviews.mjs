/**
 * Inline review comments and review decisions of a pull request (REQ-6-3).
 *
 * An inline comment is a comment record anchored to the pull request's current
 * compare commit, a file path and one changed line of Files changed; it differs
 * from an ordinary comment in Conversation, which carries no code location.
 * `Add single comment` publishes it right away, while `Start a review` keeps it
 * as a pending draft that only its author reads until the review is submitted.
 *
 * A review decision stores the reviewer, the current compare commit, the
 * decision and the optional summary. Only the latest decision of one reviewer
 * on the current compare commit counts; an older record of the same reviewer is
 * preserved as history.
 *
 * Every rejection — no session, no review permission, the author's own
 * proposal, a pull request that is not open, an empty body, a line that is not
 * part of the current diff or an unknown decision — stores nothing, so a failed
 * submission is never displayed as published.
 */

import { randomUUID } from "node:crypto";

import { COMMIT_ROLES, effectiveRepositoryRole } from "./repository-access.mjs";
import {
  findChangedLine,
  findRepositoryPullRequest,
  MAX_PULL_REQUEST_DESCRIPTION,
  PULL_REQUEST_DECISIONS,
  PULL_REQUEST_MESSAGES,
  pullRequestChangedFiles,
  pullRequestCompareCommit,
  pullRequestStatus,
} from "./pull-requests.mjs";

/** The decision texts the timeline and the review summary spell (REQ-6-3-4). */
export const REVIEW_DECISION_TEXTS = {
  comment: "Commented",
  approve: "Approved",
  request_changes: "Changes requested",
};

function activity(actor, text, timestamp, type = "reviewed") {
  return { id: randomUUID(), type, actor, text, createdAt: timestamp };
}

/** The stored decisions of a reviewer on the current compare commit. */
function pendingComments(pullRequest, reviewerId) {
  return (pullRequest.reviewComments ?? []).filter(
    (comment) => comment && comment.pending === true && comment.authorId === reviewerId,
  );
}

/**
 * The review context of one write: the repository, the pull request, the
 * signing-in account and its role, or the reason the write cannot happen.
 */
function reviewContext(draft, repositoryId, number, accountId) {
  const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
  if (!repository) return { error: { ok: false, missing: true } };
  const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
  if (!account) return { error: { ok: false, unauthorized: true } };
  const pullRequest = findRepositoryPullRequest(draft, repository, number);
  if (!pullRequest) return { error: { ok: false, pullRequestMissing: true } };
  const role = effectiveRepositoryRole(draft, repository, accountId);
  // Only Write, Maintain, Admin or an organization Owner reviews, and never the
  // author of the proposal itself.
  if (!COMMIT_ROLES.includes(role) || pullRequest.authorId === accountId) {
    return { error: { ok: false, forbidden: true } };
  }
  if (pullRequestStatus(pullRequest) !== "open") {
    return { error: { ok: false, notOpen: true } };
  }
  return { repository, account, pullRequest };
}

/**
 * Stores an inline review comment on one changed line (REQ-6-3-3). A published
 * comment is public immediately; a draft stays pending for its author until the
 * review is submitted. The comment keeps the file path, the line position, the
 * side of the diff, the current compare commit, the author and the body.
 */
export async function createPullRequestReviewComment(store, repositoryId, number, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const context = reviewContext(draft, repositoryId, number, accountId);
    if (context.error) {
      outcome = context.error;
      return undefined;
    }
    const { account, pullRequest } = context;

    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) {
      outcome = { ok: false, errors: { body: PULL_REQUEST_MESSAGES.commentRequired } };
      return undefined;
    }

    const filePath = typeof input.filePath === "string" ? input.filePath : "";
    const side = input.side === "removed" ? "removed" : "added";
    const file = pullRequestChangedFiles(context.repository, pullRequest)
      .find((candidate) => candidate.path === filePath);
    if (!file) {
      outcome = { ok: false, errors: { filePath: PULL_REQUEST_MESSAGES.commentFileUnknown } };
      return undefined;
    }
    const line = findChangedLine(file, input.line, side);
    if (!line) {
      outcome = { ok: false, errors: { line: PULL_REQUEST_MESSAGES.commentLineUnknown } };
      return undefined;
    }

    const commitId = pullRequestCompareCommit(context.repository, pullRequest)?.id ?? "";
    const timestamp = new Date().toISOString();
    const comment = {
      id: randomUUID(),
      filePath,
      line: Number(line.lineNumber),
      side,
      commitId,
      authorId: account.id,
      author: account.username,
      body,
      pending: input.pending === true,
      createdAt: timestamp,
    };
    if (!Array.isArray(pullRequest.reviewComments)) pullRequest.reviewComments = [];
    pullRequest.reviewComments.push(comment);
    if (comment.pending !== true) {
      pullRequest.timeline = Array.isArray(pullRequest.timeline) ? pullRequest.timeline : [];
      pullRequest.timeline.push(
        activity(account.username, `commented on ${filePath}`, timestamp, "commented"),
      );
    }
    pullRequest.updatedAt = timestamp;
    outcome = { ok: true, id: comment.id, pending: comment.pending };
    return draft;
  });
  return outcome;
}

/**
 * Stores one review decision of the current compare commit (REQ-6-3-4). The new
 * decision becomes the reviewer's effective decision while the older records of
 * the same reviewer stay in the history, and the pending inline comments of
 * that reviewer are published together with the review.
 */
export async function submitPullRequestReview(store, repositoryId, number, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const context = reviewContext(draft, repositoryId, number, accountId);
    if (context.error) {
      outcome = context.error;
      return undefined;
    }
    const { account, pullRequest } = context;

    const decision = String(input.decision ?? "").toLowerCase();
    if (!PULL_REQUEST_DECISIONS.includes(decision)) {
      outcome = { ok: false, errors: { decision: PULL_REQUEST_MESSAGES.reviewDecisionUnknown } };
      return undefined;
    }
    const summary = typeof input.summary === "string" ? input.summary : "";
    if (summary.length > MAX_PULL_REQUEST_DESCRIPTION) {
      outcome = { ok: false, errors: { summary: PULL_REQUEST_MESSAGES.reviewSummaryTooLong } };
      return undefined;
    }

    const commitId = pullRequestCompareCommit(context.repository, pullRequest)?.id ?? "";
    const timestamp = new Date().toISOString();
    if (!Array.isArray(pullRequest.reviews)) pullRequest.reviews = [];
    pullRequest.reviews.push({
      id: randomUUID(),
      reviewerId: account.id,
      reviewer: account.username,
      decision,
      summary,
      commitId,
      createdAt: timestamp,
    });

    // The draft comments of this reviewer become public with the review.
    let published = 0;
    for (const comment of pendingComments(pullRequest, account.id)) {
      comment.pending = false;
      comment.publishedAt = timestamp;
      published += 1;
    }

    pullRequest.timeline = Array.isArray(pullRequest.timeline) ? pullRequest.timeline : [];
    pullRequest.timeline.push(
      activity(account.username, REVIEW_DECISION_TEXTS[decision], timestamp),
    );
    pullRequest.updatedAt = timestamp;
    outcome = { ok: true, decision, commitId, published };
    return draft;
  });
  return outcome;
}
