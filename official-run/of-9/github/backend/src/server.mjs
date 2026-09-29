import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, sendJson } from "./lib/http.mjs";
import { createJsonStore } from "./lib/json-store.mjs";
import { createAccountsDomain } from "./domain/accounts.mjs";
import { createOrganizationsDomain } from "./domain/organizations.mjs";
import { createIssuesDomain } from "./domain/issues.mjs";
import { createPullsDomain } from "./domain/pulls.mjs";
import { createIssueRoutes } from "./routes/issues.mjs";
import { createPullRoutes } from "./routes/pulls.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");
const dataDir = process.env.SHALLOW_DATA_DIR
  ? resolve(process.env.SHALLOW_DATA_DIR)
  : resolve(here, "../../data");
const extraPorts = JSON.parse(await readFile(join(here, "platform-ports.json"), "utf8"));
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const store = createJsonStore(join(dataDir, "state.json"), {
  accounts: {},
  sessions: {},
  organizations: {},
  memberships: {},
  teams: {},
  teamMembers: {},
  repositories: {},
  grants: {},
  git: {},
  issues: {},
  labels: {},
  milestones: {},
  timelines: {},
  comments: {},
  reactions: {},
  pullRequests: {},
  pullRequestTimelines: {},
  pullRequestComments: {},
  pullRequestReviews: {},
  pullRequestReviewers: {},
  pullRequestChecks: {},
  pullRequestInlineComments: {},
});
const accounts = createAccountsDomain(store);
const organizations = createOrganizationsDomain(store);
const issues = createIssuesDomain(store);
const pulls = createPullsDomain(store);
await accounts.seedIfEmpty();
await organizations.seedIfEmpty();
await issues.seedIfEmpty();
await pulls.seedIfEmpty();

const SESSION_COOKIE = "session";

function readCookie(request, name) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function setSessionCookie(response, value) {
  response.setHeader(
    "set-cookie",
    `session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}

function clearSessionCookie(response) {
  response.setHeader("set-cookie", "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

async function readBody(request) {
  try {
    return await readJson(request);
  } catch (error) {
    const invalid = new Error("Invalid request body");
    invalid.statusCode = 400;
    throw invalid;
  }
}

function matchPath(pathname, pattern) {
  const parts = pattern.split("/").filter(Boolean);
  const segments = pathname.split("/").filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].startsWith(":")) {
      try {
        params[parts[index].slice(1)] = decodeURIComponent(segments[index]);
      } catch {
        return null;
      }
    } else if (parts[index] !== segments[index]) {
      return null;
    }
  }
  return params;
}

async function handleApi(request, response, url) {
  const path = url.pathname;
  const method = request.method;

  async function requireAccount() {
    const sessionId = readCookie(request, SESSION_COOKIE);
    return sessionId ? accounts.getSessionAccount(sessionId) : null;
  }

  const issueRoutes = createIssueRoutes({
    matchPath,
    readBody,
    sendJson,
    requireAccount,
    issues,
  });
  if (await issueRoutes.handle(request, response, url)) return;

  const pullRoutes = createPullRoutes({
    matchPath,
    readBody,
    sendJson,
    requireAccount,
    pulls,
  });
  if (await pullRoutes.handle(request, response, url)) return;

  if (method === "GET" && path === "/api/session") {
    const sessionId = readCookie(request, SESSION_COOKIE);
    const account = await accounts.getSessionAccount(sessionId);
    sendJson(response, 200, account ? { authenticated: true, account } : { authenticated: false });
    return;
  }

  if (method === "POST" && path === "/api/register") {
    const body = await readBody(request);
    const result = await accounts.register(body);
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { ok: true, account: result.account });
    return;
  }

  if (method === "POST" && path === "/api/signin") {
    const body = await readBody(request);
    const result = await accounts.signIn(body);
    if (!result.ok) {
      sendJson(response, 401, { error: "Invalid credentials" });
      return;
    }
    setSessionCookie(response, result.session.id);
    sendJson(response, 200, { account: result.account });
    return;
  }

  if (method === "POST" && path === "/api/signout") {
    const sessionId = readCookie(request, SESSION_COOKIE);
    await accounts.destroySession(sessionId);
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/api/password/change") {
    const sessionId = readCookie(request, SESSION_COOKIE);
    if (!sessionId) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await accounts.changePassword(sessionId, body);
    if (result.unauthorized) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/api/recovery/request") {
    await readBody(request);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/api/recovery/reset") {
    const body = await readBody(request);
    const result = await accounts.resetPassword(body);
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  // --- Organizations ---

  if (method === "GET" && path === "/api/organizations") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const list = await organizations.listOrganizations(account.username);
    sendJson(response, 200, { organizations: list });
    return;
  }

  if (method === "POST" && path === "/api/organizations") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.createOrganization(account.username, body);
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { organization: result.organization });
    return;
  }

  let params = matchPath(path, "/api/organizations/:org");
  if (params && method === "GET") {
    const account = await requireAccount();
    const organization = await organizations.getOrganization(
      params.org,
      account ? account.username : null,
    );
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    sendJson(response, 200, { organization });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/repositories");
  if (params && method === "GET") {
    const account = await requireAccount();
    const organization = await organizations.getOrganization(
      params.org,
      account ? account.username : null,
    );
    if (!organization) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const repositories = await organizations.listVisibleRepositories(
      params.org,
      account ? account.username : null,
    );
    sendJson(response, 200, { repositories });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/people");
  if (params && method === "GET") {
    const members = await organizations.listPeople(params.org);
    if (members.length === 0 && !(await organizations.getOrganization(params.org, null))) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    sendJson(response, 200, { members });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/people");
  if (params && method === "POST") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const overview = await organizations.getOrganization(params.org, account.username);
    if (!overview) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (overview.myRole !== "owner") {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.addMember(account.username, params.org, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { member: result.member });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/people/:username");
  if (params && method === "DELETE") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const overview = await organizations.getOrganization(params.org, account.username);
    if (!overview) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (overview.myRole !== "owner") {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    const result = await organizations.removeMember(
      account.username,
      params.org,
      params.username,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/teams");
  if (params && method === "GET") {
    const teams = await organizations.listTeams(params.org);
    if (teams.length === 0 && !(await organizations.getOrganization(params.org, null))) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    sendJson(response, 200, { teams });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/teams");
  if (params && method === "POST") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const overview = await organizations.getOrganization(params.org, account.username);
    if (!overview) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (overview.myRole !== "owner") {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.createTeam(account.username, params.org, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { team: result.team });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/teams/:team");
  if (params && method === "GET") {
    const account = await requireAccount();
    const overview = await organizations.getTeam(
      params.org,
      params.team,
      account ? account.username : null,
    );
    if (!overview) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    sendJson(response, 200, { team: overview.team, organization: overview.organization, myRole: overview.myRole });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/teams/:team/members");
  if (params && method === "GET") {
    const overview = await organizations.getTeam(params.org, params.team, null);
    if (!overview) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const members = await organizations.listTeamMembers(params.org, params.team);
    sendJson(response, 200, { members });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/teams/:team/members");
  if (params && method === "POST") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const overview = await organizations.getTeam(params.org, params.team, account.username);
    if (!overview) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (overview.myRole !== "owner") {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.addTeamMember(account.username, params.org, params.team, body.username);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { member: result.member });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/teams/:team/members/:username");
  if (params && method === "DELETE") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const overview = await organizations.getTeam(params.org, params.team, account.username);
    if (!overview) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (overview.myRole !== "owner") {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    await organizations.removeTeamMember(account.username, params.org, params.team, params.username);
    sendJson(response, 200, { ok: true });
    return;
  }

  params = matchPath(path, "/api/organizations/:org/teams/:team");
  if (params && method === "PATCH") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const overview = await organizations.getTeam(params.org, params.team, account.username);
    if (!overview) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (overview.myRole !== "owner") {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.setTeamParent(account.username, params.org, params.team, body.parentId);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { team: result.team });
    return;
  }

  // --- Repositories ---

  params = matchPath(path, "/api/repositories/:owner/:name");
  if (params && method === "GET") {
    const account = await requireAccount();
    const result = await organizations.getRepository(
      params.owner,
      params.name,
      account ? account.username : null,
    );
    if (!result) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, { repository: result.repository, myRole: result.myRole });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/access");
  if (params && method === "GET") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const result = await organizations.getAccessData(account.username, params.owner, params.name);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, { grants: result.grants, members: result.members, teams: result.teams });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/access");
  if (params && method === "POST") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.setGrant(account.username, params.owner, params.name, body);
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { grant: result.grant });
    return;
  }

  // --- Repository search, browsing and distribution ---

  if (method === "GET" && path === "/api/search/repositories") {
    const account = await requireAccount();
    const query = url.searchParams.get("q") ?? "";
    const repositories = await organizations.searchRepositories(
      query,
      account ? account.username : null,
    );
    sendJson(response, 200, { repositories });
    return;
  }

  if (method === "GET" && path === "/api/repositories") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const repositories = await organizations.listMyRepositories(account.username);
    sendJson(response, 200, { repositories });
    return;
  }

  if (method === "POST" && path === "/api/repositories") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.createRepository(account.username, body);
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { repository: result.repository });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/contents");
  if (params && method === "GET") {
    const account = await requireAccount();
    const branch = url.searchParams.get("branch") ?? undefined;
    const filePath = url.searchParams.get("path") ?? "";
    const result = await organizations.getRepositoryContents(
      params.owner,
      params.name,
      { branch, path: filePath },
      account ? account.username : null,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, { contents: result });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/branches");
  if (params && method === "GET") {
    const account = await requireAccount();
    const result = await organizations.listBranches(
      params.owner,
      params.name,
      account ? account.username : null,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, { branches: result.branches, defaultBranch: result.defaultBranch });
    return;
  }

  if (params && method === "POST") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.createBranch(
      account.username,
      params.owner,
      params.name,
      body,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { branch: result.branch });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/default-branch");
  if (params && method === "PATCH") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.setDefaultBranch(
      account.username,
      params.owner,
      params.name,
      body.branch,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { repository: result.repository });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/commits");
  if (params && method === "GET") {
    const account = await requireAccount();
    const branch = url.searchParams.get("branch") ?? undefined;
    const filePath = url.searchParams.get("path") ?? "";
    const result = await organizations.getRepositoryCommits(
      params.owner,
      params.name,
      { branch, path: filePath },
      account ? account.username : null,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, {
      repository: result.repository,
      branch: result.branch,
      path: result.path,
      commits: result.commits,
    });
    return;
  }

  if (params && method === "POST") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.createRepositoryCommit(
      account.username,
      params.owner,
      params.name,
      body,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { commit: result.commit });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/commits/:commitId");
  if (params && method === "GET") {
    const account = await requireAccount();
    const filePath = url.searchParams.get("path") ?? "";
    const result = await organizations.getCommitDiff(
      params.owner,
      params.name,
      params.commitId,
      { path: filePath },
      account ? account.username : null,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, {
      repository: result.repository,
      base: result.base,
      compare: result.compare,
      commit: result.commit,
      parent: result.parent,
      files: result.files,
      totalAdditions: result.totalAdditions,
      totalDeletions: result.totalDeletions,
    });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/compare");
  if (params && method === "GET") {
    const account = await requireAccount();
    const base = url.searchParams.get("base") ?? "";
    const compare = url.searchParams.get("compare") ?? "";
    const filePath = url.searchParams.get("path") ?? "";
    const result = await organizations.getCompareDiff(
      params.owner,
      params.name,
      base,
      compare,
      { path: filePath },
      account ? account.username : null,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, {
      repository: result.repository,
      base: result.base,
      compare: result.compare,
      files: result.files,
      totalAdditions: result.totalAdditions,
      totalDeletions: result.totalDeletions,
    });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/search/code");
  if (params && method === "GET") {
    const account = await requireAccount();
    const query = url.searchParams.get("q") ?? "";
    const filePath = url.searchParams.get("path") ?? "";
    const branch = url.searchParams.get("branch") ?? undefined;
    const result = await organizations.searchRepositoryCode(
      params.owner,
      params.name,
      query,
      { path: filePath, branch },
      account ? account.username : null,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    sendJson(response, 200, {
      repository: result.repository,
      branch: result.branch,
      results: result.results,
    });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name/forks");
  if (params && method === "POST") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.createFork(
      account.username,
      params.owner,
      params.name,
      body,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { repository: result.repository });
    return;
  }

  params = matchPath(path, "/api/repositories/:owner/:name");
  if (params && method === "PATCH") {
    const account = await requireAccount();
    if (!account) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readBody(request);
    const result = await organizations.setRepositoryVisibility(
      account.username,
      params.owner,
      params.name,
      body.visibility,
    );
    if (result.notFound) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (result.forbidden) {
      sendJson(response, 403, { error: "Access denied" });
      return;
    }
    if (!result.ok) {
      sendJson(response, 422, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { repository: result.repository, myRole: result.myRole });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function handler(request, response) {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!relative || relative.includes("..") || relative.startsWith("api/")) {
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
    sendJson(response, error?.statusCode ?? 500, {
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
