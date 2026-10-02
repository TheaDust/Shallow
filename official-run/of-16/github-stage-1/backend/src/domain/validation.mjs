export const USERNAME_MIN_LENGTH = 1;
export const USERNAME_MAX_LENGTH = 39;
export const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const EMAIL_MAX_LENGTH = 254;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const VERIFICATION_CODE = "123456";

export const ORGANIZATION_NAME_MIN_LENGTH = 1;
export const ORGANIZATION_NAME_MAX_LENGTH = 39;
// The unique organization name uses the same format as a REQ-1 username.
export const ORGANIZATION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DISPLAY_NAME_MAX_LENGTH = 100;

// Repository permission roles. They are operation-specific capabilities, not a
// cumulative ladder: only `admin` may manage the repository's access list.
export const REPOSITORY_ROLE_READ = "read";
export const REPOSITORY_ROLE_TRIAGE = "triage";
export const REPOSITORY_ROLE_WRITE = "write";
export const REPOSITORY_ROLE_MAINTAIN = "maintain";
export const REPOSITORY_ROLE_ADMIN = "admin";

export const REPOSITORY_ROLES = [
  REPOSITORY_ROLE_READ,
  REPOSITORY_ROLE_TRIAGE,
  REPOSITORY_ROLE_WRITE,
  REPOSITORY_ROLE_MAINTAIN,
  REPOSITORY_ROLE_ADMIN,
];

/** Visible label of each repository role; the values stay lowercase. */
export const REPOSITORY_ROLE_LABELS = {
  [REPOSITORY_ROLE_READ]: "Read",
  [REPOSITORY_ROLE_TRIAGE]: "Triage",
  [REPOSITORY_ROLE_WRITE]: "Write",
  [REPOSITORY_ROLE_MAINTAIN]: "Maintain",
  [REPOSITORY_ROLE_ADMIN]: "Admin",
};

/** An unknown or missing role falls back to the least-privileged role. */
export function normalizeRepositoryRole(value) {
  return REPOSITORY_ROLES.includes(value) ? value : REPOSITORY_ROLE_READ;
}

export function repositoryRoleLabel(value) {
  return REPOSITORY_ROLE_LABELS[normalizeRepositoryRole(value)];
}

export const TEAM_NAME_MIN_LENGTH = 1;
export const TEAM_NAME_MAX_LENGTH = 50;
// Lowercase ASCII letters, digits and hyphens, with no leading or trailing hyphen.
export const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const MESSAGES = {
  usernameExists: "Username already exists",
  usernameFormat: "Username format is invalid",
  emailExists: "Email already exists",
  emailFormat: "Email format is invalid",
  passwordRequirements: "Password requirements are not satisfied",
  passwordConfirmation: "Password confirmation does not match",
  agreeToTerms: "Agree to terms is required",
  verificationCode: "Verification code is invalid",
  currentPasswordRequired: "Current password is required",
  currentPasswordIncorrect: "Current password is incorrect",
  passwordUpdated: "Password updated",
  organizationNameExists: "Organization name already exists",
  organizationNameFormat: "Organization name format is invalid",
  displayNameRequired: "Display name is required",
  displayNameFormat: "Display name is invalid",
  teamNameInvalid: "Team name is invalid",
  teamNameExists: "Team name already exists",
  cyclicTeamHierarchy: "Cyclic team hierarchy is not allowed",
  parentTeamNotFound: "Parent team is invalid",
  accountNotFound: "Account not found",
  accountNotOrganizationMember: "Account is not an organization member",
  accountAlreadyMember: "Account is already a member",
  lastOrganizationOwner: "Organization must have at least one owner",
  teamNotFound: "Team not found",
  accessGrantNotFound: "Access grant not found",
  repositoryAccessDenied: "Access denied",
};

export function normalizeUsername(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePassword(value) {
  return typeof value === "string" ? value : "";
}

export function isValidUsername(value) {
  if (typeof value !== "string") return false;
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) return false;
  return USERNAME_PATTERN.test(value);
}

export function normalizeOrganizationName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDisplayName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidOrganizationName(value) {
  if (typeof value !== "string") return false;
  if (value.length < ORGANIZATION_NAME_MIN_LENGTH || value.length > ORGANIZATION_NAME_MAX_LENGTH) return false;
  return ORGANIZATION_NAME_PATTERN.test(value);
}

/**
 * Field rules for a submitted organization. Uniqueness needs the stored state
 * and is therefore decided by the organizations domain module.
 */
export function validateOrganizationFields(input = {}) {
  const name = normalizeOrganizationName(input.name);
  const displayName = normalizeDisplayName(input.displayName);

  const errors = {};
  if (!isValidOrganizationName(name)) errors.name = MESSAGES.organizationNameFormat;
  if (displayName.length === 0) errors.displayName = MESSAGES.displayNameRequired;
  else if (displayName.length > DISPLAY_NAME_MAX_LENGTH) errors.displayName = MESSAGES.displayNameFormat;

  return { errors, values: { name, displayName } };
}

export function normalizeMemberIdentifier(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTeamName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidTeamName(value) {
  if (typeof value !== "string") return false;
  if (value.length < TEAM_NAME_MIN_LENGTH || value.length > TEAM_NAME_MAX_LENGTH) return false;
  return TEAM_NAME_PATTERN.test(value);
}

/**
 * Field rules for a submitted team. Uniqueness and the hierarchy rules need the
 * stored state and are therefore decided by the teams domain module.
 */
export function validateTeamFields(input = {}) {
  const name = normalizeTeamName(input.name);

  const errors = {};
  if (!isValidTeamName(name)) errors.name = MESSAGES.teamNameInvalid;

  return { errors, values: { name } };
}

export function isValidEmail(value) {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length === 0) return false;
  if (!domain.includes(".")) return false;
  return domain.split(".").every((label) => label.length > 0);
}

export function isCompliantPassword(value) {
  if (typeof value !== "string") return false;
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) return false;
  if (/\s/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

/**
 * Validates every registration field at once so that one submission can surface
 * all applicable messages (username, email, password, confirmation, terms).
 */
export function validateRegistration(input = {}) {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);
  const confirmPassword = normalizePassword(input.confirmPassword);
  const agreeToTerms = input.agreeToTerms === true;

  const errors = {};
  if (!isValidUsername(username)) errors.username = MESSAGES.usernameFormat;
  if (!isValidEmail(email)) errors.email = MESSAGES.emailFormat;

  const passwordCompliant = isCompliantPassword(password);
  if (!passwordCompliant) errors.password = MESSAGES.passwordRequirements;
  if (passwordCompliant && confirmPassword !== password) {
    errors.confirmPassword = MESSAGES.passwordConfirmation;
  }
  if (!agreeToTerms) errors.agreeToTerms = MESSAGES.agreeToTerms;

  return { errors, values: { username, email, password, confirmPassword, agreeToTerms } };
}

/**
 * Rules for the new credentials of a password change. The current-password
 * check needs the stored account and is therefore applied in the identity
 * module; this function only covers the candidate password and its confirmation.
 */
export function validatePasswordChange(input = {}) {
  const currentPassword = normalizePassword(input.currentPassword);
  const newPassword = normalizePassword(input.newPassword);
  const confirmPassword = normalizePassword(input.confirmPassword);

  const errors = {};
  const passwordCompliant = isCompliantPassword(newPassword);
  if (!passwordCompliant) errors.newPassword = MESSAGES.passwordRequirements;
  if (passwordCompliant && confirmPassword !== newPassword) {
    errors.confirmPassword = MESSAGES.passwordConfirmation;
  }

  return { errors, values: { currentPassword, newPassword, confirmPassword } };
}

export function validatePasswordReset(input = {}) {
  const email = normalizeEmail(input.email);
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const newPassword = normalizePassword(input.newPassword);
  const confirmPassword = normalizePassword(input.confirmPassword);

  const errors = {};
  if (!isValidEmail(email)) errors.email = MESSAGES.emailFormat;
  if (code !== VERIFICATION_CODE) errors.code = MESSAGES.verificationCode;
  const passwordCompliant = isCompliantPassword(newPassword);
  if (!passwordCompliant) errors.newPassword = MESSAGES.passwordRequirements;
  if (passwordCompliant && confirmPassword !== newPassword) {
    errors.confirmPassword = MESSAGES.passwordConfirmation;
  }

  return { errors, values: { email, code, newPassword } };
}
