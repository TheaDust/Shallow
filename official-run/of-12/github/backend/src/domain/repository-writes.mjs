import { randomUUID } from "node:crypto";

import { findOrganization } from "./organizations.mjs";
import {
  canReadRepository,
  effectiveRepositoryRole,
  findAccountOwner,
  repositoryFullName,
  repositoryOwner,
} from "./repository-access.mjs";

/**
 * Repository lifecycle writes (REQ-3-2-1, REQ-3-2-2, REQ-3-4): creation with an
 * optional initialized default branch, forking into another namespace, and the
 * visibility change of an existing repository.
 *
 * Every rule — who may create in a namespace, whether the name is still free,
 * who may change visibility — is checked inside the same atomic store update
 * that performs the write, so a rejected request leaves the stored document
 * exactly as it was and a failure never leaves a half-created repository.
 */

export const REPOSITORY_MESSAGES = {
  signInRequired: "Sign in is required to create a repository",
  nameRequired: "Repository name is required",
  nameFormat: "Repository name format is invalid",
  nameTaken: "Repository name already exists",
  ownerRequired: "Owner is required",
  ownerUnavailable: "Owner is not available",
  ownerForbidden: "You do not have permission to create repositories for this owner",
  visibilityInvalid: "Visibility is not supported",
  sourceUnreadable: "You cannot fork a repository you cannot read",
  forbidden: "Only a repository Admin can change its visibility",
  confirmationMismatch: "Confirmation text does not match the repository name",
  createFailed: "The repository could not be created",
  forkFailed: "The fork could not be created",
  visibilityFailed: "The visibility could not be changed",
};

const NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/** The rule the creation page enforces on the repository name, or null. */
export function repositoryNameError(rawName) {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return REPOSITORY_MESSAGES.nameRequired;
  if (!NAME_PATTERN.test(name)) return REPOSITORY_MESSAGES.nameFormat;
  return null;
}

function normalizeVisibility(value, fallback) {
  return value === "public" || value === "private" ? value : fallback;
}

function namespaceStoredType(namespace) {
  return namespace.type === "organization" ? "organization" : "user";
}

/**
 * The namespace a repository belongs to, plus whether the account may create a
 * repository in it. An organization namespace is writable by its Owners; a
 * personal namespace only by its own account. An empty owner is the signed-in
 * account's personal namespace, the default the creation page selects.
 */
export function resolveOwnerNamespace(data, account, owner) {
  const raw = typeof owner === "string" ? owner.trim() : "";
  const organization = raw ? findOrganization(data, raw) : null;
  if (organization) {
    const membership = data.memberships.find(
      (entry) => entry.organizationId === organization.id && entry.accountId === account.id,
    );
    return {
      type: "organization",
      id: organization.id,
      name: organization.name,
      displayName: organization.displayName,
      canCreate: membership?.role === "Owner",
    };
  }
  const target = raw ? findAccountOwner(data, raw) : null;
  if (!raw || (target && target.id === account.id)) {
    return {
      type: "user",
      id: account.id,
      name: account.username,
      displayName: account.username,
      canCreate: true,
    };
  }
  if (target) {
    return {
      type: "user",
      id: target.id,
      name: target.username,
      displayName: target.username,
      canCreate: false,
    };
  }
  return null;
}

function repositoriesOfNamespace(draft, namespace) {
  const ownerType = namespaceStoredType(namespace);
  return draft.repositories.filter(
    (repository) => repository.ownerType === ownerType && repository.ownerId === namespace.id,
  );
}

function nameTaken(draft, namespace, name, ignoreId) {
  const needle = name.toLowerCase();
  return repositoriesOfNamespace(draft, namespace).some(
    (repository) => repository.id !== ignoreId && repository.name.toLowerCase() === needle,
  );
}

/** The single commit the initialization option creates on the default branch. */
function initialCommit(account, name, timestamp) {
  const content = `# ${name}\n`;
  return {
    id: randomUUID(),
    message: "Initial commit",
    authorId: account.id,
    author: account.username,
    branch: "main",
    parentId: null,
    createdAt: timestamp,
    files: [{ path: "README.md", change: "added" }],
    tree: [{ path: "README.md", content, updatedAt: timestamp }],
  };
}

function newRepositoryRecord(namespace, account, input, timestamp) {
  const initialize = input.initialize === true;
  const commit = initialize ? initialCommit(account, input.name, timestamp) : null;
  return {
    id: randomUUID(),
    ownerType: namespaceStoredType(namespace),
    ownerId: namespace.id,
    name: input.name,
    description: input.description ?? "",
    visibility: input.visibility,
    defaultBranch: "main",
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: account.id,
    grants: [],
    // An empty repository has no branch yet: its default branch is created by
    // the first commit (REQ-4-4).
    branches: commit
      ? [{ name: "main", headId: commit.id, createdBy: account.id, createdAt: timestamp }]
      : [],
    commits: commit ? [commit] : [],
  };
}

function validateNamespace(errors, namespace) {
  if (!namespace) {
    errors.owner = REPOSITORY_MESSAGES.ownerUnavailable;
    return;
  }
  if (!namespace.canCreate) errors.owner = REPOSITORY_MESSAGES.ownerForbidden;
}

/**
 * Creates a repository in the selected owner namespace (REQ-3-2-1). With the
 * initialization option the default branch, its README file and the initial
 * commit are created by the same update.
 */
export async function createRepository(store, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const account = draft.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const errors = {};
    const nameError = repositoryNameError(name);
    if (nameError) errors.name = nameError;
    const namespace = resolveOwnerNamespace(draft, account, input.owner);
    validateNamespace(errors, namespace);
    if (namespace && !nameError && nameTaken(draft, namespace, name)) {
      errors.name = REPOSITORY_MESSAGES.nameTaken;
    }
    if (Object.keys(errors).length > 0) {
      outcome = { ok: false, errors };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    const repository = newRepositoryRecord(
      namespace,
      account,
      {
        name,
        description: typeof input.description === "string" ? input.description.trim() : "",
        visibility: normalizeVisibility(input.visibility, "public"),
        initialize: input.initialize === true,
      },
      timestamp,
    );
    draft.repositories.push(repository);
    outcome = { ok: true, repositoryId: repository.id };
    return draft;
  });
  return outcome;
}

/**
 * Copies a readable source repository into another namespace (REQ-3-2-2). The
 * fork is an independent repository: the source identifier is recorded for the
 * overview link, the accessible default-branch files are copied, and later
 * changes to the fork never write back to the source. A private source may only
 * be forked as a private repository.
 */
export async function forkRepository(store, sourceRepositoryId, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const account = draft.accounts.find((candidate) => candidate.id === accountId);
    const source = draft.repositories.find((candidate) => candidate.id === sourceRepositoryId);
    if (!account || !source) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    // Read or higher on the source: a public repository is readable by every
    // signed-in account, a private one only through an effective role.
    if (!canReadRepository(draft, source, accountId)) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const requestedName = typeof input.name === "string" ? input.name.trim() : "";
    const name = requestedName || source.name;
    const errors = {};
    const nameError = repositoryNameError(name);
    if (nameError) errors.name = nameError;
    const namespace = resolveOwnerNamespace(draft, account, input.owner);
    validateNamespace(errors, namespace);
    if (namespace && !nameError && nameTaken(draft, namespace, name)) {
      errors.name = REPOSITORY_MESSAGES.nameTaken;
    }
    if (Object.keys(errors).length > 0) {
      outcome = { ok: false, errors };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    const visibility = source.visibility === "private"
      ? "private"
      : normalizeVisibility(input.visibility, normalizeVisibility(source.visibility, "public"));
    // The fork copies the source branches and their history as independent
    // records: new identifiers, but the same snapshots, so from this point on
    // a change to the fork never writes back to the source.
    const idMap = new Map();
    const commits = (Array.isArray(source.commits) ? source.commits : []).map((commit) => {
      const id = randomUUID();
      if (commit?.id) idMap.set(commit.id, id);
      return {
        ...commit,
        id,
        files: (Array.isArray(commit?.files) ? commit.files : []).map((file) => ({ ...file })),
        tree: (Array.isArray(commit?.tree) ? commit.tree : []).map((file) => ({ ...file })),
      };
    });
    for (const commit of commits) {
      commit.parentId = commit.parentId ? idMap.get(commit.parentId) ?? null : null;
    }
    const branches = (Array.isArray(source.branches) ? source.branches : []).map((branch) => ({
      ...branch,
      headId: idMap.get(branch.headId) ?? null,
      createdBy: account.id,
    }));
    // A legacy source without branches keeps a readable default branch.
    if (branches.length === 0 && (Array.isArray(source.files) ? source.files.length : 0) > 0) {
      const commit = {
        id: randomUUID(),
        message: "Initial commit",
        authorId: account.id,
        author: account.username,
        branch: source.defaultBranch ?? "main",
        parentId: null,
        createdAt: timestamp,
        files: source.files.map((file) => ({ path: file.path, change: "added" })),
        tree: source.files.map((file) => ({ ...file })),
      };
      commits.push(commit);
      branches.push({ name: commit.branch, headId: commit.id, createdBy: account.id, createdAt: timestamp });
    }
    const fork = {
      id: randomUUID(),
      ownerType: namespaceStoredType(namespace),
      ownerId: namespace.id,
      name,
      description: source.description ?? "",
      visibility,
      defaultBranch: source.defaultBranch ?? "main",
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: account.id,
      sourceRepositoryId: source.id,
      forkedAt: timestamp,
      grants: [],
      branches,
      commits,
    };
    draft.repositories.push(fork);
    outcome = { ok: true, repositoryId: fork.id };
    return draft;
  });
  return outcome;
}

/** The names a confirmation input may spell to confirm a visibility change. */
function acceptedConfirmations(draft, repository) {
  const owner = repositoryOwner(draft, repository);
  return [
    repository.name,
    `${owner?.name ?? ""}/${repository.name}`,
    repositoryFullName(owner?.displayName ?? "", repository.name),
  ].filter(Boolean);
}

/**
 * Changes the visibility of a repository (REQ-3-4). Only a repository Admin
 * may apply it; when the optional confirmation text is present it must spell
 * the repository name, while an empty confirmation needs no retyping.
 */
export async function changeRepositoryVisibility(store, repositoryId, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const repository = draft.repositories.find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    if (effectiveRepositoryRole(draft, repository, accountId) !== "Admin") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const errors = {};
    if (input.visibility !== "public" && input.visibility !== "private") {
      errors.visibility = REPOSITORY_MESSAGES.visibilityInvalid;
    }
    const confirmation = typeof input.confirmation === "string" ? input.confirmation.trim() : "";
    if (confirmation && !acceptedConfirmations(draft, repository).includes(confirmation)) {
      errors.confirmation = REPOSITORY_MESSAGES.confirmationMismatch;
    }
    if (Object.keys(errors).length > 0) {
      outcome = { ok: false, errors };
      return undefined;
    }

    repository.visibility = input.visibility;
    repository.updatedAt = new Date().toISOString();
    outcome = { ok: true, repositoryId: repository.id };
    return draft;
  });
  return outcome;
}
