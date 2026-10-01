// Branch management on the Code pages: listing the stored branches, creating a
// new named reference at a base commit, and changing the repository default
// branch.
//
// A branch is only a name plus the commit it points at, so creating one never
// copies files or rewrites the base history, and changing the default branch
// never removes an existing branch, a commit or a file. Permission is always
// re-checked against the stored relationship: Write or higher may create a
// branch, only a repository Admin (or organization Owner) may change the
// default branch.

import { randomUUID } from "node:crypto";

import {
  canAdministerRepository,
  canWriteRepository,
} from "./access.mjs";
import {
  branchByName,
  branchNamesOf,
  collection,
  resolveRepositoryForViewer,
} from "./repository-code.mjs";
import { serializeRepository } from "./repositories.mjs";

export const BRANCH_MESSAGES = {
  invalid: "Invalid branch",
  exists: "Branch already exists",
  baseNotFound: "Base branch not found",
  defaultBranchInvalid: "Default branch must be an existing branch",
  notAuthenticated: "Not authenticated",
  notFound: "Not found",
  accessDenied: "Access denied",
};

export const BRANCH_NAME_MAX_LENGTH = 255;

// ASCII letters, digits, `-`, `_`, `.` and `/` only.
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

let clock = () => new Date().toISOString();

/**
 * The reason a branch name cannot be used, or null when it is well formed.
 * Empty, over-long, non-ASCII, a trailing `/` or `.`, a `..` or a `//` are all
 * rejected; existence and permission are checked separately.
 */
export function branchNameError(value) {
  if (typeof value !== "string") return BRANCH_MESSAGES.invalid;
  if (value.length === 0 || value.length > BRANCH_NAME_MAX_LENGTH) {
    return BRANCH_MESSAGES.invalid;
  }
  if (!BRANCH_NAME_PATTERN.test(value)) return BRANCH_MESSAGES.invalid;
  if (value.endsWith("/") || value.endsWith(".")) return BRANCH_MESSAGES.invalid;
  if (value.includes("..") || value.includes("//")) return BRANCH_MESSAGES.invalid;
  return null;
}

export function createRepositoryBranchService(store) {
  /** The stored branches of a readable repository, plus the viewer's role. */
  async function listForViewer(owner, repositoryName, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;
    return {
      status: "ok",
      settings: {
        repository: serializeRepository(state, repository),
        branches: branchNamesOf(state, repository),
        canAdminister: canAdministerRepository(state, repository, accountId),
        canWrite: canWriteRepository(state, repository, accountId),
      },
    };
  }

  /** Creates a new branch pointing at the base commit (default: branch head). */
  async function createForViewer(owner, repositoryName, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const source = input ?? {};
    const name = typeof source.name === "string" ? source.name : "";
    const nameReason = branchNameError(name);
    if (nameReason) {
      return { status: "invalid", error: "Branch not created", fieldErrors: { name: nameReason } };
    }

    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      if (!canWriteRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      if (branchByName(state, repository.id, name)) {
        outcome = {
          status: "invalid",
          error: "Branch not created",
          fieldErrors: { name: BRANCH_MESSAGES.exists },
        };
        return;
      }
      const requestedBase =
        typeof source.base === "string" && source.base.trim().length > 0
          ? source.base
          : repository.defaultBranch;
      const base = branchByName(state, repository.id, requestedBase);
      if (!base) {
        outcome = {
          status: "invalid",
          error: "Branch not created",
          fieldErrors: { base: BRANCH_MESSAGES.baseNotFound },
        };
        return;
      }
      const createdAt = clock();
      const branch = {
        id: `branch-${randomUUID()}`,
        repositoryId: repository.id,
        name,
        // The new reference points at the base commit; history is shared, never
        // copied or rewritten.
        commitId: base.commitId ?? null,
        createdBy: accountId,
        createdAt,
      };
      state.branches = [...collection(state, "branches"), branch];
      outcome = {
        status: "ok",
        branch: {
          id: branch.id,
          name: branch.name,
          commitId: branch.commitId,
          createdBy: branch.createdBy,
          createdAt: branch.createdAt,
        },
        branches: branchNamesOf(state, repository),
      };
    });
    return outcome;
  }

  /** Stores a new default branch together with the operator and time. */
  async function setDefaultForViewer(owner, repositoryName, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const requested =
      typeof input?.defaultBranch === "string" ? input.defaultBranch : "";

    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      if (!canAdministerRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      const branch = branchByName(state, repository.id, requested);
      if (!branch) {
        outcome = {
          status: "invalid",
          error: "Default branch not changed",
          fieldErrors: { defaultBranch: BRANCH_MESSAGES.defaultBranchInvalid },
        };
        return;
      }
      const changedAt = clock();
      const updated = {
        ...repository,
        defaultBranch: branch.name,
        updatedAt: changedAt,
        defaultBranchChangedBy: accountId,
        defaultBranchChangedAt: changedAt,
      };
      state.repositories = collection(state, "repositories").map((candidate) =>
        candidate.id === repository.id ? updated : candidate,
      );
      outcome = { status: "ok", repository: serializeRepository(state, updated) };
    });
    return outcome;
  }

  return { listForViewer, createForViewer, setDefaultForViewer };
}
