/**
 * Branch writes of the Code page (REQ-4-3-2, REQ-4-3-3).
 *
 * A branch is a named reference to one commit: creating one stores the name, the
 * base commit it points at, the creator and the time, and copies nothing, so the
 * base branch and its history stay exactly as they were. Changing the default
 * branch only stores which branch a page reads without a branch in its address;
 * it neither deletes the previous default branch nor rewrites any branch or
 * commit. Both writes check the role inside the same atomic update that performs
 * them, so an unauthorized or invalid request leaves the document untouched.
 */

import { COMMIT_ROLES, effectiveRepositoryRole } from "./repository-access.mjs";
import {
  findRepositoryBranch,
  findRepositoryCommit,
  repositoryBranchList,
} from "./repository-branches.mjs";

export const BRANCH_WRITE_MESSAGES = {
  invalidName: "Invalid branch",
  nameTaken: "Branch already exists",
  baseMissing: "Base revision not found",
  createFailed: "The branch could not be created",
  forbidden: "You do not have permission to create branches in this repository",
  signInRequired: "Sign in is required to create branches",
  defaultBranchUnknown: "Branch not found",
  defaultBranchFailed: "The default branch could not be changed",
  defaultBranchForbidden: "Only a repository Admin can change the default branch",
};

/** A branch name is at most this long (REQ-4-3-3). */
export const BRANCH_NAME_MAX = 255;

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

function trimmed(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * The rule a branch name has to satisfy (REQ-4-3-3): 1–255 characters, only
 * ASCII letters, digits, `-`, `_`, `.` and `/`, not ending in `/` or `.` and
 * without a consecutive `..` or `//`. Returns the message to display, or null.
 */
export function branchNameError(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > BRANCH_NAME_MAX) return BRANCH_WRITE_MESSAGES.invalidName;
  if (!BRANCH_NAME_PATTERN.test(name)) return BRANCH_WRITE_MESSAGES.invalidName;
  if (name.endsWith("/") || name.endsWith(".")) return BRANCH_WRITE_MESSAGES.invalidName;
  if (name.includes("..") || name.includes("//")) return BRANCH_WRITE_MESSAGES.invalidName;
  return null;
}

/** The commit a base identifier names: a branch head or a stored commit. */
export function resolveBaseCommit(repository, base) {
  const wanted = trimmed(base);
  if (wanted) {
    const branch = findRepositoryBranch(repository, wanted);
    if (branch) {
      const head = findRepositoryCommit(repository, branch.headId);
      if (!head) return null;
      return { commit: head, branch: branch.name };
    }
    const commit = findRepositoryCommit(repository, wanted);
    if (commit) return { commit, branch: commit.branch ?? null };
    return null;
  }
  const fallback = findRepositoryBranch(repository, repository.defaultBranch)
    ?? repositoryBranchList(repository)[0]
    ?? null;
  if (!fallback) return null;
  const head = findRepositoryCommit(repository, fallback.headId);
  if (!head) return null;
  return { commit: head, branch: fallback.name };
}

/**
 * Creates one named reference at a base commit (REQ-4-3-2). Write, Maintain,
 * Admin and an organization Owner may create a branch; Read, Triage and a
 * visitor may not. An invalid name, a name that is already taken or an unknown
 * base is refused without storing anything.
 */
export async function createRepositoryBranch(store, repositoryId, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    if (!account || !COMMIT_ROLES.includes(effectiveRepositoryRole(draft, repository, accountId))) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const name = trimmed(input.name);
    const errors = {};
    const nameError = branchNameError(name);
    if (nameError) {
      errors.name = nameError;
    } else if (repositoryBranchList(repository).some((branch) => branch.name === name)) {
      errors.name = BRANCH_WRITE_MESSAGES.nameTaken;
    }
    const base = resolveBaseCommit(repository, input.base);
    if (!base) errors.base = BRANCH_WRITE_MESSAGES.baseMissing;
    if (Object.keys(errors).length > 0) {
      outcome = { ok: false, errors };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    if (!Array.isArray(repository.branches)) repository.branches = [];
    repository.branches.push({
      name,
      // The new reference points at the very same commit: no file is copied and
      // the base branch and its history are not rewritten.
      headId: base.commit.id,
      baseBranch: base.branch,
      createdBy: account.id,
      createdAt: timestamp,
    });
    repository.updatedAt = timestamp;
    outcome = { ok: true, repositoryId: repository.id, branch: name, baseCommitId: base.commit.id };
    return draft;
  });
  return outcome;
}

/**
 * Stores which branch a page reads when its address names none (REQ-4-3-3).
 * Only a repository Admin (or an organization Owner) may change it; the stored
 * branches, their commits and every existing reference stay untouched.
 */
export async function changeRepositoryDefaultBranch(store, repositoryId, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    if (effectiveRepositoryRole(draft, repository, accountId) !== "Admin") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const branch = findRepositoryBranch(repository, trimmed(input.branch));
    if (!branch) {
      outcome = { ok: false, errors: { branch: BRANCH_WRITE_MESSAGES.defaultBranchUnknown } };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    repository.defaultBranch = branch.name;
    repository.defaultBranchUpdatedBy = accountId;
    repository.defaultBranchUpdatedAt = timestamp;
    repository.updatedAt = timestamp;
    outcome = { ok: true, repositoryId: repository.id, defaultBranch: branch.name };
    return draft;
  });
  return outcome;
}
