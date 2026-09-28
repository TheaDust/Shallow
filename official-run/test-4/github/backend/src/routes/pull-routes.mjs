import { canReadRepository, effectiveRepositoryRole } from "../domain/organizations.mjs";
import {
  addInlineComment,
  removeReviewerRequest,
  requestReviewer,
  submitReview,
} from "../domain/pull-review.mjs";
import {
  canCreatePullRequest,
  canUpdatePullRequestChecks,
  closePullRequest,
  createPullRequest,
  findPullRequestByNumber,
  listRepositoryPullRequests,
  markPullRequestReadyForReview,
  mergePullRequest,
  protectionRulesFor,
  pullRequestDetail,
  reopenPullRequest,
  setPullRequestCheck,
  syncPullRequestsToBranches,
  upsertProtectionRule,
} from "../domain/pulls.mjs";
import { compareBranches } from "../domain/vcs.mjs";
import { readJson, sendJson } from "../lib/http.mjs";

/**
 * REQ-6 pull-request routes shared by personal and organization repositories:
 * the Pull requests list, branch comparison for creation, pull-request
 * creation, the detail page (including the Checks area), and the branch
 * protection rules under Settings → Branches. Every route resolves the
 * repository through `deps.resolveRepository`, enforces repository-read
 * permission against the current session, and validates the operation-specific
 * role before any write.
 */
export async function handlePullRoutes({
  request,
  response,
  url,
  path,
  state,
  store,
  account,
  resolveRepository,
}) {
  const listRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls$/);
  if (listRoute) {
    const repository = resolveRepository(
      state,
      listRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(listRoute[2]),
      decodeURIComponent(listRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canReadRepository(state, account?.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    if (request.method === "GET") {
      const repositoryId = repository.id;
      await store.update((draft) => {
        const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
        if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      });
      const freshState = await store.read();
      const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
      sendJson(response, 200, {
        pulls: listRepositoryPullRequests(freshState, repositoryId),
        currentRole: effectiveRepositoryRole(freshState, account?.id, freshRepository),
      });
      return true;
    }
    if (request.method === "POST") {
      if (!account) {
        sendJson(response, 401, { error: "Unauthenticated" });
        return true;
      }
      const body = await readJson(request);
      const repositoryId = repository.id;
      let outcome;
      await store.update((draft) => {
        const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
        outcome = createPullRequest(draft, draftRepository, {
          accountId: account.id,
          baseBranch: body.baseBranch,
          compareBranch: body.compareBranch,
          title: body.title,
          description: body.description,
          draft: body.draft === true,
        });
      });
      if (!outcome.ok) {
        if (outcome.forbidden) {
          sendJson(response, 403, { error: "Access denied" });
        } else {
          sendJson(response, 400, { errors: outcome.errors });
        }
        return true;
      }
      const freshState = await store.read();
      const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
      const freshPull = freshState.pullRequests.find((candidate) => candidate.id === outcome.pr.id);
      sendJson(response, 201, {
        pull: pullRequestDetail(freshState, freshRepository, freshPull, account.id),
      });
      return true;
    }
    return false;
  }

  const compareRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/compare$/);
  if (compareRoute && request.method === "GET") {
    const repository = resolveRepository(
      state,
      compareRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(compareRoute[2]),
      decodeURIComponent(compareRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    if (!canCreatePullRequest(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const base = url.searchParams.get("base");
    const compare = url.searchParams.get("compare");
    if (!base || !compare) {
      sendJson(response, 400, { error: "Base and compare branches are required" });
      return true;
    }
    const result = compareBranches(state, repository, base, compare);
    if (!result) {
      sendJson(response, 404, { error: "Branch not found" });
      return true;
    }
    sendJson(response, 200, result);
    return true;
  }

  const detailRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)$/);
  if (detailRoute && request.method === "GET") {
    const repository = resolveRepository(
      state,
      detailRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(detailRoute[2]),
      decodeURIComponent(detailRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canReadRepository(state, account?.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const pull = findPullRequestByNumber(state, repository.id, detailRoute[4]);
    if (!pull) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    const repositoryId = repository.id;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
    });
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    const freshPull = freshState.pullRequests.find((candidate) => candidate.id === pull.id);
    sendJson(response, 200, {
      pull: pullRequestDetail(freshState, freshRepository, freshPull, account?.id),
    });
    return true;
  }

  const readyRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)\/ready$/,
  );
  if (readyRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      readyRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(readyRoute[2]),
      decodeURIComponent(readyRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const repositoryId = repository.id;
    const pullId = findPullRequestByNumber(state, repository.id, readyRoute[4])?.id;
    if (!pullId) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pullId);
      outcome = markPullRequestReadyForReview(draft, draftRepository, draftPull, {
        accountId: account.id,
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else if (outcome.notFound) {
        sendJson(response, 404, { error: "Pull request not found" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    const freshPull = freshState.pullRequests.find((candidate) => candidate.id === pullId);
    sendJson(response, 200, {
      pull: pullRequestDetail(freshState, freshRepository, freshPull, account.id),
    });
    return true;
  }

  const closeReopenRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)\/(close|reopen)$/,
  );
  if (closeReopenRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      closeReopenRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(closeReopenRoute[2]),
      decodeURIComponent(closeReopenRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const repositoryId = repository.id;
    const pullId = findPullRequestByNumber(state, repository.id, closeReopenRoute[4])?.id;
    if (!pullId) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pullId);
      outcome =
        closeReopenRoute[5] === "close"
          ? closePullRequest(draft, draftRepository, draftPull, { accountId: account.id })
          : reopenPullRequest(draft, draftRepository, draftPull, { accountId: account.id });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else if (outcome.notFound) {
        sendJson(response, 404, { error: "Pull request not found" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    const freshPull = freshState.pullRequests.find((candidate) => candidate.id === pullId);
    sendJson(response, 200, {
      ok: true,
      pull: pullRequestDetail(freshState, freshRepository, freshPull, account.id),
    });
    return true;
  }

  const checksRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)\/checks$/,
  );
  if (checksRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      checksRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(checksRoute[2]),
      decodeURIComponent(checksRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    if (!canUpdatePullRequestChecks(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const pull = findPullRequestByNumber(state, repository.id, checksRoute[4]);
    if (!pull) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    const body = await readJson(request);
    const repositoryId = repository.id;
    const pullId = pull.id;
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pullId);
      outcome = setPullRequestCheck(draft, draftRepository, draftPull, {
        accountId: account.id,
        name: body.name,
        status: body.status,
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else if (outcome.notFound) {
        sendJson(response, 404, { error: "Pull request not found" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    sendJson(response, 200, { ok: true, check: outcome.check });
    return true;
  }

  const commentsRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)\/comments$/,
  );
  if (commentsRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      commentsRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(commentsRoute[2]),
      decodeURIComponent(commentsRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const pull = findPullRequestByNumber(state, repository.id, commentsRoute[4]);
    if (!pull) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    const body = await readJson(request);
    const repositoryId = repository.id;
    const pullId = pull.id;
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pullId);
      outcome = addInlineComment(draft, draftRepository, draftPull, {
        accountId: account.id,
        path: body.path,
        line: body.line,
        body: body.body,
        startReview: body.startReview === true,
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else if (outcome.notFound) {
        sendJson(response, 404, { error: "Pull request not found" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    const freshPull = freshState.pullRequests.find((candidate) => candidate.id === pullId);
    sendJson(response, 201, {
      ok: true,
      pull: pullRequestDetail(freshState, freshRepository, freshPull, account.id),
    });
    return true;
  }

  const reviewsRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)\/reviews$/,
  );
  if (reviewsRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      reviewsRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(reviewsRoute[2]),
      decodeURIComponent(reviewsRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const pull = findPullRequestByNumber(state, repository.id, reviewsRoute[4]);
    if (!pull) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    const body = await readJson(request);
    const repositoryId = repository.id;
    const pullId = pull.id;
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pullId);
      outcome = submitReview(draft, draftRepository, draftPull, {
        accountId: account.id,
        decision: body.decision,
        explanation: body.explanation,
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else if (outcome.notFound) {
        sendJson(response, 404, { error: "Pull request not found" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    const freshPull = freshState.pullRequests.find((candidate) => candidate.id === pullId);
    sendJson(response, 201, {
      ok: true,
      pull: pullRequestDetail(freshState, freshRepository, freshPull, account.id),
    });
    return true;
  }

  const reviewersRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)\/reviewers$/,
  );
  if (reviewersRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      reviewersRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(reviewersRoute[2]),
      decodeURIComponent(reviewersRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const pull = findPullRequestByNumber(state, repository.id, reviewersRoute[4]);
    if (!pull) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    const body = await readJson(request);
    const repositoryId = repository.id;
    const pullId = pull.id;
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pullId);
      outcome = requestReviewer(draft, draftRepository, draftPull, {
        accountId: account.id,
        username: body.username,
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else if (outcome.notFound) {
        sendJson(response, 404, { error: "Pull request not found" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    const freshPull = freshState.pullRequests.find((candidate) => candidate.id === pullId);
    sendJson(response, 200, {
      ok: true,
      pull: pullRequestDetail(freshState, freshRepository, freshPull, account.id),
    });
    return true;
  }

  const reviewerDeleteRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)\/reviewers\/([^/]+)$/,
  );
  if (reviewerDeleteRoute && request.method === "DELETE") {
    const repository = resolveRepository(
      state,
      reviewerDeleteRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(reviewerDeleteRoute[2]),
      decodeURIComponent(reviewerDeleteRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const pull = findPullRequestByNumber(state, repository.id, reviewerDeleteRoute[4]);
    if (!pull) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    const repositoryId = repository.id;
    const pullId = pull.id;
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pullId);
      outcome = removeReviewerRequest(draft, draftRepository, draftPull, {
        accountId: account.id,
        username: decodeURIComponent(reviewerDeleteRoute[5]),
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else if (outcome.notFound) {
        sendJson(response, 404, { error: "Pull request not found" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    const freshPull = freshState.pullRequests.find((candidate) => candidate.id === pullId);
    sendJson(response, 200, {
      ok: true,
      pull: pullRequestDetail(freshState, freshRepository, freshPull, account.id),
    });
    return true;
  }

  const mergeRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)\/merge$/,
  );
  if (mergeRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      mergeRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(mergeRoute[2]),
      decodeURIComponent(mergeRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const pull = findPullRequestByNumber(state, repository.id, mergeRoute[4]);
    if (!pull) {
      sendJson(response, 404, { error: "Pull request not found" });
      return true;
    }
    const repositoryId = repository.id;
    const pullId = pull.id;
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      if (draftRepository) syncPullRequestsToBranches(draft, draftRepository);
      const draftPull = draft.pullRequests.find((candidate) => candidate.id === pullId);
      outcome = mergePullRequest(draft, draftRepository, draftPull, {
        accountId: account.id,
        authorName: account.username,
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else if (outcome.notFound) {
        sendJson(response, 404, { error: "Pull request not found" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    const freshPull = freshState.pullRequests.find((candidate) => candidate.id === pullId);
    sendJson(response, 200, {
      ok: true,
      pull: pullRequestDetail(freshState, freshRepository, freshPull, account.id),
    });
    return true;
  }

  const rulesRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/protection-rules$/);
  if (rulesRoute) {
    const repository = resolveRepository(
      state,
      rulesRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(rulesRoute[2]),
      decodeURIComponent(rulesRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canReadRepository(state, account?.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    if (request.method === "GET") {
      sendJson(response, 200, {
        rules: protectionRulesFor(state, repository.id),
        currentRole: effectiveRepositoryRole(state, account?.id, repository),
      });
      return true;
    }
    if (request.method === "POST") {
      if (!account) {
        sendJson(response, 401, { error: "Unauthenticated" });
        return true;
      }
      if (effectiveRepositoryRole(state, account.id, repository) !== "admin") {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      const body = await readJson(request);
      const repositoryId = repository.id;
      let outcome;
      await store.update((draft) => {
        const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
        outcome = upsertProtectionRule(draft, draftRepository, {
          accountId: account.id,
          branch: body.branch,
          requireApproval: body.requireApproval,
          requireStatusCheck: body.requireStatusCheck,
        });
      });
      if (!outcome.ok) {
        if (outcome.forbidden) {
          sendJson(response, 403, { error: "Access denied" });
        } else {
          sendJson(response, 400, { errors: outcome.errors });
        }
        return true;
      }
      const freshState = await store.read();
      sendJson(response, 200, {
        ok: true,
        rules: protectionRulesFor(freshState, repositoryId),
      });
      return true;
    }
    return false;
  }

  return false;
}
