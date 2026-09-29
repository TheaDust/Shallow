import { randomUUID } from "node:crypto";

import { hashPassword, verifyPassword } from "../lib/passwords.mjs";
import {
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  passwordMeetsRequirements,
} from "../lib/validation.mjs";

export const FIXED_RECOVERY_CODE = "123456";

export const SEED_ACCOUNT = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

// Existing account used by the organization seeds as `member bob-reviewer`.
export const SEED_MEMBER_ACCOUNT = {
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  password: "Valid-password-123!",
};

// Registered account that is not yet a member of any seeded organization,
// used by the add-member scenario as the directly added new member.
export const SEED_NONMEMBER_ACCOUNT = {
  username: "carol-dev",
  email: "carol.dev@example.test",
  password: "Valid-password-123!",
};

const ACTIVE = "active";

function findAccountByUsername(state, username) {
  return Object.values(state.accounts).find((account) => account.username === username);
}

function findAccountByEmail(state, email) {
  return Object.values(state.accounts).find(
    (account) => account.email.toLowerCase() === email.toLowerCase(),
  );
}

export function createAccountsDomain(store) {
  async function seedIfEmpty() {
    await store.update(async (state) => {
      if (!state.accounts || Object.keys(state.accounts).length > 0) return;
      const now = new Date().toISOString();
      state.accounts = state.accounts ?? {};
      state.sessions = state.sessions ?? {};
      state.accounts[SEED_ACCOUNT.username] = {
        id: SEED_ACCOUNT.username,
        username: SEED_ACCOUNT.username,
        email: SEED_ACCOUNT.email,
        emailVerified: true,
        password: hashPassword(SEED_ACCOUNT.password),
        status: ACTIVE,
        createdAt: now,
      };
      state.accounts[SEED_MEMBER_ACCOUNT.username] = {
        id: SEED_MEMBER_ACCOUNT.username,
        username: SEED_MEMBER_ACCOUNT.username,
        email: SEED_MEMBER_ACCOUNT.email,
        emailVerified: true,
        password: hashPassword(SEED_MEMBER_ACCOUNT.password),
        status: ACTIVE,
        createdAt: now,
      };
      state.accounts[SEED_NONMEMBER_ACCOUNT.username] = {
        id: SEED_NONMEMBER_ACCOUNT.username,
        username: SEED_NONMEMBER_ACCOUNT.username,
        email: SEED_NONMEMBER_ACCOUNT.email,
        emailVerified: true,
        password: hashPassword(SEED_NONMEMBER_ACCOUNT.password),
        status: ACTIVE,
        createdAt: now,
      };
    });
  }

  async function register(input = {}) {
    const username = typeof input.username === "string" ? input.username : "";
    const email = normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
    const agreeToTerms = input.agreeToTerms === true;

    let result;
    await store.update(async (state) => {
      const errors = {};
      if (!username) errors.username = "Username is required";
      else if (!isValidUsername(username)) errors.username = "Username format is invalid";
      if (!email) errors.email = "Email is required";
      else if (!isValidEmail(email)) errors.email = "Email format is invalid";
      if (!password) errors.password = "Password is required";
      else if (!passwordMeetsRequirements(password)) errors.password = "Password requirements are not satisfied";
      if (!confirmPassword) errors.confirmPassword = "Confirm password is required";
      else if (confirmPassword !== password) errors.confirmPassword = "Passwords do not match";
      if (!agreeToTerms) errors.terms = "Agree to terms is required";

      if (Object.keys(errors).length === 0) {
        if (findAccountByUsername(state, username)) errors.username = "Username already exists";
        if (findAccountByEmail(state, email)) errors.email = "Email already exists";
      }

      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }

      const now = new Date().toISOString();
      state.accounts[username] = {
        id: username,
        username,
        email,
        emailVerified: true,
        password: hashPassword(password),
        status: ACTIVE,
        createdAt: now,
      };
      result = { ok: true, account: { username, email } };
    });
    return result;
  }

  async function signIn(input = {}) {
    const identifier = typeof input.identifier === "string" ? input.identifier.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!identifier || !password) return { ok: false };

    let session = null;
    let accountInfo = null;
    await store.update(async (state) => {
      const account = Object.values(state.accounts).find(
        (candidate) =>
          candidate.username === identifier ||
          candidate.email.toLowerCase() === identifier.toLowerCase(),
      );
      if (!account || account.status !== ACTIVE || !verifyPassword(password, account.password)) {
        return;
      }
      session = {
        id: randomUUID(),
        accountId: account.id,
        status: ACTIVE,
        createdAt: new Date().toISOString(),
      };
      state.sessions[session.id] = session;
      accountInfo = { username: account.username, email: account.email };
    });
    return session && accountInfo ? { ok: true, session, account: accountInfo } : { ok: false };
  }

  async function destroySession(sessionId) {
    if (!sessionId) return;
    await store.update((state) => {
      delete state.sessions[sessionId];
    });
  }

  async function getSessionAccount(sessionId) {
    if (!sessionId) return null;
    const state = await store.read();
    const session = state.sessions[sessionId];
    if (!session || session.status !== ACTIVE) return null;
    const account = state.accounts[session.accountId];
    if (!account || account.status !== ACTIVE) return null;
    return { username: account.username, email: account.email };
  }

  async function changePassword(sessionId, input = {}) {
    const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
    const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
    const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

    let result;
    await store.update(async (state) => {
      const session = state.sessions[sessionId];
      if (!session || session.status !== ACTIVE) {
        result = { ok: false, unauthorized: true };
        return;
      }
      const account = state.accounts[session.accountId];
      if (!account || account.status !== ACTIVE) {
        result = { ok: false, unauthorized: true };
        return;
      }

      const errors = {};
      if (!currentPassword) errors.currentPassword = "Current password is required";
      else if (!verifyPassword(currentPassword, account.password)) {
        errors.currentPassword = "Current password is incorrect";
      }
      if (!newPassword) errors.newPassword = "New password is required";
      else if (!passwordMeetsRequirements(newPassword)) {
        errors.newPassword = "Password requirements are not satisfied";
      }
      if (!confirmPassword) errors.confirmPassword = "Confirm password is required";
      else if (confirmPassword !== newPassword) {
        errors.confirmPassword = "Password confirmation does not match";
      }

      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      account.password = hashPassword(newPassword);
      result = { ok: true };
    });
    return result;
  }

  async function resetPassword(input = {}) {
    const email = normalizeEmail(input.email);
    const code = typeof input.code === "string" ? input.code : "";
    const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
    const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

    let result;
    await store.update(async (state) => {
      const errors = {};
      const account = email ? findAccountByEmail(state, email) : undefined;
      if (!email) errors.email = "Email is required";
      else if (!account) errors.email = "Email is not registered";
      if (code !== FIXED_RECOVERY_CODE) errors.code = "Verification code is invalid";
      if (!newPassword) errors.newPassword = "Password is required";
      else if (!passwordMeetsRequirements(newPassword)) {
        errors.newPassword = "Password requirements are not satisfied";
      }
      if (!confirmPassword) errors.confirmPassword = "Confirm password is required";
      else if (confirmPassword !== newPassword) errors.confirmPassword = "Passwords do not match";

      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      account.password = hashPassword(newPassword);
      result = { ok: true };
    });
    return result;
  }

  return {
    seedIfEmpty,
    register,
    signIn,
    destroySession,
    getSessionAccount,
    changePassword,
    resetPassword,
  };
}
