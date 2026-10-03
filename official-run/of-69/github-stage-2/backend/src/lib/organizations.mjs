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

/** "owner", "member" or null from one state snapshot. Membership is not repository access. */
export function organizationRoleFromState(state, organizationId, accountId) {
  if (!accountId) return null;
  const membership = (state.memberships ?? []).find(
    (candidate) => candidate.organizationId === organizationId && candidate.accountId === accountId,
  );
  return membership?.role ?? null;
}

/** "owner", "member" or null. Organization membership is not repository access. */
export async function organizationRole(database, organizationId, accountId) {
  if (!accountId) return null;
  const state = await database.organizationState.read();
  return organizationRoleFromState(state, organizationId, accountId);
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
 * The repository permission an account effectively holds. A personal
 * repository's owner and an organization Owner of an organization repository
 * are Admins on it; otherwise the account's direct grants plus the grants of
 * the teams it belongs to decide. Organization membership by itself grants
 * nothing.
 */
export function repositoryRoleFromState(state, repository, accountId) {
  if (!repository) return null;
  const roles = [];
  if (accountId) {
    if (repository.ownerType === "user" && repository.ownerId === accountId) roles.push("admin");
    if (
      repository.ownerType === "organization" &&
      organizationRoleFromState(state, repository.ownerId, accountId) === "owner"
    ) {
      roles.push("admin");
    }
    const teamMemberships = state.teamMemberships ?? [];
    for (const grant of state.repositoryGrants ?? []) {
      if (grant.repositoryId !== repository.id) continue;
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

export async function repositoryRole(database, repository, accountId) {
  if (!repository) return null;
  const state = await database.organizationState.read();
  return repositoryRoleFromState(state, repository, accountId);
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

/** Organization repositories readable by the viewer of the organization page. */
export async function listVisibleRepositories(database, organizationId, accountId) {
  const state = await database.organizationState.read();
  return state.repositories
    .filter(
      (repository) =>
        repository.ownerType === "organization" &&
        repository.ownerId === organizationId &&
        canReadRepository(repository, repositoryRoleFromState(state, repository, accountId)),
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

/**
 * The owner of a repository as a `{ type, name, displayName }` reference. An
 * organization repository resolves the live organization record; a personal
 * repository names the owning account (stored as `ownerName` at creation).
 */
export function repositoryOwnerRef(state, repository) {
  if (repository.ownerType === "organization") {
    const organization = state.organizations.find((candidate) => candidate.id === repository.ownerId);
    return {
      type: "organization",
      name: organization?.name ?? repository.ownerName,
      displayName: organization?.displayName ?? repository.ownerName,
    };
  }
  return { type: "user", name: repository.ownerName, displayName: repository.ownerName };
}

/**
 * One repository together with its owner. Search results, discovery lists and
 * repository pages all describe a repository this way, so the owner metadata
 * next to a result always matches the opened page.
 */
export function repositoryResult(state, repository) {
  return {
    name: repository.name,
    owner: repositoryOwnerRef(state, repository),
    visibility: repository.visibility,
    description: repository.description,
    updatedAt: repository.updatedAt,
  };
}

/** The full detail summary of one repository, including its source fork link. */
export function repositorySummary(state, repository) {
  const source = repository.forkedFrom
    ? state.repositories.find((candidate) => candidate.id === repository.forkedFrom)
    : null;
  return {
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
    forkedFrom: source
      ? { owner: repositoryOwnerRef(state, source), name: source.name, repositoryId: source.id }
      : null,
  };
}

/**
 * Every repository the account may read, across all organizations, using the
 * same rule as the organization repository list: a public repository is always
 * readable and a private one only with an effective repository role (an
 * organization Owner, a direct grant or a granted team membership).
 */
export async function listReadableRepositories(database, accountId) {
  const state = await database.organizationState.read();
  return state.repositories
    .filter((repository) => canReadRepository(repository, repositoryRoleFromState(state, repository, accountId)))
    .map((repository) => repositoryResult(state, repository))
    .filter(Boolean)
    .sort((a, b) => `${a.owner.name}/${a.name}`.localeCompare(`${b.owner.name}/${b.name}`));
}

/**
 * Repository-oriented search: the query matches the repository name or its
 * qualified `owner/name` form, and the readable set is the same one the lists
 * and the direct repository pages use.
 */
export async function searchReadableRepositories(database, accountId, rawQuery) {
  const query = typeof rawQuery === "string" ? rawQuery.trim().toLowerCase() : "";
  if (!query) return [];
  const repositories = await listReadableRepositories(database, accountId);
  return repositories.filter((repository) =>
    [
      repository.name,
      `${repository.owner.name}/${repository.name}`,
      `${repository.owner.displayName}/${repository.name}`,
    ].some((candidate) => candidate.toLowerCase().includes(query)),
  );
}

export async function findRepository(database, organizationId, name) {
  const state = await database.organizationState.read();
  return findOrganizationRepository(state, organizationId, name);
}

/** One organization repository from a state snapshot, matched case-insensitively. */
export function findOrganizationRepository(state, organizationId, name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  return (
    state.repositories.find(
      (repository) =>
        repository.ownerType === "organization" &&
        repository.ownerId === organizationId &&
        repository.name.toLowerCase() === key,
    ) ?? null
  );
}

/** One repository looked up by owner id and name, whatever the owner type. */
export function findRepositoryByOwner(state, ownerType, ownerId, name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  return (
    state.repositories.find(
      (repository) =>
        repository.ownerType === ownerType &&
        repository.ownerId === ownerId &&
        repository.name.toLowerCase() === key,
    ) ?? null
  );
}

/**
 * A repository addressed as `owner/name`: the owner name first resolves as an
 * organization, then as an account, so the same `/api/repositories/:owner/:repo`
 * shape serves organization and personal repositories alike.
 */
export async function findRepositoryByOwnerName(database, ownerName, repositoryName) {
  const state = await database.organizationState.read();
  const ownerKey = typeof ownerName === "string" ? ownerName.trim().toLowerCase() : "";
  const organization = state.organizations.find((candidate) => candidate.name.toLowerCase() === ownerKey);
  if (organization) {
    const repository = findOrganizationRepository(state, organization.id, repositoryName);
    if (repository) return repository;
  }
  const account = await findAccountByUsername(database, ownerName);
  if (!account) return null;
  return findRepositoryByOwner(state, "user", account.id, repositoryName);
}

/** Organizations that a visitor can discover through a public page. */
export async function listPublicOrganizations(database) {
  const { organizations, repositories } = await database.organizationState.read();
  return organizations
    .filter((organization) =>
      repositories.some(
        (repository) =>
          repository.ownerType === "organization" &&
          repository.ownerId === organization.id &&
          repository.visibility === "public",
      ),
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

/**
 * The default-branch README of a repository as `{ path, content }`, or null
 * when the branch has no README. A created or forked repository keeps its
 * README on the default branch, so this is the file the overview links.
 */
export function readmeFile(state, repository) {
  if (!repository || !repository.defaultBranch) return null;
  const files = (state.files ?? []).filter(
    (file) => file.repositoryId === repository.id && file.branch === repository.defaultBranch,
  );
  const readme =
    files.find((file) => file.path.toLowerCase() === "readme.md") ??
    files.find((file) => file.path.split("/").at(-1).toLowerCase().startsWith("readme"));
  return readme ? { path: readme.path, content: readme.content } : null;
}

/** The commits of one branch, newest first, as the repository pages display them. */
export async function repositoryCommits(database, repository) {
  if (!repository || !repository.defaultBranch) return [];
  const [{ commits }, { accounts }] = await Promise.all([
    database.organizationState.read(),
    database.accounts.read(),
  ]);
  return (commits ?? [])
    .filter((commit) => commit.repositoryId === repository.id && commit.branch === repository.defaultBranch)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((commit) => ({
      id: commit.id,
      message: commit.message,
      author: accounts.find((account) => account.id === commit.authorId)?.username ?? "Unknown",
      createdAt: commit.createdAt,
    }));
}

/** The files of one branch, sorted by path, as the repository pages display them. */
export function repositoryFiles(state, repository, branch = repository.defaultBranch) {
  return (state.files ?? [])
    .filter((file) => file.repositoryId === repository.id && file.branch === branch)
    .sort((a, b) => a.path.localeCompare(b.path));
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
