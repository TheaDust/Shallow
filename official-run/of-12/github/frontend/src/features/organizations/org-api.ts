import { apiRequest, mutateJson, type MutationOutcome } from "../../lib/api";

export type { MutationErrors, MutationOutcome } from "../../lib/api";
import type { RepositorySummary } from "../repositories/repository-api";
export type { RepositorySummary };

/** Typed client for the organization endpoints (REQ-2-1). */

export type OrganizationRole = "Owner" | "Member";

export interface OrganizationSummary {
  name: string;
  displayName: string;
  role?: OrganizationRole | null;
}

export interface OrganizationMember {
  username: string;
  role: OrganizationRole;
}

export interface OrganizationTeam {
  name: string;
  description?: string;
  parentTeamName?: string | null;
  createdAt?: string | null;
}

export interface TeamDetail {
  organization: { name: string; displayName: string };
  team: OrganizationTeam;
  viewerRole: OrganizationRole | null;
  members: string[];
  /** Every team of the organization, used by the team tree and the parent selector. */
  teams: OrganizationTeam[];
}

/** Result of a team or membership write; field errors are shown next to the input. */
async function mutate<T>(path: string, init: RequestInit): Promise<MutationOutcome<T>> {
  return mutateJson<T>(path, init);
}

export interface OrganizationDetail {
  organization: { name: string; displayName: string; createdAt?: string };
  viewerRole: OrganizationRole | null;
  members: OrganizationMember[];
  teams: OrganizationTeam[];
  repositories: RepositorySummary[];
}

export type CreateOrganizationResult =
  | { ok: true; organization: { name: string; displayName: string } }
  | { ok: false; errors: Record<string, string>; message: string };

function normalizeOrganization(value: Partial<OrganizationSummary>): OrganizationSummary {
  return {
    name: String(value.name ?? ""),
    displayName: String(value.displayName ?? value.name ?? ""),
    role: value.role ?? null,
  };
}

export async function fetchOrganization(name: string): Promise<OrganizationDetail> {
  const payload = await apiRequest<OrganizationDetail>(`/api/organizations/${encodeURIComponent(name)}`);
  return {
    organization: payload.organization,
    viewerRole: payload.viewerRole ?? null,
    members: payload.members ?? [],
    teams: payload.teams ?? [],
    repositories: payload.repositories ?? [],
  };
}

export async function fetchMyOrganizations(): Promise<OrganizationSummary[]> {
  const payload = await apiRequest<{ organizations: OrganizationSummary[] }>("/api/account/organizations");
  return (payload.organizations ?? []).map(normalizeOrganization);
}

export async function fetchPublicOrganizations(): Promise<OrganizationSummary[]> {
  const payload = await apiRequest<{ organizations: OrganizationSummary[] }>("/api/organizations");
  return (payload.organizations ?? []).map(normalizeOrganization);
}

export async function createOrganization(input: {
  name: string;
  displayName: string;
}): Promise<CreateOrganizationResult> {
  const result = await mutate<{ organization: { name: string; displayName: string } }>(
    "/api/organizations",
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!result.ok) return { ok: false, errors: result.errors, message: result.message };
  return { ok: true, organization: result.data.organization };
}

function organizationPath(organization: string, suffix = ""): string {
  return `/api/organizations/${encodeURIComponent(organization)}${suffix}`;
}

function teamPath(organization: string, team: string, suffix = ""): string {
  return organizationPath(organization, `/teams/${encodeURIComponent(team)}${suffix}`);
}

function normalizeTeam(team: Partial<OrganizationTeam>): OrganizationTeam {
  return {
    name: String(team.name ?? ""),
    description: String(team.description ?? ""),
    parentTeamName: team.parentTeamName ?? null,
    createdAt: team.createdAt ?? null,
  };
}

/** Team detail page data (REQ-2-2-1 / REQ-2-2-2). */
export async function fetchTeam(organization: string, team: string): Promise<TeamDetail> {
  const payload = await apiRequest<TeamDetail>(teamPath(organization, team));
  return {
    organization: payload.organization,
    team: normalizeTeam(payload.team),
    viewerRole: payload.viewerRole ?? null,
    members: payload.members ?? [],
    teams: (payload.teams ?? []).map(normalizeTeam),
  };
}

export interface TeamListPayload {
  team: OrganizationTeam;
  teams: OrganizationTeam[];
  members: string[];
}

/** Creates a team in the organization. */
export async function createTeam(
  organization: string,
  input: { name: string; description?: string; parentTeam?: string },
): Promise<MutationOutcome<OrganizationTeam>> {
  const result = await mutate<{ team: OrganizationTeam }>(organizationPath(organization, "/teams"), {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? "",
      parentTeam: input.parentTeam ?? "",
    }),
  });
  if (!result.ok) return result;
  return { ok: true, data: normalizeTeam(result.data.team) };
}

/** Changes the parent team of a team (REQ-2-2-2). */
export async function setTeamParent(
  organization: string,
  team: string,
  parentTeam: string,
): Promise<MutationOutcome<TeamListPayload>> {
  return mutate<TeamListPayload>(teamPath(organization, team), {
    method: "PATCH",
    body: JSON.stringify({ parentTeam }),
  });
}

export async function addTeamMember(
  organization: string,
  team: string,
  username: string,
): Promise<MutationOutcome<{ members: string[] }>> {
  return mutate<{ members: string[] }>(teamPath(organization, team, "/members"), {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export async function removeTeamMember(
  organization: string,
  team: string,
  username: string,
): Promise<MutationOutcome<{ members: string[] }>> {
  return mutate<{ members: string[] }>(teamPath(organization, team, `/members/${encodeURIComponent(username)}`), {
    method: "DELETE",
  });
}

/** Directly adds an existing account as an organization member (REQ-2-2-3). */
export async function addOrganizationMember(
  organization: string,
  input: { username: string; role: string },
): Promise<MutationOutcome<{ member: OrganizationMember; members: OrganizationMember[] }>> {
  return mutate<{ member: OrganizationMember; members: OrganizationMember[] }>(
    organizationPath(organization, "/members"),
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Removes a member and everything it holds inside the organization (REQ-2-2-4). */
export async function removeOrganizationMember(
  organization: string,
  username: string,
): Promise<MutationOutcome<{ members: OrganizationMember[] }>> {
  return mutate<{ members: OrganizationMember[] }>(
    organizationPath(organization, `/members/${encodeURIComponent(username)}`),
    { method: "DELETE" },
  );
}
