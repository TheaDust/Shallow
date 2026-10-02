// Permission helpers shared by the organization and repository modules.
//
// These roles are not a cumulative ladder: each operation reads the specific
// stored relationship it needs. Organization membership only makes an account
// visible to the organization; private-repository access comes from Owner
// status, a direct account grant, or direct membership of a granted team.

export const ORGANIZATION_ROLE_OWNER = "owner";
export const ORGANIZATION_ROLE_MEMBER = "member";

const REPOSITORY_ROLE_RANK = { read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };

function collection(state, key) {
  const value = state?.[key];
  return Array.isArray(value) ? value : [];
}

export function organizationsOf(state) {
  return collection(state, "organizations");
}

export function organizationByName(state, name) {
  return organizationsOf(state).find((organization) => organization.name === name) ?? null;
}

export function organizationById(state, id) {
  return organizationsOf(state).find((organization) => organization.id === id) ?? null;
}

export function membershipOf(state, organizationId, accountId) {
  if (!accountId) return null;
  return (
    collection(state, "memberships").find(
      (membership) =>
        membership.organizationId === organizationId && membership.accountId === accountId,
    ) ?? null
  );
}

export function organizationRoleOf(state, organizationId, accountId) {
  return membershipOf(state, organizationId, accountId)?.role ?? null;
}

export function isOrganizationOwner(state, organizationId, accountId) {
  return organizationRoleOf(state, organizationId, accountId) === ORGANIZATION_ROLE_OWNER;
}

export function teamsOf(state) {
  return collection(state, "teams");
}

export function teamsOfOrganization(state, organizationId) {
  return teamsOf(state).filter((team) => team.organizationId === organizationId);
}

export function teamById(state, id) {
  if (!id) return null;
  return teamsOf(state).find((team) => team.id === id) ?? null;
}

export function isTeamDescendantOf(state, teamId, candidateAncestorId) {
  const seen = new Set();
  let current = teamById(state, teamId)?.parentTeamId ?? null;
  while (current) {
    if (current === candidateAncestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = teamById(state, current)?.parentTeamId ?? null;
  }
  return false;
}

/** Team memberships are direct only; hierarchy never adds a member. */
export function teamMemberOf(state, teamId, accountId) {
  if (!accountId) return null;
  return (
    collection(state, "teamMembers").find(
      (teamMember) => teamMember.teamId === teamId && teamMember.accountId === accountId,
    ) ?? null
  );
}

export function repositoriesOfOrganization(state, organizationId) {
  return collection(state, "repositories").filter(
    (repository) =>
      repository.ownerType === "organization" && repository.ownerId === organizationId,
  );
}

/** The canonical owner name of a repository: organization identifier or username. */
export function ownerNameOf(state, repository) {
  if (!repository) return null;
  if (repository.ownerType === "organization") {
    return organizationById(state, repository.ownerId)?.name ?? null;
  }
  return (
    collection(state, "accounts").find((account) => account.id === repository.ownerId)?.username ??
    null
  );
}

/**
 * Resolves a repository from an `owner/name` address; the owner is either an
 * organization identifier or an account username. Unknown owners answer null.
 */
export function repositoryByOwnerAndName(state, ownerName, repositoryName) {
  if (typeof ownerName !== "string" || typeof repositoryName !== "string") return null;
  const organization = organizationByName(state, ownerName);
  if (organization) {
    return (
      repositoriesOfOrganization(state, organization.id).find(
        (repository) => repository.name === repositoryName,
      ) ?? null
    );
  }
  const account = collection(state, "accounts").find(
    (candidate) => candidate.username === ownerName,
  );
  if (!account) return null;
  return (
    collection(state, "repositories").find(
      (repository) =>
        repository.ownerType === "account" &&
        repository.ownerId === account.id &&
        repository.name === repositoryName,
    ) ?? null
  );
}

function highestRole(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return (REPOSITORY_ROLE_RANK[candidate] ?? 0) > (REPOSITORY_ROLE_RANK[current] ?? 0)
    ? candidate
    : current;
}

/**
 * The effective repository role of an account: the highest of Owner status on
 * the owning organization, its direct account grants, and the grants of teams
 * the account directly belongs to. Team hierarchy never propagates a grant.
 */
export function effectiveRepositoryRole(state, repository, accountId) {
  if (!repository || !accountId) return null;

  if (repository.ownerType === "account") {
    if (repository.ownerId === accountId) return "admin";
  } else if (isOrganizationOwner(state, repository.ownerId, accountId)) {
    return "admin";
  }

  const teamIds = new Set(
    collection(state, "teamMembers")
      .filter((teamMember) => teamMember.accountId === accountId)
      .map((teamMember) => teamMember.teamId),
  );

  let best = null;
  for (const grant of collection(state, "repositoryGrants")) {
    if (grant.repositoryId !== repository.id) continue;
    const matchesDirect = grant.subjectType === "account" && grant.subjectId === accountId;
    const matchesTeam = grant.subjectType === "team" && teamIds.has(grant.subjectId);
    if (matchesDirect || matchesTeam) best = highestRole(best, grant.role);
  }
  return best;
}

export function canReadRepository(state, repository, accountId) {
  if (!repository) return false;
  if (repository.visibility === "public") return true;
  return effectiveRepositoryRole(state, repository, accountId) !== null;
}

/**
 * Changing a repository's visibility is a repository-Admin operation: an
 * organization Owner or a direct/team Admin grant. Read, Triage, Write and
 * Maintain are not a cumulative ladder, so they never qualify.
 */
export function canAdministerRepository(state, repository, accountId) {
  return effectiveRepositoryRole(state, repository, accountId) === "admin";
}

/**
 * Creating a branch, or committing a file change, needs Write or higher: an
 * organization Owner, or a direct/team Write, Maintain or Admin grant. Read
 * and Triage may only browse.
 */
export function canWriteRepository(state, repository, accountId) {
  const role = effectiveRepositoryRole(state, repository, accountId);
  return role !== null && (REPOSITORY_ROLE_RANK[role] ?? 0) >= REPOSITORY_ROLE_RANK.write;
}

/**
 * Issue metadata operations (assign, label, milestone, open/close) belong to
 * Triage, Maintain and Admin. Write is deliberately not included: the role
 * names are not a cumulative ladder, so Write may edit and comment but not
 * triage. Read may only view.
 */
const ISSUE_TRIAGE_ROLES = new Set(["triage", "maintain", "admin"]);

export function canTriageRepository(state, repository, accountId) {
  return ISSUE_TRIAGE_ROLES.has(effectiveRepositoryRole(state, repository, accountId));
}

/**
 * Pull-request management roles: turning a draft into a ready-for-review pull
 * request and merging are reserved for Maintain, Admin and the organization Owner. The
 * role names are not a cumulative ladder, so Write alone never manages a pull
 * request even though it may create one.
 */
const PULL_REQUEST_MANAGE_ROLES = new Set(["maintain", "admin"]);

export function canMaintainPullRequest(state, repository, accountId) {
  return PULL_REQUEST_MANAGE_ROLES.has(effectiveRepositoryRole(state, repository, accountId));
}

/**
 * Issue-assignment eligibility: an account with at least Triage permission on
 * the repository. This is the documented minimum of the assignable-member
 * rule, so it reads the stored role against the Triage rank (Triage, Write,
 * Maintain and Admin qualify) instead of the exact role set one issue
 * operation accepts.
 */
export function canBeAssignedToIssue(state, repository, accountId) {
  const role = effectiveRepositoryRole(state, repository, accountId);
  return role !== null && (REPOSITORY_ROLE_RANK[role] ?? 0) >= REPOSITORY_ROLE_RANK.triage;
}
