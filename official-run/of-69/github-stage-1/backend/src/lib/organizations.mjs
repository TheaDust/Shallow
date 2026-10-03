// Organization-scoped domain queries. Every helper reads the single
// organization aggregate store, so organization data, memberships, teams, team
// memberships, repository grants and organization repositories always come
// from one snapshot.

import { highestRepositoryRole } from "./organization-rules.mjs";

export function publicOrganization(organization) {
  if (!organization) return null;
  return { name: organization.name, displayName: organization.displayName };
}

export function publicRepository(repository) {
  return {
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility,
    updatedAt: repository.updatedAt,
  };
}

export function publicTeam(team, teams) {
  const parent = team.parentTeamId ? teams.find((candidate) => candidate.id === team.parentTeamId) : null;
  return { name: team.name, parentTeamName: parent ? parent.name : null };
}

export async function findOrganizationByName(database, name) {
  if (typeof name !== "string" || name.trim().length === 0) return null;
  const key = name.trim().toLowerCase();
  const { organizations } = await database.organizationState.read();
  return organizations.find((organization) => organization.name.toLowerCase() === key) ?? null;
}

export async function findOrganizationByKey(database, key) {
  if (!key) return null;
  const { organizations } = await database.organizationState.read();
  return organizations.find((organization) => organization.name.toLowerCase() === key) ?? null;
}

export async function findAccountByUsername(database, username) {
  if (typeof username !== "string" || username.trim().length === 0) return null;
  const { accounts } = await database.accounts.read();
  return accounts.find((account) => account.username.toLowerCase() === username.trim().toLowerCase()) ?? null;
}

/**
 * Account lookup for the “Username or email” fields: the exact username or the
 * exact verified email address identifies one account.
 */
export async function findAccountByIdentifier(database, identifier) {
  const value = typeof identifier === "string" ? identifier.trim() : "";
  if (value.length === 0) return null;
  const key = value.toLowerCase();
  const { accounts } = await database.accounts.read();
  return (
    accounts.find(
      (account) => account.username.toLowerCase() === key || account.email.toLowerCase() === key,
    ) ?? null
  );
}

/** "owner", "member" or null. Organization membership is not repository access. */
export async function organizationRole(database, organizationId, accountId) {
  if (!accountId) return null;
  const { memberships } = await database.organizationState.read();
  const membership = memberships.find(
    (candidate) => candidate.organizationId === organizationId && candidate.accountId === accountId,
  );
  return membership?.role ?? null;
}

export async function listAccountMemberships(database, accountId) {
  if (!accountId) return [];
  const { memberships } = await database.organizationState.read();
  return memberships.filter((membership) => membership.accountId === accountId);
}

export async function listOrganizationMembers(database, organizationId) {
  const [{ memberships }, { accounts }] = await Promise.all([
    database.organizationState.read(),
    database.accounts.read(),
  ]);
  return memberships
    .filter((membership) => membership.organizationId === organizationId)
    .map((membership) => {
      const account = accounts.find((candidate) => candidate.id === membership.accountId);
      return account ? { username: account.username, role: membership.role } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.username.localeCompare(b.username));
}

export async function isOrganizationMember(database, organizationId, accountId) {
  return (await organizationRole(database, organizationId, accountId)) !== null;
}

/**
 * The repository permission an account effectively holds. An organization
 * Owner is an Admin on every repository of the organization; otherwise the
 * account's direct grants plus the grants of the teams it belongs to decide.
 * Organization membership by itself grants nothing.
 */
export function repositoryRoleFromState(state, repositoryId, accountId, organizationRoleName) {
  const roles = [];
  if (organizationRoleName === "owner") roles.push("admin");
  if (accountId) {
    const teamMemberships = state.teamMemberships ?? [];
    for (const grant of state.repositoryGrants ?? []) {
      if (grant.repositoryId !== repositoryId) continue;
      if (grant.accountId && grant.accountId === accountId) roles.push(grant.role);
      else if (
        grant.teamId &&
        teamMemberships.some((membership) => membership.teamId === grant.teamId && membership.accountId === accountId)
      ) {
        roles.push(grant.role);
      }
    }
  }
  return highestRepositoryRole(roles);
}

export async function repositoryRole(database, repository, accountId, organizationRoleName) {
  if (!repository) return null;
  const state = await database.organizationState.read();
  return repositoryRoleFromState(state, repository.id, accountId, organizationRoleName);
}

/**
 * Read permission on an organization repository: a public repository is
 * readable by everyone; a private one is readable only by an account whose
 * effective repository role is not null (organization Owner, a direct grant,
 * or membership in a granted team).
 */
export function canReadRepository(repository, repositoryRoleName) {
  if (!repository) return false;
  if (repository.visibility === "public") return true;
  return repositoryRoleName !== null;
}

export async function listVisibleRepositories(database, organizationId, accountId, organizationRoleName) {
  const state = await database.organizationState.read();
  return state.repositories
    .filter(
      (repository) =>
        repository.organizationId === organizationId &&
        canReadRepository(
          repository,
          repositoryRoleFromState(state, repository.id, accountId, organizationRoleName),
        ),
    )
    .map(publicRepository)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOrganizationTeams(database, organizationId) {
  const { teams } = await database.organizationState.read();
  return teams
    .filter((team) => team.organizationId === organizationId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Access rows of one repository: direct account grants and team grants, with
 * the display name of the grantee. A grant whose grantee no longer exists is
 * dropped rather than shown as a broken row.
 */
export async function listRepositoryGrants(database, repositoryId) {
  const [{ repositoryGrants, teams }, { accounts }] = await Promise.all([
    database.organizationState.read(),
    database.accounts.read(),
  ]);
  return (repositoryGrants ?? [])
    .filter((grant) => grant.repositoryId === repositoryId)
    .map((grant) => {
      const name = grant.teamId
        ? teams.find((team) => team.id === grant.teamId)?.name
        : accounts.find((account) => account.id === grant.accountId)?.username;
      if (!name) return null;
      return { id: grant.id, kind: grant.teamId ? "team" : "user", name, role: grant.role };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function findRepository(database, organizationId, name) {
  const { repositories } = await database.organizationState.read();
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  return (
    repositories.find(
      (repository) => repository.organizationId === organizationId && repository.name.toLowerCase() === key,
    ) ?? null
  );
}

/** Organizations that a visitor can discover through a public page. */
export async function listPublicOrganizations(database) {
  const { organizations, repositories } = await database.organizationState.read();
  return organizations
    .filter((organization) =>
      repositories.some((repository) => repository.organizationId === organization.id && repository.visibility === "public"),
    )
    .map(publicOrganization)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function findTeam(database, organizationId, name) {
  const { teams } = await database.organizationState.read();
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  return (
    teams.find((team) => team.organizationId === organizationId && team.name.toLowerCase() === key) ?? null
  );
}

export async function listTeamMemberUsernames(database, teamId) {
  const [{ teamMemberships }, { accounts }] = await Promise.all([
    database.organizationState.read(),
    database.accounts.read(),
  ]);
  return teamMemberships
    .filter((membership) => membership.teamId === teamId)
    .map((membership) => accounts.find((account) => account.id === membership.accountId)?.username)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * A parent-team change is a cycle when the candidate parent is the team itself
 * or any of its descendants (walking up from the candidate reaches the team).
 */
export function wouldCreateCycle(teams, teamId, parentTeamId) {
  let current = parentTeamId;
  const seen = new Set();
  while (current) {
    if (current === teamId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = teams.find((team) => team.id === current)?.parentTeamId ?? null;
  }
  return false;
}
