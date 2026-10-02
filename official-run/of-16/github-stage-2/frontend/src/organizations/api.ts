import { apiRequest } from "../lib/api";
import type {
  AddOrganizationMemberInput,
  CreateOrganizationInput,
  CreateTeamInput,
  OrganizationMembership,
  OrganizationMember,
  OrganizationOverview,
  OrganizationTeam,
  RepositoryAccessGrant,
  RepositoryAccessOverview,
  RepositoryOverview,
  RepositoryRole,
  RepositorySummary,
  TeamMember,
  TeamOverview,
} from "./types";

/** Public directory: every organization with a publicly reachable page. */
export async function fetchOrganizationDirectory(): Promise<OrganizationOverview["organization"][]> {
  const body = await apiRequest<{ organizations: OrganizationOverview["organization"][] }>(
    "/api/explore/organizations",
  );
  return body.organizations;
}

/** "Your organizations": only the organizations the current account belongs to. */
export async function fetchMyOrganizations(): Promise<OrganizationMembership[]> {
  const body = await apiRequest<{ organizations: OrganizationMembership[] }>("/api/organizations");
  return body.organizations;
}

export async function createOrganization(input: CreateOrganizationInput): Promise<OrganizationOverview["organization"]> {
  const body = await apiRequest<{ organization: OrganizationOverview["organization"] }>("/api/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.organization;
}

export async function fetchOrganization(slug: string): Promise<OrganizationOverview> {
  return apiRequest<OrganizationOverview>(`/api/organizations/${encodeURIComponent(slug)}`);
}

export async function fetchOrganizationMembers(slug: string): Promise<OrganizationMember[]> {
  const body = await apiRequest<{ members: OrganizationMember[] }>(
    `/api/organizations/${encodeURIComponent(slug)}/members`,
  );
  return body.members;
}

export async function fetchOrganizationTeams(slug: string): Promise<OrganizationTeam[]> {
  const body = await apiRequest<{ teams: OrganizationTeam[] }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams`,
  );
  return body.teams;
}

function membersPath(slug: string): string {
  return `/api/organizations/${encodeURIComponent(slug)}/members`;
}

/** Directly adds an existing account as Member or Owner; no invitation step. */
export async function addOrganizationMember(
  slug: string,
  input: AddOrganizationMemberInput,
): Promise<OrganizationMember[]> {
  const body = await apiRequest<{ members: OrganizationMember[] }>(membersPath(slug), {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.members;
}

/** Removes the membership together with the account's team and grant links. */
export async function removeOrganizationMember(
  slug: string,
  username: string,
): Promise<OrganizationMember[]> {
  const body = await apiRequest<{ members: OrganizationMember[] }>(
    `${membersPath(slug)}/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
  return body.members;
}

/** Repositories the current viewer may read inside the organization. */
export async function fetchOrganizationRepositories(slug: string): Promise<RepositorySummary[]> {
  const body = await apiRequest<{ repositories: RepositorySummary[] }>(
    `/api/organizations/${encodeURIComponent(slug)}/repositories`,
  );
  return body.repositories;
}

export async function fetchRepository(slug: string, name: string): Promise<RepositoryOverview> {
  const body = await apiRequest<{ repository: RepositoryOverview }>(
    `/api/organizations/${encodeURIComponent(slug)}/repositories/${encodeURIComponent(name)}`,
  );
  return body.repository;
}

function teamPath(slug: string, name: string): string {
  return `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(name)}`;
}

/** One team with its hierarchy context; the parent combobox reads `teams`. */
export async function fetchTeam(slug: string, name: string): Promise<TeamOverview> {
  return apiRequest<TeamOverview>(teamPath(slug, name));
}

/** Members of one team. Team membership is independent of the organization. */
export async function fetchTeamMembers(slug: string, name: string): Promise<TeamMember[]> {
  const body = await apiRequest<{ members: TeamMember[] }>(`${teamPath(slug, name)}/members`);
  return body.members;
}

export async function createTeam(slug: string, input: CreateTeamInput): Promise<OrganizationTeam> {
  const body = await apiRequest<{ team: OrganizationTeam }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return body.team;
}

export async function addTeamMember(slug: string, name: string, username: string): Promise<TeamMember[]> {
  const body = await apiRequest<{ members: TeamMember[] }>(`${teamPath(slug, name)}/members`, {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  return body.members;
}

export async function removeTeamMember(slug: string, name: string, username: string): Promise<TeamMember[]> {
  const body = await apiRequest<{ members: TeamMember[] }>(
    `${teamPath(slug, name)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
  return body.members;
}

/** Saves the parent of a team; an empty parent clears the hierarchy entry. */
export async function saveTeamParent(
  slug: string,
  name: string,
  parentTeamName: string,
): Promise<OrganizationTeam> {
  const body = await apiRequest<{ team: OrganizationTeam }>(teamPath(slug, name), {
    method: "PATCH",
    body: JSON.stringify({ parentTeamName }),
  });
  return body.team;
}

function accessPath(slug: string, name: string): string {
  return `/api/organizations/${encodeURIComponent(slug)}/repositories/${encodeURIComponent(name)}/access`;
}

/** Repository Settings/Manage access list plus the picker's team candidates. */
export async function fetchRepositoryAccess(slug: string, name: string): Promise<RepositoryAccessOverview> {
  return apiRequest<RepositoryAccessOverview>(accessPath(slug, name));
}

/**
 * Grants a team of the repository's organization a role. A team that already
 * holds a grant has that same record updated, so no duplicate row appears.
 */
export async function addRepositoryTeamAccess(
  slug: string,
  name: string,
  teamName: string,
  role: RepositoryRole,
): Promise<RepositoryAccessGrant[]> {
  const body = await apiRequest<RepositoryAccessOverview>(accessPath(slug, name), {
    method: "POST",
    body: JSON.stringify({ teamName, role }),
  });
  return body.grants;
}

/** Saves the role of one existing access row. */
export async function saveRepositoryAccessRole(
  slug: string,
  name: string,
  grantId: string,
  role: RepositoryRole,
): Promise<RepositoryAccessGrant[]> {
  const body = await apiRequest<RepositoryAccessOverview>(
    `${accessPath(slug, name)}/${encodeURIComponent(grantId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  return body.grants;
}
