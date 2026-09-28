import { ApiError, apiRequest } from "./api";
import type { CommitSummary, DiffFile, RepoOwnerType } from "./repo-api";

export type PullStatus = "open" | "draft" | "closed" | "merged";
export type CheckStatus = "pending" | "success" | "failure";
export type ReviewDecision = "comment" | "approve" | "request_changes";

export interface PullSummary {
  number: number;
  title: string;
  status: PullStatus;
  baseBranch: string;
  compareBranch: string;
  author: { username: string };
  reviewed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CheckRunPayload {
  name: string;
  status: CheckStatus;
  setter: { username: string } | null;
  setAt: string | null;
}

export interface PullReviewPayload {
  id: string;
  author: { username: string };
  decision: ReviewDecision;
  commitId: string | null;
  explanation: string;
  createdAt: string;
  stale: boolean;
}

/** One reviewer's effective decision on the current compare commit. */
export interface ReviewSummaryPayload {
  id: string;
  author: { username: string };
  decision: ReviewDecision;
  explanation: string;
  createdAt: string;
}

export interface InlineCommentPayload {
  id: string;
  author: { username: string };
  path: string;
  line: number;
  commitId: string | null;
  body: string;
  published: boolean;
  outdated: boolean;
  createdAt: string;
}

export interface ReviewerRequestPayload {
  id: string;
  username: string;
  requestedBy: { username: string };
  createdAt: string;
}

export interface ReviewerCandidatePayload {
  username: string;
}

export interface PullActivityPayload {
  id: string;
  type: string;
  actor: { username: string };
  createdAt: string;
}

export interface PullCommentPayload {
  id: string;
  author: { username: string };
  body: string;
  createdAt: string;
}

export interface MergeEligibility {
  mergeable: boolean;
  reasons: string[];
}

export interface PullMergeOutcome {
  mergedBy: { username: string } | null;
  mergedAt: string | null;
  mergeCommitId: string | null;
}

export interface PullDetail extends PullSummary {
  description: string;
  baseCommitId: string | null;
  compareCommitId: string | null;
  mergedAt: string | null;
  mergedBy: { username: string } | null;
  mergeCommitId: string | null;
  check: CheckRunPayload;
  reviews: PullReviewPayload[];
  inlineComments: InlineCommentPayload[];
  reviewers: ReviewerRequestPayload[];
  reviewSummary: ReviewSummaryPayload[];
  reviewerCandidates: ReviewerCandidatePayload[];
  comments: PullCommentPayload[];
  activities: PullActivityPayload[];
  commits: CommitSummary[];
  files: DiffFile[];
  merge: MergeEligibility;
  currentRole: string | null;
  canClose: boolean;
  canReview: boolean;
  canMerge: boolean;
  canRequestReviewers: boolean;
}

export interface BranchComparison {
  baseBranch: string;
  compareBranch: string;
  baseCommitId: string | null;
  compareCommitId: string | null;
  sameBranch: boolean;
  commitCount: number;
  commits: CommitSummary[];
  files: DiffFile[];
  noDifference: boolean;
}

export interface ProtectionRule {
  branch: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
}

export interface PullFieldErrors {
  title?: string;
  description?: string;
  base?: string;
  compare?: string;
  body?: string;
  path?: string;
  line?: string;
  decision?: string;
  explanation?: string;
  username?: string;
  status?: string;
  merge?: string[];
}

function apiPullBase(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
): string {
  const prefix = ownerType === "account" ? "users" : "orgs";
  return `/api/${prefix}/${encodeURIComponent(ownerName)}/repos/${encodeURIComponent(repoName)}`;
}

export async function fetchPullRequests(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
): Promise<{ pulls: PullSummary[]; currentRole: string | null }> {
  return apiRequest<{ pulls: PullSummary[]; currentRole: string | null }>(
    `${apiPullBase(ownerType, ownerName, repo)}/pulls`,
  );
}

export async function fetchPullRequestDetail(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
): Promise<PullDetail> {
  const body = await apiRequest<{ pull: PullDetail }>(
    `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}`,
  );
  return body.pull;
}

export async function fetchBranchComparison(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  base: string,
  compare: string,
): Promise<BranchComparison> {
  const params = new URLSearchParams({ base, compare });
  return apiRequest<BranchComparison>(
    `${apiPullBase(ownerType, ownerName, repo)}/pulls/compare?${params.toString()}`,
  );
}

export async function createPullRequest(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  input: {
    baseBranch: string;
    compareBranch: string;
    title: string;
    description: string;
    draft?: boolean;
  },
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: PullFieldErrors }> {
  try {
    const body = await apiRequest<{ pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function markPullRequestReadyForReview(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: Record<string, unknown> }> {
  try {
    const body = await apiRequest<{ pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/ready`,
      { method: "POST" },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function updatePullRequestCheck(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
  status: CheckStatus,
): Promise<void> {
  await apiRequest<{ ok: true }>(
    `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/checks`,
    { method: "POST", body: JSON.stringify({ name: "test", status }) },
  );
}

/** Publishes an inline comment immediately (Add single comment) or keeps it as a pending review draft (Start a review). */
export async function addInlineComment(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
  input: { path: string; line: number; body: string; startReview?: boolean },
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: PullFieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true; pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/comments`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function submitPullReview(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
  input: { decision: ReviewDecision; explanation?: string },
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: PullFieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true; pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/reviews`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function requestReviewer(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
  username: string,
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: PullFieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true; pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/reviewers`,
      { method: "POST", body: JSON.stringify({ username }) },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function removeReviewer(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
  username: string,
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: PullFieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true; pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/reviewers/${encodeURIComponent(username)}`,
      { method: "DELETE" },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function mergePullRequest(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: PullFieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true; pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/merge`,
      { method: "POST", body: JSON.stringify({ method: "merge" }) },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

/** Closes an unmerged Open or Draft pull request without merging (REQ-6-6). */
export async function closePullRequest(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: PullFieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true; pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/close`,
      { method: "POST" },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

/** Reopens a Closed pull request as Open (REQ-6-6). */
export async function reopenPullRequest(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  number: number,
): Promise<{ ok: true; pull: PullDetail } | { ok: false; errors: PullFieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true; pull: PullDetail }>(
      `${apiPullBase(ownerType, ownerName, repo)}/pulls/${number}/reopen`,
      { method: "POST" },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function fetchProtectionRules(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
): Promise<{ rules: ProtectionRule[]; currentRole: string | null }> {
  return apiRequest<{ rules: ProtectionRule[]; currentRole: string | null }>(
    `${apiPullBase(ownerType, ownerName, repo)}/protection-rules`,
  );
}

export async function saveProtectionRule(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  input: { branch: string; requireApproval: boolean; requireStatusCheck: boolean },
): Promise<{ ok: true; rules: ProtectionRule[] } | { ok: false; errors: { branch?: string } }> {
  try {
    const body = await apiRequest<{ ok: true; rules: ProtectionRule[] }>(
      `${apiPullBase(ownerType, ownerName, repo)}/protection-rules`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, rules: body.rules };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

function hasErrors(value: unknown): value is { errors: Record<string, unknown> } {
  return typeof value === "object" && value !== null && "errors" in value;
}

export function pullStatusText(status: PullStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "draft":
      return "Draft";
    case "closed":
      return "Closed";
    case "merged":
      return "Merged";
    default:
      return status;
  }
}
