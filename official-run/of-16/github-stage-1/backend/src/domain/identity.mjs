import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import {
  MESSAGES,
  hasErrors,
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  validatePasswordChange,
  validatePasswordReset,
  validateRegistration,
} from "./validation.mjs";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "session";

function deriveSecret(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: deriveSecret(password, salt) };
}

export function verifyPassword(password, account) {
  if (typeof password !== "string" || !account?.passwordSalt || !account?.passwordHash) return false;
  const expected = Buffer.from(account.passwordHash, "hex");
  const candidate = Buffer.from(deriveSecret(password, account.passwordSalt), "hex");
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}

export function toPublicAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    verified: account.emailVerified === true,
    status: account.status,
  };
}

export function findAccountByUsername(state, username) {
  if (typeof username !== "string" || username.length === 0) return null;
  const needle = username.trim().toLowerCase();
  return state.accounts.find((account) => account.username.toLowerCase() === needle) ?? null;
}

export function findAccountByEmail(state, email) {
  const needle = normalizeEmail(email).toLowerCase();
  if (!needle) return null;
  return state.accounts.find((account) => account.email.toLowerCase() === needle) ?? null;
}

export function findAccountByIdentifier(state, identifier) {
  return findAccountByUsername(state, identifier) ?? findAccountByEmail(state, identifier);
}

export function createAccountRecord(state, { username, email, password }) {
  const { salt, hash } = hashPassword(password);
  const account = {
    id: randomUUID(),
    username,
    email,
    emailVerified: true,
    status: "available",
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  state.accounts.push(account);
  return account;
}

/** Validates, checks conflicts and stores a verified, sign-in-capable account. */
export function registerAccount(state, input = {}) {
  const { errors, values } = validateRegistration(input);

  if (!isValidUsername(values.username)) {
    errors.username = errors.username ?? MESSAGES.usernameFormat;
  } else if (findAccountByUsername(state, values.username)) {
    errors.username = MESSAGES.usernameExists;
  }

  if (!isValidEmail(values.email)) {
    errors.email = errors.email ?? MESSAGES.emailFormat;
  } else if (findAccountByEmail(state, values.email)) {
    errors.email = MESSAGES.emailExists;
  }

  if (hasErrors(errors)) return { errors };
  return { account: createAccountRecord(state, values) };
}

/**
 * Authenticates by username or email. Unknown identifiers, wrong passwords and
 * unavailable accounts are indistinguishable to the caller.
 */
export function authenticate(state, identifier, password) {
  const account = findAccountByIdentifier(state, identifier);
  if (!account || account.status !== "available") return null;
  if (!verifyPassword(password, account)) return null;
  return account;
}

export function createSession(state, accountId) {
  const session = {
    id: randomUUID(),
    accountId,
    status: "active",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.sessions.push(session);
  return session;
}

export function findSessionAccount(state, sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!session || session.status !== "active") return null;
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null;
  const account = state.accounts.find((candidate) => candidate.id === session.accountId);
  if (!account || account.status !== "available") return null;
  return account;
}

export function deleteSession(state, sessionId) {
  const before = state.sessions.length;
  state.sessions = state.sessions.filter((session) => session.id !== sessionId);
  return state.sessions.length !== before;
}

/**
 * Changes the password of one account. Only the session's own account is
 * touched. A missing or incorrect current password is reported first so that a
 * rejected submission shows that exact reason and never modifies credentials.
 */
export function changePassword(state, accountId, input = {}) {
  const account = state.accounts.find((candidate) => candidate.id === accountId) ?? null;
  if (!account) return { errors: { currentPassword: MESSAGES.currentPasswordIncorrect } };

  const { errors, values } = validatePasswordChange(input);
  if (values.currentPassword.length === 0) {
    return { errors: { currentPassword: MESSAGES.currentPasswordRequired } };
  }
  if (!verifyPassword(values.currentPassword, account)) {
    return { errors: { currentPassword: MESSAGES.currentPasswordIncorrect } };
  }
  if (hasErrors(errors)) return { errors };

  const { salt, hash } = hashPassword(values.newPassword);
  account.passwordSalt = salt;
  account.passwordHash = hash;
  account.passwordUpdatedAt = new Date().toISOString();
  return { ok: true };
}

/**
 * Applies a verified recovery. The fixed code is checked together with the new
 * password rules; an unknown email succeeds without modifying any record so that
 * recovery never discloses whether an account exists.
 */
export function resetPassword(state, input = {}) {
  const { errors, values } = validatePasswordReset(input);
  if (hasErrors(errors)) return { errors };

  const account = findAccountByEmail(state, values.email);
  if (account) {
    const { salt, hash } = hashPassword(values.newPassword);
    account.passwordSalt = salt;
    account.passwordHash = hash;
  }
  return { ok: true, updated: Boolean(account) };
}

export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
