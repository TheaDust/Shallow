import { createRepositoryCodeApi } from "./api-repository-code.mjs";
import { createRepositoryIssuesApi } from "./api-repository-issues.mjs";
import { createRepositoryPullsApi } from "./api-repository-pulls.mjs";
import { createRepositoryWriteApi } from "./api-repository-write.mjs";
import { readJson, sendJson } from "./lib/http.mjs";
import { REPOSITORY_MESSAGES } from "./lib/repositories.mjs";
async function readBody(request) {
  try {
    return await readJson(request);
  } catch {
    return null;
  }
}

function sendRepositoryOutcome(response, outcome, payloadKey, failureError) {
  if (outcome.unauthorized) {
    sendJson(response, 401, { error: REPOSITORY_MESSAGES.notAuthenticated });
    return;
  }
  if (outcome.notFound) {
    sendJson(response, 404, { error: REPOSITORY_MESSAGES.notFound });
    return;
  }
  if (outcome.forbidden) {
    sendJson(response, 403, { error: REPOSITORY_MESSAGES.accessDenied });
    return;
  }
  if (!outcome.ok) {
    sendJson(response, 400, { error: failureError, fieldErrors: outcome.fieldErrors });
    return;
  }
  sendJson(response, 201, { [payloadKey]: outcome.repository });
}

/**
 * Global search, the repository creation/fork/visibility writes, the branch
 * and file writes, the read-only Code routes (tree, blob, commits, compare,
 * code search) owned by `api-repository-code.mjs`, the Issues routes owned by
 * `api-repository-issues.mjs` (which also owns the issue collaboration and
 * triage metadata writes) and the pull-request routes owned by
 * `api-repository-pulls.mjs`. `account` is the account resolved from the
 * trusted session cookie, or null for a visitor.
 */
export function createRepositoryApi({
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
  const codeApi = createRepositoryCodeApi({ code, history, codeSearch });
  const writeApi = createRepositoryWriteApi({ branches, files, branchProtection });
  const issuesApi = createRepositoryIssuesApi({ issues, issueWrites, issueMetadata });
  const pullsApi = createRepositoryPullsApi({
    pulls,
    pullTransitions,
    pullReviews,
    pullReviewers,
    pullChecks,
  });
  return async function handleRepositoryApi(request, response, url, { account }) {
    const method = request.method ?? "GET";
    const accountId = account?.id ?? null;

    if (await writeApi(request, response, url, { account })) return true;
    if (await codeApi(request, response, url, { account })) return true;
    if (await issuesApi(request, response, url, { account })) return true;
    if (await pullsApi(request, response, url, { account })) return true;

    if (url.pathname === "/api/repositories") {
      if (method === "GET") {
        if (!account) {
          sendJson(response, 401, { error: REPOSITORY_MESSAGES.notAuthenticated });
          return true;
        }
        const list = await repositories.listForAccount(account.id);
        sendJson(response, 200, { repositories: list ?? [] });
        return true;
      }
      if (method === "POST") {
        if (!account) {
          sendJson(response, 401, { error: REPOSITORY_MESSAGES.notAuthenticated });
          return true;
        }
        const body = await readBody(request);
        if (body === null) {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const outcome = await repositories.create(account.id, body);
        sendRepositoryOutcome(response, outcome, "repository", "Repository creation failed");
        return true;
      }
      return false;
    }

    const visibilityPath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/visibility$/.exec(
      url.pathname,
    );
    if (visibilityPath) {
      if (method !== "POST" && method !== "PUT" && method !== "PATCH") return false;
      if (!account) {
        sendJson(response, 401, { error: REPOSITORY_MESSAGES.notAuthenticated });
        return true;
      }
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await visibility.changeVisibility(
        account.id,
        decodeURIComponent(visibilityPath[1]),
        decodeURIComponent(visibilityPath[2]),
        body,
      );
      if (outcome.unauthorized) {
        sendJson(response, 401, { error: REPOSITORY_MESSAGES.notAuthenticated });
        return true;
      }
      if (outcome.notFound) {
        sendJson(response, 404, { error: REPOSITORY_MESSAGES.notFound });
        return true;
      }
      if (outcome.forbidden) {
        sendJson(response, 403, { error: REPOSITORY_MESSAGES.accessDenied });
        return true;
      }
      if (!outcome.ok) {
        sendJson(response, 400, {
          error: "Repository visibility not changed",
          fieldErrors: outcome.fieldErrors,
        });
        return true;
      }
      sendJson(response, 200, { repository: outcome.repository });
      return true;
    }

    const forkPath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/forks$/.exec(url.pathname);
    if (forkPath) {
      if (method !== "POST") return false;
      if (!account) {
        sendJson(response, 401, { error: REPOSITORY_MESSAGES.notAuthenticated });
        return true;
      }
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await repositories.fork(
        account.id,
        decodeURIComponent(forkPath[1]),
        decodeURIComponent(forkPath[2]),
        body,
      );
      sendRepositoryOutcome(response, outcome, "repository", "Repository not forked");
      return true;
    }

    if (url.pathname === "/api/search") {
      if (method !== "GET") return false;
      const outcome = await search.search(
        url.searchParams.get("q") ?? "",
        url.searchParams.get("type") ?? undefined,
        accountId,
      );
      sendJson(response, 200, outcome);
      return true;
    }

    return false;
  };
}
