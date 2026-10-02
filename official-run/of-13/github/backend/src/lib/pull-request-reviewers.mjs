// The reviewer requests of one pull request: the pending-review relationship
// between a pull request and a candidate reviewer account, shown in the
// `Reviewers` area of the detail page. A request is not a submitted review
// decision: storing or deleting it never writes, replaces or removes a review,
// an inline comment or an activity record of that reviewer.
//
// Every write resolves the viewer from the trusted session, re-checks the
// stored permission inside the same atomic update and validates the candidate
// against the stored repository roles: only the author of an Open or Draft
// pull request, a Maintain, an Admin or the organization Owner may create or
// delete the relationship, and only an account with Write, Maintain or Admin
// on the repository that is not the author may be requested.

import { randomUUID } from "node:crypto";

import { canWriteRepository } from "./access.mjs";
import {
  PULL_REQUEST_MESSAGES,
  canChangePullRequestState,
  pullRequestByNumber,
  pullRequestDetailPayload,
} from "./pull-requests.mjs";
import { collection, resolveRepositoryForViewer } from "./repository-code.mjs";

let clock = () => new Date().toISOString();

/** The stored account of one username, or null when no account carries it. */
function accountByUsername(state, username) {
  return (
    collection(state, "accounts").find((account) => account.username === username) ?? null
  );
}

function appendEvent(state, pullRequestId, type, actorId, createdAt, data) {
  state.pullRequestEvents = [
    ...collection(state, "pullRequestEvents"),
    {
      id: `pull-request-event-${randomUUID()}`,
      pullRequestId,
      type,
      actorId,
      createdAt,
      data,
    },
  ];
}

/**
 * The reviewer-request service of one store. Both writes answer the unchanged
 * detail payload of the pull request, so the page always shows the stored
 * relationship instead of a value the server refused.
 */
export function createPullRequestReviewerService(store) {
  async function requestReviewerForViewer(owner, repositoryName, number, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const requested =
      typeof input?.username === "string" ? input.username.trim() : "";
    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      const pullRequest = pullRequestByNumber(state, repository.id, number);
      if (!pullRequest) {
        outcome = { status: "not-found" };
        return;
      }
      if (!canChangePullRequestState(state, repository, pullRequest, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      if (pullRequest.status !== "open" && pullRequest.status !== "draft") {
        outcome = {
          status: "invalid",
          error: PULL_REQUEST_MESSAGES.notUpdated,
          fieldErrors: { status: PULL_REQUEST_MESSAGES.reviewerNotRequestable },
        };
        return;
      }

      const candidate = accountByUsername(state, requested);
      // The candidate needs Write or higher on this repository and must not be
      // the author of the pull request itself.
      if (
        requested.length === 0 ||
        !candidate ||
        candidate.id === pullRequest.authorId ||
        !canWriteRepository(state, repository, candidate.id)
      ) {
        outcome = {
          status: "invalid",
          error: PULL_REQUEST_MESSAGES.notUpdated,
          fieldErrors: {
            username:
              requested.length === 0
                ? PULL_REQUEST_MESSAGES.reviewerRequired
                : PULL_REQUEST_MESSAGES.reviewerNotEligible,
          },
        };
        return;
      }

      // Requesting an already requested reviewer stores no second relationship
      // and appends no second activity record.
      if ((pullRequest.reviewerIds ?? []).includes(candidate.id)) {
        outcome = {
          status: "ok",
          detail: pullRequestDetailPayload(state, repository, pullRequest, accountId),
        };
        return;
      }

      const createdAt = clock();
      const updated = {
        ...pullRequest,
        reviewerIds: [...(pullRequest.reviewerIds ?? []), candidate.id],
        updatedAt: createdAt,
      };
      state.pullRequests = collection(state, "pullRequests").map((record) =>
        record.id === pullRequest.id ? updated : record,
      );
      appendEvent(state, pullRequest.id, "review_requested", accountId, createdAt, {
        reviewer: candidate.username,
      });
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  async function removeReviewerForViewer(owner, repositoryName, number, username, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const requested = typeof username === "string" ? username.trim() : "";
    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      const pullRequest = pullRequestByNumber(state, repository.id, number);
      if (!pullRequest) {
        outcome = { status: "not-found" };
        return;
      }
      if (!canChangePullRequestState(state, repository, pullRequest, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      if (pullRequest.status !== "open" && pullRequest.status !== "draft") {
        outcome = {
          status: "invalid",
          error: PULL_REQUEST_MESSAGES.notUpdated,
          fieldErrors: { status: PULL_REQUEST_MESSAGES.reviewerNotRequestable },
        };
        return;
      }
      const candidate = accountByUsername(state, requested);
      if (!candidate) {
        outcome = {
          status: "invalid",
          error: PULL_REQUEST_MESSAGES.notUpdated,
          fieldErrors: { username: PULL_REQUEST_MESSAGES.reviewerNotEligible },
        };
        return;
      }
      // Deleting an absent relationship changes nothing and records nothing.
      if (!(pullRequest.reviewerIds ?? []).includes(candidate.id)) {
        outcome = {
          status: "ok",
          detail: pullRequestDetailPayload(state, repository, pullRequest, accountId),
        };
        return;
      }

      const removedAt = clock();
      const updated = {
        ...pullRequest,
        reviewerIds: (pullRequest.reviewerIds ?? []).filter((id) => id !== candidate.id),
        updatedAt: removedAt,
      };
      state.pullRequests = collection(state, "pullRequests").map((record) =>
        record.id === pullRequest.id ? updated : record,
      );
      // Only the request relationship is deleted: the reviews, the inline
      // comments and the earlier activity records of that account stay stored,
      // so the effective review decision never changes here.
      appendEvent(state, pullRequest.id, "review_request_removed", accountId, removedAt, {
        reviewer: candidate.username,
      });
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  return { requestReviewerForViewer, removeReviewerForViewer };
}
