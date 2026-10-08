// Input rules and the exact user-visible messages of the repository releases
// (REQ-4-5). A release belongs to one repository; its tag identifies it inside
// that repository only.

import { normalizeText } from "./auth-rules.mjs";

export const RELEASE_MESSAGES = {
  tagRequired: "Tag name is required",
  tagExists: "Tag already exists",
  branchInvalid: "Target branch is invalid",
};

/**
 * A release tag is 1-255 non-empty characters after trimming; whitespace inside
 * the tag would break the address that restores the release detail, so such a
 * value is refused like a missing one.
 */
export function validateReleaseTag(raw) {
  const value = normalizeText(raw);
  return value.length >= 1 && value.length <= 255 && !/\s/.test(value);
}
