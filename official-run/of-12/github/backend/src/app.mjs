import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  authenticateAccount,
  changeAccountPassword,
  endSession,
  FIXED_VERIFICATION_CODE,
  FIELD_MESSAGES,
  publicAccount,
  registerAccount,
  resetAccountPassword,
  resolveSessionAccount,
  resolveSessionContext,
  startSession,
} from "./domain/auth-service.mjs";
import { organizationsForAccount } from "./domain/organizations.mjs";
import { createDiscoveryApi } from "./api/discovery-routes.mjs";
import { createOrganizationApi } from "./api/organization-routes.mjs";
import { createRepositoryApi } from "./api/repository-routes.mjs";
import { asString, parseCookies, readJson, sendJson, serializeCookie } from "./lib/http.mjs";

export const SESSION_COOKIE = "sid";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

export function createRequestHandler({ store, staticRoot }) {
  const organizationApi = createOrganizationApi({
    store,
    resolveAccount: (request) => currentAccount(request),
  });
  const repositoryApi = createRepositoryApi({
    store,
    resolveAccount: (request) => currentAccount(request),
  });
  const discoveryApi = createDiscoveryApi({
    store,
    resolveAccount: (request) => currentAccount(request),
  });

  async function currentAccount(request) {
    const cookies = parseCookies(request);
    return resolveSessionAccount(store, cookies[SESSION_COOKIE]);
  }

  /** The session's public account, including the organizations it belongs to. */
  async function currentUser(request) {
    const cookies = parseCookies(request);
    const context = await resolveSessionContext(store, cookies[SESSION_COOKIE]);
    if (!context) return null;
    return publicAccount(context.account, organizationsForAccount(context.data, context.account.id));
  }

  async function handleApi(request, response, pathname, url) {
    const method = request.method ?? "GET";

    if (await discoveryApi(request, response, { pathname, method, url })) return;
    if (await repositoryApi(request, response, { pathname, method, url })) return;
    if (await organizationApi(request, response, { pathname, method })) return;

    if (method === "POST" && pathname === "/api/accounts") {
      const body = await readJson(request);
      const result = await registerAccount(store, {
        username: asString(body.username),
        email: asString(body.email),
        password: asString(body.password),
        confirmPassword: asString(body.confirmPassword),
        agreeToTerms: body.agreeToTerms === true,
      });
      if (!result.ok) {
        sendJson(response, 400, { error: "Registration failed", fields: result.errors });
        return;
      }
      sendJson(response, 201, { account: publicAccount(result.account) });
      return;
    }

    if (method === "POST" && pathname === "/api/sessions") {
      const body = await readJson(request);
      const account = await authenticateAccount(store, asString(body.identifier), asString(body.password));
      if (!account) {
        sendJson(response, 401, { error: FIELD_MESSAGES.invalidCredentials });
        return;
      }
      const session = await startSession(store, account.id);
      const data = await store.read();
      sendJson(response, 200, { user: publicAccount(account, organizationsForAccount(data, account.id)) }, {
        "set-cookie": serializeCookie(SESSION_COOKIE, session.id, { httpOnly: true }),
      });
      return;
    }

    if (pathname === "/api/session") {
      if (method === "GET") {
        sendJson(response, 200, { user: await currentUser(request) });
        return;
      }
      if (method === "DELETE") {
        const cookies = parseCookies(request);
        if (cookies[SESSION_COOKIE]) await endSession(store, cookies[SESSION_COOKIE]);
        sendJson(response, 200, { ok: true }, {
          "set-cookie": serializeCookie(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0 }),
        });
        return;
      }
    }

    if (method === "POST" && pathname === "/api/account/password") {
      const cookies = parseCookies(request);
      const account = await resolveSessionAccount(store, cookies[SESSION_COOKIE]);
      if (!account) {
        sendJson(response, 401, { error: "Sign in is required to change the password" });
        return;
      }
      const body = await readJson(request);
      const result = await changeAccountPassword(store, account.id, {
        currentPassword: asString(body.currentPassword),
        newPassword: asString(body.newPassword),
        confirmPassword: asString(body.confirmPassword),
      });
      if (!result.ok) {
        sendJson(response, 400, { error: "Password change failed", fields: result.errors });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/password-recovery/requests") {
      const body = await readJson(request);
      const email = asString(body.email);
      // The local product never sends email: registered and unknown addresses
      // enter the same next step and see the same fixed demonstration code.
      sendJson(response, 200, { email: email.trim(), code: FIXED_VERIFICATION_CODE });
      return;
    }

    if (method === "POST" && pathname === "/api/password-recovery/completions") {
      const body = await readJson(request);
      const result = await resetAccountPassword(store, {
        email: asString(body.email),
        code: asString(body.code),
        password: asString(body.password),
        confirmPassword: asString(body.confirmPassword),
      });
      if (!result.ok) {
        sendJson(response, 400, { error: "Password reset failed", fields: result.errors });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  }

  async function serveStatic(response, pathname) {
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!relative || relative.includes("..") || relative.startsWith("/")) {
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
      if (error?.code === "ENOENT" || error?.code === "EISDIR") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      throw error;
    }
  }

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const { pathname } = url;
      const method = request.method ?? "GET";

      if (method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (pathname.startsWith("/api/")) {
        await handleApi(request, response, pathname, url);
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      await serveStatic(response, pathname);
    } catch (error) {
      const isBodyError = error instanceof SyntaxError || error?.message === "Request body is too large";
      sendJson(response, isBodyError ? 400 : 500, {
        error: isBodyError ? "Invalid request body" : error instanceof Error ? error.message : String(error),
      });
    }
  };
}
