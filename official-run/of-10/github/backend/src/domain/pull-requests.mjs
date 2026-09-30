/**
 * Pull requests of one repository (REQ-6).
 *
 * A pull request is a persistent proposal to merge the changes of its compare
 * (source) branch into its base (target) branch. It stores a repository-scoped
 * number, both branch names, the creation-time base commit, the current compare
 * commit, its title, description, author and status, plus its comments, review
 * decisions, check results and append-only activity timeline.
 *
 * Everything a view reads is derived from that stored record together with the
 * current commit graph: the comparable commits, the changed files, the current
 * compare commit, the check status of that commit and the merge eligibility.
 * Because the compare branch is read at request time, a new commit on it moves
 * the current compare commit, makes older review decisions stale (their stored
 * `commitId` no longer matches) and resets the check result to `pending`; the
 * stored decisions themselves are preserved.
 */

import {
  compareRevisions,
  commitAncestors,
  fileContentAt,
  findCommit,
  shortCommitId,
  toCommitRecord,
} from "./commit-graph.mjs";
import { findBranchProtectionRule } from "./branch-protection.mjs";
import { effectiveRepositoryRole } from "./repository-access.mjs";

/** The only statuses a pull request may be persisted in (REQ-6). */
export const PULL_REQUEST_STATUSES = ["draft", "open", "closed", "merged"];

export const PULL_REQUEST_STATUS_LABELS = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  merged: "Merged",
};

/** The one check this product evaluates for a merge (REQ-6-1). */
export const REQUIREMENT_CHECK_NAME = "test";
export const CHECK_STATUSES = ["pending", "success", "failure"];

/**
 * The only merge method this product supports (REQ-6-5): one commit on the base
 * branch whose content is the compare branch's content and whose parents are the
 * base head at merge time and the current compare commit.
 */
export const MERGE_METHODS = ["merge"];
export const MERGE_METHOD_LABEL = "Create a merge commit";

export function isMergeMethod(value) {
  return MERGE_METHODS.includes(String(value ?? "").trim().toLowerCase());
}

/**
 * The creation limits of a pull request (REQ-6-2-3): the title is the 1–256
 * non-empty characters that remain after trimming the surrounding whitespace,
 * and the optional description holds at most 65536 characters. The same rules
 * gate the creation form on the comparison page, so a rejected submission never
 * reaches the store.
 */
export const PULL_REQUEST_TITLE_MAX_LENGTH = 256;
export const PULL_REQUEST_DESCRIPTION_MAX_LENGTH = 65_536;

export const REVIEW_DECISIONS = ["comment", "approve", "request_changes"];

/**
 * The status one stored review decision reads as (REQ-6-3-4): an approval shows
 * `Approved`, a rejection `Changes requested` and a plain review `Commented`.
 */
export const REVIEW_DECISION_LABELS = {
  comment: "Commented",
  approve: "Approved",
  request_changes: "Changes requested",
};

export const PULL_REQUEST_MESSAGES = {
  cannotCreate: "You need write permission to create a pull request in this repository.",
  cannotWrite: "You need write permission to add comments or reviews.",
  cannotSetChecks: "You must be a repository administrator to update the check status.",
  cannotRequestReviewers: "Only the author or a maintainer may request reviewers.",
  cannotChangeStatus: "You may not change the status of this pull request.",
  cannotMerge: "Only a maintainer or administrator may merge a pull request.",
  titleRequired: "Title is required",
  titleTooLong: `Title is too long (${PULL_REQUEST_TITLE_MAX_LENGTH} characters maximum)`,
  descriptionTooLong: `Description is too long (${PULL_REQUEST_DESCRIPTION_MAX_LENGTH} characters maximum)`,
  sameBranch: "Choose two different branches",
  noComparableCommits: "These branches have no comparable commits",
  duplicate: "A pull request already exists for these branches",
  commentRequired: "Comment is required",
  unknownCheck: "Unknown check status",
  unknownDecision: "Unknown review decision",
  unknownStatus: "Unknown pull request status",
  reviewerRequired: "Choose a reviewer",
  reviewerUnknown: "That account cannot review this repository",
  invalidTransition: "That status change is not allowed",
  mergedTerminal: "A merged pull request cannot be changed",
  notMergeable: "The pull request cannot be merged yet.",
  // The merge entry of a pull request whose protected base branch still misses a
  // non-author approval (REQ-6-5).
  reviewRequired: "Review required by branch protection",
  unknownMergeMethod: "Unknown merge method",
  conflict: "This branch has conflicts that must be resolved.",
  // The code of a proposal is reviewed by somebody else: its author describes,
  // comments and manages it but never reviews the own change (REQ-6-3-3,
  // REQ-6-3-4).
  authorCannotReview: "The author of a pull request cannot review it.",
  authorCannotComment: "The author of a pull request cannot comment on its code lines.",
  reviewNeedsOpen: "Only an open pull request accepts review comments.",
  // One inline comment is anchored to a file of the current comparison and to
  // one added or deleted line of that file.
  inlinePathUnknown: "That file is not part of this comparison.",
  inlineLineUnknown: "That line cannot be commented on.",
  reviewerNotRequested: "That account is not a requested reviewer.",
  // A Draft proposal accepts neither a review decision nor a merge (REQ-6-2-4):
  // its author or a maintainer first marks it ready for review.
  draftReview: "A draft pull request cannot be reviewed. Mark it ready for review first.",
  draftMerge: "A draft pull request cannot be merged. Mark it ready for review first.",
};

const WRITABLE_ROLES = new Set(["write", "maintain", "admin"]);
const MANAGING_ROLES = new Set(["maintain", "admin"]);

/** Trims the surrounding whitespace of a submitted title or description. */
export function normalizePullRequestText(value) {
  return String(value ?? "").trim();
}

/**
 * The complaint of a submitted title, or null when it is acceptable. A title of
 * only whitespace is empty after trimming, and the stored title keeps at most
 * the 256 characters the requirement allows.
 */
export function pullRequestTitleError(value) {
  const title = normalizePullRequestText(value);
  if (!title) return PULL_REQUEST_MESSAGES.titleRequired;
  if (title.length > PULL_REQUEST_TITLE_MAX_LENGTH) {
    return PULL_REQUEST_MESSAGES.titleTooLong;
  }
  return null;
}

/** The complaint of an optional submitted description, or null when it fits. */
export function pullRequestDescriptionError(value) {
  const description = normalizePullRequestText(value);
  if (description.length > PULL_REQUEST_DESCRIPTION_MAX_LENGTH) {
    return PULL_REQUEST_MESSAGES.descriptionTooLong;
  }
  return null;
}

export function isPullRequestStatus(value) {
  return PULL_REQUEST_STATUSES.includes(String(value ?? "").trim().toLowerCase());
}

export function isCheckStatus(value) {
  return CHECK_STATUSES.includes(String(value ?? "").trim().toLowerCase());
}

export function isReviewDecision(value) {
  return REVIEW_DECISIONS.includes(String(value ?? "").trim().toLowerCase());
}

export function pullRequestStatusLabel(status) {
  return PULL_REQUEST_STATUS_LABELS[status] ?? String(status ?? "");
}

/** Write, Maintain and Admin create pull requests and write reviews (REQ-6). */
export function canWritePullRequests(state, repository, viewer) {
  return WRITABLE_ROLES.has(effectiveRepositoryRole(state, repository, viewer));
}

/** Maintain and Admin (and an organization Owner) manage and merge (REQ-6). */
export function canManagePullRequests(state, repository, viewer) {
  return MANAGING_ROLES.has(effectiveRepositoryRole(state, repository, viewer));
}

export function accountUsername(state, accountId) {
  const account = (state.accounts ?? []).find((candidate) => candidate.id === accountId);
  return account ? account.username : "";
}

/** Every pull request of one repository, newest number first. */
export function pullRequestsOfRepository(state, repositoryId) {
  return (state.pullRequests ?? [])
    .filter((pullRequest) => pullRequest.repositoryId === repositoryId)
    .sort((left, right) => right.number - left.number);
}

export function findPullRequest(state, repositoryId, number) {
  const wanted = Number(number);
  if (!Number.isInteger(wanted)) return null;
  return (
    (state.pullRequests ?? []).find(
      (pullRequest) => pullRequest.repositoryId === repositoryId && pullRequest.number === wanted,
    ) ?? null
  );
}

/** The repository-scoped number of the next pull request. */
export function nextPullRequestNumber(state, repositoryId) {
  const numbers = (state.pullRequests ?? [])
    .filter((pullRequest) => pullRequest.repositoryId === repositoryId)
    .map((pullRequest) => pullRequest.number);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/** The commit a branch currently points at, or null for an unknown branch. */
export function branchHeadCommitId(repository, branch) {
  const reference = (repository?.branches ?? []).find(
    (candidate) => candidate.name === branch,
  );
  return reference?.headCommitId ?? null;
}

/** The compare branch's current head: the commit the merge would propose. */
export function currentCompareCommitId(repository, pullRequest) {
  return (
    branchHeadCommitId(repository, pullRequest.compareBranch) ??
    pullRequest.compareCommitId ??
    null
  );
}

/** The base branch's current head: the commit the changes would be merged into. */
export function currentBaseCommitId(repository, pullRequest) {
  return (
    branchHeadCommitId(repository, pullRequest.baseBranch) ??
    pullRequest.baseCommitId ??
    null
  );
}

/**
 * The newest commit both revisions already share: the point a merge starts from.
 * Changes made on either side since that point collide when they end up with
 * different content for the same path.
 */
export function mergeBaseCommitId(repository, leftCommitId, rightCommitId) {
  if (!leftCommitId || !rightCommitId) return null;
  const rightAncestors = new Set(
    commitAncestors(repository, rightCommitId).map((commit) => commit.id),
  );
  return (
    commitAncestors(repository, leftCommitId).find((commit) => rightAncestors.has(commit.id))?.id ??
    null
  );
}

/**
 * The changed paths both branches touched with different content since the point
 * they still shared (REQ-6-5). The paths themselves are reported, so a blocked
 * merge names the files that must be resolved; an empty list means the comparison
 * can be merged without conflicts.
 */
export function mergeConflicts(repository, pullRequest) {
  const baseCommitId = currentBaseCommitId(repository, pullRequest);
  const compareCommitId = currentCompareCommitId(repository, pullRequest);
  if (!baseCommitId || !compareCommitId) return [];
  const base = mergeBaseCommitId(repository, baseCommitId, compareCommitId);
  if (!base) return [];
  const baseChanges = compareRevisions(repository, base, baseCommitId).changedFiles;
  const conflicts = [];
  for (const file of compareRevisions(repository, base, compareCommitId).changedFiles) {
    if (!baseChanges.some((candidate) => candidate.path === file.path)) continue;
    const baseContent = fileContentAt(repository, baseCommitId, file.path);
    const compareContent = fileContentAt(repository, compareCommitId, file.path);
    if (baseContent === compareContent) continue;
    conflicts.push(file.path);
  }
  return conflicts.sort();
}

/**
 * Commits reachable from the compare commit but not from the base commit, i.e.
 * the commits a merge of this pull request would bring in.
 */
export function commitsAhead(repository, baseCommitId, compareCommitId) {
  const baseIds = new Set(commitAncestors(repository, baseCommitId).map((commit) => commit.id));
  return commitAncestors(repository, compareCommitId).filter((commit) => !baseIds.has(commit.id));
}

/**
 * The read-only comparison of a pull request's two branches: comparable commits,
 * changed files and the line-level diff of the commits they currently point at.
 * The comparison page of a not-yet-created pull request uses the same function,
 * so the page and the stored pull request can never disagree.
 */
export function pullRequestComparison(repository, baseBranch, compareBranch) {
  const baseCommitId = branchHeadCommitId(repository, baseBranch);
  const compareCommitId = branchHeadCommitId(repository, compareBranch);
  if (!baseCommitId || !compareCommitId) return null;
  const diff = compareRevisions(repository, baseCommitId, compareCommitId);
  const commits = commitsAhead(repository, baseCommitId, compareCommitId);
  return {
    baseCommitId,
    compareCommitId,
    commits: commits.map((commit) => toCommitRecord(repository, commit)),
    commitCount: commits.length,
    sameBranch: baseBranch === compareBranch,
    ...diff,
  };
}

function toCommitReference(repository, commitId) {
  const commit = commitId ? findCommit(repository, commitId) : null;
  if (!commit) return null;
  return {
    id: commit.id,
    shortId: shortCommitId(commit.id),
    message: commit.message ?? "",
    author: commit.authorLogin ?? "",
    createdAt: commit.createdAt ?? "",
  };
}

/** The stored check result of the `test` check for one commit, or null. */
export function findCheckResult(state, pullRequestId, commitId) {
  if (!commitId) return null;
  return (
    (state.pullRequestChecks ?? []).find(
      (check) =>
        check.pullRequestId === pullRequestId &&
        check.commitId === commitId &&
        check.name === REQUIREMENT_CHECK_NAME,
    ) ?? null
  );
}

/**
 * The added or deleted line of one changed file that an inline comment may be
 * anchored to (REQ-6-3-3). The line position is the index of that line inside
 * the file's stored diff, which is stable for the same comparison; a context
 * line carries no change and is therefore not commentable. The added line of the
 * compare revision and the removed line of the base revision each carry their
 * own line number.
 */
export function changedLineAt(diff, path, line) {
  const wantedPath = String(path ?? "");
  const file = (diff?.changedFiles ?? []).find((candidate) => candidate.path === wantedPath);
  if (!file) return null;
  const index = Number(line);
  if (!Number.isInteger(index) || index < 0) return null;
  const entry = file.diff[index];
  if (!entry || (entry.kind !== "add" && entry.kind !== "remove")) return null;
  return {
    file,
    index,
    kind: entry.kind,
    lineNumber: entry.kind === "remove" ? entry.oldLine : entry.newLine,
  };
}

/**
 * The inline review comments of one pull request that the given viewer may read
 * (REQ-6-3-3). A published comment is public; a pending draft is only returned
 * to the reviewer who wrote it, so it is never displayed as published before the
 * review is submitted. A comment whose compare commit is no longer the current
 * one is retained and marked outdated.
 */
export function inlineCommentsOf(state, pullRequest, compareCommitId, viewer) {
  return (state.pullRequestInlineComments ?? [])
    .filter((comment) => comment.pullRequestId === pullRequest.id)
    .filter((comment) => comment.state === "published" || comment.authorId === viewer?.id)
    .map((comment) => ({
      id: comment.id,
      author: accountUsername(state, comment.authorId),
      authorId: comment.authorId,
      path: comment.path,
      line: comment.line,
      kind: comment.kind ?? "add",
      lineNumber: comment.lineNumber ?? null,
      body: comment.body ?? "",
      state: comment.state ?? "published",
      commitId: comment.commitId ?? null,
      commitShortId: comment.commitId ? shortCommitId(comment.commitId) : null,
      outdated: comment.commitId !== compareCommitId,
      createdAt: comment.createdAt ?? "",
    }));
}

/**
 * The accounts that may be asked to review one pull request (REQ-6-4): they hold
 * Write, Maintain or Admin on the repository and are not its author. The list
 * drives the picker of the Reviewers area, while the store re-checks the same
 * rule so a request that bypasses the picker is refused just the same.
 */
export function reviewerCandidateLogins(state, repository, pullRequest) {
  return (state.accounts ?? [])
    .filter((account) => account.id !== pullRequest.authorId)
    .filter((account) =>
      WRITABLE_ROLES.has(effectiveRepositoryRole(state, repository, account)),
    )
    .map((account) => account.username)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * The visible check of one pull request: the `test` result of its current
 * compare commit. A commit without a stored result reads as `pending`, so a new
 * compare commit never inherits the success of the previous one.
 */
export function checkPayload(state, pullRequest, commitId) {
  const record = findCheckResult(state, pullRequest.id, commitId);
  return {
    name: REQUIREMENT_CHECK_NAME,
    commitId: commitId ?? null,
    status: record?.status ?? "pending",
    setBy: record ? accountUsername(state, record.setById) : null,
    setAt: record?.setAt ?? null,
  };
}

/**
 * The latest decision of every reviewer for one commit. A decision belongs to
 * the compare commit it was submitted on, so decisions submitted for an earlier
 * compare commit are stale and never count.
 */
export function latestReviewsForCommit(state, pullRequest, commitId) {
  const latest = new Map();
  for (const review of pullRequest.reviews ?? []) {
    if (review.commitId !== commitId) continue;
    latest.set(review.reviewerId, review);
  }
  return [...latest.values()].sort((left, right) =>
    String(left.createdAt).localeCompare(String(right.createdAt)),
  );
}

/**
 * The review status of one commit: a valid Request changes dominates, otherwise
 * an Approve counts and a pull request nobody decided on still needs a review.
 */
export function reviewStatusOf(state, pullRequest, commitId) {
  const reviews = latestReviewsForCommit(state, pullRequest, commitId);
  if (reviews.some((review) => review.decision === "request_changes")) {
    return "changes_requested";
  }
  if (reviews.some((review) => review.decision === "approve")) return "approved";
  return "review_required";
}

/**
 * Whether the pull request may be merged right now (REQ-6-1, REQ-6-5). A
 * protection rule of the base branch adds its requirements; a valid Request
 * changes always blocks, and the author's own approval never satisfies the
 * approval rule. The reported `conditions` are the individual requirements the
 * merge area displays as satisfied or unsatisfied, while `reasons` explains an
 * unsatisfied one before any click.
 */
export function mergeabilityOf(state, repository, pullRequest) {
  const commitId = currentCompareCommitId(repository, pullRequest);
  const rule = findBranchProtectionRule(state, repository.id, pullRequest.baseBranch);
  const reviews = latestReviewsForCommit(state, pullRequest, commitId);
  const approvals = reviews.filter(
    (review) => review.decision === "approve" && review.reviewerId !== pullRequest.authorId,
  );
  const requestedChanges = reviews.some((review) => review.decision === "request_changes");
  const checkStatus = checkPayload(state, pullRequest, commitId).status;
  const conflicts = mergeConflicts(repository, pullRequest);
  const open = pullRequest.status === "open";
  const approvalsSatisfied = approvals.length >= 1;
  const checkSatisfied = checkStatus === "success";
  const reasons = [];

  if (pullRequest.status === "merged") reasons.push("The pull request is already merged.");
  else if (!open) reasons.push("The pull request is not open.");

  if (rule?.requireApproval === true && !approvalsSatisfied) {
    reasons.push(PULL_REQUEST_MESSAGES.reviewRequired);
  }
  if (rule?.requireStatusCheck === true && !checkSatisfied) {
    reasons.push(`The required check ${REQUIREMENT_CHECK_NAME} must be successful.`);
  }
  if (requestedChanges) {
    reasons.push("A reviewer requested changes.");
  }
  if (conflicts.length > 0) {
    reasons.push(`${PULL_REQUEST_MESSAGES.conflict} Conflicting files: ${conflicts.join(", ")}`);
  }

  // Each enabled protection requirement is listed on its own, so the merge area
  // shows exactly which one still blocks the merge. The labels deliberately do
  // not repeat the exact text of another area of the page (the `test: <status>`
  // line of Checks, the `Changes requested` decision and the `Open`/`Merged`
  // status marker stay unique). An unprotected target adds only the conditions
  // that always apply.
  const conditions = [{ id: "open", label: "Proposal eligible", satisfied: open }];
  if (rule) {
    conditions.push({ id: "approval", label: "1 approval", satisfied: approvalsSatisfied });
    conditions.push({
      id: "check",
      label: "Require status check test",
      satisfied: checkSatisfied,
    });
  }
  conditions.push({ id: "review", label: "No requested changes", satisfied: !requestedChanges });
  conditions.push({ id: "conflicts", label: "No merge conflicts", satisfied: conflicts.length === 0 });

  return {
    mergeable: reasons.length === 0,
    protectedBranch: Boolean(rule),
    requireApproval: rule?.requireApproval === true,
    requireStatusCheck: rule?.requireStatusCheck === true,
    conflicts,
    conditions,
    reasons,
  };
}

function toReviewPayload(state, review) {
  return {
    id: review.id,
    reviewer: accountUsername(state, review.reviewerId),
    reviewerId: review.reviewerId,
    decision: review.decision,
    decisionLabel: REVIEW_DECISION_LABELS[review.decision] ?? review.decision,
    body: review.body ?? "",
    commitId: review.commitId ?? null,
    commitShortId: review.commitId ? shortCommitId(review.commitId) : null,
    createdAt: review.createdAt ?? "",
  };
}

function toActivityPayload(state, activity) {
  return {
    id: activity.id,
    type: activity.type,
    actor: accountUsername(state, activity.actorId),
    createdAt: activity.createdAt ?? "",
    value: activity.value ?? null,
    detail: activity.detail ?? null,
  };
}

/**
 * One row of the Pull requests list (REQ-6-2-1). The review status is the one of
 * the commit the compare branch points at right now, so a row and its detail
 * page never disagree about the same proposal.
 */
export function toPullRequestSummary(state, pullRequest, repository = null) {
  const compareCommitId = repository
    ? currentCompareCommitId(repository, pullRequest)
    : (pullRequest.compareCommitId ?? null);
  return {
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.description ?? "",
    status: pullRequest.status,
    statusLabel: pullRequestStatusLabel(pullRequest.status),
    author: accountUsername(state, pullRequest.authorId),
    baseBranch: pullRequest.baseBranch,
    compareBranch: pullRequest.compareBranch,
    createdAt: pullRequest.createdAt ?? "",
    updatedAt: pullRequest.updatedAt ?? pullRequest.createdAt ?? "",
    currentCompareCommitId: compareCommitId,
    reviewStatus: reviewStatusOf(state, pullRequest, compareCommitId),
  };
}

/**
 * The complete read view of one pull request: the stored record, the comparable
 * commits, the changed files, the discussion, the review summary, the check of
 * the current compare commit, the merge eligibility and the operations the
 * current viewer may perform.
 */
export function toPullRequestDetail(state, repository, viewer, pullRequest) {
  const baseCommitId = currentBaseCommitId(repository, pullRequest);
  const compareCommitId = currentCompareCommitId(repository, pullRequest);
  const diff = compareRevisions(repository, baseCommitId, compareCommitId);
  const commits = commitsAhead(repository, baseCommitId, compareCommitId);
  const role = effectiveRepositoryRole(state, repository, viewer);
  const canWrite = WRITABLE_ROLES.has(role);
  const canManage = MANAGING_ROLES.has(role);
  const isAuthor = Boolean(viewer) && viewer.id === pullRequest.authorId;

  return {
    ...toPullRequestSummary(state, {
      ...pullRequest,
      compareCommitId,
    }),
    reviewStatus: reviewStatusOf(state, pullRequest, compareCommitId),
    baseCommit: toCommitReference(repository, baseCommitId),
    compareCommit: toCommitReference(repository, compareCommitId),
    creationBaseCommitId: pullRequest.baseCommitId ?? null,
    creationCompareCommitId: pullRequest.creationCompareCommitId ?? null,
    commits: commits.map((commit) => toCommitRecord(repository, commit)),
    commitCount: commits.length,
    changedFiles: diff.changedFiles,
    filesChanged: diff.filesChanged,
    additions: diff.additions,
    deletions: diff.deletions,
    comments: (pullRequest.comments ?? []).map((comment) => ({
      id: comment.id,
      author: accountUsername(state, comment.authorId),
      body: comment.body ?? "",
      createdAt: comment.createdAt ?? "",
    })),
    reviews: (pullRequest.reviews ?? []).map((review) => ({
      ...toReviewPayload(state, review),
      stale: review.commitId !== compareCommitId,
    })),
    inlineComments: inlineCommentsOf(state, pullRequest, compareCommitId, viewer),
    requestedReviewers: (pullRequest.reviewerIds ?? []).map((accountId) =>
      accountUsername(state, accountId),
    ),
    reviewerCandidates: reviewerCandidateLogins(state, repository, pullRequest),
    checks: [checkPayload(state, pullRequest, compareCommitId)],
    merge:
      pullRequest.status === "merged"
        ? {
            by: accountUsername(state, pullRequest.mergedById),
            at: pullRequest.mergedAt ?? "",
            commitId: pullRequest.mergeCommitId ?? null,
            commitShortId: pullRequest.mergeCommitId
              ? shortCommitId(pullRequest.mergeCommitId)
              : null,
            method: MERGE_METHOD_LABEL,
          }
        : null,
    activities: (pullRequest.activities ?? []).map((activity) =>
      toActivityPayload(state, activity),
    ),
    mergeability: mergeabilityOf(state, repository, pullRequest),
    permissions: {
      canWrite,
      canManage,
      isAuthor,
      canSetCheckStatus: role === "admin",
      canComment: canWrite,
      // A Draft accepts no review decision until it is ready for review
      // (REQ-6-2-4), while ordinary comments stay available to a writer. Only a
      // non-author writer reviews the proposal (REQ-6-3-4), and an inline code
      // comment needs the same non-author writer on an Open proposal
      // (REQ-6-3-3).
      canReview: canWrite && !isAuthor && pullRequest.status !== "draft",
      canInlineComment: canWrite && !isAuthor && pullRequest.status === "open",
      canRequestReviewers: Boolean(viewer) && (isAuthor || canManage),
      canChangeStatus: Boolean(viewer) && (isAuthor || canManage),
      canMerge: canManage,
    },
  };
}
