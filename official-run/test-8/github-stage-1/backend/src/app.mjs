import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  authenticate,
  changePassword,
  createSession,
  endSession,
  publicAccount,
  readSession,
  registerAccount,
  requestPasswordRecovery,
  resetPassword,
} from "./lib/accounts.mjs";
import { appendSetCookie, buildCookie, parseCookies, readJson, sendJson } from "./lib/http.mjs";
import { createJsonStore } from "./lib/json-store.mjs";
import {
  addOrganizationMember,
  addTeamMember,
  canReadRepository,
  createOrganization,
  createTeam,
  findOrganizationBySlug,
  findRepository,
  findTeam,
  grantRepositoryAccess,
  isMember,
  isRepositoryAdmin,
  listRepositories,
  membershipOf,
  organizationHasPublicRepository,
  organizationPeople,
  organizationsForAccount,
  organizationTeams,
  publicOrganization,
  publicOrganizations,
  publicRepository,
  removeOrganizationMember,
  removeTeamMember,
  repositoriesForAccount,
  repositoryAccessCandidates,
  repositoryAccessList,
  setTeamParent,
  teamDetail,
  updateRepositoryGrant,
} from "./lib/organizations.mjs";
import { ensureSeeded } from "./lib/seeds.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");

const SESSION_COOKIE = "shallowcode_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
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

function sessionCookieValue(request) {
  return parseCookies(request.headers?.cookie).get(SESSION_COOKIE) ?? "";
}

async function readBody(request) {
  try {
    return await readJson(request);
  } catch {
    return null;
  }
}

/** Serves the built frontend; unknown files never fall through to the SPA. */
async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).slice(1);
  if (!relative || relative.includes("..")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  let content;
  try {
    content = await readFile(join(staticRoot, relative));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR" || error?.code === "ENOTDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
  response.writeHead(200, {
    "content-type": contentTypes.get(extname(relative)) ?? "application/octet-stream",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

export async function createApp({ dataDir }) {
  if (!dataDir) throw new Error("createApp requires a dataDir");
  const store = createJsonStore(join(dataDir, "state.json"), { accounts: [], sessions: [] });
  await ensureSeeded(store);

  async function apiSession(request, response) {
    if (request.method === "GET") {
      const current = await readSession(store, sessionCookieValue(request));
      sendJson(response, 200, { account: current ? publicAccount(current.account) : null });
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const account = await authenticate(store, body);
      if (!account) {
        sendJson(response, 401, { error: "Invalid credentials" });
        return;
      }
      const session = await createSession(store, account.id);
      appendSetCookie(response, buildCookie(SESSION_COOKIE, session.id, { maxAge: SESSION_MAX_AGE_SECONDS }));
      sendJson(response, 200, { account: publicAccount(account) });
      return;
    }

    if (request.method === "DELETE") {
      await endSession(store, sessionCookieValue(request));
      appendSetCookie(response, buildCookie(SESSION_COOKIE, "", { maxAge: 0 }));
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  }

  async function apiAccounts(request, response) {
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    const result = await registerAccount(store, body);
    if (!result.ok) {
      sendJson(response, 400, { error: "Registration failed", fields: result.fields });
      return;
    }
    sendJson(response, 201, { account: publicAccount(result.account) });
  }

  async function apiPasswordForgot(request, response) {
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    sendJson(response, 200, await requestPasswordRecovery(body));
  }

  async function apiPasswordReset(request, response) {
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    const result = await resetPassword(store, body);
    if (!result.ok) {
      sendJson(response, 400, { error: "Password reset failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { message: result.message });
  }

  async function apiPasswordChange(request, response) {
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    const result = await changePassword(store, sessionCookieValue(request), body);
    if (result.unauthorized) {
      sendJson(response, 401, { error: "Authentication required" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Password change failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { message: result.message });
  }

  async function currentAccount(request) {
    const session = await readSession(store, sessionCookieValue(request));
    return session?.account ?? null;
  }

  function requireSession(account, response) {
    if (!account) {
      sendJson(response, 401, { error: "Authentication required" });
      return false;
    }
    return true;
  }

  async function apiOrganizationList(request, response) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const state = await store.read();
    sendJson(response, 200, { organizations: organizationsForAccount(state, account.id) });
  }

  /**
   * The signed-in account’s readable repositories (public plus granted). Keeps
   * the “Your organizations” workspace usable for a repository Admin who has no
   * organization membership; `repositoriesForAccount` still hides anything the
   * account may not read.
   */
  async function apiRepositoryList(request, response) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const state = await store.read();
    sendJson(response, 200, { repositories: repositoriesForAccount(state, account.id) });
  }

  async function apiPublicOrganizationList(request, response) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const state = await store.read();
    sendJson(response, 200, { organizations: publicOrganizations(state) });
  }

  async function apiOrganizationCreate(request, response) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    const result = await createOrganization(store, account.id, body);
    if (!result.ok) {
      sendJson(response, 400, { error: "Organization creation failed", fields: result.fields });
      return;
    }
    sendJson(response, 201, { organization: result.organization });
  }

  async function apiOrganizationDetail(request, response, slug) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const organization = findOrganizationBySlug(state, slug);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!account && !organizationHasPublicRepository(state, organization)) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    const role = membershipOf(state, organization.id, account?.id)?.role ?? null;
    sendJson(response, 200, { organization: publicOrganization(organization, role) });
  }

  async function apiOrganizationRepositories(request, response, slug) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const organization = findOrganizationBySlug(state, slug);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!account && !organizationHasPublicRepository(state, organization)) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, {
      organization: publicOrganization(organization, membershipOf(state, organization.id, account?.id)?.role ?? null),
      repositories: listRepositories(state, organization, account?.id),
    });
  }

  async function apiOrganizationPeople(request, response, slug) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const organization = findOrganizationBySlug(state, slug);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!account || !isMember(state, organization.id, account.id)) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, {
      organization: publicOrganization(organization, membershipOf(state, organization.id, account.id).role),
      people: organizationPeople(state, organization),
    });
  }

  async function apiOrganizationMembersAdd(request, response, slug) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    const result = await addOrganizationMember(store, slug, account.id, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Member update failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { organization: result.organization, people: result.people });
  }

  async function apiOrganizationMembersRemove(request, response, slug, username) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "DELETE") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const result = await removeOrganizationMember(store, slug, account.id, username);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Member update failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { organization: result.organization, people: result.people });
  }

  async function apiOrganizationTeams(request, response, slug) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    const state = await store.read();
    const organization = findOrganizationBySlug(state, slug);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!isMember(state, organization.id, account.id)) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (request.method === "GET") {
      sendJson(response, 200, {
        organization: publicOrganization(organization, membershipOf(state, organization.id, account.id).role),
        teams: organizationTeams(state, organization),
      });
      return;
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await createTeam(store, slug, account.id, body);
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return;
      }
      if (!result.ok) {
        sendJson(response, 400, { error: "Team creation failed", fields: result.fields });
        return;
      }
      sendJson(response, 201, { team: result.team });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  }

  async function apiTeamDetail(request, response, slug, teamSlug) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    const state = await store.read();
    const organization = findOrganizationBySlug(state, slug);
    const team = organization ? findTeam(state, organization.id, teamSlug) : undefined;
    if (!organization || !team) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!isMember(state, organization.id, account.id)) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    sendJson(response, 200, teamDetail(state, organization, team, account.id));
  }

  async function apiTeamParent(request, response, slug, teamSlug) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    const result = await setTeamParent(store, slug, teamSlug, account.id, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Team update failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { team: result.team });
  }

  async function apiTeamMembersAdd(request, response, slug, teamSlug) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    const result = await addTeamMember(store, slug, teamSlug, account.id, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Team member update failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { team: result.team, members: result.members });
  }

  async function apiTeamMembersRemove(request, response, slug, teamSlug, username) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "DELETE") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const result = await removeTeamMember(store, slug, teamSlug, account.id, username);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Team member update failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { team: result.team, members: result.members });
  }

  async function apiRepositoryDetail(request, response, organizationSlug, repositoryName) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const organization = findOrganizationBySlug(state, organizationSlug);
    const repository = organization ? findRepository(state, organization.id, repositoryName) : undefined;
    if (!organization || !repository) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!canReadRepository(state, repository, account?.id)) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, { repository: publicRepository(state, repository, account?.id ?? null) });
  }

  /**
   * “Manage access” for one repository: the stored grants plus the teams and
   * members of the owning organization that the picker can offer. Only an
   * account whose effective repository role is Admin may read or change it.
   */
  async function apiRepositoryAccess(request, response, organizationSlug, repositoryName) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    const state = await store.read();
    const organization = findOrganizationBySlug(state, organizationSlug);
    const repository = organization ? findRepository(state, organization.id, repositoryName) : undefined;
    if (!organization || !repository) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!isRepositoryAdmin(state, repository, account.id)) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, {
        repository: publicRepository(state, repository, account.id),
        access: repositoryAccessList(state, repository),
        candidates: repositoryAccessCandidates(state, organization),
      });
      return;
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await grantRepositoryAccess(store, organizationSlug, repositoryName, account.id, body);
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return;
      }
      if (!result.ok) {
        sendJson(response, 400, { error: "Access update failed", fields: result.fields });
        return;
      }
      sendJson(response, 200, { repository: result.repository, access: result.access });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  }

  async function apiRepositoryGrant(request, response, organizationSlug, repositoryName, grantId) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    if (request.method !== "PATCH") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return;
    }
    const result = await updateRepositoryGrant(store, organizationSlug, repositoryName, account.id, grantId, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Access update failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { repository: result.repository, access: result.access });
  }

  async function handleRepository(request, response, parts) {
    const organizationSlug = decodeURIComponent(parts[2]);
    const repositoryName = decodeURIComponent(parts[3]);
    if (parts.length === 4) return apiRepositoryDetail(request, response, organizationSlug, repositoryName);
    if (parts[4] === "access") {
      if (parts.length === 5) return apiRepositoryAccess(request, response, organizationSlug, repositoryName);
      if (parts.length === 6) {
        return apiRepositoryGrant(request, response, organizationSlug, repositoryName, decodeURIComponent(parts[5]));
      }
    }
    sendJson(response, 404, { error: "Not found" });
  }

  async function handleOrganizations(request, response, parts) {
    if (parts.length === 2) {
      if (request.method === "POST") return apiOrganizationCreate(request, response);
      return apiOrganizationList(request, response);
    }
    const slug = decodeURIComponent(parts[2]);
    if (parts.length === 3) return apiOrganizationDetail(request, response, slug);
    if (parts.length === 4) {
      if (parts[3] === "repositories") return apiOrganizationRepositories(request, response, slug);
      if (parts[3] === "people") return apiOrganizationPeople(request, response, slug);
      if (parts[3] === "teams") return apiOrganizationTeams(request, response, slug);
      if (parts[3] === "members") return apiOrganizationMembersAdd(request, response, slug);
    }
    if (parts.length === 5 && parts[3] === "members") {
      return apiOrganizationMembersRemove(request, response, slug, decodeURIComponent(parts[4]));
    }
    if (parts.length >= 5 && parts[3] === "teams") {
      const teamSlug = decodeURIComponent(parts[4]);
      if (parts.length === 5) return apiTeamDetail(request, response, slug, teamSlug);
      if (parts.length === 6 && parts[5] === "parent") return apiTeamParent(request, response, slug, teamSlug);
      if (parts.length === 6 && parts[5] === "members") return apiTeamMembersAdd(request, response, slug, teamSlug);
      if (parts.length === 7 && parts[5] === "members") {
        return apiTeamMembersRemove(request, response, slug, teamSlug, decodeURIComponent(parts[6]));
      }
    }
    sendJson(response, 404, { error: "Not found" });
  }

  async function handleApi(request, response, pathname) {
    if (pathname === "/api/session") return apiSession(request, response);
    if (pathname === "/api/accounts") return apiAccounts(request, response);
    if (pathname === "/api/password/forgot") return apiPasswordForgot(request, response);
    if (pathname === "/api/password/reset") return apiPasswordReset(request, response);
    if (pathname === "/api/password/change") return apiPasswordChange(request, response);
    if (pathname === "/api/public/organizations") return apiPublicOrganizationList(request, response);
    if (pathname === "/api/repositories") return apiRepositoryList(request, response);

    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "api" && parts[1] === "organizations") return handleOrganizations(request, response, parts);
    if (parts[0] === "api" && parts[1] === "repositories" && parts.length >= 4) {
      return handleRepository(request, response, parts);
    }

    sendJson(response, 404, { error: "Not found" });
  }

  async function handle(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const { pathname } = url;

      if (request.method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        await handleApi(request, response, pathname);
        return;
      }
      await serveStatic(request, response, pathname);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        response.end();
      }
    }
  }

  return { handle, store };
}
