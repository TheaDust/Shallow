// Pure input rules shared by registration, sign-in and password recovery.

export const USERNAME_MIN_LENGTH = 1;
export const USERNAME_MAX_LENGTH = 39;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const TEAM_NAME_MAX_LENGTH = 50;

// Lowercase ASCII letters, digits and single hyphens; never leading or trailing.
const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 1-50 lowercase ASCII letters, digits or hyphens; never leading or trailing.
// Consecutive hyphens stay allowed here, unlike the stricter REQ-1 username.
const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidUsername(value) {
  if (typeof value !== "string") return false;
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) return false;
  return USERNAME_PATTERN.test(value);
}

export function isValidTeamName(value) {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > TEAM_NAME_MAX_LENGTH) return false;
  return TEAM_NAME_PATTERN.test(value);
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  if (/\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length === 0) return false;
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
