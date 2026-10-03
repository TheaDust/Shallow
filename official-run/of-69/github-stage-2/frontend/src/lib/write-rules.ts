import type { RepositoryCodeFile, RepositoryViewer } from "./organization-api";

/**
 * The rules a write action applies before it is submitted, and the exact
 * messages a page shows when one fails. The server repeats every rule, so a
 * rendered control is never the only guard.
 */
export const BRANCH_INVALID_MESSAGE = "Invalid branch";
export const FILE_PATH_INVALID_MESSAGE = "Invalid file path";
export const COMMIT_MESSAGE_REQUIRED_MESSAGE = "Commit message is required";
export const COMMIT_MESSAGE_TOO_LONG_MESSAGE = "Commit message must be 72 characters or fewer";

/** A commit message holds 1-72 non-empty characters after trimming. */
export const COMMIT_MESSAGE_MAX_LENGTH = 72;

/**
 * Whether an effective repository role may create commits and branches. Read
 * and Triage may browse but never write.
 */
export function canWriteRepository(viewer: RepositoryViewer | null | undefined): boolean {
  const role = viewer?.repositoryRole ?? null;
  return role === "write" || role === "maintain" || role === "admin";
}

// Branch names: ASCII letters, digits, `-`, `_`, `.` and `/` only.
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

/** 1-255 characters, no trailing `/` or `.`, and no `..` or `//` inside. */
export function isValidBranchName(value: string): boolean {
  const name = value.trim();
  if (name.length < 1 || name.length > 255) return false;
  if (!BRANCH_NAME_PATTERN.test(name)) return false;
  if (name.endsWith("/") || name.endsWith(".")) return false;
  return !name.includes("..") && !name.includes("//");
}

/**
 * A usable new-file path: not empty, not absolute, without an empty, `.` or
 * `..` segment, and without a clash with an existing file or directory (the
 * same path, a path already holding files, or a path inside an existing file).
 */
export function isValidNewFilePath(files: readonly RepositoryCodeFile[], value: string): boolean {
  const path = value.trim();
  if (path.length === 0 || path.startsWith("/")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  return !files.some(
    (file) => file.path === path || file.path.startsWith(`${path}/`) || path.startsWith(`${file.path}/`),
  );
}

/** The message the “Commit message” field reports, or null when the value is valid. */
export function commitMessageError(value: string): string | null {
  const message = value.trim();
  if (message.length === 0) return COMMIT_MESSAGE_REQUIRED_MESSAGE;
  if (message.length > COMMIT_MESSAGE_MAX_LENGTH) return COMMIT_MESSAGE_TOO_LONG_MESSAGE;
  return null;
}
