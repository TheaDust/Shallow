// Write routes for branch management and web file editing:
//
//   POST /api/repositories/:owner/:name/branches                     create a branch
//   GET  /api/repositories/:owner/:name/settings/branches            branch settings
//   POST /api/repositories/:owner/:name/settings/branches            change default
//   POST /api/repositories/:owner/:name/settings/branches/protection save a rule
//   POST /api/repositories/:owner/:name/files                        commit a file
//
// The session is resolved by the caller; every decision re-reads the stored
// relationship, so hiding a control in the UI never substitutes for the check.

import { readJson, sendJson } from "./lib/http.mjs";
import { BRANCH_PROTECTION_MESSAGES } from "./lib/branch-protection.mjs";
import { BRANCH_MESSAGES } from "./lib/repository-branches.mjs";
import { FILE_MESSAGES } from "./lib/repository-files.mjs";

const UNAUTHORIZED = "Not authenticated";
const NOT_FOUND = "Not found";
const ACCESS_DENIED = "Access denied";

async function readBody(request) {
  try {
    return await readJson(request);
  } catch {
    return null;
  }
}

function sendFailure(response, outcome, fallbackError) {
  if (outcome.status === "unauthorized") {
    sendJson(response, 401, { error: UNAUTHORIZED });
    return;
  }
  if (outcome.status === "not-found" || outcome.status === "branch-not-found") {
    sendJson(response, 404, { error: NOT_FOUND });
    return;
  }
  if (outcome.status === "denied") {
    sendJson(response, 403, { error: ACCESS_DENIED });
    return;
  }
  // A direct write to a branch protected by a rule is refused, never applied.
  if (outcome.status === "protected") {
    sendJson(response, 403, {
      error: outcome.error ?? FILE_MESSAGES.branchProtected,
      fieldErrors: outcome.fieldErrors ?? {},
    });
    return;
  }
  sendJson(response, 400, {
    error: outcome.error ?? fallbackError,
    fieldErrors: outcome.fieldErrors ?? {},
  });
}

export function createRepositoryWriteApi({ branches, files, branchProtection }) {
  return async function handleRepositoryWriteApi(request, response, url, { account }) {
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "api" || segments[1] !== "repositories" || segments.length < 5) {
      return false;
    }
    const owner = decodeURIComponent(segments[2]);
    const repositoryName = decodeURIComponent(segments[3]);
    const section = segments[4];
    const accountId = account?.id ?? null;

    if (section === "branches" && segments.length === 5) {
      if (method !== "POST") return false;
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await branches.createForViewer(owner, repositoryName, body, accountId);
      if (outcome.status === "ok") {
        sendJson(response, 201, { branch: outcome.branch, branches: outcome.branches });
        return true;
      }
      sendFailure(response, outcome, BRANCH_MESSAGES.invalid);
      return true;
    }

    if (section === "settings" && segments[5] === "branches" && segments[6] === "protection") {
      if (segments.length !== 7) return false;
      if (method !== "POST" && method !== "PUT" && method !== "PATCH") return false;
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await branchProtection.saveRuleForViewer(
        owner,
        repositoryName,
        body,
        accountId,
      );
      if (outcome.status === "ok") {
        sendJson(response, 200, outcome.protection);
        return true;
      }
      sendFailure(response, outcome, BRANCH_PROTECTION_MESSAGES.notSaved);
      return true;
    }

    if (section === "settings" && segments[5] === "branches" && segments.length === 6) {
      if (method === "GET") {
        const outcome = await branches.listForViewer(owner, repositoryName, accountId);
        if (outcome.status !== "ok") {
          sendFailure(response, outcome, BRANCH_MESSAGES.notFound);
          return true;
        }
        // The same panel lists the stored branch protection rules of the
        // repository; the save entry itself is Admin-only (see above).
        const protection = await branchProtection.listForViewer(
          owner,
          repositoryName,
          accountId,
        );
        if (protection.status !== "ok") {
          sendFailure(response, protection, BRANCH_MESSAGES.notFound);
          return true;
        }
        sendJson(response, 200, {
          ...outcome.settings,
          branchProtectionRules: protection.protection.branchProtectionRules,
        });
        return true;
      }
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        const body = await readBody(request);
        if (body === null) {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const outcome = await branches.setDefaultForViewer(
          owner,
          repositoryName,
          body,
          accountId,
        );
        if (outcome.status === "ok") {
          sendJson(response, 200, { repository: outcome.repository });
          return true;
        }
        sendFailure(response, outcome, BRANCH_MESSAGES.defaultBranchInvalid);
        return true;
      }
      return false;
    }

    if (section === "files" && segments.length === 5) {
      if (method !== "POST") return false;
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await files.commitForViewer(owner, repositoryName, body, accountId);
      if (outcome.status === "ok") {
        sendJson(response, 201, {
          commit: outcome.commit,
          branch: outcome.branch,
          path: outcome.path,
        });
        return true;
      }
      sendFailure(response, outcome, FILE_MESSAGES.fileNotSaved);
      return true;
    }

    return false;
  };
}
