/**
 * Domain rules for organizations, teams and organization-owned repositories
 * (REQ-2-1-1, REQ-2-1-2, REQ-2-2-1, REQ-2-2-2).
 *
 * The organization identifier reuses the REQ-1 username format: 1–39 characters
 * of lowercase ASCII letters and digits with single hyphens in between. The
 * display name is free text and only has to survive trimming.
 */

export const ORGANIZATION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ORGANIZATION_NAME_MAX_LENGTH = 39;
export const DISPLAY_NAME_MAX_LENGTH = 100;
export const TEAM_NAME_MAX_LENGTH = 50;

export const ORGANIZATION_MESSAGES = {
  taken: "Organization name already exists",
  format: "Organization name format is invalid",
  displayRequired: "Display name is required",
};

export const TEAM_MESSAGES = {
  required: "Team name is required",
  format: "Team name format is invalid",
  taken: "Team name already exists",
  parentOrganization: "Parent team does not belong to the organization",
  cycle: "Cyclic team hierarchy is not allowed",
};

export const TEAM_MEMBER_MESSAGES = {
  unknown: "Account not found",
  notMember: "Account is not an organization member",
  alreadyMember: "Account is already a member of this team",
};

/** Organization-membership roles (REQ-2-2-3). An Owner is the only role that
 * administers the organization; a Member only gets visibility and candidate
 * status for team/repository authorization. */
export const ORGANIZATION_MEMBER_ROLES = ["member", "owner"];

export const ORGANIZATION_MEMBER_MESSAGES = {
  unknown: "Account not found",
  alreadyMember: "Account is already a member",
  role: "Unsupported role",
  lastOwner: "The organization must keep at least one Owner",
  missing: "Member not found",
};

/** Repository role matrix (REQ-2-3): Read < Triage < Write < Maintain < Admin. */
export const REPOSITORY_ROLES = ["read", "triage", "write", "maintain", "admin"];

export const REPOSITORY_ROLE_LABELS = {
  read: "Read",
  triage: "Triage",
  write: "Write",
  maintain: "Maintain",
  admin: "Admin",
};

export const REPOSITORY_GRANT_MESSAGES = {
  role: "Unsupported role",
  account: "Account not found",
  team: "Team not found",
  subject: "Subject is not an organization member or team",
};

/** Normalizes a submitted organization-membership role, or null when unsupported. */
export function readMemberRole(value) {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ORGANIZATION_MEMBER_ROLES.includes(role) ? role : null;
}

/** Normalizes a submitted repository role, or null when unsupported. */
export function readRepositoryRole(value) {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  return REPOSITORY_ROLES.includes(role) ? role : null;
}

/**
 * Lookup / uniqueness key. Organization identifiers are compared case-insensitively
 * and spaces are equivalent to hyphens, so `Acme Demo` and `acme-demo` identify the
 * same organization (the seeded identifier is not required to be lowercase).
 */
export function organizationKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function validateOrganizationName(value) {
  if (typeof value !== "string") return ORGANIZATION_MESSAGES.format;
  if (value.length < 1 || value.length > ORGANIZATION_NAME_MAX_LENGTH) {
    return ORGANIZATION_MESSAGES.format;
  }
  if (!ORGANIZATION_NAME_PATTERN.test(value)) return ORGANIZATION_MESSAGES.format;
  return null;
}

/** Returns the trimmed display name, or the required-message when it is blank. */
export function readDisplayName(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < 1 || trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return { displayName: null, error: ORGANIZATION_MESSAGES.displayRequired };
  }
  return { displayName: trimmed, error: null };
}

export function validateTeamName(value) {
  if (typeof value !== "string" || value.trim().length === 0) return TEAM_MESSAGES.required;
  if (value.length > TEAM_NAME_MAX_LENGTH) return TEAM_MESSAGES.format;
  if (!ORGANIZATION_NAME_PATTERN.test(value)) return TEAM_MESSAGES.format;
  return null;
}

export function readTeamDescription(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 500);
}

export function readTeamParentId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
