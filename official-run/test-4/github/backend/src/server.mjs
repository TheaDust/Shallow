import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  changePassword,
  createSession,
  currentAccount,
  endSession,
  registerAccount,
  requestRecovery,
  resetPassword,
  seedState,
} from "./domain/accounts.mjs";
import {
  addOrganizationMember,
  addTeamMember,
  canGrantRepositoryAccess,
  canReadRepository,
  createOrganization,
  createTeam,
  effectiveRepositoryRole,
  findOrganization,
  findRepository,
  findTeam,
  listOrganizationMembers,
  listOrganizationsForAccount,
  listRepoGrants,
  listTeamMembers,
  listTeams,
  listVisibleRepositories,
  organizationRole,
  removeOrganizationMember,
  removeTeamMember,
  seedOrganizations,
  setRepoGrant,
  setTeamParent,
  updateRepoGrantRole,
} from "./domain/organizations.mjs";
import {
  changeRepositoryVisibility,
  createFork,
  createRepository,
  describeRepository,
  listAccountRepositories,
  searchRepositories,
  seedRepositories,
} from "./domain/repos.mjs";
import { findBranch, normalizeRepositories } from "./domain/vcs.mjs";
import { seedIssues } from "./domain/issues.mjs";
import { seedPullRequests } from "./domain/pulls.mjs";
import { sendJson, readJson } from "./lib/http.mjs";
import { createJsonStore } from "./lib/json-store.mjs";
import { handleCodeRoutes } from "./routes/code-routes.mjs";
import { handleIssueRoutes } from "./routes/issue-routes.mjs";
import { handlePullRoutes } from "./routes/pull-routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");
const extraPorts = JSON.parse(await readFile(join(here, "platform-ports.json"), "utf8"));
const dataDir = process.env.SHALLOW_DATA_DIR ?? resolve(here, "../data");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const store = createJsonStore(join(dataDir, "state.json"), {
  accounts: [],
  sessions: [],
  recovery: [],
  organizations: [],
  organizationMembers: [],
  repositories: [],
  teams: [],
  teamMembers: [],
  repoGrants: [],
  labels: [],
  milestones: [],
  issues: [],
  issueComments: [],
  issueReactions: [],
  issueActivities: [],
  pullRequests: [],
  branchProtectionRules: [],
});
await store.update((state) => {
  seedState(state);
  seedOrganizations(state);
  seedRepositories(state);
  seedIssues(state);
  normalizeRepositories(state);
  seedPullRequests(state);
});

const SESSION_COOKIE = "shallow_session";

function resolveRepository(state, ownerType, ownerName, repoName) {
  if (ownerType === "account") {
    const owner = state.accounts.find((candidate) => candidate.username === ownerName);
    if (!owner) return null;
    return (
      state.repositories.find(
        (candidate) =>
          candidate.ownerId === owner.id &&
          candidate.ownerType === "account" &&
          candidate.name === repoName,
      ) ?? null
    );
  }
  const organization = findOrganization(state, ownerName);
  if (!organization) return null;
  return findRepository(state, organization.id, repoName);
}

function readCookies(request) {
  const header = request.headers.cookie;
  if (!header) return {};
  const cookies = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

function setSessionCookie(response, sessionId) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

async function routeApi(request, response, url, cookies) {
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/sessions/current") {
    const state = await store.read();
    const account = currentAccount(state, cookies[SESSION_COOKIE]);
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    sendJson(response, 200, { account });
    return true;
  }
  if (request.method === "POST" && path === "/api/accounts/register") {
    const body = await readJson(request);
    let outcome;
    await store.update((state) => {
      outcome = registerAccount(state, body);
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 201, { ok: true });
    return true;
  }
  if (request.method === "POST" && path === "/api/sessions") {
    const body = await readJson(request);
    let outcome;
    await store.update((state) => {
      outcome = createSession(state, body);
    });
    if (!outcome.ok) {
      sendJson(response, 401, { error: "Invalid credentials" });
      return true;
    }
    setSessionCookie(response, outcome.sessionId);
    sendJson(response, 201, { account: outcome.account });
    return true;
  }
  if (request.method === "DELETE" && path === "/api/sessions/current") {
    const sessionId = cookies[SESSION_COOKIE];
    await store.update((state) => {
      endSession(state, sessionId);
    });
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (request.method === "POST" && path === "/api/accounts/password") {
    const sessionId = cookies[SESSION_COOKIE];
    const state = await store.read();
    const account = currentAccount(state, sessionId);
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((state) => {
      outcome = changePassword(state, { accountId: account.id, ...body });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (request.method === "POST" && path === "/api/recovery/request") {
    const body = await readJson(request);
    let outcome;
    await store.update((state) => {
      outcome = requestRecovery(state, body);
    });
    sendJson(response, 200, outcome);
    return true;
  }
  if (request.method === "POST" && path === "/api/recovery/reset") {
    const body = await readJson(request);
    let outcome;
    await store.update((state) => {
      outcome = resetPassword(state, body);
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  const state = await store.read();
  const account = currentAccount(state, cookies[SESSION_COOKIE]);

  if (request.method === "GET" && path === "/api/search/repositories") {
    sendJson(response, 200, {
      repositories: searchRepositories(state, url.searchParams.get("q") ?? "", account?.id),
    });
    return true;
  }

  const userReposMatch = path.match(/^\/api\/users\/([^/]+)\/repos$/);
  if (userReposMatch && request.method === "GET") {
    const owner = state.accounts.find((candidate) => candidate.username === userReposMatch[1]);
    if (!owner) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    sendJson(response, 200, {
      repositories: listAccountRepositories(state, owner, account?.id),
    });
    return true;
  }

  const userRepoMatch = path.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)$/);
  if (userRepoMatch && (request.method === "GET" || request.method === "PATCH")) {
    const owner = state.accounts.find((candidate) => candidate.username === userRepoMatch[1]);
    if (!owner) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const repository = state.repositories.find(
      (candidate) =>
        candidate.ownerId === owner.id &&
        candidate.ownerType === "account" &&
        candidate.name === userRepoMatch[2],
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (request.method === "GET") {
      if (!canReadRepository(state, account?.id, repository)) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      const branch = url.searchParams.get("branch");
      if (branch && !findBranch(repository, branch)) {
        sendJson(response, 404, { error: "Branch not found" });
        return true;
      }
      sendJson(response, 200, { repository: describeRepository(state, repository, account?.id, branch) });
      return true;
    }
    if (!account || effectiveRepositoryRole(state, account.id, repository) !== "admin") {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = changeRepositoryVisibility(draft, {
        repositoryId: repository.id,
        visibility: body.visibility,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors ?? {} });
      return true;
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && path === "/api/forks") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = createFork(draft, { accountId: account.id, ...body });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    sendJson(response, 201, {
      repository: describeRepository(state, outcome.repository, account.id),
    });
    return true;
  }

  if (request.method === "POST" && path === "/api/repositories") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = createRepository(draft, { accountId: account.id, ...body });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    sendJson(response, 201, {
      repository: describeRepository(state, outcome.repository, account.id),
    });
    return true;
  }

  if (request.method === "GET" && path === "/api/orgs") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    sendJson(response, 200, { organizations: listOrganizationsForAccount(state, account.id) });
    return true;
  }
  if (request.method === "POST" && path === "/api/orgs") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((state) => {
      outcome = createOrganization(state, { accountId: account.id, ...body });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 201, { organization: outcome.organization });
    return true;
  }

  const orgMatch = path.match(/^\/api\/orgs\/([^/]+)$/);
  if (orgMatch && request.method === "GET") {
    const organization = findOrganization(state, orgMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    sendJson(response, 200, {
      organization: {
        name: organization.name,
        displayName: organization.displayName,
        role: organizationRole(state, organization.id, account?.id),
      },
    });
    return true;
  }

  const reposMatch = path.match(/^\/api\/orgs\/([^/]+)\/repos$/);
  if (reposMatch && request.method === "GET") {
    const organization = findOrganization(state, reposMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    sendJson(response, 200, {
      repositories: listVisibleRepositories(state, organization.id, account?.id),
    });
    return true;
  }

  const grantsMatch = path.match(/^\/api\/orgs\/([^/]+)\/repos\/([^/]+)\/grants$/);
  if (grantsMatch && (request.method === "GET" || request.method === "POST")) {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const organization = findOrganization(state, grantsMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const repository = findRepository(state, organization.id, grantsMatch[2]);
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canGrantRepositoryAccess(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    if (request.method === "GET") {
      sendJson(response, 200, {
        grants: listRepoGrants(state, repository.id),
        effectiveRole: effectiveRepositoryRole(state, account.id, repository),
      });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = setRepoGrant(draft, {
        organizationId: organization.id,
        repositoryId: repository.id,
        grantorAccountId: account.id,
        ...body,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 201, { ok: true });
    return true;
  }

  const grantRoleMatch = path.match(/^\/api\/orgs\/([^/]+)\/repos\/([^/]+)\/grants\/([^/]+)\/([^/]+)$/);
  if (grantRoleMatch && request.method === "PATCH") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const organization = findOrganization(state, grantRoleMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const repository = findRepository(state, organization.id, grantRoleMatch[2]);
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canGrantRepositoryAccess(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const subjectType = grantRoleMatch[3];
    const subject = decodeURIComponent(grantRoleMatch[4]);
    const body = await readJson(request);
    let subjectId = null;
    if (subjectType === "account") {
      subjectId = state.accounts.find((candidate) => candidate.username === subject)?.id ?? null;
    } else if (subjectType === "team") {
      subjectId = state.teams.find(
        (candidate) => candidate.organizationId === organization.id && candidate.name === subject,
      )?.id ?? null;
    }
    if (!subjectId) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    let outcome;
    await store.update((draft) => {
      outcome = updateRepoGrantRole(draft, {
        repositoryId: repository.id,
        subjectType,
        subjectId,
        role: body.role,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  const repoMatch = path.match(/^\/api\/orgs\/([^/]+)\/repos\/([^/]+)$/);
  if (repoMatch && (request.method === "GET" || request.method === "PATCH")) {
    const organization = findOrganization(state, repoMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const repository = findRepository(state, organization.id, repoMatch[2]);
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (request.method === "GET") {
      if (!canReadRepository(state, account?.id, repository)) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      const branch = url.searchParams.get("branch");
      if (branch && !findBranch(repository, branch)) {
        sendJson(response, 404, { error: "Branch not found" });
        return true;
      }
      sendJson(response, 200, { repository: describeRepository(state, repository, account?.id, branch) });
      return true;
    }
    if (!account || effectiveRepositoryRole(state, account.id, repository) !== "admin") {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = changeRepositoryVisibility(draft, {
        repositoryId: repository.id,
        visibility: body.visibility,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors ?? {} });
      return true;
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  // ---- Pull request routes (REQ-6) ----
  if (
    await handlePullRoutes({
      request,
      response,
      url,
      path,
      state,
      store,
      account,
      resolveRepository,
    })
  ) {
    return true;
  }

  // ---- Issue routes (REQ-5) ----
  if (
    await handleIssueRoutes({
      request,
      response,
      url,
      path,
      state,
      store,
      account,
      resolveRepository,
    })
  ) {
    return true;
  }

  // ---- Code and version control routes (REQ-4) ----
  if (
    await handleCodeRoutes({
      request,
      response,
      url,
      path,
      state,
      store,
      account,
      resolveRepository,
    })
  ) {
    return true;
  }

  const membersMatch = path.match(/^\/api\/orgs\/([^/]+)\/members$/);
  if (membersMatch && request.method === "GET") {
    const organization = findOrganization(state, membersMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    sendJson(response, 200, {
      members: listOrganizationMembers(state, organization.id),
    });
    return true;
  }
  if (membersMatch && request.method === "POST") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const organization = findOrganization(state, membersMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (organizationRole(state, organization.id, account.id) !== "owner") {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = addOrganizationMember(draft, {
        organizationId: organization.id,
        ...body,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 201, { ok: true });
    return true;
  }

  const memberDeleteMatch = path.match(/^\/api\/orgs\/([^/]+)\/members\/([^/]+)$/);
  if (memberDeleteMatch && request.method === "DELETE") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const organization = findOrganization(state, memberDeleteMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (organizationRole(state, organization.id, account.id) !== "owner") {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    let outcome;
    await store.update((draft) => {
      outcome = removeOrganizationMember(draft, {
        organizationId: organization.id,
        username: memberDeleteMatch[2],
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  const teamsMatch = path.match(/^\/api\/orgs\/([^/]+)\/teams$/);
  if (teamsMatch && request.method === "GET") {
    const organization = findOrganization(state, teamsMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    sendJson(response, 200, { teams: listTeams(state, organization.id) });
    return true;
  }
  if (teamsMatch && request.method === "POST") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const organization = findOrganization(state, teamsMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (organizationRole(state, organization.id, account.id) !== "owner") {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = createTeam(draft, {
        organizationId: organization.id,
        accountId: account.id,
        ...body,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 201, { team: outcome.team });
    return true;
  }

  const teamMatch = path.match(/^\/api\/orgs\/([^/]+)\/teams\/([^/]+)$/);
  if (teamMatch && request.method === "GET") {
    const organization = findOrganization(state, teamMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const team = findTeam(state, organization.id, teamMatch[2]);
    if (!team) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const summary = listTeams(state, organization.id).find((candidate) => candidate.id === team.id);
    sendJson(response, 200, {
      team: {
        ...summary,
        members: listTeamMembers(state, team.id),
      },
    });
    return true;
  }
  if (teamMatch && request.method === "PATCH") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const organization = findOrganization(state, teamMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (organizationRole(state, organization.id, account.id) !== "owner") {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    const team = findTeam(state, organization.id, teamMatch[2]);
    if (!team) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = setTeamParent(draft, {
        organizationId: organization.id,
        teamId: team.id,
        ...body,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  const teamMembersMatch = path.match(/^\/api\/orgs\/([^/]+)\/teams\/([^/]+)\/members$/);
  if (teamMembersMatch && request.method === "POST") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const organization = findOrganization(state, teamMembersMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (organizationRole(state, organization.id, account.id) !== "owner") {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    const team = findTeam(state, organization.id, teamMembersMatch[2]);
    if (!team) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const body = await readJson(request);
    let outcome;
    await store.update((draft) => {
      outcome = addTeamMember(draft, {
        organizationId: organization.id,
        teamId: team.id,
        ...body,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 201, { ok: true });
    return true;
  }

  const teamMemberDeleteMatch = path.match(/^\/api\/orgs\/([^/]+)\/teams\/([^/]+)\/members\/([^/]+)$/);
  if (teamMemberDeleteMatch && request.method === "DELETE") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const organization = findOrganization(state, teamMemberDeleteMatch[1]);
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (organizationRole(state, organization.id, account.id) !== "owner") {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    const team = findTeam(state, organization.id, teamMemberDeleteMatch[2]);
    if (!team) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    await store.update((draft) => {
      removeTeamMember(draft, { teamId: team.id, username: teamMemberDeleteMatch[3] });
    });
    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

async function handler(request, response) {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
      sendJson(response, 200, { ok: true });
      return;
    }
    const cookies = readCookies(request);
    if (url.pathname.startsWith("/api/")) {
      const handled = await routeApi(request, response, url, cookies);
      if (!handled) sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
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
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const primaryPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(primaryPort) || primaryPort <= 0 || primaryPort > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const ports = [
  primaryPort,
  ...(process.env.ARC_EXTRA_PORTS === "0" ? [] : extraPorts),
].filter((port, index, all) => Number.isInteger(port) && port > 0 && port <= 65535 && all.indexOf(port) === index);

const servers = ports.map((port) => createServer((request, response) => {
  void handler(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`application listening on ${port}`);
}));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const server of servers) server.close();
  });
}
