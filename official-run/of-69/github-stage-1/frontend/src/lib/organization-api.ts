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

export function fetchRepository(name: string, repository: string): Promise<RepositoryResponse> {
  return apiRequest<RepositoryResponse>(`${organizationPath(name)}/repositories/${encodeURIComponent(repository)}`);
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
