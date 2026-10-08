import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  FIXED_VERIFICATION_CODE,
  MESSAGES,
  normalizeText,
  validatePasswordReset,
  validateRegistration,
} from "./lib/auth-rules.mjs";
import { readJson, sendJson } from "./lib/http.mjs";
import { describeDevice } from "./lib/auth-store.mjs";
import { createOrgApi } from "./lib/org-routes.mjs";
import { createOrgStore } from "./lib/org-store.mjs";

export const SESSION_COOKIE = "shallow_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(sessionId) {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function readBody(request) {
  return readJson(request).catch(() => ({}));
}

export function createRequestHandler({ store, staticRoot, orgStore }) {
  const organizations = orgStore ?? createOrgStore(store.dataDir ?? process.env.SHALLOW_DATA_DIR ?? ".data");

  async function currentUser(request) {
    const cookies = parseCookies(request.headers.cookie);
    return store.getSessionAccount(cookies[SESSION_COOKIE]);
  }

  const orgApi = createOrgApi({ store, orgStore: organizations, currentUser });

  async function handleApi(request, response, url) {
    const method = request.method ?? "GET";
    const { pathname } = url;

    if (method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (!pathname.startsWith("/api/")) return false;

    if (method === "GET" && pathname === "/api/session") {
      const cookies = parseCookies(request.headers.cookie);
      const user = await store.getSessionAccount(cookies[SESSION_COOKIE]);
      sendJson(response, 200, { user });
      return true;
    }

    if (method === "POST" && pathname === "/api/auth/register") {
      const body = await readBody(request);
      const username = typeof body.username === "string" ? body.username : "";
      const email = normalizeText(body.email);
      const conflicts = await store.conflictFor({ username, email });
      const result = validateRegistration(body, {
        usernameExists: () => conflicts.usernameExists,
        emailExists: () => conflicts.emailExists,
      });
      if (!result.valid) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors: result.fieldErrors });
        return true;
      }
      const account = await store.register({
        username: result.username,
        email: result.email,
        password: result.password,
      });
      if (!account) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { username: MESSAGES.usernameExists },
        });
        return true;
      }
      sendJson(response, 201, { user: account });
      return true;
    }

    if (method === "POST" && pathname === "/api/auth/sign-in") {
      const body = await readBody(request);
      const identifier = typeof body.identifier === "string" ? body.identifier : "";
      const password = typeof body.password === "string" ? body.password : "";
      const account = await store.authenticate(identifier, password);
      if (!account) {
        sendJson(response, 401, { message: MESSAGES.invalidCredentials });
        return true;
      }
      const sessionId = await store.createSession(account.id, describeDevice(request.headers["user-agent"]));
      response.setHeader("set-cookie", sessionCookie(sessionId));
      sendJson(response, 200, { user: account });
      return true;
    }

    if (method === "POST" && pathname === "/api/auth/sign-out") {
      const cookies = parseCookies(request.headers.cookie);
      await store.invalidateSession(cookies[SESSION_COOKIE]);
      response.setHeader("set-cookie", CLEAR_SESSION_COOKIE);
      sendJson(response, 200, { ok: true });
      return true;
    }

    // Active browser sessions of the signed-in account. The list never contains
    // a session secret; the current row is flagged so the UI hides its revoke
    // control.
    if (method === "GET" && pathname === "/api/account/sessions") {
      const cookies = parseCookies(request.headers.cookie);
      const user = await store.getSessionAccount(cookies[SESSION_COOKIE]);
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const sessions = await store.listSessions(user.id, cookies[SESSION_COOKIE]);
      sendJson(response, 200, { sessions });
      return true;
    }

    // Revoking another browser session of the same account. The session cookie
    // is the only trusted source of the acting account and the current session.
    if (method === "POST" && pathname.startsWith("/api/account/sessions/") && pathname.endsWith("/revoke")) {
      const cookies = parseCookies(request.headers.cookie);
      const user = await store.getSessionAccount(cookies[SESSION_COOKIE]);
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      let target = pathname.slice("/api/account/sessions/".length, -"revoke".length);
      target = target.endsWith("/") ? target.slice(0, -1) : target;
      let sessionId = "";
      try {
        sessionId = decodeURIComponent(target);
      } catch {
        sessionId = "";
      }
      const outcome = await store.revokeSession(user.id, sessionId, cookies[SESSION_COOKIE]);
      if (outcome === "not-found") {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (outcome === "current") {
        sendJson(response, 400, { message: "The current session cannot be revoked" });
        return true;
      }
      const sessions = await store.listSessions(user.id, cookies[SESSION_COOKIE]);
      sendJson(response, 200, { ok: true, sessions });
      return true;
    }

    // Changing the password of the signed-in account: the session cookie is the
    // only trusted source of the account identity, and the current password is
    // re-verified against the stored hash by the store.
    if (method === "POST" && pathname === "/api/account/password") {
      const cookies = parseCookies(request.headers.cookie);
      const user = await store.getSessionAccount(cookies[SESSION_COOKIE]);
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const body = await readBody(request);
      const result = await store.changePassword(user.id, {
        currentPassword: typeof body.currentPassword === "string" ? body.currentPassword : "",
        newPassword: typeof body.newPassword === "string" ? body.newPassword : "",
        confirmPassword: typeof body.confirmPassword === "string" ? body.confirmPassword : "",
      });
      if (result.unauthenticated) {
        response.setHeader("set-cookie", CLEAR_SESSION_COOKIE);
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors: result.fieldErrors });
        return true;
      }
      sendJson(response, 200, { message: result.message });
      return true;
    }

    // Both registered and unknown addresses reach the same step: the fixed
    // verification code is always returned without email delivery.
    if (method === "POST" && pathname === "/api/auth/password-reset/request") {
      await readBody(request);
      sendJson(response, 200, { ok: true, code: FIXED_VERIFICATION_CODE });
      return true;
    }

    if (method === "POST" && pathname === "/api/auth/password-reset") {
      const body = await readBody(request);
      const result = validatePasswordReset(body);
      if (!result.valid) {
        sendJson(response, 400, {
          message: result.fieldErrors.code ?? "Validation failed",
          fieldErrors: result.fieldErrors,
        });
        return true;
      }
      await store.resetPassword(result.email, result.newPassword);
      sendJson(response, 200, { message: MESSAGES.passwordUpdated });
      return true;
    }

    if (await orgApi(request, response, url, method)) return true;

    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  async function serveStatic(request, response, url) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    let relative;
    try {
      relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    } catch {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!relative || relative.includes("..")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    try {
      const content = await readFile(join(staticRoot, relative));
      response.writeHead(200, {
        "content-type": contentTypes.get(extname(relative)) ?? "application/octet-stream",
      });
      response.end(content);
    } catch (error) {
      if (error?.code === "ENOENT") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      throw error;
    }
  }

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (await handleApi(request, response, url)) return;
      await serveStatic(request, response, url);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
