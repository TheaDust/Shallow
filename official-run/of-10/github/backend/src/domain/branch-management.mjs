/**
 * Branch references of one repository (REQ-4-3).
 *
 * A branch is a named reference pointing to a commit: creating one stores the
 * unique name, the base commit it points at, its creator and the time, and it
 * copies no file and rewrites no history. Changing the repository default branch
 * only changes which reference is read first, never an existing branch or commit.
 */

import { effectiveRepositoryRole } from "./repository-access.mjs";
import { branchExists } from "./commit-graph.mjs";

/** The only messages this feature reveals; both are shown verbatim. */
export const BRANCH_MESSAGES = {
  invalid: "Invalid branch",
  forbidden: "You need write permission to create a branch in this repository.",
  notAdministerable: "You must be a repository administrator to change the default branch.",
};

export const BRANCH_NAME_MAX_LENGTH = 255;

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

/**
 * A branch name is 1-255 characters of ASCII letters, digits, `-`, `_`, `.` and
 * `/`; it must not end with `/` or `.` and must not contain `..` or `//`.
 */
export function isValidBranchName(name) {
  const value = String(name ?? "").trim();
  if (!value || value.length > BRANCH_NAME_MAX_LENGTH) return false;
  if (!BRANCH_NAME_PATTERN.test(value)) return false;
  if (value.endsWith("/") || value.endsWith(".")) return false;
  if (value.includes("..") || value.includes("//")) return false;
  return true;
}

/** Roles that may write to repository code and version-control pages (REQ-4). */
const WRITABLE_ROLES = new Set(["write", "maintain", "admin"]);

/**
 * Whether the viewer may create a branch or a commit. Read and Triage may only
 * browse, and an anonymous viewer never writes; an organization Owner and the
 * owning account are `admin` through the shared role computation.
 */
export function canWriteRepository(state, repository, viewer) {
  return WRITABLE_ROLES.has(effectiveRepositoryRole(state, repository, viewer));
}

export function branchReference(repository, name) {
  return (repository?.branches ?? []).find((candidate) => candidate.name === name) ?? null;
}

/**
 * Adds one named reference to the base commit. No file is copied and the base
 * commit keeps its own history, so the new branch reads the same snapshot as its
 * base until a commit is made on it.
 */
export function createBranchReference(repository, { name, headCommitId, creator, createdAt }) {
  repository.branches = repository.branches ?? [];
  const reference = {
    name,
    headCommitId: headCommitId ?? null,
    createdBy: creator ?? null,
    createdAt: createdAt ?? new Date().toISOString(),
  };
  repository.branches.push(reference);
  return reference;
}

/**
 * Points the repository at another existing branch and records the operator and
 * the time. Existing branches, commits and their heads stay untouched.
 */
export function setDefaultBranch(repository, { branch, operator, at }) {
  repository.defaultBranch = branch;
  repository.defaultBranchUpdatedBy = operator ?? null;
  repository.defaultBranchUpdatedAt = at ?? new Date().toISOString();
  repository.updatedAt = repository.defaultBranchUpdatedAt;
}

export { branchExists };
