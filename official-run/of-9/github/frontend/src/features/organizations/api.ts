import { apiRequest, ApiError } from "../../lib/api";

export type Visibility = "public" | "private";
export type MembershipRole = "member" | "owner";
export type RepoRole = "read" | "triage" | "write" | "maintain" | "admin";

export const REPO_ROLE_LABELS: Record<RepoRole, string> = {
  read: "Read",
  triage: "Triage",
  write: "Write",
  maintain: "Maintain",
  admin: "Admin",
};

export const REPO_ROLES: RepoRole[] = ["read", "triage", "write", "maintain", "admin"];

export type FieldErrors = Record<string, string>;

export interface OrganizationInfo {
  id: string;
  displayName: string;
  createdAt: string;
  role: MembershipRole;
}

export interface OrganizationOverview {
  id: string;
  displayName: string;
  createdAt: string;
  myRole: MembershipRole | null;
}

export interface RepositoryInfo {
  owner: string;
  name: string;
  description: string;
  visibility: Visibility;
  updatedAt: string;
}

export interface MemberInfo {
  username: string;
  role: MembershipRole;
}

export interface TeamInfo {
  id: string;
  orgId: string;
  name: string;
  description: string;
  parentId: string | null;
  parentName: string | null;
  createdBy: string;
  createdAt: string;
}

export interface TeamOverview {
  team: TeamInfo;
  organization: { id: string; displayName: string };
  myRole: MembershipRole | null;
}

export interface RepositoryOverview {
  owner: string;
  name: string;
  description: string;
  visibility: Visibility;
  defaultBranch: string;
  updatedAt: string;
  myRole: RepoRole | null;
  files: FileEntry[];
  forkSource: { owner: string; name: string } | null;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

export interface SearchRepositoryInfo {
  owner: string;
  name: string;
  description: string;
  visibility: Visibility;
  defaultBranch: string;
  updatedAt: string;
}

export type RepositoryContents =
  | {
      repository: { owner: string; name: string };
      branch: string;
      path: string;
      type: "dir";
      entries: FileEntry[];
      myRole: RepoRole | null;
      commitCount: number;
    }
  | {
      repository: { owner: string; name: string };
      branch: string;
      path: string;
      type: "file";
      name: string;
      content: string;
      commit: { id: string; message: string; author: string; createdAt: string } | null;
      myRole: RepoRole | null;
      commitCount: number;
    };

export interface CommitChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface CommitRecord {
  id: string;
  shortId: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  changes: CommitChange[];
}

export interface DiffLine {
  type: "context" | "add" | "del";
  line: string;
}

export interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface RepositoryDiff {
  repository: { owner: string; name: string };
  base: string;
  compare: string;
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface CommitDetailResponse extends RepositoryDiff {
  commit: CommitRecord | null;
  parent: CommitRecord | null;
}

export interface CodeSearchResult {
  path: string;
  branch: string;
  line: number;
  snippet: string;
}

export interface GrantInfo {
  subjectType: "member" | "team";
  subjectId: string;
  subjectName: string;
  role: RepoRole;
  grantedBy: string;
  createdAt: string;
}

export interface AccessData {
  grants: GrantInfo[];
  members: { username: string }[];
  teams: { id: string; name: string }[];
}

function extractFieldErrors(error: unknown): FieldErrors {
  if (error instanceof ApiError && error.status === 422) {
    const body = error.body as { errors?: FieldErrors };
    return body?.errors ?? {};
  }
  throw error;
}

export async function listOrganizations(): Promise<OrganizationInfo[]> {
  const body = await apiRequest<{ organizations: OrganizationInfo[] }>("/api/organizations");
  return body.organizations;
}

export type CreateOrganizationResult =
  | { ok: true; organization: OrganizationInfo }
  | { ok: false; errors: FieldErrors };

export async function createOrganization(input: {
  name: string;
  displayName: string;
}): Promise<CreateOrganizationResult> {
  try {
    const body = await apiRequest<{ organization: OrganizationInfo }>("/api/organizations", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, organization: body.organization };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function getOrganization(orgId: string): Promise<OrganizationOverview> {
  const body = await apiRequest<{ organization: OrganizationOverview }>(
    `/api/organizations/${encodeURIComponent(orgId)}`,
  );
  return body.organization;
}

export async function listRepositories(orgId: string): Promise<RepositoryInfo[]> {
  const body = await apiRequest<{ repositories: RepositoryInfo[] }>(
    `/api/organizations/${encodeURIComponent(orgId)}/repositories`,
  );
  return body.repositories;
}

export async function listPeople(orgId: string): Promise<MemberInfo[]> {
  const body = await apiRequest<{ members: MemberInfo[] }>(
    `/api/organizations/${encodeURIComponent(orgId)}/people`,
  );
  return body.members;
}

export type AddOrganizationMemberResult =
  | { ok: true; member: MemberInfo }
  | { ok: false; errors: FieldErrors };

export async function addOrganizationMember(
  orgId: string,
  input: { username: string; role: MembershipRole },
): Promise<AddOrganizationMemberResult> {
  try {
    const body = await apiRequest<{ member: MemberInfo }>(
      `/api/organizations/${encodeURIComponent(orgId)}/people`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, member: body.member };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const body = error.body as { errors?: FieldErrors };
      return { ok: false, errors: body?.errors ?? {} };
    }
    return { ok: false, errors: { general: "Unable to add member" } };
  }
}

export type RemoveOrganizationMemberResult =
  | { ok: true }
  | { ok: false; errors: FieldErrors };

export async function removeOrganizationMember(
  orgId: string,
  username: string,
): Promise<RemoveOrganizationMemberResult> {
  try {
    await apiRequest<{ ok: true }>(
      `/api/organizations/${encodeURIComponent(orgId)}/people/${encodeURIComponent(username)}`,
      { method: "DELETE" },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const body = error.body as { errors?: FieldErrors };
      return { ok: false, errors: body?.errors ?? {} };
    }
    return { ok: false, errors: { general: "Unable to remove member" } };
  }
}

export async function listTeams(orgId: string): Promise<TeamInfo[]> {
  const body = await apiRequest<{ teams: TeamInfo[] }>(
    `/api/organizations/${encodeURIComponent(orgId)}/teams`,
  );
  return body.teams;
}

export type CreateTeamResult = { ok: true; team: TeamInfo } | { ok: false; errors: FieldErrors };

export async function createTeam(
  orgId: string,
  input: { name: string; description?: string; parentId?: string | null },
): Promise<CreateTeamResult> {
  try {
    const body = await apiRequest<{ team: TeamInfo }>(
      `/api/organizations/${encodeURIComponent(orgId)}/teams`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, team: body.team };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function getTeam(orgId: string, teamName: string): Promise<TeamOverview> {
  const body = await apiRequest<TeamOverview>(
    `/api/organizations/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamName)}`,
  );
  return body;
}

export async function listTeamMembers(orgId: string, teamName: string): Promise<string[]> {
  const body = await apiRequest<{ members: string[] }>(
    `/api/organizations/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamName)}/members`,
  );
  return body.members;
}

export type AddTeamMemberResult = { ok: true } | { ok: false; errors: FieldErrors };

export async function addTeamMember(
  orgId: string,
  teamName: string,
  username: string,
): Promise<AddTeamMemberResult> {
  try {
    await apiRequest<{ member: { username: string } }>(
      `/api/organizations/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamName)}/members`,
      { method: "POST", body: JSON.stringify({ username }) },
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function removeTeamMember(
  orgId: string,
  teamName: string,
  username: string,
): Promise<void> {
  await apiRequest<{ ok: true }>(
    `/api/organizations/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export type SetTeamParentResult = { ok: true; team: TeamInfo } | { ok: false; errors: FieldErrors };

export async function setTeamParent(
  orgId: string,
  teamName: string,
  parentId: string | null,
): Promise<SetTeamParentResult> {
  try {
    const body = await apiRequest<{ team: TeamInfo }>(
      `/api/organizations/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamName)}`,
      { method: "PATCH", body: JSON.stringify({ parentId }) },
    );
    return { ok: true, team: body.team };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}

export async function getRepository(
  owner: string,
  name: string,
): Promise<RepositoryOverview> {
  const body = await apiRequest<{ repository: RepositoryOverview; myRole: RepoRole | null }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  );
  return { ...body.repository, myRole: body.myRole };
}

export async function searchRepositories(query: string): Promise<SearchRepositoryInfo[]> {
  const body = await apiRequest<{ repositories: SearchRepositoryInfo[] }>(
    `/api/search/repositories?q=${encodeURIComponent(query)}`,
  );
  return body.repositories;
}

export async function listMyRepositories(): Promise<SearchRepositoryInfo[]> {
  const body = await apiRequest<{ repositories: SearchRepositoryInfo[] }>("/api/repositories");
  return body.repositories;
}

export async function getRepositoryContents(
  owner: string,
  name: string,
  options: { branch?: string; path?: string } = {},
): Promise<RepositoryContents> {
  const params = new URLSearchParams();
  if (options.branch) params.set("branch", options.branch);
  if (options.path) params.set("path", options.path);
  const query = params.toString();
  const body = await apiRequest<{ contents: RepositoryContents }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents${query ? `?${query}` : ""}`,
  );
  return body.contents;
}

export async function getRepositoryBranches(owner: string, name: string): Promise<string[]> {
  const body = await apiRequest<{ branches: string[] }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`,
  );
  return body.branches;
}

export interface BranchInfo {
  name: string;
  commitId: string;
  createdBy: string;
  createdAt: string;
}

export type CreateBranchResult =
  | { ok: true; branch: BranchInfo }
  | { ok: false; errors: FieldErrors };

export async function createRepositoryBranch(
  owner: string,
  name: string,
  input: { name: string; base: string },
): Promise<CreateBranchResult> {
  try {
    const body = await apiRequest<{ branch: BranchInfo }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, branch: body.branch };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const body = error.body as { errors?: FieldErrors };
      return { ok: false, errors: body?.errors ?? {} };
    }
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errors: { general: "You do not have permission to create a branch" } };
    }
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, errors: { general: "Sign in to create a branch" } };
    }
    return { ok: false, errors: { general: "Unable to create branch" } };
  }
}

export async function updateRepositoryDefaultBranch(
  owner: string,
  name: string,
  branch: string,
): Promise<RepositoryOverview> {
  const body = await apiRequest<{ repository: RepositoryOverview; myRole: RepoRole | null }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/default-branch`,
    { method: "PATCH", body: JSON.stringify({ branch }) },
  );
  return { ...body.repository, myRole: body.myRole };
}

export async function getRepositoryCommits(
  owner: string,
  name: string,
  options: { branch?: string; path?: string } = {},
): Promise<{ branch: string; path: string; commits: CommitRecord[] }> {
  const params = new URLSearchParams();
  if (options.branch) params.set("branch", options.branch);
  if (options.path) params.set("path", options.path);
  const query = params.toString();
  const body = await apiRequest<{ branch: string; path: string; commits: CommitRecord[] }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits${query ? `?${query}` : ""}`,
  );
  return body;
}

export async function getCommitDiff(
  owner: string,
  name: string,
  commitId: string,
  path?: string,
): Promise<CommitDetailResponse> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const query = params.toString();
  const body = await apiRequest<CommitDetailResponse>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(commitId)}${query ? `?${query}` : ""}`,
  );
  return body;
}

export async function getCompareDiff(
  owner: string,
  name: string,
  base: string,
  compare: string,
  path?: string,
): Promise<RepositoryDiff> {
  const params = new URLSearchParams({ base, compare });
  if (path) params.set("path", path);
  const body = await apiRequest<RepositoryDiff>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare?${params.toString()}`,
  );
  return body;
}

export async function searchRepositoryCode(
  owner: string,
  name: string,
  query: string,
  path?: string,
): Promise<{ branch: string; results: CodeSearchResult[] }> {
  const params = new URLSearchParams({ q: query });
  if (path) params.set("path", path);
  const body = await apiRequest<{ branch: string; results: CodeSearchResult[] }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/search/code?${params.toString()}`,
  );
  return body;
}

export type CreateCommitResult =
  | { ok: true; commit: CommitRecord }
  | { ok: false; errors: FieldErrors };

export async function createRepositoryCommit(
  owner: string,
  name: string,
  input: { branch: string; path: string; content: string; message: string },
): Promise<CreateCommitResult> {
  try {
    const body = await apiRequest<{ commit: CommitRecord }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, commit: body.commit };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const body = error.body as { errors?: FieldErrors };
      return { ok: false, errors: body?.errors ?? {} };
    }
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errors: { general: "You do not have permission to write to this branch" } };
    }
    return { ok: false, errors: { general: "Unable to save changes" } };
  }
}

export type CreateRepositoryResult =
  | {
      ok: true;
      repository: {
        owner: string;
        name: string;
        description: string;
        visibility: Visibility;
        defaultBranch: string;
        updatedAt: string;
      };
    }
  | { ok: false; errors: FieldErrors };

export async function createRepository(input: {
  owner: string;
  name: string;
  description: string;
  visibility: Visibility;
  initialize: boolean;
}): Promise<CreateRepositoryResult> {
  try {
    const body = await apiRequest<{ repository: { owner: string; name: string; description: string; visibility: Visibility; defaultBranch: string; updatedAt: string } }>(
      "/api/repositories",
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, repository: body.repository };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      return { ok: false, errors: extractFieldErrors(error) };
    }
    if (error instanceof ApiError && error.status === 403) {
      return {
        ok: false,
        errors: { owner: "You do not have permission to create a repository in this namespace" },
      };
    }
    return { ok: false, errors: { general: "Unable to create repository" } };
  }
}

export type ForkResult =
  | { ok: true; repository: { owner: string; name: string } }
  | { ok: false; errors: FieldErrors };

export async function forkRepository(
  sourceOwner: string,
  sourceName: string,
  input: { targetOwner: string; name: string; visibility: Visibility },
): Promise<ForkResult> {
  try {
    const body = await apiRequest<{ repository: { owner: string; name: string } }>(
      `/api/repositories/${encodeURIComponent(sourceOwner)}/${encodeURIComponent(sourceName)}/forks`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, repository: body.repository };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      return { ok: false, errors: extractFieldErrors(error) };
    }
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errors: { targetOwner: error.message } };
    }
    return { ok: false, errors: { general: "Unable to fork repository" } };
  }
}

export async function setRepositoryVisibility(
  owner: string,
  name: string,
  visibility: Visibility,
): Promise<RepositoryOverview> {
  const body = await apiRequest<{ repository: RepositoryOverview; myRole: RepoRole | null }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    { method: "PATCH", body: JSON.stringify({ visibility }) },
  );
  return { ...body.repository, myRole: body.myRole };
}

export async function getAccess(owner: string, name: string): Promise<AccessData> {
  const body = await apiRequest<AccessData>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/access`,
  );
  return body;
}

export type SetGrantResult = { ok: true; grant: GrantInfo } | { ok: false; errors: FieldErrors };

export async function setGrant(
  owner: string,
  name: string,
  input: { subjectType: "member" | "team"; subjectId: string; role: RepoRole },
): Promise<SetGrantResult> {
  try {
    const body = await apiRequest<{ grant: GrantInfo }>(
      `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/access`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, grant: body.grant };
  } catch (error) {
    return { ok: false, errors: extractFieldErrors(error) };
  }
}
