// Client-side mirrors of the write rules the server enforces. They only exist
// to give immediate feedback while typing; the server re-validates every write.

export const BRANCH_INVALID_MESSAGE = "Invalid branch";
export const INVALID_FILE_PATH_MESSAGE = "Invalid file path";
export const COMMIT_MESSAGE_REQUIRED_MESSAGE = "Commit message is required";
export const COMMIT_MESSAGE_TOO_LONG_MESSAGE = "Commit message must be 72 characters or fewer";

export const COMMIT_MESSAGE_MAX_LENGTH = 72;
export const BRANCH_NAME_MAX_LENGTH = 255;

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

/** The reason a branch name is unusable, or null when it is well formed. */
export function branchNameError(value: string): string | null {
  if (value.length === 0 || value.length > BRANCH_NAME_MAX_LENGTH) {
    return BRANCH_INVALID_MESSAGE;
  }
  if (!BRANCH_NAME_PATTERN.test(value)) return BRANCH_INVALID_MESSAGE;
  if (value.endsWith("/") || value.endsWith(".")) return BRANCH_INVALID_MESSAGE;
  if (value.includes("..") || value.includes("//")) return BRANCH_INVALID_MESSAGE;
  return null;
}

/** The reason a file path is unusable, or null when it is well formed. */
export function filePathError(value: string): string | null {
  const raw = value.trim();
  if (raw.length === 0) return INVALID_FILE_PATH_MESSAGE;
  if (raw.startsWith("/")) return INVALID_FILE_PATH_MESSAGE;
  const segments = raw.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return INVALID_FILE_PATH_MESSAGE;
  }
  return null;
}

/** The reason a commit message is unusable, or null when it is 1–72 chars. */
export function commitMessageError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return COMMIT_MESSAGE_REQUIRED_MESSAGE;
  if (trimmed.length > COMMIT_MESSAGE_MAX_LENGTH) return COMMIT_MESSAGE_TOO_LONG_MESSAGE;
  return null;
}
