import { ApiError, apiRequest } from "./api";
import type { RepoOwnerType } from "./repo-api";

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueMilestone {
  id: string;
  title: string;
  state: "open" | "closed";
}

export interface IssueReaction {
  reaction: string;
  count: number;
  viewerReacted: boolean;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  description: string;
  author: { username: string };
  labels: IssueLabel[];
  milestone: IssueMilestone | null;
  assignees: string[];
  updatedAt: string;
  commentsCount: number;
}

export interface IssueComment {
  id: string;
  author: { username: string };
  body: string;
  createdAt: string;
  reactions: IssueReaction[];
}

export interface IssueActivity {
  id: string;
  type: string;
  actor: { username: string };
  createdAt: string;
  commentId: string | null;
  body?: string | null;
  assignee?: string;
  label?: string;
  milestone?: string | null;
  field?: "title" | "description";
  value?: string;
}

export interface IssueDetailData {
  issue: IssueSummary & { id: string; createdAt: string; reactions: IssueReaction[] };
  comments: IssueComment[];
  activities: IssueActivity[];
  labels: IssueLabel[];
  milestones: IssueMilestone[];
  assignableMembers: string[];
  currentRole: string | null;
}

export interface IssuesListData {
  issues: IssueSummary[];
  labels: IssueLabel[];
  milestones: IssueMilestone[];
  currentRole: string | null;
}

export interface IssueFieldErrors {
  title?: string;
  description?: string;
  body?: string;
  target?: string;
  reaction?: string;
  username?: string;
  label?: string;
  milestone?: string;
}

function issueApiBase(ownerType: RepoOwnerType, ownerName: string, repoName: string): string {
  const prefix = ownerType === "account" ? "users" : "orgs";
  return `/api/${prefix}/${encodeURIComponent(ownerName)}/repos/${encodeURIComponent(repoName)}/issues`;
}

export async function fetchIssues(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
): Promise<IssuesListData> {
  return apiRequest<IssuesListData>(issueApiBase(ownerType, ownerName, repoName));
}

export async function fetchIssueDetail(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
): Promise<IssueDetailData> {
  return apiRequest<IssueDetailData>(
    `${issueApiBase(ownerType, ownerName, repoName)}/${number}`,
  );
}

export async function createIssue(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  input: { title: string; description: string },
): Promise<{ ok: true; issue: IssueSummary } | { ok: false; errors: IssueFieldErrors }> {
  try {
    const body = await apiRequest<{ issue: IssueSummary }>(
      issueApiBase(ownerType, ownerName, repoName),
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, issue: body.issue };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function addIssueComment(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
  body: string,
): Promise<
  | { ok: true; comment: IssueComment; activity: IssueActivity | null }
  | { ok: false; errors: IssueFieldErrors }
> {
  try {
    const result = await apiRequest<{ comment: IssueComment; activity: IssueActivity | null }>(
      `${issueApiBase(ownerType, ownerName, repoName)}/${number}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    return { ok: true, comment: result.comment, activity: result.activity };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function toggleIssueReaction(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
  input: { targetType: "issue" | "comment"; targetId: string; reaction: string },
): Promise<{ ok: true; reactions: IssueReaction[] } | { ok: false; errors: IssueFieldErrors }> {
  try {
    const body = await apiRequest<{ reactions: IssueReaction[] }>(
      `${issueApiBase(ownerType, ownerName, repoName)}/${number}/reactions`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, reactions: body.reactions };
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

export type IssueMutationResult =
  | { ok: true; activity: IssueActivity | null }
  | { ok: false; errors: IssueFieldErrors };

async function mutationRequest(
  url: string,
  input: Record<string, unknown>,
): Promise<IssueMutationResult> {
  try {
    const body = await apiRequest<{ ok: true; activity: IssueActivity | null }>(url, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, activity: body.activity };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

/** PATCHes only the title of the target issue (Write, Maintain, Admin). */
export async function updateIssueTitle(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
  title: string,
): Promise<IssueMutationResult> {
  try {
    const body = await apiRequest<{ ok: true; activity: IssueActivity | null }>(
      `${issueApiBase(ownerType, ownerName, repoName)}/${number}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    );
    return { ok: true, activity: body.activity };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

/** PATCHes only the description of the target issue (Write, Maintain, Admin). */
export async function updateIssueDescription(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
  description: string,
): Promise<IssueMutationResult> {
  try {
    const body = await apiRequest<{ ok: true; activity: IssueActivity | null }>(
      `${issueApiBase(ownerType, ownerName, repoName)}/${number}`,
      { method: "PATCH", body: JSON.stringify({ description }) },
    );
    return { ok: true, activity: body.activity };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

/** Assigns (or unassigns) one participant of an issue (Triage, Maintain, Admin). */
export async function setIssueAssignee(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
  username: string,
  assign: boolean,
): Promise<IssueMutationResult> {
  return mutationRequest(
    `${issueApiBase(ownerType, ownerName, repoName)}/${number}/assignees`,
    { username, assign },
  );
}

/** Applies or removes a current-repository label (Triage, Maintain, Admin). */
export async function toggleIssueLabel(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
  name: string,
): Promise<IssueMutationResult> {
  return mutationRequest(
    `${issueApiBase(ownerType, ownerName, repoName)}/${number}/labels`,
    { name },
  );
}

/** Sets or removes (null) the single milestone association (Triage, Maintain, Admin). */
export async function setIssueMilestone(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
  milestone: string | null,
): Promise<IssueMutationResult> {
  return mutationRequest(
    `${issueApiBase(ownerType, ownerName, repoName)}/${number}/milestone`,
    { milestone },
  );
}

/**
 * Closes or reopens the target issue (Triage, Maintain, Admin only); stores
 * the new Open/Closed status, operator, time, and an activity record.
 */
export async function setIssueState(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  number: number,
  state: "open" | "closed",
): Promise<IssueMutationResult> {
  return mutationRequest(
    `${issueApiBase(ownerType, ownerName, repoName)}/${number}/state`,
    { state },
  );
}
