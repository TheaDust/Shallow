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
  createOrganization,
  createTeam,
  findOrganizationBySlug,
  findTeam,
  isMember,
  membershipOf,
  organizationPeople,
  organizationTeams,
  organizationsForAccount,
  publicOrganization,
  publicOrganizations,
  removeOrganizationMember,
  removeTeamMember,
  setTeamParent,
  teamDetail,
} from "./lib/organizations.mjs";
import {
  branchCommitCount,
  branchCommits,
  canReadRepository,
  commitDetail,
  createRepository,
  createRepositoryBranch,
  createRepositoryFile,
  findRepositoryForOwner,
  forkRepository,
  grantRepositoryAccess,
  isRepositoryAdmin,
  listRepositories,
  listRepositoryBranches,
  normalizeRepositoryPath,
  organizationHasPublicRepository,
  publicRepositories,
  publicRepository,
  repositoriesForAccount,
  repositoryAccessCandidates,
  repositoryAccessList,
  repositoryCommit,
  repositoryDirectoryExists,
  repositoryFile,
  repositoryTree,
  resolveRepositoryBranch,
  searchRepositories,
  searchRepositoryFiles,
  setRepositoryDefaultBranch,
  setRepositoryVisibility,
  updateRepositoryGrant,
} from "./lib/repositories.mjs";
import { repositoryOwnerRef } from "./lib/repository-ownership.mjs";
import { ensureSeeded } from "./lib/seeds.mjs";
import { MESSAGES } from "./lib/validation.mjs";

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
    if (request.method === "POST") {
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await createRepository(store, account.id, body);
      if (result.forbidden) {
        sendJson(response, 403, { error: MESSAGES.ownerForbidden });
        return;
      }
      if (!result.ok) {
        sendJson(response, 400, { error: "Repository creation failed", fields: result.fields });
        return;
      }
      sendJson(response, 201, { repository: result.repository });
      return;
    }
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

  /**
   * Repository search. Anonymous visitors only see public repositories; a
   * signed-in account also sees the private repositories it may read. The
   * endpoint never reveals whether a hidden repository exists.
   */
  async function apiRepositorySearch(request, response, query) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    sendJson(response, 200, { query, repositories: searchRepositories(state, query, account?.id ?? null) });
  }

  /** Public repositories an unauthenticated visitor may explore. */
  async function apiPublicRepositoryList(request, response) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const state = await store.read();
    sendJson(response, 200, { repositories: publicRepositories(state) });
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

  async function apiRepositoryDetail(request, response, ownerLogin, repositoryName) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const repository = findRepositoryForOwner(state, ownerLogin, repositoryName);
    if (!repository) {
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
   * Resolves a repository the viewer may read, answering the failure itself: an
   * unknown repository is a 404 and an unreadable one a 403, so no code view
   * (tree, file, history, diff, code search) ever leaks a private repository.
   */
  function readableRepository(state, account, ownerLogin, repositoryName, response) {
    const repository = findRepositoryForOwner(state, ownerLogin, repositoryName);
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return null;
    }
    if (!canReadRepository(state, repository, account?.id)) {
      sendJson(response, 403, { error: "Access denied" });
      return null;
    }
    return repository;
  }

  /**
   * One file of a branch (REQ-3-2-1 initializes `README.md`). Read-only: the
   * viewer must be able to read the repository, and a missing path is a 404
   * instead of an empty body.
   */
  async function apiRepositoryFile(request, response, ownerLogin, repositoryName, branchName, path) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const repository = readableRepository(state, account, ownerLogin, repositoryName, response);
    if (!repository) return;
    const branch = resolveRepositoryBranch(state, repository, branchName);
    if (!branch) {
      sendJson(response, 404, { error: MESSAGES.branchNotFound });
      return;
    }
    const file = repositoryFile(state, repository, branch.name, path);
    if (!file) {
      sendJson(response, 404, { error: MESSAGES.fileNotFound });
      return;
    }
    sendJson(response, 200, {
      repository: publicRepository(state, repository, account?.id ?? null),
      branch: branch.name,
      path: file.path,
      content: file.content ?? "",
    });
  }

  /**
   * The files and directories at one path of a branch (REQ-4-1). A directory is
   * only a path hierarchy derived from the stored file paths; the branch may be
   * omitted, in which case the repository's default branch is read.
   */
  async function apiRepositoryTree(request, response, ownerLogin, repositoryName, branchName, path) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const repository = readableRepository(state, account, ownerLogin, repositoryName, response);
    if (!repository) return;
    const branch = resolveRepositoryBranch(state, repository, branchName);
    if (!branch) {
      sendJson(response, 404, { error: MESSAGES.branchNotFound });
      return;
    }
    const directory = normalizeRepositoryPath(path);
    if (!repositoryDirectoryExists(state, repository, branch.name, directory)) {
      sendJson(response, 404, { error: MESSAGES.fileNotFound });
      return;
    }
    sendJson(response, 200, {
      repository: publicRepository(state, repository, account?.id ?? null),
      branch: branch.name,
      path: directory,
      entries: repositoryTree(state, repository, branch.name, directory),
    });
  }

  /**
   * The stored branches of one repository (REQ-4-3-1) plus branch creation from
   * the head of another branch (REQ-4-3-2). Reading needs repository-view
   * permission; creating needs Write and above and is decided inside the
   * store-locked mutation, so hiding the control is never the authority.
   */
  async function apiRepositoryBranches(request, response, ownerLogin, repositoryName) {
    if (request.method === "GET") {
      const account = await currentAccount(request);
      const state = await store.read();
      const repository = readableRepository(state, account, ownerLogin, repositoryName, response);
      if (!repository) return;
      sendJson(response, 200, {
        repository: publicRepository(state, repository, account?.id ?? null),
        branches: listRepositoryBranches(state, repository),
      });
      return;
    }
    if (request.method === "POST") {
      const account = await currentAccount(request);
      if (!requireSession(account, response)) return;
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await createRepositoryBranch(store, ownerLogin, repositoryName, account.id, body);
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: MESSAGES.accessDenied });
        return;
      }
      if (!result.ok) {
        sendJson(response, 400, { error: "Branch creation failed", fields: result.fields });
        return;
      }
      sendJson(response, 201, {
        repository: result.repository,
        branch: result.branch,
        branches: result.branches,
      });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  }

  /**
   * Changes the default branch of one repository (REQ-4-3-3). Only a repository
   * Admin is accepted, and the check runs inside the mutation.
   */
  async function apiRepositoryDefaultBranch(request, response, ownerLogin, repositoryName) {
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
    const result = await setRepositoryDefaultBranch(store, ownerLogin, repositoryName, account.id, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: MESSAGES.accessDenied });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Default branch update failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { repository: result.repository, branches: result.branches });
  }

  /**
   * Adds one file to a branch through a new commit (REQ-4-4). Only Write and
   * above may submit; an invalid submission answers its field messages and
   * leaves the branch head and history untouched.
   */
  async function apiRepositoryFiles(request, response, ownerLogin, repositoryName) {
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
    const result = await createRepositoryFile(store, ownerLogin, repositoryName, account.id, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: MESSAGES.accessDenied });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "File creation failed", fields: result.fields });
      return;
    }
    sendJson(response, 201, {
      repository: result.repository,
      branch: result.branch,
      path: result.path,
      content: result.content,
      commit: result.commit,
    });
  }

  /** Commit history of a branch, optionally narrowed to one file path (REQ-4-2-1). */
  async function apiRepositoryCommits(request, response, ownerLogin, repositoryName, branchName, path) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const repository = readableRepository(state, account, ownerLogin, repositoryName, response);
    if (!repository) return;
    const branch = resolveRepositoryBranch(state, repository, branchName);
    if (!branch) {
      sendJson(response, 404, { error: MESSAGES.branchNotFound });
      return;
    }
    const filePath = normalizeRepositoryPath(path);
    sendJson(response, 200, {
      repository: publicRepository(state, repository, account?.id ?? null),
      branch: branch.name,
      path: filePath,
      count: branchCommitCount(state, repository, branch.name),
      commits: branchCommits(state, repository, branch.name, filePath),
    });
  }

  /** One immutable change record with its changed files and diff (REQ-4-2-2). */
  async function apiRepositoryCommit(request, response, ownerLogin, repositoryName, commitId) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const repository = readableRepository(state, account, ownerLogin, repositoryName, response);
    if (!repository) return;
    const commit = repositoryCommit(state, repository, commitId);
    if (!commit) {
      sendJson(response, 404, { error: MESSAGES.commitNotFound });
      return;
    }
    sendJson(response, 200, {
      repository: publicRepository(state, repository, account?.id ?? null),
      commit: commitDetail(state, repository, commit),
    });
  }

  /**
   * Code search inside one repository (REQ-4-2-3). Only readable file content of
   * the current branch is searched; the viewer must be able to read the
   * repository, and the search itself never writes anything.
   */
  async function apiRepositoryCodeSearch(request, response, ownerLogin, repositoryName, query) {
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const account = await currentAccount(request);
    const state = await store.read();
    const repository = readableRepository(state, account, ownerLogin, repositoryName, response);
    if (!repository) return;
    const branch = resolveRepositoryBranch(state, repository, "");
    if (!branch) {
      sendJson(response, 404, { error: MESSAGES.branchNotFound });
      return;
    }
    sendJson(response, 200, {
      repository: publicRepository(state, repository, account?.id ?? null),
      branch: branch.name,
      query,
      matches: searchRepositoryFiles(state, repository, branch.name, query),
    });
  }

  /**
   * Forks a readable repository into a personal or organization namespace
   * (REQ-3-2-2). Both ends are validated inside the store lock, so a refused
   * fork never leaves a repository behind.
   */
  async function apiRepositoryFork(request, response, ownerLogin, repositoryName) {
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
    const result = await forkRepository(store, ownerLogin, repositoryName, account.id, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Fork failed", fields: result.fields });
      return;
    }
    sendJson(response, 201, { repository: result.repository });
  }

  /**
   * “Manage access” for one repository: the stored grants plus the teams and
   * members of the owning organization that the picker can offer. Only an
   * account whose effective repository role is Admin may read or change it.
   */
  async function apiRepositoryAccess(request, response, ownerLogin, repositoryName) {
    const account = await currentAccount(request);
    if (!requireSession(account, response)) return;
    const state = await store.read();
    const repository = findRepositoryForOwner(state, ownerLogin, repositoryName);
    if (!repository) {
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
        candidates: repositoryAccessCandidates(state, repositoryOwnerRef(state, repository)),
      });
      return;
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await grantRepositoryAccess(store, ownerLogin, repositoryName, account.id, body);
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

  async function apiRepositoryGrant(request, response, ownerLogin, repositoryName, grantId) {
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
    const result = await updateRepositoryGrant(store, ownerLogin, repositoryName, account.id, grantId, body);
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

  /**
   * Changes repository visibility (REQ-3-4). Only a repository Admin may, and
   * the check runs inside the mutation; a non-admin request is refused even when
   * the control was never rendered for it.
   */
  async function apiRepositoryVisibility(request, response, ownerLogin, repositoryName) {
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
    const result = await setRepositoryVisibility(store, ownerLogin, repositoryName, account.id, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 400, { error: "Visibility update failed", fields: result.fields });
      return;
    }
    sendJson(response, 200, { repository: result.repository });
  }

  async function handleRepository(request, response, parts, searchParams) {
    const ownerLogin = decodeURIComponent(parts[2]);
    const repositoryName = decodeURIComponent(parts[3]);
    const segments = (from) => parts.slice(from).map((segment) => decodeURIComponent(segment));
    if (parts.length === 4) return apiRepositoryDetail(request, response, ownerLogin, repositoryName);
    if (parts[4] === "fork" && parts.length === 5) {
      return apiRepositoryFork(request, response, ownerLogin, repositoryName);
    }
    if (parts[4] === "blob" && parts.length >= 6) {
      const rest = segments(5);
      return apiRepositoryFile(request, response, ownerLogin, repositoryName, rest[0], rest.slice(1).join("/"));
    }
    // `tree` without a branch reads the default branch of the repository.
    if (parts[4] === "tree") {
      const rest = segments(5);
      return apiRepositoryTree(
        request,
        response,
        ownerLogin,
        repositoryName,
        rest[0] ?? "",
        rest.slice(1).join("/"),
      );
    }
    if (parts[4] === "branches" && parts.length === 5) {
      return apiRepositoryBranches(request, response, ownerLogin, repositoryName);
    }
    if (parts[4] === "default-branch" && parts.length === 5) {
      return apiRepositoryDefaultBranch(request, response, ownerLogin, repositoryName);
    }
    if (parts[4] === "files" && parts.length === 5) {
      return apiRepositoryFiles(request, response, ownerLogin, repositoryName);
    }
    if (parts[4] === "commits" && parts.length >= 6) {
      const rest = segments(5);
      return apiRepositoryCommits(request, response, ownerLogin, repositoryName, rest[0], rest.slice(1).join("/"));
    }
    if (parts[4] === "commit" && parts.length === 6) {
      return apiRepositoryCommit(request, response, ownerLogin, repositoryName, decodeURIComponent(parts[5]));
    }
    if (parts[4] === "search" && parts.length === 5) {
      return apiRepositoryCodeSearch(request, response, ownerLogin, repositoryName, searchParams.get("q") ?? "");
    }
    if (parts[4] === "visibility" && parts.length === 5) {
      return apiRepositoryVisibility(request, response, ownerLogin, repositoryName);
    }
    if (parts[4] === "access") {
      if (parts.length === 5) return apiRepositoryAccess(request, response, ownerLogin, repositoryName);
      if (parts.length === 6) {
        return apiRepositoryGrant(request, response, ownerLogin, repositoryName, decodeURIComponent(parts[5]));
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

  async function handleApi(request, response, pathname, searchParams) {
    if (pathname === "/api/session") return apiSession(request, response);
    if (pathname === "/api/accounts") return apiAccounts(request, response);
    if (pathname === "/api/password/forgot") return apiPasswordForgot(request, response);
    if (pathname === "/api/password/reset") return apiPasswordReset(request, response);
    if (pathname === "/api/password/change") return apiPasswordChange(request, response);
    if (pathname === "/api/public/organizations") return apiPublicOrganizationList(request, response);
    if (pathname === "/api/public/repositories") return apiPublicRepositoryList(request, response);
    if (pathname === "/api/repositories") return apiRepositoryList(request, response);

    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "api" && parts[1] === "search" && parts[2] === "repositories") {
      return apiRepositorySearch(request, response, searchParams.get("q") ?? "");
    }
    if (parts[0] === "api" && parts[1] === "organizations") return handleOrganizations(request, response, parts);
    if (parts[0] === "api" && parts[1] === "repositories" && parts.length >= 4) {
      return handleRepository(request, response, parts, searchParams);
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
        await handleApi(request, response, pathname, url.searchParams);
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
