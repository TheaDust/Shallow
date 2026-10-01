import { createOrganizationApi } from "./api-organizations.mjs";
import { createRepositoryApi } from "./api-repositories.mjs";
import { FIELD_MESSAGES } from "./lib/accounts.mjs";
import { readJson, sendJson } from "./lib/http.mjs";

export const SESSION_COOKIE = "shallowcode_session";

function readCookie(request, name) {
  const header = request.headers.cookie;
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function sessionCookie(sessionId) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

async function readBody(request) {
  try {
    return await readJson(request);
  } catch {
    return null;
  }
}

export function createApiHandler({
  auth,
  organizations,
  teams,
  access,
  code,
  history,
  codeSearch,
  search,
  repositories,
  visibility,
  branches,
  files,
  issues,
  issueWrites,
  issueMetadata,
  pulls,
  pullTransitions,
  pullReviews,
  pullReviewers,
  pullChecks,
  branchProtection,
}) {
  const organizationApi = createOrganizationApi({ organizations, teams, access });
  const repositoryApi = createRepositoryApi({
    code,
    history,
    codeSearch,
    search,
    repositories,
    visibility,
    branches,
    files,
    issues,
    issueWrites,
    issueMetadata,
    pulls,
    pullTransitions,
    pullReviews,
    pullReviewers,
    pullChecks,
    branchProtection,
  });

  return async function handleApi(request, response, url) {
    const { pathname } = url;
    const method = request.method ?? "GET";

    if (pathname === "/health" || pathname === "/api/health") {
      if (method !== "GET") return false;
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (pathname === "/api/session") {
      if (method === "GET") {
        const account = await auth.sessionAccount(readCookie(request, SESSION_COOKIE));
        sendJson(response, 200, { account });
        return true;
      }
      if (method === "POST") {
        const body = await readBody(request);
        if (body === null) {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const outcome = await auth.signIn(body);
        if (!outcome.ok) {
          // The same generic failure covers unknown account, wrong password and
          // unavailable account so no credential detail leaks.
          sendJson(response, 401, { error: FIELD_MESSAGES.invalidCredentials });
          return true;
        }
        response.setHeader("set-cookie", sessionCookie(outcome.session.id));
        sendJson(response, 200, { account: outcome.account });
        return true;
      }
      if (method === "DELETE") {
        await auth.signOut(readCookie(request, SESSION_COOKIE));
        response.setHeader("set-cookie", clearedSessionCookie());
        sendJson(response, 200, { ok: true });
        return true;
      }
      return false;
    }

    if (pathname === "/api/register") {
      if (method !== "POST") return false;
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await auth.register(body);
      if (!outcome.ok) {
        sendJson(response, 400, {
          error: "Registration failed",
          fieldErrors: outcome.fieldErrors,
        });
        return true;
      }
      sendJson(response, 201, { account: outcome.account });
      return true;
    }

    if (pathname === "/api/password") {
      if (method !== "POST") return false;
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      // Changing a password is only allowed for the account behind the current
      // session; the session is resolved on the trusted side.
      const outcome = await auth.changePassword(readCookie(request, SESSION_COOKIE), body);
      if (outcome.unauthorized) {
        sendJson(response, 401, { error: FIELD_MESSAGES.notAuthenticated });
        return true;
      }
      if (!outcome.ok) {
        sendJson(response, 400, {
          error: "Password change failed",
          fieldErrors: outcome.fieldErrors,
        });
        return true;
      }
      sendJson(response, 200, { message: FIELD_MESSAGES.passwordUpdated });
      return true;
    }

    if (
      pathname.startsWith("/api/organizations") ||
      pathname.startsWith("/api/repositories") ||
      pathname === "/api/search"
    ) {
      // Organization, repository and search permission decisions always use the
      // account resolved from the session cookie on the trusted side.
      const account = await auth.sessionAccount(readCookie(request, SESSION_COOKIE));
      if (await repositoryApi(request, response, url, { account })) return true;
      if (await organizationApi(request, response, url, { account })) return true;
    }

    if (pathname === "/api/password-reset") {
      if (method !== "POST") return false;
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await auth.resetPassword(body);
      if (!outcome.ok) {
        sendJson(response, 400, {
          error: "Password reset failed",
          fieldErrors: outcome.fieldErrors,
        });
        return true;
      }
      sendJson(response, 200, { message: FIELD_MESSAGES.passwordUpdated });
      return true;
    }

    return false;
  };
}
