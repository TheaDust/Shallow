/**
 * Repository permission rules shared by the organization repository list
 * (REQ-2-1-1), the repository overview (REQ-2-1-1 / REQ-3) and the later
 * Manage-access grants (REQ-2-3).
 *
 * Organization membership alone never grants private-repository access:
 * access comes from organization Owner status, a direct role grant on the
 * repository, or direct membership in a team that is granted on the
 * repository. Team hierarchy never propagates membership or authorization.
 */

import { findOrganization } from "./organizations.mjs";
import { protectionRuleSummary, repositoryProtectionRules } from "./branch-protection.mjs";
import {
  branchCommits,
  branchDirectory,
  branchFile,
  branchSnapshot,
  repositoryBranchSummaries,
  resolveBranchName,
} from "./repository-branches.mjs";

export const REPOSITORY_ROLES = ["Read", "Triage", "Write", "Maintain", "Admin"];

/** Roles that may submit a file change; Read and Triage may only view (REQ-4-4). */
export const COMMIT_ROLES = ["Write", "Maintain", "Admin"];

const ROLE_RANK = new Map(REPOSITORY_ROLES.map((role, index) => [role, index]));

export function isRepositoryRole(role) {
  return ROLE_RANK.has(role);
}

export function highestRepositoryRole(current, candidate) {
  if (!isRepositoryRole(candidate)) return current ?? null;
  if (!current) return candidate;
  return ROLE_RANK.get(candidate) > ROLE_RANK.get(current) ? candidate : current;
}

export function organizationMembership(data, organizationId, accountId) {
  if (!accountId) return null;
  return data.memberships.find(
    (membership) => membership.organizationId === organizationId && membership.accountId === accountId,
  ) ?? null;
}

export function isTeamMember(data, teamId, accountId) {
  if (!accountId) return false;
  return data.teamMembers.some((member) => member.teamId === teamId && member.accountId === accountId);
}

/** Highest role the account holds on the repository, or null without access. */
export function effectiveRepositoryRole(data, repository, accountId) {
  if (!accountId) return null;
  let role = null;
  if (repository.ownerType === "user" && repository.ownerId === accountId) {
    role = "Admin";
  }
  if (repository.ownerType === "organization") {
    const membership = organizationMembership(data, repository.ownerId, accountId);
    if (membership?.role === "Owner") role = highestRepositoryRole(role, "Admin");
  }
  for (const grant of repository.grants ?? []) {
    if (grant.subjectType === "account" && grant.subjectId === accountId) {
      role = highestRepositoryRole(role, grant.role);
    }
    if (grant.subjectType === "team" && isTeamMember(data, grant.subjectId, accountId)) {
      role = highestRepositoryRole(role, grant.role);
    }
  }
  return role;
}

export function canReadRepository(data, repository, accountId) {
  if (repository.visibility !== "private") return true;
  return effectiveRepositoryRole(data, repository, accountId) !== null;
}

/**
 * Whether the account may submit a file change (REQ-4-4). Write, Maintain,
 * Admin and an organization Owner qualify through their effective role; Read
 * and Triage may only view.
 */
export function canWriteRepositoryCode(data, repository, accountId) {
  return COMMIT_ROLES.includes(effectiveRepositoryRole(data, repository, accountId));
}

/**
 * Resolves an account namespace owner by username (case-insensitive) or id.
 * Unlike a member lookup this never matches an email address: an owner
 * identifier is the name people see in the repository address.
 */
export function findAccountOwner(data, identifier) {
  const raw = typeof identifier === "string" ? identifier.trim() : "";
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return data.accounts.find((account) => account.username.toLowerCase() === lower)
    ?? data.accounts.find((account) => account.id === raw)
    ?? null;
}

/**
 * The namespace a repository lives in: an organization or an individual
 * account. `name` is the value used in addresses and `displayName` the way the
 * owner is known to people (the organization display name, or the username).
 */
export function repositoryOwner(data, repository) {
  if (!repository) return null;
  if (repository.ownerType === "organization") {
    const organization = data.organizations.find((candidate) => candidate.id === repository.ownerId);
    if (!organization) return null;
    return {
      type: "organization",
      id: organization.id,
      name: organization.name,
      displayName: organization.displayName,
    };
  }
  const account = data.accounts.find((candidate) => candidate.id === repository.ownerId);
  if (!account) return null;
  return {
    type: "account",
    id: account.id,
    name: account.username,
    displayName: account.username,
  };
}

/**
 * Resolves a repository by its owner identifier (organization name/id/display
 * name, or account username/id) and the repository name, as used by the
 * repository overview, the file view and the Manage-access page (REQ-2-3,
 * REQ-3).
 */
export function findRepository(data, ownerName, repositoryName) {
  const name = typeof repositoryName === "string" ? repositoryName.trim() : "";
  if (!name) return null;
  const organization = findOrganization(data, ownerName);
  if (organization) {
    return data.repositories.find(
      (repository) => repository.ownerType === "organization"
        && repository.ownerId === organization.id
        && repository.name === name,
    ) ?? null;
  }
  const account = findAccountOwner(data, ownerName);
  if (account) {
    return data.repositories.find(
      (repository) => repository.ownerType === "user"
        && repository.ownerId === account.id
        && repository.name === name,
    ) ?? null;
  }
  return null;
}

/** Every repository of an organization namespace. */
export function organizationRepositories(data, organizationId) {
  return data.repositories.filter(
    (repository) => repository.ownerType === "organization" && repository.ownerId === organizationId,
  );
}

/** Repositories of the organization the caller has read permission on. */
export function visibleOrganizationRepositories(data, organizationId, accountId) {
  return organizationRepositories(data, organizationId)
    .filter((repository) => canReadRepository(data, repository, accountId));
}

/** Repositories of an account namespace the caller has read permission on. */
export function accountRepositories(data, accountId, viewerAccountId) {
  return data.repositories
    .filter((repository) => repository.ownerType === "user" && repository.ownerId === accountId)
    .filter((repository) => canReadRepository(data, repository, viewerAccountId));
}

/** Every repository the caller may read, whatever the namespace. */
export function readableRepositories(data, accountId) {
  return data.repositories.filter((repository) => canReadRepository(data, repository, accountId));
}

/**
 * Repository search (REQ-3-1): the name is matched case-insensitively and only
 * repositories the caller is authorized to view are returned, so a visitor
 * never sees a private repository through search.
 */
export function searchRepositories(data, query, accountId) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!needle) return [];
  return readableRepositories(data, accountId)
    .filter((repository) => repository.name.toLowerCase().includes(needle))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The files of a branch (the default branch when none is given). The stored file
 * set lives in the tree of the commit the branch points to (REQ-4).
 */
export function repositoryFiles(repository, branchName = null) {
  const branch = resolveBranchName(repository, branchName);
  return branchSnapshot(repository, branch);
}

/** The file stored at `path` on a branch, or null. */
export function findRepositoryFile(repository, path, branchName = null) {
  return branchFile(repository, resolveBranchName(repository, branchName), path);
}

/** Direct children of a directory of a branch (REQ-4-1). */
export function repositoryDirectory(repository, path, branchName = null) {
  return branchDirectory(repository, resolveBranchName(repository, branchName), path);
}

export function repositoryFullName(ownerName, repositoryName) {
  return `${ownerName}/${repositoryName}`;
}

/**
 * Read model of a repository shared by the namespace lists (REQ-2-1-1), the
 * search results (REQ-3-1) and the repository overview (REQ-3-3). The owner is
 * spelled the way people know it (`Acme Demo/acme-docs`, `alice-dev/acme-docs`)
 * while `owner` stays the identifier used in addresses.
 */
export function repositorySummary(data, repository) {
  const owner = repositoryOwner(data, repository);
  const ownerName = owner?.name ?? "";
  const ownerDisplayName = owner?.displayName ?? ownerName;
  return {
    name: repository.name,
    owner: ownerName,
    ownerType: owner?.type ?? (repository.ownerType === "organization" ? "organization" : "account"),
    ownerDisplayName,
    fullName: repositoryFullName(ownerDisplayName, repository.name),
    description: repository.description ?? "",
    visibility: repository.visibility === "private" ? "private" : "public",
    defaultBranch: repository.defaultBranch ?? "main",
    createdAt: repository.createdAt ?? null,
    updatedAt: repository.updatedAt ?? repository.createdAt ?? null,
  };
}

/** The clone values of a repository, read-only (REQ-3-2-3). */
export function repositoryCloneUrls(data, repository) {
  const owner = repositoryOwner(data, repository);
  const name = `${owner?.name ?? ""}/${repository.name}`;
  return {
    https: `https://github.local/${name}.git`,
    ssh: `git@github.local:${name}.git`,
  };
}

/**
 * Commit history of a repository, newest first. A repository created with the
 * initialization option starts with its initial commit; the record carries the
 * parent commit, author, message, time and changed files (REQ-3-2-1, REQ-4-2).
 */
/**
 * Commit history of a branch, newest first: the commits reachable from the
 * branch head through their parent links (REQ-4-2-1).
 */
export function repositoryCommits(repository, branchName = null) {
  return branchCommits(repository, resolveBranchName(repository, branchName));
}

/**
 * The source repository of a fork (REQ-3-2-2), so the fork overview can spell
 * "Forked from <source repository name>" and link back to it.
 */
export function repositoryForkSource(data, repository) {
  if (!repository?.sourceRepositoryId) return null;
  const source = data.repositories.find((candidate) => candidate.id === repository.sourceRepositoryId);
  if (!source) return null;
  const owner = repositoryOwner(data, source);
  return {
    owner: owner?.name ?? "",
    name: source.name,
    fullName: repositoryFullName(owner?.displayName ?? owner?.name ?? "", source.name),
  };
}

/**
 * The repository overview read model: identity, the viewer's role (used by the
 * settings entries), the default-branch listing and the branch references of
 * the Code page (REQ-4-1, REQ-4-3-3).
 */
export function repositoryOverview(data, repository, accountId = null) {
  const viewerRole = effectiveRepositoryRole(data, repository, accountId);
  return {
    ...repositorySummary(data, repository),
    viewerRole,
    canChangeVisibility: viewerRole === "Admin",
    // Only a repository Admin (or an organization Owner) may move the branch a
    // page reads by default (REQ-4-3-3).
    canChangeDefaultBranch: viewerRole === "Admin",
    forkedFrom: repositoryForkSource(data, repository),
    branches: repositoryBranchSummaries(repository),
    // The branch protection rules of the repository (REQ-6-1): the settings
    // page lists every stored rule with its exact branch name, and only a
    // repository Admin may create or change one.
    protectionRules: repositoryProtectionRules(repository).map(protectionRuleSummary),
    canManageBranchProtection: viewerRole === "Admin",
    canWrite: canWriteRepositoryCode(data, repository, accountId),
    files: repositoryFiles(repository).map((file) => ({ path: file.path, updatedAt: file.updatedAt ?? null })),
    entries: repositoryDirectory(repository, ""),
    cloneUrls: repositoryCloneUrls(data, repository),
  };
}
