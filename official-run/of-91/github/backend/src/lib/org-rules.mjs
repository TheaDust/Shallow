// Input rules and the exact user-visible messages for organizations, teams and
// team hierarchy. Kept in one module so the frontend-visible contract and the
// server-side validation cannot drift apart.

import { normalizeText, validateUsername } from "./auth-rules.mjs";

export const ORG_MESSAGES = {
  organizationNameExists: "Organization name already exists",
  organizationNameFormat: "Organization name format is invalid",
  displayNameRequired: "Display name is required",
  teamNameInvalid: "Team name is invalid",
  parentTeamInvalid: "Parent team is invalid",
  cyclicHierarchy: "Cyclic team hierarchy is not allowed",
  accountNotFound: "Account not found",
  accountAlreadyMember: "Account is already a member",
  notOrganizationMember: "Account is not an organization member",
  lastOwner: "Organization must have at least one owner",
  roleInvalid: "Role is invalid",
  visibilityInvalid: "Visibility is invalid",
  accessDenied: "Access denied",
  repositoryNameRequired: "Repository name is required",
  repositoryNameFormat: "Repository name format is invalid",
  repositoryNameExists: "Repository name already exists",
  repositoryOwnerInvalid: "Owner is invalid",
};

// Messages of the branch and file operations (REQ-4-3, REQ-4-4).
export const BRANCH_MESSAGES = {
  branchNameInvalid: "Invalid branch",
  branchNameExists: "Branch name already exists",
  branchNotFound: "Branch not found",
  defaultBranchInvalid: "Default branch is invalid",
};

export const FILE_MESSAGES = {
  filePathInvalid: "Invalid file path",
  commitMessageRequired: "Commit message is required",
  commitMessageTooLong: "Commit message must be 72 characters or fewer",
};

// 1-100 characters of letters, digits, dots, hyphens or underscores. Generated
// names may carry a unique suffix, so the check stays permissive on purpose.
export const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export function validateRepositoryName(raw) {
  const value = normalizeText(raw);
  return REPOSITORY_NAME_PATTERN.test(value);
}

// 1-50 lowercase ASCII letters, digits or hyphens, never starting or ending
// with a hyphen. Consecutive hyphens are allowed because the requirement only
// forbids the two edge positions.
export const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/** Organization identifiers reuse the globally unique REQ-1 account format. */
export function validateOrganizationName(raw) {
  return validateUsername(raw);
}

/** 1-100 non-empty characters after trimming leading and trailing whitespace. */
export function validateDisplayName(raw) {
  const value = normalizeText(raw);
  return value.length >= 1 && value.length <= 100;
}

export function validateTeamName(raw) {
  const value = typeof raw === "string" ? raw : "";
  if (value.length < 1 || value.length > 50) return false;
  return TEAM_NAME_PATTERN.test(value);
}

/** Organization membership roles are only ever Member or Owner. */
export const MEMBERSHIP_ROLES = ["Member", "Owner"];

/** Repository access roles. These are operation-specific, not a cumulative ladder. */
export const ACCESS_ROLES = ["Read", "Triage", "Write", "Maintain", "Admin"];

export function validateMembershipRole(raw) {
  return MEMBERSHIP_ROLES.includes(raw);
}

export function validateAccessRole(raw) {
  return ACCESS_ROLES.includes(raw);
}

/** Repository visibility is only ever public or private. */
export const VISIBILITIES = ["public", "private"];

export function validateVisibility(raw) {
  return VISIBILITIES.includes(raw);
}

/**
 * A branch name is 1-255 characters of ASCII letters, digits, `-`, `_`, `.` or
 * `/`; it never ends with `/` or `.` and never contains `..` or `//`.
 */
export const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]{1,255}$/;

export function validateBranchName(raw) {
  const value = typeof raw === "string" ? raw : "";
  if (!BRANCH_NAME_PATTERN.test(value)) return false;
  if (value.endsWith("/") || value.endsWith(".")) return false;
  if (value.includes("..") || value.includes("//")) return false;
  return true;
}

/**
 * A new file path is a non-empty relative path: no leading `/`, no empty, `.`
 * or `..` segment. An existing file or directory at the same place is a
 * conflict and is reported by the store, not here.
 */
export function validateNewFilePath(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.startsWith("/")) return false;
  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** "ok", "required" or "too-long": 1-72 non-empty characters after trimming. */
export function validateCommitMessage(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return "required";
  if (value.length > 72) return "too-long";
  return "ok";
}

/** Roles that may create commits and branches; operation-specific, not a ladder. */
export const WRITE_ROLES = ["Write", "Maintain", "Admin"];

/** Roles that may manage issue metadata (assign, label, milestone, status). */
export const TRIAGE_ROLES = ["Triage", "Maintain", "Admin"];
