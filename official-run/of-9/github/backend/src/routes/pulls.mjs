// HTTP routes for the pull-request domain. Each handler returns `true` when it
// matched the request path so the main API dispatcher can stop; unknown paths
// fall through to the regular 404 handling.

export function createPullRoutes({ matchPath, readBody, sendJson, requireAccount, pulls }) {
  async function handle(request, response, url) {
    const path = url.pathname;
    const method = request.method;

    // --- Pull request list and creation ---

    let params = matchPath(path, "/api/repositories/:owner/:name/pulls");
    if (params && method === "GET") {
      const account = await requireAccount();
      const result = await pulls.listPullRequests(
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
        pulls: result.pulls,
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
      const result = await pulls.createPullRequest(
        account.username,
        params.owner,
        params.name,
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
      sendJson(response, 200, { pull: result.pull });
      return true;
    }

    // --- Comparison data for the creation flow (Write and above only) ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/comparison");
    if (params && method === "GET") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const result = await pulls.getComparisonData(
        params.owner,
        params.name,
        { base: url.searchParams.get("base") ?? "", compare: url.searchParams.get("compare") ?? "" },
        account.username,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.denied) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      sendJson(response, 200, result);
      return true;
    }

    // --- PR detail ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number");
    if (params && method === "GET") {
      const account = await requireAccount();
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const result = await pulls.getPullRequest(
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
        pull: result.pull,
        myRole: result.myRole,
        branches: result.branches,
        commits: result.commits,
        files: result.files,
        eligibleReviewers: result.eligibleReviewers,
        mergeEligibility: result.mergeEligibility,
      });
      return true;
    }

    // --- Status transitions (close / reopen) ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number/status");
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
      const result = await pulls.setPullRequestStatus(
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
      sendJson(response, 200, { pull: result.pull });
      return true;
    }

    // --- Ready for review (author / Maintain / Admin / Owner) ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number/ready-for-review");
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
      const result = await pulls.readyForReview(
        account.username,
        params.owner,
        params.name,
        number,
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
      sendJson(response, 200, { pull: result.pull });
      return true;
    }

    // --- Inline review comments (Write / Maintain / Admin, not the author) ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number/inline-comments");
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
      const result = await pulls.addInlineComment(
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

    // --- Reviewers (request / remove) ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number/reviewers");
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
      const result = await pulls.requestReviewer(
        account.username,
        params.owner,
        params.name,
        number,
        body.username,
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
      sendJson(response, 200, { pull: result.pull });
      return true;
    }

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number/reviewers/:username");
    if (params && method === "DELETE") {
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
      const result = await pulls.removeReviewer(
        account.username,
        params.owner,
        params.name,
        number,
        params.username,
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
      sendJson(response, 200, { pull: result.pull });
      return true;
    }

    // --- Review submission (Write / Maintain / Admin, not the author, Open only) ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number/reviews");
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
      const result = await pulls.submitPullRequestReview(
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
      sendJson(response, 200, { review: result.review, pull: result.pull });
      return true;
    }

    // --- Checks area (Admin only) ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number/checks");
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
      const result = await pulls.updatePullRequestCheck(
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
      sendJson(response, 200, { checks: result.checks, commitId: result.commitId });
      return true;
    }

    // --- Merge (Maintain/Admin/Owner only) ---

    params = matchPath(path, "/api/repositories/:owner/:name/pulls/:number/merge");
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
      const result = await pulls.mergePullRequest(
        account.username,
        params.owner,
        params.name,
        number,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      if (result.blocked) {
        sendJson(response, 422, { reasons: result.reasons });
        return true;
      }
      if (!result.ok) {
        sendJson(response, 422, { errors: result.errors });
        return true;
      }
      sendJson(response, 200, { pull: result.pull, commit: result.commit });
      return true;
    }

    // --- Branch protection rules (Admin only) ---

    params = matchPath(path, "/api/repositories/:owner/:name/protection-rules");
    if (params && method === "GET") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const result = await pulls.listProtectionRules(
        params.owner,
        params.name,
        account.username,
      );
      if (result.notFound) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (result.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      sendJson(response, 200, { rules: result.rules });
      return true;
    }

    if (params && method === "POST") {
      const account = await requireAccount();
      if (!account) {
        sendJson(response, 401, { error: "Unauthorized" });
        return true;
      }
      const body = await readBody(request);
      const result = await pulls.setProtectionRule(
        account.username,
        params.owner,
        params.name,
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
      sendJson(response, 200, { rule: result.rule });
      return true;
    }

    return false;
  }

  return { handle };
}
