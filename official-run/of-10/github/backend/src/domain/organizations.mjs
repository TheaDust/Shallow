/**
 * Organization, team and membership rules (REQ-2).
 *
 * An organization owns its member and team relationships and is identified by a
 * globally unique lowercase ASCII login in the same format as a REQ-1 username.
 * Membership only makes a user visible in the organization and eligible to be a
 * team/repository authorization subject: it never grants repository access by
 * itself. Every rule is recomputed from the persisted state, so a change is
 * visible in the organization details and in the effective repository access at
 * the same time.
 */

import { isValidUsername } from "./validation.mjs";

export const ORGANIZATION_NAME_MAX = 39;
export const DISPLAY_NAME_MAX = 100;
export const TEAM_NAME_MAX = 50;
/** Lowercase ASCII letters, digits and hyphens; never leading or trailing. */
export const TEAM_NAME_PATTERN = /^[a-z0-9-]+$/;

export const ORGANIZATION_MESSAGES = {
  notFound: "Not found",
  nameFormat: "Organization name format is invalid",
  nameExists: "Organization name already exists",
  displayNameRequired: "Display name is required",
  displayNameTooLong: "Display name must be 100 characters or fewer",
};

export const TEAM_MESSAGES = {
  nameFormat: "Team name format is invalid",
  nameExists: "Team name already exists",
  parentNotInOrganization: "Parent team does not belong to this organization",
  cycle: "Cyclic team hierarchy is not allowed",
  notFound: "Team not found",
};

export const ORGANIZATION_OWNER_MESSAGE =
  "You must be an organization Owner to manage this organization.";
export const ORGANIZATION_MEMBER_MESSAGE =
  "You must be an organization member to view this organization.";

export const MEMBER_MESSAGES = {
  notFound: "Account not found",
  alreadyMember: "Account is already a member",
  role: "Choose Member or Owner",
  lastOwner: "An organization must keep at least one Owner",
};

export const TEAM_MEMBER_MESSAGES = {
  notMember: "Account is not an organization member",
  alreadyMember: "Account is already a team member",
  notFound: "Team member not found",
};

export function normalizeOrganizationName(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeDisplayName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidOrganizationName(value) {
  return isValidUsername(normalizeOrganizationName(value));
}

export function normalizeTeamName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidTeamName(value) {
  const name = normalizeTeamName(value);
  if (!name || name.length > TEAM_NAME_MAX) return false;
  if (!TEAM_NAME_PATTERN.test(name)) return false;
  return !name.startsWith("-") && !name.endsWith("-");
}

export function normalizeMemberRole(value) {
  return String(value ?? "").trim().toLowerCase() === "owner" ? "owner" : "member";
}

export function findOrganization(state, login) {
  const wanted = String(login ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return (
    (state.organizations ?? []).find(
      (organization) => String(organization.login ?? "").toLowerCase() === wanted,
    ) ?? null
  );
}

export function findOrganizationById(state, organizationId) {
  return (state.organizations ?? []).find((organization) => organization.id === organizationId) ?? null;
}

export function findTeam(state, organizationId, name) {
  const wanted = normalizeTeamName(name).toLowerCase();
  if (!wanted) return null;
  return (
    (state.teams ?? []).find(
      (team) =>
        team.organizationId === organizationId && String(team.name ?? "").toLowerCase() === wanted,
    ) ?? null
  );
}

export function findTeamById(state, teamId) {
  return (state.teams ?? []).find((team) => team.id === teamId) ?? null;
}

export function organizationMember(organization, accountId) {
  return (organization?.members ?? []).find((member) => member.accountId === accountId) ?? null;
}

export function isOrganizationOwner(organization, accountId) {
  return organizationMember(organization, accountId)?.role === "owner";
}

export function countOrganizationOwners(organization) {
  return (organization?.members ?? []).filter((member) => member.role === "owner").length;
}

/** Teams of one organization, parents before their children. */
export function listOrganizationTeams(state, organizationId) {
  return (state.teams ?? [])
    .filter((team) => team.organizationId === organizationId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function teamParentOf(state, team) {
  if (!team?.parentTeamId) return null;
  return findTeamById(state, team.parentTeamId) ?? null;
}

/** Every ancestor of one team, nearest parent first. */
export function teamAncestors(state, team) {
  const ancestors = [];
  const seen = new Set([team?.id]);
  let current = teamParentOf(state, team);
  while (current && !seen.has(current.id)) {
    ancestors.push(current);
    seen.add(current.id);
    current = teamParentOf(state, current);
  }
  return ancestors;
}

export function isTeamDescendantOf(state, candidate, teamId) {
  if (!candidate) return false;
  const seen = new Set();
  let current = candidate;
  while (current && !seen.has(current.id)) {
    if (current.parentTeamId === teamId) return true;
    seen.add(current.id);
    current = current.parentTeamId ? findTeamById(state, current.parentTeamId) : null;
  }
  return false;
}

/** The parent assignment would make the team its own parent or its descendant's child. */
export function wouldCreateTeamCycle(state, team, parentTeam) {
  if (!parentTeam) return false;
  if (parentTeam.id === team.id) return true;
  return isTeamDescendantOf(state, parentTeam, team.id);
}

export function teamMemberAccountIds(state, teamId) {
  return (state.teamMemberships ?? [])
    .filter((membership) => membership.teamId === teamId)
    .map((membership) => membership.accountId);
}

export function isTeamMember(state, teamId, accountId) {
  return teamMemberAccountIds(state, teamId).includes(accountId);
}

/** Direct members of one team, with the account each membership belongs to. */
export function listTeamMembers(state, teamId) {
  return (state.teamMemberships ?? [])
    .filter((membership) => membership.teamId === teamId)
    .map((membership) => {
      const account =
        (state.accounts ?? []).find((candidate) => candidate.id === membership.accountId) ?? null;
      return {
        accountId: membership.accountId,
        username: account ? account.username : (membership.login ?? ""),
        createdAt: membership.createdAt ?? null,
      };
    })
    .sort((left, right) => left.username.localeCompare(right.username));
}

export function toOrganizationPayload(organization) {
  return {
    id: organization.id,
    login: organization.login,
    name: organization.name ?? organization.login,
    createdAt: organization.createdAt ?? null,
  };
}

export function toOrganizationMemberPayload(state, member) {
  const account = (state.accounts ?? []).find((candidate) => candidate.id === member.accountId) ?? null;
  return {
    accountId: member.accountId,
    username: account ? account.username : (member.login ?? ""),
    role: member.role === "owner" ? "owner" : "member",
    createdAt: member.createdAt ?? null,
  };
}

export function toTeamPayload(state, team) {
  const parent = teamParentOf(state, team);
  const organization = findOrganizationById(state, team.organizationId);
  return {
    id: team.id,
    name: team.name,
    description: team.description ?? "",
    parent: parent ? { id: parent.id, name: parent.name } : null,
    organization: organization
      ? { id: organization.id, login: organization.login, name: organization.name ?? organization.login }
      : null,
    createdBy: team.createdBy ?? null,
    createdAt: team.createdAt ?? null,
  };
}
