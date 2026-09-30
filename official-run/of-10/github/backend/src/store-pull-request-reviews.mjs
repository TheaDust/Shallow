/**
 * The discussion and review writes of one pull request (REQ-6-3, REQ-6-4):
 * ordinary conversation comments, inline comments on changed code lines, review
 * decisions and reviewer requests.
 *
 * Every write recomputes the viewer's permission from the persisted state and
 * applies the whole change in one atomic store update, so a refused comment
 * stores nothing and a stored record survives a restart. The module reads the
 * repository and answers with the same payload as the pull-request reads of
 * `store-pull-requests.mjs`, which owns the records of the same repository.
 */

import { randomUUID } from "node:crypto";

import {
  PULL_REQUEST_MESSAGES,
  canManagePullRequests,
  canWritePullRequests,
  changedLineAt,
  currentBaseCommitId,
  currentCompareCommitId,
  findPullRequest,
  isReviewDecision,
} from "./domain/pull-requests.mjs";
import { compareRevisions } from "./domain/commit-graph.mjs";

const COMMENT_MAX_LENGTH = 65_536;

/** Trims the surrounding whitespace of a submitted body. */
function normalizeComment(body) {
  return String(body ?? "").trim();
}

export function createPullRequestReviewHandlers({
  jsonStore,
  readRepository,
  payloadOf,
  failure,
}) {
  /**
   * One inline review comment of the signed-in writer (REQ-6-3-3). The comment
   * is anchored to one file of the current comparison and to one added or
   * deleted line of that file, and to the compare commit it was written on. A
   * writer who is not the author of an Open proposal may publish it immediately
   * (`Add single comment`) or keep it as a `pending` review draft until that
   * review is submitted; a pending draft is only ever returned to its own
   * author, so it is never displayed as published before the submission.
   */
  async function addPullRequestInlineComment(sessionId, owner, name, number, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      const pullRequest = findPullRequest(state, repository.id, number);
      if (!pullRequest) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!canWritePullRequests(state, repository, viewer)) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotWrite);
        return;
      }
      if (viewer.id === pullRequest.authorId) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.authorCannotComment);
        return;
      }
      if (pullRequest.status !== "open") {
        outcome = failure(403, PULL_REQUEST_MESSAGES.reviewNeedsOpen);
        return;
      }
      const body = normalizeComment(input.body);
      if (!body || body.length > COMMENT_MAX_LENGTH) {
        outcome = failure(400, "Comment failed", {
          body: PULL_REQUEST_MESSAGES.commentRequired,
        });
        return;
      }
      const compareCommitId = currentCompareCommitId(repository, pullRequest);
      const diff = compareRevisions(
        repository,
        currentBaseCommitId(repository, pullRequest),
        compareCommitId,
      );
      const path = String(input.path ?? "");
      const target = changedLineAt(diff, path, input.line);
      if (!target) {
        const known = (diff.changedFiles ?? []).some((file) => file.path === path);
        outcome = failure(400, "Comment failed", {
          [known ? "line" : "path"]: known
            ? PULL_REQUEST_MESSAGES.inlineLineUnknown
            : PULL_REQUEST_MESSAGES.inlinePathUnknown,
        });
        return;
      }
      const pending = input.pending === true || String(input.state ?? "") === "pending";
      const at = new Date().toISOString();
      state.pullRequestInlineComments = state.pullRequestInlineComments ?? [];
      state.pullRequestInlineComments.push({
        id: randomUUID(),
        pullRequestId: pullRequest.id,
        repositoryId: repository.id,
        path,
        line: target.index,
        kind: target.kind,
        lineNumber: target.lineNumber,
        commitId: compareCommitId,
        body,
        state: pending ? "pending" : "published",
        authorId: viewer.id,
        createdAt: at,
      });
      pullRequest.updatedAt = at;
      // A pending draft stays private until the review is submitted, so the
      // public timeline records only the comment that was published right away.
      if (!pending) {
        pullRequest.activities.push({
          id: randomUUID(),
          type: "review_comment",
          actorId: viewer.id,
          createdAt: at,
          value: path,
          detail: body,
        });
      }
      outcome = { ok: true, status: 201, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  /** One ordinary conversation comment, which carries no code location (REQ-6). */
  async function addPullRequestComment(sessionId, owner, name, number, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      const pullRequest = findPullRequest(state, repository.id, number);
      if (!pullRequest) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!canWritePullRequests(state, repository, viewer)) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotWrite);
        return;
      }
      const body = normalizeComment(input.body);
      if (!body || body.length > COMMENT_MAX_LENGTH) {
        outcome = failure(400, "Comment failed", {
          body: PULL_REQUEST_MESSAGES.commentRequired,
        });
        return;
      }
      const at = new Date().toISOString();
      const comment = { id: randomUUID(), authorId: viewer.id, body, createdAt: at };
      pullRequest.comments = pullRequest.comments ?? [];
      pullRequest.comments.push(comment);
      pullRequest.updatedAt = at;
      pullRequest.activities.push({
        id: randomUUID(),
        type: "commented",
        actorId: viewer.id,
        createdAt: at,
        detail: body,
      });
      outcome = { ok: true, status: 201, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  /**
   * One review decision (Comment, Approve, Request changes) of a writer who is
   * not the author (REQ-6-3-4). The decision is stored with the compare commit it
   * was submitted on, so a new commit of the compare branch makes it stale; a new
   * decision of the same reviewer replaces their effective decision for the
   * current commit while the older record stays in the timeline. Submitting the
   * review publishes the inline drafts that reviewer collected with `Start a
   * review`.
   */
  async function submitPullRequestReview(sessionId, owner, name, number, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      const pullRequest = findPullRequest(state, repository.id, number);
      if (!pullRequest) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!canWritePullRequests(state, repository, viewer)) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotWrite);
        return;
      }
      // A Draft accepts no review decision until it is marked ready for review
      // (REQ-6-2-4); the refusal leaves the stored record untouched.
      if (pullRequest.status === "draft") {
        outcome = failure(403, PULL_REQUEST_MESSAGES.draftReview);
        return;
      }
      // The author of the proposal never reviews it (REQ-6-3-4).
      if (viewer.id === pullRequest.authorId) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.authorCannotReview);
        return;
      }
      const decision = String(input.decision ?? "").trim().toLowerCase();
      if (!isReviewDecision(decision)) {
        outcome = failure(400, "Review failed", {
          decision: PULL_REQUEST_MESSAGES.unknownDecision,
        });
        return;
      }
      const at = new Date().toISOString();
      pullRequest.reviews = pullRequest.reviews ?? [];
      const review = {
        id: randomUUID(),
        reviewerId: viewer.id,
        decision,
        body: normalizeComment(input.body),
        commitId: pullRequest.compareCommitId,
        createdAt: at,
      };
      pullRequest.reviews.push(review);
      // Submitting the review publishes the drafts it collected: an inline
      // comment written with `Start a review` becomes public only now.
      for (const comment of state.pullRequestInlineComments ?? []) {
        if (
          comment.pullRequestId === pullRequest.id &&
          comment.authorId === viewer.id &&
          comment.state === "pending"
        ) {
          comment.state = "published";
          comment.reviewId = review.id;
          pullRequest.activities.push({
            id: randomUUID(),
            type: "review_comment",
            actorId: viewer.id,
            createdAt: at,
            value: comment.path,
            detail: comment.body ?? "",
          });
        }
      }
      pullRequest.updatedAt = at;
      pullRequest.activities.push({
        id: randomUUID(),
        type: "reviewed",
        actorId: viewer.id,
        createdAt: at,
        value: decision,
      });
      outcome = { ok: true, status: 201, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  /**
   * The author or a maintainer asks one account to review (REQ-6-4). A candidate
   * must hold Write, Maintain or Admin on the repository and must not be the
   * author of the proposal, so the stored relationship can only point at an
   * account that may actually submit a review.
   */
  async function requestPullRequestReviewers(sessionId, owner, name, number, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      const pullRequest = findPullRequest(state, repository.id, number);
      if (!pullRequest) {
        outcome = failure(404, "Not found");
        return;
      }
      const isAuthor = Boolean(viewer) && viewer.id === pullRequest.authorId;
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!isAuthor && !canManagePullRequests(state, repository, viewer)) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotRequestReviewers);
        return;
      }
      // Only a proposal that is still under way collects reviewer requests; a
      // closed or merged one keeps the requests it already stores.
      if (pullRequest.status !== "open" && pullRequest.status !== "draft") {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotRequestReviewers);
        return;
      }
      const username = String(input.username ?? "").trim().toLowerCase();
      const account = (state.accounts ?? []).find(
        (candidate) => candidate.username.toLowerCase() === username,
      );
      if (
        !account ||
        !canWritePullRequests(state, repository, account) ||
        account.id === pullRequest.authorId
      ) {
        outcome = failure(400, "Reviewer request failed", {
          username: PULL_REQUEST_MESSAGES.reviewerUnknown,
        });
        return;
      }
      pullRequest.reviewerIds = pullRequest.reviewerIds ?? [];
      if (!pullRequest.reviewerIds.includes(account.id)) {
        pullRequest.reviewerIds.push(account.id);
      }
      const at = new Date().toISOString();
      pullRequest.updatedAt = at;
      pullRequest.activities.push({
        id: randomUUID(),
        type: "review_requested",
        actorId: viewer.id,
        createdAt: at,
        value: account.username,
      });
      outcome = { ok: true, status: 201, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  /**
   * Withdraws one pending reviewer request (REQ-6-4). Only that relationship is
   * deleted: reviews, comments and activity records the account already
   * submitted stay, and its effective review decision is unchanged.
   */
  async function removePullRequestReviewer(sessionId, owner, name, number, username) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      const pullRequest = findPullRequest(state, repository.id, number);
      if (!pullRequest) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      const isAuthor = viewer.id === pullRequest.authorId;
      if (!isAuthor && !canManagePullRequests(state, repository, viewer)) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotRequestReviewers);
        return;
      }
      const wanted = String(username ?? "").trim().toLowerCase();
      const account = (state.accounts ?? []).find(
        (candidate) => candidate.username.toLowerCase() === wanted,
      );
      const requested = (pullRequest.reviewerIds ?? []).some(
        (accountId) => accountId === account?.id,
      );
      if (!account || !requested) {
        outcome = failure(400, "Reviewer request failed", {
          username: PULL_REQUEST_MESSAGES.reviewerNotRequested,
        });
        return;
      }
      pullRequest.reviewerIds = (pullRequest.reviewerIds ?? []).filter(
        (accountId) => accountId !== account.id,
      );
      const at = new Date().toISOString();
      pullRequest.updatedAt = at;
      pullRequest.activities.push({
        id: randomUUID(),
        type: "review_request_removed",
        actorId: viewer.id,
        createdAt: at,
        value: account.username,
      });
      outcome = { ok: true, status: 200, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  return {
    addPullRequestComment,
    addPullRequestInlineComment,
    submitPullRequestReview,
    requestPullRequestReviewers,
    removePullRequestReviewer,
  };
}
