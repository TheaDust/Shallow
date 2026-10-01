import { apiRequest } from "./api";
import type { RepositoryCodeIdentity, RepositoryRole } from "./repository-code-api";

export type IssueState = "open" | "closed";

/** One supported reaction type of an issue or of one of its comments. */
export type IssueReactionType =
  | "thumbs_up"
  | "heart"
  | "hooray"
  | "laugh"
  | "confused"
  | "rocket"
  | "eyes";

/** The stored reaction summary of one target for the current viewer. */
export interface IssueReactionSummary {
  reaction: IssueReactionType;
  count: number;
  /** True when the signed-in viewer selected this reaction type. */
  reacted: boolean;
}

/** A repository-scoped colored classification name. */
export interface IssueLabel {
  name: string;
  color?: string | null;
  description?: string | null;
}

export interface IssueMilestone {
  title: string;
  state?: string;
}

/** One Issues list row: number, title, status, author, labels and update time. */
export interface RepositoryIssueRow {
  id: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  author: string | null;
  labels: IssueLabel[];
  milestone: IssueMilestone | null;
  commentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryIssueList {
  repository: RepositoryCodeIdentity;
  issues: RepositoryIssueRow[];
  /** Every label of the repository, for the label filter. */
  labels: IssueLabel[];
  milestones: IssueMilestone[];
  counts: { open: number; closed: number; all: number };
}

export interface IssueComment {
  id: string;
  author: string | null;
  body: string;
  createdAt: string;
  reactions?: IssueReactionSummary[];
}

export type IssueEventType =
  | "created"
  | "edited"
  | "commented"
  | "assigned"
  | "unassigned"
  | "labeled"
  | "unlabeled"
  | "milestoned"
  | "unmilestoned"
  | "closed"
  | "reopened"
  | "reacted"
  | "unreacted";

/** One append-only activity timeline record. */
export interface IssueEvent {
  id: string;
  type: IssueEventType | string;
  actor: string | null;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface IssueDetail {
  id: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  author: string | null;
  assignees: string[];
  labels: IssueLabel[];
  milestone: IssueMilestone | null;
  reactions?: IssueReactionSummary[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: string | null;
}

export interface RepositoryIssueDetail {
  repository: RepositoryCodeIdentity;
  issue: IssueDetail;
  comments: IssueComment[];
  events: IssueEvent[];
  viewerRole: RepositoryRole | null;
  /** Write, Maintain and Admin may create issues, edit them and comment. */
  canWrite: boolean;
  /** Triage, Maintain and Admin may assign, label, set milestones and close. */
  canTriage: boolean;
  /** Every label of the current repository, for the Labels picker. */
  labels: IssueLabel[];
  /** Every milestone of the current repository, for the Milestone picker. */
  milestones: IssueMilestone[];
  /**
   * The accounts holding at least Triage permission on this repository, so the
   * Assignees picker never offers an account outside the collaborator scope.
   */
  assigneeCandidates: string[];
}

function issuesPath(owner: string, name: string): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`;
}

export async function fetchRepositoryIssues(
  owner: string,
  name: string,
): Promise<RepositoryIssueList> {
  return apiRequest<RepositoryIssueList>(issuesPath(owner, name));
}

export async function fetchRepositoryIssue(
  owner: string,
  name: string,
  number: number | string,
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(
    `${issuesPath(owner, name)}/${encodeURIComponent(String(number))}`,
  );
}

/**
 * Creates one issue in the repository. The answer is the persisted detail
 * payload of the new issue, so the caller can open its page right away.
 */
export async function createRepositoryIssue(
  owner: string,
  name: string,
  input: { title: string; description: string },
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(issuesPath(owner, name), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Saves the submitted fields of one issue. Only the fields present in `input`
 * are stored, so the title and the description stay separate saves.
 */
export async function updateRepositoryIssue(
  owner: string,
  name: string,
  number: number | string,
  input: { title?: string; description?: string },
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(
    `${issuesPath(owner, name)}/${encodeURIComponent(String(number))}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

/** Appends one discussion comment to an issue. */
export async function addIssueComment(
  owner: string,
  name: string,
  number: number | string,
  body: string,
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(
    `${issuesPath(owner, name)}/${encodeURIComponent(String(number))}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

/**
 * Toggles the viewer's reaction on an issue or on one of its comments: an
 * association that already exists is removed, otherwise it is stored.
 */
export async function toggleIssueReaction(
  owner: string,
  name: string,
  number: number | string,
  input: { reaction: IssueReactionType; commentId?: string },
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(
    `${issuesPath(owner, name)}/${encodeURIComponent(String(number))}/reactions`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * Stores or deletes one issue-account assignment. The answer is the persisted
 * detail payload, so the sidebar and the timeline show the stored state.
 */
export async function toggleIssueAssignee(
  owner: string,
  name: string,
  number: number | string,
  input: { username: string; assigned: boolean },
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(
    `${issuesPath(owner, name)}/${encodeURIComponent(String(number))}/assignees`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Stores or deletes the association with one label of the current repository. */
export async function toggleIssueLabel(
  owner: string,
  name: string,
  number: number | string,
  input: { name: string; applied: boolean },
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(
    `${issuesPath(owner, name)}/${encodeURIComponent(String(number))}/labels`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Sets the single milestone association, or clears it with a null title. */
export async function setIssueMilestone(
  owner: string,
  name: string,
  number: number | string,
  input: { title: string | null },
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(
    `${issuesPath(owner, name)}/${encodeURIComponent(String(number))}/milestone`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Closes or reopens one issue without an additional confirmation. */
export async function setIssueState(
  owner: string,
  name: string,
  number: number | string,
  input: { state: IssueState },
): Promise<RepositoryIssueDetail> {
  return apiRequest<RepositoryIssueDetail>(
    `${issuesPath(owner, name)}/${encodeURIComponent(String(number))}/state`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

function repositoryPrefix(owner: string, name: string): string {
  return `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export interface RepositoryIssueFilterAddress {
  state?: string;
  q?: string;
  labels?: readonly string[];
}

/** Hash address of the issue creation form of one repository. */
export function newIssueHref(owner: string, name: string): string {
  return `${repositoryPrefix(owner, name)}/issues/new`;
}

/** Hash address of one issue detail page. */
export function repositoryIssueHref(owner: string, name: string, number: number): string {
  return `${repositoryPrefix(owner, name)}/issues/${number}`;
}

/**
 * Hash address of the Issues list with its filter context, so refreshing or
 * reopening the address restores the same rows.
 */
export function repositoryIssuesListHref(
  owner: string,
  name: string,
  filter: RepositoryIssueFilterAddress = {},
): string {
  const params = new URLSearchParams();
  if (filter.state === "open" || filter.state === "closed") params.set("state", filter.state);
  const keyword = filter.q?.trim() ?? "";
  if (keyword.length > 0) params.set("q", keyword);
  const labels = (filter.labels ?? []).filter((label) => label.length > 0);
  if (labels.length > 0) params.set("labels", labels.join(","));
  const query = params.toString();
  return `${repositoryPrefix(owner, name)}/issues${query ? `?${query}` : ""}`;
}
