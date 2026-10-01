import { createRepositoryBranch } from "./repository-api";

/**
 * Branch rules and actions of the branch selector (REQ-4-3-2).
 *
 * The name rule mirrors the server so the selector can react while the user
 * types: a valid unused name offers "Create branch: <name>", an invalid one
 * displays "Invalid branch" immediately. The server repeats the same rule, so a
 * name that reaches it from anywhere else is refused as well.
 */

export const INVALID_BRANCH_MESSAGE = "Invalid branch";

/** A branch name is at most this long (REQ-4-3-3). */
export const BRANCH_NAME_MAX = 255;

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

/**
 * The message of an unusable branch name, or null (REQ-4-3-3): 1–255
 * characters, only ASCII letters, digits, `-`, `_`, `.` and `/`, not ending in
 * `/` or `.` and without a consecutive `..` or `//`.
 */
export function branchNameError(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > BRANCH_NAME_MAX) return INVALID_BRANCH_MESSAGE;
  if (!BRANCH_NAME_PATTERN.test(name)) return INVALID_BRANCH_MESSAGE;
  if (name.endsWith("/") || name.endsWith(".")) return INVALID_BRANCH_MESSAGE;
  if (name.includes("..") || name.includes("//")) return INVALID_BRANCH_MESSAGE;
  return null;
}

export interface BranchCreationResult {
  ok: boolean;
  error?: string;
}

/**
 * The action the selector performs for the "Create branch: <name>" entry: the
 * new branch points at the head of `base` (the branch the page reads), and the
 * repository overview is reloaded so the selector lists the new branch.
 */
export function branchCreator(
  owner: string,
  name: string,
  base: string,
  reload: () => void,
): (branchName: string) => Promise<BranchCreationResult> {
  return async (branchName: string) => {
    const result = await createRepositoryBranch(owner, name, { name: branchName, base });
    if (!result.ok) {
      return {
        ok: false,
        error: result.errors.name ?? result.errors.base ?? result.message,
      };
    }
    reload();
    return { ok: true };
  };
}
