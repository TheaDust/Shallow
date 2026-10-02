import { randomUUID } from "node:crypto";

import { hashPassword, verifyPassword } from "./passwords.mjs";
import { isValidEmail, isValidPassword, isValidUsername, normalizeEmail } from "./validation.mjs";

export const FIELD_MESSAGES = {
  usernameFormat: "Username format is invalid",
  usernameExists: "Username already exists",
  emailFormat: "Email format is invalid",
  emailExists: "Email already exists",
  password: "Password requirements are not satisfied",
  confirmation: "Passwords do not match",
  terms: "Agree to terms is required",
  verificationCode: "Verification code is invalid",
  recoveryConfirmation: "Password confirmation does not match",
  emailUnknown: "Email is not registered",
  invalidCredentials: "Invalid credentials",
  currentPasswordRequired: "Current password is required",
  currentPasswordIncorrect: "Current password is incorrect",
  changeConfirmation: "Password confirmation does not match",
};

export const FIXED_VERIFICATION_CODE = "123456";

export function publicAccount(account, organizations = []) {
  return {
    username: account.username,
    email: account.email,
    organizations,
  };
}

function findAccountByUsername(accounts, username) {
  return accounts.find((account) => account.username === username);
}

function findAccountByEmail(accounts, email) {
  const normalized = normalizeEmail(email).toLowerCase();
  return accounts.find((account) => normalizeEmail(account.email).toLowerCase() === normalized);
}

/** Pure field validation for registration; every violated rule is reported at once. */
export function validateRegistrationFields(input, existingAccounts = []) {
  const errors = {};
  if (!isValidUsername(input.username)) {
    errors.username = FIELD_MESSAGES.usernameFormat;
  } else if (findAccountByUsername(existingAccounts, input.username)) {
    errors.username = FIELD_MESSAGES.usernameExists;
  }
  if (!isValidEmail(input.email)) {
    errors.email = FIELD_MESSAGES.emailFormat;
  } else if (findAccountByEmail(existingAccounts, input.email)) {
    errors.email = FIELD_MESSAGES.emailExists;
  }
  if (!isValidPassword(input.password)) {
    errors.password = FIELD_MESSAGES.password;
  }
  if (typeof input.confirmPassword !== "string" || input.confirmPassword !== input.password) {
    errors.confirmPassword = FIELD_MESSAGES.confirmation;
  }
  if (input.agreeToTerms !== true) {
    errors.terms = FIELD_MESSAGES.terms;
  }
  return errors;
}

/**
 * Creates a sign-in-capable account whose email is directly marked verified.
 * Conflicting username/email are re-checked inside the atomic update so that
 * two concurrent registrations cannot both succeed.
 */
export async function registerAccount(store, input) {
  const preliminary = validateRegistrationFields(input);
  if (Object.keys(preliminary).length > 0) return { ok: false, errors: preliminary };

  let outcome = null;
  await store.update((draft) => {
    const conflicts = validateRegistrationFields(input, draft.accounts);
    if (Object.keys(conflicts).length > 0) {
      outcome = { ok: false, errors: conflicts };
      return undefined;
    }
    const account = {
      id: randomUUID(),
      username: input.username,
      email: normalizeEmail(input.email),
      emailVerified: true,
      status: "available",
      passwordHash: hashPassword(input.password),
      createdAt: new Date().toISOString(),
    };
    draft.accounts.push(account);
    outcome = { ok: true, account };
    return draft;
  });
  return outcome;
}

/** Returns the account only when the identifier, password and status all match. */
export async function authenticateAccount(store, identifier, password) {
  const data = await store.read();
  if (typeof identifier !== "string" || !identifier || typeof password !== "string" || !password) return null;
  const trimmed = identifier.trim();
  const account = findAccountByUsername(data.accounts, trimmed)
    ?? findAccountByEmail(data.accounts, trimmed);
  if (!account) return null;
  if (account.status !== "available") return null;
  if (!verifyPassword(password, account.passwordHash)) return null;
  return account;
}

export async function startSession(store, accountId) {
  let session = null;
  await store.update((draft) => {
    session = {
      id: randomUUID(),
      accountId,
      active: true,
      createdAt: new Date().toISOString(),
    };
    draft.sessions.push(session);
    return draft;
  });
  return session;
}

export async function resolveSessionAccount(store, sessionId) {
  const context = await resolveSessionContext(store, sessionId);
  return context ? context.account : null;
}

/**
 * Resolves the session cookie to both the signed-in account and the persisted
 * document, so a caller can derive relationships (memberships, permissions)
 * from the same read that authenticated the request.
 */
export async function resolveSessionContext(store, sessionId) {
  if (!sessionId) return null;
  const data = await store.read();
  const session = data.sessions.find((candidate) => candidate.id === sessionId && candidate.active);
  if (!session) return null;
  const account = data.accounts.find((candidate) => candidate.id === session.accountId);
  if (!account) return null;
  return { account, data };
}

export async function endSession(store, sessionId) {
  if (!sessionId) return false;
  await store.update((draft) => {
    const session = draft.sessions.find((candidate) => candidate.id === sessionId);
    if (session) session.active = false;
    return draft;
  });
  return true;
}

/**
 * Security-settings password change (REQ-1-3). The current password is
 * re-verified inside the atomic update, so a concurrent change cannot be
 * bypassed; every other account and resource is left untouched.
 */
export async function changeAccountPassword(store, accountId, input) {
  const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  const errors = {};
  if (!currentPassword) errors.currentPassword = FIELD_MESSAGES.currentPasswordRequired;
  if (!isValidPassword(newPassword)) errors.newPassword = FIELD_MESSAGES.password;
  if (!confirmPassword || confirmPassword !== newPassword) {
    errors.confirmPassword = FIELD_MESSAGES.changeConfirmation;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  let outcome = null;
  await store.update((draft) => {
    const account = draft.accounts.find(
      (candidate) => candidate.id === accountId && candidate.status === "available",
    );
    if (!account || !verifyPassword(currentPassword, account.passwordHash)) {
      outcome = { ok: false, errors: { currentPassword: FIELD_MESSAGES.currentPasswordIncorrect } };
      return undefined;
    }
    account.passwordHash = hashPassword(newPassword);
    outcome = { ok: true };
    return draft;
  });
  return outcome;
}

/**
 * Recovery completion: the recovery email must belong to a registered account,
 * the code must equal the fixed local code, and the new password must be
 * compliant and identical to its confirmation. Nothing is written otherwise.
 * Sessions opened with the replaced credentials are ended immediately.
 */
export async function resetAccountPassword(store, input) {
  const errors = {};
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) errors.email = FIELD_MESSAGES.emailFormat;
  if (input.code !== FIXED_VERIFICATION_CODE) errors.code = FIELD_MESSAGES.verificationCode;
  if (!isValidPassword(input.password)) errors.password = FIELD_MESSAGES.password;
  if (typeof input.confirmPassword !== "string" || input.confirmPassword !== input.password) {
    errors.confirmPassword = FIELD_MESSAGES.recoveryConfirmation;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  let outcome = null;
  await store.update((draft) => {
    const account = findAccountByEmail(draft.accounts, email);
    if (!account) {
      outcome = { ok: false, errors: { email: FIELD_MESSAGES.emailUnknown } };
      return undefined;
    }
    account.passwordHash = hashPassword(input.password);
    for (const session of draft.sessions) {
      if (session.accountId === account.id) session.active = false;
    }
    outcome = { ok: true, account };
    return draft;
  });
  return outcome;
}
