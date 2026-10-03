import { apiRequest } from "../lib/api";

export type OrganizationRole = "owner" | "member";
export type RepositoryVisibility = "public" | "private";
export type RepositoryRole = "read" | "triage" | "write" | "maintain" | "admin";
export type AccessSubjectType = "account" | "team";

/** Role vocabularies shared by the member form and the access picker. */
export interface RoleOption {
  value: string;
  label: string;
}

export const REPOSITORY_ROLES: readonly RepositoryRole[] = ["read", "triage", "write", "maintain", "admin"];

export const REPOSITORY_ROLE_LABELS: Record<RepositoryRole, string> = {
  read: "Read",
  triage: "Triage",
  write: "Write",
  maintain: "Maintain",
  admin: "Admin",
};

export const REPOSITORY_ROLE_OPTIONS: RoleOption[] = REPOSITORY_ROLES.map((role) => ({
  value: role,
  label: REPOSITORY_ROLE_LABELS[role],
}));

export const ORGANIZATION_ROLE_OPTIONS: RoleOption[] = [
  { value: "member", label: "Member" },
  { value: "owner", label: "Owner" },
];

export function repositoryRoleLabel(role: string | null | undefined): string {
  if (!role) return "";
  return REPOSITORY_ROLE_LABELS[role as RepositoryRole] ?? role;
}

/**
 * Roles that may write (REQ-4-3-2 branches, REQ-4-4 files): Write, Maintain and
 * Admin (an organization Owner resolves to Admin). Read and Triage may only
 * browse; the server refuses a write request either way.
 */
export function canWriteRepositoryRole(role: RepositoryRole | null | undefined): boolean {
  return role === "write" || role === "maintain" || role === "admin";
}

export interface OrganizationSummary {
  id: string;
  slug: string;
  displayName: string;
  role: OrganizationRole | null;
}

export interface RepositoryOwnerRef {
  type: "account" | "organization";
  id: string;
  login: string;
  displayName: string;
}

/** The repository a fork was copied from, as the fork overview shows it. */
export interface RepositorySource {
  id: string;
  name: string;
  owner: RepositoryOwnerRef;
}

export interface RepositorySummary {
  id: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  defaultBranch: string;
  updatedAt: string | null;
  /** The owning account or organization; `login` is the URL identifier. */
  owner: RepositoryOwnerRef | null;
  forkedFrom: RepositorySource | null;
  /** Root README of the default branch, when the repository has one. */
  readmePath: string | null;
  role: RepositoryRole | null;
}

export interface TeamSummary {
  id: string;
  slug: string;
  parent: string | null;
}

export interface PersonSummary {
  username: string;
  email: string;
  role: "Owner" | "Member";
}

export interface TeamMemberSummary {
  id: string;
  username: string;
  email: string;
}

export interface TeamDetail {
  organization: OrganizationSummary;
  team: TeamSummary;
  members: TeamMemberSummary[];
  parentOptions: string[];
}

export interface OrganizationDetail {
  organization: OrganizationSummary;
}

export interface OrganizationRepositories {
  organization: OrganizationSummary;
  repositories: RepositorySummary[];
}

export interface OrganizationPeople {
  organization: OrganizationSummary;
  people: PersonSummary[];
}

export interface OrganizationTeams {
  organization: OrganizationSummary;
  teams: TeamSummary[];
}

export interface RepositoryDetail {
  repository: RepositorySummary;
}

/** One file of a branch, as the read-only file page renders it. */
export interface RepositoryFileDetail {
  repository: RepositorySummary;
  branch: string;
  path: string;
  content: string;
}

/** One entry of a directory listing: a file, or a directory of the path tree. */
export interface RepositoryTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

/** The files and directories at one path of a branch. */
export interface RepositoryTreeDetail {
  repository: RepositorySummary;
  branch: string;
  path: string;
  entries: RepositoryTreeEntry[];
}

export type CommitChangeType = "added" | "modified" | "removed";
export type CommitDiffLineType = "context" | "add" | "remove";

export interface CommitDiffLine {
  type: CommitDiffLineType;
  text: string;
}

export interface CommitChange {
  path: string;
  changeType: CommitChangeType;
  additions: number;
  deletions: number;
  lines: CommitDiffLine[];
}

export interface CommitSummary {
  id: string;
  shortId: string;
  message: string;
  author: string;
  createdAt: string | null;
  parentId: string | null;
  changedFiles: number;
}

/** One immutable change record with its changed files and line comparison. */
export interface CommitDetail extends CommitSummary {
  branch: string;
  changes: CommitChange[];
  totals: { files: number; additions: number; deletions: number };
}

/** The commit history of a branch or of one file path within it. */
export interface RepositoryCommitsDetail {
  repository: RepositorySummary;
  branch: string;
  path: string;
  count: number;
  commits: CommitSummary[];
}

/** One stored branch of a repository; the default one is read without a branch. */
export interface RepositoryBranchSummary {
  name: string;
  headCommitId: string | null;
  isDefault: boolean;
}

/** The branches the selector of a repository may offer. */
export interface RepositoryBranchesDetail {
  repository: RepositorySummary;
  branches: RepositoryBranchSummary[];
}

export interface CodeSearchLine {
  number: number;
  text: string;
}

export interface CodeSearchMatch {
  path: string;
  lines: CodeSearchLine[];
}

/** Code search results, scoped to one repository and its current branch. */
export interface RepositoryCodeSearch {
  repository: RepositorySummary;
  branch: string;
  query: string;
  matches: CodeSearchMatch[];
}

export interface CreateRepositoryInput {
  /** Owner login: an account username (personal namespace) or an organization slug. */
  owner: string;
  name: string;
  description?: string;
  visibility: RepositoryVisibility;
  initialize: boolean;
}

export interface ForkRepositoryInput {
  owner: string;
  name: string;
  visibility: RepositoryVisibility;
}

/** One “Manage access” row on a repository. */
export interface RepositoryAccessGrant {
  id: string;
  subjectType: AccessSubjectType;
  subjectName: string;
  role: RepositoryRole;
}

export interface RepositoryAccess {
  repository: RepositorySummary;
  access: RepositoryAccessGrant[];
  candidates: { teams: string[]; accounts: string[] };
}

/** Repository search results; the server already narrowed them by access. */
export interface RepositorySearch {
  query: string;
  repositories: RepositorySummary[];
}

export function fetchYourOrganizations(): Promise<{ organizations: OrganizationSummary[] }> {
  return apiRequest<{ organizations: OrganizationSummary[] }>("/api/organizations");
}

/** Repositories the signed-in account may read, across every organization. */
export function fetchYourRepositories(): Promise<{ repositories: RepositorySummary[] }> {
  return apiRequest<{ repositories: RepositorySummary[] }>("/api/repositories");
}

export function fetchPublicOrganizations(): Promise<{ organizations: OrganizationSummary[] }> {
  return apiRequest<{ organizations: OrganizationSummary[] }>("/api/public/organizations");
}

/** Public repositories an unauthenticated visitor may explore. */
export function fetchPublicRepositories(): Promise<{ repositories: RepositorySummary[] }> {
  return apiRequest<{ repositories: RepositorySummary[] }>("/api/public/repositories");
}

/**
 * Searches repositories by name (also accepting `owner/name`). The visible set
 * is decided by the server from the session, so a private repository never
 * appears for a viewer without a grant.
 */
export function searchRepositories(query: string): Promise<RepositorySearch> {
  const params = new URLSearchParams({ q: query });
  return apiRequest<RepositorySearch>(`/api/search/repositories?${params.toString()}`);
}

export function createOrganization(input: { organizationName: string; displayName: string }): Promise<OrganizationDetail> {
  return apiRequest<OrganizationDetail>("/api/organizations", { method: "POST", body: JSON.stringify(input) });
}

export function fetchOrganization(slug: string): Promise<OrganizationDetail> {
  return apiRequest<OrganizationDetail>(`/api/organizations/${encodeURIComponent(slug)}`);
}

export function fetchOrganizationRepositories(slug: string): Promise<OrganizationRepositories> {
  return apiRequest<OrganizationRepositories>(`/api/organizations/${encodeURIComponent(slug)}/repositories`);
}

export function fetchOrganizationPeople(slug: string): Promise<OrganizationPeople> {
  return apiRequest<OrganizationPeople>(`/api/organizations/${encodeURIComponent(slug)}/people`);
}

export function fetchOrganizationTeams(slug: string): Promise<OrganizationTeams> {
  return apiRequest<OrganizationTeams>(`/api/organizations/${encodeURIComponent(slug)}/teams`);
}

export function createTeam(slug: string, teamName: string): Promise<{ team: TeamSummary }> {
  return apiRequest<{ team: TeamSummary }>(`/api/organizations/${encodeURIComponent(slug)}/teams`, {
    method: "POST",
    body: JSON.stringify({ teamName }),
  });
}

export function fetchTeam(slug: string, team: string): Promise<TeamDetail> {
  return apiRequest<TeamDetail>(`/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(team)}`);
}

export function saveTeamParent(slug: string, team: string, parentTeam: string): Promise<{ team: TeamSummary }> {
  return apiRequest<{ team: TeamSummary }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(team)}/parent`,
    { method: "POST", body: JSON.stringify({ parentTeam }) },
  );
}

export function addTeamMember(slug: string, team: string, username: string): Promise<{ members: TeamMemberSummary[] }> {
  return apiRequest<{ members: TeamMemberSummary[] }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(team)}/members`,
    { method: "POST", body: JSON.stringify({ username }) },
  );
}

export function removeTeamMember(slug: string, team: string, username: string): Promise<{ members: TeamMemberSummary[] }> {
  return apiRequest<{ members: TeamMemberSummary[] }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export function fetchRepository(orgSlug: string, repoName: string): Promise<RepositoryDetail> {
  return apiRequest<RepositoryDetail>(
    `/api/repositories/${encodeURIComponent(orgSlug)}/${encodeURIComponent(repoName)}`,
  );
}

/** Creates a repository in a personal or organization namespace. */
export function createRepository(input: CreateRepositoryInput): Promise<RepositoryDetail> {
  return apiRequest<RepositoryDetail>("/api/repositories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Forks a readable repository into a personal or organization namespace. */
export function forkRepository(
  ownerLogin: string,
  repoName: string,
  input: ForkRepositoryInput,
): Promise<RepositoryDetail> {
  return apiRequest<RepositoryDetail>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/fork`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Reads one file of a branch; the path keeps its directory segments. */
export function fetchRepositoryFile(
  ownerLogin: string,
  repoName: string,
  branch: string,
  path: string,
): Promise<RepositoryFileDetail> {
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return apiRequest<RepositoryFileDetail>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/blob/${encodeURIComponent(branch)}/${encodedPath}`,
  );
}

/**
 * Files and directories at one path of a branch. An empty branch reads the
 * repository's default branch, which is what the repository root page shows.
 */
export function fetchRepositoryTree(
  ownerLogin: string,
  repoName: string,
  branch = "",
  path = "",
): Promise<RepositoryTreeDetail> {
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const suffix = branch ? `/${encodeURIComponent(branch)}` : "";
  const tail = encodedPath ? `/${encodedPath}` : "";
  return apiRequest<RepositoryTreeDetail>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/tree${suffix}${tail}`,
  );
}

/** Commit history of a branch, optionally narrowed to one file path. */
export function fetchRepositoryCommits(
  ownerLogin: string,
  repoName: string,
  branch: string,
  path = "",
): Promise<RepositoryCommitsDetail> {
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const tail = encodedPath ? `/${encodedPath}` : "";
  return apiRequest<RepositoryCommitsDetail>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/commits/${encodeURIComponent(branch)}${tail}`,
  );
}

/** One immutable commit with its changed files and line-level comparison. */
export function fetchRepositoryCommit(
  ownerLogin: string,
  repoName: string,
  commitId: string,
): Promise<{ repository: RepositorySummary; commit: CommitDetail }> {
  return apiRequest<{ repository: RepositorySummary; commit: CommitDetail }>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/commit/${encodeURIComponent(commitId)}`,
  );
}

/** Searches readable file content of one repository; the query may be empty. */
export function searchRepositoryCode(
  ownerLogin: string,
  repoName: string,
  query: string,
): Promise<RepositoryCodeSearch> {
  const params = new URLSearchParams({ q: query });
  return apiRequest<RepositoryCodeSearch>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/search?${params.toString()}`,
  );
}

/** The stored branches a repository may switch to (REQ-4-3-1). */
export function fetchRepositoryBranches(
  ownerLogin: string,
  repoName: string,
): Promise<RepositoryBranchesDetail> {
  return apiRequest<RepositoryBranchesDetail>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/branches`,
  );
}

/**
 * Creates a branch at the head of `from` (REQ-4-3-2). Only Write and above are
 * accepted; the server decides that inside its store-locked mutation.
 */
export function createRepositoryBranch(
  ownerLogin: string,
  repoName: string,
  input: { name: string; from: string },
): Promise<RepositoryBranchesDetail & { branch: RepositoryBranchSummary }> {
  return apiRequest<RepositoryBranchesDetail & { branch: RepositoryBranchSummary }>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/branches`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Points the repository’s default branch at an existing branch (REQ-4-3-3). */
export function setRepositoryDefaultBranch(
  ownerLogin: string,
  repoName: string,
  branch: string,
): Promise<RepositoryBranchesDetail> {
  return apiRequest<RepositoryBranchesDetail>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/default-branch`,
    { method: "POST", body: JSON.stringify({ branch }) },
  );
}

/**
 * Adds one file to a branch through a new commit (REQ-4-4). The response is the
 * stored file, so the editor can land on the file view that shows its content.
 */
export function createRepositoryFile(
  ownerLogin: string,
  repoName: string,
  input: { branch: string; path: string; content: string; message: string },
): Promise<RepositoryFileDetail & { commit: CommitSummary }> {
  return apiRequest<RepositoryFileDetail & { commit: CommitSummary }>(
    `/api/repositories/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/files`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Changes a repository’s visibility; only a repository Admin is accepted. */
export function setRepositoryVisibility(
  orgSlug: string,
  repoName: string,
  visibility: RepositoryVisibility,
): Promise<RepositoryDetail> {
  return apiRequest<RepositoryDetail>(
    `/api/repositories/${encodeURIComponent(orgSlug)}/${encodeURIComponent(repoName)}/visibility`,
    { method: "POST", body: JSON.stringify({ visibility }) },
  );
}

export function addOrganizationMember(
  slug: string,
  input: { username: string; role: string },
): Promise<OrganizationPeople> {
  return apiRequest<OrganizationPeople>(`/api/organizations/${encodeURIComponent(slug)}/members`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function removeOrganizationMember(slug: string, username: string): Promise<OrganizationPeople> {
  return apiRequest<OrganizationPeople>(
    `/api/organizations/${encodeURIComponent(slug)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export function fetchRepositoryAccess(orgSlug: string, repoName: string): Promise<RepositoryAccess> {
  return apiRequest<RepositoryAccess>(
    `/api/repositories/${encodeURIComponent(orgSlug)}/${encodeURIComponent(repoName)}/access`,
  );
}

export function addRepositoryAccess(
  orgSlug: string,
  repoName: string,
  input: { subjectType: AccessSubjectType; name: string; role: string },
): Promise<{ repository: RepositorySummary; access: RepositoryAccessGrant[] }> {
  return apiRequest<{ repository: RepositorySummary; access: RepositoryAccessGrant[] }>(
    `/api/repositories/${encodeURIComponent(orgSlug)}/${encodeURIComponent(repoName)}/access`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function saveRepositoryAccess(
  orgSlug: string,
  repoName: string,
  grantId: string,
  role: string,
): Promise<{ repository: RepositorySummary; access: RepositoryAccessGrant[] }> {
  return apiRequest<{ repository: RepositorySummary; access: RepositoryAccessGrant[] }>(
    `/api/repositories/${encodeURIComponent(orgSlug)}/${encodeURIComponent(repoName)}/access/${encodeURIComponent(grantId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
}
