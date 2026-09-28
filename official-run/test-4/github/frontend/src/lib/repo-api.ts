import { ApiError, apiRequest } from "./api";

export type RepoOwnerType = "account" | "organization";

export interface RepoFile {
  path: string;
  content: string;
}

export interface RepoBranch {
  name: string;
  protected: boolean;
}

export interface RepoSource {
  ownerType: RepoOwnerType;
  ownerName: string;
  name: string;
}

export interface RepoDetail {
  ownerType: RepoOwnerType;
  ownerName: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
  currentRole: string | null;
  files: RepoFile[];
  branches: RepoBranch[];
  currentBranch: string;
  commitCount: number;
  source: RepoSource | null;
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

export interface CommitSummary {
  id: string;
  shortId: string;
  parentId: string | null;
  authorAccountId: string | null;
  authorName: string;
  message: string;
  createdAt: string;
  changes: FileChange[];
}

export interface DiffLine {
  type: "context" | "add" | "del";
  text: string;
}

export interface DiffFile extends FileChange {
  lines: DiffLine[];
}

export interface RevisionRef {
  id: string;
  shortId: string;
}

export interface CommitDetail {
  commit: CommitSummary;
  base: RevisionRef | null;
  files: DiffFile[];
}

export interface CompareResult {
  base: RevisionRef;
  compare: RevisionRef;
  files: DiffFile[];
}

export interface CodeMatchLine {
  lineNumber: number;
  text: string;
}

export interface CodeSearchFileResult {
  path: string;
  branch: string;
  matches: CodeMatchLine[];
}

export interface CodeSearchResult {
  query: string;
  branch: string;
  results: CodeSearchFileResult[];
}

export interface BranchFieldErrors {
  name?: string;
  branch?: string;
}

export interface RepoFieldErrors {
  name?: string;
  visibility?: string;
}

export interface CommitFieldErrors {
  path?: string;
  message?: string;
  branch?: string;
}

export interface CreateRepositoryInput {
  ownerType: RepoOwnerType;
  owner: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  initReadme: boolean;
}

export interface ForkInput {
  sourceOwnerType: RepoOwnerType;
  sourceOwner: string;
  sourceRepo: string;
  targetOwnerType: RepoOwnerType;
  targetOwner: string;
  name: string;
  visibility: "public" | "private";
}

export function repoOwnerBase(ownerType: RepoOwnerType, ownerName: string): string {
  const prefix = ownerType === "account" ? "u" : "o";
  return `/${prefix}/${encodeURIComponent(ownerName)}`;
}

export function repoHref(repo: { ownerType: RepoOwnerType; ownerName: string; name: string }): string {
  return `#${repoOwnerBase(repo.ownerType, repo.ownerName)}/repos/${encodeURIComponent(repo.name)}`;
}

/**
 * Hash href of the code browser at `path` on `branch`; omits query values
 * that equal the repository defaults so plain overview links stay stable.
 */
export function treeHref(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  branch: string,
  path?: string,
): string {
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;
  const params = new URLSearchParams();
  if (branch) params.set("branch", branch);
  if (path) params.set("path", path);
  const query = params.toString();
  return `#${base}${query ? `?${query}` : ""}`;
}

export function fileHref(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  branch: string,
  path: string,
): string {
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;
  const segments = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const params = new URLSearchParams();
  if (branch) params.set("branch", branch);
  const query = params.toString();
  return `#${base}/files/${segments}${query ? `?${query}` : ""}`;
}

function apiRepoBase(ownerType: RepoOwnerType, ownerName: string, repoName: string): string {
  const prefix = ownerType === "account" ? "users" : "orgs";
  return `/api/${prefix}/${encodeURIComponent(ownerName)}/repos/${encodeURIComponent(repoName)}`;
}

export async function searchRepositories(query: string): Promise<RepoDetail[]> {
  const body = await apiRequest<{ repositories: RepoDetail[] }>(
    `/api/search/repositories?q=${encodeURIComponent(query)}`,
  );
  return body.repositories;
}

export async function fetchPersonalRepository(
  username: string,
  repo: string,
  branch?: string,
): Promise<RepoDetail> {
  const params = new URLSearchParams();
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const body = await apiRequest<{ repository: RepoDetail }>(
    `/api/users/${encodeURIComponent(username)}/repos/${encodeURIComponent(repo)}${query ? `?${query}` : ""}`,
  );
  return body.repository;
}

export async function listAccountRepositories(username: string): Promise<RepoDetail[]> {
  const body = await apiRequest<{ repositories: RepoDetail[] }>(
    `/api/users/${encodeURIComponent(username)}/repos`,
  );
  return body.repositories;
}

export async function changeRepositoryVisibility(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  visibility: "public" | "private",
): Promise<void> {
  await apiRequest<{ ok: true }>(`${apiRepoBase(ownerType, ownerName, repo)}`, {
    method: "PATCH",
    body: JSON.stringify({ visibility }),
  });
}

/**
 * Stores a new default branch for a repository (REQ-4-3-3). The server
 * validates the session role and that the branch exists; the updated
 * repository detail is returned.
 */
export async function changeDefaultBranch(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  branch: string,
): Promise<RepoDetail> {
  const body = await apiRequest<{ repository: RepoDetail }>(
    `${apiRepoBase(ownerType, ownerName, repo)}/default-branch`,
    { method: "PATCH", body: JSON.stringify({ branch }) },
  );
  return body.repository;
}

export async function fetchCommitHistory(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  branch?: string,
  path?: string,
): Promise<{ commits: CommitSummary[]; branch: string }> {
  const params = new URLSearchParams();
  if (branch) params.set("branch", branch);
  if (path) params.set("path", path);
  const query = params.toString();
  const body = await apiRequest<{ commits: CommitSummary[]; branch: string }>(
    `${apiRepoBase(ownerType, ownerName, repo)}/commits${query ? `?${query}` : ""}`,
  );
  return body;
}

export async function fetchCommitDetail(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  commitId: string,
): Promise<CommitDetail> {
  const body = await apiRequest<CommitDetail>(
    `${apiRepoBase(ownerType, ownerName, repo)}/commits/${encodeURIComponent(commitId)}`,
  );
  return body;
}

export async function fetchCompare(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  base: string,
  compare: string,
  path?: string,
): Promise<CompareResult> {
  const params = new URLSearchParams({ base, compare });
  if (path) params.set("path", path);
  const body = await apiRequest<CompareResult>(
    `${apiRepoBase(ownerType, ownerName, repo)}/compare?${params.toString()}`,
  );
  return body;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  md: "Markdown",
  markdown: "Markdown",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  htm: "HTML",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  c: "C",
  h: "C",
  cpp: "C++",
  hpp: "C++",
  rb: "Ruby",
  php: "PHP",
  sh: "Shell",
  bash: "Shell",
  yml: "YAML",
  yaml: "YAML",
  txt: "Text",
};

/** The display language of a file path, derived from its extension. */
export function fileLanguage(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION[ext] ?? (ext ? `${ext.charAt(0).toUpperCase()}${ext.slice(1)}` : "Text");
}

export async function searchRepositoryCode(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  input: { query: string; branch?: string; path?: string; language?: string },
): Promise<CodeSearchResult> {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.branch) params.set("branch", input.branch);
  if (input.path) params.set("path", input.path);
  if (input.language) params.set("language", input.language);
  const body = await apiRequest<CodeSearchResult>(
    `${apiRepoBase(ownerType, ownerName, repo)}/search?${params.toString()}`,
  );
  return body;
}

export async function createRepositoryBranch(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  name: string,
  baseBranch?: string,
): Promise<{ ok: true; repository: RepoDetail } | { ok: false; errors: BranchFieldErrors }> {
  try {
    const body = await apiRequest<{ repository: RepoDetail }>(
      `${apiRepoBase(ownerType, ownerName, repo)}/branches`,
      { method: "POST", body: JSON.stringify({ name, baseBranch }) },
    );
    return { ok: true, repository: body.repository };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function createFileCommit(
  ownerType: RepoOwnerType,
  ownerName: string,
  repo: string,
  input: { branch: string; path: string; content: string; message: string },
): Promise<{ ok: true; repository: RepoDetail } | { ok: false; errors: CommitFieldErrors }> {
  try {
    const body = await apiRequest<{ repository: RepoDetail }>(
      `${apiRepoBase(ownerType, ownerName, repo)}/files`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, repository: body.repository };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function createRepository(
  input: CreateRepositoryInput,
): Promise<{ ok: true; repository: RepoDetail } | { ok: false; errors: RepoFieldErrors }> {
  try {
    const body = await apiRequest<{ repository: RepoDetail }>("/api/repositories", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, repository: body.repository };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function createFork(
  input: ForkInput,
): Promise<{ ok: true; repository: RepoDetail } | { ok: false; errors: RepoFieldErrors }> {
  try {
    const body = await apiRequest<{ repository: RepoDetail }>("/api/forks", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, repository: body.repository };
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
