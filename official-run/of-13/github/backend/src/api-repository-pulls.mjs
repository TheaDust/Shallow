// The pull-request routes of one repository: the list, the read-only branch
// comparison of the creation page, the detail of one numbered pull request, its
// status transitions (ready for review, merge, close, reopen), its collaboration
// writes and its reviewer requests.
//
// Every route resolves the account from the trusted session cookie and lets the
// service re-check the stored permission of that account on the addressed
// repository, so a hidden control is never the only guard.

import { readJson, sendJson } from "./lib/http.mjs";
import { PULL_REQUEST_MESSAGES } from "./lib/pull-requests.mjs";
async function readBody(request) {
  try {
    return await readJson(request);
  } catch {
    return null;
  }
}

/** The shared failure mapping: 401 without a session, 403 denied, 404 unknown. */
function sendPullFailure(response, outcome) {
  if (outcome.status === "unauthorized") {
    sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.notAuthenticated });
    return;
  }
  if (outcome.status === "denied") {
    sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.accessDenied });
    return;
  }
  if (outcome.status === "invalid") {
    sendJson(response, 400, {
      error: outcome.error ?? PULL_REQUEST_MESSAGES.notUpdated,
      fieldErrors: outcome.fieldErrors ?? {},
    });
    return;
  }
  // not-found and branch-not-found: unknown repository, number or branch name.
  sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
}

function sendPullPayload(response, outcome, payloadKey, status = 200) {
  if (outcome.status === "ok") {
    sendJson(response, status, outcome[payloadKey]);
    return;
  }
  sendPullFailure(response, outcome);
}

export function createRepositoryPullsApi({
  pulls,
  pullTransitions,
  pullReviews,
  pullReviewers,
  pullChecks,
}) {
  return async function handleRepositoryPullsApi(request, response, url, { account }) {
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "api" || segments[1] !== "repositories") return false;
    if (segments[4] !== "pulls") return false;
    const rest = segments.slice(5);
    if (rest.length > 3) return false;

    const owner = decodeURIComponent(segments[2]);
    const repositoryName = decodeURIComponent(segments[3]);
    const accountId = account?.id ?? null;

    // The Pull requests list, and the creation of a new pull request.
    if (rest.length === 0) {
      if (method === "GET") {
        const outcome = await pulls.listForViewer(owner, repositoryName, accountId);
        sendPullPayload(response, outcome, "list");
        return true;
      }
      if (method === "POST") {
        const body = await readBody(request);
        if (body === null) {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const outcome = await pullTransitions.createForViewer(owner, repositoryName, body, accountId);
        sendPullPayload(response, outcome, "detail", 201);
        return true;
      }
      return false;
    }

    // The read-only comparison of the two selected branches.
    if (rest.length === 1 && rest[0] === "compare") {
      if (method !== "GET") return false;
      const outcome = await pulls.comparisonForViewer(
        owner,
        repositoryName,
        {
          base: url.searchParams.get("base") ?? "",
          compare: url.searchParams.get("compare") ?? "",
        },
        accountId,
      );
      sendPullPayload(response, outcome, "comparison");
      return true;
    }

    // One numbered pull request: the detail page, its status transitions
    // (ready for review, merge, close, reopen) and its collaboration writes.
    if (!/^\d+$/.test(rest[0] ?? "")) return false;
    const number = rest[0];

    if (rest.length === 1) {
      if (method !== "GET") return false;
      const outcome = await pulls.detailForViewer(owner, repositoryName, number, accountId);
      sendPullPayload(response, outcome, "detail");
      return true;
    }

    // The Checks area of the pull request: the read is part of the detail
    // payload, and only a repository Admin may store a new `test` status.
    if (rest.length === 2 && rest[1] === "checks") {
      if (method === "GET") {
        const outcome = await pullChecks.listForViewer(owner, repositoryName, number, accountId);
        sendPullPayload(response, outcome, "checks");
        return true;
      }
      if (method !== "POST") return false;
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await pullChecks.setCheckForViewer(
        owner,
        repositoryName,
        number,
        body,
        accountId,
      );
      sendPullPayload(response, outcome, "detail");
      return true;
    }

    // The reviewer requests of the pull request: one relationship per
    // candidate account, created and deleted without a second confirmation.
    if (rest[1] === "reviewers") {
      if (rest.length === 2 && method === "POST") {
        const body = await readBody(request);
        if (body === null) {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const outcome = await pullReviewers.requestReviewerForViewer(
          owner,
          repositoryName,
          number,
          body,
          accountId,
        );
        sendPullPayload(response, outcome, "detail", 201);
        return true;
      }
      if (rest.length === 3 && method === "DELETE") {
        const outcome = await pullReviewers.removeReviewerForViewer(
          owner,
          repositoryName,
          number,
          decodeURIComponent(rest[2]),
          accountId,
        );
        sendPullPayload(response, outcome, "detail");
        return true;
      }
      return false;
    }

    if (method !== "POST") return false;
    if (rest[1] === "ready-for-review") {
      const outcome = await pullTransitions.readyForReviewForViewer(
        owner,
        repositoryName,
        number,
        accountId,
      );
      sendPullPayload(response, outcome, "detail");
      return true;
    }
    if (rest[1] === "close") {
      const outcome = await pullTransitions.closeForViewer(
        owner,
        repositoryName,
        number,
        accountId,
      );
      sendPullPayload(response, outcome, "detail");
      return true;
    }
    if (rest[1] === "reopen") {
      const outcome = await pullTransitions.reopenForViewer(
        owner,
        repositoryName,
        number,
        accountId,
      );
      sendPullPayload(response, outcome, "detail");
      return true;
    }
    if (rest[1] === "merge") {
      const outcome = await pullTransitions.mergeForViewer(
        owner,
        repositoryName,
        number,
        accountId,
      );
      sendPullPayload(response, outcome, "detail");
      return true;
    }
    // The inline review comment (`pending` keeps it as a review draft) and the
    // review decision of one reviewer on the current compare commit.
    if (rest[1] === "comments") {
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await pullReviews.addCommentForViewer(
        owner,
        repositoryName,
        number,
        body,
        accountId,
      );
      sendPullPayload(response, outcome, "detail", 201);
      return true;
    }
    if (rest[1] === "reviews") {
      const body = await readBody(request);
      if (body === null) {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const outcome = await pullReviews.submitReviewForViewer(
        owner,
        repositoryName,
        number,
        body,
        accountId,
      );
      sendPullPayload(response, outcome, "detail", 201);
      return true;
    }
    return false;
  };
}
