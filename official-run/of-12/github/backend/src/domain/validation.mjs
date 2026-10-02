/**
 * Pure input rules shared by registration (REQ-1-1-1) and password recovery
 * (REQ-1-1-3): username, email and password formats.
 */

export const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const USERNAME_MIN_LENGTH = 1;
export const USERNAME_MAX_LENGTH = 39;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function isValidUsername(username) {
  if (typeof username !== "string") return false;
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) return false;
  return USERNAME_PATTERN.test(username);
}

export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim() : "";
}

export function isValidEmail(email) {
  const value = normalizeEmail(email);
  if (!value || value.length > EMAIL_MAX_LENGTH) return false;
  if (/\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local) return false;
  if (!domain.includes(".")) return false;
  return domain.split(".").every((label) => label.length > 0);
}

export const DISPLAY_NAME_MAX_LENGTH = 100;

/**
 * An organization name uses the very same globally unique format as a
 * username (REQ-2-1), so the rule is shared instead of duplicated.
 */
export function isValidOrganizationName(name) {
  return isValidUsername(name);
}

/**
 * A display name keeps 1-100 characters after trimming surrounding
 * whitespace; a whitespace-only value has no content and is invalid.
 */
export function normalizeDisplayName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidDisplayName(value) {
  const displayName = normalizeDisplayName(value);
  return displayName.length >= 1 && displayName.length <= DISPLAY_NAME_MAX_LENGTH;
}

export function isValidPassword(password) {
  if (typeof password !== "string") return false;
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return false;
  if (/\s/.test(password)) return false;
  return /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}
