// The write transitions of one pull request: creation (Open or Draft),
// ready-for-review, merge, close and reopen.
//
// Every transition runs inside one `store.update`: the repository, the record,
// the stored role of the account and (for a merge) the target-branch head, the
// current compare commit, the merge conflicts and the branch protection rule
// are reread inside that same atomic update, so a refused request never leaves
// a partial record and never moves a branch. Merging is the only write
// operation that writes the compare commit's changes into the base branch: it
// creates one merge commit whose parents are the target-branch head at merge
// time and the current compare commit, moves the target branch to it and marks
// the pull request Merged with the merger, the time and the resulting commit.

import { randomUUID } from "node:crypto";

import { canMaintainPullRequest, canWriteRepository } from "./access.mjs";
import { mergedFilesOf, mergeStateOf } from "./pull-request-merge-rules.mjs";
import {
  PULL_REQUEST_MESSAGES,
  PULL_REQUEST_TITLE_MAX_LENGTH,
  PULL_REQUEST_DESCRIPTION_MAX_LENGTH,
  appendPullRequestEvent,
  canChangePullRequestState,
  creationComparison,
  newPullRequestNumber,
  pullRequestByNumber,
  pullRequestClock,
  pullRequestDetailPayload,
  storePullRequest,
  syncCompareCommit,
} from "./pull-requests.mjs";
import { collection, resolveRepositoryForViewer } from "./repository-code.mjs";

function mergeSha() {
  return randomUUID().replace(/-/g, "").slice(0, 7);
}

function invalidTransition(fieldErrors, error = PULL_REQUEST_MESSAGES.notUpdated) {
  return { status: "invalid", error, fieldErrors };
}

/**
 * The transition service of one store: creation plus the status transitions of
 * a numbered pull request.
 */
export function createPullRequestTransitionService(store) {
  /**
   * Creates one pull request in the Open or in the Draft state with exactly the
   * same persisted fields; nothing is stored when the comparison is invalid,
   * the branch pair already carries a live pull request or the title is empty.
   */
  async function createForViewer(owner, repositoryName, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const source = input ?? {};
    const title = typeof source.title === "string" ? source.title.trim() : "";
    const description = typeof source.description === "string" ? source.description : "";
    const draft = source.draft === true;

    const fieldErrors = {};
    if (title.length === 0) fieldErrors.title = PULL_REQUEST_MESSAGES.titleRequired;
    else if (title.length > PULL_REQUEST_TITLE_MAX_LENGTH) {
      fieldErrors.title = PULL_REQUEST_MESSAGES.titleTooLong;
    }
    if (description.length > PULL_REQUEST_DESCRIPTION_MAX_LENGTH) {
      fieldErrors.description = PULL_REQUEST_MESSAGES.descriptionTooLong;
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { status: "invalid", error: PULL_REQUEST_MESSAGES.notCreated, fieldErrors };
    }

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
      const { baseBranch, compareBranch, errors } = creationComparison(state, repository, source);
      if (Object.keys(errors).length > 0) {
        outcome = { status: "invalid", error: PULL_REQUEST_MESSAGES.notCreated, fieldErrors: errors };
        return;
      }

      const createdAt = pullRequestClock();
      const pullRequest = {
        id: `pull-request-${randomUUID()}`,
        repositoryId: repository.id,
        number: newPullRequestNumber(state, repository.id),
        title,
        description,
        authorId: accountId,
        status: draft ? "draft" : "open",
        sourceBranch: compareBranch.name,
        targetBranch: baseBranch.name,
        baseCommitId: baseBranch.commitId ?? null,
        compareCommitId: compareBranch.commitId ?? null,
        reviewerIds: [],
        createdAt,
        updatedAt: createdAt,
        closedAt: null,
        closedById: null,
        mergedAt: null,
        mergedById: null,
      };
      state.pullRequests = [...collection(state, "pullRequests"), pullRequest];
      appendPullRequestEvent(state, pullRequest.id, "created", accountId, createdAt);
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, pullRequest, accountId),
      };
    });
    return outcome;
  }

  /**
   * Moves one draft to Open: the author, a Maintain, an Admin or the
   * organization Owner may do it, and nothing but the status plus the activity
   * record changes.
   */
  async function readyForReviewForViewer(owner, repositoryName, number, accountId) {
    if (!accountId) return { status: "unauthorized" };
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
      if (
        pullRequest.authorId !== accountId &&
        !canMaintainPullRequest(state, repository, accountId)
      ) {
        outcome = { status: "denied" };
        return;
      }
      if (pullRequest.status !== "draft") {
        outcome = invalidTransition({ status: PULL_REQUEST_MESSAGES.notDraft });
        return;
      }
      const updatedAt = pullRequestClock();
      const updated = storePullRequest(state, { ...pullRequest, status: "open", updatedAt });
      appendPullRequestEvent(state, pullRequest.id, "ready_for_review", accountId, updatedAt);
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  /**
   * Merges one Open pull request. Maintain, Admin and the organization Owner
   * may merge; Merged is terminal, and every condition of the merge is
   * re-evaluated here, so a blocked record changes neither branch nor status.
   */
  async function mergeForViewer(owner, repositoryName, number, accountId) {
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
      if (!canMaintainPullRequest(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      if (stored.status !== "open") {
        outcome = invalidTransition({ status: PULL_REQUEST_MESSAGES.notOpen });
        return;
      }
      const mergedAt = pullRequestClock();
      // The compare branch may have moved on: the merge always works on the
      // current compare commit, never on the creation-time one.
      const pullRequest = syncCompareCommit(state, stored, mergedAt);
      const mergeState = mergeStateOf(state, repository, pullRequest);
      if (!mergeState.targetBranch || !mergeState.compareCommit) {
        outcome = { status: "not-found" };
        return;
      }
      const unmet = mergeState.conditions.find((condition) => !condition.satisfied);
      if (unmet) {
        outcome = invalidTransition({ merge: unmet.label });
        return;
      }

      const mergeCommit = {
        id: `commit-${randomUUID()}`,
        repositoryId: repository.id,
        sha: mergeSha(),
        message: `Merge pull request #${pullRequest.number} from ${pullRequest.sourceBranch} into ${pullRequest.targetBranch}`,
        authorId: accountId,
        // The first parent is the target-branch head at merge time, the second
        // the current compare commit; both are stored.
        parentId: mergeState.targetHead?.id ?? null,
        parentIds: [mergeState.targetHead?.id ?? null, pullRequest.compareCommitId].filter(Boolean),
        mergedPullRequestId: pullRequest.id,
        createdAt: mergedAt,
        files: mergedFilesOf(
          mergeState.baseCommit,
          mergeState.targetHead,
          mergeState.compareCommit,
        ),
      };
      state.commits = [...collection(state, "commits"), mergeCommit];
      state.branches = collection(state, "branches").map((branch) =>
        branch.id === mergeState.targetBranch.id
          ? { ...branch, commitId: mergeCommit.id }
          : branch,
      );
      const updated = storePullRequest(state, {
        ...pullRequest,
        status: "merged",
        updatedAt: mergedAt,
        mergedAt,
        mergedById: accountId,
        mergeCommitId: mergeCommit.id,
        mergeCommitSha: mergeCommit.sha,
      });
      appendPullRequestEvent(state, pullRequest.id, "merged", accountId, mergedAt, {
        commitId: mergeCommit.id,
        sha: mergeCommit.sha,
        commitMessage: mergeCommit.message,
      });
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  /**
   * Closes one unmerged pull request without merging it. The author, a
   * Maintain, an Admin and the organization Owner may close an Open or Draft
   * record; nothing but the status and the activity record changes, so no
   * branch, commit, comment or review is touched.
   */
  async function closeForViewer(owner, repositoryName, number, accountId) {
    if (!accountId) return { status: "unauthorized" };
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
      // Merged is terminal: it can neither be closed nor reopened, and the same
      // holds for an already closed record.
      if (pullRequest.status !== "open" && pullRequest.status !== "draft") {
        outcome = invalidTransition({ status: PULL_REQUEST_MESSAGES.notClosable });
        return;
      }
      const closedAt = pullRequestClock();
      const updated = storePullRequest(state, {
        ...pullRequest,
        status: "closed",
        updatedAt: closedAt,
        closedAt,
        closedById: accountId,
      });
      appendPullRequestEvent(state, pullRequest.id, "closed", accountId, closedAt);
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  /**
   * Reopens one Closed pull request as Open. The discussion, the reviews, the
   * diff and the branch references stay readable, and no branch is updated.
   */
  async function reopenForViewer(owner, repositoryName, number, accountId) {
    if (!accountId) return { status: "unauthorized" };
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
      if (pullRequest.status !== "closed") {
        outcome = invalidTransition({ status: PULL_REQUEST_MESSAGES.notReopenable });
        return;
      }
      const reopenedAt = pullRequestClock();
      const updated = storePullRequest(state, {
        ...pullRequest,
        status: "open",
        updatedAt: reopenedAt,
        closedAt: null,
        closedById: null,
      });
      appendPullRequestEvent(state, pullRequest.id, "reopened", accountId, reopenedAt);
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  return {
    createForViewer,
    readyForReviewForViewer,
    mergeForViewer,
    closeForViewer,
    reopenForViewer,
  };
}
