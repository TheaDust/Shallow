/**
 * Pull request read model (REQ-6, REQ-6-1).
 *
 * A pull request is a persistent proposal to merge the changes of a compare
 * branch into a base branch; it is not a branch, a commit or an issue. It
 * stores its repository-scoped number, title, description, author, status, the
 * source and target branches, the creation-time base and compare commits, the
 * reviewers, the reviews, the ordinary comments, the check results of the
 * compare commit and its append-only activity records.
 *
 * The "current compare commit" is the commit the compare branch points at right
 * now: when the branch gains a commit, the current compare commit moves with
 * it, so a review decision and a check result recorded for the previous commit
 * no longer count for the new one (REQ-6-1).
 */

import { mergeRestrictionFor, REQUIRED_CHECK_NAME, CHECK_STATUSES } from "./branch-protection.mjs";
import { COMMIT_ROLES, effectiveRepositoryRole } from "./repository-access.mjs";
import {
  commitSnapshot,
  commitSummary,
  findRepositoryBranch,
  findRepositoryCommit,
} from "./repository-branches.mjs";
import { diffSummary, revisionChanges } from "./repository-diff.mjs";

/** The four persisted statuses a pull request can hold (REQ-6). */
export const PULL_REQUEST_STATUSES = ["draft", "open", "closed", "merged"];

/** The decisions one review can record; only the latest one per reviewer counts. */
export const PULL_REQUEST_DECISIONS = ["comment", "approve", "request_changes"];

/** The longest title and description a pull request stores (REQ-6-2-3). */
export const MAX_PULL_REQUEST_TITLE = 256;
export const MAX_PULL_REQUEST_DESCRIPTION = 65536;

/**
 * The review status of a pull request: the decision of the current compare
 * commit, without the author's own decisions (REQ-6-1). It is derived state
 * used by the filter of the Pull requests list page (REQ-6-2-1).
 */
export const PULL_REQUEST_REVIEW_STATUSES = ["review_required", "approved", "changes_requested"];

export const PULL_REQUEST_MESSAGES = {
  notFound: "Pull request not found",
  createSignInRequired: "Sign in is required to create a pull request",
  createForbidden: "You do not have permission to create a pull request",
  createFailed: "The pull request could not be created",
  titleRequired: "Title is required",
  titleTooLong: `Title must be ${MAX_PULL_REQUEST_TITLE} characters or fewer`,
  descriptionTooLong: `Description must be ${MAX_PULL_REQUEST_DESCRIPTION} characters or fewer`,
  unknownBranch: "Branch not found",
  sameBranches: "Choose two different branches",
  noChanges: "There are no changes between these branches",
  duplicatePair: "A pull request for these branches already exists",
  readySignInRequired: "Sign in is required to mark this pull request ready for review",
  readyForbidden: "You do not have permission to mark this pull request ready for review",
  readyNotDraft: "Only a draft pull request can be marked ready for review",
  readyFailed: "The pull request could not be marked ready for review",
  checkForbidden: "Only a repository Admin can update the check status",
  checkSignInRequired: "Sign in is required to update the check status",
  checkStatusUnknown: "Unknown check status",
  checkFailed: "The check status could not be saved",
  mergeForbidden: "You do not have permission to merge this pull request",
  mergeSignInRequired: "Sign in is required to merge this pull request",
  mergeFailed: "The pull request could not be merged",
  commentSignInRequired: "Sign in is required to comment on a pull request",
  commentForbidden: "You do not have permission to comment on this pull request",
  commentNotOpen: "Only an open pull request can be commented on",
  commentRequired: "Comment is required",
  commentFileUnknown: "The file is not part of this pull request",
  commentLineUnknown: "The line is not part of this pull request",
  commentFailed: "The comment could not be saved",
  reviewSignInRequired: "Sign in is required to review a pull request",
  reviewForbidden: "You do not have permission to review this pull request",
  reviewNotOpen: "Only an open pull request can be reviewed",
  reviewDecisionUnknown: "Unknown review decision",
  reviewSummaryTooLong: `Summary must be ${MAX_PULL_REQUEST_DESCRIPTION} characters or fewer`,
  reviewFailed: "The review could not be saved",
  reviewerSignInRequired: "Sign in is required to request reviewers",
  reviewerForbidden: "You do not have permission to request reviewers",
  reviewerNotOpen: "Only an open or draft pull request can request reviewers",
  reviewerIneligible: "That account cannot be requested as a reviewer",
  reviewerRequired: "Reviewer is required",
  reviewerUnknown: "Reviewer request not found",
  reviewerFailed: "The reviewer request could not be saved",
  statusSignInRequired: "Sign in is required to change the pull request status",
  statusForbidden: "You do not have permission to change the pull request status",
  statusCloseNotAllowed: "Only an open or draft pull request can be closed",
  statusReopenNotAllowed: "Only a closed pull request can be reopened",
  statusFailed: "The pull request status could not be changed",
};

/**
 * The explanation the merge area spells for a missing required approval
 * (REQ-6-5): the exact sentence the blocked pull request shows next to its
 * disabled merge entry.
 */
export const REVIEW_REQUIRED_MESSAGE = "Review required by branch protection";

export function pullRequestStatus(pullRequest) {
  const status = String(pullRequest?.status ?? "").toLowerCase();
  return PULL_REQUEST_STATUSES.includes(status) ? status : "open";
}

export function checkStatusValue(value) {
  const status = String(value ?? "").toLowerCase();
  return CHECK_STATUSES.includes(status) ? status : null;
}

/** Every pull request of one repository, ordered by its scoped number. */
export function repositoryPullRequests(data, repository) {
  return (data.pullRequests ?? [])
    .filter((pullRequest) => pullRequest && pullRequest.repositoryId === repository.id)
    .sort((left, right) => Number(left.number ?? 0) - Number(right.number ?? 0));
}

/** One pull request of a repository by its repository-scoped number. */
export function findRepositoryPullRequest(data, repository, number) {
  const wanted = typeof number === "number" ? number : Number.parseInt(String(number ?? ""), 10);
  if (!Number.isInteger(wanted)) return null;
  return repositoryPullRequests(data, repository).find((pullRequest) => Number(pullRequest.number) === wanted) ?? null;
}

/**
 * One row of the Pull requests page. The `reviewStatus` is derived from the
 * decisions of the current compare commit, so the list page can filter by it
 * without reading the whole detail of every pull request.
 */
export function pullRequestSummary(pullRequest, commitId = null) {
  return {
    id: pullRequest.id ?? "",
    number: Number(pullRequest.number ?? 0),
    title: pullRequest.title ?? "",
    description: pullRequest.description ?? "",
    author: pullRequest.author ?? "",
    authorId: pullRequest.authorId ?? null,
    status: pullRequestStatus(pullRequest),
    baseBranch: pullRequest.baseBranch ?? "",
    compareBranch: pullRequest.compareBranch ?? "",
    reviewStatus: pullRequestReviewStatus(pullRequest, commitId),
    createdAt: pullRequest.createdAt ?? null,
    updatedAt: pullRequest.updatedAt ?? pullRequest.createdAt ?? null,
  };
}

/**
 * The rows of the Pull requests page of one repository (REQ-6-2-1). Every row
 * is read from the stored records of the addressed repository only.
 */
export function repositoryPullRequestSummaries(data, repository) {
  return repositoryPullRequests(data, repository).map((pullRequest) =>
    pullRequestSummary(pullRequest, pullRequestCompareCommit(repository, pullRequest)?.id ?? ""));
}

/** The commit the compare branch points at right now (REQ-6-1). */
export function pullRequestCompareCommit(repository, pullRequest) {
  const branch = findRepositoryBranch(repository, pullRequest?.compareBranch);
  const head = branch ? findRepositoryCommit(repository, branch.headId) : null;
  if (head) return head;
  return findRepositoryCommit(repository, pullRequest?.currentCompareCommitId)
    ?? findRepositoryCommit(repository, pullRequest?.compareCommitId)
    ?? null;
}

/** The creation-time base commit of the pull request, or the base branch head. */
export function pullRequestBaseCommit(repository, pullRequest) {
  const stored = findRepositoryCommit(repository, pullRequest?.baseCommitId);
  if (stored) return stored;
  const branch = findRepositoryBranch(repository, pullRequest?.baseBranch);
  return branch ? findRepositoryCommit(repository, branch.headId) : null;
}

function ancestorIds(repository, commit) {
  const ids = new Set();
  let cursor = commit;
  while (cursor && !ids.has(cursor.id)) {
    ids.add(cursor.id);
    cursor = cursor.parentId ? findRepositoryCommit(repository, cursor.parentId) : null;
  }
  return ids;
}

/** The commits of the compare branch that the base revision does not carry. */
export function pullRequestCommits(repository, pullRequest) {
  const compare = pullRequestCompareCommit(repository, pullRequest);
  if (!compare) return [];
  const baseIds = ancestorIds(repository, pullRequestBaseCommit(repository, pullRequest));
  const commits = [];
  const seen = new Set();
  let cursor = compare;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (!baseIds.has(cursor.id)) commits.push(cursor);
    cursor = cursor.parentId ? findRepositoryCommit(repository, cursor.parentId) : null;
  }
  return commits
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .map(commitSummary);
}

/** The per-file, per-line difference of the compare branch against the base. */
export function pullRequestChangedFiles(repository, pullRequest) {
  const base = pullRequestBaseCommit(repository, pullRequest);
  const compare = pullRequestCompareCommit(repository, pullRequest);
  if (!compare) return [];
  return revisionChanges(base ? commitSnapshot(base) : [], commitSnapshot(compare)).map(numberFileLines);
}

/**
 * The lines of one changed file with the position each side shows (REQ-6-3):
 * every line carries the position it holds in the diff, the line number of the
 * removed side and of the added side, and the `side` an inline review comment
 * anchors to. A context line belongs to both sides and is not commentable; an
 * added line is anchored by its number on the new side and a removed line by
 * its number on the old side.
 */
export function numberFileLines(file) {
  let oldNumber = 0;
  let newNumber = 0;
  const lines = (file?.lines ?? []).map((line, index) => {
    const removed = line.type === "removed" || line.type === "context";
    const added = line.type === "added" || line.type === "context";
    if (removed) oldNumber += 1;
    if (added) newNumber += 1;
    return {
      index: index + 1,
      type: line.type,
      text: line.text,
      oldNumber: removed ? oldNumber : null,
      newNumber: added ? newNumber : null,
      lineNumber: line.type === "removed" ? oldNumber : newNumber,
      side: line.type === "added" ? "added" : line.type === "removed" ? "removed" : "context",
    };
  });
  return { ...file, lines };
}

/** The changed line an inline comment addresses, or null (REQ-6-3-3). */
export function findChangedLine(file, line, side) {
  const wanted = Number(line);
  if (!Number.isInteger(wanted) || wanted < 1) return null;
  const wantedSide = side === "removed" ? "removed" : "added";
  return (file?.lines ?? [])
    .find((entry) => entry.side === wantedSide && Number(entry.lineNumber) === wanted) ?? null;
}

/** The stored record of one check of one commit, or null while it is pending. */
export function checkRecord(pullRequest, commitId, name = REQUIRED_CHECK_NAME) {
  const wanted = String(commitId ?? "");
  return (pullRequest?.checks ?? []).find(
    (check) => check && check.name === name && String(check.commitId ?? "") === wanted,
  ) ?? null;
}

/**
 * The `test` check of the current compare commit (REQ-6-1): the stored status
 * together with its setter and time, or `pending` while no result was stored
 * for that commit — a new compare commit therefore starts pending again.
 */
export function pullRequestCheck(repository, pullRequest) {
  const commit = pullRequestCompareCommit(repository, pullRequest);
  const commitId = commit?.id ?? pullRequest?.currentCompareCommitId ?? pullRequest?.compareCommitId ?? "";
  const record = checkRecord(pullRequest, commitId);
  const status = checkStatusValue(record?.status) ?? "pending";
  return {
    name: REQUIRED_CHECK_NAME,
    status,
    commitId,
    setBy: record?.setBy ?? null,
    setAt: record?.setAt ?? null,
    storable: true,
  };
}

/** Every stored result of the pull request, newest last. */
export function pullRequestChecks(pullRequest) {
  return (pullRequest?.checks ?? []).map((check) => ({
    id: check.id ?? "",
    name: check.name ?? REQUIRED_CHECK_NAME,
    commitId: check.commitId ?? "",
    status: checkStatusValue(check.status) ?? "pending",
    setBy: check.setBy ?? null,
    setAt: check.setAt ?? null,
  }));
}

/**
 * The latest decision of every reviewer on one commit. A decision recorded for
 * another commit is stale and does not count (REQ-6-1).
 */
export function latestDecisions(pullRequest, commitId) {
  const wanted = String(commitId ?? "");
  const latest = new Map();
  for (const review of pullRequest?.reviews ?? []) {
    if (String(review?.commitId ?? "") !== wanted) continue;
    const key = review.reviewerId ?? review.reviewer ?? "";
    const current = latest.get(key);
    if (!current || String(review.createdAt ?? "") >= String(current.createdAt ?? "")) latest.set(key, review);
  }
  return [...latest.values()];
}

function isPullRequestAuthor(pullRequest, review) {
  if (!review) return false;
  if (review.reviewerId && pullRequest.authorId) return review.reviewerId === pullRequest.authorId;
  return Boolean(review.reviewer) && review.reviewer === pullRequest.author;
}

/** The reviews of the pull request; a decision of another commit is stale. */
export function pullRequestReviews(repository, pullRequest) {
  const commitId = pullRequestCompareCommit(repository, pullRequest)?.id ?? "";
  return (pullRequest?.reviews ?? []).map((review) => ({
    id: review.id ?? "",
    reviewer: review.reviewer ?? "",
    reviewerId: review.reviewerId ?? null,
    decision: PULL_REQUEST_DECISIONS.includes(review.decision) ? review.decision : "comment",
    summary: review.summary ?? "",
    commitId: review.commitId ?? "",
    createdAt: review.createdAt ?? null,
    stale: String(review.commitId ?? "") !== String(commitId),
  }));
}

/**
 * The review status of the pull request's current compare commit (REQ-6-1,
 * REQ-6-2-1): a valid request for changes wins over a valid approval, and a
 * compare commit without any valid decision is still waiting for a review. A
 * decision of the author never counts, and a decision of an older compare
 * commit is stale and therefore ignored.
 */
export function pullRequestReviewStatus(pullRequest, commitId) {
  const decisions = latestDecisions(pullRequest, commitId);
  const valid = decisions.filter((decision) => !isPullRequestAuthor(pullRequest, decision));
  if (valid.some((decision) => decision.decision === "request_changes")) return "changes_requested";
  if (valid.some((decision) => decision.decision === "approve")) return "approved";
  return "review_required";
}

/**
 * The accounts that may be requested as a reviewer of this pull request
 * (REQ-6-4): every account with Write, Maintain or Admin on the repository that
 * is not the author of the proposal itself. The picker of the Reviewers area
 * filters this list as the user types in its `Search` textbox.
 */
export function pullRequestReviewerCandidates(data, repository, pullRequest) {
  return (data?.accounts ?? [])
    .filter((account) => account && account.id !== pullRequest?.authorId)
    .map((account) => ({
      username: account.username ?? "",
      accountId: account.id ?? null,
      role: effectiveRepositoryRole(data, repository, account.id),
    }))
    .filter((candidate) => candidate.username && COMMIT_ROLES.includes(candidate.role))
    .sort((left, right) => left.username.localeCompare(right.username));
}

/** The accounts asked to review the pull request. */
export function pullRequestReviewers(pullRequest) {
  return (pullRequest?.reviewers ?? [])
    .map((reviewer) => (typeof reviewer === "string" ? { username: reviewer, requestedBy: null, requestedAt: null } : {
      username: reviewer?.username ?? "",
      requestedBy: reviewer?.requestedBy ?? null,
      requestedAt: reviewer?.requestedAt ?? null,
    }))
    .filter((reviewer) => reviewer.username);
}

/** The stored comments of the pull request, oldest first. */
export function pullRequestComments(pullRequest) {
  return (pullRequest?.comments ?? []).map((comment) => ({
    id: comment.id ?? "",
    author: comment.author ?? "",
    body: comment.body ?? "",
    createdAt: comment.createdAt ?? null,
  }));
}

/**
 * The inline review comments of the pull request (REQ-6-3-3): each one is
 * anchored to a file path, a changed line and the compare commit it was written
 * for, and displays its author and body. A draft kept by `Start a review` stays
 * private to its author until the review is submitted; a published comment of
 * an older compare commit is retained but marked `Outdated`.
 */
export function pullRequestReviewComments(pullRequest, currentCommitId, viewerAccountId = null) {
  const current = String(currentCommitId ?? "");
  return (pullRequest?.reviewComments ?? [])
    .filter((comment) => comment && !(comment.pending === true && (viewerAccountId ?? null) !== (comment.authorId ?? null)))
    .map((comment) => ({
      id: comment.id ?? "",
      filePath: comment.filePath ?? "",
      line: Number(comment.line ?? 0),
      side: comment.side === "removed" ? "removed" : "added",
      commitId: comment.commitId ?? "",
      author: comment.author ?? "",
      authorId: comment.authorId ?? null,
      body: comment.body ?? "",
      pending: comment.pending === true,
      createdAt: comment.createdAt ?? null,
      outdated: comment.pending !== true && String(comment.commitId ?? "") !== current,
    }));
}

/** The append-only activity records of the pull request, oldest first. */
export function pullRequestTimeline(pullRequest) {
  return (pullRequest?.timeline ?? []).map((event) => ({
    id: event.id ?? "",
    type: event.type ?? "activity",
    actor: event.actor ?? "",
    text: event.text ?? "",
    createdAt: event.createdAt ?? null,
  }));
}

/**
 * Whether the pull request may be merged right now (REQ-6-1).
 *
 * The requirements of the rule bound to the base branch are applied together
 * with the decisions of the current compare commit: one valid approval from an
 * account other than the author satisfies the approval requirement, any valid
 * request for changes blocks the merge, and the required check has to be
 * `success`. A draft or a closed pull request never merges, and a merged one is
 * terminal.
 */
export function pullRequestMergeState(repository, pullRequest) {
  const status = pullRequestStatus(pullRequest);
  const commitId = pullRequestCompareCommit(repository, pullRequest)?.id ?? "";
  const decisions = latestDecisions(pullRequest, commitId);
  const rule = mergeRestrictionFor(repository, pullRequest?.baseBranch);
  const blockers = [];

  if (status === "draft") blockers.push({ code: "draft", message: "This pull request is a draft." });
  else if (status === "closed") blockers.push({ code: "closed", message: "This pull request is closed." });
  else if (status === "merged") blockers.push({ code: "merged", message: "This pull request is already merged." });

  const changesRequested = decisions.filter(
    (decision) => decision.decision === "request_changes" && !isPullRequestAuthor(pullRequest, decision),
  );
  if (changesRequested.length > 0) {
    blockers.push({ code: "changes_requested", message: "A reviewer requested changes." });
  }

  const approvals = decisions.filter(
    (decision) => decision.decision === "approve" && !isPullRequestAuthor(pullRequest, decision),
  );
  if (rule?.requireApproval === true && approvals.length < 1) {
    blockers.push({ code: "approval", message: REVIEW_REQUIRED_MESSAGE });
  }

  const check = pullRequestCheck(repository, pullRequest);
  if (rule?.requireStatusCheck === true && check.status !== "success") {
    blockers.push({
      code: "status_check",
      message: `The required check test is ${check.status}.`,
    });
  }

  // The merge confirmation area lists every condition it checked, spelled as
  // satisfied or unsatisfied (REQ-6-5).
  const conditions = [];
  if (rule?.requireApproval === true) {
    conditions.push({ code: "approval", label: "Require 1 approval", satisfied: approvals.length >= 1 });
  }
  if (rule?.requireStatusCheck === true) {
    conditions.push({
      code: "status_check",
      label: "Require status check test",
      satisfied: check.status === "success",
    });
  }
  conditions.push({
    code: "changes_requested",
    label: "No requested changes",
    satisfied: changesRequested.length === 0,
  });

  return {
    mergeable: blockers.length === 0,
    status,
    blockers,
    conditions,
    rules: {
      requireApproval: rule?.requireApproval === true,
      requireStatusCheck: rule?.requireStatusCheck === true,
      pattern: rule?.pattern ?? null,
    },
    approvals: approvals.length,
    changeRequests: changesRequested.length,
  };
}

/** What the current caller may do with this pull request (REQ-6, REQ-6-1). */
export function pullRequestPermissions(data, repository, pullRequest, accountId) {
  const role = effectiveRepositoryRole(data, repository, accountId);
  const isAuthor = Boolean(accountId) && accountId === pullRequest?.authorId;
  const maintainer = role === "Maintain" || role === "Admin";
  const canReview = COMMIT_ROLES.includes(role);
  const status = pullRequestStatus(pullRequest);
  // REQ-6-4 / REQ-6-6: the author, a Maintain, Admin or organization Owner
  // manages the reviewer requests of an Open or Draft pull request and closes
  // or reopens it; every other account may only read. A merged pull request is
  // terminal, so it offers neither entry.
  const canChangeStatus = isAuthor || maintainer;
  const openOrDraft = status === "open" || status === "draft";
  // REQ-6-3: a reviewer writes inline comments and submits a decision, but only
  // while the pull request is open and never on their own proposal.
  const canReviewOpen = canReview && !isAuthor && status === "open";
  return {
    canUpdateChecks: role === "Admin",
    canMerge: maintainer,
    canReview,
    canComment: canReview,
    canCommentOnLines: canReviewOpen,
    canSubmitReview: canReviewOpen,
    canChangeStatus,
    canRequestReviewers: canChangeStatus && openOrDraft,
    canClose: canChangeStatus && openOrDraft,
    canReopen: canChangeStatus && status === "closed",
    // Only Write, Maintain, Admin or an organization Owner may open a pull
    // request; a draft may be moved to Open by its author or a maintainer.
    canCreate: canCreatePullRequest(data, repository, accountId),
    canMarkReady: isAuthor || maintainer,
  };
}

/**
 * Whether the account may create a pull request (REQ-6-2-2, REQ-6-2-3): Write,
 * Maintain, Admin or an organization Owner. Read and Triage may only view.
 */
export function canCreatePullRequest(data, repository, accountId) {
  return COMMIT_ROLES.includes(effectiveRepositoryRole(data, repository, accountId));
}

/** The complete detail read model of one pull request (REQ-6). */
export function pullRequestDetail(data, repository, pullRequest, accountId) {
  const compare = pullRequestCompareCommit(repository, pullRequest);
  const files = pullRequestChangedFiles(repository, pullRequest);
  return {
    ...pullRequestSummary(pullRequest, compare?.id ?? ""),
    baseCommitId: pullRequest?.baseCommitId ?? null,
    compareCommitId: pullRequest?.compareCommitId ?? null,
    currentCompareCommitId: compare?.id ?? null,
    currentCompareCommit: compare ? commitSummary(compare) : null,
    reviewers: pullRequestReviewers(pullRequest),
    reviewerCandidates: pullRequestReviewerCandidates(data, repository, pullRequest),
    reviews: pullRequestReviews(repository, pullRequest),
    comments: pullRequestComments(pullRequest),
    reviewComments: pullRequestReviewComments(pullRequest, compare?.id ?? "", accountId),
    timeline: pullRequestTimeline(pullRequest),
    checks: pullRequestChecks(pullRequest),
    check: pullRequestCheck(repository, pullRequest),
    // REQ-6-5: the merge stores its operator, time and resulting commit, so a
    // merged pull request spells who merged it and in which commit.
    mergedBy: pullRequest?.mergedBy ?? null,
    mergedAt: pullRequest?.mergedAt ?? null,
    mergeCommitId: pullRequest?.mergeCommitId ?? null,
    closedAt: pullRequest?.closedAt ?? null,
    commits: pullRequestCommits(repository, pullRequest),
    files,
    summary: diffSummary(files),
    merge: pullRequestMergeState(repository, pullRequest),
    permissions: pullRequestPermissions(data, repository, pullRequest, accountId),
  };
}
