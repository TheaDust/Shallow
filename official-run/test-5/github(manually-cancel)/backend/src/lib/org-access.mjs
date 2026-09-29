import { REPOSITORY_ROLES, organizationKey } from "../domain/organizations.mjs";
import { repositoryKey } from "../domain/repositories.mjs";

/**
 * Trusted permission boundary for organization resources (REQ-2 folder rules).
 * Organization membership grants visibility and candidate status only: a private
 * repository is readable by an organization Owner, an account with a direct grant,
 * or a direct member of a team that holds a grant. Team hierarchy never propagates
 * membership or authorization.
 */

/** Read < Triage < Write < Maintain < Admin. */
const REPOSITORY_ROLE_RANK = { read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };

export function repositoryRoleRank(role) {
  return REPOSITORY_ROLE_RANK[role] ?? 0;
}

export function organizationKeyOf(value) {
  return organizationKey(value);
}

export function findOrganizationById(organizations, organizationId) {
  return organizations.find((organization) => organization.id === organizationId) ?? null;
}

export function findOrganizationByName(organizations, name) {
  const key = organizationKey(name);
  if (!key) return null;
  return organizations.find((organization) => organizationKey(organization.name) === key) ?? null;
}

export function membershipFor(memberships, organizationId, accountId) {
  if (!accountId) return null;
  return (
    memberships.find(
      (membership) =>
        membership.organizationId === organizationId && membership.accountId === accountId,
    ) ?? null
  );
}

export function organizationRole(memberships, organizationId, accountId) {
  return membershipFor(memberships, organizationId, accountId)?.role ?? null;
}

export function isOrganizationOwner(memberships, organizationId, accountId) {
  return organizationRole(memberships, organizationId, accountId) === "owner";
}

export function teamsOfOrganization(teams, organizationId) {
  return teams.filter((team) => team.organizationId === organizationId);
}

export function teamMemberIds(team) {
  return Array.isArray(team.memberIds) ? team.memberIds : [];
}

export function isTeamMember(team, accountId) {
  return Boolean(accountId) && teamMemberIds(team).includes(accountId);
}

export function findTeamByName(teams, organizationId, name) {
  const key = organizationKey(name);
  if (!key) return null;
  return (
    teams.find(
      (team) => team.organizationId === organizationId && organizationKey(team.name) === key,
    ) ?? null
  );
}

export function organizationMemberIds(memberships, organizationId) {
  return memberships
    .filter((membership) => membership.organizationId === organizationId)
    .map((membership) => membership.accountId);
}

/**
 * Resolves the owner of a repository address: an organization first (its name may
 * contain spaces), otherwise an individual account by username. Returns
 * `{ type, id, name }` or null when no namespace of that name exists.
 */
export function resolveRepositoryOwner({ organizations, accounts }, ownerName) {
  const organization = findOrganizationByName(organizations, ownerName);
  if (organization) {
    return { type: "organization", id: organization.id, name: organization.name };
  }
  const username = String(ownerName ?? "").trim().toLowerCase();
  if (!username) return null;
  const account = accounts.find((candidate) => candidate.username === username) ?? null;
  return account ? { type: "account", id: account.id, name: account.username } : null;
}

/** The repository of that owner whose name matches (case-insensitively). */
export function findRepositoryForOwner(repositories, owner, name) {
  const key = repositoryKey(name);
  if (!key) return null;
  return (
    repositories.find(
      (repository) =>
        repository.ownerType === owner.type &&
        repository.ownerId === owner.id &&
        repositoryKey(repository.name) === key,
    ) ?? null
  );
}

/** True when `ownerName` is already used in that namespace (name uniqueness). */
export function repositoryNameTaken(repositories, owner, name) {
  return findRepositoryForOwner(repositories, owner, name) !== null;
}

/**
 * Permission to create a repository in a namespace (REQ-3-2-1): a personal
 * namespace only accepts its own account, an organization namespace only accepts
 * an organization Owner. Ordinary membership is never enough.
 */
export function canCreateRepositoryInNamespace({ memberships, owner, accountId }) {
  if (!accountId) return false;
  if (owner.type === "account") return owner.id === accountId;
  return isOrganizationOwner(memberships, owner.id, accountId);
}

/**
 * Effective repository role of an account: the highest of Admin from organization
 * Owner status and every still-valid direct grant and team grant of the account
 * itself (REQ-2-3). Team hierarchy is display-only and never propagates access.
 * Returns null when the account holds no role for the repository.
 */
export function effectiveRepositoryRole({ repository, grants, teams, memberships, accountId }) {
  if (!accountId) return null;
  let best = null;
  const consider = (role) => {
    if (repositoryRoleRank(role) > repositoryRoleRank(best)) best = role;
  };
  if (repository.ownerType === "account") {
    // A personal repository is owned by its account; other accounts only ever get
    // an explicitly granted direct role (REQ-3 access rules).
    if (repository.ownerId === accountId) return "admin";
    for (const grant of grants) {
      if (grant.repositoryId !== repository.id) continue;
      if (!REPOSITORY_ROLES.includes(grant.role)) continue;
      if (grant.subjectType === "account" && grant.subjectId === accountId) consider(grant.role);
    }
    return best;
  }
  if (isOrganizationOwner(memberships, repository.ownerId, accountId)) consider("admin");
  for (const grant of grants) {
    if (grant.repositoryId !== repository.id) continue;
    if (!REPOSITORY_ROLES.includes(grant.role)) continue;
    if (grant.subjectType === "account" && grant.subjectId === accountId) {
      consider(grant.role);
    } else if (grant.subjectType === "team") {
      const team = teams.find(
        (candidate) => candidate.id === grant.subjectId && candidate.organizationId === repository.ownerId,
      );
      if (team && isTeamMember(team, accountId)) consider(grant.role);
    }
  }
  return best;
}

/** Only an organization Owner or a repository Admin may change repository access. */
export function canManageRepositoryAccess(context) {
  return effectiveRepositoryRole(context) === "admin";
}

/**
 * Effective read access to a repository record. `account-` owned repositories are
 * readable by their owner; organization repositories follow the role matrix above.
 */
export function canReadRepository(context) {
  const { repository, accountId } = context;
  if (repository.visibility !== "private") return true;
  if (!accountId) return false;
  return effectiveRepositoryRole(context) !== null;
}

/** The personal repositories owned by one account (newest name order applied by the caller). */
export function accountRepositories(repositories, accountId) {
  if (!accountId) return [];
  return repositories.filter(
    (repository) => repository.ownerType === "account" && repository.ownerId === accountId,
  );
}

/** Repositories owned by an organization that the given viewer may read. */
export function organizationRepositories(context, organizationId) {
  return context.repositories
    .filter(
      (repository) =>
        repository.ownerType === "organization" && repository.ownerId === organizationId,
    )
    .filter((repository) => canReadRepository({ ...context, repository }));
}

/**
 * True when `candidate` is `teamId` itself or sits below it in the hierarchy, i.e.
 * making `candidate` the parent of `teamId` would close a cycle.
 */
export function wouldCreateTeamCycle(teams, teamId, candidateParentId) {
  if (!candidateParentId) return false;
  if (candidateParentId === teamId) return true;
  const byId = new Map(teams.map((team) => [team.id, team]));
  const seen = new Set();
  let current = byId.get(candidateParentId);
  while (current && !seen.has(current.id)) {
    if (current.id === teamId) return true;
    seen.add(current.id);
    current = current.parentTeamId ? byId.get(current.parentTeamId) : undefined;
  }
  return false;
}
