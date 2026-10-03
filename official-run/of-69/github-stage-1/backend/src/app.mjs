import { randomUUID } from "node:crypto";

import { readJsonSafe, sendJson } from "./lib/http.mjs";
import { MESSAGES, normalizeEmail, validateEmail, validatePassword, validateUsername } from "./lib/validation.mjs";
import { hashPassword, verifyPassword } from "./lib/passwords.mjs";
import { RECOVERY_VERIFICATION_CODE } from "./lib/recovery.mjs";
import { serveStatic } from "./lib/static.mjs";
import { createDatabase } from "./lib/database.mjs";
import { createOrganizationApi } from "./routes/organizations.mjs";
import {
  clearedSessionCookie,
  createSession,
  findCurrentAccount,
  invalidateCurrentSession,
  publicAccount,
  sessionCookie,
} from "./lib/sessions.mjs";

/**
 * Builds the single same-origin request handler used by every listening port.
 * API routes live under /api and the built SPA is served for everything else.
 */
export async function createRequestHandler({ dataDir, staticRoot }) {
  const database = createDatabase(dataDir);
  const organizationApi = createOrganizationApi(database);

  async function handleRegister(request, response) {
    const body = await readJsonSafe(request);
    const username = typeof body.username === "string" ? body.username : "";
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    const agreeToTerms = body.agreeToTerms === true;

    const errors = {};
    if (!validateUsername(username)) errors.username = MESSAGES.usernameInvalid;
    if (!validateEmail(email)) errors.email = MESSAGES.emailInvalid;
    if (!validatePassword(password)) errors.password = MESSAGES.passwordInvalid;
    if (password !== confirmPassword) errors.confirmPassword = MESSAGES.confirmMismatch;
    if (!agreeToTerms) errors.terms = MESSAGES.termsRequired;

    let created = null;
    await database.accounts.update((state) => {
      if (!errors.username && state.accounts.some((account) => account.username === username)) {
        errors.username = MESSAGES.usernameExists;
      }
      if (!errors.email && state.accounts.some((account) => normalizeEmail(account.email).toLowerCase() === email.toLowerCase())) {
        errors.email = MESSAGES.emailExists;
      }
      if (Object.keys(errors).length > 0) return state;
      created = {
        id: `account-${randomUUID()}`,
        username,
        email,
        emailVerified: true,
        status: "available",
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      state.accounts.push(created);
      return state;
    });

    if (!created) {
      sendJson(response, 422, { errors });
      return;
    }
    sendJson(response, 201, { account: publicAccount(created) });
  }

  async function handleSignIn(request, response) {
    const body = await readJsonSafe(request);
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const { accounts } = await database.accounts.read();
    const account = accounts.find(
      (candidate) =>
        candidate.username === identifier ||
        normalizeEmail(candidate.email).toLowerCase() === identifier.toLowerCase(),
    );
    if (!account || account.status !== "available" || !verifyPassword(password, account.password)) {
      sendJson(response, 401, { error: "Invalid credentials" });
      return;
    }
    const session = await createSession(database, account.id);
    response.setHeader("set-cookie", sessionCookie(session.id));
    sendJson(response, 200, { account: publicAccount(account) });
  }

  async function handleSignOut(request, response) {
    await invalidateCurrentSession(database, request);
    response.setHeader("set-cookie", clearedSessionCookie());
    response.writeHead(204);
    response.end();
  }

  async function handleRecoveryStart(request, response) {
    await readJsonSafe(request);
    sendJson(response, 200, { code: RECOVERY_VERIFICATION_CODE });
  }

  async function handleRecoveryReset(request, response) {
    const body = await readJsonSafe(request);
    const email = normalizeEmail(body.email);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (code !== RECOVERY_VERIFICATION_CODE) {
      sendJson(response, 400, { error: "Verification code is invalid" });
      return;
    }
    if (!validatePassword(newPassword)) {
      sendJson(response, 400, { error: MESSAGES.passwordInvalid });
      return;
    }
    if (newPassword !== confirmPassword) {
      sendJson(response, 400, { error: MESSAGES.confirmMismatch });
      return;
    }
    await database.accounts.update((state) => {
      const account = state.accounts.find(
        (candidate) => normalizeEmail(candidate.email).toLowerCase() === email.toLowerCase(),
      );
      if (account) account.password = hashPassword(newPassword);
      return state;
    });
    sendJson(response, 200, { message: "Password updated" });
  }

  async function handleChangePassword(request, response) {
    const account = await findCurrentAccount(database, request);
    if (!account) {
      // Unauthenticated or signed-out callers cannot change any password.
      sendJson(response, 401, { error: "Sign in required" });
      return;
    }

    const body = await readJsonSafe(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    // Every reason is reported in its own field, so a wrong current password and
    // a mismatched confirmation are both visible instead of hiding each other.
    const errors = {};
    if (currentPassword.length === 0) errors.currentPassword = MESSAGES.currentPasswordRequired;
    else if (!verifyPassword(currentPassword, account.password)) errors.currentPassword = MESSAGES.currentPasswordIncorrect;
    if (!validatePassword(newPassword)) errors.newPassword = MESSAGES.passwordInvalid;
    if (confirmPassword !== newPassword) errors.confirmPassword = MESSAGES.passwordConfirmationMismatch;

    if (Object.keys(errors).length > 0) {
      sendJson(response, 422, { errors });
      return;
    }

    // Only the signed-in account's password record changes; a rejected change
    // leaves every account untouched.
    await database.accounts.update((state) => {
      const target = state.accounts.find((candidate) => candidate.id === account.id);
      if (target) target.password = hashPassword(newPassword);
      return state;
    });
    sendJson(response, 200, { message: MESSAGES.passwordUpdated });
  }

  async function handleApi(request, response, pathname) {
    if (request.method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (!pathname.startsWith("/api/")) return false;

    if (request.method === "GET" && pathname === "/api/session") {
      const account = await findCurrentAccount(database, request);
      sendJson(response, 200, { account: publicAccount(account) });
      return true;
    }
    if (request.method === "POST" && pathname === "/api/register") {
      await handleRegister(request, response);
      return true;
    }
    if (request.method === "POST" && pathname === "/api/signin") {
      await handleSignIn(request, response);
      return true;
    }
    if (request.method === "POST" && pathname === "/api/signout") {
      await handleSignOut(request, response);
      return true;
    }
    if (request.method === "POST" && pathname === "/api/recovery/start") {
      await handleRecoveryStart(request, response);
      return true;
    }
    if (request.method === "POST" && pathname === "/api/recovery/reset") {
      await handleRecoveryReset(request, response);
      return true;
    }
    if (request.method === "POST" && pathname === "/api/account/password") {
      await handleChangePassword(request, response);
      return true;
    }
    // Organization, team and membership routes own /api/organizations/*.
    if (await organizationApi(request, response, pathname)) return true;
    return false;
  }

  return async function handle(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (await handleApi(request, response, url.pathname)) return;
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      await serveStatic(request, response, staticRoot);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        response.end();
      }
    }
  };
}
