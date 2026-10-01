// Read-only repository Code routes: the directory/file reads, the commit
// history, the commit and comparison diffs and the in-repository code search.
//
// Every route resolves the viewer from the trusted session before the service
// reads the stored objects, so an unreadable repository answers 403 and an
// unknown one 404 without leaking content.

import { sendJson } from "./lib/http.mjs";

function sendCodeOutcome(response, outcome, payloadKey) {
  if (outcome.status === "ok") {
    sendJson(response, 200, outcome[payloadKey]);
    return;
  }
  if (outcome.status === "denied") {
    sendJson(response, 403, { error: "Access denied" });
    return;
  }
  // not-found / branch-not-found / file-not-found / path-not-found
  sendJson(response, 404, { error: "Not found" });
}

function optionText(params, key) {
  const value = params.get(key);
  return value === null ? undefined : value;
}

export function createRepositoryCodeApi({ code, history, codeSearch }) {
  return async function handleRepositoryCodeApi(request, response, url, { account }) {
    const method = request.method ?? "GET";
    if (method !== "GET") return false;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "api" || segments[1] !== "repositories" || segments.length < 5) {
      return false;
    }

    const owner = decodeURIComponent(segments[2]);
    const repositoryName = decodeURIComponent(segments[3]);
    const section = segments[4];
    const accountId = account?.id ?? null;
    const params = url.searchParams;

    if (section === "tree" && segments.length === 5) {
      const outcome = await code.treeForViewer(
        owner,
        repositoryName,
        { branch: optionText(params, "branch"), path: optionText(params, "path") },
        accountId,
      );
      sendCodeOutcome(response, outcome, "tree");
      return true;
    }

    if (section === "blob" && segments.length === 5) {
      const outcome = await code.blobForViewer(
        owner,
        repositoryName,
        { branch: optionText(params, "branch"), path: optionText(params, "path") },
        accountId,
      );
      sendCodeOutcome(response, outcome, "blob");
      return true;
    }

    if (section === "commits") {
      const options = {
        branch: optionText(params, "branch"),
        path: optionText(params, "path"),
      };
      if (segments.length === 5) {
        const outcome = await history.listForViewer(owner, repositoryName, options, accountId);
        sendCodeOutcome(response, outcome, "history");
        return true;
      }
      if (segments.length === 6) {
        const outcome = await history.commitForViewer(
          owner,
          repositoryName,
          decodeURIComponent(segments[5]),
          options,
          accountId,
        );
        sendCodeOutcome(response, outcome, "commitView");
        return true;
      }
      return false;
    }

    if (section === "compare" && segments.length === 5) {
      const outcome = await history.compareForViewer(
        owner,
        repositoryName,
        {
          branch: optionText(params, "branch"),
          base: optionText(params, "base"),
          compare: optionText(params, "compare"),
          path: optionText(params, "path"),
        },
        accountId,
      );
      sendCodeOutcome(response, outcome, "comparison");
      return true;
    }

    if (section === "search" && segments.length === 5) {
      const outcome = await codeSearch.searchForViewer(
        owner,
        repositoryName,
        {
          branch: optionText(params, "branch"),
          q: optionText(params, "q"),
          path: optionText(params, "path"),
          language: optionText(params, "language"),
        },
        accountId,
      );
      sendCodeOutcome(response, outcome, "codeSearch");
      return true;
    }

    return false;
  };
}
