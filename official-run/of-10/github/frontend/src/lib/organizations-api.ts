import { apiRequest } from "./api";
import type { RepositorySummary } from "./repositories-api";

export type OrganizationRole = "owner" | "member";

/** Organization identity as it appears in the organization list and pages. */
export interface OrganizationSummary {
  id: string;
  login: string;
  name: string;
  createdAt?: string | null;
  viewerRole?: OrganizationRole | null;
}

/** The current viewer's relationship to one organization. */
export interface OrganizationViewer {
  role: OrganizationRole | null;
  isMember: boolean;
  isOwner: boolean;
}

export interface OrganizationMember {
  accountId: string;
  username: string;
  role: OrganizationRole;
  createdAt?: string | null;
}

export interface OrganizationTeam {
  id: string;
  name: string;
  description: string;
  parent: { id: string; name: string } | null;
  organization: { id: string; login: string; name: string } | null;
  createdBy?: { accountId: string; login: string } | null;
  createdAt?: string | null;
  memberCount?: number;
}

export interface OrganizationTeamMember {
  accountId: string;
  username: string;
  createdAt?: string | null;
}

export interface OrganizationTeamDetail {
  organization: OrganizationSummary;
  viewer: OrganizationViewer;
  team: OrganizationTeam;
  members: OrganizationTeamMember[];
  parentOptions: Array<{ id: string; name: string }>;
}

export interface OrganizationDetail {
  organization: OrganizationSummary;
  viewer: OrganizationViewer;
}

export interface CreateOrganizationInput {
  name: string;
  displayName: string;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
  parentTeam?: string;
}

export interface AddOrganizationMemberInput {
  identifier: string;
  role: OrganizationRole;
}

/** Organizations the current session belongs to; a visitor has none. */
export async function fetchViewerOrganizations(): Promise<OrganizationSummary[]> {
  const payload = await apiRequest<{ organizations: OrganizationSummary[] }>("/api/organizations");
  return payload.organizations ?? [];
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<OrganizationSummary> {
  const payload = await apiRequest<{ organization: OrganizationSummary }>("/api/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.organization;
}

export function fetchOrganization(login: string): Promise<OrganizationDetail> {
  return apiRequest<OrganizationDetail>(`/api/organizations/${encodeURIComponent(login)}`);
}

/** Repositories of the organization the current viewer may read. */
export async function fetchOrganizationRepositories(login: string): Promise<RepositorySummary[]> {
  const payload = await apiRequest<{ repositories: RepositorySummary[] }>(
    `/api/organizations/${encodeURIComponent(login)}/repositories`,
  );
  return payload.repositories ?? [];
}

export function fetchOrganizationMembers(
  login: string,
): Promise<{ viewer: OrganizationViewer; members: OrganizationMember[] }> {
  return apiRequest<{ viewer: OrganizationViewer; members: OrganizationMember[] }>(
    `/api/organizations/${encodeURIComponent(login)}/members`,
  );
}

export async function addOrganizationMember(
  login: string,
  input: AddOrganizationMemberInput,
): Promise<OrganizationMember> {
  const payload = await apiRequest<{ member: OrganizationMember }>(
    `/api/organizations/${encodeURIComponent(login)}/members`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.member;
}

export async function removeOrganizationMember(login: string, username: string): Promise<void> {
  await apiRequest<{ ok: boolean }>(
    `/api/organizations/${encodeURIComponent(login)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export function fetchOrganizationTeams(
  login: string,
): Promise<{ viewer: OrganizationViewer; teams: OrganizationTeam[] }> {
  return apiRequest<{ viewer: OrganizationViewer; teams: OrganizationTeam[] }>(
    `/api/organizations/${encodeURIComponent(login)}/teams`,
  );
}

export async function createOrganizationTeam(
  login: string,
  input: CreateTeamInput,
): Promise<OrganizationTeam> {
  const payload = await apiRequest<{ team: OrganizationTeam }>(
    `/api/organizations/${encodeURIComponent(login)}/teams`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.team;
}

export function fetchOrganizationTeam(
  login: string,
  team: string,
): Promise<OrganizationTeamDetail> {
  return apiRequest<OrganizationTeamDetail>(
    `/api/organizations/${encodeURIComponent(login)}/teams/${encodeURIComponent(team)}`,
  );
}

export async function saveTeamParent(
  login: string,
  team: string,
  parentTeam: string,
): Promise<OrganizationTeam> {
  const payload = await apiRequest<{ team: OrganizationTeam }>(
    `/api/organizations/${encodeURIComponent(login)}/teams/${encodeURIComponent(team)}/parent`,
    { method: "POST", body: JSON.stringify({ parentTeam }) },
  );
  return payload.team;
}

/** Adds one current organization member to the team as a direct membership. */
export async function addTeamMember(
  login: string,
  team: string,
  username: string,
): Promise<OrganizationTeamMember> {
  const payload = await apiRequest<{ member: OrganizationTeamMember }>(
    `/api/organizations/${encodeURIComponent(login)}/teams/${encodeURIComponent(team)}/members`,
    { method: "POST", body: JSON.stringify({ username }) },
  );
  return payload.member;
}

/** Removes one direct team membership; the organization membership stays. */
export async function removeTeamMember(
  login: string,
  team: string,
  username: string,
): Promise<void> {
  await apiRequest<{ ok: boolean }>(
    `/api/organizations/${encodeURIComponent(login)}/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}
