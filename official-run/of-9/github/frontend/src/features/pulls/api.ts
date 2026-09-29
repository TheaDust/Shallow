import { apiRequest, ApiError } from "../../lib/api";
import type { RepoRole } from "../organizations/api";

export type PullStatus = "draft" | "open" | "closed" | "merged";
export type CheckStatus = "pending" | "success" | "failure";
export type ReviewDecision = "comment" | "approve" | "request_changes";

export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  status: PullStatus;
  baseBranch: string;
  compareBranch: string;
  createdAt: string;
  updatedAt: string;
  reviews: { reviewer: string; decision: ReviewDecision }[];
  reviewRequested: boolean;
}

export interface PullRequestComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface PullRequestTimelineEntry {
  id: string;
  type:
    | "created"
    | "comment"
    | "reviewer-requested"
    | "reviewer-removed"
    | "closed"
    | "reopened"
    | "merged"
    | "ready-for-review"
    | "review";
  author: string;
  createdAt: string;
  commentId?: string;
  targetUsername?: string;
  reviewer?: string;
  decision?: ReviewDecision;
  status?: string;
}

export interface CheckResult {
  status: CheckStatus;
  setter: string | null;
  setAt: string | null;
}

export interface ReviewSummaryEntry {
  reviewer: string;
  decision: ReviewDecision;
  createdAt: string;
  explanation: string;
}

export interface InlineComment {
  id: string;
  path: string;
  line: number;
  commitId: string;
  author: string;
  body: string;
  state: "published" | "pending";
  createdAt: string;
  outdated: boolean;
}

export interface PullRequestDetail {
  number: number;
  title: string;
  description: string;
  status: PullStatus;
  author: string;
  baseBranch: string;
  compareBranch: string;
  baseCommit: string;
  compareCommit: string;
  currentCompareCommit: string;
  createdAt: string;
  updatedAt: string;
  mergedBy: string | null;
  mergedAt: string | null;
  mergeCommitId: string | null;
  comments: PullRequestComment[];
  inlineComments: InlineComment[];
  requestedReviewers: { username: string; requestedBy: string; createdAt: string }[];
  checks: CheckResult;
  reviewSummary: ReviewSummaryEntry[];
  timeline: PullRequestTimelineEntry[];
}

export interface DiffLine {
  type: "context" | "add" | "del";
  line: string;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface PullRequestDetailData {
  pull: PullRequestDetail;
  myRole: RepoRole | null;
  branches: string[];
  commits: {
    id: string;
    shortId: string;
    message: string;
    author: string;
    createdAt: string;
    changes: { path: string; additions: number; deletions: number }[];
  }[];
  files: { files: DiffFile[]; totalAdditions: number; totalDeletions: number };
  eligibleReviewers: string[];
  mergeEligibility: {
    eligible: boolean;
    reasons: string[];
    conditions?: { label: string; satisfied: boolean }[];
  };
}

export interface PullRequestsListData {
  repository: { owner: string; name: string };
  myRole: RepoRole | null;
  pulls: PullRequestSummary[];
}

export interface ComparisonData {
  repository: { owner: string; name: string };
  myRole: RepoRole;
  branches: string[];
  base: string;
  compare: string;
  baseCommit: string | null;
  compareCommit: string | null;
  commitCount: number;
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  valid: boolean;
  reason: "same_branch" | "no_changes" | null;
}

export interface ProtectionRule {
  branch: string;
  requireApproval: boolean;
  requireCheck: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function extractFieldErrors(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.status === 422) {
    const body = error.body as { errors?: Record<string, string> };
    return body?.errors ?? {};
  }
  throw error;
}

export async function listPullRequests(owner: string, name: string): Promise<PullRequestsListData> {
  return apiRequest<PullRequestsListData>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`,
  );
}

export async function getPullRequest(
  owner: string,
  name: string,
  number: number,
): Promise<PullRequestDetailData> {
  return apiRequest<PullRequestDetailData>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`,
  );
}

export async function getComparisonData(
  owner: string,
  name: string,
  base: string,
  compare: string,
): Promise<ComparisonData> {
  const query = new URLSearchParams({ base, compare });
  return apiRequest<ComparisonData>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/comparison?${query}`,
  );
}

export type CreatePullRequestResult =
  | { ok: true; pull: PullRequestDetail }
  | { ok: false; errors: Record<string, string> };

export async function createPullRequest(
  owner: string,
  name: string,
  input: { base: string; compare: string; title: string; description: string; draft?: boolean },
): Promise<CreatePullRequestResult> {
  try {
    const body = await apiRequest<{ pull: PullRequestDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function requestReviewer(
  owner: string,
  name: string,
  number: number,
  username: string,
): Promise<{ ok: true; pull: PullRequestDetail } | { ok: false; errors: Record<string, string> }> {
  try {
    const body = await apiRequest<{ pull: PullRequestDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviewers`,
      { method: "POST", body: JSON.stringify({ username }) },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function removeReviewer(
  owner: string,
  name: string,
  number: number,
  username: string,
): Promise<{ ok: true; pull: PullRequestDetail } | { ok: false; errors: Record<string, string> }> {
  try {
    const body = await apiRequest<{ pull: PullRequestDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviewers/${encodeURIComponent(username)}`,
      { method: "DELETE" },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export type SetStatusResult =
  | { ok: true; pull: PullRequestDetail }
  | { ok: false; errors: Record<string, string> };

export async function readyForReview(
  owner: string,
  name: string,
  number: number,
): Promise<SetStatusResult> {
  try {
    const body = await apiRequest<{ pull: PullRequestDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/ready-for-review`,
      { method: "POST" },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export type AddInlineCommentResult =
  | { ok: true; comment: InlineComment }
  | { ok: false; errors: Record<string, string> };

export async function addInlineComment(
  owner: string,
  name: string,
  number: number,
  input: { path: string; line: number; body: string; draft: boolean },
): Promise<AddInlineCommentResult> {
  try {
    const body = await apiRequest<{ comment: InlineComment }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/inline-comments`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, comment: body.comment };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function setPullRequestStatus(
  owner: string,
  name: string,
  number: number,
  status: "open" | "closed",
): Promise<SetStatusResult> {
  try {
    const body = await apiRequest<{ pull: PullRequestDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    return { ok: true, pull: body.pull };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function updatePullRequestCheck(
  owner: string,
  name: string,
  number: number,
  status: CheckStatus,
): Promise<{ ok: true; checks: CheckResult; commitId: string } | { ok: false; errors: Record<string, string> }> {
  try {
    const body = await apiRequest<{ checks: CheckResult; commitId: string }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/checks`,
      { method: "POST", body: JSON.stringify({ status }) },
    );
    return { ok: true, checks: body.checks, commitId: body.commitId };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export type SubmitReviewResult =
  | {
      ok: true;
      review: {
        reviewer: string;
        commitId: string;
        decision: ReviewDecision;
        explanation: string;
        createdAt: string;
      };
      pull: PullRequestDetail;
    }
  | { ok: false; errors: Record<string, string> };

export async function submitPullRequestReview(
  owner: string,
  name: string,
  number: number,
  input: { decision: ReviewDecision; summary: string },
): Promise<SubmitReviewResult> {
  try {
    const body = await apiRequest<{
      review: Extract<SubmitReviewResult, { ok: true }>["review"];
      pull: PullRequestDetail;
    }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviews`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, review: body.review, pull: body.pull };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function mergePullRequest(
  owner: string,
  name: string,
  number: number,
): Promise<
  | { ok: true; pull: PullRequestDetail; commit: { id: string; message: string; author: string; createdAt: string } }
  | { ok: false; blocked: boolean; reasons?: string[]; errors?: Record<string, string> }
> {
  try {
    const body = await apiRequest<{ pull: PullRequestDetail; commit: { id: string; message: string; author: string; createdAt: string } }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/merge`,
      { method: "POST" },
    );
    return { ok: true, pull: body.pull, commit: body.commit };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const body = error.body as { reasons?: string[]; errors?: Record<string, string> };
      return { ok: false, blocked: true, reasons: body.reasons, errors: body.errors };
    }
    throw error;
  }
}

export async function listProtectionRules(owner: string, name: string): Promise<ProtectionRule[]> {
  const body = await apiRequest<{ rules: ProtectionRule[] }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/protection-rules`,
  );
  return body.rules;
}

export type SetProtectionRuleResult =
  | { ok: true; rule: ProtectionRule }
  | { ok: false; errors: Record<string, string> };

export async function setProtectionRule(
  owner: string,
  name: string,
  input: { branch: string; requireApproval: boolean; requireCheck: boolean },
): Promise<SetProtectionRuleResult> {
  try {
    const body = await apiRequest<{ rule: ProtectionRule }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/protection-rules`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, rule: body.rule };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}
