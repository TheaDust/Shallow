// Organization, team and membership rules shared by the organization API.
// The message strings are the exact user-visible strings required by the
// product, so routes must never invent their own wording.

export const ORGANIZATION_MESSAGES = {
  nameExists: "Organization name already exists",
  nameInvalid: "Organization name format is invalid",
  displayNameRequired: "Display name is required",
  displayNameTooLong: "Display name must be 100 characters or fewer",
};

export const TEAM_MESSAGES = {
  nameInvalid: "Team name is invalid",
  nameExists: "Team name already exists",
  cycle: "Cyclic team hierarchy is not allowed",
  foreignParent: "Parent team must belong to the same organization",
};

export const MEMBER_MESSAGES = {
  accountNotFound: "Account not found",
  notOrganizationMember: "Account is not an organization member",
  alreadyMember: "Account is already a member",
  alreadyInTeam: "Account is already a member",
  roleInvalid: "Role is invalid",
  lastOwner: "An organization must keep at least one Owner",
};

export const REPOSITORY_ACCESS_MESSAGES = {
  teamNotFound: "Team not found",
  accountNotFound: "Account not found",
  roleInvalid: "Role is invalid",
  alreadyGranted: "Team already has access",
  grantNotFound: "Access grant not found",
};

export const ORGANIZATION_NOT_FOUND = "Organization not found";
export const TEAM_NOT_FOUND = "Team not found";
export const REPOSITORY_NOT_FOUND = "Repository not found";
export const ACCESS_DENIED = "Access denied";

// Repository permission roles, ordered from least to most capable. They are
// operation-specific capabilities, not one cumulative ladder shared with the
// organization roles.
export const REPOSITORY_ROLES = ["read", "triage", "write", "maintain", "admin"];

const REPOSITORY_ROLE_ORDER = REPOSITORY_ROLES;

/** The most capable of the granted repository roles, or null when none apply. */
export function highestRepositoryRole(roles) {
  let best = null;
  for (const role of roles) {
    if (!REPOSITORY_ROLE_ORDER.includes(role)) continue;
    if (best === null || REPOSITORY_ROLE_ORDER.indexOf(role) > REPOSITORY_ROLE_ORDER.indexOf(best)) best = role;
  }
  return best;
}

export function validateRepositoryRole(value) {
  return typeof value === "string" && REPOSITORY_ROLES.includes(value);
}

// Team names: 1-50 lowercase ASCII letters, digits or hyphens, and never
// beginning or ending with a hyphen.
const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function validateTeamName(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 50 && TEAM_NAME_PATTERN.test(value);
}

/** 1-100 characters after trimming leading and trailing whitespace. */
export function validateDisplayName(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 100;
}

/**
 * Comparison key for the globally unique organization identifier. It folds
 * case and treats whitespace runs as hyphens, so an attempt that differs from
 * a stored identifier only in case or spacing is still detected as a duplicate.
 */
export function organizationKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, "-") : "";
}
