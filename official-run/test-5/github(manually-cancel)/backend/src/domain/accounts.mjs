import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Domain rules for the account identity module (REQ-1-1-1 / REQ-1-1-2).
 * The same rules are mirrored in the frontend for immediate field feedback;
 * the server remains the authoritative, trusted validation boundary.
 */

export const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const USERNAME_MAX_LENGTH = 39;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const USERNAME_MESSAGES = {
  format: "Username format is invalid",
  taken: "Username already exists",
};
export const EMAIL_MESSAGES = {
  format: "Email format is invalid",
  taken: "Email already exists",
};
export const PASSWORD_MESSAGE = "Password requirements are not satisfied";
export const PASSWORD_CONFIRMATION_MESSAGE = "Password confirmation does not match";
export const TERMS_MESSAGE = "Agree to terms is required";

/**
 * REQ-1-3 / REQ-1-1-3 credential-change rules. The local product never sends
 * email: the recovery code below is the fixed value the page displays.
 */
export const CURRENT_PASSWORD_MESSAGES = {
  required: "Current password is required",
  incorrect: "Current password is incorrect",
};
export const RECOVERY_CODE = "123456";
export const VERIFICATION_CODE_MESSAGE = "Verification code is invalid";
export const UNKNOWN_EMAIL_MESSAGE = "Email is not registered";

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const derived = scryptSync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function validateUsername(value) {
  if (typeof value !== "string") return USERNAME_MESSAGES.format;
  const username = value;
  if (username.length < 1 || username.length > USERNAME_MAX_LENGTH) return USERNAME_MESSAGES.format;
  if (!USERNAME_PATTERN.test(username)) return USERNAME_MESSAGES.format;
  return null;
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > EMAIL_MAX_LENGTH) return EMAIL_MESSAGES.format;
  if (/\s/.test(email)) return EMAIL_MESSAGES.format;
  const parts = email.split("@");
  if (parts.length !== 2) return EMAIL_MESSAGES.format;
  const [local, domain] = parts;
  if (!local) return EMAIL_MESSAGES.format;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return EMAIL_MESSAGES.format;
  return null;
}

export function validatePassword(value) {
  const password = typeof value === "string" ? value : "";
  const compliant =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password) &&
    !/\s/.test(password);
  return compliant ? null : PASSWORD_MESSAGE;
}

export function findAccountByEmail(accounts, email) {
  const value = normalizeEmail(email);
  if (!value) return null;
  return accounts.find((account) => account.email === value) ?? null;
}

export function findAccountByIdentifier(accounts, identifier) {
  const value = typeof identifier === "string" ? identifier.trim() : "";
  if (!value) return null;
  const lowered = value.toLowerCase();
  return (
    accounts.find((account) => account.username === lowered) ??
    accounts.find((account) => account.email === lowered) ??
    null
  );
}

export function publicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    emailVerified: account.emailVerified === true,
    status: account.status ?? "active",
  };
}
