import { apiRequest } from "./api";
import type { RepositoryVisibility } from "./organizations-api";
import type { RepositoryRecord, RepositorySource } from "./repositories-api";

export type RepositoryEntryType = "file" | "directory";

export interface RepositoryEntry {
  name: string;
  /** Repository-relative path of the entry. */
  path: string;
  type: RepositoryEntryType;
}

/** A repository role, as stored by the grant model. */
export type RepositoryRole = "read" | "triage" | "write" | "maintain" | "admin";

/** The repository fields every Code read returns. */
export interface RepositoryCodeIdentity {
  owner: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  defaultBranch: string | null;
  /**
   * The effective role of the reader on this repository, or null for a visitor
   * without one. Write, Maintain and Admin may create branches and commit
   * files; Read and Triage may only browse.
   */
  viewerRole?: RepositoryRole | null;
  /** Present only for a fork: the repository it was copied from. */
  source?: RepositorySource | null;
}

/** True when the role may write to repository code (branch or file). */
export function canWriteRepositoryRole(role: RepositoryRole | null | undefined): boolean {
  return role === "write" || role === "maintain" || role === "admin";
}

export interface RepositoryTree {
  repository: RepositoryCodeIdentity;
  branch: string;
  path: string;
  branches: string[];
  /** Number of commits of the branch shown by the `Commits` link. */
  commitCount?: number;
  entries: RepositoryEntry[];
}

export interface RepositoryCommitSummary {
  id: string;
  sha: string;
  shortSha?: string;
  message: string;
  author: string | null;
  createdAt: string;
}

export interface RepositoryBlob {
  repository: RepositoryCodeIdentity;
  branch: string;
  branches: string[];
  path: string;
  content: string;
  /** Number of commits that changed this path on the branch. */
  commitCount?: number;
  commit: RepositoryCommitSummary;
}

/** One history row of a branch or of one file path. */
export interface RepositoryHistoryEntry extends RepositoryCommitSummary {
  parentId: string | null;
  parentSha: string | null;
  parentMessage: string | null;
  changedFiles: string[];
}

export interface RepositoryHistory {
  repository: RepositoryCodeIdentity;
  branch: string;
  branches: string[];
  path: string;
  commitCount: number;
  commits: RepositoryHistoryEntry[];
}

export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "removed";
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface CompareRevisionOption {
  value: string;
  label: string;
}

/** Two compared revisions with their changed files and line detail. */
export interface RepositoryComparison {
  repository: RepositoryCodeIdentity;
  branch: string;
  branches: string[];
  base: RepositoryCommitSummary | null;
  compare: RepositoryCommitSummary;
  path: string;
  files: DiffFile[];
  changedFileCount: number;
  additions: number;
  deletions: number;
  revisions: CompareRevisionOption[];
}

/** A single commit entry together with the diff against its parent. */
export interface RepositoryCommitView {
  repository: RepositoryCodeIdentity;
  branch: string;
  branches: string[];
  commit: RepositoryHistoryEntry;
  comparison: RepositoryComparison;
}

export interface RepositoryCodeSearchResult {
  name: string;
  path: string;
  branch: string;
  language: string;
  line: number;
  snippet: string;
}

export interface RepositoryCodeSearch {
  repository: RepositoryCodeIdentity;
  branch: string;
  branches: string[];
  query: string;
  path: string;
  language: string;
  languages: string[];
  results: RepositoryCodeSearchResult[];
}

export interface RepositoryCodeQuery {
  branch?: string;
  path?: string;
  q?: string;
  language?: string;
  base?: string;
  compare?: string;
}

/** One branch of a repository: its name and the commit it points at. */
export interface RepositoryBranch {
  id: string;
  name: string;
  commitId: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

/**
 * One branch protection rule: a persistent merge restriction bound to one
 * exact branch name, with the readable summaries of its enabled requirements.
 */
export interface RepositoryBranchProtectionRule {
  id: string;
  /** The exact branch name, stored verbatim and without wildcard semantics. */
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
  /** The visible summaries, e.g. `1 approval` and `Require status check test`. */
  requirements: string[];
  updatedBy?: string | null;
  updatedAt?: string | null;
}

/** The branch settings page payload. */
export interface RepositoryBranchSettings {
  repository: RepositoryRecord;
  branches: string[];
  canAdminister: boolean;
  canWrite: boolean;
  /** The stored rules of this repository; every reader sees them verbatim. */
  branchProtectionRules: RepositoryBranchProtectionRule[];
}

/** The result of committing one file change to a branch. */
export interface RepositoryFileCommit {
  commit: {
    id: string;
    sha: string;
    shortSha?: string;
    message: string;
    author?: string | null;
    parentId: string | null;
    createdAt: string;
  };
  branch: string;
  path: string;
}

export interface BranchWriteBody {
  name: string;
  /** The branch whose head becomes the base commit; defaults to the default branch. */
  base?: string;
}

export interface FileWriteBody {
  branch: string;
  path: string;
  content: string;
  message: string;
  /** The path the editor started from, when an existing file is renamed. */
  previousPath?: string;
}

function codeQuery(options: RepositoryCodeQuery): string {
  const params = new URLSearchParams();
  for (const key of ["branch", "path", "q", "language", "base", "compare"] as const) {
    const value = options[key];
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function codePath(owner: string, name: string, section: string): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${section}`;
}

export async function fetchRepositoryTree(
  owner: string,
  name: string,
  options: RepositoryCodeQuery = {},
): Promise<RepositoryTree> {
  return apiRequest<RepositoryTree>(`${codePath(owner, name, "tree")}${codeQuery(options)}`);
}

export async function fetchRepositoryBlob(
  owner: string,
  name: string,
  options: RepositoryCodeQuery = {},
): Promise<RepositoryBlob> {
  return apiRequest<RepositoryBlob>(`${codePath(owner, name, "blob")}${codeQuery(options)}`);
}

export async function fetchRepositoryHistory(
  owner: string,
  name: string,
  options: RepositoryCodeQuery = {},
): Promise<RepositoryHistory> {
  return apiRequest<RepositoryHistory>(`${codePath(owner, name, "commits")}${codeQuery(options)}`);
}

export async function fetchRepositoryCommit(
  owner: string,
  name: string,
  revision: string,
  options: RepositoryCodeQuery = {},
): Promise<RepositoryCommitView> {
  const path = `${codePath(owner, name, "commits")}/${encodeURIComponent(revision)}`;
  return apiRequest<RepositoryCommitView>(`${path}${codeQuery(options)}`);
}

export async function fetchRepositoryComparison(
  owner: string,
  name: string,
  options: RepositoryCodeQuery = {},
): Promise<RepositoryComparison> {
  return apiRequest<RepositoryComparison>(`${codePath(owner, name, "compare")}${codeQuery(options)}`);
}

export async function searchRepositoryCode(
  owner: string,
  name: string,
  options: RepositoryCodeQuery = {},
): Promise<RepositoryCodeSearch> {
  return apiRequest<RepositoryCodeSearch>(`${codePath(owner, name, "search")}${codeQuery(options)}`);
}

/** Creates a branch pointing at the base branch head. */
export async function createRepositoryBranch(
  owner: string,
  name: string,
  body: BranchWriteBody,
): Promise<{ branch: RepositoryBranch; branches: string[] }> {
  return apiRequest(`${codePath(owner, name, "branches")}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Reads the stored branches and the default branch setting. */
export async function fetchRepositoryBranchSettings(
  owner: string,
  name: string,
): Promise<RepositoryBranchSettings> {
  return apiRequest(`${codePath(owner, name, "settings/branches")}`);
}

/** Stores a new default branch (repository Admins only). */
export async function updateRepositoryDefaultBranch(
  owner: string,
  name: string,
  defaultBranch: string,
): Promise<{ repository: RepositoryRecord }> {
  return apiRequest(`${codePath(owner, name, "settings/branches")}`, {
    method: "POST",
    body: JSON.stringify({ defaultBranch }),
  });
}

/**
 * Stores one branch protection rule (create or save changes). The branch name
 * is submitted verbatim; saving an existing name replaces the two toggles of
 * that rule. Only a repository Admin may do this.
 */
export async function saveBranchProtectionRule(
  owner: string,
  name: string,
  input: { branchName: string; requireApproval: boolean; requireStatusCheck: boolean },
): Promise<{ branchProtectionRules: RepositoryBranchProtectionRule[] }> {
  return apiRequest(`${codePath(owner, name, "settings/branches/protection")}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Commits one file change (create, edit or rename) to the target branch. */
export async function commitRepositoryFile(
  owner: string,
  name: string,
  body: FileWriteBody,
): Promise<RepositoryFileCommit> {
  return apiRequest(`${codePath(owner, name, "files")}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function encodeSegments(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function repositoryPrefix(owner: string, name: string): string {
  return `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** Hash address of a repository entry or of the repository Code root. */
export function repositoryCodeHref(
  owner: string,
  name: string,
  kind: "tree" | "blob",
  branch: string,
  path: string,
  options: { line?: number } = {},
): string {
  const encodedPath = encodeSegments(path);
  const base = `${repositoryPrefix(owner, name)}/${kind}/${encodeURIComponent(branch)}`;
  const href = encodedPath.length > 0 ? `${base}/${encodedPath}` : base;
  return options.line === undefined ? href : `${href}?line=${options.line}`;
}

/** Hash address of the branch history, or of one file path's history. */
export function repositoryCommitsHref(
  owner: string,
  name: string,
  options: { branch?: string; path?: string } = {},
): string {
  return `${repositoryPrefix(owner, name)}/commits${codeQuery(options)}`;
}

/** Hash address of one commit entry, optionally scoped to one changed file. */
export function repositoryCommitHref(
  owner: string,
  name: string,
  revision: string,
  options: { path?: string } = {},
): string {
  return `${repositoryPrefix(owner, name)}/commit/${encodeURIComponent(revision)}${codeQuery(options)}`;
}

/** Hash address of the comparison page. */
export function repositoryCompareHref(
  owner: string,
  name: string,
  options: { branch?: string; base?: string; compare?: string; path?: string } = {},
): string {
  return `${repositoryPrefix(owner, name)}/compare${codeQuery(options)}`;
}

/** Hash address of the in-repository code search results. */
export function repositoryCodeSearchHref(
  owner: string,
  name: string,
  options: { branch?: string; q?: string; path?: string; language?: string } = {},
): string {
  return `${repositoryPrefix(owner, name)}/search${codeQuery(options)}`;
}

export function repositoryHref(owner: string, name: string): string {
  return `#${repositoryPath(owner, name)}`;
}

/** Hash-router path of a repository overview, without the leading `#`. */
export function repositoryPath(owner: string, name: string): string {
  return `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** The repository an address inside the `/repositories/:owner/:name` space opens. */
export function repositoryScopeFromPath(path: string): { owner: string; name: string } | null {
  const match = /^\/repositories\/([^/]+)\/([^/]+)(?:\/.*)?$/.exec(path);
  if (!match) return null;
  const owner = decodeURIComponent(match[1]);
  const name = decodeURIComponent(match[2]);
  if (owner.length === 0 || name.length === 0) return null;
  return { owner, name };
}

export function repositorySettingsHref(owner: string, name: string): string {
  return `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/settings`;
}

/** The `Branches` panel of the repository settings. */
export function repositorySettingsBranchesHref(owner: string, name: string): string {
  return `${repositorySettingsHref(owner, name)}/branches`;
}

/** The file editor address: `path` empty opens the new-file form. */
export function repositoryFileEditorHref(
  owner: string,
  name: string,
  branch: string,
  path = "",
): string {
  const base = `${repositoryPrefix(owner, name)}/edit/${encodeURIComponent(branch)}`;
  const encodedPath = encodeSegments(path);
  return encodedPath.length > 0 ? `${base}/${encodedPath}` : base;
}

/** The General settings panel that holds the Danger Zone. */
export function repositorySettingsGeneralHref(owner: string, name: string): string {
  return `${repositorySettingsHref(owner, name)}/general`;
}

/** The Manage access settings panel. */
export function repositorySettingsAccessHref(owner: string, name: string): string {
  return `${repositorySettingsHref(owner, name)}/access`;
}

export function repositoryIssuesHref(owner: string, name: string): string {
  return `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`;
}

export function repositoryPullRequestsHref(owner: string, name: string): string {
  return `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
}

/** Splits an encoded `*path` hash segment into its decoded path segments. */
export function decodePathSegments(value: string): string[] {
  return value
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}
