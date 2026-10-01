import { apiRequest, mutateJson, mutateJsonSync, type MutationOutcome } from "../../lib/api";

/**
 * Typed client for the repository surface: the overview and default-branch
 * content (REQ-3-3), repository search (REQ-3-1), the namespace lists a
 * repository address belongs to, and the creation, fork and visibility writes
 * of REQ-3-2-1 / REQ-3-2-2 / REQ-3-4.
 */

export interface RepositoryFileEntry {
  path: string;
  updatedAt?: string | null;
}

export interface RepositoryDirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface RepositoryCloneUrls {
  https: string;
  ssh: string;
}

export interface RepositorySummary {
  name: string;
  owner: string;
  /** Whether the namespace is an organization or an individual account. */
  ownerType?: "organization" | "account";
  /** How the owner is known to people (organization display name or username). */
  ownerDisplayName?: string;
  fullName: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type RepositoryRole = "Read" | "Triage" | "Write" | "Maintain" | "Admin";

/** The source repository of a fork (REQ-3-2-2). */
export interface RepositoryForkSource {
  owner: string;
  name: string;
  fullName: string;
}

/** One commit of a branch (REQ-3-2-1 initialization, REQ-4 history). */
export interface RepositoryCommit {
  id: string;
  message: string;
  author: string;
  branch: string;
  parentId: string | null;
  createdAt: string | null;
  files: Array<{ path: string; change: string }>;
}

/** A branch of a repository: a named reference to one commit (REQ-4/REQ-4-1). */
export interface RepositoryBranch {
  name: string;
  protected?: boolean;
}

/**
 * A branch protection rule (REQ-6-1): a merge restriction bound to one exact
 * branch name with its two independently selectable requirements.
 */
export interface BranchProtectionRule {
  id: string;
  pattern: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface RepositoryOverview extends RepositorySummary {
  /** The role the current caller holds, or null without access. */
  viewerRole?: RepositoryRole | null;
  /** True when the caller may change the repository visibility (REQ-3-4). */
  canChangeVisibility?: boolean;
  /** True when the caller may change the default branch (REQ-4-3-3, Admin only). */
  canChangeDefaultBranch?: boolean;
  /** True when the caller may submit a file change on the Code page (REQ-4-4). */
  canWrite?: boolean;
  /** The source repository when this repository is a fork. */
  forkedFrom?: RepositoryForkSource | null;
  /** The branches of the repository, the default branch first (REQ-4-1). */
  branches: RepositoryBranch[];
  /** The stored branch protection rules of the repository (REQ-6-1). */
  protectionRules: BranchProtectionRule[];
  /** True when the caller may create or change a branch protection rule. */
  canManageBranchProtection: boolean;
  files: RepositoryFileEntry[];
  entries: RepositoryDirectoryEntry[];
  cloneUrls: RepositoryCloneUrls;
}

export interface RepositoryFileContent {
  path: string;
  content: string;
  branch: string;
  updatedAt?: string | null;
  /** The most recent commit of this branch that changed the file (REQ-4-1). */
  lastCommit?: RepositoryCommit | null;
}

/** One line of a line-by-line comparison (REQ-4-2-2). */
export interface RepositoryDiffLine {
  type: "context" | "added" | "removed";
  text: string;
}

/** One changed file of a comparison; an unchanged file never appears. */
export interface RepositoryFileDiff {
  path: string;
  change: "added" | "modified" | "removed";
  additions: number;
  deletions: number;
  lines: RepositoryDiffLine[];
}

/** The totals a comparison page spells next to its file list. */
export interface RepositoryDiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
}

/** One side of a comparison: the commit a revision points to. */
export interface RepositoryRevisionRef {
  ref: string | null;
  type?: "commit" | "branch" | "empty" | string;
  branch?: string | null;
  commit?: RepositoryCommit | null;
}

/** The read model of a commit or revision comparison (REQ-4-2-2). */
export interface RepositoryComparison {
  base: RepositoryRevisionRef;
  compare: RepositoryRevisionRef;
  summary: RepositoryDiffSummary;
  files: RepositoryFileDiff[];
  /** The commits the compare revision carries that the base does not. */
  commits: RepositoryCommit[];
}

/** A selectable revision of the comparison page. */
export interface RepositoryRevisionOption {
  value: string;
  label: string;
  type: "commit" | "branch" | string;
}

/** The commit history of a branch or of one file of that branch (REQ-4-2-1). */
export interface RepositoryHistory {
  branch: string;
  branches: string[];
  path: string;
  /** The stored file paths of the branch, offered as history scopes. */
  files: string[];
  commits: RepositoryCommit[];
}

/** One matching file of a repository code search (REQ-4-2-3). */
export interface RepositoryCodeSearchMatch {
  path: string;
  name: string;
  branch: string;
  language?: string;
  matches: number;
  lines: Array<{ number: number; text: string }>;
  snippet: string;
}

export interface RepositoryCodeSearchResult {
  repository: RepositorySummary;
  query: string;
  path: string;
  language: string;
  languages: string[];
  results: RepositoryCodeSearchMatch[];
}

export interface RepositoryDirectoryContent {
  branch: string;
  path: string;
  entries: RepositoryDirectoryEntry[];
}

export interface NamespaceDetail {
  namespace: { type: "organization" | "account"; name: string; displayName: string };
  repositories: RepositorySummary[];
}

function normalizeSummary(value: Partial<RepositorySummary>): RepositorySummary {
  const name = String(value.name ?? "");
  const owner = String(value.owner ?? "");
  const ownerDisplayName = value.ownerDisplayName ?? owner;
  return {
    name,
    owner,
    ownerType: value.ownerType ?? "account",
    ownerDisplayName,
    fullName: value.fullName ?? `${ownerDisplayName}/${name}`,
    description: value.description ?? "",
    visibility: value.visibility === "private" ? "private" : "public",
    defaultBranch: value.defaultBranch ?? "main",
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function normalizeCloneUrls(value: Partial<RepositoryCloneUrls> | undefined, fullName: string): RepositoryCloneUrls {
  return {
    https: value?.https ?? `https://github.local/${fullName}.git`,
    ssh: value?.ssh ?? `git@github.local:${fullName}.git`,
  };
}

function normalizeOverview(value: Partial<RepositoryOverview> | undefined): RepositoryOverview {
  const summary = normalizeSummary(value ?? {});
  return {
    ...summary,
    viewerRole: value?.viewerRole ?? null,
    canChangeVisibility: value?.canChangeVisibility === true,
    canChangeDefaultBranch: value?.canChangeDefaultBranch === true,
    canWrite: value?.canWrite === true,
    forkedFrom: value?.forkedFrom ?? null,
    branches: (value?.branches ?? []).map((branch) => ({ name: branch.name, protected: branch.protected === true })),
    protectionRules: (value?.protectionRules ?? []).map((rule) => ({
      id: rule.id ?? "",
      pattern: rule.pattern ?? "",
      requireApproval: rule.requireApproval === true,
      requireStatusCheck: rule.requireStatusCheck === true,
      createdAt: rule.createdAt ?? null,
      createdBy: rule.createdBy ?? null,
      updatedAt: rule.updatedAt ?? null,
      updatedBy: rule.updatedBy ?? null,
    })),
    canManageBranchProtection: value?.canManageBranchProtection === true,
    files: value?.files ?? [],
    entries: value?.entries ?? [],
    cloneUrls: normalizeCloneUrls(value?.cloneUrls, summary.fullName),
  };
}

/** The repository overview: identity, default branch, files and clone values. */
export async function fetchRepositoryOverview(owner: string, name: string): Promise<RepositoryOverview> {
  const payload = await apiRequest<{ repository: Partial<RepositoryOverview> }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  );
  return normalizeOverview(payload.repository);
}

/**
 * The stored commit history of a branch, newest first (REQ-4-2-1). A `path`
 * narrows the history to the commits that modified that file of the branch.
 */
export async function fetchRepositoryCommits(
  owner: string,
  name: string,
  options: { branch?: string; path?: string } = {},
): Promise<RepositoryHistory> {
  const params = new URLSearchParams();
  if (options.branch) params.set("branch", options.branch);
  if (options.path) params.set("path", options.path);
  const query = params.toString();
  const payload = await apiRequest<Partial<RepositoryHistory>>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits${query ? `?${query}` : ""}`,
  );
  return {
    branch: payload.branch ?? "main",
    branches: payload.branches ?? [],
    path: payload.path ?? "",
    files: payload.files ?? [],
    commits: payload.commits ?? [],
  };
}

function normalizeComparison(payload: Partial<RepositoryComparison>): RepositoryComparison {
  return {
    base: payload.base ?? { ref: null, type: "empty", commit: null },
    compare: payload.compare ?? { ref: null, type: "commit", commit: null },
    summary: payload.summary ?? { filesChanged: 0, additions: 0, deletions: 0 },
    files: payload.files ?? [],
    commits: payload.commits ?? [],
  };
}

/**
 * One stored commit compared against its parent revision (REQ-4-2-2). The
 * commit entry can be opened directly, without walking through history first.
 */
export async function fetchRepositoryCommit(
  owner: string,
  name: string,
  commitId: string,
): Promise<RepositoryComparison & { branch: string | null; commit: RepositoryCommit }> {
  const payload = await apiRequest<Partial<RepositoryComparison> & { branch?: string; commit?: RepositoryCommit }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(commitId)}`,
  );
  return {
    ...normalizeComparison(payload),
    branch: payload.branch ?? null,
    commit: payload.commit ?? { id: commitId, message: "", author: "", branch: "", parentId: null, createdAt: null, files: [] },
  };
}

/** The selectable revisions of the comparison page (REQ-4-2-2). */
export async function fetchRepositoryRevisions(
  owner: string,
  name: string,
): Promise<{ branch: string; branches: string[]; revisions: RepositoryRevisionOption[] }> {
  const payload = await apiRequest<{
    branch?: string;
    branches?: string[];
    revisions?: RepositoryRevisionOption[];
  }>(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/revisions`);
  return {
    branch: payload.branch ?? "main",
    branches: payload.branches ?? [],
    revisions: payload.revisions ?? [],
  };
}

/** Two readable revisions compared line by line (REQ-4-2-2). */
export async function fetchRepositoryComparison(
  owner: string,
  name: string,
  base: string,
  compare: string,
): Promise<RepositoryComparison> {
  const params = new URLSearchParams({ base, compare });
  const payload = await apiRequest<Partial<RepositoryComparison>>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare?${params.toString()}`,
  );
  return normalizeComparison(payload);
}

/**
 * The files of one repository whose content matches a code query (REQ-4-2-3).
 * The response only ever carries content of this repository.
 */
export async function searchRepositoryCode(
  owner: string,
  name: string,
  options: { query: string; path?: string; language?: string },
): Promise<RepositoryCodeSearchResult> {
  const params = new URLSearchParams();
  if (options.query) params.set("q", options.query);
  if (options.path) params.set("path", options.path);
  if (options.language) params.set("language", options.language);
  const query = params.toString();
  const payload = await apiRequest<Partial<RepositoryCodeSearchResult>>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/code-search${query ? `?${query}` : ""}`,
  );
  return {
    repository: normalizeSummary(payload.repository ?? {}),
    query: payload.query ?? options.query,
    path: payload.path ?? options.path ?? "",
    language: payload.language ?? options.language ?? "",
    languages: payload.languages ?? [],
    results: payload.results ?? [],
  };
}

function overviewOutcome(result: MutationOutcome<{ repository: Partial<RepositoryOverview> }>):
MutationOutcome<RepositoryOverview> {
  if (!result.ok) return result;
  return { ok: true, data: normalizeOverview(result.data.repository) };
}

/** Creates a repository in the selected owner namespace (REQ-3-2-1). */
export async function createRepository(input: {
  owner: string;
  name: string;
  description?: string;
  visibility: "public" | "private";
  initialize: boolean;
}): Promise<MutationOutcome<RepositoryOverview>> {
  return overviewOutcome(await mutateJson<{ repository: Partial<RepositoryOverview> }>(
    "/api/repositories",
    { method: "POST", body: JSON.stringify(input) },
  ));
}

/**
 * Creates one named branch reference at a base revision (REQ-4-3-2). The base
 * defaults to the branch head of the current page; the server refuses an
 * invalid name, a duplicate name, an unknown base and a caller without Write
 * permission, and answers with the refreshed overview.
 */
export async function createRepositoryBranch(
  owner: string,
  name: string,
  input: { name: string; base?: string },
): Promise<MutationOutcome<RepositoryOverview>> {
  return overviewOutcome(await mutateJson<{ repository: Partial<RepositoryOverview> }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`,
    { method: "POST", body: JSON.stringify(input) },
  ));
}

/**
 * Creates or updates the branch protection rule of one exact branch name
 * (REQ-6-1). Only a repository Admin may save it; the server refuses every
 * other caller and answers with the refreshed overview, which spells the stored
 * branch name and its requirements.
 */
export async function saveBranchProtectionRule(
  owner: string,
  name: string,
  input: { pattern: string; requireApproval: boolean; requireStatusCheck: boolean },
): Promise<MutationOutcome<RepositoryOverview>> {
  return overviewOutcome(await mutateJson<{ repository: Partial<RepositoryOverview> }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/protection-rules`,
    { method: "POST", body: JSON.stringify(input) },
  ));
}

/** Moves the default branch of a repository the caller administers (REQ-4-3-3). */
export async function changeRepositoryDefaultBranch(
  owner: string,
  name: string,
  input: { branch: string },
): Promise<MutationOutcome<RepositoryOverview>> {
  return overviewOutcome(await mutateJson<{ repository: Partial<RepositoryOverview> }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/default-branch`,
    { method: "POST", body: JSON.stringify(input) },
  ));
}

/** Copies a readable repository into another namespace (REQ-3-2-2). */
export async function forkRepository(
  owner: string,
  name: string,
  input: { owner: string; name?: string; visibility: "public" | "private" },
): Promise<MutationOutcome<RepositoryOverview>> {
  return overviewOutcome(await mutateJson<{ repository: Partial<RepositoryOverview> }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/forks`,
    { method: "POST", body: JSON.stringify(input) },
  ));
}

/** Applies a visibility change to a repository the caller administers (REQ-3-4). */
export async function changeRepositoryVisibility(
  owner: string,
  name: string,
  input: { visibility: "public" | "private"; confirmation?: string },
): Promise<MutationOutcome<RepositoryOverview>> {
  return overviewOutcome(await mutateJson<{ repository: Partial<RepositoryOverview> }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/visibility`,
    { method: "POST", body: JSON.stringify(input) },
  ));
}

/** The stored content of a branch at a path — a file or a directory (REQ-4-1). */
export async function fetchRepositoryContents(
  owner: string,
  name: string,
  path: string,
  branch?: string,
): Promise<{
  file: RepositoryFileContent | null;
  directory: RepositoryDirectoryContent | null;
  /** The number of commits of the branch, shown next to the history link. */
  commitCount: number;
}> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const payload = await apiRequest<{
    branch?: string;
    path?: string;
    commitCount?: number;
    entries?: RepositoryDirectoryEntry[];
    file?: RepositoryFileContent;
  }>(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents${query ? `?${query}` : ""}`);
  const resolvedBranch = payload.branch ?? branch ?? "main";
  const commitCount = payload.commitCount ?? 0;
  if (payload.file) {
    return {
      file: { ...payload.file, branch: payload.file.branch ?? resolvedBranch, lastCommit: payload.file.lastCommit ?? null },
      directory: null,
      commitCount,
    };
  }
  return {
    file: null,
    directory: {
      branch: resolvedBranch,
      path: payload.path ?? "",
      entries: payload.entries ?? [],
    },
    commitCount,
  };
}

/**
 * Submits one file change through the Code page editor (REQ-4-4): the server
 * stores the content, message, author, parent commit and target branch as one
 * commit and moves the branch to it. A rejected submit returns the field
 * messages verbatim, so the page can display the reason next to the input. The
 * submit is blocking, so the stored file address is already active when the
 * handler returns and an immediate reload reads the new file instead of the
 * editor.
 */
export function commitRepositoryFile(
  owner: string,
  name: string,
  input: {
    branch: string;
    path: string;
    content: string;
    message: string;
    create: boolean;
    originalPath?: string;
  },
): MutationOutcome<{ branch: string; path: string; file: RepositoryFileContent | null; commit: RepositoryCommit | null }> {
  return mutateJsonSync(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents`, input);
}

/** Repositories whose name matches the query and that the caller may view. */
export async function searchRepositories(query: string): Promise<RepositorySummary[]> {
  const payload = await apiRequest<{ repositories: RepositorySummary[] }>(
    `/api/search/repositories?q=${encodeURIComponent(query)}`,
  );
  return (payload.repositories ?? []).map(normalizeSummary);
}

/**
 * Every repository the caller may read, whatever its namespace (REQ-3). The
 * home page and the signed-in workspace list these, so a repository is also
 * reachable from a repository list and not only from search or a direct
 * address; a visitor only ever receives the public ones.
 */
export async function fetchReadableRepositories(): Promise<RepositorySummary[]> {
  const payload = await apiRequest<{ repositories?: RepositorySummary[] }>("/api/repositories");
  return (payload.repositories ?? []).map(normalizeSummary);
}

/** The namespace (organization or account) a repository address belongs to. */
export async function fetchNamespace(name: string): Promise<NamespaceDetail> {
  const payload = await apiRequest<NamespaceDetail>(`/api/namespaces/${encodeURIComponent(name)}`);
  return {
    namespace: payload.namespace,
    repositories: (payload.repositories ?? []).map(normalizeSummary),
  };
}
