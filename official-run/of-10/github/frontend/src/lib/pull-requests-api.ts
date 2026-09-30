import { ApiError, apiRequest } from "./api";
import type {
  ChangedFile,
  RepositoryCommit,
  RepositoryContext,
  RepositoryRole,
} from "./repositories-api";

/**
 * Pull requests of one repository (REQ-6). The list payload carries the
 * repository context and one row per stored record; the detail payload adds the
 * comparable commits, the changed files, the discussion, the review summary, the
 * check of the current compare commit, the merge eligibility and the operations
 * the current viewer may perform.
 */

export type PullRequestStatus = "draft" | "open" | "closed" | "merged";

/** The four statuses a pull request may be persisted in, in display order. */
export const PULL_REQUEST_STATUSES: readonly PullRequestStatus[] = [
  "draft",
  "open",
  "closed",
  "merged",
];

export const PULL_REQUEST_STATUS_LABELS: Record<PullRequestStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  merged: "Merged",
};

export function pullRequestStatusLabel(status: PullRequestStatus | string): string {
  return PULL_REQUEST_STATUS_LABELS[status as PullRequestStatus] ?? String(status);
}

export type CheckStatus = "pending" | "success" | "failure";

export const CHECK_STATUSES: readonly CheckStatus[] = ["pending", "success", "failure"];

export type ReviewDecision = "comment" | "approve" | "request_changes";

export type ReviewStatus = "approved" | "changes_requested" | "review_required";

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
};

/** The one check this product evaluates for a merge (REQ-6-1). */
export const REQUIREMENT_CHECK_NAME = "test";

export interface PullRequestSummary {
  id: string;
  number: number;
  title: string;
  description: string;
  status: PullRequestStatus;
  statusLabel: string;
  author: string;
  baseBranch: string;
  compareBranch: string;
  createdAt: string;
  updatedAt: string;
  currentCompareCommitId: string | null;
  reviewStatus: ReviewStatus;
}

export interface CommitReference {
  id: string;
  shortId: string;
  message: string;
  author: string;
  createdAt: string;
}

export interface PullRequestComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

/**
 * One inline review comment of a changed code line (REQ-6-3-3): it names the
 * file of the current comparison, the position of the commented line inside that
 * file's diff and the compare commit it was written on. `published` is visible to
 * every reader of the pull request, `pending` is the private draft of its own
 * author until the review is submitted.
 */
export interface PullRequestInlineComment {
  id: string;
  author: string;
  authorId: string;
  path: string;
  /** The position of the commented line inside that file's diff. */
  line: number;
  kind: "add" | "remove" | "context";
  lineNumber: number | null;
  body: string;
  state: "published" | "pending";
  commitId: string | null;
  commitShortId: string | null;
  /** The compare commit moved on, so the comment no longer points at it. */
  outdated: boolean;
  createdAt: string;
}

export interface PullRequestReview {
  id: string;
  reviewer: string;
  reviewerId: string;
  decision: ReviewDecision;
  decisionLabel: string;
  body: string;
  commitId: string | null;
  commitShortId: string | null;
  createdAt: string;
  stale: boolean;
}

export interface PullRequestActivity {
  id: string;
  type: string;
  actor: string;
  createdAt: string;
  value: string | null;
  detail: string | null;
}

export interface PullRequestCheck {
  name: string;
  commitId: string | null;
  status: CheckStatus;
  setBy: string | null;
  setAt: string | null;
}

export interface PullRequestMergeability {
  mergeable: boolean;
  protectedBranch: boolean;
  requireApproval: boolean;
  requireStatusCheck: boolean;
  /** The changed paths both branches touched with different content (REQ-6-5). */
  conflicts: string[];
  /** Every applicable merge condition with its current state (REQ-6-5). */
  conditions: PullRequestMergeCondition[];
  reasons: string[];
}

/** One merge condition of a pull request, satisfied or still blocking (REQ-6-5). */
export interface PullRequestMergeCondition {
  id: string;
  label: string;
  satisfied: boolean;
}

/** The stored result of a completed merge: merger, time and merge commit. */
export interface PullRequestMergeInfo {
  by: string;
  at: string;
  commitId: string | null;
  commitShortId: string | null;
  /** The only supported merge method: `Create a merge commit`. */
  method: string;
}

export interface PullRequestPermissions {
  canWrite: boolean;
  canManage: boolean;
  isAuthor: boolean;
  canSetCheckStatus: boolean;
  canComment: boolean;
  canReview: boolean;
  /** A non-author writer may comment on the changed code lines (REQ-6-3-3). */
  canInlineComment: boolean;
  canRequestReviewers: boolean;
  canChangeStatus: boolean;
  canMerge: boolean;
}

export interface PullRequestDetail extends PullRequestSummary {
  baseCommit: CommitReference | null;
  compareCommit: CommitReference | null;
  creationBaseCommitId: string | null;
  creationCompareCommitId: string | null;
  commits: RepositoryCommit[];
  commitCount: number;
  changedFiles: ChangedFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
  comments: PullRequestComment[];
  reviews: PullRequestReview[];
  inlineComments: PullRequestInlineComment[];
  requestedReviewers: string[];
  /** Accounts that may be asked to review this pull request (REQ-6-4). */
  reviewerCandidates: string[];
  checks: PullRequestCheck[];
  activities: PullRequestActivity[];
  mergeability: PullRequestMergeability;
  /** The stored merge result, or null while the pull request is unmerged. */
  merge: PullRequestMergeInfo | null;
  permissions: PullRequestPermissions;
}

export interface PullRequestsPayload {
  repository: RepositoryContext;
  pullRequests: PullRequestSummary[];
}

export interface PullRequestPayload {
  repository: RepositoryContext;
  pullRequest: PullRequestDetail;
}

export interface PullRequestComparisonPayload {
  repository: RepositoryContext;
  base: { name: string; headCommitId: string | null };
  compare: { name: string; headCommitId: string | null };
  sameBranch: boolean;
  commitCount: number;
  commits: RepositoryCommit[];
  changedFiles: ChangedFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
  /** Whether the current viewer may open a pull request from this comparison. */
  canCreate: boolean;
}

/** Write, Maintain, Admin and organization Owner may create pull requests. */
export function canCreatePullRequests(role: RepositoryRole | null | undefined): boolean {
  return role === "write" || role === "maintain" || role === "admin";
}

/** Maintain, Admin and organization Owner may manage and merge pull requests. */
export function canManagePullRequests(role: RepositoryRole | null | undefined): boolean {
  return role === "maintain" || role === "admin";
}

/** Only a repository Admin may update the check status of a pull request. */
export function canAdministerPullRequests(role: RepositoryRole | null | undefined): boolean {
  return role === "admin";
}

function repositoryPath(owner: string, name: string, suffix = ""): string {
  const base = `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
  return suffix ? `${base}/${suffix}` : base;
}

export function fetchRepositoryPullRequests(
  owner: string,
  name: string,
): Promise<PullRequestsPayload> {
  return apiRequest<PullRequestsPayload>(repositoryPath(owner, name));
}

export function fetchRepositoryPullRequest(
  owner: string,
  name: string,
  number: number,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name, String(number)));
}

/** The read-only comparison of two branches, before any pull request exists. */
export function comparePullRequestBranches(
  owner: string,
  name: string,
  base: string,
  compare: string,
): Promise<PullRequestComparisonPayload> {
  const params = new URLSearchParams({ base, compare });
  return apiRequest<PullRequestComparisonPayload>(
    `${repositoryPath(owner, name, "compare")}?${params.toString()}`,
  );
}

export interface CreatePullRequestInput {
  base: string;
  compare: string;
  title?: string;
  description?: string;
  draft?: boolean;
}

/** Creates the pull request and returns the persisted record of its detail page. */
export function createPullRequest(
  owner: string,
  name: string,
  input: CreatePullRequestInput,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** One ordinary conversation comment of the signed-in writer (REQ-6). */
export function addPullRequestComment(
  owner: string,
  name: string,
  number: number,
  body: string,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name, `${number}/comments`), {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/**
 * One review decision (`Comment`, `Approve` or `Request changes`) of the signed-in
 * writer. The decision is stored with the compare commit it was submitted on.
 */
export function submitPullRequestReview(
  owner: string,
  name: string,
  number: number,
  decision: ReviewDecision,
  body: string,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name, `${number}/reviews`), {
    method: "POST",
    body: JSON.stringify({ decision, body }),
  });
}

/**
 * One inline review comment on a changed line (REQ-6-3-3). `pending` keeps the
 * comment as the reviewer's own review draft until the review is submitted.
 */
export interface AddInlineCommentInput {
  path: string;
  /** The position of the commented line inside that file's diff. */
  line: number;
  body: string;
  pending?: boolean;
}

export function addPullRequestInlineComment(
  owner: string,
  name: string,
  number: number,
  input: AddInlineCommentInput,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name, `${number}/inline-comments`), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Asks one account to review, for the author or a maintainer (REQ-6). */
export function requestPullRequestReviewer(
  owner: string,
  name: string,
  number: number,
  username: string,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name, `${number}/reviewers`), {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

/** Withdraws one reviewer request; already submitted reviews stay (REQ-6-4). */
export function removePullRequestReviewer(
  owner: string,
  name: string,
  number: number,
  username: string,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(
    repositoryPath(owner, name, `${number}/reviewers/${encodeURIComponent(username)}`),
    { method: "DELETE" },
  );
}

/** Marks a draft ready, closes, reopens or merges the stored pull request. */
export function updatePullRequestStatus(
  owner: string,
  name: string,
  number: number,
  status: PullRequestStatus,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name, `${number}/status`), {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

/**
 * Merges the stored pull request (REQ-6-5). `Create a merge commit` is the only
 * method this product supports, so the request names it explicitly.
 */
export const MERGE_METHOD = "merge";
export const MERGE_METHOD_LABEL = "Create a merge commit";

export function mergePullRequest(
  owner: string,
  name: string,
  number: number,
  method: string = MERGE_METHOD,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name, `${number}/merge`), {
    method: "POST",
    body: JSON.stringify({ method }),
  });
}

/** Stores the `test` result of the pull request's current compare commit. */
export function savePullRequestCheck(
  owner: string,
  name: string,
  number: number,
  status: CheckStatus,
): Promise<PullRequestPayload> {
  return apiRequest<PullRequestPayload>(repositoryPath(owner, name, `${number}/checks`), {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

/** The repository context carried by the answer for a number that does not exist. */
export function missingPullRequestContext(error: unknown): RepositoryContext | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { repository?: RepositoryContext } | null;
  return body?.repository ?? null;
}
