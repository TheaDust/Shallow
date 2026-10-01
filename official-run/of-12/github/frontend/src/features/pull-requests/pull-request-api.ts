import { apiRequest, mutateJson, mutateJsonSync, type MutationOutcome } from "../../lib/api";
import type {
  RepositoryCommit,
  RepositoryDiffLine,
  RepositoryDiffSummary,
  RepositoryFileDiff,
  RepositoryRole,
  RepositorySummary,
} from "../repositories/repository-api";

/**
 * Typed client for the pull-request surface (REQ-6, REQ-6-1).
 *
 * A pull request is a persistent proposal to merge the changes of its compare
 * branch into its base branch: the list rows carry the repository-scoped
 * number, title, author, source/target branches and the persisted status, and
 * the detail read adds the conversation, the commits and files of the compare
 * branch relative to the base, the checks of the current compare commit and the
 * merge state the branch protection rule produces.
 */

export type PullRequestStatus = "draft" | "open" | "closed" | "merged";
export type PullRequestCheckStatus = "pending" | "success" | "failure";
export type PullRequestDecision = "comment" | "approve" | "request_changes";

/** The side of the diff an inline review comment anchors to (REQ-6-3-3). */
export type PullRequestDiffSide = "added" | "removed";

/**
 * The decision text the review summary spells (REQ-6-3-4): the reviewer sees
 * `Approved`, `Changes requested` or `Commented` next to the reviewer name.
 */
export const PULL_REQUEST_DECISION_LABELS: Record<PullRequestDecision, string> = {
  comment: "Commented",
  approve: "Approved",
  request_changes: "Changes requested",
};

/**
 * The derived review status of a pull request (REQ-6-2-1): the decision of the
 * current compare commit, without the author's own decisions.
 */
export type PullRequestReviewStatus = "review_required" | "approved" | "changes_requested";

/** The status text the pages spell for a persisted status. */
export const PULL_REQUEST_STATUS_LABELS: Record<PullRequestStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  merged: "Merged",
};

/** The status text of the review-status filter of the list page (REQ-6-2-1). */
export const PULL_REQUEST_REVIEW_STATUS_LABELS: Record<PullRequestReviewStatus, string> = {
  review_required: "Review required",
  approved: "Approved",
  changes_requested: "Changes requested",
};

/** One row of the Pull requests page (REQ-6). */
export interface PullRequestSummary {
  id: string;
  number: number;
  title: string;
  description: string;
  author: string;
  status: PullRequestStatus;
  baseBranch: string;
  compareBranch: string;
  /** The decision of the current compare commit (REQ-6-2-1). */
  reviewStatus: PullRequestReviewStatus;
  createdAt: string | null;
  updatedAt: string | null;
}

/** The `test` check of the pull request's current compare commit (REQ-6-1). */
export interface PullRequestCheck {
  name: string;
  status: PullRequestCheckStatus;
  commitId: string;
  setBy: string | null;
  setAt: string | null;
}

export interface PullRequestReviewer {
  username: string;
  requestedBy?: string | null;
  requestedAt?: string | null;
}

/**
 * One account the Reviewers picker may offer (REQ-6-4): an account with Write,
 * Maintain or Admin on the repository that is not the author of the proposal.
 */
export interface PullRequestReviewerCandidate {
  username: string;
  role: RepositoryRole;
}

/** One review decision; a decision of another commit is stale (REQ-6-1). */
export interface PullRequestReview {
  id: string;
  reviewer: string;
  decision: PullRequestDecision;
  /** The optional overall comment of the decision (REQ-6-3-4). */
  summary?: string;
  commitId: string;
  createdAt: string | null;
  stale: boolean;
}

/**
 * One line of a pull request diff (REQ-6-3-2, REQ-6-3-3): it carries the line
 * number of each side and the `side` an inline comment anchors to, and a
 * context line is part of both sides.
 */
export interface PullRequestDiffLine extends RepositoryDiffLine {
  index: number;
  oldNumber: number | null;
  newNumber: number | null;
  lineNumber: number;
  side: "added" | "removed" | "context";
}

/** A changed file of a pull request with its numbered lines. */
export interface PullRequestFileDiff extends RepositoryFileDiff {
  lines: PullRequestDiffLine[];
}

/**
 * One inline review comment anchored to a changed line (REQ-6-3-3). `pending`
 * marks a draft kept by `Start a review` that is not public yet; `outdated`
 * marks a published comment of an older compare commit.
 */
export interface PullRequestReviewComment {
  id: string;
  filePath: string;
  line: number;
  side: PullRequestDiffSide;
  commitId: string;
  author: string;
  authorId: string | null;
  body: string;
  pending: boolean;
  createdAt: string | null;
  outdated: boolean;
}

export interface PullRequestComment {
  id: string;
  author: string;
  body: string;
  createdAt: string | null;
}

export interface PullRequestActivity {
  id: string;
  type: string;
  actor: string;
  text: string;
  createdAt: string | null;
}

/**
 * One condition the merge checks, spelled satisfied or unsatisfied in the merge
 * confirmation area (REQ-6-5).
 */
export interface PullRequestMergeCondition {
  code: string;
  label: string;
  satisfied: boolean;
}

/** Why a pull request may or may not be merged right now (REQ-6-1, REQ-6-5). */
export interface PullRequestMergeState {
  mergeable: boolean;
  status: PullRequestStatus;
  blockers: Array<{ code: string; message: string }>;
  conditions: PullRequestMergeCondition[];
  rules: { requireApproval: boolean; requireStatusCheck: boolean; pattern: string | null };
  approvals: number;
  changeRequests: number;
}

/** What the current caller may do with this pull request (REQ-6). */
export interface PullRequestPermissions {
  canUpdateChecks: boolean;
  canMerge: boolean;
  canReview: boolean;
  canComment: boolean;
  canChangeStatus: boolean;
  canRequestReviewers: boolean;
  /** The author or a maintainer may close an unmerged Open or Draft PR (REQ-6-6). */
  canClose: boolean;
  /** The author or a maintainer may reopen a Closed PR (REQ-6-6). */
  canReopen: boolean;
  /** Write, Maintain, Admin or organization Owner may open a pull request. */
  canCreate: boolean;
  /** The author or a maintainer may move a draft to Open (REQ-6-2-4). */
  canMarkReady: boolean;
  /** A non-author reviewer may comment on a changed line (REQ-6-3-3). */
  canCommentOnLines: boolean;
  /** A non-author reviewer may submit a decision (REQ-6-3-4). */
  canSubmitReview: boolean;
}

export interface PullRequestDetail extends PullRequestSummary {
  baseCommitId: string | null;
  compareCommitId: string | null;
  currentCompareCommitId: string | null;
  currentCompareCommit: RepositoryCommit | null;
  reviewers: PullRequestReviewer[];
  /** The accounts the Reviewers picker may offer (REQ-6-4). */
  reviewerCandidates: PullRequestReviewerCandidate[];
  reviews: PullRequestReview[];
  comments: PullRequestComment[];
  /** The inline review comments of the compare commit (REQ-6-3-3). */
  reviewComments: PullRequestReviewComment[];
  timeline: PullRequestActivity[];
  checks: PullRequestCheck[];
  check: PullRequestCheck;
  /** The merger, time and resulting commit of a Merged pull request (REQ-6-5). */
  mergedBy: string | null;
  mergedAt: string | null;
  mergeCommitId: string | null;
  closedAt: string | null;
  commits: RepositoryCommit[];
  files: PullRequestFileDiff[];
  summary: RepositoryDiffSummary;
  merge: PullRequestMergeState;
  permissions: PullRequestPermissions;
}

export interface PullRequestListPayload {
  repository: RepositorySummary;
  viewerRole: RepositoryRole | null;
  /** True when the caller may open a new pull request (REQ-6-2-2). */
  canCreatePullRequest: boolean;
  pullRequests: PullRequestSummary[];
}

export interface PullRequestPayload {
  repository: RepositorySummary;
  viewerRole: RepositoryRole | null;
  pullRequest: PullRequestDetail;
}

const EMPTY_CHECK: PullRequestCheck = {
  name: "test",
  status: "pending",
  commitId: "",
  setBy: null,
  setAt: null,
};

function normalizeStatus(value: unknown): PullRequestStatus {
  const status = String(value ?? "").toLowerCase();
  return status === "draft" || status === "closed" || status === "merged" ? status : "open";
}

function normalizeReviewStatus(value: unknown): PullRequestReviewStatus {
  const status = String(value ?? "").toLowerCase();
  if (status === "approved" || status === "changes_requested") return status;
  return "review_required";
}

function normalizeDecision(value: unknown): PullRequestDecision {
  const decision = String(value ?? "").toLowerCase();
  if (decision === "approve" || decision === "request_changes") return decision;
  return "comment";
}

function normalizeDiffLine(line: RepositoryDiffLine & Partial<PullRequestDiffLine>): PullRequestDiffLine {
  const type = line.type === "added" || line.type === "removed" ? line.type : "context";
  const lineNumber = Number(line.lineNumber ?? line.newNumber ?? line.oldNumber ?? 0);
  return {
    type,
    text: line.text ?? "",
    index: Number(line.index ?? 0),
    oldNumber: line.oldNumber ?? null,
    newNumber: line.newNumber ?? null,
    lineNumber,
    side: type === "context" ? "context" : type,
  };
}

function normalizeReviewComment(comment: Partial<PullRequestReviewComment>): PullRequestReviewComment {
  return {
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
    outdated: comment.outdated === true,
  };
}

function normalizeSummary(value: Partial<PullRequestSummary>): PullRequestSummary {
  return {
    id: value.id ?? "",
    number: Number(value.number ?? 0),
    title: value.title ?? "",
    description: value.description ?? "",
    author: value.author ?? "",
    status: normalizeStatus(value.status),
    baseBranch: value.baseBranch ?? "",
    compareBranch: value.compareBranch ?? "",
    reviewStatus: normalizeReviewStatus(value.reviewStatus),
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function normalizeCheck(value: Partial<PullRequestCheck> | undefined): PullRequestCheck {
  const status = String(value?.status ?? "").toLowerCase();
  return {
    name: value?.name ?? EMPTY_CHECK.name,
    status: status === "success" || status === "failure" ? status : "pending",
    commitId: value?.commitId ?? "",
    setBy: value?.setBy ?? null,
    setAt: value?.setAt ?? null,
  };
}

function normalizeDetail(value: Partial<PullRequestDetail>): PullRequestDetail {
  return {
    ...normalizeSummary(value),
    baseCommitId: value.baseCommitId ?? null,
    compareCommitId: value.compareCommitId ?? null,
    currentCompareCommitId: value.currentCompareCommitId ?? null,
    currentCompareCommit: value.currentCompareCommit ?? null,
    reviewers: value.reviewers ?? [],
    reviewerCandidates: (value.reviewerCandidates ?? []).map((candidate) => ({
      username: candidate.username ?? "",
      role: (candidate.role ?? "Read") as RepositoryRole,
    })),
    reviews: (value.reviews ?? []).map((review) => ({
      ...review,
      decision: normalizeDecision(review.decision),
      summary: review.summary ?? "",
      stale: review.stale === true,
    })),
    comments: value.comments ?? [],
    reviewComments: (value.reviewComments ?? []).map(normalizeReviewComment),
    timeline: value.timeline ?? [],
    checks: value.checks ?? [],
    check: normalizeCheck(value.check),
    mergedBy: value.mergedBy ?? null,
    mergedAt: value.mergedAt ?? null,
    mergeCommitId: value.mergeCommitId ?? null,
    closedAt: value.closedAt ?? null,
    commits: value.commits ?? [],
    files: (value.files ?? []).map((file) => ({ ...file, lines: (file.lines ?? []).map(normalizeDiffLine) })),
    summary: value.summary ?? { filesChanged: 0, additions: 0, deletions: 0 },
    merge: value.merge
      ? { ...value.merge, conditions: value.merge.conditions ?? [] }
      : {
          mergeable: false,
          status: normalizeStatus(value.status),
          blockers: [],
          conditions: [],
          rules: { requireApproval: false, requireStatusCheck: false, pattern: null },
          approvals: 0,
          changeRequests: 0,
        },
    permissions: value.permissions ?? {
      canUpdateChecks: false,
      canMerge: false,
      canReview: false,
      canComment: false,
      canChangeStatus: false,
      canRequestReviewers: false,
      canClose: false,
      canReopen: false,
      canCreate: false,
      canMarkReady: false,
      canCommentOnLines: false,
      canSubmitReview: false,
    },
  };
}

function repositoryPath(owner: string, name: string): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** The refreshed detail answer every pull-request write returns. */
function normalizePayload(payload: Partial<PullRequestPayload>, owner: string, name: string): PullRequestPayload {
  return {
    repository: payload.repository
      ?? ({ name, owner, fullName: `${owner}/${name}` } as RepositorySummary),
    viewerRole: payload.viewerRole ?? null,
    pullRequest: normalizeDetail(payload.pullRequest ?? {}),
  };
}

/** The pull requests of one repository (REQ-6). */
export async function fetchRepositoryPullRequests(owner: string, name: string): Promise<PullRequestListPayload> {
  const payload = await apiRequest<Partial<PullRequestListPayload>>(`${repositoryPath(owner, name)}/pulls`);
  return {
    repository: payload.repository ?? { name, owner, fullName: `${owner}/${name}` } as RepositorySummary,
    viewerRole: payload.viewerRole ?? null,
    canCreatePullRequest: payload.canCreatePullRequest === true,
    pullRequests: (payload.pullRequests ?? []).map(normalizeSummary),
  };
}

/** One pull request with its conversation, commits, files, checks and merge state. */
export async function fetchRepositoryPullRequest(
  owner: string,
  name: string,
  number: string,
): Promise<PullRequestPayload> {
  const payload = await apiRequest<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(number)}`,
  );
  return {
    repository: payload.repository ?? { name, owner, fullName: `${owner}/${name}` } as RepositorySummary,
    viewerRole: payload.viewerRole ?? null,
    pullRequest: normalizeDetail(payload.pullRequest ?? {}),
  };
}

/**
 * Stores the status of the `test` check of the pull request's current compare
 * commit (REQ-6-1). Only a repository Admin may write it; the response is the
 * refreshed detail, so the setter and the time come from the stored record.
 */
export async function savePullRequestCheck(
  owner: string,
  name: string,
  number: number | string,
  input: { name?: string; status: PullRequestCheckStatus },
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/checks`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/**
 * Creates a pull request from a valid comparison (REQ-6-2-3, REQ-6-2-4). The
 * request carries the chosen branches, the title and the description; the
 * comparison and the record are completed by the server, which answers the
 * refreshed detail so the page can open the stored pull request.
 */
export async function createRepositoryPullRequest(
  owner: string,
  name: string,
  input: { title: string; description?: string; base: string; compare: string; draft?: boolean },
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(`${repositoryPath(owner, name)}/pulls`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/**
 * Blocking counterpart of `createRepositoryPullRequest` (REQ-6-2-3).
 *
 * The comparison page is replaced by the detail address of the new pull request
 * as soon as the creation is accepted. Issuing the request synchronously means
 * the stored record and its number exist before the destination address becomes
 * active, so a reload or a reopen in the very next moment already reads the new
 * pull request instead of the comparison page.
 */
export function createRepositoryPullRequestSync(
  owner: string,
  name: string,
  input: { title: string; description?: string; base: string; compare: string; draft?: boolean },
): MutationOutcome<PullRequestPayload> {
  const result = mutateJsonSync<Partial<PullRequestPayload>>(`${repositoryPath(owner, name)}/pulls`, input);
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/**
 * Moves a draft pull request to Open (REQ-6-2-4). Only the author or a
 * maintainer may do it; the response is the refreshed detail of the same pull
 * request.
 */
export async function markPullRequestReadyForReview(
  owner: string,
  name: string,
  number: number | string,
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/ready`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/**
 * Publishes or keeps one inline review comment (REQ-6-3-3). `pending` is the
 * draft of `Start a review` that stays private to its author until the review is
 * submitted; the answer carries the refreshed detail, so the diff view and
 * Conversation read the stored record instead of an optimistic copy.
 */
export async function addPullRequestReviewComment(
  owner: string,
  name: string,
  number: number | string,
  input: { filePath: string; line: number; side: PullRequestDiffSide; body: string; pending: boolean },
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/comments`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/**
 * Submits one review decision of the current compare commit (REQ-6-3-4). The
 * refreshed detail carries the new decision, so the review summary of
 * Conversation displays the stored reviewer, status and summary.
 */
export async function submitPullRequestReview(
  owner: string,
  name: string,
  number: number | string,
  input: { decision: PullRequestDecision; summary: string },
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/reviews`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/**
 * Creates the pending-review relationship with one eligible account (REQ-6-4).
 * The author or a maintainer of an Open or Draft pull request stores it; the
 * refreshed detail carries the stored request, so the Reviewers area reads the
 * server record instead of an optimistic copy.
 */
export async function requestPullRequestReviewer(
  owner: string,
  name: string,
  number: number | string,
  username: string,
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/reviewers`,
    { method: "POST", body: JSON.stringify({ username }) },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/**
 * Deletes the pending-review relationship of one account (REQ-6-4) without
 * touching the reviews, comments or activities that account already wrote.
 */
export async function removePullRequestReviewer(
  owner: string,
  name: string,
  number: number | string,
  username: string,
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/reviewers/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/**
 * Closes an unmerged pull request without merging it (REQ-6-6): only the status,
 * the operator and the time change, and no branch moves.
 */
export async function closePullRequest(
  owner: string,
  name: string,
  number: number | string,
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/close`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/** Reopens a Closed pull request as Open (REQ-6-6). */
export async function reopenPullRequest(
  owner: string,
  name: string,
  number: number | string,
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/reopen`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}

/** Merges the pull request, applying the rule of the protected base branch. */
export async function mergeRepositoryPullRequest(
  owner: string,
  name: string,
  number: number | string,
): Promise<MutationOutcome<PullRequestPayload>> {
  const result = await mutateJson<Partial<PullRequestPayload>>(
    `${repositoryPath(owner, name)}/pulls/${encodeURIComponent(String(number))}/merge`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizePayload(result.data, owner, name) };
}
