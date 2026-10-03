import { apiRequest } from "./api";

export type OrganizationRole = "owner" | "member";

export type RepositoryRole = "read" | "triage" | "write" | "maintain" | "admin";

export const REPOSITORY_ROLES: RepositoryRole[] = ["read", "triage", "write", "maintain", "admin"];

export const REPOSITORY_ROLE_LABELS: Record<RepositoryRole, string> = {
  read: "Read",
  triage: "Triage",
  write: "Write",
  maintain: "Maintain",
  admin: "Admin",
};

export interface OrganizationSummary {
  name: string;
  displayName: string;
}

export interface MyOrganization extends OrganizationSummary {
  role: OrganizationRole;
}

export interface OrganizationViewer {
  role: OrganizationRole | null;
}

export interface RepositorySummary {
  name: string;
  description: string;
  visibility: "public" | "private";
  updatedAt: string;
  defaultBranch?: string;
  createdAt?: string;
  forkedFrom?: ForkedFrom | null;
}

/** The `owner/name` reference of the repository a fork was copied from. */
export interface ForkedFrom {
  owner: RepositoryOwner;
  name: string;
  repositoryId?: string;
}

/** A repository owner: an individual account or an organization. */
export interface RepositoryOwner {
  name: string;
  displayName: string;
  /** Absent on legacy payloads; defaults to an organization. */
  type?: "user" | "organization";
}

/** The default-branch README a repository overview links to. */
export interface ReadmeFile {
  path: string;
  content: string;
}

/** One file of the branch a code page reads. */
export interface RepositoryCodeFile {
  path: string;
  content: string;
}

/** One branch of a repository, as the branch selector offers it. */
export interface RepositoryBranchOption {
  name: string;
}

/** One commit as the history page lists it. */
export interface RepositoryCommitRecord {
  id: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  changedFiles: string[];
}

/** One line of a line-by-line comparison between two revisions. */
export interface CommitDiffLine {
  type: "context" | "addition" | "deletion";
  text: string;
}

/** One changed file of a commit with its comparison and numeric totals. */
export interface CommitChangedFile {
  path: string;
  additions: number;
  deletions: number;
  lines: CommitDiffLine[];
}

/** One file matching a repository code search, with its matching lines. */
export interface CodeSearchResult {
  path: string;
  lines: string[];
  matches: number;
}

/** One default-branch commit as the repository pages list it. */
export interface RepositoryCommit {
  id: string;
  message: string;
  author: string;
  createdAt: string;
}

export interface OrganizationMember {
  username: string;
  role: OrganizationRole;
}

export interface TeamSummary {
  name: string;
  parentTeamName: string | null;
}

export interface TeamOption {
  name: string;
}

export interface OrganizationResponse {
  organization: OrganizationSummary;
  viewer: OrganizationViewer;
}

export interface RepositoriesResponse extends OrganizationResponse {
  repositories: RepositorySummary[];
}

export interface RepositoryViewer extends OrganizationViewer {
  repositoryRole: RepositoryRole | null;
  canManage: boolean;
}

export interface RepositoryResponse {
  organization: OrganizationSummary;
  viewer: RepositoryViewer;
  repository: RepositorySummary;
  readme?: ReadmeFile | null;
  commits?: RepositoryCommit[] | null;
  branch?: string | null;
  branches?: RepositoryBranchOption[] | null;
  files?: RepositoryCodeFile[] | null;
}

/** The repository context every read-only code view reads. */
export interface RepositoryCodeContext {
  owner: RepositoryOwner;
  viewer: RepositoryViewer;
  repository: RepositorySummary;
}

/** The repository's commit history for one branch, newest first. */
export interface RepositoryCommitsResponse extends RepositoryCodeContext {
  branch: string;
  path: string | null;
  commits: RepositoryCommitRecord[];
}

/** One commit and its difference against the parent revision. */
export interface RepositoryCommitDetailResponse extends RepositoryCodeContext {
  branch: string | null;
  commit: RepositoryCommitRecord & { parentMessage: string | null; parentAuthor: string | null };
  totals: { files: number; additions: number; deletions: number };
  files: CommitChangedFile[];
}

/** The code search results of one repository. */
export interface RepositoryCodeSearchResponse extends RepositoryCodeContext {
  branch: string;
  path?: string | null;
  query: string;
  results: CodeSearchResult[];
}

/** The canonical `owner/name` detail of a personal or organization repository. */
export interface RepositoryDetailResponse {
  owner: RepositoryOwner;
  viewer: RepositoryViewer;
  repository: RepositorySummary;
  readme?: ReadmeFile | null;
  commits?: RepositoryCommit[] | null;
  branch?: string | null;
  branches?: RepositoryBranchOption[] | null;
  files?: RepositoryCodeFile[] | null;
}

/**
 * One repository as the discovery entries describe it: the name, the owning
 * organization and enough metadata to open the repository overview. Search
 * results and the readable-repository list share this shape.
 */
export interface RepositoryResult {
  name: string;
  owner: RepositoryOwner;
  visibility: "public" | "private";
  description: string;
  updatedAt: string;
}

export interface AccessGrant {
  id: string;
  kind: "team" | "user";
  name: string;
  role: RepositoryRole;
}

export interface RepositoryAccessResponse {
  organization: OrganizationSummary;
  viewer: OrganizationViewer;
  repository: RepositorySummary;
  canManage: boolean;
  grants: AccessGrant[];
  teams: TeamOption[];
}

export interface TeamResponse extends OrganizationResponse {
  team: TeamSummary;
  teams: TeamOption[];
  canManage: boolean;
}

export interface TeamMembersResponse extends OrganizationResponse {
  team: { name: string };
  members: { username: string }[];
  canManage: boolean;
}

function organizationPath(name: string): string {
  return `/api/organizations/${encodeURIComponent(name)}`;
}

function repositoryPath(ownerName: string, repository: string, ...rest: string[]): string {
  const suffix = rest.map((segment) => `/${encodeURIComponent(segment)}`).join("");
  return `/api/repositories/${encodeURIComponent(ownerName)}/${encodeURIComponent(repository)}${suffix}`;
}

/**
 * The commit history of a repository: newest first, optionally narrowed to one
 * branch or one file path. Read-only.
 */
export function fetchRepositoryCommits(
  ownerName: string,
  repository: string,
  params: { branch?: string; path?: string } = {},
): Promise<RepositoryCommitsResponse> {
  const search = new URLSearchParams();
  if (params.branch) search.set("branch", params.branch);
  if (params.path) search.set("path", params.path);
  const query = search.toString();
  return apiRequest<RepositoryCommitsResponse>(
    `${repositoryPath(ownerName, repository, "commits")}${query ? `?${query}` : ""}`,
  );
}

/** One commit with the line-by-line difference against its parent revision. */
export function fetchCommitDetail(
  ownerName: string,
  repository: string,
  commitId: string,
): Promise<RepositoryCommitDetailResponse> {
  return apiRequest<RepositoryCommitDetailResponse>(
    repositoryPath(ownerName, repository, "commit", commitId),
  );
}

/** Code search inside the readable content of one repository. Read-only. */
export function searchRepositoryCode(
  ownerName: string,
  repository: string,
  query: string,
  params: { branch?: string; path?: string } = {},
): Promise<RepositoryCodeSearchResponse> {
  const search = new URLSearchParams();
  search.set("q", query);
  if (params.branch) search.set("branch", params.branch);
  if (params.path) search.set("path", params.path);
  return apiRequest<RepositoryCodeSearchResponse>(
    `${repositoryPath(ownerName, repository, "code-search")}?${search.toString()}`,
  );
}

/** A personal repository belongs to the account named in the URL. */
export function fetchUserRepository(
  username: string,
  repository: string,
  params: { branch?: string } = {},
): Promise<RepositoryDetailResponse> {
  const query = params.branch ? `?branch=${encodeURIComponent(params.branch)}` : "";
  return apiRequest<RepositoryDetailResponse>(`${repositoryPath(username, repository)}${query}`);
}

export interface CreateRepositoryInput {
  ownerType: "user" | "organization";
  ownerName: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  initialize: boolean;
}

/** Creates a repository; on success the new overview can be opened from the answer. */
export async function createRepository(
  input: CreateRepositoryInput,
): Promise<{ owner: RepositoryOwner; repository: RepositorySummary }> {
  return apiRequest<{ owner: RepositoryOwner; repository: RepositorySummary }>("/api/repositories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ForkRepositoryInput {
  ownerType: "user" | "organization";
  ownerName: string;
  name: string;
  visibility: "public" | "private";
}

/** Forks a readable source repository into the target namespace. */
export async function createFork(
  sourceOwner: string,
  sourceRepository: string,
  input: ForkRepositoryInput,
): Promise<{ owner: RepositoryOwner; repository: RepositorySummary }> {
  return apiRequest<{ owner: RepositoryOwner; repository: RepositorySummary }>(
    `${repositoryPath(sourceOwner, sourceRepository)}/fork`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function fetchPublicOrganizations(): Promise<OrganizationSummary[]> {
  const body = await apiRequest<{ organizations: OrganizationSummary[] }>("/api/public/organizations");
  return body.organizations;
}

export async function fetchMyOrganizations(): Promise<MyOrganization[]> {
  const body = await apiRequest<{ organizations: MyOrganization[] }>("/api/organizations");
  return body.organizations;
}

export async function createOrganization(input: { name: string; displayName: string }): Promise<OrganizationSummary> {
  const body = await apiRequest<{ organization: OrganizationSummary }>("/api/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.organization;
}

export function fetchOrganization(name: string): Promise<OrganizationResponse> {
  return apiRequest<OrganizationResponse>(organizationPath(name));
}

export function fetchOrganizationRepositories(name: string): Promise<RepositoriesResponse> {
  return apiRequest<RepositoriesResponse>(`${organizationPath(name)}/repositories`);
}

export function fetchRepository(
  name: string,
  repository: string,
  params: { branch?: string } = {},
): Promise<RepositoryResponse> {
  const query = params.branch ? `?branch=${encodeURIComponent(params.branch)}` : "";
  return apiRequest<RepositoryResponse>(
    `${organizationPath(name)}/repositories/${encodeURIComponent(repository)}${query}`,
  );
}

/** Repositories the signed-in account (or a visitor) may read, across organizations. */
export async function fetchReadableRepositories(): Promise<RepositoryResult[]> {
  const body = await apiRequest<{ repositories: RepositoryResult[] }>("/api/repositories");
  return body.repositories;
}

/** Global repository search restricted to the repositories the viewer may read. */
export async function searchRepositories(query: string): Promise<RepositoryResult[]> {
  const params = new URLSearchParams({ q: query });
  const body = await apiRequest<{ query: string; results: RepositoryResult[] }>(
    `/api/search/repositories?${params.toString()}`,
  );
  return body.results;
}

export interface CreateBranchInput {
  name: string;
  /** The branch the new reference starts from; the default branch by default. */
  base?: string;
}

/** The new branch reference together with the branches it was added to. */
export interface CreateBranchResponse {
  owner: RepositoryOwner;
  viewer: RepositoryViewer;
  repository: RepositorySummary;
  branch: string;
  branches: RepositoryBranchOption[];
  files: RepositoryCodeFile[];
}

/** Creates a branch reference at an existing revision; Write or higher only. */
export function createBranch(
  ownerName: string,
  repository: string,
  input: CreateBranchInput,
): Promise<CreateBranchResponse> {
  return apiRequest<CreateBranchResponse>(repositoryPath(ownerName, repository, "branches"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface CreateFileInput {
  path: string;
  content: string;
  message: string;
  branch?: string;
}

/** The one commit a submitted file change created. */
export interface CreateFileResponse {
  owner: RepositoryOwner;
  viewer: RepositoryViewer;
  repository: RepositorySummary;
  branch: string;
  path: string;
  content: string;
  commit: RepositoryCommitRecord;
}

/** Adds a file on one branch; Write or higher only. */
export function createFile(
  ownerName: string,
  repository: string,
  input: CreateFileInput,
): Promise<CreateFileResponse> {
  return apiRequest<CreateFileResponse>(repositoryPath(ownerName, repository, "files"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** The repository after its default branch was changed. */
export interface UpdateDefaultBranchResponse {
  owner: RepositoryOwner;
  viewer: RepositoryViewer;
  repository: RepositorySummary;
  branch: string;
  branches: RepositoryBranchOption[];
}

/** Changes the branch a repository reads by default; repository Admin only. */
export function updateDefaultBranch(
  ownerName: string,
  repository: string,
  branch: string,
): Promise<UpdateDefaultBranchResponse> {
  return apiRequest<UpdateDefaultBranchResponse>(repositoryPath(ownerName, repository, "default-branch"), {
    method: "PUT",
    body: JSON.stringify({ branch }),
  });
}

/** Only a repository Admin may apply this; the server refuses every other caller. */
export function updateRepositoryVisibility(
  name: string,
  repository: string,
  visibility: "public" | "private",
): Promise<RepositoryResponse> {
  return apiRequest<RepositoryResponse>(
    `${organizationPath(name)}/repositories/${encodeURIComponent(repository)}/visibility`,
    { method: "PUT", body: JSON.stringify({ visibility }) },
  );
}

export interface MembersResponse extends OrganizationResponse {
  canManage: boolean;
  members: OrganizationMember[];
}

export interface TeamsResponse extends OrganizationResponse {
  teams: TeamSummary[];
}

export function fetchOrganizationMembers(name: string): Promise<MembersResponse> {
  return apiRequest<MembersResponse>(`${organizationPath(name)}/members`);
}

export function fetchOrganizationTeams(name: string): Promise<TeamsResponse> {
  return apiRequest<TeamsResponse>(`${organizationPath(name)}/teams`);
}

export async function createTeam(name: string, teamName: string): Promise<TeamSummary> {
  const body = await apiRequest<{ team: TeamSummary }>(`${organizationPath(name)}/teams`, {
    method: "POST",
    body: JSON.stringify({ name: teamName }),
  });
  return body.team;
}

export function fetchTeam(name: string, team: string): Promise<TeamResponse> {
  return apiRequest<TeamResponse>(`${organizationPath(name)}/teams/${encodeURIComponent(team)}`);
}

export async function saveTeamParent(name: string, team: string, parentTeam: string): Promise<TeamSummary> {
  const body = await apiRequest<{ team: TeamSummary }>(
    `${organizationPath(name)}/teams/${encodeURIComponent(team)}`,
    { method: "PUT", body: JSON.stringify({ parentTeam }) },
  );
  return body.team;
}

export function fetchTeamMembers(name: string, team: string): Promise<TeamMembersResponse> {
  return apiRequest<TeamMembersResponse>(`${organizationPath(name)}/teams/${encodeURIComponent(team)}/members`);
}

export async function addTeamMember(name: string, team: string, username: string): Promise<TeamMembersResponse> {
  return apiRequest<TeamMembersResponse>(`${organizationPath(name)}/teams/${encodeURIComponent(team)}/members`, {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export async function removeTeamMember(name: string, team: string, username: string): Promise<TeamMembersResponse> {
  return apiRequest<TeamMembersResponse>(
    `${organizationPath(name)}/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export async function addOrganizationMember(
  name: string,
  identifier: string,
  role: OrganizationRole,
): Promise<MembersResponse> {
  return apiRequest<MembersResponse>(`${organizationPath(name)}/members`, {
    method: "POST",
    body: JSON.stringify({ identifier, role }),
  });
}

export async function removeOrganizationMember(name: string, username: string): Promise<MembersResponse> {
  return apiRequest<MembersResponse>(`${organizationPath(name)}/members/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}

export function fetchRepositoryAccess(name: string, repository: string): Promise<RepositoryAccessResponse> {
  return apiRequest<RepositoryAccessResponse>(
    `${organizationPath(name)}/repositories/${encodeURIComponent(repository)}/access`,
  );
}

export async function addRepositoryTeamGrant(
  name: string,
  repository: string,
  teamName: string,
  role: RepositoryRole,
): Promise<RepositoryAccessResponse> {
  return apiRequest<RepositoryAccessResponse>(
    `${organizationPath(name)}/repositories/${encodeURIComponent(repository)}/access`,
    { method: "POST", body: JSON.stringify({ teamName, role }) },
  );
}

export async function updateRepositoryGrant(
  name: string,
  repository: string,
  grantId: string,
  role: RepositoryRole,
): Promise<RepositoryAccessResponse> {
  return apiRequest<RepositoryAccessResponse>(
    `${organizationPath(name)}/repositories/${encodeURIComponent(repository)}/access/${encodeURIComponent(grantId)}`,
    { method: "PUT", body: JSON.stringify({ role }) },
  );
}
