// Input rules and the exact user-visible messages for account registration and
// password recovery. Kept in one module so the frontend-visible contract and the
// server-side validation cannot drift apart.

export const FIXED_VERIFICATION_CODE = "123456";

export const MESSAGES = {
  usernameExists: "Username already exists",
  usernameFormat: "Username format is invalid",
  emailFormat: "Email format is invalid",
  emailExists: "Email already exists",
  password: "Password requirements are not satisfied",
  confirmMismatch: "Password confirmation does not match",
  terms: "Agree to terms is required",
  invalidCode: "Verification code is invalid",
  passwordUpdated: "Password updated",
  sessionRevoked: "Session revoked",
  currentSessionLocked: "The current session cannot be revoked",
  sessionNotFound: "Session not found",
  invalidCredentials: "Invalid credentials",
  currentPasswordRequired: "Current password is required",
  currentPasswordIncorrect: "Current password is incorrect",
};

/**
 * Field errors for changing the password of an already authenticated account.
 * The current-password check runs first and short-circuits so an incorrect or
 * missing current password is reported on its own; only a verified current
 * password moves on to the new-password and confirmation rules.
 */
export function validatePasswordChange(input, currentPasswordMatches) {
  const currentPassword = typeof input?.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input?.newPassword === "string" ? input.newPassword : "";
  const confirmPassword = typeof input?.confirmPassword === "string" ? input.confirmPassword : "";

  if (!currentPassword) {
    return { currentPassword, newPassword, confirmPassword, fieldErrors: { currentPassword: MESSAGES.currentPasswordRequired } };
  }
  if (!currentPasswordMatches) {
    return { currentPassword, newPassword, confirmPassword, fieldErrors: { currentPassword: MESSAGES.currentPasswordIncorrect } };
  }

  const fieldErrors = {};
  if (!validatePassword(newPassword)) fieldErrors.newPassword = MESSAGES.password;
  if (confirmPassword !== newPassword) fieldErrors.confirmPassword = MESSAGES.confirmMismatch;
  return { currentPassword, newPassword, confirmPassword, fieldErrors };
}

// A username may mix lowercase ASCII letters and digits with *single* hyphens
// or underscores as separators: no leading/trailing separator and no doubled
// separator, so "a--b", "_a" and "a_" are all rejected.
const USERNAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateUsername(raw) {
  const value = typeof raw === "string" ? raw : "";
  if (value.length < 1 || value.length > 39) return false;
  return USERNAME_PATTERN.test(value);
}

/**
 * Human-readable device label stored with a browser session. It is derived from
 * the request's User-Agent at sign-in time and never contains a secret.
 */
export function describeDevice(userAgent) {
  const value = typeof userAgent === "string" ? userAgent : "";
  const browser =
    [
      ["Edg/", "Edge"],
      ["OPR/", "Opera"],
      ["Chrome/", "Chrome"],
      ["Firefox/", "Firefox"],
      ["Safari/", "Safari"],
    ].find(([token]) => value.includes(token))?.[1] ?? "Web browser";
  const system =
    [
      ["Windows", "Windows"],
      ["Macintosh", "macOS"],
      ["iPhone", "iPhone"],
      ["iPad", "iPad"],
      ["Android", "Android"],
      ["Linux", "Linux"],
    ].find(([token]) => value.includes(token))?.[1] ?? null;
  return system ? `${browser} on ${system}` : browser;
}

export function validateEmail(raw) {
  const value = normalizeText(raw);
  if (!value || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0);
}

export function validatePassword(raw) {
  const value = typeof raw === "string" ? raw : "";
  if (value.length < 12 || value.length > 128) return false;
  if (/\s/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}

/**
 * Collects every applicable field error so a single submission can surface the
 * username, email, password, confirmation, and terms messages together.
 */
export function validateRegistration(input, existing = {}) {
  const username = typeof input?.username === "string" ? input.username : "";
  const email = normalizeText(input?.email);
  const password = typeof input?.password === "string" ? input.password : "";
  const confirmPassword = typeof input?.confirmPassword === "string" ? input.confirmPassword : "";
  const agreeToTerms = input?.agreeToTerms === true;

  const fieldErrors = {};

  if (!validateUsername(username)) {
    fieldErrors.username = MESSAGES.usernameFormat;
  } else if (existing.usernameExists?.(username)) {
    fieldErrors.username = MESSAGES.usernameExists;
  }

  if (!validateEmail(email)) {
    fieldErrors.email = MESSAGES.emailFormat;
  } else if (existing.emailExists?.(email)) {
    fieldErrors.email = MESSAGES.emailExists;
  }

  if (!validatePassword(password)) {
    fieldErrors.password = MESSAGES.password;
  }

  if (confirmPassword !== password) {
    fieldErrors.confirmPassword = MESSAGES.confirmMismatch;
  }

  if (!agreeToTerms) {
    fieldErrors.terms = MESSAGES.terms;
  }

  return {
    username,
    email,
    password,
    fieldErrors,
    valid: Object.keys(fieldErrors).length === 0,
  };
}

export function validatePasswordReset(input, expectedCode = FIXED_VERIFICATION_CODE) {
  const email = normalizeText(input?.email);
  const code = normalizeText(input?.code);
  const newPassword = typeof input?.newPassword === "string" ? input.newPassword : "";
  const confirmPassword = typeof input?.confirmPassword === "string" ? input.confirmPassword : "";

  const fieldErrors = {};

  if (code !== expectedCode) {
    fieldErrors.code = MESSAGES.invalidCode;
  }

  if (!validatePassword(newPassword)) {
    fieldErrors.newPassword = MESSAGES.password;
  }

  if (confirmPassword !== newPassword) {
    fieldErrors.confirmPassword = MESSAGES.confirmMismatch;
  }

  return {
    email,
    code,
    newPassword,
    fieldErrors,
    valid: Object.keys(fieldErrors).length === 0,
  };
}
