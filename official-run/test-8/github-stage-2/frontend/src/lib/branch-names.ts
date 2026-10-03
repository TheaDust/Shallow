/**
 * Branch-name rules of REQ-4-3, mirrored from `backend/src/lib/validation.mjs`
 * so the selector can answer as the user types. The server stays the authority:
 * the same rules run again inside the store-locked mutation.
 */

export const INVALID_BRANCH_MESSAGE = "Invalid branch";

const MAX_LENGTH = 255;
const ALLOWED = /^[A-Za-z0-9._/-]+$/;

/** 1–255 characters of ASCII letters, digits, `-`, `_`, `.` and `/`. */
export function isValidBranchName(value: string): boolean {
  const name = value.trim();
  if (name.length < 1 || name.length > MAX_LENGTH) return false;
  if (!ALLOWED.test(name)) return false;
  if (name.endsWith("/") || name.endsWith(".")) return false;
  if (name.includes("..") || name.includes("//")) return false;
  return true;
}
