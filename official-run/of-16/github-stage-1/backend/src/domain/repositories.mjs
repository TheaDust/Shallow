import { ORGANIZATION_ROLE_OWNER, organizationRoleOf } from "./organizations.mjs";

export const REPOSITORY_VISIBILITY_PUBLIC = "public";
export const REPOSITORY_VISIBILITY_PRIVATE = "private";

export function toPublicRepository(repository) {
  if (!repository) return null;
  return {
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility,
    updatedAt: repository.updatedAt,
    createdAt: repository.createdAt,
  };
}

function normalizeKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function findRepository(state, organizationId, name) {
  const needle = normalizeKey(name);
  if (!needle) return null;
  return state.repositories.find((repository) => (
    repository.organizationId === organizationId && normalizeKey(repository.name) === needle
  )) ?? null;
}

export function listOrganizationRepositories(state, organizationId) {
  return state.repositories.filter((repository) => repository.organizationId === organizationId);
}

function directGrantExists(state, repository, accountId) {
  return state.repositoryGrants.some((grant) => (
    grant.repositoryId === repository.id && grant.accountId === accountId
  ));
}

function teamGrantExists(state, repository, accountId) {
  const teamIds = new Set(
    state.teamMembers
      .filter((membership) => membership.accountId === accountId)
      .map((membership) => membership.teamId),
  );
  if (teamIds.size === 0) return false;
  const organizationTeamIds = new Set(
    state.teams
      .filter((team) => team.organizationId === repository.organizationId)
      .map((team) => team.id),
  );
  return state.repositoryGrants.some((grant) => (
    grant.repositoryId === repository.id
    && Boolean(grant.teamId)
    && organizationTeamIds.has(grant.teamId)
    && teamIds.has(grant.teamId)
  ));
}

/**
 * Read access to a repository. A public repository is readable by everyone;
 * a private one only by an organization Owner, an account with a direct role
 * grant, or a member of a team that holds a grant. Organization membership on
 * its own never grants access.
 */
export function canReadRepository(state, repository, accountId) {
  if (!repository) return false;
  if (repository.visibility === REPOSITORY_VISIBILITY_PUBLIC) return true;
  if (!accountId) return false;
  if (organizationRoleOf(state, repository.organizationId, accountId) === ORGANIZATION_ROLE_OWNER) return true;
  if (directGrantExists(state, repository, accountId)) return true;
  return teamGrantExists(state, repository, accountId);
}

export function listVisibleRepositories(state, organizationId, accountId) {
  return listOrganizationRepositories(state, organizationId)
    .filter((repository) => canReadRepository(state, repository, accountId));
}
