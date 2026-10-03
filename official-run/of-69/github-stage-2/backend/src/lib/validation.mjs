// Field validation rules shared by registration, sign-in and recovery.
// Messages are the exact user-visible strings required by the product.

export const MESSAGES = {
  usernameInvalid: "Username format is invalid",
  usernameExists: "Username already exists",
  emailInvalid: "Email format is invalid",
  emailExists: "Email already exists",
  passwordInvalid: "Password requirements are not satisfied",
  confirmMismatch: "Passwords do not match",
  termsRequired: "Agree to terms is required",
  // REQ-1-3 account password change: field messages for the security form.
  currentPasswordRequired: "Current password is required",
  currentPasswordIncorrect: "Current password is incorrect",
  passwordConfirmationMismatch: "Password confirmation does not match",
  passwordUpdated: "Password updated",
};

const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_LOCAL_PATTERN = /^[^\s@]+$/;

/** 1-39 lowercase ASCII letters, digits or single hyphens; no leading/trailing hyphen. */
export function validateUsername(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 39 && USERNAME_PATTERN.test(value);
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * At most 254 characters after trimming, exactly one "@", a non-empty local
 * part, and a domain with at least one dot and non-empty labels.
 */
export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (email.length === 0 || email.length > 254) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!EMAIL_LOCAL_PATTERN.test(local)) return false;
  if (!domain.includes(".")) return false;
  const labels = domain.split(".");
  return labels.every((label) => label.length > 0 && !/\s/.test(label));
}

/** 12-128 chars with upper, lower, digit and non-alphanumeric, no whitespace. */
export function validatePassword(value) {
  if (typeof value !== "string") return false;
  if (value.length < 12 || value.length > 128) return false;
  if (/\s/.test(value)) return false;
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
}
