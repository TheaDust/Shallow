import { apiRequest } from "../lib/api";
import { postForm } from "../lib/api-form";
import type {
  OrganizationDetail,
  OrganizationErrors,
  OrganizationMember,
  OrganizationMemberErrors,
  OrganizationMemberFormValues,
  OrganizationRole,
  OrganizationSummary,
  RepositoryAccess,
  RepositoryDetail,
  RepositoryGrantErrors,
  RepositoryGrantFormValues,
  RepositorySummary,
  TeamDetail,
  TeamErrors,
  TeamFormValues,
  TeamMemberErrors,
  TeamSummary,
} from "./types";

/**
 * Same-origin JSON calls of the organization module (REQ-2-1-1, REQ-2-1-2,
 * REQ-2-2-1, REQ-2-2-2, REQ-2-2-3, REQ-2-2-4, REQ-2-3). The server re-checks the
 * session and the permissions of every operation; these helpers only shape the
 * payloads.
 */

export function organizationPath(name: string, suffix = ""): string {
  return `/organizations/${encodeURIComponent(name)}${suffix}`;
}

export function organizationUrl(name: string): string {
  return `/api/organizations/${encodeURIComponent(name)}`;
}

export function organizationHash(name: string, suffix = ""): string {
  return `#${organizationPath(name, suffix)}`;
}

export function repositoryHash(ownerName: string, repositoryName: string): string {
  return `#/repositories/${encodeURIComponent(ownerName)}/${encodeURIComponent(repositoryName)}`;
}

/** `#/repositories/:organization/:repository/settings` — the repository “Settings” link. */
export function repositorySettingsHash(ownerName: string, repositoryName: string): string {
  return `${repositoryHash(ownerName, repositoryName)}/settings`;
}

/** `#/repositories/:organization/:repository/settings/access` — “Manage access”. */
export function repositoryAccessHash(ownerName: string, repositoryName: string): string {
  return `${repositorySettingsHash(ownerName, repositoryName)}/access`;
}

function repositoryAccessPath(ownerName: string, repositoryName: string): string {
  return `/api/repositories/${encodeURIComponent(ownerName)}/${encodeURIComponent(repositoryName)}/access`;
}

export function teamPath(organizationName: string, teamName: string, suffix = ""): string {
  return `${organizationPath(organizationName)}/teams/${encodeURIComponent(teamName)}${suffix}`;
}

export function teamHash(organizationName: string, teamName: string, suffix = ""): string {
  return `#${teamPath(organizationName, teamName, suffix)}`;
}

export async function fetchPublicOrganizations(): Promise<OrganizationSummary[]> {
  const body = await apiRequest<{ organizations: OrganizationSummary[] }>(
    "/api/organizations?scope=public",
  );
  return body.organizations;
}

export async function fetchMyOrganizations(): Promise<OrganizationSummary[]> {
  const body = await apiRequest<{ organizations: OrganizationSummary[] }>(
    "/api/organizations?scope=mine",
  );
  return body.organizations;
}

export async function fetchOrganization(name: string): Promise<OrganizationDetail> {
  const body = await apiRequest<{ organization: OrganizationDetail }>(organizationUrl(name));
  return body.organization;
}

export async function createOrganization(values: {
  name: string;
  displayName: string;
}): Promise<{ ok: true; organization: OrganizationDetail } | { ok: false; errors: OrganizationErrors }> {
  const response = await postForm<{ organization: OrganizationDetail }, OrganizationErrors>(
    "/api/organizations",
    "POST",
    values,
  );
  return response.ok
    ? { ok: true, organization: response.result.organization }
    : { ok: false, errors: response.errors };
}

export async function fetchOrganizationRepositories(name: string): Promise<RepositorySummary[]> {
  const body = await apiRequest<{ repositories: RepositorySummary[] }>(
    `${organizationUrl(name)}/repositories`,
  );
  return body.repositories;
}

export async function fetchOrganizationPeople(name: string): Promise<OrganizationMember[]> {
  const body = await apiRequest<{ members: OrganizationMember[] }>(`${organizationUrl(name)}/people`);
  return body.members;
}

export async function fetchOrganizationTeams(
  name: string,
): Promise<{ teams: TeamSummary[]; viewerRole: OrganizationRole | null }> {
  return apiRequest<{ teams: TeamSummary[]; viewerRole: OrganizationRole | null }>(
    `${organizationUrl(name)}/teams`,
  );
}

export async function fetchTeam(
  organizationName: string,
  teamName: string,
): Promise<{ team: TeamDetail; viewerRole: OrganizationRole | null }> {
  return apiRequest<{ team: TeamDetail; viewerRole: OrganizationRole | null }>(
    `${organizationUrl(organizationName)}/teams/${encodeURIComponent(teamName)}`,
  );
}

export async function createTeam(
  organizationName: string,
  values: TeamFormValues,
): Promise<{ ok: true; team: TeamDetail } | { ok: false; errors: TeamErrors }> {
  const response = await postForm<{ team: TeamDetail }, TeamErrors>(
    `${organizationUrl(organizationName)}/teams`,
    "POST",
    values,
  );
  return response.ok ? { ok: true, team: response.result.team } : { ok: false, errors: response.errors };
}

export async function addTeamMember(
  organizationName: string,
  teamName: string,
  username: string,
): Promise<{ ok: true; team: TeamDetail } | { ok: false; errors: TeamMemberErrors }> {
  const response = await postForm<{ team: TeamDetail }, TeamMemberErrors>(
    `${organizationUrl(organizationName)}/teams/${encodeURIComponent(teamName)}/members`,
    "POST",
    { username },
  );
  return response.ok ? { ok: true, team: response.result.team } : { ok: false, errors: response.errors };
}

export async function removeTeamMember(
  organizationName: string,
  teamName: string,
  username: string,
): Promise<TeamDetail> {
  const body = await apiRequest<{ team: TeamDetail }>(
    `${organizationUrl(organizationName)}/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
  return body.team;
}

export async function saveTeamParent(
  organizationName: string,
  teamName: string,
  parentTeamId: string | null,
): Promise<{ ok: true; team: TeamDetail } | { ok: false; errors: TeamErrors }> {
  const response = await postForm<{ team: TeamDetail }, TeamErrors>(
    `${organizationUrl(organizationName)}/teams/${encodeURIComponent(teamName)}/parent`,
    "PUT",
    { parentTeamId },
  );
  return response.ok ? { ok: true, team: response.result.team } : { ok: false, errors: response.errors };
}

export async function fetchRepository(
  ownerName: string,
  repositoryName: string,
): Promise<RepositoryDetail> {
  const body = await apiRequest<{ repository: RepositoryDetail }>(
    `/api/repositories/${encodeURIComponent(ownerName)}/${encodeURIComponent(repositoryName)}`,
  );
  return body.repository;
}

/**
 * REQ-2-2-3: stores the organization membership relationship of an existing
 * account immediately (Member or Owner). Field errors are returned, not thrown.
 */
export async function addOrganizationMember(
  organizationName: string,
  values: OrganizationMemberFormValues,
): Promise<{ ok: true; members: OrganizationMember[] } | { ok: false; errors: OrganizationMemberErrors }> {
  const response = await postForm<{ members: OrganizationMember[] }, OrganizationMemberErrors>(
    `${organizationUrl(organizationName)}/people`,
    "POST",
    values,
  );
  return response.ok
    ? { ok: true, members: response.result.members }
    : { ok: false, errors: response.errors };
}

/** REQ-2-2-4: removes a member and returns the persisted People list. */
export async function removeOrganizationMember(
  organizationName: string,
  username: string,
): Promise<OrganizationMember[]> {
  const body = await apiRequest<{ members: OrganizationMember[] }>(
    `${organizationUrl(organizationName)}/people/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
  return body.members;
}

/** REQ-2-3: grants, candidate subjects and the viewer's effective repository role. */
export async function fetchRepositoryAccess(
  ownerName: string,
  repositoryName: string,
): Promise<RepositoryAccess> {
  return apiRequest<RepositoryAccess>(repositoryAccessPath(ownerName, repositoryName));
}

/**
 * REQ-2-3: stores exactly one direct grant per subject and repository — the same
 * role keeps the record, a new role replaces it.
 */
export async function saveRepositoryGrant(
  ownerName: string,
  repositoryName: string,
  values: RepositoryGrantFormValues,
): Promise<{ ok: true; access: RepositoryAccess } | { ok: false; errors: RepositoryGrantErrors }> {
  const response = await postForm<RepositoryAccess, RepositoryGrantErrors>(
    repositoryAccessPath(ownerName, repositoryName),
    "POST",
    values,
  );
  return response.ok ? { ok: true, access: response.result } : { ok: false, errors: response.errors };
}
