import { apiRequest, ApiError } from "../../lib/api";
import type { RepoRole } from "../organizations/api";

export type IssueStatus = "open" | "closed";

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  status: IssueStatus;
  author: string;
  labels: string[];
  searchText: string;
  updatedAt: string;
}

export interface IssueReactions {
  [reaction: string]: { count: number; reacted: boolean };
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  reactions: IssueReactions;
}

export interface TimelineEntry {
  id: string;
  type:
    | "created"
    | "comment"
    | "title-edited"
    | "description-edited"
    | "assigned"
    | "unassigned"
    | "labeled"
    | "unlabeled"
    | "milestone-changed"
    | "closed"
    | "reopened"
    | "reaction";
  author: string;
  createdAt: string;
  commentId?: string;
  oldTitle?: string;
  newTitle?: string;
  oldDescription?: string;
  newDescription?: string;
  reaction?: string;
  targetType?: string;
  targetId?: string;
  added?: boolean;
  targetUsername?: string;
  labelName?: string;
  oldMilestone?: string | null;
  newMilestone?: string | null;
}

export interface IssueDetail {
  number: number;
  title: string;
  description: string;
  status: IssueStatus;
  author: string;
  createdAt: string;
  updatedAt: string;
  assignees: string[];
  labels: IssueLabel[];
  milestone: { id: string; title: string } | null;
  comments: IssueComment[];
  reactions: IssueReactions;
  timeline: TimelineEntry[];
}

export interface IssueDetailData {
  issue: IssueDetail;
  myRole: RepoRole | null;
  labels: IssueLabel[];
  milestones: { id: string; title: string }[];
  assignableMembers: string[];
}

export interface IssuesListData {
  repository: { owner: string; name: string };
  myRole: RepoRole | null;
  labels: IssueLabel[];
  issues: IssueSummary[];
}

function extractFieldErrors(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.status === 422) {
    const body = error.body as { errors?: Record<string, string> };
    return body?.errors ?? {};
  }
  throw error;
}

export async function listIssues(owner: string, name: string): Promise<IssuesListData> {
  const body = await apiRequest<IssuesListData>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`,
  );
  return body;
}

export async function getIssue(
  owner: string,
  name: string,
  number: number,
): Promise<IssueDetailData> {
  const body = await apiRequest<IssueDetailData>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`,
  );
  return body;
}

export type CreateIssueResult =
  | { ok: true; issue: IssueSummary }
  | { ok: false; errors: Record<string, string> };

export async function createIssue(
  owner: string,
  name: string,
  input: { title: string; description: string },
): Promise<CreateIssueResult> {
  try {
    const body = await apiRequest<{ issue: IssueSummary }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, issue: body.issue };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export type UpdateIssueResult =
  | { ok: true; issue: IssueDetail }
  | { ok: false; errors: Record<string, string> };

export async function updateIssueTitle(
  owner: string,
  name: string,
  number: number,
  title: string,
): Promise<UpdateIssueResult> {
  try {
    const body = await apiRequest<{ issue: IssueDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/title`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    );
    return { ok: true, issue: body.issue };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function updateIssueDescription(
  owner: string,
  name: string,
  number: number,
  description: string,
): Promise<UpdateIssueResult> {
  try {
    const body = await apiRequest<{ issue: IssueDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/description`,
      { method: "PATCH", body: JSON.stringify({ description }) },
    );
    return { ok: true, issue: body.issue };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export type AddCommentResult =
  | { ok: true; comment: IssueComment }
  | { ok: false; errors: Record<string, string> };

export async function addIssueComment(
  owner: string,
  name: string,
  number: number,
  body: string,
): Promise<AddCommentResult> {
  try {
    const response = await apiRequest<{ comment: IssueComment }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    return { ok: true, comment: response.comment };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export type ToggleReactionResult =
  | { ok: true; reactions: IssueReactions }
  | { ok: false; errors: Record<string, string> };

export async function toggleIssueReaction(
  owner: string,
  name: string,
  number: number,
  input: { targetType: "issue" | "comment"; targetId: string; reaction: string },
): Promise<ToggleReactionResult> {
  try {
    const body = await apiRequest<{ reactions: IssueReactions }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/reactions`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, reactions: body.reactions };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export type MetadataUpdateResult =
  | { ok: true; issue: IssueDetail }
  | { ok: false; errors: Record<string, string> };

export async function toggleIssueAssignee(
  owner: string,
  name: string,
  number: number,
  username: string,
): Promise<MetadataUpdateResult> {
  try {
    const body = await apiRequest<{ issue: IssueDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/assignees`,
      { method: "PATCH", body: JSON.stringify({ username }) },
    );
    return { ok: true, issue: body.issue };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function toggleIssueLabel(
  owner: string,
  name: string,
  number: number,
  labelName: string,
): Promise<MetadataUpdateResult> {
  try {
    const body = await apiRequest<{ issue: IssueDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/labels`,
      { method: "PATCH", body: JSON.stringify({ name: labelName }) },
    );
    return { ok: true, issue: body.issue };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function setIssueMilestone(
  owner: string,
  name: string,
  number: number,
  milestoneId: string | null,
): Promise<MetadataUpdateResult> {
  try {
    const body = await apiRequest<{ issue: IssueDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/milestone`,
      { method: "PATCH", body: JSON.stringify({ milestoneId }) },
    );
    return { ok: true, issue: body.issue };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function setIssueStatus(
  owner: string,
  name: string,
  number: number,
  status: IssueStatus,
): Promise<MetadataUpdateResult> {
  try {
    const body = await apiRequest<{ issue: IssueDetail }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    return { ok: true, issue: body.issue };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}
