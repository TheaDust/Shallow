// Repository Issues: the list of the current repository, the detail page of one
// repository-scoped issue number, and the writes on it (creating an issue,
// editing its title or description, commenting, reacting) plus the triage
// metadata operations (assignees, labels, milestone and status).
//
// Reads are open to any viewer with repository-view permission; every write
// resolves the account from the trusted session first and re-checks the stored
// permission of that account on the addressed repository inside the service.

import { readJson, sendJson } from "./lib/http.mjs";
import { ISSUE_MESSAGES } from "./lib/issue-writes.mjs";

async function readBody(request) {
  try {
    return await readJson(request);
  } catch {
    return null;
  }
}

function sendIssueOutcome(response, outcome, payloadKey) {
  if (outcome.status === "ok") {
    sendJson(response, 200, outcome[payloadKey]);
    return;
  }
  sendIssueFailure(response, outcome);
}

/** The shared failure mapping: 401 without a session, 403 denied, 404 unknown. */
function sendIssueFailure(response, outcome) {
  if (outcome.status === "unauthorized") {
    sendJson(response, 401, { error: ISSUE_MESSAGES.notAuthenticated });
    return;
  }
  if (outcome.status === "denied") {
    sendJson(response, 403, { error: ISSUE_MESSAGES.accessDenied });
    return;
  }
  if (outcome.status === "invalid") {
    sendJson(response, 400, { error: outcome.error, fieldErrors: outcome.fieldErrors ?? {} });
    return;
  }
  // not-found: unknown repository, unknown issue number or unknown comment.
  sendJson(response, 404, { error: ISSUE_MESSAGES.notFound });
}

export function createRepositoryIssuesApi({ issues, issueWrites, issueMetadata }) {
  return async function handleRepositoryIssuesApi(request, response, url, { account }) {
    const method = request.method ?? "GET";

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "api" || segments[1] !== "repositories") return false;
    if (segments[4] !== "issues") return false;
    const rest = segments.slice(5);
    if (rest.length > 2) return false;

    const owner = decodeURIComponent(segments[2]);
    const repositoryName = decodeURIComponent(segments[3]);
    const accountId = account?.id ?? null;

    // The Issues list: readable by any viewer, and the entry point of a new issue.
    if (rest.length === 0) {
      if (method === "GET") {
        const outcome = await issues.listForViewer(owner, repositoryName, accountId);
        sendIssueOutcome(response, outcome, "list");
        return true;
      }
      if (method === "POST") {
        const body = await readBody(request);
        if (body === null) {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const outcome = await issueWrites.createForViewer(
          owner,
          repositoryName,
          body,
          accountId,
        );
        if (outcome.status === "ok") sendJson(response, 201, outcome.detail);
        else sendIssueFailure(response, outcome);
        return true;
      }
      return false;
    }

    const number = decodeURIComponent(rest[0]);

    // One issue: the detail page, and the title/description save.
    if (rest.length === 1) {
      if (method === "GET") {
        const outcome = await issues.detailForViewer(owner, repositoryName, number, accountId);
        sendIssueOutcome(response, outcome, "detail");
        return true;
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readBody(request);
        if (body === null) {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const outcome = await issueWrites.updateForViewer(
          owner,
          repositoryName,
          number,
          body,
          accountId,
        );
        if (outcome.status === "ok") sendJson(response, 200, outcome.detail);
        else sendIssueFailure(response, outcome);
        return true;
      }
      return false;
    }

    // The discussion writes: appending a comment, toggling a reaction.
    if (method !== "POST") return false;
    const body = await readBody(request);
    if (body === null) {
      sendJson(response, 400, { error: "Invalid request body" });
      return true;
    }

    if (rest[1] === "comments") {
      const outcome = await issueWrites.commentForViewer(
        owner,
        repositoryName,
        number,
        body,
        accountId,
      );
      if (outcome.status === "ok") sendJson(response, 201, outcome.detail);
      else sendIssueFailure(response, outcome);
      return true;
    }

    if (rest[1] === "reactions") {
      const outcome = await issueWrites.reactForViewer(
        owner,
        repositoryName,
        number,
        body,
        accountId,
      );
      if (outcome.status === "ok") sendJson(response, 200, outcome.detail);
      else sendIssueFailure(response, outcome);
      return true;
    }

    // The triage metadata writes: assignees, labels, milestone and status.
    const metadataWrite = {
      assignees: issueMetadata.assignForViewer,
      labels: issueMetadata.labelForViewer,
      milestone: issueMetadata.milestoneForViewer,
      state: issueMetadata.stateForViewer,
    }[rest[1]];
    if (metadataWrite) {
      const outcome = await metadataWrite(owner, repositoryName, number, body, accountId);
      if (outcome.status === "ok") sendJson(response, 200, outcome.detail);
      else sendIssueFailure(response, outcome);
      return true;
    }

    return false;
  };
}
