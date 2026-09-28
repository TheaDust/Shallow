import { randomUUID } from "node:crypto";

import { makeAccount, validateUsername } from "./accounts.mjs";

const TEAM_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEAM_NAME_MAX = 50;
const DISPLAY_NAME_MAX = 100;

const REPO_ROLE_RANK = new Map([
  ["read", 1],
  ["triage", 2],
  ["write", 3],
  ["maintain", 4],
  ["admin", 5],
]);

export function validateOrganizationName(value) {
  return validateUsername(value);
}

export function validateDisplayName(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= DISPLAY_NAME_MAX;
}

export function validateTeamName(value) {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > TEAM_NAME_MAX) return false;
  return TEAM_NAME_PATTERN.test(value);
}

/**
 * Seeds the shared organization/repository/team records used by the REQ-2
 * scenarios. Only runs when the organizations collection is empty so user
 * modifications survive restarts. Also provisions the `bob-reviewer` and
 * `carol-dev` accounts used as an organization member and as an account
 * outside the repository collaborator scope.
 */
export function seedOrganizations(state) {
  if (state.organizations.length > 0) return;

  let alice = state.accounts.find((account) => account.username === "alice-dev");
  let bob = state.accounts.find((account) => account.username === "bob-reviewer");
  if (!bob) {
    bob = makeAccount({
      username: "bob-reviewer",
      email: "bob.reviewer@example.test",
      password: "Valid-password-123!",
    });
    state.accounts.push(bob);
  }
  if (!state.accounts.some((account) => account.username === "carol-dev")) {
    state.accounts.push(makeAccount({
      username: "carol-dev",
      email: "carol.dev@example.test",
      password: "Valid-password-123!",
    }));
  }
  if (!alice) {
    alice = state.accounts.find((account) => account.username === "alice-dev");
  }

  const now = new Date().toISOString();
  const organization = {
    id: `org_${randomUUID()}`,
    name: "acme-demo",
    displayName: "Acme Demo",
    createdAt: now,
  };
  state.organizations.push(organization);

  state.organizationMembers.push(
    { organizationId: organization.id, accountId: alice.id, role: "owner", createdAt: now },
    { organizationId: organization.id, accountId: bob.id, role: "member", createdAt: now },
  );

  state.repositories.push(
    {
      id: `repo_${randomUUID()}`,
      ownerId: organization.id,
      ownerType: "organization",
      name: "acme-docs",
      description: "Documentation for Acme Demo",
      visibility: "public",
      defaultBranch: "main",
      creatorAccountId: alice.id,
      sourceRepositoryId: null,
      createdAt: now,
      updatedAt: now,
      files: [
        { name: "README.md", content: "# Acme Docs\n\nDocumentation for the Acme Demo platform.\n\nThe search flow is documented in this repository.\n" },
      ],
    },
    {
      id: `repo_${randomUUID()}`,
      ownerId: organization.id,
      ownerType: "organization",
      name: "acme-internal",
      description: "Internal plans for Acme Demo",
      visibility: "private",
      defaultBranch: "main",
      creatorAccountId: alice.id,
      sourceRepositoryId: null,
      createdAt: now,
      updatedAt: now,
      files: [
        { name: "README.md", content: "# Acme Internal\n\nInternal plans for Acme Demo." },
      ],
    },
  );

  const teams = [
    { name: "platform-team", description: "Platform work", parentName: null },
    { name: "frontend-team", description: "Frontend work", parentName: "platform-team" },
    { name: "frontend-child", description: "Frontend subteam", parentName: "frontend-team" },
    { name: "docs-team", description: "Documentation work", parentName: null },
  ];
  const createdTeams = [];
  for (const team of teams) {
    const parent = team.parentName
      ? createdTeams.find((candidate) => candidate.name === team.parentName)
      : null;
    const record = {
      id: `team_${randomUUID()}`,
      organizationId: organization.id,
      name: team.name,
      description: team.description,
      parentTeamId: parent ? parent.id : null,
      creatorAccountId: alice.id,
      createdAt: now,
    };
    createdTeams.push(record);
    state.teams.push(record);
  }
}

export function createOrganization(state, { accountId, name, displayName } = {}) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const errors = {};

  const nameValid = validateOrganizationName(trimmedName);
  if (!nameValid) {
    errors.name = "Organization name format is invalid";
  }
  if (nameValid) {
    const exists = state.organizations.some((candidate) => candidate.name === trimmedName);
    if (exists) {
      errors.name = "Organization name already exists";
    }
  }
  if (!validateDisplayName(displayName)) {
    errors.displayName = "Display name is required";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const organization = {
    id: `org_${randomUUID()}`,
    name: trimmedName,
    displayName: displayName.trim(),
    createdAt: new Date().toISOString(),
  };
  state.organizations.push(organization);
  state.organizationMembers.push({
    organizationId: organization.id,
    accountId,
    role: "owner",
    createdAt: new Date().toISOString(),
  });
  return { ok: true, organization };
}

export function findOrganization(state, name) {
  return state.organizations.find((candidate) => candidate.name === name) ?? null;
}

export function organizationRole(state, organizationId, accountId) {
  if (!accountId) return null;
  const membership = state.organizationMembers.find(
    (candidate) => candidate.organizationId === organizationId && candidate.accountId === accountId,
  );
  return membership ? membership.role : null;
}

export function listOrganizationsForAccount(state, accountId) {
  return state.organizations
    .filter((organization) =>
      state.organizationMembers.some(
        (candidate) => candidate.organizationId === organization.id && candidate.accountId === accountId,
      ),
    )
    .map((organization) => ({
      name: organization.name,
      displayName: organization.displayName,
      role: organizationRole(state, organization.id, accountId),
    }));
}

export function listOrganizationMembers(state, organizationId) {
  return state.organizationMembers
    .filter((candidate) => candidate.organizationId === organizationId)
    .map((membership) => {
      const account = state.accounts.find((candidate) => candidate.id === membership.accountId);
      return { username: account?.username ?? membership.accountId, role: membership.role };
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

export function isOrganizationMember(state, organizationId, accountId) {
  return organizationRole(state, organizationId, accountId) !== null;
}

/**
 * Directly adds an existing account (by username or verified email) as an
 * organization Member or Owner. There is no invitation or pending state; the
 * relationship is stored immediately. Returns { ok: true } or { ok: false,
 * errors } with field messages for duplicate/unknown/unsupported-role cases.
 */
export function addOrganizationMember(state, { organizationId, identifier, role } = {}) {
  const value = typeof identifier === "string" ? identifier.trim() : "";
  const errors = {};

  const account = state.accounts.find(
    (candidate) => candidate.username === value || candidate.email === value,
  );
  if (!account) {
    errors.identifier = "Account not found";
  } else if (isOrganizationMember(state, organizationId, account.id)) {
    errors.identifier = "Account is already a member";
  }
  if (role !== "member" && role !== "owner") {
    errors.role = "Role is invalid";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  state.organizationMembers.push({
    organizationId,
    accountId: account.id,
    role,
    createdAt: new Date().toISOString(),
  });
  return { ok: true };
}

/**
 * Removes an account from the organization. Atomically deletes the
 * organization-membership relationship, all of the account's memberships in
 * teams of the organization, and all direct grants to the account on
 * repositories of the organization. Team grants, teams, the account, its
 * personal repositories, and its relationships with other organizations are
 * untouched. The last Owner cannot be removed.
 */
export function removeOrganizationMember(state, { organizationId, username } = {}) {
  const value = typeof username === "string" ? username.trim() : "";
  const account = state.accounts.find((candidate) => candidate.username === value);
  if (!account) return { ok: true };

  const membership = state.organizationMembers.find(
    (candidate) => candidate.organizationId === organizationId && candidate.accountId === account.id,
  );
  if (!membership) return { ok: true };

  const ownerCount = state.organizationMembers.filter(
    (candidate) => candidate.organizationId === organizationId && candidate.role === "owner",
  ).length;
  if (membership.role === "owner" && ownerCount <= 1) {
    return { ok: false, errors: { username: "The last Owner cannot be removed" } };
  }

  const teamIds = new Set(
    state.teams
      .filter((team) => team.organizationId === organizationId)
      .map((team) => team.id),
  );
  const repositoryIds = new Set(
    state.repositories
      .filter((repo) => repo.ownerId === organizationId && repo.ownerType === "organization")
      .map((repo) => repo.id),
  );

  state.organizationMembers = state.organizationMembers.filter(
    (candidate) => !(candidate.organizationId === organizationId && candidate.accountId === account.id),
  );
  state.teamMembers = state.teamMembers.filter(
    (candidate) => !(teamIds.has(candidate.teamId) && candidate.accountId === account.id),
  );
  state.repoGrants = state.repoGrants.filter(
    (candidate) =>
      !(
        repositoryIds.has(candidate.repositoryId) &&
        candidate.subjectType === "account" &&
        candidate.subjectId === account.id
      ),
  );
  return { ok: true };
}

/**
 * Lists the direct role grants on one repository with subject names resolved
 * for display (account usernames and team names).
 */
export function listRepoGrants(state, repositoryId) {
  return state.repoGrants
    .filter((grant) => grant.repositoryId === repositoryId)
    .map((grant) => {
      let subjectName = null;
      if (grant.subjectType === "account") {
        subjectName = state.accounts.find((account) => account.id === grant.subjectId)?.username ?? null;
      } else if (grant.subjectType === "team") {
        subjectName = state.teams.find((team) => team.id === grant.subjectId)?.name ?? null;
      }
      const grantor = state.accounts.find((account) => account.id === grant.grantorAccountId);
      return {
        subjectType: grant.subjectType,
        subjectName,
        role: grant.role,
        grantorUsername: grantor?.username ?? null,
        createdAt: grant.createdAt,
      };
    })
    .filter((grant) => grant.subjectName !== null)
    .sort((a, b) => String(a.subjectName).localeCompare(String(b.subjectName)));
}

function resolveGrantSubject(state, organizationId, subjectType, subject) {
  const errors = {};
  let subjectId = null;
  const value = typeof subject === "string" ? subject.trim() : "";
  if (subjectType === "account") {
    const account = state.accounts.find((candidate) => candidate.username === value);
    if (!account) {
      errors.subject = "Account not found";
    } else if (!isOrganizationMember(state, organizationId, account.id)) {
      errors.subject = "Account is not a member of this organization";
    } else {
      subjectId = account.id;
    }
  } else if (subjectType === "team") {
    const team = state.teams.find(
      (candidate) => candidate.organizationId === organizationId && candidate.name === value,
    );
    if (!team) {
      errors.subject = "Team not found";
    } else {
      subjectId = team.id;
    }
  } else {
    errors.subject = "Subject type is invalid";
  }
  return { errors, subjectId };
}

/**
 * Stores exactly one direct role grant per subject and repository: granting
 * the same role again replaces the existing record instead of creating a
 * second one, and changing the role replaces the original role.
 */
export function setRepoGrant(state, { organizationId, repositoryId, grantorAccountId, subjectType, subject, role } = {}) {
  const errors = {};
  const normalizedRole = typeof role === "string" ? role.toLowerCase() : "";
  if (!REPO_ROLE_RANK.has(normalizedRole)) {
    errors.role = "Role is invalid";
  }
  const resolved = resolveGrantSubject(state, organizationId, subjectType, subject);
  Object.assign(errors, resolved.errors);

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const existing = state.repoGrants.find(
    (candidate) =>
      candidate.repositoryId === repositoryId &&
      candidate.subjectType === subjectType &&
      candidate.subjectId === resolved.subjectId,
  );
  const now = new Date().toISOString();
  if (existing) {
    existing.role = normalizedRole;
    existing.grantorAccountId = grantorAccountId;
    existing.updatedAt = now;
  } else {
    state.repoGrants.push({
      repositoryId,
      subjectType,
      subjectId: resolved.subjectId,
      role: normalizedRole,
      grantorAccountId,
      createdAt: now,
    });
  }
  return { ok: true };
}

/**
 * Replaces the role of an existing grant (upsert semantics: never creates a
 * second record for the same subject and repository).
 */
export function updateRepoGrantRole(state, { repositoryId, subjectType, subjectId, role } = {}) {
  const normalizedRole = typeof role === "string" ? role.toLowerCase() : "";
  if (!REPO_ROLE_RANK.has(normalizedRole)) {
    return { ok: false, errors: { role: "Role is invalid" } };
  }
  const existing = state.repoGrants.find(
    (candidate) =>
      candidate.repositoryId === repositoryId &&
      candidate.subjectType === subjectType &&
      candidate.subjectId === subjectId,
  );
  if (!existing) {
    return { ok: false, errors: { role: "Grant not found" } };
  }
  existing.role = normalizedRole;
  existing.updatedAt = new Date().toISOString();
  return { ok: true };
}

function directGrantRole(state, repositoryId, accountId) {
  const grant = state.repoGrants.find(
    (candidate) =>
      candidate.repositoryId === repositoryId &&
      candidate.subjectType === "account" &&
      candidate.subjectId === accountId,
  );
  return grant ? grant.role : null;
}

/**
 * Effective repository role: the highest among Admin from organization Owner
 * status, a direct account grant, and direct team memberships in granted
 * teams. Team hierarchy does not propagate membership or authorization.
 */
export function effectiveRepositoryRole(state, accountId, repository) {
  if (!accountId || !repository) return null;
  let best = 0;
  if (repository.ownerType === "organization") {
    if (organizationRole(state, repository.ownerId, accountId) === "owner") {
      best = REPO_ROLE_RANK.get("admin");
    }
  } else if (repository.ownerType === "account" && repository.ownerId === accountId) {
    best = REPO_ROLE_RANK.get("admin");
  }
  const direct = directGrantRole(state, repository.id, accountId);
  if (direct) {
    best = Math.max(best, REPO_ROLE_RANK.get(direct) ?? 0);
  }
  for (const role of teamGrantRoles(state, repository.id, accountId)) {
    best = Math.max(best, REPO_ROLE_RANK.get(role) ?? 0);
  }
  if (best === 0) return null;
  for (const [role, rank] of REPO_ROLE_RANK) {
    if (rank === best) return role;
  }
  return null;
}

function teamGrantRoles(state, repositoryId, accountId) {
  const teamIds = new Set(
    state.teamMembers
      .filter((candidate) => candidate.accountId === accountId)
      .map((candidate) => candidate.teamId),
  );
  return state.repoGrants
    .filter(
      (candidate) =>
        candidate.repositoryId === repositoryId &&
        candidate.subjectType === "team" &&
        teamIds.has(candidate.subjectId),
    )
    .map((candidate) => candidate.role);
}

/**
 * True when the account's effective repository role is at least the given
 * minimum role in the operation-specific role ladder (read < triage < write
 * < maintain < admin). Used by issue metadata operations that require Triage
 * or higher and by assignee candidate filtering.
 */
export function hasRepositoryRoleAtLeast(state, accountId, repository, minRole) {
  const role = effectiveRepositoryRole(state, accountId, repository);
  if (!role || !minRole) return false;
  return (REPO_ROLE_RANK.get(role) ?? 0) >= (REPO_ROLE_RANK.get(minRole) ?? 0);
}

/**
 * Effective repository read access: public repositories are readable by
 * everyone; a private repository is readable only by an organization Owner,
 * by an account with a direct grant, or by a direct member of a team granted
 * on that repository.
 */
export function canReadRepository(state, accountId, repository) {
  if (repository.visibility === "public") return true;
  return effectiveRepositoryRole(state, accountId, repository) !== null;
}

/**
 * Only an organization Owner or a repository Admin (effective role admin) may
 * grant or change repository access.
 */
export function canGrantRepositoryAccess(state, accountId, repository) {
  if (!accountId || !repository) return false;
  return effectiveRepositoryRole(state, accountId, repository) === "admin";
}

export function listVisibleRepositories(state, organizationId, accountId) {
  return state.repositories
    .filter(
      (repository) =>
        repository.ownerId === organizationId && repository.ownerType === "organization",
    )
    .filter((repository) => canReadRepository(state, accountId, repository))
    .map((repository) => ({
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility,
      updatedAt: repository.updatedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findRepository(state, organizationId, name) {
  return (
    state.repositories.find(
      (candidate) =>
        candidate.ownerId === organizationId &&
        candidate.ownerType === "organization" &&
        candidate.name === name,
    ) ?? null
  );
}

export function listTeams(state, organizationId) {
  return state.teams
    .filter((candidate) => candidate.organizationId === organizationId)
    .map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      parentTeamId: team.parentTeamId,
      parentName: team.parentTeamId
        ? state.teams.find((candidate) => candidate.id === team.parentTeamId)?.name ?? null
        : null,
      createdAt: team.createdAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findTeam(state, organizationId, name) {
  return (
    state.teams.find(
      (candidate) => candidate.organizationId === organizationId && candidate.name === name,
    ) ?? null
  );
}

export function listTeamMembers(state, teamId) {
  return state.teamMembers
    .filter((candidate) => candidate.teamId === teamId)
    .map((membership) => {
      const account = state.accounts.find((candidate) => candidate.id === membership.accountId);
      return { username: account?.username ?? membership.accountId };
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

export function createTeam(state, { organizationId, accountId, name, description, parentTeamId } = {}) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedDescription = typeof description === "string" ? description.trim() : "";
  const errors = {};

  if (!validateTeamName(trimmedName)) {
    errors.name = "Team name format is invalid";
  } else if (state.teams.some((candidate) => candidate.organizationId === organizationId && candidate.name === trimmedName)) {
    errors.name = "Team name already exists";
  }

  let resolvedParent = null;
  if (parentTeamId) {
    resolvedParent = state.teams.find(
      (candidate) => candidate.id === parentTeamId && candidate.organizationId === organizationId,
    );
    if (!resolvedParent) {
      errors.parentTeam = "Parent team does not belong to this organization";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const team = {
    id: `team_${randomUUID()}`,
    organizationId,
    name: trimmedName,
    description: trimmedDescription,
    parentTeamId: resolvedParent ? resolvedParent.id : null,
    creatorAccountId: accountId,
    createdAt: new Date().toISOString(),
  };
  state.teams.push(team);
  return { ok: true, team };
}

export function addTeamMember(state, { organizationId, teamId, username } = {}) {
  const value = typeof username === "string" ? username.trim() : "";
  const errors = {};

  const account = state.accounts.find((candidate) => candidate.username === value);
  if (!account) {
    errors.username = "Account not found";
  } else if (!isOrganizationMember(state, organizationId, account.id)) {
    errors.username = "Account is not a member of this organization";
  } else if (state.teamMembers.some((candidate) => candidate.teamId === teamId && candidate.accountId === account.id)) {
    errors.username = "Account is already a member";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  state.teamMembers.push({
    teamId,
    accountId: account.id,
    createdAt: new Date().toISOString(),
  });
  return { ok: true };
}

export function removeTeamMember(state, { teamId, username } = {}) {
  const value = typeof username === "string" ? username.trim() : "";
  const account = state.accounts.find((candidate) => candidate.username === value);
  if (!account) return { ok: true };
  const index = state.teamMembers.findIndex(
    (candidate) => candidate.teamId === teamId && candidate.accountId === account.id,
  );
  if (index !== -1) {
    state.teamMembers.splice(index, 1);
  }
  return { ok: true };
}

/**
 * Changes the parent team of an existing team. The parent must belong to the
 * same organization and must not be the team itself or one of its descendants
 * (a direct or indirect cycle).
 */
export function setTeamParent(state, { organizationId, teamId, parentTeamId } = {}) {
  const team = state.teams.find(
    (candidate) => candidate.id === teamId && candidate.organizationId === organizationId,
  );
  if (!team) return { ok: false, errors: { parentTeam: "Team not found" } };

  if (!parentTeamId) {
    team.parentTeamId = null;
    return { ok: true };
  }

  const parent = state.teams.find(
    (candidate) => candidate.id === parentTeamId && candidate.organizationId === organizationId,
  );
  if (!parent) {
    return { ok: false, errors: { parentTeam: "Parent team does not belong to this organization" } };
  }

  // Walk the parent chain from the candidate parent; reaching the team means
  // the candidate is the team itself or one of its descendants.
  let cursor = parent;
  while (cursor) {
    if (cursor.id === teamId) {
      return { ok: false, errors: { parentTeam: "Cyclic team hierarchy is not allowed" } };
    }
    cursor = cursor.parentTeamId
      ? state.teams.find((candidate) => candidate.id === cursor.parentTeamId) ?? null
      : null;
  }

  team.parentTeamId = parent.id;
  return { ok: true };
}
