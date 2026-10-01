// Repository creation and distribution.
//
// A repository always belongs to exactly one namespace: an account (personal
// repository) or an organization. Creating a repository with initialization
// stores the repository, its default branch, the README file and the initial
// commit inside one atomic update, so a rejected request never leaves a
// partially created repository behind. A fork is an independent copy: its
// branches and commits are new records that reference the source repository
// identifier but never share state with it.

import { randomUUID } from "node:crypto";

import {
  canReadRepository,
  isOrganizationOwner,
  organizationByName,
  ownerNameOf,
  repositoryByOwnerAndName,
} from "./access.mjs";

export const REPOSITORY_MESSAGES = {
  nameRequired: "Repository name is required",
  nameFormat: "Repository name format is invalid",
  nameExists: "Repository name already exists",
  ownerInvalid: "Owner is invalid",
  ownerDenied: "You do not have permission to create a repository for this owner",
  visibilityInvalid: "Visibility is invalid",
  descriptionTooLong: "Description is too long",
  notAuthenticated: "Not authenticated",
  notFound: "Not found",
  accessDenied: "Access denied",
};

export const REPOSITORY_NAME_MAX_LENGTH = 100;
export const REPOSITORY_DESCRIPTION_MAX_LENGTH = 350;
export const DEFAULT_BRANCH_NAME = "main";
export const README_FILE_NAME = "README.md";
export const INITIAL_COMMIT_MESSAGE = "Initial commit";

export const REPOSITORY_VISIBILITIES = ["public", "private"];

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

let clock = () => new Date().toISOString();

function collection(state, key) {
  const value = state?.[key];
  return Array.isArray(value) ? value : [];
}

/** The reason a repository name is unusable, or null when it is valid. */
export function repositoryNameError(name) {
  if (typeof name !== "string" || name.length === 0) {
    return REPOSITORY_MESSAGES.nameRequired;
  }
  if (name.length > REPOSITORY_NAME_MAX_LENGTH || !NAME_PATTERN.test(name)) {
    return REPOSITORY_MESSAGES.nameFormat;
  }
  if (name === "." || name === "..") return REPOSITORY_MESSAGES.nameFormat;
  return null;
}

/** The `owner/name` address of the repository a fork was copied from. */
export function sourceRepositorySummary(state, repository) {
  if (!repository?.sourceRepositoryId) return null;
  const source = collection(state, "repositories").find(
    (candidate) => candidate.id === repository.sourceRepositoryId,
  );
  if (!source) return null;
  const owner = ownerNameOf(state, source);
  if (!owner) return null;
  return { owner, name: source.name };
}

/** The repository payload shared by every read route. */
export function serializeRepository(state, repository) {
  return {
    id: repository.id,
    owner: ownerNameOf(state, repository),
    ownerType: repository.ownerType,
    name: repository.name,
    description: repository.description ?? "",
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch ?? null,
    createdBy: repository.createdBy ?? null,
    updatedAt: repository.updatedAt,
    source: sourceRepositorySummary(state, repository),
  };
}

function namespaceByName(state, name) {
  if (typeof name !== "string" || name.length === 0) return null;
  const account = collection(state, "accounts").find(
    (candidate) => candidate.username === name,
  );
  if (account) {
    return { ownerType: "account", ownerId: account.id, name: account.username };
  }
  const organization = organizationByName(state, name);
  if (organization) {
    return { ownerType: "organization", ownerId: organization.id, name: organization.name };
  }
  return null;
}

function repositoriesInNamespace(state, namespace) {
  return collection(state, "repositories").filter(
    (repository) =>
      repository.ownerType === namespace.ownerType && repository.ownerId === namespace.ownerId,
  );
}

/**
 * Not every namespace accepts repositories from every account: a personal
 * namespace only accepts its owner, an organization namespace only its
 * Owners. Organization membership alone is not enough.
 */
function canCreateInNamespace(state, namespace, accountId) {
  if (!accountId) return false;
  if (namespace.ownerType === "account") return namespace.ownerId === accountId;
  return isOrganizationOwner(state, namespace.ownerId, accountId);
}

function wantedVisibility(value, fallback) {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  return REPOSITORY_VISIBILITIES.includes(normalized) ? normalized : null;
}

function shortSha() {
  return randomUUID().replace(/-/g, "").slice(0, 7);
}

function readmeContent(name, description) {
  const lines = [`# ${name}`, ""];
  if (description.length > 0) lines.push(description, "");
  return lines.join("\n");
}

export function createRepositoryService(store) {
  function signInRequired(accountId) {
    return accountId ? null : { unauthorized: true };
  }

  function rejectField(field, message) {
    return { ok: false, fieldErrors: { [field]: message } };
  }

  /** Repositories of the signed-in account's personal namespace. */
  async function listForAccount(accountId) {
    const state = await store.read();
    if (!accountId) return null;
    return collection(state, "repositories")
      .filter(
        (repository) =>
          repository.ownerType === "account" &&
          repository.ownerId === accountId &&
          canReadRepository(state, repository, accountId),
      )
      .map((repository) => serializeRepository(state, repository))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function create(accountId, input) {
    const unauthorized = signInRequired(accountId);
    if (unauthorized) return unauthorized;

    const source = input ?? {};
    const requestedOwner = typeof source.owner === "string" ? source.owner.trim() : "";
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const description = typeof source.description === "string" ? source.description.trim() : "";
    const initializeReadme =
      source.initializeReadme === true || source.initialize === true;

    const nameReason = repositoryNameError(name);
    if (nameReason) return rejectField("name", nameReason);
    if (description.length > REPOSITORY_DESCRIPTION_MAX_LENGTH) {
      return rejectField("description", REPOSITORY_MESSAGES.descriptionTooLong);
    }
    const visibility = wantedVisibility(source.visibility, "public");
    if (!visibility) return rejectField("visibility", REPOSITORY_MESSAGES.visibilityInvalid);

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const account = collection(state, "accounts").find(
        (candidate) => candidate.id === accountId,
      );
      if (!account) {
        outcome = { unauthorized: true };
        return;
      }
      const namespace = namespaceByName(
        state,
        requestedOwner.length > 0 ? requestedOwner : account.username,
      );
      if (!namespace) {
        outcome = rejectField("owner", REPOSITORY_MESSAGES.ownerInvalid);
        return;
      }
      if (!canCreateInNamespace(state, namespace, accountId)) {
        outcome = rejectField("owner", REPOSITORY_MESSAGES.ownerDenied);
        return;
      }
      const duplicate = repositoriesInNamespace(state, namespace).some(
        (repository) => repository.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) {
        outcome = rejectField("name", REPOSITORY_MESSAGES.nameExists);
        return;
      }

      const createdAt = clock();
      const repositoryId = `repository-${randomUUID()}`;
      const repository = {
        id: repositoryId,
        ownerType: namespace.ownerType,
        ownerId: namespace.ownerId,
        name,
        description: description.length > 0 ? description : null,
        visibility,
        defaultBranch: DEFAULT_BRANCH_NAME,
        sourceRepositoryId: null,
        createdBy: accountId,
        createdAt,
        updatedAt: createdAt,
      };
      const branch = {
        id: `branch-${randomUUID()}`,
        repositoryId,
        name: DEFAULT_BRANCH_NAME,
        commitId: initializeReadme ? `commit-${randomUUID()}` : null,
        createdAt,
      };
      const commit = initializeReadme
        ? {
            id: branch.commitId,
            repositoryId,
            sha: shortSha(),
            message: INITIAL_COMMIT_MESSAGE,
            authorId: accountId,
            parentId: null,
            createdAt,
            files: [{ path: README_FILE_NAME, content: readmeContent(name, description) }],
          }
        : null;
      state.repositories = [...collection(state, "repositories"), repository];
      state.branches = [...collection(state, "branches"), branch];
      if (commit) state.commits = [...collection(state, "commits"), commit];
      outcome = { ok: true, repository: serializeRepository(state, repository) };
    });
    return outcome;
  }

  /**
   * Copies a readable source repository into another namespace. The default
   * branch history is copied into fresh records, and a private source always
   * produces a private fork.
   */
  async function fork(accountId, sourceOwner, sourceName, input) {
    const unauthorized = signInRequired(accountId);
    if (unauthorized) return unauthorized;

    const source = input ?? {};
    const requestedOwner = typeof source.owner === "string" ? source.owner.trim() : "";
    const requestedName = typeof source.name === "string" ? source.name.trim() : "";
    const requestedVisibility = wantedVisibility(source.visibility, "public");
    if (!requestedVisibility) {
      return rejectField("visibility", REPOSITORY_MESSAGES.visibilityInvalid);
    }

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const account = collection(state, "accounts").find(
        (candidate) => candidate.id === accountId,
      );
      if (!account) {
        outcome = { unauthorized: true };
        return;
      }
      const sourceRepository = repositoryByOwnerAndName(state, sourceOwner, sourceName);
      if (!sourceRepository) {
        outcome = { notFound: true };
        return;
      }
      if (!canReadRepository(state, sourceRepository, accountId)) {
        outcome = { forbidden: true };
        return;
      }
      const namespace = namespaceByName(
        state,
        requestedOwner.length > 0 ? requestedOwner : account.username,
      );
      if (!namespace) {
        outcome = rejectField("owner", REPOSITORY_MESSAGES.ownerInvalid);
        return;
      }
      if (!canCreateInNamespace(state, namespace, accountId)) {
        outcome = rejectField("owner", REPOSITORY_MESSAGES.ownerDenied);
        return;
      }
      const name = requestedName.length > 0 ? requestedName : sourceRepository.name;
      const nameReason = repositoryNameError(name);
      if (nameReason) {
        outcome = rejectField("name", nameReason);
        return;
      }
      const duplicate = repositoriesInNamespace(state, namespace).some(
        (repository) => repository.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) {
        outcome = rejectField("name", REPOSITORY_MESSAGES.nameExists);
        return;
      }
      const visibility =
        sourceRepository.visibility === "private" ? "private" : requestedVisibility;

      const createdAt = clock();
      const repositoryId = `repository-${randomUUID()}`;
      const repository = {
        id: repositoryId,
        ownerType: namespace.ownerType,
        ownerId: namespace.ownerId,
        name,
        description: sourceRepository.description ?? null,
        visibility,
        defaultBranch: sourceRepository.defaultBranch ?? DEFAULT_BRANCH_NAME,
        sourceRepositoryId: sourceRepository.id,
        createdBy: accountId,
        createdAt,
        updatedAt: createdAt,
      };

      // Copy the source commits into new, independent records: the fork keeps
      // the source identifier as a link, never a shared reference.
      const sourceCommits = collection(state, "commits").filter(
        (commit) => commit.repositoryId === sourceRepository.id,
      );
      const commitIdMap = new Map();
      for (const commit of sourceCommits) {
        commitIdMap.set(commit.id, `commit-${randomUUID()}`);
      }
      const copiedCommits = sourceCommits.map((commit) => ({
        ...commit,
        id: commitIdMap.get(commit.id),
        repositoryId,
        parentId: commit.parentId ? commitIdMap.get(commit.parentId) ?? null : null,
        files: collection(commit, "files").map((file) => ({ ...file })),
      }));
      const sourceBranches = collection(state, "branches").filter(
        (branch) => branch.repositoryId === sourceRepository.id,
      );
      const copiedBranches = sourceBranches.map((branch) => ({
        id: `branch-${randomUUID()}`,
        repositoryId,
        name: branch.name,
        commitId: branch.commitId ? commitIdMap.get(branch.commitId) ?? null : null,
        createdAt,
      }));
      if (copiedBranches.length === 0) {
        copiedBranches.push({
          id: `branch-${randomUUID()}`,
          repositoryId,
          name: repository.defaultBranch,
          commitId: null,
          createdAt,
        });
      }

      state.repositories = [...collection(state, "repositories"), repository];
      state.commits = [...collection(state, "commits"), ...copiedCommits];
      state.branches = [...collection(state, "branches"), ...copiedBranches];
      outcome = { ok: true, repository: serializeRepository(state, repository) };
    });
    return outcome;
  }

  return { listForAccount, create, fork };
}
