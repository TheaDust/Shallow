import { randomUUID } from "node:crypto";

import { hashPassword, verifyPassword } from "./passwords.mjs";
import {
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeEmail,
} from "./validation.mjs";

export const FIELD_MESSAGES = {
  usernameExists: "Username already exists",
  usernameFormat: "Username format is invalid",
  emailExists: "Email already exists",
  emailFormat: "Email format is invalid",
  passwordRequirements: "Password requirements are not satisfied",
  passwordMismatch: "Passwords do not match",
  termsRequired: "Agree to terms is required",
  invalidCredentials: "Invalid credentials",
  verificationCodeInvalid: "Verification code is invalid",
  accountNotFound: "Account not found",
  passwordUpdated: "Password updated",
  currentPasswordRequired: "Current password is required",
  currentPasswordIncorrect: "Current password is incorrect",
  passwordConfirmationMismatch: "Password confirmation does not match",
  notAuthenticated: "Not authenticated",
};

// The local product never sends email; recovery always shows this fixed code.
export const VERIFICATION_CODE = "123456";

let clock = () => new Date().toISOString();

export function toPublicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    emailVerified: account.emailVerified,
  };
}

export function createAuthService(store) {
  async function register(input) {
    const source = input ?? {};
    const username = typeof source.username === "string" ? source.username : "";
    const email = normalizeEmail(source.email);
    const password = typeof source.password === "string" ? source.password : "";
    const confirmPassword =
      typeof source.confirmPassword === "string" ? source.confirmPassword : "";
    const agreeToTerms = source.agreeToTerms === true;

    const fieldErrors = {};
    if (!isValidUsername(username)) fieldErrors.username = FIELD_MESSAGES.usernameFormat;
    if (!isValidEmail(email)) fieldErrors.email = FIELD_MESSAGES.emailFormat;
    if (!isValidPassword(password)) {
      fieldErrors.password = FIELD_MESSAGES.passwordRequirements;
    } else if (password !== confirmPassword) {
      fieldErrors.confirmPassword = FIELD_MESSAGES.passwordMismatch;
    }
    if (!agreeToTerms) fieldErrors.agreeToTerms = FIELD_MESSAGES.termsRequired;
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const conflicts = {};
      if (state.accounts.some((account) => account.username === username)) {
        conflicts.username = FIELD_MESSAGES.usernameExists;
      }
      if (state.accounts.some((account) => account.email === email)) {
        conflicts.email = FIELD_MESSAGES.emailExists;
      }
      if (Object.keys(conflicts).length > 0) {
        outcome = { ok: false, fieldErrors: conflicts };
        return;
      }
      const account = {
        id: `account-${randomUUID()}`,
        username,
        email,
        // This product marks the email verified immediately after registration.
        emailVerified: true,
        status: "active",
        passwordHash: hashPassword(password),
        createdAt: clock(),
      };
      state.accounts.push(account);
      outcome = { ok: true, account: toPublicAccount(account) };
    });
    return outcome;
  }

  async function signIn(input) {
    const source = input ?? {};
    const identifier = typeof source.identifier === "string" ? source.identifier.trim() : "";
    const password = typeof source.password === "string" ? source.password : "";

    let outcome = { ok: false };
    await store.update((state) => {
      const account = state.accounts.find(
        (candidate) => candidate.username === identifier || candidate.email === identifier,
      );
      if (
        !account ||
        account.status !== "active" ||
        !verifyPassword(password, account.passwordHash)
      ) {
        outcome = { ok: false };
        return;
      }
      const session = {
        id: `session-${randomUUID()}`,
        accountId: account.id,
        active: true,
        createdAt: clock(),
      };
      state.sessions.push(session);
      outcome = { ok: true, session, account: toPublicAccount(account) };
    });
    return outcome;
  }

  async function sessionAccount(sessionId) {
    if (!sessionId) return null;
    const state = await store.read();
    const session = state.sessions.find(
      (candidate) => candidate.id === sessionId && candidate.active,
    );
    if (!session) return null;
    const account = state.accounts.find((candidate) => candidate.id === session.accountId);
    if (!account || account.status !== "active") return null;
    return toPublicAccount(account);
  }

  async function signOut(sessionId) {
    if (!sessionId) return;
    await store.update((state) => {
      const session = state.sessions.find((candidate) => candidate.id === sessionId);
      if (session) session.active = false;
    });
  }

  async function resetPassword(input) {
    const source = input ?? {};
    const email = normalizeEmail(source.email);
    const code = typeof source.code === "string" ? source.code.trim() : "";
    const newPassword = typeof source.newPassword === "string" ? source.newPassword : "";
    const confirmPassword =
      typeof source.confirmPassword === "string" ? source.confirmPassword : "";

    const fieldErrors = {};
    if (!isValidEmail(email)) fieldErrors.email = FIELD_MESSAGES.emailFormat;
    if (code !== VERIFICATION_CODE) {
      fieldErrors.code = FIELD_MESSAGES.verificationCodeInvalid;
    }
    if (!isValidPassword(newPassword)) {
      fieldErrors.newPassword = FIELD_MESSAGES.passwordRequirements;
    } else if (newPassword !== confirmPassword) {
      fieldErrors.confirmPassword = FIELD_MESSAGES.passwordMismatch;
    }
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

    let outcome = { ok: false, fieldErrors: { email: FIELD_MESSAGES.accountNotFound } };
    await store.update((state) => {
      const account = state.accounts.find((candidate) => candidate.email === email);
      if (!account) {
        outcome = { ok: false, fieldErrors: { email: FIELD_MESSAGES.accountNotFound } };
        return;
      }
      account.passwordHash = hashPassword(newPassword);
      // Recovery invalidates every browser session that still refers to the account.
      for (const session of state.sessions) {
        if (session.accountId === account.id) session.active = false;
      }
      outcome = { ok: true };
    });
    return outcome;
  }

  /**
   * Changes the password of the signed-in account only. An unauthenticated
   * request never touches stored credentials.
   */
  async function changePassword(sessionId, input) {
    const source = input ?? {};
    const currentPassword =
      typeof source.currentPassword === "string" ? source.currentPassword : "";
    const newPassword = typeof source.newPassword === "string" ? source.newPassword : "";
    const confirmPassword =
      typeof source.confirmPassword === "string" ? source.confirmPassword : "";

    let outcome = { ok: false, unauthorized: true };
    await store.update((state) => {
      const session = state.sessions.find(
        (candidate) => candidate.id === sessionId && candidate.active,
      );
      const account =
        session &&
        state.accounts.find(
          (candidate) => candidate.id === session.accountId && candidate.status === "active",
        );
      if (!account) {
        outcome = { ok: false, unauthorized: true };
        return;
      }

      const fieldErrors = {};
      if (currentPassword.length === 0) {
        fieldErrors.currentPassword = FIELD_MESSAGES.currentPasswordRequired;
      } else if (!verifyPassword(currentPassword, account.passwordHash)) {
        fieldErrors.currentPassword = FIELD_MESSAGES.currentPasswordIncorrect;
      }
      if (!isValidPassword(newPassword)) {
        fieldErrors.newPassword = FIELD_MESSAGES.passwordRequirements;
      } else if (newPassword !== confirmPassword) {
        fieldErrors.confirmPassword = FIELD_MESSAGES.passwordConfirmationMismatch;
      }
      if (Object.keys(fieldErrors).length > 0) {
        outcome = { ok: false, fieldErrors };
        return;
      }

      account.passwordHash = hashPassword(newPassword);
      outcome = { ok: true };
    });
    return outcome;
  }

  return { register, signIn, sessionAccount, signOut, resetPassword, changePassword };
}
