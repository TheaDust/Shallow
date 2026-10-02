import { randomUUID } from "node:crypto";

import { findAccountByUsername } from "./identity.mjs";
import {
  ORGANIZATION_ROLE_OWNER,
  findOrganizationById,
  findOrganizationBySlug,
  organizationRoleOf,
} from "./organizations.mjs";
import { canManageRepositoryAccess, canWriteRepositoryContent } from "./repository-access.mjs";
import {
  DEFAULT_BRANCH_NAME,
  branchNames,
  copyDefaultBranchContent,
  defaultBranchOf,
  findBranch,
  initializeRepositoryContent,
  listBranchCommits,
  listDirectoryEntries,
} from "./repository-content.mjs";
import {
  MESSAGES,
  REPOSITORY_VISIBILITIES,
  REPOSITORY_VISIBILITY_PRIVATE,
  REPOSITORY_VISIBILITY_PUBLIC,
  hasErrors,
  validateRepositoryFields,
} from "./validation.mjs";

export { REPOSITORY_VISIBILITY_PRIVATE, REPOSITORY_VISIBILITY_PUBLIC };

export const OWNER_KIND_ORGANIZATION = "organization";
export const OWNER_KIND_ACCOUNT = "account";

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

export function findAccountRepository(state, accountId, name) {
  const needle = normalizeKey(name);
  if (!needle) return null;
  return state.repositories.find((repository) => (
    repository.ownerAccountId === accountId && normalizeKey(repository.name) === needle
  )) ?? null;
}

export function findUserRepository(state, username, name) {
  const account = findAccountByUsername(state, username);
  if (!account) return null;
  return findAccountRepository(state, account.id, name);
}

export function listAccountRepositories(state, accountId) {
  return state.repositories.filter((repository) => repository.ownerAccountId === accountId);
}

/**
 * The owner of a repository resolved for display and URLs. An organization
 * repository reports its organization (slug = URL identifier), a personal one
 * the owning account (slug = username).
 */
export function repositoryOwner(state, repository) {
  if (!repository) return null;
  if (repository.organizationId) {
    const organization = findOrganizationById(state, repository.organizationId);
    if (!organization) return null;
    return {
      kind: OWNER_KIND_ORGANIZATION,
      name: organization.name,
      slug: organization.slug,
      organizationId: organization.id,
    };
  }
  const account = state.accounts.find((candidate) => candidate.id === repository.ownerAccountId) ?? null;
  if (!account) return null;
  return {
    kind: OWNER_KIND_ACCOUNT,
    name: account.username,
    slug: account.username,
    accountId: account.id,
  };
}

function accountOwnerRef(account) {
  if (!account) return null;
  return {
    kind: OWNER_KIND_ACCOUNT,
    name: account.username,
    slug: account.username,
    accountId: account.id,
  };
}

/**
 * Resolves an owner namespace from a request. The kind is sent explicitly by
 * the client; without one an organization slug is preferred, then a username.
 */
export function resolveRepositoryOwner(state, ownerKind, identifier) {
  const key = normalizeKey(identifier);
  if (!key) return null;
  if (ownerKind === OWNER_KIND_ACCOUNT) return accountOwnerRef(findAccountByUsername(state, key));
  if (ownerKind === OWNER_KIND_ORGANIZATION) {
    const organization = findOrganizationBySlug(state, key);
    if (!organization) return null;
    return {
      kind: OWNER_KIND_ORGANIZATION,
      name: organization.name,
      slug: organization.slug,
      organizationId: organization.id,
    };
  }
  const organization = findOrganizationBySlug(state, key);
  if (organization) {
    return {
      kind: OWNER_KIND_ORGANIZATION,
      name: organization.name,
      slug: organization.slug,
      organizationId: organization.id,
    };
  }
  return accountOwnerRef(findAccountByUsername(state, key));
}

/** The personal namespace of an account, used when no owner is submitted. */
export function personalOwner(account) {
  return accountOwnerRef(account);
}

/** A repository name only has to be unique inside its owner namespace. */
export function isRepositoryNameTaken(state, owner, name) {
  const needle = normalizeKey(name);
  if (!owner || !needle) return false;
  return state.repositories.some((repository) => {
    if (normalizeKey(repository.name) !== needle) return false;
    if (owner.kind === OWNER_KIND_ORGANIZATION) return repository.organizationId === owner.organizationId;
    return repository.ownerAccountId === owner.accountId;
  });
}

/**
 * Creation permission of one namespace: an account may always create inside its
 * own personal namespace and only as organization Owner inside an organization.
 */
export function canCreateRepositoryIn(state, account, owner) {
  if (!account || !owner) return false;
  if (owner.kind === OWNER_KIND_ACCOUNT) return owner.accountId === account.id;
  return organizationRoleOf(state, owner.organizationId, account.id) === ORGANIZATION_ROLE_OWNER;
}

/**
 * Whether the account maintains the repository (Settings): the owner of a
 * personal repository, or an organization Owner / repository Admin for an
 * organization repository.
 */
export function canManageRepository(state, repository, accountId) {
  if (!repository || !accountId) return false;
  if (repository.ownerAccountId && repository.ownerAccountId === accountId) return true;
  return canManageRepositoryAccess(state, repository, accountId);
}

/**
 * Whether the account may create repository content (a new commit or branch).
 * The personal owner and an organization Owner always may; a grant only when
 * it stores Write, Maintain or Admin. Read and Triage browse without writing.
 */
export function canWriteRepository(state, repository, accountId) {
  if (!repository || !accountId) return false;
  if (repository.ownerAccountId && repository.ownerAccountId === accountId) return true;
  if (repository.organizationId
    && organizationRoleOf(state, repository.organizationId, accountId) === ORGANIZATION_ROLE_OWNER) {
    return true;
  }
  return canWriteRepositoryContent(state, repository, accountId);
}

function directGrantExists(state, repository, accountId) {
  return state.repositoryGrants.some((grant) => (
    grant.repositoryId === repository.id && grant.accountId === accountId
  ));
}

function teamGrantExists(state, repository, accountId) {
  // Team grants only exist inside the organization that owns the repository.
  if (!repository.organizationId) return false;
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
 * Read access to a repository. A public repository is readable by everyone; a
 * private one only by its personal owner, an organization Owner, an account
 * with a direct role grant, or a member of a team that holds a grant.
 * Organization membership on its own never grants access.
 */
export function canReadRepository(state, repository, accountId) {
  if (!repository) return false;
  if (repository.visibility === REPOSITORY_VISIBILITY_PUBLIC) return true;
  if (!accountId) return false;
  if (repository.ownerAccountId && repository.ownerAccountId === accountId) return true;
  if (repository.organizationId
    && organizationRoleOf(state, repository.organizationId, accountId) === ORGANIZATION_ROLE_OWNER) {
    return true;
  }
  if (directGrantExists(state, repository, accountId)) return true;
  return teamGrantExists(state, repository, accountId);
}

/**
 * Repository search of the global search box. The query is matched against the
 * repository name and its owner identity, and only repositories the viewer may
 * read take part, so the same access rule that guards direct links also decides
 * what a search can reveal.
 */
export function searchRepositories(state, query, accountId = null) {
  const needle = normalizeKey(query);
  if (!needle) return [];
  return state.repositories
    .filter((repository) => canReadRepository(state, repository, accountId))
    .map((repository) => ({ repository, owner: repositoryOwner(state, repository) }))
    .filter((entry) => Boolean(entry.owner))
    .filter(({ repository, owner }) => [
      repository.name,
      `${owner.name}/${repository.name}`,
      owner.name,
      owner.slug,
    ].some((candidate) => normalizeKey(candidate).includes(needle)))
    .map(({ repository }) => repositorySummary(state, repository))
    .filter(Boolean)
    .sort((left, right) => (
      `${left.owner.name}/${left.name}`.localeCompare(`${right.owner.name}/${right.name}`)
    ));
}

export function listVisibleRepositories(state, organizationId, accountId) {
  return listOrganizationRepositories(state, organizationId)
    .filter((repository) => canReadRepository(state, repository, accountId));
}

/** List payload of one repository, including the owner for building links. */
export function repositorySummary(state, repository) {
  const owner = repositoryOwner(state, repository);
  if (!owner) return null;
  const { kind, name, slug } = owner;
  return {
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch ?? DEFAULT_BRANCH_NAME,
    updatedAt: repository.updatedAt,
    createdAt: repository.createdAt,
    owner: { kind, name, slug },
  };
}

/**
 * Overview payload of one repository: identity, owner, visibility, default
 * branch, root file entries, latest commit and (for forks) the source link. The
 * same builder serves organization and personal repositories, so every
 * repository page reads the same authoritative state.
 *
 * `requestedBranch` selects the browsing snapshot: the Code page of a selected
 * branch reads the files and history of that revision, while an unknown or
 * missing branch falls back to the repository default branch. `branches` always
 * lists every stored branch so the selector and the default-branch setting see
 * the same set.
 */
export function repositoryView(state, repository, accountId = null, requestedBranch = null) {
  const owner = repositoryOwner(state, repository);
  const fallbackName = repository.defaultBranch ?? DEFAULT_BRANCH_NAME;
  const requested = typeof requestedBranch === "string" ? requestedBranch.trim() : "";
  const branch = requested.length > 0
    ? findBranch(state, repository, requested)
    : defaultBranchOf(state, repository);
  const branchName = branch?.name ?? fallbackName;
  const commits = listBranchCommits(state, repository, branchName);
  const latest = commits[0] ?? null;
  const source = repository.forkedFromRepositoryId
    ? state.repositories.find((candidate) => candidate.id === repository.forkedFromRepositoryId) ?? null
    : null;
  const sourceOwner = source ? repositoryOwner(state, source) : null;
  const canManage = canManageRepository(state, repository, accountId);
  const { kind, name, slug } = owner ?? { kind: null, name: "", slug: "" };

  return {
    id: repository.id,
    name: repository.name,
    description: repository.description ?? "",
    visibility: repository.visibility,
    defaultBranch: fallbackName,
    branch: branchName,
    branches: branchNames(state, repository),
    updatedAt: repository.updatedAt,
    createdAt: repository.createdAt,
    owner: { kind, name, slug },
    canManage,
    canManageAccess: canManage,
    canWrite: canWriteRepository(state, repository, accountId),
    forkSource: source && sourceOwner
      ? { owner: { kind: sourceOwner.kind, name: sourceOwner.name, slug: sourceOwner.slug }, name: source.name }
      : null,
    files: listDirectoryEntries(state, repository, branchName),
    latestCommit: latest
      ? { id: latest.id, message: latest.message, authorName: latest.authorName, committedAt: latest.committedAt }
      : null,
    commitCount: commits.length,
  };
}

/**
 * Changes the visibility of one repository. Only the repository administrator
 * (`canManageRepository`: the personal owner, an organization Owner or a
 * repository Admin) may do so; an unsupported value is rejected and the stored
 * repository is left untouched, so a failed change never leaves partial state.
 */
export function changeRepositoryVisibility(state, repository, accountId, visibility) {
  if (!repository) return { missing: true };
  if (!canManageRepository(state, repository, accountId)) return { denied: true };
  if (!REPOSITORY_VISIBILITIES.includes(visibility)) {
    return { errors: { visibility: MESSAGES.repositoryVisibilityInvalid } };
  }
  repository.visibility = visibility;
  repository.updatedAt = new Date().toISOString();
  return { repository };
}

/**
 * Creates a repository in the submitted (or default personal) namespace. A
 * rejected submission returns field errors and leaves the state untouched; a
 * successful initialized repository stores the identifier, owner, visibility,
 * default branch, creator, branch, README file and initial commit together.
 */
export function createRepository(state, account, input = {}) {
  const { errors, values } = validateRepositoryFields(input);
  const owner = resolveRepositoryOwner(state, input.ownerKind, input.owner) ?? personalOwner(account);
  if (!owner) {
    errors.owner = MESSAGES.repositoryOwnerForbidden;
  } else if (!canCreateRepositoryIn(state, account, owner)) {
    errors.owner = MESSAGES.repositoryOwnerForbidden;
  }
  if (!errors.name && isRepositoryNameTaken(state, owner, values.name)) {
    errors.name = MESSAGES.repositoryNameExists;
  }
  if (hasErrors(errors)) return { errors };

  const now = new Date().toISOString();
  const repository = {
    id: randomUUID(),
    organizationId: owner.kind === OWNER_KIND_ORGANIZATION ? owner.organizationId : null,
    ownerAccountId: owner.kind === OWNER_KIND_ACCOUNT ? owner.accountId : null,
    name: values.name,
    description: values.description,
    visibility: values.visibility,
    defaultBranch: DEFAULT_BRANCH_NAME,
    forkedFromRepositoryId: null,
    createdByAccountId: account.id,
    createdAt: now,
    updatedAt: now,
  };
  state.repositories.push(repository);

  if (values.initializeWithReadme) {
    initializeRepositoryContent(state, repository, {
      authorAccountId: account.id,
      authorName: account.username,
      committedAt: now,
    });
  }
  return { repository };
}

/**
 * Creates an independent fork of a readable source repository. The source must
 * be readable by the account and the target namespace must allow creation; a
 * private source always produces a private fork. The stored source identifier,
 * owner, visibility, default branch and the copied accessible history are all
 * written in the same mutation, so a rejected fork creates nothing.
 */
export function forkRepository(state, account, source, input = {}) {
  const { errors, values } = validateRepositoryFields(input);
  const owner = resolveRepositoryOwner(state, input.ownerKind, input.owner) ?? personalOwner(account);
  if (!owner) {
    errors.owner = MESSAGES.repositoryOwnerForbidden;
  } else if (!canCreateRepositoryIn(state, account, owner)) {
    errors.owner = MESSAGES.repositoryOwnerForbidden;
  }
  if (!errors.name && isRepositoryNameTaken(state, owner, values.name)) {
    errors.name = MESSAGES.repositoryNameExists;
  }
  const visibility = source.visibility === REPOSITORY_VISIBILITY_PRIVATE
    ? REPOSITORY_VISIBILITY_PRIVATE
    : values.visibility;
  if (hasErrors(errors)) return { errors };

  const now = new Date().toISOString();
  const fork = {
    id: randomUUID(),
    organizationId: owner.kind === OWNER_KIND_ORGANIZATION ? owner.organizationId : null,
    ownerAccountId: owner.kind === OWNER_KIND_ACCOUNT ? owner.accountId : null,
    name: values.name,
    description: values.description.length > 0 ? values.description : source.description,
    visibility,
    defaultBranch: source.defaultBranch ?? DEFAULT_BRANCH_NAME,
    forkedFromRepositoryId: source.id,
    createdByAccountId: account.id,
    createdAt: now,
    updatedAt: now,
  };
  state.repositories.push(fork);
  copyDefaultBranchContent(state, source, fork);
  return { repository: fork };
}
