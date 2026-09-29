import { randomUUID } from "node:crypto";

import {
  EMAIL_MESSAGES,
  PASSWORD_CONFIRMATION_MESSAGE,
  TERMS_MESSAGE,
  USERNAME_MESSAGES,
  findAccountByIdentifier,
  hashPassword,
  normalizeEmail,
  publicAccount,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "../domain/accounts.mjs";
import { getCurrentAccount } from "../lib/auth-context.mjs";
import { sendJson } from "../lib/http.mjs";
import {
  attachSessionCookie,
  clearSessionCookie,
  createSession,
  invalidateSession,
  readSessionId,
} from "../lib/session.mjs";
import { handlePasswordChange, handlePasswordReset } from "./password.mjs";

const GENERIC_CREDENTIALS_ERROR = "Invalid credentials";

export function validateRegistrationInput(input) {
  const errors = {};
  const usernameError = validateUsername(input.username);
  if (usernameError) errors.username = usernameError;
  const emailError = validateEmail(input.email);
  if (emailError) errors.email = emailError;
  const passwordError = validatePassword(input.password);
  if (passwordError) errors.password = passwordError;
  if (!passwordError && input.confirmPassword !== input.password) {
    errors.confirmPassword = PASSWORD_CONFIRMATION_MESSAGE;
  }
  if (input.agreeToTerms !== true) errors.terms = TERMS_MESSAGE;
  return errors;
}

function readString(value) {
  return typeof value === "string" ? value : "";
}

async function handleRegister({ request, response, stores, body }) {
  const input = {
    username: readString(body.username),
    email: readString(body.email),
    password: readString(body.password),
    confirmPassword: readString(body.confirmPassword),
    agreeToTerms: body.agreeToTerms === true,
  };

  const errors = validateRegistrationInput(input);
  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Registration failed", errors });
    return;
  }

  const email = normalizeEmail(input.email);
  let outcome = null;
  await stores.accounts.update((state) => {
    const conflicts = {};
    if (state.accounts.some((account) => account.username === input.username)) {
      conflicts.username = USERNAME_MESSAGES.taken;
    }
    if (state.accounts.some((account) => account.email === email)) {
      conflicts.email = EMAIL_MESSAGES.taken;
    }
    if (Object.keys(conflicts).length > 0) {
      outcome = { ok: false, errors: conflicts };
      return;
    }
    const account = {
      id: `acc-${randomUUID()}`,
      username: input.username,
      email,
      // The local product has no email delivery: a registered email is verified immediately.
      emailVerified: true,
      status: "active",
      passwordHash: hashPassword(input.password),
      createdAt: new Date().toISOString(),
    };
    state.accounts.push(account);
    outcome = { ok: true, account };
  });

  if (!outcome.ok) {
    sendJson(response, 400, { error: "Registration failed", errors: outcome.errors });
    return;
  }
  sendJson(response, 201, { account: publicAccount(outcome.account) });
}

async function handleSignIn({ request, response, stores, body }) {
  const identifier = readString(body.identifier ?? body.username ?? body.email);
  const password = readString(body.password);
  const { accounts } = await stores.accounts.read();
  const account = findAccountByIdentifier(accounts, identifier);
  const available = account?.status === undefined || account.status === "active";
  if (!account || !available || !verifyPassword(password, account.passwordHash)) {
    sendJson(response, 401, { error: GENERIC_CREDENTIALS_ERROR });
    return;
  }
  const session = await createSession(stores.sessions, account.id);
  attachSessionCookie(response, session.id);
  sendJson(response, 200, {
    account: publicAccount(account),
    session: { id: session.id, active: session.active },
  });
}

async function handleSession({ request, response, stores }) {
  const current = await getCurrentAccount(stores, request);
  if (!current) {
    sendJson(response, 200, { account: null, session: null });
    return;
  }
  sendJson(response, 200, {
    account: publicAccount(current.account),
    session: { id: current.session.id, active: current.session.active === true },
  });
}

async function handleSignOut({ request, response, stores }) {
  await invalidateSession(stores.sessions, readSessionId(request));
  clearSessionCookie(response);
  sendJson(response, 200, { ok: true });
}

/**
 * Handles /api/auth/*. Returns true when the request has been answered.
 */
export async function handleAuthRoutes({ request, response, url, stores, body }) {
  const { pathname } = url;
  const method = request.method ?? "GET";
  if (pathname === "/api/auth/session") {
    if (method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    await handleSession({ request, response, stores });
    return true;
  }
  if (pathname === "/api/auth/register" && method === "POST") {
    await handleRegister({ request, response, stores, body });
    return true;
  }
  if (pathname === "/api/auth/sign-in" && method === "POST") {
    await handleSignIn({ request, response, stores, body });
    return true;
  }
  if (pathname === "/api/auth/sign-out" && method === "POST") {
    await handleSignOut({ request, response, stores });
    return true;
  }
  // REQ-1-3: change the password of the signed-in account.
  if (pathname === "/api/auth/password" && method === "POST") {
    await handlePasswordChange({ request, response, stores, body });
    return true;
  }
  // REQ-1-1-3: recover access with the fixed local verification code.
  if (pathname === "/api/auth/password-reset" && method === "POST") {
    await handlePasswordReset({ response, stores, body });
    return true;
  }
  return false;
}
