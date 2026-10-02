/**
 * Display-only mirror of the branch name rule, used to validate what the visitor
 * has typed in the "Find branch" textbox as they type (no round trip per
 * keystroke). The server owns the rule: `backend/src/domain/validation.mjs`
 * decides every stored branch name again, so a name this mirror accepts is still
 * rejected by the API when the stored state says otherwise (duplicates,
 * permissions).
 */
export const BRANCH_NAME_MAX_LENGTH = 255;

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

export function isValidBranchName(value: string): boolean {
  if (value.length < 1 || value.length > BRANCH_NAME_MAX_LENGTH) return false;
  if (!BRANCH_NAME_PATTERN.test(value)) return false;
  if (value.endsWith("/") || value.endsWith(".")) return false;
  if (value.includes("..") || value.includes("//")) return false;
  return true;
}
