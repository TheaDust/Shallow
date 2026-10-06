// Typed same-origin calls for organizations, teams and repository access.

import { ApiError, apiRequest } from "./api";

export interface OrganizationSummary {
  id: string;
  displayName: string;
  role?: string;
}

export interface RepositorySummary {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  /** REQ-3-5: stored Archived status, shown as the overview marker. */
  archived: boolean;
  defaultBranch: string;
  forkOfRepositoryId: string | null;
  updatedAt: string;
  owner: { id: string; displayName: string };
  canManage?: boolean;
}

/** Repository overview payload: stored record plus owner, source link and code facts. */
export interface RepositoryDetail extends RepositorySummary {
  canManage: boolean;
  canWrite: boolean;
  fork: { id: string; name: string; owner: { id: string; displayName: string } } | null;
  readmePath: string | null;
  commitCount: number;
}

/** One named reference of a repository and the commit it points at. */
export interface RepositoryBranch {
  name: string;
  headCommitId: string | null;
  createdAt: string | null;
}

/** The branch selector's data: the readable branch names of one repository. */
export interface RepositoryBranches {
  repository: RepositorySummary;
  defaultBranch: string;
  branches: RepositoryBranch[];
  canWrite: boolean;
}

export interface RepositoryCommit {
  id: string;
  message: string;
  authorName: string;
  createdAt: string;
  parentCommitId: string | null;
}

export interface RepositoryTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface RepositoryTree {
  repository: RepositorySummary;
  branch: string;
  defaultBranch: string;
  path: string;
  entries: RepositoryTreeEntry[];
}

export interface RepositoryFile {
  branch: string;
  defaultBranch: string;
  path: string;
  name: string;
  content: string;
}

export interface RepositoryFileView {
  repository: RepositorySummary;
  file: RepositoryFile;
}

export interface CommitDiffLine {
  type: "context" | "added" | "removed";
  text: string;
}

/** One file of a commit, compared line by line with its parent revision. */
export interface CommitFileChange {
  path: string;
  status: "added" | "modified" | "removed";
  additions: number;
  deletions: number;
  lines: CommitDiffLine[];
}

export interface RepositoryCommitDetail {
  repository: RepositorySummary;
  branch: string;
  commit: RepositoryCommit;
  base: RepositoryCommit | null;
  changes: CommitFileChange[];
  totals: { files: number; additions: number; deletions: number };
}

/** One readable file with the lines that matched the repository search. */
export interface CodeSearchMatch {
  path: string;
  name: string;
  lines: Array<{ number: number; text: string }>;
}

export interface CodeSearchResults {
  repository: RepositorySummary;
  branch: string;
  query: string;
  matches: CodeSearchMatch[];
}

export interface RepositoryFieldErrors {
  owner?: string;
  name?: string;
  description?: string;
  visibility?: string;
}

export interface RepositoryAccessEntry {
  id: string;
  subjectType: "account" | "team";
  subjectName: string;
  role: string;
}

export interface AccessCandidates {
  teams: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; username: string }>;
}

export interface OrganizationMember {
  username: string;
  role: string;
}

/** One persisted organization action as the audit-log table reads it. */
export interface OrganizationAuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  parentName: string | null;
}

export interface OrganizationFieldErrors {
  name?: string;
  displayName?: string;
}

export interface TeamFieldErrors {
  name?: string;
  username?: string;
  parentName?: string;
}

export interface MemberFieldErrors {
  identifier?: string;
  role?: string;
  member?: string;
}

export interface AccessFieldErrors {
  role?: string;
  subjectName?: string;
}

export interface VisibilityFieldErrors {
  visibility?: string;
}

export interface ArchiveFieldErrors {
  archived?: string;
}

/** One classification name of a repository, shown by an issue. */
export interface IssueLabel {
  name: string;
  color: string;
}

/** One row of the repository Issues list. */
export interface IssueSummary {
  number: number;
  title: string;
  status: "open" | "closed";
  author: string;
  labels: IssueLabel[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** The complete read view of one issue, without its discussion. */
export interface IssueDetail {
  number: number;
  title: string;
  description: string;
  status: "open" | "closed";
  author: string;
  labels: IssueLabel[];
  assignees: string[];
  milestone: { name: string } | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One independent discussion record appended to an issue. */
export interface IssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

/** One entry of the append-only activity timeline. */
export interface IssueEvent {
  id: string;
  type: string;
  actor: string;
  /** The username, label or milestone the event refers to; "" when it has none. */
  detail: string;
  createdAt: string;
}

/** One aggregated reaction of an issue: its type, its count and whether the
 * current caller is one of the reacting accounts (REQ-5-5). */
export interface IssueReaction {
  type: string;
  count: number;
  reacted: boolean;
}

/** Repository Issues list payload plus the caller's issue permissions. */
export interface IssueListPayload {
  repository: RepositorySummary;
  issues: IssueSummary[];
  canWrite: boolean;
  canTriage: boolean;
}

/** Issue detail payload: the saved issue, its discussion and its timeline. */
export interface IssueViewPayload {
  repository: RepositorySummary;
  issue: IssueDetail;
  comments: IssueComment[];
  events: IssueEvent[];
  canWrite: boolean;
  canTriage: boolean;
  /** REQ-5-5: a signed-in viewer of the issue may add and remove reactions. */
  canReact: boolean;
  /** Stored reactions of this issue, aggregated per type. */
  reactions: IssueReaction[];
  /** Labels this repository already defines, selectable on the issue. */
  availableLabels: IssueLabel[];
  /** Milestones this repository already defines, selectable on the issue. */
  availableMilestones: Array<{ name: string }>;
  /** Eligible member usernames offered by the assignee selector. */
  availableAssignees: string[];
}

export interface IssueFieldErrors {
  title?: string;
  description?: string;
  body?: string;
  assignee?: string;
  label?: string;
  milestone?: string;
  status?: string;
  reaction?: string;
}

export type CreateResult<T, E> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: E; message: string };

function fieldErrorsFrom<T>(error: unknown): T {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    return ((error.body as { fieldErrors?: T }).fieldErrors ?? {}) as T;
  }
  return {} as T;
}

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Unable to complete the request";
}

const organizationUrl = (organizationId: string) => `/api/organizations/${encodeURIComponent(organizationId)}`;
const teamUrl = (organizationId: string, teamName: string) =>
  `${organizationUrl(organizationId)}/teams/${encodeURIComponent(teamName)}`;

export async function fetchPublicOrganizations(): Promise<OrganizationSummary[]> {
  const data = await apiRequest<{ organizations: OrganizationSummary[] }>("/api/organizations");
  return data.organizations;
}

export async function fetchYourOrganizations(): Promise<OrganizationSummary[]> {
  const data = await apiRequest<{ organizations: OrganizationSummary[] }>("/api/organizations");
  return data.organizations;
}

export async function createOrganization(input: {
  name: string;
  displayName: string;
}): Promise<CreateResult<OrganizationSummary, OrganizationFieldErrors>> {
  try {
    const data = await apiRequest<{ organization: OrganizationSummary }>("/api/organizations", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, value: data.organization };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

export async function fetchOrganization(
  organizationId: string,
): Promise<{ organization: OrganizationSummary; viewerRole: string | null }> {
  const data = await apiRequest<{ organization: OrganizationSummary; viewerRole: string | null }>(
    organizationUrl(organizationId),
  );
  return { organization: data.organization, viewerRole: data.viewerRole ?? null };
}

export async function fetchOrganizationRepositories(
  organizationId: string,
): Promise<RepositorySummary[]> {
  const data = await apiRequest<{ repositories: RepositorySummary[] }>(
    `${organizationUrl(organizationId)}/repositories`,
  );
  return data.repositories;
}

/** Repositories the caller may read; `query` narrows the same set by name. */
export async function fetchReadableRepositories(query = ""): Promise<RepositorySummary[]> {
  const trimmed = query.trim();
  const path = trimmed
    ? `/api/repositories?q=${encodeURIComponent(trimmed)}`
    : "/api/repositories";
  const data = await apiRequest<{ repositories: RepositorySummary[] }>(path);
  return data.repositories;
}

/** Global search: repository-oriented results inside the caller's read scope. */
export async function searchRepositories(query: string): Promise<RepositorySummary[]> {
  return fetchReadableRepositories(query);
}

/** Administrator-only visibility change; the server re-checks the permission. */
export async function saveRepositoryVisibility(
  owner: string,
  name: string,
  visibility: "public" | "private",
): Promise<CreateResult<RepositorySummary, VisibilityFieldErrors>> {
  try {
    const data = await apiRequest<{ repository: RepositorySummary }>(
      `${repositoryUrl(owner, name)}/visibility`,
      { method: "PATCH", body: JSON.stringify({ visibility }) },
    );
    return { ok: true, value: data.repository };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/**
 * REQ-3-5: archives or restores one repository. Only a repository
 * administrator may call it; the server re-checks that permission.
 */
export async function saveRepositoryArchive(
  owner: string,
  name: string,
  archived: boolean,
): Promise<CreateResult<RepositorySummary, ArchiveFieldErrors>> {
  try {
    const data = await apiRequest<{ repository: RepositorySummary }>(
      `${repositoryUrl(owner, name)}/archive`,
      { method: "PATCH", body: JSON.stringify({ archived }) },
    );
    return { ok: true, value: data.repository };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

export async function fetchRepository(owner: string, name: string): Promise<RepositoryDetail> {
  const data = await apiRequest<{ repository: RepositoryDetail }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  );
  return data.repository;
}

/**
 * Creates a repository in a personal or organization namespace. Validation and
 * permission failures come back as field errors so the form can display the
 * reason without leaving the page.
 */
export async function createRepository(input: {
  ownerType: "account" | "organization";
  ownerId: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  initialize: boolean;
}): Promise<CreateResult<RepositoryDetail, RepositoryFieldErrors>> {
  try {
    const data = await apiRequest<{ repository: RepositoryDetail }>("/api/repositories", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, value: data.repository };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Forks a readable repository into a personal or organization namespace. */
export async function forkRepository(
  owner: string,
  name: string,
  input: {
    ownerType: "account" | "organization";
    ownerId: string;
    name: string;
    visibility: "public" | "private";
  },
): Promise<CreateResult<RepositoryDetail, RepositoryFieldErrors>> {
  try {
    const data = await apiRequest<{ repository: RepositoryDetail }>(
      `${repositoryUrl(owner, name)}/fork`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, value: data.repository };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** The persisted issues of one repository, in number order. */
export async function fetchRepositoryIssues(
  owner: string,
  name: string,
): Promise<IssueListPayload> {
  return apiRequest<IssueListPayload>(`${repositoryUrl(owner, name)}/issues`);
}

/** One issue with its saved description, discussion and activity timeline. */
export async function fetchRepositoryIssue(
  owner: string,
  name: string,
  number: string | number,
): Promise<IssueViewPayload> {
  return apiRequest<IssueViewPayload>(
    `${repositoryUrl(owner, name)}/issues/${encodeURIComponent(String(number))}`,
  );
}

/** Creates one Open issue; validation failures come back as field errors. */
export async function createRepositoryIssue(
  owner: string,
  name: string,
  input: { title: string; description: string },
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  try {
    const data = await apiRequest<IssueViewPayload>(`${repositoryUrl(owner, name)}/issues`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Appends one discussion comment and its timeline entry. */
export async function commentOnRepositoryIssue(
  owner: string,
  name: string,
  number: string | number,
  body: string,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  try {
    const data = await apiRequest<IssueViewPayload>(
      `${repositoryUrl(owner, name)}/issues/${encodeURIComponent(String(number))}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/**
 * Saves one content field of one issue (REQ-5-2-2). Only the passed key is sent,
 * so the server writes exactly that field; a rejected title comes back as a
 * field error and leaves the stored issue unchanged.
 */
async function patchRepositoryIssue(
  owner: string,
  name: string,
  number: string | number,
  field: { title: string } | { description: string },
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  try {
    const data = await apiRequest<IssueViewPayload>(
      `${repositoryUrl(owner, name)}/issues/${encodeURIComponent(String(number))}`,
      { method: "PATCH", body: JSON.stringify(field) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Saves the issue title without touching the description. */
export function updateRepositoryIssueTitle(
  owner: string,
  name: string,
  number: string | number,
  title: string,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  return patchRepositoryIssue(owner, name, number, { title });
}

/** Saves the issue description without touching the title. */
export function updateRepositoryIssueDescription(
  owner: string,
  name: string,
  number: string | number,
  description: string,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  return patchRepositoryIssue(owner, name, number, { description });
}

/** One metadata mutation of an issue; selectors save immediately (REQ-5-3). */
async function mutateIssueMetadata(
  owner: string,
  name: string,
  number: string | number,
  path: string,
  method: "POST" | "DELETE" | "PUT",
  body?: Record<string, string>,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  try {
    const data = await apiRequest<IssueViewPayload>(
      `${repositoryUrl(owner, name)}/issues/${encodeURIComponent(String(number))}/${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Assigns or unassigns one repository member on the issue (REQ-5-3-1). */
export function setRepositoryIssueAssignee(
  owner: string,
  name: string,
  number: string | number,
  username: string,
  assigned: boolean,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  return assigned
    ? mutateIssueMetadata(owner, name, number, "assignees", "POST", { username })
    : mutateIssueMetadata(
        owner,
        name,
        number,
        `assignees/${encodeURIComponent(username)}`,
        "DELETE",
      );
}

/** Applies or removes one existing label of the repository (REQ-5-3-2). */
export function setRepositoryIssueLabel(
  owner: string,
  name: string,
  number: string | number,
  label: string,
  applied: boolean,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  return applied
    ? mutateIssueMetadata(owner, name, number, "labels", "POST", { name: label })
    : mutateIssueMetadata(owner, name, number, `labels/${encodeURIComponent(label)}`, "DELETE");
}

/** Sets an existing milestone on the issue (REQ-5-3-3). */
export function setRepositoryIssueMilestone(
  owner: string,
  name: string,
  number: string | number,
  milestone: string,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  return mutateIssueMetadata(owner, name, number, "milestone", "PUT", { name: milestone });
}

/**
 * Closes or reopens the issue without touching its content (REQ-5-4). The
 * server re-checks the transition rule, so a Write or Read caller is refused
 * even though the control is hidden from them.
 */
export async function setRepositoryIssueStatus(
  owner: string,
  name: string,
  number: string | number,
  status: "open" | "closed",
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  try {
    const data = await apiRequest<IssueViewPayload>(
      `${repositoryUrl(owner, name)}/issues/${encodeURIComponent(String(number))}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/**
 * Adds one reaction of a defined type to the issue (REQ-5-5). Reading the issue
 * is enough, so no write grant is required, while a visitor without a session
 * is refused by the server.
 */
export function addRepositoryIssueReaction(
  owner: string,
  name: string,
  number: string | number,
  type: string,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  return mutateIssueMetadata(owner, name, number, "reactions", "POST", { type });
}

/** Removes only the caller's own reaction of that type (REQ-5-5). */
export function removeRepositoryIssueReaction(
  owner: string,
  name: string,
  number: string | number,
  type: string,
): Promise<CreateResult<IssueViewPayload, IssueFieldErrors>> {
  return mutateIssueMetadata(
    owner,
    name,
    number,
    `reactions/${encodeURIComponent(type)}`,
    "DELETE",
  );
}

/** Read-only code views of one branch; all of them apply the read rule. */
export async function fetchRepositoryTree(
  owner: string,
  name: string,
  path = "",
  branch = "",
): Promise<RepositoryTree> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  return apiRequest<RepositoryTree>(`${repositoryUrl(owner, name)}/tree${query ? `?${query}` : ""}`);
}

export async function fetchRepositoryFile(
  owner: string,
  name: string,
  path: string,
  branch = "",
): Promise<RepositoryFileView> {
  const params = new URLSearchParams({ path });
  if (branch) params.set("branch", branch);
  return apiRequest<RepositoryFileView>(`${repositoryUrl(owner, name)}/blob?${params.toString()}`);
}

export async function fetchRepositoryCommits(
  owner: string,
  name: string,
  path = "",
  branch = "",
): Promise<{
  repository: RepositorySummary;
  branch: string;
  defaultBranch: string;
  path: string;
  commits: RepositoryCommit[];
}> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  return apiRequest<{
    repository: RepositorySummary;
    branch: string;
    defaultBranch: string;
    path: string;
    commits: RepositoryCommit[];
  }>(`${repositoryUrl(owner, name)}/commits${query ? `?${query}` : ""}`);
}

/** One commit with the line differences against its parent revision. */
export async function fetchRepositoryCommit(
  owner: string,
  name: string,
  commitId: string,
): Promise<RepositoryCommitDetail> {
  return apiRequest<RepositoryCommitDetail>(
    `${repositoryUrl(owner, name)}/commit/${encodeURIComponent(commitId)}`,
  );
}

/** Keyword search inside the readable file content of one branch. */
export async function searchRepositoryCode(
  owner: string,
  name: string,
  query: string,
  branch = "",
): Promise<CodeSearchResults> {
  const params = new URLSearchParams({ q: query });
  if (branch) params.set("branch", branch);
  return apiRequest<CodeSearchResults>(`${repositoryUrl(owner, name)}/code-search?${params.toString()}`);
}

/** The branch names of one repository plus the caller's write permission. */
export async function fetchRepositoryBranches(
  owner: string,
  name: string,
): Promise<RepositoryBranches> {
  return apiRequest<RepositoryBranches>(`${repositoryUrl(owner, name)}/branches`);
}

/**
 * Creates a branch pointing at the head of `base` (the repository default branch
 * when omitted). The server re-checks the write permission and the name rules,
 * so the caller can only ever mirror the same validation messages.
 */
export async function createRepositoryBranch(
  owner: string,
  name: string,
  input: { name: string; base?: string },
): Promise<CreateResult<RepositoryBranch, { name?: string }>> {
  try {
    const data = await apiRequest<{ branch: RepositoryBranch }>(
      `${repositoryUrl(owner, name)}/branches`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, value: data.branch };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Administrator-only default-branch change; the server re-checks the role. */
export async function saveRepositoryDefaultBranch(
  owner: string,
  name: string,
  branch: string,
): Promise<CreateResult<RepositoryDetail, { branch?: string }>> {
  try {
    const data = await apiRequest<{ repository: RepositoryDetail }>(
      `${repositoryUrl(owner, name)}/default-branch`,
      { method: "PATCH", body: JSON.stringify({ branch }) },
    );
    return { ok: true, value: data.repository };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** One commit adding a file to a branch, written in a single store update. */
export async function createRepositoryFile(
  owner: string,
  name: string,
  input: { path: string; content: string; message: string; branch?: string },
): Promise<CreateResult<RepositoryFileView, { path?: string; message?: string }>> {
  try {
    const data = await apiRequest<RepositoryFileView>(
      `${repositoryUrl(owner, name)}/files`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** One row of the repository Pull requests list (REQ-6-2-1). */
export interface PullRequestSummary {
  number: number;
  title: string;
  description: string;
  status: PullRequestStatus;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  compareCommitId: string | null;
  creationCompareCommitId: string | null;
  baseCommitId: string | null;
  mergedBy: string | null;
  mergedAt: string | null;
  mergedCommitId: string | null;
  /** The repository-scoped milestone the pull request is assigned to (REQ-5-3-3). */
  milestone: { name: string } | null;
}

/** A pull request is only ever Draft, Open, Closed or Merged (REQ-6). */
export type PullRequestStatus = "draft" | "open" | "closed" | "merged";

/** One status check recorded for the compare commit a pull request reads. */
export interface PullRequestCheck {
  name: string;
  status: "pending" | "success" | "failure";
  setter: string | null;
}

export interface PullRequestListPayload {
  repository: RepositorySummary;
  pullRequests: PullRequestSummary[];
  canWrite: boolean;
  canMaintain: boolean;
  canManage: boolean;
}

/** One line comment of a pull request, anchored to its file and line (REQ-6-3-3). */
export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  filePath: string;
  lineIndex: number | null;
  state: "published" | "pending";
  commitId: string | null;
  outdated: boolean;
  createdAt: string;
}

/** One review decision of a pull request (REQ-6-3-4). */
export type ReviewDecision = "approved" | "changes-requested";

export interface PullRequestReview {
  id: string;
  reviewer: string;
  decision: ReviewDecision;
  summary: string;
  commitId: string | null;
  stale: boolean;
  createdAt: string;
}

/** One merge condition the confirmation area reports (REQ-6-5). */
export interface MergeCondition {
  key: string;
  label: string;
  satisfied: boolean;
}

/** The merge eligibility of one pull request (REQ-6-5). */
export interface PullRequestMergeState {
  eligible: boolean;
  method: string;
  conditions: MergeCondition[];
  reviewRequired: boolean;
  blockedReason: string | null;
}

/** The complete read view of one pull request and its comparison. */
export interface PullRequestViewPayload {
  repository: RepositorySummary;
  pullRequest: PullRequestSummary;
  baseCommit: RepositoryCommit | null;
  compareCommit: RepositoryCommit | null;
  commits: RepositoryCommit[];
  changes: CommitFileChange[];
  totals: { files: number; additions: number; deletions: number };
  checks: PullRequestCheck[];
  comments: Array<{ id: string; author: string; body: string; createdAt: string }>;
  reviewComments: ReviewComment[];
  events: IssueEvent[];
  reviews: PullRequestReview[];
  requestedReviewers: string[];
  availableReviewers: string[];
  /** Milestones this repository already defines, selectable on the pull request. */
  availableMilestones: Array<{ name: string }>;
  merge: PullRequestMergeState;
  canWrite: boolean;
  canMaintain: boolean;
  canManage: boolean;
  /** Triage, Maintain, Admin or Owner may change the issue metadata (REQ-5-3). */
  canTriage: boolean;
  canReview: boolean;
  canManageReviewers: boolean;
}

/** The comparison of two branches before a pull request is created. */
export interface PullRequestComparison {
  repository: RepositorySummary;
  base: string;
  compare: string;
  baseCommit: RepositoryCommit | null;
  compareCommit: RepositoryCommit | null;
  commits: RepositoryCommit[];
  changes: CommitFileChange[];
  totals: { files: number; additions: number; deletions: number };
  identical: boolean;
  canWrite: boolean;
}

/** One persisted branch protection rule of an exact branch (REQ-6-1). */
export interface BranchProtectionRule {
  id: string;
  branchName: string;
  requireApprovals: boolean;
  requireStatusCheck: boolean;
  statusCheckName: string | null;
}

export interface PullRequestFieldErrors {
  title?: string;
  description?: string;
  compare?: string;
  status?: string;
  comment?: string;
  decision?: string;
  summary?: string;
  reviewer?: string;
  milestone?: string;
}

export interface BranchProtectionFieldErrors {
  branchName?: string;
}

/** One published release of a repository (REQ-4-5). */
export interface RepositoryRelease {
  id: string;
  tagName: string;
  title: string;
  description: string;
  targetBranch: string;
  author: string;
  createdAt: string;
}

/** The released tags of one repository plus the caller's publish permission. */
export interface ReleaseListPayload {
  repository: RepositorySummary;
  releases: RepositoryRelease[];
  canWrite: boolean;
}

/** One release with its title, description and target branch. */
export interface ReleaseViewPayload {
  repository: RepositorySummary;
  release: RepositoryRelease;
  canWrite: boolean;
}

/** The four fields of the `New release` form. */
export interface ReleaseFieldErrors {
  tagName?: string;
  title?: string;
  description?: string;
  targetBranch?: string;
}

/** The persisted pull requests of one repository. */
export async function fetchRepositoryPullRequests(
  owner: string,
  name: string,
): Promise<PullRequestListPayload> {
  return apiRequest<PullRequestListPayload>(`${repositoryUrl(owner, name)}/pulls`);
}

/** The commits and per-file differences between two branches. */
export async function fetchPullRequestComparison(
  owner: string,
  name: string,
  base: string,
  compare: string,
): Promise<PullRequestComparison> {
  const params = new URLSearchParams({ base, compare });
  return apiRequest<PullRequestComparison>(
    `${repositoryUrl(owner, name)}/pulls/compare?${params.toString()}`,
  );
}

/** One pull request with its conversation, commits, files and checks. */
export async function fetchRepositoryPullRequest(
  owner: string,
  name: string,
  number: string | number,
): Promise<PullRequestViewPayload> {
  return apiRequest<PullRequestViewPayload>(
    `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}`,
  );
}

/**
 * Creates one pull request from a valid comparison. A normal creation stores
 * Open and a draft creation stores Draft; the server re-checks the write rule
 * and the title rule, so the form can only mirror the same messages.
 */
export async function createRepositoryPullRequest(
  owner: string,
  name: string,
  input: { title: string; description: string; base: string; compare: string; draft?: boolean },
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  try {
    const data = await apiRequest<PullRequestViewPayload>(`${repositoryUrl(owner, name)}/pulls`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Moves a draft to ready for review, closes or reopens it (REQ-6-2). */
export async function setRepositoryPullRequestStatus(
  owner: string,
  name: string,
  number: string | number,
  status: "open" | "closed",
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  try {
    const data = await apiRequest<PullRequestViewPayload>(
      `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Sets one status check of the pull request's current compare commit. */
export async function setRepositoryPullRequestCheck(
  owner: string,
  name: string,
  number: string | number,
  check: string,
  status: PullRequestCheck["status"],
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  try {
    const data = await apiRequest<PullRequestViewPayload>(
      `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}/checks`,
      { method: "PATCH", body: JSON.stringify({ name: check, status }) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/**
 * Sets or clears one existing milestone of the repository on a pull request
 * (REQ-5-3-3). A non-empty name stores the relationship, the empty name removes
 * it; the server re-checks the metadata rule and that the milestone belongs to
 * the same repository, so the selector never creates one.
 */
export async function setRepositoryPullRequestMilestone(
  owner: string,
  name: string,
  number: string | number,
  milestone: string,
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  const base = `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}/milestone`;
  try {
    const data = await apiRequest<PullRequestViewPayload>(base, {
      method: milestone ? "PUT" : "DELETE",
      ...(milestone ? { body: JSON.stringify({ name: milestone }) } : {}),
    });
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/**
 * Adds one line comment to the current compare revision (REQ-6-3-3).
 * `published` publishes it immediately (`Add single comment`) while `pending`
 * stores it as a pending review comment (`Start a review`). The server
 * re-checks the review rule, so the UI only mirrors the same messages.
 */
export async function addRepositoryPullRequestComment(
  owner: string,
  name: string,
  number: string | number,
  input: {
    body: string;
    filePath: string;
    lineIndex: number | null;
    state: "published" | "pending";
  },
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  try {
    const data = await apiRequest<PullRequestViewPayload>(
      `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}/comments`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Merges the compare branch into the base branch of an Open pull request (REQ-6). */
export async function mergeRepositoryPullRequest(
  owner: string,
  name: string,
  number: string | number,
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  try {
    const data = await apiRequest<PullRequestViewPayload>(
      `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}/merge`,
      { method: "POST" },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/**
 * Submits one review decision on the current compare revision (REQ-6-3-4).
 * `approved` approves the proposal while `changes-requested` stores the exact
 * summary; the server re-checks the non-author write rule.
 */
export async function submitRepositoryPullRequestReview(
  owner: string,
  name: string,
  number: string | number,
  input: { decision: ReviewDecision; summary: string },
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  try {
    const data = await apiRequest<PullRequestViewPayload>(
      `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}/reviews`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Saves one pending reviewer request of a pull request (REQ-6-4). */
export async function requestRepositoryPullRequestReviewer(
  owner: string,
  name: string,
  number: string | number,
  username: string,
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  try {
    const data = await apiRequest<PullRequestViewPayload>(
      `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}/reviewers`,
      { method: "POST", body: JSON.stringify({ username }) },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** Removes one pending reviewer request without touching any review (REQ-6-4). */
export async function removeRepositoryPullRequestReviewer(
  owner: string,
  name: string,
  number: string | number,
  username: string,
): Promise<CreateResult<PullRequestViewPayload, PullRequestFieldErrors>> {
  try {
    const data = await apiRequest<PullRequestViewPayload>(
      `${repositoryUrl(owner, name)}/pulls/${encodeURIComponent(String(number))}/reviewers/${encodeURIComponent(username)}`,
      { method: "DELETE" },
    );
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** The released tags of one repository, newest first (REQ-4-5). */
export async function fetchRepositoryReleases(
  owner: string,
  name: string,
): Promise<ReleaseListPayload> {
  return apiRequest<ReleaseListPayload>(`${repositoryUrl(owner, name)}/releases`);
}

/** One released tag with its title, description and target branch. */
export async function fetchRepositoryRelease(
  owner: string,
  name: string,
  tag: string,
): Promise<ReleaseViewPayload> {
  return apiRequest<ReleaseViewPayload>(
    `${repositoryUrl(owner, name)}/releases/${encodeURIComponent(tag)}`,
  );
}

/**
 * Publishes one release for an existing branch. The server re-checks the write
 * rule, the target branch and the uniqueness of the tag, so an already used tag
 * only ever comes back as `Tag already exists` and stores no second release.
 */
export async function createRepositoryRelease(
  owner: string,
  name: string,
  input: { tagName: string; title: string; description: string; targetBranch: string },
): Promise<CreateResult<ReleaseViewPayload, ReleaseFieldErrors>> {
  try {
    const data = await apiRequest<ReleaseViewPayload>(`${repositoryUrl(owner, name)}/releases`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, value: data };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

/** The persistent branch protection rules of one repository (REQ-6-1). */
export async function fetchBranchProtectionRules(
  owner: string,
  name: string,
): Promise<{ rules: BranchProtectionRule[]; canManage: boolean }> {
  return apiRequest<{ rules: BranchProtectionRule[]; canManage: boolean }>(
    `${repositoryUrl(owner, name)}/branch-protections`,
  );
}

/** Creates or updates the protection rule of one exact branch. */
export async function saveBranchProtectionRule(
  owner: string,
  name: string,
  input: { branchName: string; requireApprovals: boolean; requireStatusCheck: boolean },
): Promise<CreateResult<BranchProtectionRule, BranchProtectionFieldErrors>> {
  try {
    const data = await apiRequest<{ rule: BranchProtectionRule; rules: BranchProtectionRule[] }>(
      `${repositoryUrl(owner, name)}/branch-protections`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, value: data.rule };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

export async function fetchOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
  const data = await apiRequest<{ members: OrganizationMember[] }>(`${organizationUrl(organizationId)}/people`);
  return data.members;
}

/**
 * The persisted organization actions plus the action values present in them,
 * which is what the "Filter action" combobox offers. The server allows this only
 * to an organization Owner.
 */
export async function fetchOrganizationAuditLog(
  organizationId: string,
): Promise<{ events: OrganizationAuditEvent[]; actions: string[] }> {
  const data = await apiRequest<{ events?: OrganizationAuditEvent[]; actions?: string[] }>(
    `${organizationUrl(organizationId)}/audit-log`,
  );
  return { events: data.events ?? [], actions: data.actions ?? [] };
}

/** An Owner directly adds an existing account; there is no invitation step. */
export async function addOrganizationMember(
  organizationId: string,
  input: { identifier: string; role: string },
): Promise<CreateResult<OrganizationMember, MemberFieldErrors>> {
  try {
    const data = await apiRequest<{ member: OrganizationMember }>(`${organizationUrl(organizationId)}/people`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, value: data.member };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

export async function removeOrganizationMember(
  organizationId: string,
  identifier: string,
): Promise<void> {
  await apiRequest(`${organizationUrl(organizationId)}/people/${encodeURIComponent(identifier)}`, {
    method: "DELETE",
  });
}

const repositoryUrl = (owner: string, name: string) =>
  `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

export async function fetchRepositoryAccess(
  owner: string,
  name: string,
): Promise<{ access: RepositoryAccessEntry[]; candidates: AccessCandidates }> {
  const data = await apiRequest<{ access: RepositoryAccessEntry[]; candidates?: AccessCandidates }>(
    `${repositoryUrl(owner, name)}/access`,
  );
  return { access: data.access, candidates: data.candidates ?? { teams: [], accounts: [] } };
}

export async function addRepositoryAccess(
  owner: string,
  name: string,
  input: { subjectType: "account" | "team"; subjectName: string; role: string },
): Promise<CreateResult<RepositoryAccessEntry, AccessFieldErrors>> {
  try {
    const data = await apiRequest<{ access: RepositoryAccessEntry }>(`${repositoryUrl(owner, name)}/access`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, value: data.access };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

export async function saveRepositoryAccessRole(
  owner: string,
  name: string,
  grantId: string,
  role: string,
): Promise<CreateResult<RepositoryAccessEntry, AccessFieldErrors>> {
  try {
    const data = await apiRequest<{ access: RepositoryAccessEntry }>(
      `${repositoryUrl(owner, name)}/access/${encodeURIComponent(grantId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    );
    return { ok: true, value: data.access };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

export async function fetchOrganizationTeams(organizationId: string): Promise<TeamSummary[]> {
  const data = await apiRequest<{ teams: TeamSummary[] }>(`${organizationUrl(organizationId)}/teams`);
  return data.teams;
}

export async function createTeam(
  organizationId: string,
  name: string,
): Promise<CreateResult<TeamSummary, TeamFieldErrors>> {
  try {
    const data = await apiRequest<{ team: TeamSummary }>(`${organizationUrl(organizationId)}/teams`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return { ok: true, value: data.team };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

export async function fetchTeam(organizationId: string, teamName: string): Promise<TeamSummary> {
  const data = await apiRequest<{ team: TeamSummary }>(teamUrl(organizationId, teamName));
  return data.team;
}

export async function fetchTeamMembers(organizationId: string, teamName: string): Promise<string[]> {
  const data = await apiRequest<{ members: Array<{ username: string }> }>(
    `${teamUrl(organizationId, teamName)}/members`,
  );
  return data.members.map((member) => member.username);
}

export async function addTeamMember(
  organizationId: string,
  teamName: string,
  username: string,
): Promise<CreateResult<string, TeamFieldErrors>> {
  try {
    const data = await apiRequest<{ member: { username: string } }>(
      `${teamUrl(organizationId, teamName)}/members`,
      { method: "POST", body: JSON.stringify({ username }) },
    );
    return { ok: true, value: data.member.username };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}

export async function removeTeamMember(
  organizationId: string,
  teamName: string,
  username: string,
): Promise<void> {
  await apiRequest(`${teamUrl(organizationId, teamName)}/members/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}

export async function saveTeamParent(
  organizationId: string,
  teamName: string,
  parentName: string | null,
): Promise<CreateResult<TeamSummary, TeamFieldErrors>> {
  try {
    const data = await apiRequest<{ team: TeamSummary }>(teamUrl(organizationId, teamName), {
      method: "PATCH",
      body: JSON.stringify({ parentName }),
    });
    return { ok: true, value: data.team };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error), message: messageFrom(error) };
    }
    throw error;
  }
}
