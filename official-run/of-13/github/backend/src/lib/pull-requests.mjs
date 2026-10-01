// The pull-request model of one repository: the list, the branch comparison
// that precedes creation, the persisted pull request itself (normal and draft)
// and the payload every page reads. The status transitions live in
// `pull-request-transitions.mjs` and the collaboration writes in
// `pull-request-reviews.mjs` / `pull-request-reviewers.mjs` / `pull-request-checks.mjs`.
//
// A pull request is a persisted proposal to merge the compare branch into the
// base branch. It is never a branch, a commit or an issue: creating one stores
// the two branch names together with the commits they pointed at, and reading
// the comparison never writes a pull request, a commit or a branch. Every read
// goes through the repository-read rule resolved from the trusted session, and
// every write re-checks the stored permission of that account inside the same
// atomic update that appends the record.

import { randomUUID } from "node:crypto";

import { canMaintainPullRequest, canWriteRepository } from "./access.mjs";
import { diffSnapshots } from "./commit-diff.mjs";
import {
  checkPayloadsOf,
  isOutdatedComment,
  isStaleReview,
  reviewStatusOf,
  reviewsOf,
  usernameOf,
} from "./pull-request-decisions.mjs";
import { mergeStateOf } from "./pull-request-merge-rules.mjs";
import {
  authorNameOf,
  branchByName,
  branchCommitChain,
  branchNamesOf,
  collection,
  commitById,
  publicRepositoryPayload,
  resolveRepositoryForViewer,
  shortSha,
} from "./repository-code.mjs";

export const PULL_REQUEST_MESSAGES = {
  notAuthenticated: "Not authenticated",
  accessDenied: "Access denied",
  notFound: "Pull request not found",
  notCreated: "Pull request not created",
  notUpdated: "Pull request not updated",
  titleRequired: "Title is required",
  titleTooLong: "Title must be 256 characters or fewer",
  descriptionTooLong: "Description must be 65536 characters or fewer",
  branchNotFound: "Branch not found",
  sameBranch: "No changes: the base and compare branch are the same",
  noChanges: "No changes: the compare branch has no new commits",
  pairExists: "A pull request for these branches already exists",
  notDraft: "Pull request is not a draft",
  notOpen: "Pull request is not open",
  notClosable: "Only an unmerged Open or Draft pull request can be closed",
  notReopenable: "Only a Closed pull request can be reopened",
  reviewerRequired: "Choose a reviewer",
  reviewerNotEligible: "Member is not eligible to review this pull request",
  reviewerNotRequestable: "Only an Open or Draft pull request accepts reviewer requests",
  changesRequested: "Changes requested must be resolved before merging",
};

export const PULL_REQUEST_TITLE_MAX_LENGTH = 256;
export const PULL_REQUEST_DESCRIPTION_MAX_LENGTH = 65536;

/** The only statuses a pull request may carry. */
export const PULL_REQUEST_STATUSES = ["draft", "open", "closed", "merged"];

/** The statuses that block a second pull request of the same branch pair. */
const LIVE_STATUSES = new Set(["draft", "open"]);

export const PULL_REQUEST_REVIEW_STATUSES = [
  "review_required",
  "approved",
  "changes_requested",
];

let clock = () => new Date().toISOString();

function recordsOf(state, key, pullRequestId) {
  return collection(state, key).filter((record) => record.pullRequestId === pullRequestId);
}

export function pullRequestsOf(state, repositoryId) {
  return collection(state, "pullRequests").filter(
    (pullRequest) => pullRequest.repositoryId === repositoryId,
  );
}

/** The pull request of one repository-scoped number, with or without a `#`. */
export function pullRequestByNumber(state, repositoryId, value) {
  const number = Number.parseInt(String(value ?? "").trim().replace(/^#/, ""), 10);
  if (!Number.isInteger(number)) return null;
  return pullRequestsOf(state, repositoryId).find((record) => record.number === number) ?? null;
}

function commitIdentity(state, commit) {
  if (!commit) return null;
  return {
    id: commit.id,
    sha: commit.sha,
    shortSha: shortSha(commit.sha),
    message: commit.message,
    author: authorNameOf(state, commit),
    createdAt: commit.createdAt,
  };
}

/** The commits of a compare branch that the base revision does not contain. */
function comparableCommits(state, baseCommit, compareCommit) {
  const chain = compareCommit ? commitChainOf(state, compareCommit) : [];
  if (!baseCommit) return chain;
  const index = chain.findIndex((commit) => commit.id === baseCommit.id);
  return index === -1 ? chain : chain.slice(0, index);
}

function commitChainOf(state, commit) {
  const chain = [];
  const seen = new Set();
  let current = commit;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? commitById(state, current.parentId) : null;
  }
  return chain;
}

/**
 * The comparison of the two commits a pull request recorded: the comparable
 * commits of the compare branch and the line diff between the two snapshots.
 */
function commitComparison(state, baseCommit, compareCommit) {
  const commits = comparableCommits(state, baseCommit, compareCommit);
  const diff = diffSnapshots(baseCommit, compareCommit);
  return {
    commits: commits.map((commit) => commitIdentity(state, commit)),
    commitCount: commits.length,
    files: diff.files,
    changedFileCount: diff.files.length,
    additions: diff.additions,
    deletions: diff.deletions,
    noChanges: commits.length === 0 || diff.files.length === 0,
  };
}

/**
 * The effective review state of one pull request, as the shared decision
 * readers of `pull-request-decisions.mjs` compute it: the latest decision of
 * each reviewer counts only for the current compare commit.
 */
export const pullRequestReviewStatus = reviewStatusOf;

/** The number of valid non-author approvals of the current compare commit. */
export function pullRequestApprovers(state, pullRequest) {
  return approversOf(state, pullRequest).map((accountId) => usernameOf(state, accountId));
}

/**
 * The accounts the picker may offer as a reviewer: every account with Write,
 * Maintain or Admin on the repository except the author of the pull request.
 * A "reviewer request" is a pending-review relationship, never a submitted
 * review decision, so a candidate is chosen from the stored repository roles.
 */
export function reviewerCandidatesOf(state, repository, pullRequest) {
  return collection(state, "accounts")
    .filter(
      (account) =>
        account.id !== pullRequest.authorId && canWriteRepository(state, repository, account.id),
    )
    .map((account) => account.username)
    .filter((username) => typeof username === "string" && username.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * True while the viewer may act on the reviewer requests of this pull request:
 * the author, a Maintain, an Admin or the organization Owner. The state of the
 * record is checked separately, so a Closed or Merged record is refused for
 * every account.
 */
export function canChangePullRequestState(state, repository, pullRequest, accountId) {
  if (!accountId) return false;
  return pullRequest.authorId === accountId || canMaintainPullRequest(state, repository, accountId);
}

/**
 * True while the viewer may create or delete the reviewer-request relationship:
 * the author of an Open or Draft record, or a Maintain, an Admin or the
 * organization Owner.
 */
export function canRequestPullRequestReviewers(state, repository, pullRequest, accountId) {
  if (pullRequest.status !== "open" && pullRequest.status !== "draft") return false;
  return canChangePullRequestState(state, repository, pullRequest, accountId);
}

/**
 * The commit the compare branch points at now. The compare branch may receive
 * a new commit after the pull request was opened, so the current compare commit
 * is always resolved from the stored branch reference instead of trusting the
 * creation-time value.
 */
export function currentCompareCommitId(state, pullRequest) {
  const branch = branchByName(state, pullRequest.repositoryId, pullRequest.sourceBranch);
  return branch?.commitId ?? pullRequest.compareCommitId ?? null;
}

/** The pull request with its compare commit resolved to the branch head now. */
export function pullRequestView(state, pullRequest) {
  const compareCommitId = currentCompareCommitId(state, pullRequest);
  return compareCommitId === (pullRequest.compareCommitId ?? null)
    ? pullRequest
    : { ...pullRequest, compareCommitId };
}

export function appendPullRequestEvent(state, pullRequestId, type, actorId, createdAt, data = {}) {
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

/** Replaces one stored pull request and answers the stored record. */
export function storePullRequest(state, updated) {
  state.pullRequests = collection(state, "pullRequests").map((candidate) =>
    candidate.id === updated.id ? updated : candidate,
  );
  return updated;
}

/**
 * Persists the compare commit the compare branch points at now. When the branch
 * moved on after the record was created, the earlier review decisions become
 * stale (they stay in the timeline) and the inline comments of the earlier
 * commit keep their original position marked `Outdated`; the `test` status of
 * the new compare commit starts as pending.
 */
export function syncCompareCommit(state, storedPullRequest, at) {
  const compareCommitId = currentCompareCommitId(state, storedPullRequest);
  if (compareCommitId === (storedPullRequest.compareCommitId ?? null)) {
    return storedPullRequest;
  }
  const updated = storePullRequest(state, {
    ...storedPullRequest,
    compareCommitId,
    updatedAt: at,
  });
  state.pullRequestReviews = collection(state, "pullRequestReviews").map((review) =>
    review.pullRequestId === updated.id &&
    review.commitId !== compareCommitId &&
    review.stale !== true
      ? { ...review, stale: true }
      : review,
  );
  state.pullRequestComments = collection(state, "pullRequestComments").map((comment) =>
    comment.pullRequestId === updated.id &&
    comment.commitId !== compareCommitId &&
    comment.outdated !== true
      ? { ...comment, outdated: true }
      : comment,
  );
  appendPullRequestEvent(state, updated.id, "stale_reviews_marked", null, at, {
    commitId: compareCommitId,
  });
  return updated;
}

function rowPayload(state, pullRequest) {
  return {
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.description ?? "",
    author: usernameOf(state, pullRequest.authorId),
    status: pullRequest.status,
    sourceBranch: pullRequest.sourceBranch,
    targetBranch: pullRequest.targetBranch,
    reviewers: (pullRequest.reviewerIds ?? []).map((id) => usernameOf(state, id)).filter(Boolean),
    reviewStatus: reviewStatusOf(state, pullRequest),
    commentCount: recordsOf(state, "pullRequestComments", pullRequest.id).length,
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt ?? pullRequest.createdAt,
  };
}

/**
 * The complete payload of one pull request: its stored identity, the recorded
 * comparison, the checks of its current compare commit, the reviews and inline
 * comments preserved in its timeline, the merge state of its target branch and
 * the permissions of the viewer.
 */
export function pullRequestDetailPayload(state, repository, storedPullRequest, accountId = null) {
  const pullRequest = pullRequestView(state, storedPullRequest);
  const baseCommit = pullRequest.baseCommitId ? commitById(state, pullRequest.baseCommitId) : null;
  const compareCommit = pullRequest.compareCommitId
    ? commitById(state, pullRequest.compareCommitId)
    : null;
  const mergeCommit = pullRequest.mergeCommitId ? commitById(state, pullRequest.mergeCommitId) : null;
  const canManage = canMaintainPullRequest(state, repository, accountId);
  const mergeState = mergeStateOf(state, repository, pullRequest);
  return {
    repository: publicRepositoryPayload(state, repository, accountId),
    pullRequest: {
      ...rowPayload(state, pullRequest),
      baseCommit: commitIdentity(state, baseCommit),
      compareCommit: commitIdentity(state, compareCommit),
      closedAt: pullRequest.closedAt ?? null,
      mergedAt: pullRequest.mergedAt ?? null,
      mergedBy: pullRequest.mergedById ? usernameOf(state, pullRequest.mergedById) : null,
      mergeCommitId: pullRequest.mergeCommitId ?? null,
      mergeCommitSha: pullRequest.mergeCommitSha ?? null,
    },
    comparison: commitComparison(state, baseCommit, compareCommit),
    checks: checkPayloadsOf(state, pullRequest),
    reviews: reviewsOf(state, pullRequest.id).map((review) => ({
      id: review.id,
      reviewer: usernameOf(state, review.reviewerId),
      decision: review.decision,
      body: review.body ?? "",
      commitId: review.commitId ?? null,
      stale: isStaleReview(review, pullRequest),
      superseded: review.superseded === true,
      createdAt: review.createdAt,
    })),
    comments: recordsOf(state, "pullRequestComments", pullRequest.id)
      // A pending review draft stays visible to its author only; it becomes
      // public when that reviewer submits the review.
      .filter((comment) => comment.pending !== true || comment.authorId === accountId)
      .slice()
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
      .map((comment) => ({
        id: comment.id,
        author: usernameOf(state, comment.authorId),
        body: comment.body,
        path: comment.path ?? null,
        line: comment.line ?? null,
        commitId: comment.commitId ?? null,
        outdated: isOutdatedComment(comment, pullRequest),
        pending: comment.pending === true,
        createdAt: comment.createdAt,
      })),
    events: recordsOf(state, "pullRequestEvents", pullRequest.id)
      .slice()
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
      .map((event) => ({
        id: event.id,
        type: event.type,
        actor: usernameOf(state, event.actorId),
        createdAt: event.createdAt,
        data: event.data ?? {},
      })),
    viewerRole: publicRepositoryPayload(state, repository, accountId).viewerRole,
    canWrite: canWriteRepository(state, repository, accountId),
    // The reviewer area on the right of the detail page: the stored requests
    // are readable by every viewer, while the request/remove relationship and
    // the close/reopen transitions stay reserved for the permitted roles.
    reviewerCandidates: reviewerCandidatesOf(state, repository, pullRequest),
    canRequestReviewers: canRequestPullRequestReviewers(
      state,
      repository,
      pullRequest,
      accountId,
    ),
    canClose: canChangePullRequestState(state, repository, pullRequest, accountId) &&
      (pullRequest.status === "open" || pullRequest.status === "draft"),
    canReopen: canChangePullRequestState(state, repository, pullRequest, accountId) &&
      pullRequest.status === "closed",
    // The merge area: the stored rule of the target branch, every condition of
    // the merge with its state and the reason of the first unmet one.
    targetProtection: mergeState.rule
      ? {
          branchName: mergeState.rule.branchName,
          requireApproval: mergeState.rule.requireApproval === true,
          requireStatusCheck: mergeState.rule.requireStatusCheck === true,
        }
      : null,
    mergeConditions: mergeState.conditions,
    mergeable: mergeState.mergeable,
    mergeBlocker:
      mergeState.conditions.find((condition) => !condition.satisfied)?.label ?? null,
    // Merging is a Manage operation on an Open record whose conditions all
    // hold; the server re-evaluates every condition inside the merge write.
    canMerge:
      canManage && pullRequest.status === "open" && mergeState.mergeable,
    canReadyForReview:
      pullRequest.status === "draft" &&
      (pullRequest.authorId === accountId || canManage),
  };
}

/** The read-only comparison of two branch names of one repository. */
export function branchComparisonPayload(state, repository, baseName, compareName, accountId) {
  const baseBranch = branchByName(state, repository.id, baseName);
  const compareBranch = branchByName(state, repository.id, compareName);
  if (!baseBranch || !compareBranch) return { status: "branch-not-found" };

  const baseCommit = baseBranch.commitId ? commitById(state, baseBranch.commitId) : null;
  const compareCommit = compareBranch.commitId ? commitById(state, compareBranch.commitId) : null;
  const comparison = commitComparison(state, baseCommit, compareCommit);
  const sameBranch = baseBranch.name === compareBranch.name;

  return {
    status: "ok",
    comparison: {
      repository: publicRepositoryPayload(state, repository, accountId),
      branches: branchNamesOf(state, repository),
      base: { name: baseBranch.name, commit: commitIdentity(state, baseCommit) },
      compare: { name: compareBranch.name, commit: commitIdentity(state, compareCommit) },
      sameBranch,
      ...comparison,
      noChanges: sameBranch || comparison.noChanges,
      // The creation entry of the comparison page is offered whenever the two
      // distinct branches really differ; the write itself re-checks the role
      // and the branch pair on the server.
      canCreate: !sameBranch && !comparison.noChanges,
    },
  };
}

/**
 * The pull-request service: the list of the current repository, the read-only
 * branch comparison and the detail of one numbered pull request. The creation
 * and the status transitions live in `pull-request-transitions.mjs`.
 */
export function createPullRequestService(store) {
  async function listForViewer(owner, repositoryName, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;
    const rows = pullRequestsOf(state, repository.id)
      .slice()
      .sort((left, right) => right.number - left.number)
      .map((pullRequest) => rowPayload(state, pullRequestView(state, pullRequest)));
    return {
      status: "ok",
      list: {
        repository: publicRepositoryPayload(state, repository, accountId),
        canCreate: canWriteRepository(state, repository, accountId),
        pullRequests: rows,
        counts: {
          draft: rows.filter((row) => row.status === "draft").length,
          open: rows.filter((row) => row.status === "open").length,
          closed: rows.filter((row) => row.status === "closed").length,
          merged: rows.filter((row) => row.status === "merged").length,
          all: rows.length,
        },
      },
    };
  }

  /** The comparison page needs Write or higher; Read and Triage stay out. */
  async function comparisonForViewer(owner, repositoryName, options, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;
    if (!canWriteRepository(state, repository, accountId)) return { status: "denied" };
    const base =
      typeof options?.base === "string" && options.base.trim().length > 0
        ? options.base.trim()
        : repository.defaultBranch;
    const compare =
      typeof options?.compare === "string" && options.compare.trim().length > 0
        ? options.compare.trim()
        : repository.defaultBranch;
    return branchComparisonPayload(state, repository, base, compare, accountId);
  }

  async function detailForViewer(owner, repositoryName, number, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;
    const pullRequest = pullRequestByNumber(state, repository.id, number);
    if (!pullRequest) return { status: "not-found" };
    return {
      status: "ok",
      detail: pullRequestDetailPayload(state, repository, pullRequest, accountId),
    };
  }

  return { listForViewer, comparisonForViewer, detailForViewer };
}

/** Exposed for the creation service of `pull-request-transitions.mjs`. */
export function newPullRequestNumber(state, repositoryId) {
  return (
    pullRequestsOf(state, repositoryId).reduce(
      (highest, existing) => Math.max(highest, existing.number),
      0,
    ) + 1
  );
}

export function pullRequestClock() {
  return clock();
}

/** The live branch pair of a creation request, or the reason it is invalid. */
export function creationComparison(state, repository, source) {
  const baseBranch = branchByName(
    state,
    repository.id,
    typeof source.base === "string" && source.base.trim().length > 0
      ? source.base.trim()
      : repository.defaultBranch,
  );
  const compareBranch = branchByName(
    state,
    repository.id,
    typeof source.compare === "string" && source.compare.trim().length > 0
      ? source.compare.trim()
      : repository.defaultBranch,
  );
  const errors = {};
  if (!baseBranch) errors.base = PULL_REQUEST_MESSAGES.branchNotFound;
  if (!compareBranch) errors.compare = PULL_REQUEST_MESSAGES.branchNotFound;
  if (baseBranch && compareBranch) {
    if (baseBranch.name === compareBranch.name) {
      errors.compare = PULL_REQUEST_MESSAGES.sameBranch;
    } else {
      const comparison = commitComparison(
        state,
        baseBranch.commitId ? commitById(state, baseBranch.commitId) : null,
        compareBranch.commitId ? commitById(state, compareBranch.commitId) : null,
      );
      if (comparison.noChanges) errors.compare = PULL_REQUEST_MESSAGES.noChanges;
      else if (
        pullRequestsOf(state, repository.id).some(
          (existing) =>
            LIVE_STATUSES.has(existing.status) &&
            existing.sourceBranch === compareBranch.name &&
            existing.targetBranch === baseBranch.name,
        )
      ) {
        errors.compare = PULL_REQUEST_MESSAGES.pairExists;
      }
    }
  }
  return { baseBranch, compareBranch, errors };
}
