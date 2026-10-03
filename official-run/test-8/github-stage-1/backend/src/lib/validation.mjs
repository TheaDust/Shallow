/**
 * Account input rules shared by registration, sign-in and password recovery.
 * These rules are the single authority for username / email / password validity.
 */

export const VERIFICATION_CODE = "123456";

export const MESSAGES = {
  usernameExists: "Username already exists",
  usernameInvalid: "Username format is invalid",
  emailInvalid: "Email format is invalid",
  emailExists: "Email already exists",
  passwordInvalid: "Password requirements are not satisfied",
  passwordMismatch: "Password confirmation does not match",
  termsRequired: "Agree to terms is required",
  invalidCredentials: "Invalid credentials",
  invalidCode: "Verification code is invalid",
  passwordUpdated: "Password updated",
  currentPasswordRequired: "Current password is required",
  currentPasswordIncorrect: "Current password is incorrect",
  organizationNameExists: "Organization name already exists",
  organizationNameInvalid: "Organization name format is invalid",
  displayNameRequired: "Display name is required",
  displayNameTooLong: "Display name is too long",
  teamNameInvalid: "Team name is invalid",
  teamNameExists: "Team name already exists",
  cyclicTeamHierarchy: "Cyclic team hierarchy is not allowed",
  accountNotFound: "Account not found",
  notOrganizationMember: "Account is not an organization member",
  alreadyMember: "Account is already a member",
  lastOwner: "Organization must have at least one Owner",
  roleInvalid: "Role is invalid",
  teamNotFound: "Team not found",
  accessDenied: "Access denied",
};

/**
 * Organization and repository role vocabularies. They are stored lowercase so
 * one value can be compared across membership, grant and access checks; display
 * labels are derived with `roleLabel`.
 */
export const ORGANIZATION_ROLES = ["member", "owner"];
export const REPOSITORY_ROLES = ["read", "triage", "write", "maintain", "admin"];

export function normalizeRole(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidOrganizationRole(value) {
  return ORGANIZATION_ROLES.includes(normalizeRole(value));
}

export function isValidRepositoryRole(value) {
  return REPOSITORY_ROLES.includes(normalizeRole(value));
}

/** “write” → “Write”; the label shown next to a member or an access row. */
export function roleLabel(value) {
  const role = normalizeRole(value);
  return role.length > 0 ? role[0].toUpperCase() + role.slice(1) : "";
}

const ORGANIZATION_NAME_MAX_LENGTH = 39;
const DISPLAY_NAME_MAX_LENGTH = 100;
const TEAM_NAME_MAX_LENGTH = 50;

const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USERNAME_MAX_LENGTH = 39;
const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

export function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeUsername(value) {
  return normalizeText(value);
}

/** Organization identifiers follow the same globally unique username format. */
export function isValidOrganizationName(value) {
  const name = normalizeText(value);
  return name.length >= 1 && name.length <= ORGANIZATION_NAME_MAX_LENGTH && USERNAME_PATTERN.test(name);
}

export function isValidDisplayName(value) {
  const name = normalizeText(value);
  return name.length >= 1 && name.length <= DISPLAY_NAME_MAX_LENGTH;
}

/** 1–50 lowercase letters, digits or hyphens with no leading/trailing hyphen. */
export function isValidTeamName(value) {
  const name = normalizeText(value);
  if (name.length < 1 || name.length > TEAM_NAME_MAX_LENGTH) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  return !name.startsWith("-") && !name.endsWith("-");
}

export function isValidUsername(value) {
  const username = normalizeUsername(value);
  return username.length >= 1
    && username.length <= USERNAME_MAX_LENGTH
    && USERNAME_PATTERN.test(username);
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length === 0 || domain.length === 0) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0);
}

export function isValidPassword(value) {
  if (typeof value !== "string") return false;
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) return false;
  if (/\s/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}
