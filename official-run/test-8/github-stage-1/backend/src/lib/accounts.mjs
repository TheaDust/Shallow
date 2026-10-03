import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import {
  MESSAGES,
  VERIFICATION_CODE,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeEmail,
  normalizeUsername,
} from "./validation.mjs";

/**
 * Accounts and sessions live inside one persisted state document
 * (`{ accounts: [], sessions: [] }`). All mutations go through the store so
 * that concurrent requests cannot interleave partial writes.
 */

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(String(password), salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(String(password), salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function publicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    emailVerified: account.emailVerified === true,
  };
}

function findAccountByUsername(accounts, username) {
  return accounts.find((account) => account.username === username);
}

function findAccountByEmail(accounts, email) {
  const normalized = email.toLowerCase();
  return accounts.find((account) => String(account.email).toLowerCase() === normalized);
}

function findAccountByIdentifier(accounts, identifier) {
  const value = typeof identifier === "string" ? identifier.trim() : "";
  if (!value) return undefined;
  return findAccountByUsername(accounts, value) ?? findAccountByEmail(accounts, value);
}

export function validateRegistrationInput(input = {}) {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  const fields = {};
  if (!isValidUsername(username)) fields.username = MESSAGES.usernameInvalid;
  if (!isValidEmail(email)) fields.email = MESSAGES.emailInvalid;
  if (!isValidPassword(password)) fields.password = MESSAGES.passwordInvalid;
  else if (password !== confirmPassword) fields.confirmPassword = MESSAGES.passwordMismatch;
  if (input.agreeToTerms !== true) fields.terms = MESSAGES.termsRequired;

  return { fields, username, email, password };
}

export async function registerAccount(store, input = {}) {
  const { fields, username, email, password } = validateRegistrationInput(input);
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  let conflicts = null;
  const account = {
    id: randomUUID(),
    username,
    email,
    emailVerified: true,
    status: "available",
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  await store.update((state) => {
    conflicts = {};
    if (findAccountByUsername(state.accounts, username)) conflicts.username = MESSAGES.usernameExists;
    if (findAccountByEmail(state.accounts, email)) conflicts.email = MESSAGES.emailExists;
    if (Object.keys(conflicts).length > 0) return;
    state.accounts.push(account);
  });

  if (conflicts && Object.keys(conflicts).length > 0) return { ok: false, fields: conflicts };
  return { ok: true, account };
}

export async function authenticate(store, input = {}) {
  const state = await store.read();
  const account = findAccountByIdentifier(state.accounts, input.identifier);
  const password = typeof input.password === "string" ? input.password : "";
  if (!account || account.status !== "available") return null;
  if (!verifyPassword(password, account.passwordHash)) return null;
  return account;
}

export async function createSession(store, accountId) {
  const session = {
    id: randomBytes(24).toString("hex"),
    accountId,
    active: true,
    createdAt: new Date().toISOString(),
    endedAt: null,
  };
  await store.update((state) => {
    state.sessions.push(session);
  });
  return session;
}

export async function readSession(store, sessionId) {
  if (!sessionId) return null;
  const state = await store.read();
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!session || session.active !== true) return null;
  const account = state.accounts.find((candidate) => candidate.id === session.accountId);
  if (!account || account.status !== "available") return null;
  return { session, account };
}

export async function endSession(store, sessionId) {
  if (!sessionId) return false;
  let ended = false;
  await store.update((state) => {
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || session.active !== true) return;
    session.active = false;
    session.endedAt = new Date().toISOString();
    ended = true;
  });
  return ended;
}

/**
 * Recovery always advances to the reset step and always reports the same fixed
 * verification code, so an unknown address is indistinguishable from a
 * registered one.
 */
export async function requestPasswordRecovery(input = {}) {
  return {
    email: normalizeEmail(input.email),
    verificationCode: VERIFICATION_CODE,
  };
}

export function validateResetInput(input = {}) {
  const email = normalizeEmail(input.email);
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  const fields = {};
  if (code !== VERIFICATION_CODE) fields.code = MESSAGES.invalidCode;
  if (!isValidPassword(newPassword)) fields.password = MESSAGES.passwordInvalid;
  else if (newPassword !== confirmPassword) fields.confirmPassword = MESSAGES.passwordMismatch;

  return { fields, email, newPassword };
}

export async function resetPassword(store, input = {}) {
  const { fields, email, newPassword } = validateResetInput(input);
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  let updated = false;
  await store.update((state) => {
    const account = findAccountByEmail(state.accounts, email);
    if (!account) return;
    account.passwordHash = hashPassword(newPassword);
    account.passwordUpdatedAt = new Date().toISOString();
    for (const session of state.sessions) {
      if (session.accountId === account.id && session.active === true) {
        session.active = false;
        session.endedAt = new Date().toISOString();
      }
    }
    updated = true;
  });

  return { ok: true, message: MESSAGES.passwordUpdated, updated };
}

/**
 * Changes the password of the signed-in account. Validation runs in a fixed
 * order and reports the first applicable reason, so an incorrect current
 * password takes precedence over a confirmation mismatch (REQ-1-3). Nothing is
 * written unless every check passes; a successful change also ends the current
 * session so subsequent requests resolve the new login state.
 */
export async function changePassword(store, sessionId, input = {}) {
  const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  const current = await readSession(store, sessionId);
  if (!current) return { ok: false, unauthorized: true };

  const fields = {};
  if (currentPassword.length === 0) {
    fields.currentPassword = MESSAGES.currentPasswordRequired;
  } else if (!verifyPassword(currentPassword, current.account.passwordHash)) {
    fields.currentPassword = MESSAGES.currentPasswordIncorrect;
  } else if (!isValidPassword(newPassword)) {
    fields.newPassword = MESSAGES.passwordInvalid;
  } else if (newPassword !== confirmPassword) {
    fields.confirmPassword = MESSAGES.passwordMismatch;
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  await store.update((state) => {
    const account = state.accounts.find((candidate) => candidate.id === current.account.id);
    if (!account) return;
    account.passwordHash = hashPassword(newPassword);
    account.passwordUpdatedAt = new Date().toISOString();
    const session = state.sessions.find((candidate) => candidate.id === current.session.id);
    if (session && session.active === true) {
      session.active = false;
      session.endedAt = new Date().toISOString();
    }
  });

  return { ok: true, message: MESSAGES.passwordUpdated };
}
