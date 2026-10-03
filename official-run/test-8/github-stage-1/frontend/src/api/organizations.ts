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

export interface OrganizationSummary {
  id: string;
  slug: string;
  displayName: string;
  role: OrganizationRole | null;
}

export interface RepositorySummary {
  id: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  updatedAt: string | null;
  organization: { slug: string; displayName: string } | null;
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
