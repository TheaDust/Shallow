// Branch-name rules shared by the branch selector. They mirror the server
// validators (`backend/src/lib/org-rules.mjs`) so the selector can report an
// invalid name while the user types; the server still re-validates every
// request, so this module is a convenience, never the trusted check.

export const BRANCH_NAME_INVALID_MESSAGE = "Invalid branch";

export const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]{1,255}$/;

export function isValidBranchName(raw: string): boolean {
  if (!BRANCH_NAME_PATTERN.test(raw)) return false;
  if (raw.endsWith("/") || raw.endsWith(".")) return false;
  if (raw.includes("..") || raw.includes("//")) return false;
  return true;
}
