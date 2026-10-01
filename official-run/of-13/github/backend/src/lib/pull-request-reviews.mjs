// Review collaboration of one pull request: the inline comment anchored to a
// changed line of the current diff, and the review decision of a collaborator.
//
// An inline comment stores the target pull request, the current compare commit,
// the file path, the line position, its author, its body and its publication
// state. A pending draft of `Start a review` stays private to its author until
// that reviewer submits a review, which publishes it. A review decision stores
// the reviewer, the current compare commit, the decision and the optional
// explanation; submitting again replaces the reviewer's effective decision for
// that commit while the earlier record stays in the timeline. Every write runs
// inside one `store.update`, so a refused request never leaves a partial record
// and always answers with the unchanged detail payload of the pull request.

import { randomUUID } from "node:crypto";

import { canWriteRepository } from "./access.mjs";
import { diffSnapshots } from "./commit-diff.mjs";
import { usernameOf } from "./pull-request-decisions.mjs";
import {
  PULL_REQUEST_MESSAGES,
  appendPullRequestEvent,
  pullRequestByNumber,
  pullRequestDetailPayload,
  storePullRequest,
  syncCompareCommit,
} from "./pull-requests.mjs";
import { collection, commitById, resolveRepositoryForViewer } from "./repository-code.mjs";

export const PULL_REQUEST_COMMENT_MAX_LENGTH = 65536;

export const PULL_REQUEST_REVIEW_MESSAGES = {
  ...PULL_REQUEST_MESSAGES,
  commentRequired: "Comment is required",
  commentTooLong: "Comment must be 65536 characters or fewer",
  commentAnchor: "The comment must target a changed line of this pull request",
  decisionRequired: "Choose a review decision",
  summaryTooLong: "Summary must be 65536 characters or fewer",
  reviewNotOpen: "Only an Open pull request can be reviewed",
  authorCannotReview: "The author cannot review their own pull request",
};

/** The stored decisions a review may carry, and the aliases a client may send. */
export const PULL_REQUEST_REVIEW_DECISIONS = ["comment", "approved", "changes_requested"];

const DECISION_ALIASES = new Map([
  ["comment", "comment"],
  ["approve", "approved"],
  ["approved", "approved"],
  ["request_changes", "changes_requested"],
  ["request-changes", "changes_requested"],
  ["changes_requested", "changes_requested"],
]);

let clock = () => new Date().toISOString();

function recordsOf(state, key, pullRequestId) {
  return collection(state, key).filter((record) => record.pullRequestId === pullRequestId);
}

/**
 * The validation of one inline comment against the current diff of the pull
 * request: a non-empty body and a changed line that really exists in the file
 * of this comparison. A refused target never stores a comment.
 */
function validateComment(state, pullRequest, input) {
  const fieldErrors = {};
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  if (body.length === 0) fieldErrors.body = PULL_REQUEST_REVIEW_MESSAGES.commentRequired;
  else if (body.length > PULL_REQUEST_COMMENT_MAX_LENGTH) {
    fieldErrors.body = PULL_REQUEST_REVIEW_MESSAGES.commentTooLong;
  }

  const path = typeof input?.path === "string" ? input.path : "";
  const line = Number.parseInt(String(input?.line ?? ""), 10);
  const baseCommit = pullRequest.baseCommitId ? commitById(state, pullRequest.baseCommitId) : null;
  const compareCommit = pullRequest.compareCommitId
    ? commitById(state, pullRequest.compareCommitId)
    : null;
  const file = diffSnapshots(baseCommit, compareCommit).files.find(
    (candidate) => candidate.path === path,
  );
  if (!file) {
    fieldErrors.path = PULL_REQUEST_REVIEW_MESSAGES.commentAnchor;
  } else if (
    !Number.isInteger(line) ||
    line < 1 ||
    line > file.lines.length ||
    file.lines[line - 1]?.type === "context"
  ) {
    fieldErrors.line = PULL_REQUEST_REVIEW_MESSAGES.commentAnchor;
  }

  return { fieldErrors, body, path, line };
}

/** The stored decision name of a submitted review, or null when unknown. */
export function pullRequestDecision(value) {
  return DECISION_ALIASES.get(String(value ?? "").trim()) ?? null;
}

/**
 * The review service of one store: the inline comment (published at once or
 * kept as a pending review draft) and the review decision.
 */
export function createPullRequestReviewService(store) {
  async function addCommentForViewer(owner, repositoryName, number, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      const stored = pullRequestByNumber(state, repository.id, number);
      if (!stored) {
        outcome = { status: "not-found" };
        return;
      }
      if (!canWriteRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      const createdAt = clock();
      // The comment is anchored to the compare commit of the compare branch
      // now, never to a revision that is not current any more.
      const pullRequest = syncCompareCommit(state, stored, createdAt);
      const { fieldErrors, body, path, line } = validateComment(state, pullRequest, input);
      if (Object.keys(fieldErrors).length > 0) {
        outcome = {
          status: "invalid",
          error: PULL_REQUEST_REVIEW_MESSAGES.notUpdated,
          fieldErrors,
        };
        return;
      }

      const pending = input?.pending === true;
      const comment = {
        id: `pull-request-comment-${randomUUID()}`,
        pullRequestId: pullRequest.id,
        commitId: pullRequest.compareCommitId ?? null,
        authorId: accountId,
        body,
        path,
        line,
        outdated: false,
        pending,
        createdAt,
      };
      state.pullRequestComments = [...collection(state, "pullRequestComments"), comment];
      // A published comment is part of the timeline; a pending draft only
      // becomes an activity record when its review is submitted.
      if (!pending) {
        appendPullRequestEvent(state, pullRequest.id, "commented", accountId, createdAt, {
          path,
          line,
        });
      }
      const updated = storePullRequest(state, { ...pullRequest, updatedAt: createdAt });
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  async function submitReviewForViewer(owner, repositoryName, number, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      const stored = pullRequestByNumber(state, repository.id, number);
      if (!stored) {
        outcome = { status: "not-found" };
        return;
      }
      if (!canWriteRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      // The author of a pull request never reviews it, and a Draft, Closed or
      // Merged record accepts no review submission either.
      if (stored.authorId === accountId) {
        outcome = { status: "denied", error: PULL_REQUEST_REVIEW_MESSAGES.authorCannotReview };
        return;
      }
      if (stored.status !== "open") {
        outcome = {
          status: "invalid",
          error: PULL_REQUEST_REVIEW_MESSAGES.notUpdated,
          fieldErrors: { status: PULL_REQUEST_REVIEW_MESSAGES.reviewNotOpen },
        };
        return;
      }

      const decision = pullRequestDecision(input?.decision);
      const summary = typeof input?.body === "string" ? input.body.trim() : "";
      const fieldErrors = {};
      if (!decision) fieldErrors.decision = PULL_REQUEST_REVIEW_MESSAGES.decisionRequired;
      if (summary.length > PULL_REQUEST_COMMENT_MAX_LENGTH) {
        fieldErrors.summary = PULL_REQUEST_REVIEW_MESSAGES.summaryTooLong;
      }
      if (Object.keys(fieldErrors).length > 0) {
        outcome = {
          status: "invalid",
          error: PULL_REQUEST_REVIEW_MESSAGES.notUpdated,
          fieldErrors,
        };
        return;
      }

      const createdAt = clock();
      // The decision belongs to the current compare commit: a newer commit of
      // the compare branch makes every earlier decision stale first.
      const pullRequest = syncCompareCommit(state, stored, createdAt);
      const compareCommitId = pullRequest.compareCommitId ?? null;
      // A new decision of the same reviewer on the same compare commit
      // replaces their effective decision; the earlier records stay stored.
      state.pullRequestReviews = collection(state, "pullRequestReviews").map((review) =>
        review.pullRequestId === pullRequest.id &&
        review.reviewerId === accountId &&
        review.commitId === compareCommitId &&
        review.superseded !== true
          ? { ...review, superseded: true }
          : review,
      );
      // Submitting the review publishes the reviewer's pending drafts of this
      // pull request; nothing of another reviewer is touched.
      const published = recordsOf(state, "pullRequestComments", pullRequest.id).filter(
        (comment) => comment.authorId === accountId && comment.pending === true,
      );
      if (published.length > 0) {
        const publishedIds = new Set(published.map((comment) => comment.id));
        state.pullRequestComments = collection(state, "pullRequestComments").map((comment) =>
          publishedIds.has(comment.id) ? { ...comment, pending: false } : comment,
        );
        for (const comment of published) {
          appendPullRequestEvent(state, pullRequest.id, "commented", accountId, createdAt, {
            path: comment.path ?? null,
            line: comment.line ?? null,
          });
        }
      }

      state.pullRequestReviews = [
        ...collection(state, "pullRequestReviews"),
        {
          id: `pull-request-review-${randomUUID()}`,
          pullRequestId: pullRequest.id,
          reviewerId: accountId,
          commitId: compareCommitId,
          decision,
          body: summary,
          stale: false,
          superseded: false,
          createdAt,
        },
      ];
      appendPullRequestEvent(state, pullRequest.id, "reviewed", accountId, createdAt, {
        reviewer: usernameOf(state, accountId),
        decision,
      });
      const updated = storePullRequest(state, { ...pullRequest, updatedAt: createdAt });
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  return { addCommentForViewer, submitReviewForViewer };
}
