import { createHash, randomBytes, randomUUID } from "node:crypto";

export const RECOVERY_CODE = "123456";

const USERNAME_PATTERN = /^[a-z0-9](?:-?[a-z0-9]){0,38}$/;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const EMAIL_MAX = 254;

export function validateUsername(value) {
  if (typeof value !== "string") return false;
  return USERNAME_PATTERN.test(value);
}

export function validateEmail(value) {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (email.length === 0 || email.length > EMAIL_MAX) return false;
  const atIndexes = [];
  for (let index = 0; index < email.length; index += 1) {
    if (email[index] === "@") atIndexes.push(index);
  }
  if (atIndexes.length !== 1) return false;
  const local = email.slice(0, atIndexes[0]);
  const domain = email.slice(atIndexes[0] + 1);
  if (local.length === 0) return false;
  if (!domain.includes(".")) return false;
  if (domain.split(".").some((label) => label.length === 0)) return false;
  return true;
}

export function validatePassword(value) {
  if (typeof value !== "string") return false;
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) return false;
  if (/\s/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return { salt, hash };
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== "string") return false;
  const hash = createHash("sha256").update(`${stored.salt}:${password}`).digest("hex");
  return hash === stored.hash;
}

export function makeAccount({ username, email, password }) {
  return {
    id: `acc_${randomUUID()}`,
    username,
    email,
    emailVerified: true,
    status: "active",
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Seeds shared initial data into an empty storage. Existing user modifications
 * (including changed passwords) are preserved across restarts.
 */
export function seedState(state) {
  if (state.accounts.length > 0) return;
  state.accounts.push(makeAccount({
    username: "alice-dev",
    email: "alice.dev@example.test",
    password: "Valid-password-123!",
  }));
}

/**
 * Registers a new sign-in-capable account with a verified email.
 * Returns { ok: true } or { ok: false, errors } with itemized field messages.
 */
export function registerAccount(state, input = {}) {
  const { username, email, password, confirmPassword, agreeToTerms } = input;
  const trimmedUsername = typeof username === "string" ? username.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";

  const errors = {};
  const usernameValid = validateUsername(trimmedUsername);
  if (!usernameValid) {
    errors.username = "Username format is invalid";
  }
  const emailValid = validateEmail(trimmedEmail);
  if (!emailValid) {
    errors.email = "Email format is invalid";
  }
  if (!validatePassword(password)) {
    errors.password = "Password requirements are not satisfied";
  }
  if (typeof confirmPassword !== "string" || confirmPassword !== password) {
    errors.confirmPassword = "Password confirmation does not match";
  }
  if (!agreeToTerms) {
    errors.terms = "Agree to terms is required";
  }
  if (usernameValid) {
    if (state.accounts.some((account) => account.username === trimmedUsername)) {
      errors.username = "Username already exists";
    }
  }
  if (emailValid) {
    if (state.accounts.some((account) => account.email === trimmedEmail)) {
      errors.email = "Email already exists";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  state.accounts.push(makeAccount({
    username: trimmedUsername,
    email: trimmedEmail,
    password,
  }));
  return { ok: true };
}

/**
 * Validates credentials and creates a session on success. All authentication
 * failures share the same generic result so the account existence is not
 * disclosed.
 */
export function createSession(state, { identifier, password } = {}) {
  const value = typeof identifier === "string" ? identifier.trim() : "";
  const account = state.accounts.find(
    (candidate) => candidate.username === value || candidate.email === value,
  );
  const available = Boolean(account) && account.status === "active";
  if (!available || !verifyPassword(password, account?.password)) {
    return { ok: false };
  }
  const session = {
    id: `sess_${randomUUID()}`,
    accountId: account.id,
    active: true,
    createdAt: new Date().toISOString(),
  };
  state.sessions.push(session);
  return {
    ok: true,
    sessionId: session.id,
    account: { username: account.username, email: account.email },
  };
}

export function currentAccount(state, sessionId) {
  if (!sessionId) return null;
  const session = state.sessions.find((candidate) => candidate.id === sessionId && candidate.active);
  if (!session) return null;
  const account = state.accounts.find((candidate) => candidate.id === session.accountId);
  if (!account) return null;
  return { id: account.id, username: account.username, email: account.email };
}

export function endSession(state, sessionId) {
  if (!sessionId) return;
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (session) session.active = false;
}

/**
 * Changes the password of the current account only. Requires the correct
 * current password, a compliant new password, and a matching confirmation.
 * Returns { ok: true } or { ok: false, errors } with field messages.
 */
export function changePassword(state, { accountId, currentPassword, newPassword, confirmPassword } = {}) {
  const account = state.accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    return { ok: false, errors: { currentPassword: "Current password is required" } };
  }

  const errors = {};
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    errors.currentPassword = "Current password is required";
  } else if (!verifyPassword(currentPassword, account.password)) {
    errors.currentPassword = "Current password is incorrect";
  }
  if (!validatePassword(newPassword)) {
    errors.password = "Password requirements are not satisfied";
  }
  if (typeof confirmPassword !== "string" || confirmPassword !== newPassword) {
    errors.confirmPassword = "Password confirmation does not match";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  account.password = hashPassword(newPassword);
  return { ok: true };
}

/**
 * Starts the local password-recovery flow. The same fixed demonstration code is
 * returned for registered and unknown emails so the request does not disclose
 * whether an account exists.
 */
export function requestRecovery(state, { email } = {}) {
  const value = typeof email === "string" ? email.trim() : "";
  const token = `rec_${randomUUID()}`;
  state.recovery.push({
    token,
    email: value,
    createdAt: new Date().toISOString(),
  });
  return { token, code: RECOVERY_CODE };
}

/**
 * Applies the recovery reset only when the recovery context belongs to a
 * registered email, the code matches, and the new password is compliant and
 * confirmed.
 */
export function resetPassword(state, { token, code, newPassword, confirmPassword } = {}) {
  const recovery = state.recovery.find((candidate) => candidate.token === token);
  const account = recovery
    ? state.accounts.find((candidate) => candidate.email === recovery.email)
    : undefined;

  const errors = {};
  if (!account) {
    errors.email = "Email is not registered";
  }
  if (code !== RECOVERY_CODE) {
    errors.code = "Verification code is invalid";
  }
  if (!validatePassword(newPassword)) {
    errors.password = "Password requirements are not satisfied";
  }
  if (typeof confirmPassword !== "string" || confirmPassword !== newPassword) {
    errors.confirmPassword = "Password confirmation does not match";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  account.password = hashPassword(newPassword);
  return { ok: true };
}
