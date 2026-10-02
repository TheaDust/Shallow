/**
 * Reviewer requests of a pull request (REQ-6-4).
 *
 * A "reviewer request" is a pending-review relationship between a pull request
 * and a candidate reviewer account; it is not a submitted review decision and
 * grants no approval by itself. The relationship stores the candidate, the
 * account that asked, and the time, and it is only offered for a candidate that
 * is not the author of the proposal and holds Write, Maintain or Admin on the
 * repository — Read and Triage accounts can never be requested.
 *
 * Creating and deleting the relationship share one permission rule: the author
 * of an Open or Draft pull request, a Maintain, an Admin or an organization
 * Owner. Every refusal — no session, no permission, a pull request that is
 * neither Open nor Draft, an ineligible or unknown account — stores nothing, so
 * a rejected request is never displayed as saved. Deleting the relationship
 * removes neither the reviews, the comments nor the activity records already
 * written by that account, and it does not change an effective review decision.
 */

import { randomUUID } from "node:crypto";

import { COMMIT_ROLES, effectiveRepositoryRole } from "./repository-access.mjs";
import {
  findRepositoryPullRequest,
  PULL_REQUEST_MESSAGES,
  pullRequestStatus,
} from "./pull-requests.mjs";

function activity(actor, text, timestamp, type) {
  return { id: randomUUID(), type, actor, text, createdAt: timestamp };
}

/**
 * The context one reviewer-request write needs: the repository, the pull
 * request, the signing-in account, or the reason the write cannot happen.
 * The role is resolved from the whole document, because an organization Owner
 * reaches Admin through the membership records.
 */
function reviewerContext(draft, repositoryId, number, accountId) {
  const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
  if (!repository) return { error: { ok: false, missing: true } };
  const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
  if (!account) return { error: { ok: false, unauthorized: true } };
  const pullRequest = findRepositoryPullRequest(draft, repository, number);
  if (!pullRequest) return { error: { ok: false, pullRequestMissing: true } };
  const role = effectiveRepositoryRole(draft, repository, accountId);
  const isAuthor = pullRequest.authorId === accountId;
  if (!isAuthor && role !== "Maintain" && role !== "Admin") {
    return { error: { ok: false, forbidden: true } };
  }
  const status = pullRequestStatus(pullRequest);
  if (status !== "open" && status !== "draft") {
    return { error: { ok: false, notOpen: true } };
  }
  return { repository, account, pullRequest };
}

/** The stored request of one username, or null. */
function findRequest(pullRequest, username) {
  return (pullRequest.reviewers ?? []).find(
    (reviewer) => (typeof reviewer === "string" ? reviewer : reviewer?.username) === username,
  ) ?? null;
}

/**
 * Stores the reviewer request of one eligible account (REQ-6-4). The candidate
 * keeps its username, account id, the operator and the time; asking twice for
 * the same account neither duplicates the relationship nor changes anything.
 */
export async function requestPullRequestReviewer(store, repositoryId, number, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const context = reviewerContext(draft, repositoryId, number, accountId);
    if (context.error) {
      outcome = context.error;
      return undefined;
    }
    const { account, pullRequest } = context;

    const username = typeof input.username === "string" ? input.username.trim() : "";
    if (!username) {
      outcome = { ok: false, errors: { username: PULL_REQUEST_MESSAGES.reviewerRequired } };
      return undefined;
    }
    const candidate = (draft.accounts ?? []).find((entry) => entry.username === username);
    // A candidate must hold Write, Maintain or Admin on this repository and
    // must not be the author of the proposal itself.
    const candidateRole = candidate
      ? effectiveRepositoryRole(draft, context.repository, candidate.id)
      : null;
    if (!candidate || candidate.id === pullRequest.authorId || !COMMIT_ROLES.includes(candidateRole)) {
      outcome = { ok: false, errors: { username: PULL_REQUEST_MESSAGES.reviewerIneligible } };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    if (!Array.isArray(pullRequest.reviewers)) pullRequest.reviewers = [];
    const existing = findRequest(pullRequest, candidate.username);
    if (existing) {
      outcome = { ok: true, username: candidate.username, created: false };
      return undefined;
    }
    pullRequest.reviewers.push({
      id: randomUUID(),
      username: candidate.username,
      accountId: candidate.id,
      requestedBy: account.username,
      requestedById: account.id,
      requestedAt: timestamp,
    });
    pullRequest.timeline = Array.isArray(pullRequest.timeline) ? pullRequest.timeline : [];
    pullRequest.timeline.push(
      activity(account.username, `requested a review from ${candidate.username}`, timestamp, "review_requested"),
    );
    pullRequest.updatedAt = timestamp;
    outcome = { ok: true, username: candidate.username, created: true };
    return draft;
  });
  return outcome;
}

/**
 * Deletes the reviewer request of one account (REQ-6-4): the relationship is
 * removed together with the operator and the time, while the reviews, the
 * comments and the activity records that account already wrote stay untouched.
 * An unknown request is refused and changes nothing.
 */
export async function removePullRequestReviewer(store, repositoryId, number, accountId, usernameInput) {
  let outcome = null;
  await store.update((draft) => {
    const context = reviewerContext(draft, repositoryId, number, accountId);
    if (context.error) {
      outcome = context.error;
      return undefined;
    }
    const { account, pullRequest } = context;
    const username = typeof usernameInput === "string" ? usernameInput.trim() : "";
    const reviewers = Array.isArray(pullRequest.reviewers) ? pullRequest.reviewers : [];
    const index = reviewers.findIndex(
      (reviewer) => (typeof reviewer === "string" ? reviewer : reviewer?.username) === username,
    );
    if (!username || index < 0) {
      outcome = { ok: false, notFound: true };
      return undefined;
    }
    reviewers.splice(index, 1);
    const timestamp = new Date().toISOString();
    pullRequest.reviewers = reviewers;
    pullRequest.timeline = Array.isArray(pullRequest.timeline) ? pullRequest.timeline : [];
    pullRequest.timeline.push(
      activity(account.username, `removed the request for a review from ${username}`, timestamp, "review_requested"),
    );
    pullRequest.updatedAt = timestamp;
    outcome = { ok: true, username };
    return draft;
  });
  return outcome;
}
