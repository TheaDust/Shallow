import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, sendJson } from "./lib/http.mjs";
import { SESSION_COOKIE_NAME, clearedSessionCookie, readCookie, sessionCookie } from "./lib/cookies.mjs";
import { createOrganizationRouter } from "./routes/organizations.mjs";
import { createStore } from "./store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATIC_ROOT = resolve(here, "../../frontend/dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".txt", "text/plain; charset=utf-8"],
]);

function sendJsonWithCookie(response, status, body, cookie) {
  response.setHeader("set-cookie", cookie);
  sendJson(response, status, body);
}

async function serveStatic(response, staticRoot, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
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
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

async function readJsonOrFail(request, response) {
  try {
    return await readJson(request);
  } catch {
    sendJson(response, 400, { error: "Invalid request body" });
    return null;
  }
}

/**
 * Builds the request handler for every listening socket. The same store
 * instance backs all ports so that sessions and accounts stay consistent.
 */
export function createApp({ dataDir, staticRoot = DEFAULT_STATIC_ROOT }) {
  const store = createStore({ dataDir });
  const handleOrganizationRequest = createOrganizationRouter(store);

  function sendRepositoryRefusal(response, status) {
    sendJson(response, status, { error: status === 403 ? "Access denied" : "Not found" });
  }

  async function route(request, response) {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const { pathname } = url;
    const sessionId = readCookie(request, SESSION_COOKIE_NAME);

    if (method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === "/api/session" && method === "GET") {
      const account = await store.findSessionAccount(sessionId);
      sendJson(response, 200, { account });
      return;
    }

    if (pathname === "/api/sessions" && method === "POST") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await store.authenticate(body.identifier ?? body.username ?? "", body.password);
      if (!result.ok) {
        sendJson(response, 401, { error: "Invalid credentials" });
        return;
      }
      const session = await store.createSession(result.account.id);
      sendJsonWithCookie(response, 200, { account: result.account }, sessionCookie(session.id));
      return;
    }

    if (pathname === "/api/sessions/current" && method === "DELETE") {
      await store.endSession(sessionId);
      sendJsonWithCookie(response, 200, { ok: true }, clearedSessionCookie());
      return;
    }

    if (pathname === "/api/accounts" && method === "POST") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await store.registerAccount(body);
      if (!result.ok) {
        sendJson(response, 400, { error: "Registration failed", fields: result.errors });
        return;
      }
      sendJson(response, 201, { account: result.account });
      return;
    }

    if (pathname === "/api/password-recovery/requests" && method === "POST") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      // The same fixed answer is returned for registered and unknown addresses.
      sendJson(response, 200, await store.requestPasswordReset(body.email));
      return;
    }

    if (pathname === "/api/password-recovery" && method === "POST") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await store.resetPassword(body);
      if (!result.ok) {
        sendJson(response, 400, { error: result.error, fields: result.fields });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === "/api/account/password" && method === "POST") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return;
      }
      const result = await store.changePassword(sessionId, body);
      if (!result.ok && result.unauthorized) {
        sendJson(response, 401, { error: "Not authenticated" });
        return;
      }
      if (!result.ok) {
        sendJson(response, 400, { error: result.error, fields: result.fields });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === "/api/search" && method === "GET") {
      const results = await store.searchRepositories(sessionId, {
        query: url.searchParams.get("q") ?? "",
        type: url.searchParams.get("type") ?? "repositories",
        repository: url.searchParams.get("repo") ?? "",
        path: url.searchParams.get("path") ?? "",
      });
      sendJson(response, 200, results);
      return;
    }

    if (pathname === "/api/namespaces" && method === "GET") {
      const result = await store.listCreatableNamespaceOptions(sessionId);
      if (!result.ok) {
        sendJson(response, result.status, { error: result.error });
        return;
      }
      sendJson(response, 200, { namespaces: result.namespaces });
      return;
    }

    if (await handleOrganizationRequest({ request, response, method, pathname, sessionId })) {
      return;
    }

    if (pathname === "/api/repositories" && method === "GET") {
      const result = await store.listRepositories(sessionId, url.searchParams.get("owner") ?? "");
      if (!result.ok) {
        sendJson(response, result.status, { error: result.error });
        return;
      }
      sendJson(response, 200, { owner: result.owner, repositories: result.repositories });
      return;
    }

    if (pathname === "/api/repositories" && method === "POST") {
      const body = await readJsonOrFail(request, response);
      if (!body) return;
      const result = await store.createRepository(sessionId, body);
      if (!result.ok) {
        sendJson(response, result.status, { error: result.error, fields: result.fields });
        return;
      }
      sendJson(response, result.status, { repository: result.repository });
      return;
    }

    const repositoryRoute = pathname.match(/^\/api\/repositories\/([^/]+)\/([^/]+)(?:\/(.+))?$/);
    if (repositoryRoute) {
      const owner = decodeURIComponent(repositoryRoute[1]);
      const name = decodeURIComponent(repositoryRoute[2]);
      const rest = repositoryRoute[3] ?? "";
      // Unknown or unauthorized repositories answer the same way, so a private
      // repository never reveals that it exists to an anonymous viewer.
      if (rest === "" && method === "GET") {
        const result = await store.getRepositoryView(sessionId, owner, name, {
          branch: url.searchParams.get("branch") ?? "",
          path: url.searchParams.get("path") ?? "",
        });
        if (result.status !== 200) {
          // A readable repository that simply has no such directory answers with
          // the repository context so the path can be shown as absent there.
          if (result.missingPath) {
            sendJson(response, 404, {
              error: "Directory not found",
              repository: result.repository,
            });
            return;
          }
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, { repository: result.repository });
        return;
      }
      if (rest === "file" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.commitRepositoryFile(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, result.payload);
        return;
      }
      if (rest === "branches" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.createRepositoryBranch(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, result.payload);
        return;
      }
      if (rest === "default-branch" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.updateDefaultBranch(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, result.payload);
        return;
      }
      if (rest === "file" && method === "GET") {
        const result = await store.getRepositoryFile(sessionId, owner, name, {
          branch: url.searchParams.get("branch") ?? "",
          path: url.searchParams.get("path") ?? "",
        });
        if (result.status !== 200) {
          // A readable repository that simply has no such file on the branch
          // answers with the repository context so the file can be shown as
          // absent there instead of as an unknown address.
          if (result.missingFile) {
            sendJson(response, 404, {
              error: "File not found",
              repository: result.repository,
            });
            return;
          }
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, result.payload);
        return;
      }
      if (rest === "commits" && method === "GET") {
        const result = await store.listRepositoryCommits(sessionId, owner, name, {
          branch: url.searchParams.get("branch") ?? "",
          path: url.searchParams.get("path") ?? "",
        });
        if (result.status !== 200) {
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, result.payload);
        return;
      }
      if (rest.startsWith("commits/") && method === "GET") {
        const result = await store.getRepositoryCommit(
          sessionId,
          owner,
          name,
          decodeURIComponent(rest.slice("commits/".length)),
          { path: url.searchParams.get("path") ?? "" },
        );
        if (result.status !== 200) {
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, result.payload);
        return;
      }
      if (rest === "compare" && method === "GET") {
        const result = await store.compareRepositoryRevisions(sessionId, owner, name, {
          base: url.searchParams.get("base") ?? "",
          compare: url.searchParams.get("compare") ?? "",
        });
        if (result.status !== 200) {
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, result.payload);
        return;
      }
      if (rest === "forks" && method === "GET") {
        const result = await store.getForkDefaults(
          sessionId,
          owner,
          name,
          url.searchParams.get("namespace") ?? "",
        );
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error });
          return;
        }
        sendJson(response, 200, {
          namespace: result.namespace,
          name: result.name,
          visibility: result.visibility,
        });
        return;
      }
      if (rest === "forks" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.forkRepository(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, { repository: result.repository });
        return;
      }
      if (rest === "access" && method === "GET") {
        const result = await store.getRepositoryAccess(sessionId, owner, name);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, 200, {
          repository: result.repository,
          viewer: result.viewer,
          grants: result.grants,
          candidates: result.candidates,
        });
        return;
      }
      if (rest === "access" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.saveRepositoryAccess(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, { grant: result.grant });
        return;
      }
      if (rest === "visibility" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.changeRepositoryVisibility(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, { repository: result.repository });
        return;
      }
      // Pull requests (REQ-6-2): the list, the read-only comparison shown
      // before creation and the creation of a normal or draft pull request.
      if (rest === "pulls" && method === "GET") {
        const result = await store.listRepositoryPullRequests(sessionId, owner, name);
        if (result.status !== 200) {
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, result.payload);
        return;
      }
      if (rest === "pulls" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.createRepositoryPullRequest(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, result.payload);
        return;
      }
      if (rest === "pulls/compare" && method === "GET") {
        const result = await store.compareRepositoryPullRequestBranches(sessionId, owner, name, {
          base: url.searchParams.get("base") ?? "",
          compare: url.searchParams.get("compare") ?? "",
        });
        if (result.status !== 200) {
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, result.payload);
        return;
      }
      const pullRequestRoute = rest.match(
        /^pulls\/(\d+)(?:\/(checks|comments|inline-comments|merge|reviews|reviewers|status))?$/,
      );
      // Withdrawing one reviewer request addresses the requested account itself
      // (REQ-6-4); deleting it removes only that relationship.
      const reviewerRemovalRoute = rest.match(/^pulls\/(\d+)\/reviewers\/(.+)$/);
      if (reviewerRemovalRoute && method === "DELETE") {
        const result = await store.removePullRequestReviewer(
          sessionId,
          owner,
          name,
          Number(reviewerRemovalRoute[1]),
          decodeURIComponent(reviewerRemovalRoute[2]),
        );
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, result.payload);
        return;
      }
      if (pullRequestRoute) {
        const number = Number(pullRequestRoute[1]);
        const field = pullRequestRoute[2] ?? "";
        if (!field && method === "GET") {
          const result = await store.getRepositoryPullRequest(sessionId, owner, name, number);
          if (result.status !== 200) {
            // A readable repository without that number is not an unknown
            // address: the page keeps the repository context.
            if (result.missingPullRequest) {
              sendJson(response, 404, {
                error: "Pull request not found",
                repository: result.repository,
              });
              return;
            }
            sendRepositoryRefusal(response, result.status);
            return;
          }
          sendJson(response, 200, result.payload);
          return;
        }
        if (method === "POST" && field) {
          const body = await readJsonOrFail(request, response);
          if (!body) return;
          const write =
            field === "checks"
              ? store.savePullRequestCheckStatus
              : field === "merge"
                ? store.mergeRepositoryPullRequest
                : field === "comments"
                  ? store.addPullRequestComment
                  : field === "inline-comments"
                    ? store.addPullRequestInlineComment
                    : field === "reviews"
                      ? store.submitPullRequestReview
                      : field === "reviewers"
                        ? store.requestPullRequestReviewers
                        : store.updatePullRequestStatus;
          const result = await write(sessionId, owner, name, number, body);
          if (!result.ok) {
            sendJson(response, result.status, { error: result.error, fields: result.fields });
            return;
          }
          sendJson(response, result.status, result.payload);
          return;
        }
      }
      // Branch protection rules (REQ-6-1): readable with the repository, only a
      // repository Admin creates or changes one.
      if (rest === "branch-protection" && method === "GET") {
        const result = await store.listBranchProtection(sessionId, owner, name);
        if (result.status !== 200) {
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, result.payload);
        return;
      }
      if (rest === "branch-protection" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.saveBranchProtection(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, result.payload);
        return;
      }
      if (rest === "issues" && method === "GET") {
        const result = await store.listRepositoryIssues(sessionId, owner, name);
        if (result.status !== 200) {
          sendRepositoryRefusal(response, result.status);
          return;
        }
        sendJson(response, 200, result.payload);
        return;
      }
      if (rest === "issues" && method === "POST") {
        const body = await readJsonOrFail(request, response);
        if (!body) return;
        const result = await store.createRepositoryIssue(sessionId, owner, name, body);
        if (!result.ok) {
          sendJson(response, result.status, { error: result.error, fields: result.fields });
          return;
        }
        sendJson(response, result.status, result.payload);
        return;
      }
      const issueRoute = rest.match(
        /^issues\/(\d+)(?:\/(title|description|comments|reactions|assignees|labels|milestone|status))?$/,
      );
      if (issueRoute) {
        const number = Number(issueRoute[1]);
        const field = issueRoute[2] ?? "";
        if (!field && method === "GET") {
          const result = await store.getRepositoryIssue(sessionId, owner, name, number);
          if (result.status !== 200) {
            // A readable repository without that issue is not an unknown address:
            // the page keeps the repository context and shows the number as absent.
            if (result.missingIssue) {
              sendJson(response, 404, { error: "Issue not found", repository: result.repository });
              return;
            }
            sendRepositoryRefusal(response, result.status);
            return;
          }
          sendJson(response, 200, result.payload);
          return;
        }
        if ((field === "title" || field === "description") && method === "POST") {
          const body = await readJsonOrFail(request, response);
          if (!body) return;
          const result =
            field === "title"
              ? await store.updateIssueTitle(sessionId, owner, name, number, body)
              : await store.updateIssueDescription(sessionId, owner, name, number, body);
          if (!result.ok) {
            sendJson(response, result.status, { error: result.error, fields: result.fields });
            return;
          }
          sendJson(response, result.status, result.payload);
          return;
        }
        // Discussion, metadata, classification and status writes (REQ-5-2-3,
        // REQ-5-3, REQ-5-4). Every one of them answers with the persisted issue,
        // so the page shows the stored record instead of a locally patched copy.
        if (method === "POST" && field) {
          const body = await readJsonOrFail(request, response);
          if (!body) return;
          const write =
            field === "comments"
              ? store.addIssueComment
              : field === "reactions"
                ? store.toggleIssueReaction
                : field === "assignees"
                  ? store.updateIssueAssignees
                  : field === "labels"
                    ? store.updateIssueLabels
                    : field === "milestone"
                      ? store.updateIssueMilestone
                      : store.updateIssueStatus;
          const result = await write(sessionId, owner, name, number, body);
          if (!result.ok) {
            sendJson(response, result.status, { error: result.error, fields: result.fields });
            return;
          }
          sendJson(response, result.status, result.payload);
          return;
        }
      }
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    await serveStatic(response, staticRoot, pathname);
  }

  return async function handleRequest(request, response) {
    try {
      await route(request, response);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : "Internal server error" });
      } else {
        response.end();
      }
    }
  };
}
