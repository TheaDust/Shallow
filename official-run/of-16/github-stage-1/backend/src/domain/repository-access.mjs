import { randomUUID } from "node:crypto";

import { ORGANIZATION_ROLE_OWNER, organizationRoleOf } from "./organizations.mjs";
import { findTeamByName } from "./teams.mjs";
import {
  MESSAGES,
  REPOSITORY_ROLE_ADMIN,
  normalizeRepositoryRole,
} from "./validation.mjs";

/**
 * Direct access grants of one repository. A grant targets either one account
 * (`accountId`) or one organization team (`teamId`) and stores the repository
 * role. An account may hold at most one direct grant and a team may hold at
 * most one grant per repository, so saving a role updates the existing record.
 */
export function listRepositoryGrants(state, repository) {
  return state.repositoryGrants.filter((grant) => grant.repositoryId === repository.id);
}

function directGrant(state, repository, accountId) {
  return listRepositoryGrants(state, repository).find((grant) => (
    grant.accountId === accountId && !grant.teamId
  )) ?? null;
}

function teamGrant(state, repository, teamId) {
  return listRepositoryGrants(state, repository).find((grant) => grant.teamId === teamId) ?? null;
}

function teamIdsOf(state, accountId) {
  return new Set(
    state.teamMembers
      .filter((membership) => membership.accountId === accountId)
      .map((membership) => membership.teamId),
  );
}

/**
 * Whether the account may open "Settings" and change the repository's access
 * list. Only an organization Owner or a holder of the repository Admin role
 * qualifies; the role is an operation-specific capability and is never inferred
 * from another role (Write, Maintain, ...).
 */
export function canManageRepositoryAccess(state, repository, accountId) {
  if (!repository || !accountId) return false;
  if (organizationRoleOf(state, repository.organizationId, accountId) === ORGANIZATION_ROLE_OWNER) return true;
  if (directGrant(state, repository, accountId)?.role === REPOSITORY_ROLE_ADMIN) return true;
  const teamIds = teamIdsOf(state, accountId);
  if (teamIds.size === 0) return false;
  const organizationTeamIds = new Set(
    state.teams
      .filter((team) => team.organizationId === repository.organizationId)
      .map((team) => team.id),
  );
  return listRepositoryGrants(state, repository).some((grant) => (
    Boolean(grant.teamId)
    && organizationTeamIds.has(grant.teamId)
    && teamIds.has(grant.teamId)
    && grant.role === REPOSITORY_ROLE_ADMIN
  ));
}

/** True when a repository is visible to the account through any access path. */
export function repositoryAccessName(state, grant) {
  if (grant.teamId) return state.teams.find((team) => team.id === grant.teamId)?.name ?? "";
  return state.accounts.find((account) => account.id === grant.accountId)?.username ?? "";
}

/**
 * Access rows shown under "Manage access": the exact team or account name, the
 * kind of principal and the stored role label. Rows without a resolvable
 * principal are dropped so a removed object never leaves a stray entry.
 */
export function listRepositoryAccess(state, repository) {
  return listRepositoryGrants(state, repository)
    .map((grant) => {
      const name = repositoryAccessName(state, grant);
      if (!name) return null;
      return {
        id: grant.id,
        kind: grant.teamId ? "team" : "account",
        name,
        role: normalizeRepositoryRole(grant.role),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function grantById(state, repository, grantId) {
  return listRepositoryGrants(state, repository).find((grant) => grant.id === grantId) ?? null;
}

/**
 * Grants a team of the repository's organization a repository role. A team that
 * already holds a grant has that same record updated instead of duplicated.
 */
export function addTeamAccessGrant(state, repository, input = {}) {
  const teamName = typeof input.teamName === "string" ? input.teamName.trim() : "";
  const team = findTeamByName(state, repository.organizationId, teamName);
  if (!team) return { errors: { teamName: MESSAGES.teamNotFound } };

  const role = normalizeRepositoryRole(input.role);
  const existing = teamGrant(state, repository, team.id);
  if (existing) {
    existing.role = role;
    return { grant: existing, updated: true };
  }
  const grant = {
    id: randomUUID(),
    repositoryId: repository.id,
    teamId: team.id,
    role,
    createdAt: new Date().toISOString(),
  };
  state.repositoryGrants.push(grant);
  return { grant };
}

/** Changes the role of one existing access record; a missing record changes nothing. */
export function updateAccessGrantRole(state, repository, grantId, input = {}) {
  const grant = grantById(state, repository, grantId);
  if (!grant) return { errors: { role: MESSAGES.accessGrantNotFound } };
  grant.role = normalizeRepositoryRole(input.role);
  return { grant };
}
