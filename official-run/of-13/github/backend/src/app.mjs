import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiHandler } from "./api.mjs";
import { createAuthService } from "./lib/accounts.mjs";
import { sendJson } from "./lib/http.mjs";
import { createJsonStore } from "./lib/json-store.mjs";
import { createOrganizationService } from "./lib/organizations.mjs";
import { createRepositoryAccessService } from "./lib/repository-access.mjs";
import { createRepositoryBranchService } from "./lib/repository-branches.mjs";
import { createRepositoryCodeService } from "./lib/repository-code.mjs";
import { createRepositoryFileService } from "./lib/repository-files.mjs";
import { createRepositoryCodeSearchService } from "./lib/repository-code-search.mjs";
import { createRepositoryHistoryService } from "./lib/repository-history.mjs";
import { createIssueService } from "./lib/issues.mjs";
import { createIssueWriteService } from "./lib/issue-writes.mjs";
import { createIssueMetadataService } from "./lib/issue-metadata.mjs";
import { createBranchProtectionService } from "./lib/branch-protection.mjs";
import { createPullRequestCheckService } from "./lib/pull-request-checks.mjs";
import { createPullRequestReviewService } from "./lib/pull-request-reviews.mjs";
import { createPullRequestReviewerService } from "./lib/pull-request-reviewers.mjs";
import { createPullRequestService } from "./lib/pull-requests.mjs";
import { createPullRequestTransitionService } from "./lib/pull-request-transitions.mjs";
import { createRepositoryService } from "./lib/repositories.mjs";
import { createRepositoryVisibilityService } from "./lib/repository-visibility.mjs";
import { createSearchService } from "./lib/search.mjs";
import { createInitialState } from "./lib/seed.mjs";
import { createTeamService } from "./lib/teams.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

export function resolveDataDir(env = process.env) {
  if (env.SHALLOW_DATA_DIR) return resolve(env.SHALLOW_DATA_DIR);
  return resolve(here, "../.data");
}

export function createHandler({ dataDir }) {
  const store = createJsonStore(join(dataDir, "state.json"), createInitialState());
  const auth = createAuthService(store);
  const organizations = createOrganizationService(store);
  const teams = createTeamService(store);
  const access = createRepositoryAccessService(store);
  const code = createRepositoryCodeService(store);
  const history = createRepositoryHistoryService(store);
  const codeSearch = createRepositoryCodeSearchService(store);
  const search = createSearchService(store);
  const repositories = createRepositoryService(store);
  const visibility = createRepositoryVisibilityService(store);
  const branches = createRepositoryBranchService(store);
  const files = createRepositoryFileService(store);
  const issues = createIssueService(store);
  const issueWrites = createIssueWriteService(store);
  const issueMetadata = createIssueMetadataService(store);
  const pulls = createPullRequestService(store);
  const pullTransitions = createPullRequestTransitionService(store);
  const pullReviews = createPullRequestReviewService(store);
  const pullReviewers = createPullRequestReviewerService(store);
  const pullChecks = createPullRequestCheckService(store);
  const branchProtection = createBranchProtectionService(store);
  const api = createApiHandler({
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
  });

  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (await api(request, response, url)) return;

      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
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
  };
}
