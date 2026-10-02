import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  authenticate,
  changePassword,
  createSession,
  deleteSession,
  findSessionAccount,
  registerAccount,
  resetPassword,
  toPublicAccount,
} from "../domain/identity.mjs";
import { MESSAGES, VERIFICATION_CODE, hasErrors, isValidEmail, normalizeEmail } from "../domain/validation.mjs";
import { readJson, sendJson, serializeCookie } from "../lib/http.mjs";
import { readSessionId } from "../lib/session.mjs";

const INVALID_CREDENTIALS = "Invalid credentials";

function sessionCookie(sessionId) {
  return [serializeCookie(SESSION_COOKIE, sessionId, { maxAge: SESSION_MAX_AGE_SECONDS })];
}

function clearedSessionCookie() {
  return [serializeCookie(SESSION_COOKIE, "", { maxAge: 0 })];
}

async function readBody(request, response) {
  try {
    return await readJson(request);
  } catch {
    sendJson(response, 400, { error: "Invalid request body" });
    return null;
  }
}

/**
 * Auth API. Every handler re-reads the authoritative account state, so a
 * password change or sign-out is visible to subsequent requests immediately.
 */
export function createAuthRouter({ store }) {
  const routes = {
    "POST /api/auth/register": async (request, response) => {
      const body = await readBody(request, response);
      if (body === null) return;
      const result = await store.mutate((state) => registerAccount(state, body));
      if (result.errors) {
        sendJson(response, 400, { errors: result.errors });
        return;
      }
      sendJson(response, 201, { account: toPublicAccount(result.account) });
    },

    "POST /api/auth/signin": async (request, response) => {
      const body = await readBody(request, response);
      if (body === null) return;
      const identifier = typeof body.identifier === "string" ? body.identifier : "";
      const password = typeof body.password === "string" ? body.password : "";
      const result = await store.mutate((state) => {
        const account = authenticate(state, identifier, password);
        if (!account) return null;
        return { account, session: createSession(state, account.id) };
      });
      if (!result) {
        sendJson(response, 401, { error: INVALID_CREDENTIALS });
        return;
      }
      sendJson(
        response,
        200,
        { account: toPublicAccount(result.account) },
        { "set-cookie": sessionCookie(result.session.id) },
      );
    },

    "GET /api/auth/session": async (request, response) => {
      const sessionId = readSessionId(request);
      const state = await store.read();
      sendJson(response, 200, { account: toPublicAccount(findSessionAccount(state, sessionId)) });
    },

    "POST /api/auth/signout": async (request, response) => {
      const sessionId = readSessionId(request);
      await store.mutate((state) => deleteSession(state, sessionId));
      sendJson(response, 200, { ok: true }, { "set-cookie": clearedSessionCookie() });
    },

    // The target account always comes from the session; a request without a
    // session cannot change any password record.
    "POST /api/auth/password": async (request, response) => {
      const body = await readBody(request, response);
      if (body === null) return;
      const sessionId = readSessionId(request);
      const result = await store.mutate((state) => {
        const account = findSessionAccount(state, sessionId);
        if (!account) return { authenticated: false };
        const outcome = changePassword(state, account.id, body);
        return { authenticated: true, errors: outcome.errors ?? null };
      });
      if (!result.authenticated) {
        sendJson(response, 401, { error: "Sign in required" });
        return;
      }
      if (result.errors) {
        sendJson(response, 400, { errors: result.errors });
        return;
      }
      sendJson(response, 200, { message: MESSAGES.passwordUpdated });
    },

    "POST /api/auth/password-reset/request": async (request, response) => {
      const body = await readBody(request, response);
      if (body === null) return;
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) {
        sendJson(response, 400, { errors: { email: MESSAGES.emailFormat } });
        return;
      }
      // The product has no mail delivery: the fixed code is returned directly
      // and the same response is produced for registered and unknown emails.
      sendJson(response, 200, { code: VERIFICATION_CODE });
    },

    "POST /api/auth/password-reset/confirm": async (request, response) => {
      const body = await readBody(request, response);
      if (body === null) return;
      const result = await store.mutate((state) => resetPassword(state, body));
      if (hasErrors(result.errors ?? {})) {
        sendJson(response, 400, { errors: result.errors });
        return;
      }
      sendJson(response, 200, { message: MESSAGES.passwordUpdated });
    },
  };

  return {
    async handle(request, response, url) {
      const key = `${request.method} ${url.pathname}`;
      const route = routes[key];
      if (!route) return false;
      await route(request, response);
      return true;
    },
  };
}
