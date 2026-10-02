import { apiRequest } from "./api";

export type OrganizationRole = "owner" | "member";
export type RepositoryVisibility = "public" | "private";

export interface Organization {
  name: string;
  displayName: string;
  createdAt?: string;
}

export interface OrganizationMembership extends Organization {
  role: OrganizationRole;
}

export interface OrganizationDetail {
  organization: Organization;
  viewerRole: OrganizationRole | null;
}

export interface OrganizationMember {
  username: string;
  role: OrganizationRole;
}

export interface OrganizationTeam {
  id?: string;
  name: string;
  description: string | null;
  parent: string | null;
  parentTeamId?: string | null;
}

export interface TeamMember {
  username: string;
}

export interface TeamDetail {
  organization: { name: string; displayName: string };
  team: OrganizationTeam;
  members: TeamMember[];
  viewerRole: OrganizationRole | null;
  canManage: boolean;
}

export interface RepositorySummary {
  id?: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  updatedAt: string;
}

export interface RepositoryDetail extends RepositorySummary {
  owner: string;
  ownerType?: "account" | "organization";
  defaultBranch?: string | null;
  /** The viewer's effective repository role, or null without any access. */
  viewerRole?: string | null;
  /** True only for a repository Admin; the server decides, not the client. */
  canAdminister?: boolean;
}

export interface CreateOrganizationInput {
  name: string;
  displayName: string;
}

export async function listMyOrganizations(): Promise<OrganizationMembership[]> {
  const payload = await apiRequest<{ organizations: OrganizationMembership[] }>(
    "/api/organizations",
  );
  return payload.organizations;
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<Organization> {
  const payload = await apiRequest<{ organization: Organization }>("/api/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.organization;
}

export async function fetchOrganization(name: string): Promise<OrganizationDetail> {
  return apiRequest<OrganizationDetail>(`/api/organizations/${encodeURIComponent(name)}`);
}

export async function fetchOrganizationMembers(name: string): Promise<OrganizationMember[]> {
  const payload = await apiRequest<{ members: OrganizationMember[] }>(
    `/api/organizations/${encodeURIComponent(name)}/members`,
  );
  return payload.members;
}

export async function fetchOrganizationTeams(name: string): Promise<OrganizationTeam[]> {
  const payload = await apiRequest<{ teams: OrganizationTeam[] }>(
    `/api/organizations/${encodeURIComponent(name)}/teams`,
  );
  return payload.teams;
}

export async function fetchOrganizationRepositories(
  name: string,
): Promise<RepositorySummary[]> {
  const payload = await apiRequest<{ repositories: RepositorySummary[] }>(
    `/api/organizations/${encodeURIComponent(name)}/repositories`,
  );
  return payload.repositories;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
  /** Parent team name, or an empty string for no parent. */
  parent?: string;
}

export async function createTeam(
  organizationName: string,
  input: CreateTeamInput,
): Promise<OrganizationTeam> {
  const payload = await apiRequest<{ team: OrganizationTeam }>(
    `/api/organizations/${encodeURIComponent(organizationName)}/teams`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.team;
}

export async function fetchTeam(
  organizationName: string,
  teamName: string,
): Promise<TeamDetail> {
  return apiRequest<TeamDetail>(
    `/api/organizations/${encodeURIComponent(organizationName)}/teams/${encodeURIComponent(teamName)}`,
  );
}

export async function addTeamMember(
  organizationName: string,
  teamName: string,
  username: string,
): Promise<TeamMember> {
  const payload = await apiRequest<{ member: TeamMember }>(
    `/api/organizations/${encodeURIComponent(organizationName)}/teams/${encodeURIComponent(teamName)}/members`,
    { method: "POST", body: JSON.stringify({ username }) },
  );
  return payload.member;
}

export async function removeTeamMember(
  organizationName: string,
  teamName: string,
  username: string,
): Promise<void> {
  await apiRequest<{ ok: boolean }>(
    `/api/organizations/${encodeURIComponent(organizationName)}/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export async function saveTeamParent(
  organizationName: string,
  teamName: string,
  parent: string,
): Promise<OrganizationTeam> {
  const payload = await apiRequest<{ team: OrganizationTeam }>(
    `/api/organizations/${encodeURIComponent(organizationName)}/teams/${encodeURIComponent(teamName)}`,
    { method: "PATCH", body: JSON.stringify({ parent }) },
  );
  return payload.team;
}

export interface AddOrganizationMemberInput {
  identifier: string;
  role: string;
}

export async function addOrganizationMember(
  organizationName: string,
  input: AddOrganizationMemberInput,
): Promise<OrganizationMember> {
  const payload = await apiRequest<{ member: OrganizationMember }>(
    `/api/organizations/${encodeURIComponent(organizationName)}/members`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.member;
}

export async function removeOrganizationMember(
  organizationName: string,
  username: string,
): Promise<void> {
  await apiRequest<{ ok: boolean }>(
    `/api/organizations/${encodeURIComponent(organizationName)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export async function fetchRepository(
  owner: string,
  name: string,
): Promise<RepositoryDetail> {
  const payload = await apiRequest<{
    repository: RepositoryDetail;
    viewerRole?: string | null;
    canAdminister?: boolean;
  }>(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  return {
    ...payload.repository,
    viewerRole: payload.viewerRole ?? null,
    canAdminister: payload.canAdminister === true,
  };
}
