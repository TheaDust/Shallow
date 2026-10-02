import { apiRequest } from "./api";
import type {
  DiffFile,
  RepositoryCodeIdentity,
  RepositoryCommitSummary,
  RepositoryRole,
} from "./repository-code-api";

/** The four statuses a pull request may carry. */
export type PullRequestStatus = "draft" | "open" | "closed" | "merged";

/**
 * The review state of one pull request: `review_required` while no current
 * review decision exists, otherwise the decision of the latest reviews.
 */
export type PullRequestReviewStatus = "review_required" | "approved" | "changes_requested";

/** One row of the Pull requests list of the current repository. */
export interface RepositoryPullRequestRow {
  id: string;
  number: number;
  title: string;
  description: string;
  author: string | null;
  status: PullRequestStatus;
  sourceBranch: string;
  targetBranch: string;
  reviewers: string[];
  reviewStatus: PullRequestReviewStatus;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryPullRequestList {
  repository: RepositoryCodeIdentity;
  /** True when the viewer may create pull requests (Write, Maintain, Admin). */
  canCreate: boolean;
  counts: {
    draft: number;
    open: number;
    closed: number;
    merged: number;
    all: number;
  };
  pullRequests: RepositoryPullRequestRow[];
}

/** One side of the branch comparison: its name and the commit it points at. */
export interface PullRequestComparisonSide {
  name: string;
  commit: RepositoryCommitSummary | null;
}

/**
 * The read-only comparison of two branch names, shown before a pull request is
 * created. Nothing in this payload is persisted by reading it.
 */
export interface RepositoryPullComparison {
  repository: RepositoryCodeIdentity;
  branches: string[];
  base: PullRequestComparisonSide;
  compare: PullRequestComparisonSide;
  /** True when both selects name the same branch. */
  sameBranch: boolean;
  /** True when the branches are the same or have no differences at all. */
  noChanges: boolean;
  /** True when a valid comparison can be turned into a pull request. */
  canCreate: boolean;
  commits: RepositoryCommitSummary[];
  commitCount: number;
  files: DiffFile[];
  changedFileCount: number;
  additions: number;
  deletions: number;
}

/** The three states the supported `test` check may carry. */
export type PullRequestCheckStatus = "pending" | "success" | "failure";

/**
 * The `test` status check of the pull request's current compare commit. The
 * result belongs to that commit: without a stored result the area shows the
 * initial `pending` state, and the setter and time describe the stored one.
 */
export interface PullRequestCheck {
  id: string;
  name: string;
  status: PullRequestCheckStatus;
  /** The compare commit this result belongs to. */
  commitId: string | null;
  /** The account that stored the result, or null while it is pending. */
  updatedBy: string | null;
  updatedAt: string | null;
}

/** One submitted review, kept in the timeline even when it turned stale. */
export interface PullRequestReview {
  id: string;
  reviewer: string | null;
  decision: "comment" | "approved" | "changes_requested" | string;
  body: string;
  /** The compare commit the decision was made on. */
  commitId: string | null;
  /** An earlier compare commit never counts for the decision. */
  stale: boolean;
  /** Replaced by a newer decision of the same reviewer on the same commit. */
  superseded: boolean;
  createdAt: string;
}

/** One ordinary or inline comment preserved with its original position. */
export interface PullRequestComment {
  id: string;
  author: string | null;
  body: string;
  path: string | null;
  line: number | null;
  /** The compare commit the inline comment was anchored to. */
  commitId: string | null;
  outdated: boolean;
  /** A `Start a review` draft: visible to its author until the review is sent. */
  pending: boolean;
  createdAt: string;
}

/** One append-only activity record of a pull request. */
export interface PullRequestEvent {
  id: string;
  type: string;
  actor: string | null;
  createdAt: string;
  data: Record<string, unknown>;
}

/** The stored rule of the target branch, or null when it is unprotected. */
export interface PullRequestTargetProtection {
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
}

/** One condition of the merge with its readable state. */
export interface PullRequestMergeCondition {
  id: string;
  label: string;
  satisfied: boolean;
}

/** The stored pull request itself, as its detail page reads it. */
export interface RepositoryPullRequest extends RepositoryPullRequestRow {
  baseCommit: RepositoryCommitSummary | null;
  compareCommit: RepositoryCommitSummary | null;
  closedAt: string | null;
  mergedAt: string | null;
  /** The account that merged the record, or null. */
  mergedBy: string | null;
  /** The merge commit the target branch points at after the merge. */
  mergeCommitId: string | null;
  mergeCommitSha: string | null;
}

export interface RepositoryPullRequestComparison {
  commits: RepositoryCommitSummary[];
  commitCount: number;
  files: DiffFile[];
  changedFileCount: number;
  additions: number;
  deletions: number;
  noChanges: boolean;
}

export interface RepositoryPullRequestDetail {
  repository: RepositoryCodeIdentity;
  pullRequest: RepositoryPullRequest;
  comparison: RepositoryPullRequestComparison;
  checks: PullRequestCheck[];
  reviews: PullRequestReview[];
  comments: PullRequestComment[];
  events: PullRequestEvent[];
  viewerRole: RepositoryRole | null;
  /** Write, Maintain and Admin may create pull requests from a comparison. */
  canWrite: boolean;
  /**
   * The accounts the `Reviewers` picker may offer: every collaborator with
   * Write or higher on the repository, except the author of this pull request.
   */
  reviewerCandidates: string[];
  /** True only while the viewer may request or remove reviewers. */
  canRequestReviewers: boolean;
  /** True only while the viewer may close this unmerged pull request. */
  canClose: boolean;
  /** True only while the viewer may reopen this closed pull request. */
  canReopen: boolean;
  /**
   * The merge state of the target branch: the stored rule (or null when the
   * target is unprotected), every condition with its state and the reason of
   * the first unmet one.
   */
  targetProtection: PullRequestTargetProtection | null;
  mergeConditions: PullRequestMergeCondition[];
  mergeable: boolean;
  mergeBlocker: string | null;
  /** True only while the viewer may merge this Open pull request. */
  canMerge: boolean;
  /** True only while the viewer may turn this Draft into Open. */
  canReadyForReview: boolean;
}

export interface PullRequestWriteBody {
  base: string;
  compare: string;
  title: string;
  description?: string;
  /** `true` creates the pull request in the Draft state. */
  draft?: boolean;
}

/**
 * The anchor of one inline comment: the changed file of the current diff and
 * the position of the changed line inside that file's diff. `pending` keeps
 * the body as a `Start a review` draft instead of publishing it at once.
 */
export interface PullRequestCommentBody {
  body: string;
  path: string;
  line: number;
  pending?: boolean;
}

/** The decision the review form submits, as the radio controls name it. */
export type PullRequestReviewChoice = "comment" | "approve" | "request_changes";

/** The status a repository Admin stores from the `Checks` area. */
export interface PullRequestCheckBody {
  name: string;
  status: PullRequestCheckStatus;
}

export interface PullRequestReviewBody {
  decision: PullRequestReviewChoice;
  /** The optional overall explanation of the decision. */
  body?: string;
}

function pullsPath(owner: string, name: string): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
}

function comparisonQuery(options: { base?: string; compare?: string }): string {
  const params = new URLSearchParams();
  if (options.base) params.set("base", options.base);
  if (options.compare) params.set("compare", options.compare);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The stored pull requests of the current repository. */
export async function fetchRepositoryPullRequests(
  owner: string,
  name: string,
): Promise<RepositoryPullRequestList> {
  return apiRequest<RepositoryPullRequestList>(pullsPath(owner, name));
}

/** The read-only comparison of two branch names (Write or higher only). */
export async function fetchPullRequestComparison(
  owner: string,
  name: string,
  options: { base?: string; compare?: string } = {},
): Promise<RepositoryPullComparison> {
  return apiRequest<RepositoryPullComparison>(
    `${pullsPath(owner, name)}/compare${comparisonQuery(options)}`,
  );
}

/** The detail payload of one repository-scoped pull request number. */
export async function fetchRepositoryPullRequest(
  owner: string,
  name: string,
  number: number | string,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}`,
  );
}

/**
 * Creates one pull request from a valid comparison. The answer is the persisted
 * detail payload of the new record, so the caller can open its page right away.
 */
export async function createRepositoryPullRequest(
  owner: string,
  name: string,
  input: PullRequestWriteBody,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(pullsPath(owner, name), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Turns one Draft into Open and records the activity. */
export async function markPullRequestReadyForReview(
  owner: string,
  name: string,
  number: number | string,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/ready-for-review`,
    { method: "POST" },
  );
}

/** Merges one Open pull request; Merged is terminal. */
export async function mergeRepositoryPullRequest(
  owner: string,
  name: string,
  number: number | string,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/merge`,
    { method: "POST" },
  );
}

/**
 * Stores one reviewer request of the pull request. The answer is the persisted
 * detail payload, so the reviewer area always shows the stored relationship.
 */
export async function requestPullRequestReviewer(
  owner: string,
  name: string,
  number: number | string,
  username: string,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/reviewers`,
    { method: "POST", body: JSON.stringify({ username }) },
  );
}

/** Deletes one reviewer request without a second confirmation. */
export async function removePullRequestReviewer(
  owner: string,
  name: string,
  number: number | string,
  username: string,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/reviewers/${encodeURIComponent(
      username,
    )}`,
    { method: "DELETE" },
  );
}

/** Closes one unmerged pull request without merging it. */
export async function closeRepositoryPullRequest(
  owner: string,
  name: string,
  number: number | string,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/close`,
    { method: "POST" },
  );
}

/** Reopens one Closed pull request as Open. */
export async function reopenRepositoryPullRequest(
  owner: string,
  name: string,
  number: number | string,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/reopen`,
    { method: "POST" },
  );
}

/**
 * Stores one inline comment on a changed line of the current diff. The answer
 * is the persisted detail payload, so the caller shows the stored record and
 * never a body the server refused.
 */
export async function addPullRequestComment(
  owner: string,
  name: string,
  number: number | string,
  input: PullRequestCommentBody,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/comments`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Submits one review decision of the current viewer. */
export async function submitPullRequestReview(
  owner: string,
  name: string,
  number: number | string,
  input: PullRequestReviewBody,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/reviews`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * Stores the `test` status of the current compare commit. Only a repository
 * Admin may do this; the answer is the persisted detail payload, so the area
 * always shows the stored result with its setter and time.
 */
export async function updatePullRequestCheckStatus(
  owner: string,
  name: string,
  number: number | string,
  input: PullRequestCheckBody,
): Promise<RepositoryPullRequestDetail> {
  return apiRequest<RepositoryPullRequestDetail>(
    `${pullsPath(owner, name)}/${encodeURIComponent(String(number))}/checks`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

function repositoryPrefix(owner: string, name: string): string {
  return `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/**
 * Hash address of the comparison page that precedes creation. The entry stays
 * usable without a selection: the page opens on the repository default branch.
 */
export function newPullRequestHref(
  owner: string,
  name: string,
  options: { base?: string; compare?: string } = {},
): string {
  return `${repositoryPrefix(owner, name)}/pulls/new${comparisonQuery(options)}`;
}

/** The second direct entry of the same read-only comparison page. */
export function pullRequestCompareHref(
  owner: string,
  name: string,
  options: { base?: string; compare?: string } = {},
): string {
  return `${repositoryPrefix(owner, name)}/pulls/compare${comparisonQuery(options)}`;
}

/** Hash address of one pull request detail page. */
export function repositoryPullRequestHref(
  owner: string,
  name: string,
  number: number | string,
): string {
  return `${repositoryPrefix(owner, name)}/pulls/${encodeURIComponent(String(number))}`;
}

export type PullRequestSection = "conversation" | "commits" | "files" | "checks";
/** Hash address of one detail section; the conversation is the entry itself. */
export function pullRequestSectionHref(
  owner: string,
  name: string,
  number: number | string,
  section: PullRequestSection,
): string {
  const base = repositoryPullRequestHref(owner, name, number);
  return section === "conversation" ? base : `${base}/${section}`;
}

export interface PullRequestFilterAddress {
  /** The status filter: one of the four statuses, or empty for every row. */
  state?: string;
  /** The author filter: the stored username, matched as typed. */
  author?: string;
  /** The review-status filter. */
  review?: string;
}

/**
 * Hash address of the Pull requests list with its filter context, so a reload
 * or a reopened address restores the same rows without touching a record.
 */
export function pullRequestsListHref(
  owner: string,
  name: string,
  filter: PullRequestFilterAddress = {},
): string {
  const params = new URLSearchParams();
  const state = filter.state ?? "";
  if (state === "draft" || state === "open" || state === "closed" || state === "merged") {
    params.set("state", state);
  }
  const author = filter.author?.trim() ?? "";
  if (author.length > 0) params.set("author", author);
  const review = filter.review ?? "";
  if (review === "review_required" || review === "approved" || review === "changes_requested") {
    params.set("review", review);
  }
  const query = params.toString();
  return `${repositoryPrefix(owner, name)}/pulls${query ? `?${query}` : ""}`;
}
