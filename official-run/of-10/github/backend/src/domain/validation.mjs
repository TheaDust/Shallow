// Account input rules shared by registration, sign-in, recovery and password change.
import { verifyPassword } from "./credentials.mjs";

/** Fixed local demonstration code; it has no delivery, expiry or one-time semantics. */
export const RESET_VERIFICATION_CODE = "123456";

export const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const USERNAME_MIN_LENGTH = 1;
export const USERNAME_MAX_LENGTH = 39;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const ACCOUNT_MESSAGES = {
  usernameExists: "Username already exists",
  usernameFormat: "Username format is invalid",
  emailExists: "Email already exists",
  emailFormat: "Email format is invalid",
  password: "Password requirements are not satisfied",
  confirmPassword: "Passwords do not match",
  terms: "Agree to terms is required",
  verificationCode: "Verification code is invalid",
  recoveryEmailUnknown: "No account is associated with that email address",
  currentPasswordRequired: "Current password is required",
  currentPasswordIncorrect: "Current password is incorrect",
  passwordConfirmation: "Password confirmation does not match",
};

function readText(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeUsername(value) {
  return typeof value === "string" ? value : "";
}

export function isValidUsername(value) {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) return false;
  return USERNAME_PATTERN.test(username);
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > EMAIL_MAX_LENGTH) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0);
}

export function isValidPassword(value) {
  if (typeof value !== "string") return false;
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) return false;
  if (/[\s\u00a0\u200b]/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}

/**
 * Field-level registration errors. Every violated rule is reported so that a
 * single submission shows all messages together instead of the first one only.
 */
export function collectRegistrationErrors(input = {}) {
  const errors = {};
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
  const termsAccepted = input.termsAccepted === true;

  if (!isValidUsername(username)) errors.username = ACCOUNT_MESSAGES.usernameFormat;
  if (!isValidEmail(email)) errors.email = ACCOUNT_MESSAGES.emailFormat;
  if (!isValidPassword(password)) errors.password = ACCOUNT_MESSAGES.password;
  if (confirmPassword !== password) errors.confirmPassword = ACCOUNT_MESSAGES.confirmPassword;
  if (!termsAccepted) errors.terms = ACCOUNT_MESSAGES.terms;

  return errors;
}

/**
 * Recovery submission rules. The email itself is resolved by the caller so that
 * an unknown address reports the same field errors as a registered one.
 */
export function collectPasswordResetErrors(input = {}) {
  const errors = {};
  const code = readText(input.code);
  const newPassword = readText(input.newPassword);
  const confirmPassword = readText(input.confirmPassword);

  if (code !== RESET_VERIFICATION_CODE) errors.verificationCode = ACCOUNT_MESSAGES.verificationCode;
  if (!isValidPassword(newPassword)) errors.newPassword = ACCOUNT_MESSAGES.password;
  if (confirmPassword !== newPassword) errors.confirmPassword = ACCOUNT_MESSAGES.confirmPassword;

  return errors;
}

/**
 * Password-change rules for the current account. The current password is
 * verified against the stored credential of the session's account only.
 */
export function collectPasswordChangeErrors(input = {}, credential) {
  const errors = {};
  const currentPassword = readText(input.currentPassword);
  const newPassword = readText(input.newPassword);
  const confirmPassword = readText(input.confirmPassword);

  if (!currentPassword) errors.currentPassword = ACCOUNT_MESSAGES.currentPasswordRequired;
  else if (!verifyPassword(currentPassword, credential)) {
    errors.currentPassword = ACCOUNT_MESSAGES.currentPasswordIncorrect;
  }
  if (!isValidPassword(newPassword)) errors.newPassword = ACCOUNT_MESSAGES.password;
  if (confirmPassword !== newPassword) errors.confirmPassword = ACCOUNT_MESSAGES.passwordConfirmation;

  return errors;
}
