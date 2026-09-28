import { ApiError, apiRequest } from "./api";
import type { RepoDetail } from "./repo-api";

export interface OrganizationSummary {
  name: string;
  displayName: string;
  role: "owner" | "member" | null;
}

export interface OrganizationInput {
  name: string;
  displayName: string;
}

export interface OrganizationFieldErrors {
  name?: string;
  displayName?: string;
}

export interface RepositorySummary {
  name: string;
  description: string;
  visibility: "public" | "private";
  updatedAt: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  description: string;
  parentTeamId: string | null;
  parentName: string | null;
  createdAt: string;
}

export interface TeamDetail extends TeamSummary {
  members: { username: string }[];
}

export interface TeamInput {
  name: string;
  description?: string;
  parentTeamId?: string | null;
}

export interface TeamFieldErrors {
  name?: string;
  parentTeam?: string;
  username?: string;
}

export interface MemberSummary {
  username: string;
  role: string;
}

export interface MemberFieldErrors {
  identifier?: string;
  role?: string;
}

export type GrantSubjectType = "account" | "team";

export interface GrantSummary {
  subjectType: GrantSubjectType;
  subjectName: string;
  role: string;
  grantorUsername: string | null;
  createdAt: string;
}

export interface GrantFieldErrors {
  subject?: string;
  role?: string;
}

export const REPO_ROLE_OPTIONS = ["read", "triage", "write", "maintain", "admin"] as const;

export function repoRoleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export async function listOrganizations(): Promise<OrganizationSummary[]> {
  const body = await apiRequest<{ organizations: OrganizationSummary[] }>("/api/orgs");
  return body.organizations;
}

export async function createOrganization(input: OrganizationInput): Promise<
  { ok: true; organization: OrganizationSummary } | { ok: false; errors: OrganizationFieldErrors }
> {
  try {
    const body = await apiRequest<{ organization: OrganizationSummary }>("/api/orgs", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, organization: body.organization };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function fetchOrganization(name: string): Promise<OrganizationSummary> {
  const body = await apiRequest<{ organization: OrganizationSummary }>(`/api/orgs/${encodeURIComponent(name)}`);
  return body.organization;
}

export async function listRepositories(org: string): Promise<RepositorySummary[]> {
  const body = await apiRequest<{ repositories: RepositorySummary[] }>(`/api/orgs/${encodeURIComponent(org)}/repos`);
  return body.repositories;
}

export async function fetchRepository(org: string, repo: string, branch?: string): Promise<RepoDetail> {
  const params = new URLSearchParams();
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const body = await apiRequest<{ repository: RepoDetail }>(
    `/api/orgs/${encodeURIComponent(org)}/repos/${encodeURIComponent(repo)}${query ? `?${query}` : ""}`,
  );
  return body.repository;
}

export async function listOrganizationMembers(org: string): Promise<{ username: string; role: string }[]> {
  const body = await apiRequest<{ members: { username: string; role: string }[] }>(
    `/api/orgs/${encodeURIComponent(org)}/members`,
  );
  return body.members;
}

export async function addOrganizationMember(org: string, input: { identifier: string; role: string }): Promise<
  { ok: true } | { ok: false; errors: MemberFieldErrors }
> {
  try {
    await apiRequest<{ ok: true }>(`/api/orgs/${encodeURIComponent(org)}/members`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function removeOrganizationMember(org: string, username: string): Promise<
  { ok: true } | { ok: false; errors: { username?: string } }
> {
  try {
    await apiRequest<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(username)}`,
      { method: "DELETE" },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function fetchRepoGrants(
  org: string,
  repo: string,
): Promise<{ grants: GrantSummary[]; effectiveRole: string | null }> {
  const body = await apiRequest<{ grants: GrantSummary[]; effectiveRole: string | null }>(
    `/api/orgs/${encodeURIComponent(org)}/repos/${encodeURIComponent(repo)}/grants`,
  );
  return body;
}

export async function addRepoGrant(
  org: string,
  repo: string,
  input: { subjectType: GrantSubjectType; subject: string; role: string },
): Promise<{ ok: true } | { ok: false; errors: GrantFieldErrors }> {
  try {
    await apiRequest<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(org)}/repos/${encodeURIComponent(repo)}/grants`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function updateRepoGrantRole(
  org: string,
  repo: string,
  subjectType: GrantSubjectType,
  subject: string,
  role: string,
): Promise<{ ok: true } | { ok: false; errors: GrantFieldErrors }> {
  try {
    await apiRequest<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(org)}/repos/${encodeURIComponent(repo)}/grants/${subjectType}/${encodeURIComponent(subject)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function listTeams(org: string): Promise<TeamSummary[]> {
  const body = await apiRequest<{ teams: TeamSummary[] }>(`/api/orgs/${encodeURIComponent(org)}/teams`);
  return body.teams;
}

export async function createTeam(org: string, input: TeamInput): Promise<
  { ok: true; team: TeamSummary } | { ok: false; errors: TeamFieldErrors }
> {
  try {
    const body = await apiRequest<{ team: TeamSummary }>(`/api/orgs/${encodeURIComponent(org)}/teams`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, team: body.team };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function fetchTeam(org: string, team: string): Promise<TeamDetail> {
  const body = await apiRequest<{ team: TeamDetail }>(
    `/api/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}`,
  );
  return body.team;
}

export async function addTeamMember(org: string, team: string, username: string): Promise<
  { ok: true } | { ok: false; errors: TeamFieldErrors }
> {
  try {
    await apiRequest<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/members`,
      { method: "POST", body: JSON.stringify({ username }) },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function removeTeamMember(org: string, team: string, username: string): Promise<void> {
  await apiRequest<{ ok: true }>(
    `/api/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export async function saveTeamParent(org: string, team: string, parentTeamId: string | null): Promise<
  { ok: true } | { ok: false; errors: TeamFieldErrors }
> {
  try {
    await apiRequest<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}`,
      { method: "PATCH", body: JSON.stringify({ parentTeamId }) },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && hasErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export function formatUpdateTime(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  const formatted = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `Updated ${formatted}`;
}

/**
 * Relative timestamp used by commit history entries. Seed commits carry
 * timestamps in the past so their rendered values always contain “ago”.
 */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function hasErrors(value: unknown): value is { errors: Record<string, unknown> } {
  return typeof value === "object" && value !== null && "errors" in value;
}
