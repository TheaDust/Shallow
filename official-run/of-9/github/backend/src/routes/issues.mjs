// HTTP routes for the issue domain. Each handler returns `true` when it
// matched the request path so the main API dispatcher can stop; unknown
// paths fall through to the regular 404 handling.

export function createIssueRoutes({ matchPath, readBody, sendJson, requireAccount, issues }) {
  async function handle(request, response, url) {
    const path = url.pathname;
    const method = request.method;

    let params = matchPath(path, "/api/repositories/:owner/:name/issues");
    if (params && method === "GET") {
      const account = await requireAccount();
      const result = await issues.listIssues(
        params.owner,
        params.name,
        account ? account.username : null,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.denied) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      sendJson(response, 200, {
        repository: result.repository,
        myRole: result.myRole,
        labels: result.labels,
        issues: result.issues,
      });
      return true;
    }

    if (params && method === "POST") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.createIssue(account.username, params.owner, params.name, body);
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { issue: result.issue });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number");
    if (params && method === "GET") {
      const account = await requireAccount();
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const result = await issues.getIssue(
        params.owner,
        params.name,
        number,
        account ? account.username : null,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.denied) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      sendJson(response, 200, {
        issue: result.issue,
        myRole: result.myRole,
        labels: result.labels,
        milestones: result.milestones,
        assignableMembers: result.assignableMembers,
      });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number/title");
    if (params && method === "PATCH") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.editIssueTitle(
        account.username,
        params.owner,
        params.name,
        number,
        body,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { issue: result.issue });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number/description");
    if (params && method === "PATCH") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.editIssueDescription(
        account.username,
        params.owner,
        params.name,
        number,
        body,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { issue: result.issue });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number/assignees");
    if (params && method === "PATCH") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.toggleAssignee(
        account.username,
        params.owner,
        params.name,
        number,
        body,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { issue: result.issue });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number/labels");
    if (params && method === "PATCH") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.toggleLabel(
        account.username,
        params.owner,
        params.name,
        number,
        body,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { issue: result.issue });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number/milestone");
    if (params && method === "PATCH") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.setMilestone(
        account.username,
        params.owner,
        params.name,
        number,
        body,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { issue: result.issue });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number/status");
    if (params && method === "PATCH") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.setIssueStatus(
        account.username,
        params.owner,
        params.name,
        number,
        body,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { issue: result.issue });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number/comments");
    if (params && method === "POST") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.addComment(
        account.username,
        params.owner,
        params.name,
        number,
        body,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { comment: result.comment });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/issues/:number/reactions");
    if (params && method === "POST") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const body = await readBody(request);
      const result = await issues.toggleReaction(
        account.username,
        params.owner,
        params.name,
        number,
        body,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, {
        reactions: result.reactions,
        added: result.added,
        reaction: result.reaction,
      });
      return true;
    }

    return false;
  }

  return { handle };
}
