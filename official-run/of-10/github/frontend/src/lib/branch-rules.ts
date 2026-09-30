/**
 * Branch-name rule of the branch selector (REQ-4-3).
 *
 * The server validates the same rule again on creation; the client only uses it
 * to decide whether the typed text offers the `Create branch: <name>` entry or
 * immediately reports `Invalid branch`.
 */
export const BRANCH_NAME_MAX_LENGTH = 255;

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

export function isValidBranchName(name: string): boolean {
  const value = name.trim();
  if (!value || value.length > BRANCH_NAME_MAX_LENGTH) return false;
  if (!BRANCH_NAME_PATTERN.test(value)) return false;
  if (value.endsWith("/") || value.endsWith(".")) return false;
  if (value.includes("..") || value.includes("//")) return false;
  return true;
}
