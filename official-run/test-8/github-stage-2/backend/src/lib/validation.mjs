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
  visibilityInvalid: "Visibility is invalid",
  accessDenied: "Access denied",
  repositoryNameRequired: "Repository name is required",
  repositoryNameExists: "Repository name already exists",
  repositoryNameInvalid: "Repository name format is invalid",
  ownerNotFound: "Owner not found",
  ownerForbidden: "You do not have permission to create repositories for this owner",
  fileNotFound: "File not found",
  branchNotFound: "Branch not found",
  commitNotFound: "Commit not found",
  branchNameInvalid: "Invalid branch",
  branchNameExists: "Branch already exists",
  filePathInvalid: "Invalid file path",
  commitMessageRequired: "Commit message is required",
  commitMessageTooLong: "Commit message is too long",
};

/**
 * Repository roles that may write (REQ-4-3-2 branch creation, REQ-4-4 file
 * commits). Organization Owners resolve to `admin` through the access rule, so
 * they are covered as well; Read and Triage may only browse.
 */
export const WRITE_REPOSITORY_ROLES = ["write", "maintain", "admin"];

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
const REPOSITORY_NAME_MAX_LENGTH = 100;
const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

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

/** 1–100 letters, digits, dots, underscores or hyphens; no spaces or slashes. */
const BRANCH_NAME_MAX_LENGTH = 255;
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

/**
 * Branch names are 1–255 characters of ASCII letters, digits, `-`, `_`, `.` and
 * `/`; they must not end with `/` or `.` and must not contain `..` or `//`
 * (REQ-4-3 folder rule, shared by REQ-4-3-2 creation).
 */
export function isValidBranchName(value) {
  const name = normalizeText(value);
  if (name.length < 1 || name.length > BRANCH_NAME_MAX_LENGTH) return false;
  if (!BRANCH_NAME_PATTERN.test(name)) return false;
  if (name.endsWith("/") || name.endsWith(".")) return false;
  if (name.includes("..") || name.includes("//")) return false;
  return true;
}

/** Commit messages hold 1–72 non-empty characters after trimming (REQ-4-4). */
export const COMMIT_MESSAGE_MAX_LENGTH = 72;

/** The validation message of one commit message, or null when it is valid. */
export function commitMessageError(value) {
  const message = normalizeText(value);
  if (message.length === 0) return MESSAGES.commitMessageRequired;
  if (message.length > COMMIT_MESSAGE_MAX_LENGTH) return MESSAGES.commitMessageTooLong;
  return null;
}

export function isValidRepositoryName(value) {
  const name = normalizeText(value);
  return name.length >= 1 && name.length <= REPOSITORY_NAME_MAX_LENGTH && REPOSITORY_NAME_PATTERN.test(name);
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
