import { ApiError, apiRequest } from "./api";

export type RepositoryVisibility = "public" | "private";
export type RepositoryRole = "read" | "triage" | "write" | "maintain" | "admin";

export interface RepositoryOwner {
  type: "user" | "organization";
  login: string;
}

/** The viewer's effective role, computed by the server for the current session. */
export interface RepositoryPermissions {
  role: RepositoryRole | null;
  canAdminister: boolean;
}

/** Source repository of a fork, stored on the fork itself. */
export interface RepositoryForkSource {
  id: string;
  owner: string;
  name: string;
  fullName: string;
}

export interface RepositorySummary {
  id: string;
  name: string;
  fullName: string;
  /** Display label of the owner: an organization by its display name, an account by its login. */
  ownerDisplayName?: string;
  owner: RepositoryOwner;
  visibility: RepositoryVisibility;
  description: string;
  defaultBranch: string;
  updatedAt: string;
  forkedFrom?: RepositoryForkSource | null;
}

export interface RepositoryEntry {
  type: "file" | "dir";
  name: string;
  path: string;
}

export interface RepositoryBranch {
  name: string;
  headCommitId: string | null;
}

export interface RepositoryOverview extends RepositorySummary {
  branch: string;
  branches?: RepositoryBranch[];
  /** Directory path of the current view ("" is the branch root). */
  path?: string;
  entries: RepositoryEntry[];
  commits?: RepositoryCommit[];
  permissions?: RepositoryPermissions;
}

/** Repository identity plus the branch context a code view displays. */
export interface RepositoryContext extends RepositorySummary {
  branch: string;
  branches?: RepositoryBranch[];
  permissions?: RepositoryPermissions;
}

export interface RepositoryCommit {
  id: string;
  shortId?: string;
  message: string;
  author: string;
  createdAt: string;
  parentId?: string | null;
  parentShortId?: string | null;
  changedFiles?: string[];
}

/** A revision named by a branch or by a commit identifier. */
export interface RevisionReference {
  id: string | null;
  shortId: string | null;
  ref: string;
  kind: "branch" | "commit" | "root";
}

export interface DiffLine {
  kind: "context" | "add" | "remove";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface ChangedFile {
  path: string;
  name: string;
  changeType: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  diff: DiffLine[];
}

export interface CommitDetail {
  id: string;
  shortId: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  parent: { id: string; shortId: string; message: string; author: string; createdAt: string } | null;
  base: RevisionReference;
  compare: RevisionReference;
  changedFiles: ChangedFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
  /** Set when the commit view is limited to one changed file. */
  path?: string;
}

export interface RepositoryFile {
  path: string;
  name: string;
  branch: string;
  content: string;
  commit: RepositoryCommit | null;
}

export interface CodeSearchResult {
  path: string;
  name: string;
  branch: string;
  line: number;
  snippet: string;
  matches: number;
  /** Repository the matching content was read from. */
  repository: { owner: string; name: string; fullName: string };
}

export interface CodeSearchResults {
  query: string;
  type: string;
  repository: (RepositorySummary & { branch: string | null }) | null;
  results: CodeSearchResult[];
}

export interface RepositorySearchResults {
  query: string;
  type: string;
  repositories: RepositorySummary[];
}

export interface RepositoryFilePayload {
  repository: RepositoryContext;
  file: RepositoryFile;
}

export interface RepositoryCommitsPayload {
  repository: RepositoryContext;
  branch: string;
  path: string;
  /** Every file path of the branch, for choosing a file history scope. */
  files: string[];
  commits: RepositoryCommit[];
}

export interface RepositoryCommitPayload {
  repository: RepositoryContext;
  commit: CommitDetail;
}

export interface RepositoryComparisonPayload {
  repository: RepositoryContext;
  base: RevisionReference;
  compare: RevisionReference;
  changedFiles: ChangedFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
}

export function repositoryVisibilityLabel(visibility: RepositoryVisibility): string {
  return visibility === "private" ? "Private" : "Public";
}

/**
 * Heading label of a repository page: a repository owned by an organization
 * reads "organization name/repository name" (its display name), while an
 * account-owned repository keeps its `owner/name` identifier form.
 */
export function repositoryTitle(repository: {
  name: string;
  fullName: string;
  ownerDisplayName?: string;
}): string {
  return repository.ownerDisplayName
    ? `${repository.ownerDisplayName}/${repository.name}`
    : repository.fullName;
}

/**
 * Clone values shown by the Code popover. They identify the current repository
 * and use the origin served to this browser, so no host or port is baked into
 * the build: HTTPS keeps the https scheme, SSH the `git@host:owner/name.git`
 * form with the colon and the `.git` suffix.
 */
export function repositoryCloneUrls(
  owner: string,
  name: string,
  host?: string,
): { https: string; ssh: string } {
  const origin = (host ?? (typeof window === "undefined" ? "" : window.location.host)) || "localhost";
  const hostname = origin.split(":")[0];
  const path = `${owner}/${name}`;
  return { https: `https://${origin}/${path}.git`, ssh: `git@${hostname}:${path}.git` };
}

/** Global search: repository results by default, filtered by the current viewer. */
export function searchRepositories(query: string, type: string): Promise<RepositorySearchResults> {
  const params = new URLSearchParams({ q: query, type });
  return apiRequest<RepositorySearchResults>(`/api/search?${params.toString()}`);
}

export async function fetchRepositoryOverview(
  owner: string,
  name: string,
  branch?: string,
  path?: string,
): Promise<RepositoryOverview> {
  const params = new URLSearchParams();
  if (branch) params.set("branch", branch);
  if (path) params.set("path", path);
  const query = params.toString();
  const payload = await apiRequest<{ repository: RepositoryOverview }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${query ? `?${query}` : ""}`,
  );
  return payload.repository;
}

export function fetchRepositoryFile(
  owner: string,
  name: string,
  branch: string,
  path: string,
): Promise<RepositoryFilePayload> {
  const params = new URLSearchParams({ branch, path });
  return apiRequest<RepositoryFilePayload>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file?${params.toString()}`,
  );
}

/**
 * Repository context carried by the answer for a file that does not exist on a
 * readable branch, so the file page can show it as absent there.
 */
export function missingFileContext(error: unknown): RepositoryContext | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { repository?: RepositoryContext } | null;
  return body?.repository ?? null;
}

/** Commit history of one branch, or of one file path (REQ-4-2-1). */
export function fetchRepositoryCommits(
  owner: string,
  name: string,
  branch: string,
  path = "",
): Promise<RepositoryCommitsPayload> {
  const params = new URLSearchParams();
  if (branch) params.set("branch", branch);
  if (path) params.set("path", path);
  return apiRequest<RepositoryCommitsPayload>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?${params.toString()}`,
  );
}

/** One commit with its parent, changed files and line diff (REQ-4-2-2). */
export function fetchRepositoryCommit(
  owner: string,
  name: string,
  commitId: string,
  path = "",
): Promise<RepositoryCommitPayload> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const query = params.toString();
  return apiRequest<RepositoryCommitPayload>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(commitId)}${query ? `?${query}` : ""}`,
  );
}

/** Changed files between two revisions (REQ-4-2-2). */
export function fetchRepositoryComparison(
  owner: string,
  name: string,
  base: string,
  compare: string,
): Promise<RepositoryComparisonPayload> {
  const params = new URLSearchParams({ base, compare });
  return apiRequest<RepositoryComparisonPayload>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare?${params.toString()}`,
  );
}

/**
 * Code search inside one repository, or — without a repository scope — inside
 * every repository the current viewer may read (REQ-4-2-3).
 */
export function searchRepositoryCode(
  query: string,
  repository: string,
  path = "",
): Promise<CodeSearchResults> {
  const params = new URLSearchParams({ q: query, type: "code" });
  if (repository) params.set("repo", repository);
  if (path) params.set("path", path);
  return apiRequest<CodeSearchResults>(`/api/search?${params.toString()}`);
}

/** Namespace a signed-in user may create repositories in (personal first). */
export interface NamespaceOption {
  type: "user" | "organization";
  login: string;
  name?: string;
}

export interface OwnerRepositories {
  owner: RepositoryOwner;
  repositories: RepositorySummary[];
}

export interface CreateRepositoryInput {
  owner: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  initializeWithReadme: boolean;
}

export interface ForkRepositoryInput {
  owner: string;
  name: string;
  visibility: RepositoryVisibility;
}

export interface ForkDefaults {
  namespace: RepositoryOwner;
  name: string;
  visibility: RepositoryVisibility;
}

export interface ChangeVisibilityInput {
  visibility: RepositoryVisibility;
  confirmationName: string;
}

export async function fetchCreatableNamespaces(): Promise<NamespaceOption[]> {
  const payload = await apiRequest<{ namespaces: NamespaceOption[] }>("/api/namespaces");
  return payload.namespaces;
}

/** Repositories of one owner the current viewer may read. */
export function listOwnerRepositories(login: string): Promise<OwnerRepositories> {
  return apiRequest<OwnerRepositories>(
    `/api/repositories?owner=${encodeURIComponent(login)}`,
  );
}

export async function createRepository(input: CreateRepositoryInput): Promise<RepositoryOverview> {
  const payload = await apiRequest<{ repository: RepositoryOverview }>("/api/repositories", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.repository;
}

export function fetchForkDefaults(
  owner: string,
  name: string,
  namespace: string,
): Promise<ForkDefaults> {
  const params = new URLSearchParams({ namespace });
  return apiRequest<ForkDefaults>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/forks?${params.toString()}`,
  );
}

export async function createForkRepository(
  owner: string,
  name: string,
  input: ForkRepositoryInput,
): Promise<RepositoryOverview> {
  const payload = await apiRequest<{ repository: RepositoryOverview }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/forks`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.repository;
}

export async function changeRepositoryVisibility(
  owner: string,
  name: string,
  input: ChangeVisibilityInput,
): Promise<RepositoryOverview> {
  const payload = await apiRequest<{ repository: RepositoryOverview }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/visibility`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.repository;
}
