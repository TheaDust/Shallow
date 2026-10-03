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

export const REPOSITORY_MESSAGES = {
  visibilityInvalid: "Visibility is invalid",
  nameRequired: "Repository name is required",
  nameInvalid: "Repository name format is invalid",
  nameExists: "Repository name already exists",
  ownerInvalid: "Owner is invalid",
};

// Repository names: 1-100 characters of ASCII letters, digits, dot, hyphen or
// underscore, and never just dots (which would be unusable as a path segment).
const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function validateRepositoryName(value) {
  if (typeof value !== "string") return false;
  const name = value.trim();
  if (name.length < 1 || name.length > 100) return false;
  if (!REPOSITORY_NAME_PATTERN.test(name)) return false;
  return /[A-Za-z0-9_-]/.test(name);
}

// Branch creation and web file editing messages. The exact strings the pages
// show live here so a route never invents its own wording.
export const BRANCH_MESSAGES = {
  nameInvalid: "Invalid branch",
  nameExists: "Branch already exists",
  baseInvalid: "Base branch not found",
};

export const FILE_MESSAGES = {
  pathInvalid: "Invalid file path",
  commitMessageRequired: "Commit message is required",
  commitMessageTooLong: "Commit message must be 72 characters or fewer",
};

/** A commit message holds 1-72 non-empty characters after trimming. */
export const COMMIT_MESSAGE_MAX_LENGTH = 72;

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

// Branch names: 1-255 characters of ASCII letters, digits, `-`, `_`, `.` and
// `/`; a name never ends with `/` or `.`, and never contains `..` or `//`.
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

export function validateBranchName(value) {
  if (typeof value !== "string") return false;
  const name = value.trim();
  if (name.length < 1 || name.length > 255) return false;
  if (!BRANCH_NAME_PATTERN.test(name)) return false;
  if (name.endsWith("/") || name.endsWith(".")) return false;
  if (name.includes("..") || name.includes("//")) return false;
  return true;
}

// Repository roles that may create commits and branches. Read and Triage may
// browse but never write.
export const REPOSITORY_WRITE_ROLES = ["write", "maintain", "admin"];

export function canWriteRepository(repositoryRoleName) {
  return REPOSITORY_WRITE_ROLES.includes(repositoryRoleName);
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
