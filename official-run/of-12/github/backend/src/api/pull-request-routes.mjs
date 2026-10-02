import { asString, readJson, sendJson } from "../lib/http.mjs";
import {
  BRANCH_PROTECTION_MESSAGES,
  protectionRuleSummary,
  repositoryProtectionRules,
} from "../domain/branch-protection.mjs";
import { saveBranchProtectionRule } from "../domain/branch-protection-writes.mjs";
import {
  canCreatePullRequest,
  findRepositoryPullRequest,
  PULL_REQUEST_MESSAGES,
  pullRequestDetail,
  repositoryPullRequestSummaries,
} from "../domain/pull-requests.mjs";
import {
  changePullRequestStatus,
  createPullRequest,
  markPullRequestReadyForReview,
  mergePullRequest,
  updatePullRequestCheck,
} from "../domain/pull-request-writes.mjs";
import {
  removePullRequestReviewer,
  requestPullRequestReviewer,
} from "../domain/pull-request-reviewers.mjs";
import {
  createPullRequestReviewComment,
  submitPullRequestReview,
} from "../domain/pull-request-reviews.mjs";
import {
  canReadRepository,
  effectiveRepositoryRole,
  repositorySummary,
} from "../domain/repository-access.mjs";
import { REPOSITORY_ACCESS_MESSAGES } from "../domain/repository-grants.mjs";

/**
 * HTTP surface of the pull-request review and merge control (REQ-6, REQ-6-1):
 * the Pull requests page and the detail page of one pull request, the Checks
 * area attached to the current compare commit, the branch protection rules of
 * Settings → Branches and the merge of a pull request.
 *
 * Every route resolves the repository already, so this module only decides
 * whether the addressed sub-resource belongs to it. A read needs read
 * permission on the repository; every write checks its own role inside the
 * atomic update of the domain layer and answers with the refreshed payload, so
 * the page never shows a change the server did not store.
 *
 * @param {object} options
 * @param {{ read(): Promise<object> }} options.store
 * @param {(response, repositoryId, accountId, status) => Promise<void>} options.sendRepositoryOverview
 */
export function createPullRequestApi({ store, sendRepositoryOverview }) {
  /** The detail payload of one pull request, shared by the read and every write. */
  function pullDetailPayload(data, repository, pullRequest, account) {
    return {
      repository: repositorySummary(data, repository),
      viewerRole: effectiveRepositoryRole(data, repository, account?.id ?? null),
      pullRequest: pullRequestDetail(data, repository, pullRequest, account?.id ?? null),
    };
  }

  /** GET /api/repositories/:owner/:repo/pulls — the rows of the Pull requests page. */
  function handlePullList(response, data, repository, account) {
    sendJson(response, 200, {
      repository: repositorySummary(data, repository),
      viewerRole: effectiveRepositoryRole(data, repository, account?.id ?? null),
      // Only Write, Maintain, Admin or an organization Owner may open a new
      // pull request, so the page only offers that entry to them (REQ-6-2-2).
      canCreatePullRequest: canCreatePullRequest(data, repository, account?.id ?? null),
      pullRequests: repositoryPullRequestSummaries(data, repository),
    });
  }

  /**
   * POST /api/repositories/:owner/:repo/pulls — the creation of a pull request
   * from a valid branch comparison (REQ-6-2-3, REQ-6-2-4). The comparison and
   * the creation are both validated inside the atomic update of the domain
   * layer, so a refused creation stores nothing.
   */
  async function handlePullCreate(request, response, repository, account) {
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.createSignInRequired });
      return;
    }
    const body = await readJson(request);
    const result = await createPullRequest(store, repository.id, account.id, {
      title: asString(body.title),
      description: asString(body.description),
      base: asString(body.base),
      compare: asString(body.compare),
      draft: body.draft === true,
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.createForbidden });
        return;
      }
      if (result.unauthorized) {
        sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.createSignInRequired });
        return;
      }
      if (result.errors) {
        const message = Object.values(result.errors)[0] ?? PULL_REQUEST_MESSAGES.createFailed;
        sendJson(response, 400, {
          error: message,
          fields: result.errors,
          ...(result.number === undefined ? {} : { number: result.number }),
        });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    // The refreshed detail is answered, so the page can open the new pull
    // request by the number the server stored.
    await respondWithPull(response, repository.id, result.number, account.id, 201);
  }

  /**
   * POST .../pulls/:number/ready — the author or a maintainer moves a draft to
   * Open (REQ-6-2-4). The same pull request keeps its number, title, branches
   * and commits and gains one activity record; a rejected request changes
   * nothing.
   */
  async function handleReady(request, response, repository, account, numberSegment) {
    const number = Number.parseInt(String(numberSegment ?? ""), 10);
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.readySignInRequired });
      return;
    }
    const result = await markPullRequestReadyForReview(store, repository.id, number, account.id);
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.readyForbidden });
        return;
      }
      if (result.notDraft) {
        sendJson(response, 400, { error: PULL_REQUEST_MESSAGES.readyNotDraft });
        return;
      }
      if (result.pullRequestMissing) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    await respondWithPull(response, repository.id, number, account.id, 200);
  }

  /** GET /api/repositories/:owner/:repo/pulls/:number — one complete pull request. */
  function handlePullDetail(response, data, repository, account, numberSegment) {
    const pullRequest = findRepositoryPullRequest(data, repository, numberSegment);
    if (!pullRequest) {
      sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
      return;
    }
    sendJson(response, 200, pullDetailPayload(data, repository, pullRequest, account));
  }

  /** The refreshed pull request payload after a write, or a 404 when it vanished. */
  async function respondWithPull(response, repositoryId, number, accountId, status) {
    const refreshed = await store.read();
    const repository = refreshed.repositories.find((candidate) => candidate.id === repositoryId);
    const account = (refreshed.accounts ?? []).find((candidate) => candidate.id === accountId) ?? null;
    const pullRequest = repository ? findRepositoryPullRequest(refreshed, repository, number) : null;
    if (!repository || !pullRequest) {
      sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
      return;
    }
    sendJson(response, status, pullDetailPayload(refreshed, repository, pullRequest, account));
  }

  /** GET .../protection-rules — the stored rules of the repository (REQ-6-1). */
  function handleProtectionRuleList(response, data, repository, account) {
    const viewerRole = effectiveRepositoryRole(data, repository, account?.id ?? null);
    sendJson(response, 200, {
      repository: repositorySummary(data, repository),
      viewerRole,
      canManage: viewerRole === "Admin",
      protectionRules: repositoryProtectionRules(repository).map(protectionRuleSummary),
    });
  }

  /**
   * POST .../protection-rules — create or update the rule of one exact branch
   * name (REQ-6-1). Only a repository Admin may save it; a non-Admin request is
   * refused and no rule is stored.
   */
  async function handleProtectionRuleSave(request, response, repository, account) {
    if (!account) {
      sendJson(response, 401, { error: BRANCH_PROTECTION_MESSAGES.signInRequired });
      return;
    }
    const body = await readJson(request);
    const result = await saveBranchProtectionRule(store, repository.id, account.id, {
      pattern: asString(body.pattern),
      requireApproval: body.requireApproval === true,
      requireStatusCheck: body.requireStatusCheck === true,
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: BRANCH_PROTECTION_MESSAGES.forbidden });
        return;
      }
      if (result.missing) {
        sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
        return;
      }
      const message = Object.values(result.errors ?? {})[0] ?? BRANCH_PROTECTION_MESSAGES.saveFailed;
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return;
    }
    // The refreshed overview carries the stored rules, so the settings page
    // spells the saved branch name and its requirements without a second read.
    await sendRepositoryOverview(response, repository.id, account.id, result.created ? 201 : 200);
  }

  /**
   * POST .../pulls/:number/checks — the Checks area of the pull request detail
   * page (REQ-6-1). Only a repository Admin may store the `test` status of the
   * current compare commit; the answer carries the refreshed detail, so the
   * setter and the time are displayed from the stored record.
   */
  async function handleCheckWrite(request, response, repository, account, numberSegment) {
    const number = Number.parseInt(String(numberSegment ?? ""), 10);
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.checkSignInRequired });
      return;
    }
    const body = await readJson(request);
    const result = await updatePullRequestCheck(store, repository.id, number, account.id, {
      name: asString(body.name),
      status: asString(body.status),
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.checkForbidden });
        return;
      }
      if (result.pullRequestMissing) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
        return;
      }
      if (result.errors) {
        const message = Object.values(result.errors)[0] ?? PULL_REQUEST_MESSAGES.checkFailed;
        sendJson(response, 400, { error: message, fields: result.errors });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    await respondWithPull(response, repository.id, number, account.id, 200);
  }

  /**
   * POST .../pulls/:number/merge — merge the compare branch into the base branch
   * (REQ-6). Only Maintain, Admin or an organization Owner may merge, and the
   * rule bound to the base branch has to be satisfied; a blocked merge changes
   * no branch and no pull request state.
   */
  async function handleMerge(request, response, repository, account, numberSegment) {
    const number = Number.parseInt(String(numberSegment ?? ""), 10);
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.mergeSignInRequired });
      return;
    }
    const result = await mergePullRequest(store, repository.id, number, account.id);
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.mergeForbidden });
        return;
      }
      if (result.pullRequestMissing) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
        return;
      }
      if (result.blocked) {
        sendJson(response, 400, {
          error: PULL_REQUEST_MESSAGES.mergeFailed,
          blockers: result.merge?.blockers ?? [],
        });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    await respondWithPull(response, repository.id, number, account.id, 200);
  }

  /**
   * POST .../pulls/:number/reviewers — one pending-review relationship with an
   * eligible account (REQ-6-4). The author or a maintainer of an Open or Draft
   * pull request stores it; the answer carries the refreshed detail, so the
   * Reviewers area reads the stored request instead of an optimistic copy.
   */
  async function handleReviewerRequest(request, response, repository, account, numberSegment) {
    const number = Number.parseInt(String(numberSegment ?? ""), 10);
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.reviewerSignInRequired });
      return;
    }
    const body = await readJson(request);
    const result = await requestPullRequestReviewer(store, repository.id, number, account.id, {
      username: asString(body.username),
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.reviewerForbidden });
        return;
      }
      if (result.notOpen) {
        sendJson(response, 400, { error: PULL_REQUEST_MESSAGES.reviewerNotOpen });
        return;
      }
      if (result.pullRequestMissing) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
        return;
      }
      if (result.errors) {
        const message = Object.values(result.errors)[0] ?? PULL_REQUEST_MESSAGES.reviewerFailed;
        sendJson(response, 400, { error: message, fields: result.errors });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    await respondWithPull(response, repository.id, number, account.id, result.created ? 201 : 200);
  }

  /**
   * DELETE .../pulls/:number/reviewers/:username — deletes one pending-review
   * relationship (REQ-6-4) without touching the reviews, comments or activity
   * records of that account. The answer is the refreshed detail.
   */
  async function handleReviewerRemove(request, response, repository, account, numberSegment, username) {
    const number = Number.parseInt(String(numberSegment ?? ""), 10);
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.reviewerSignInRequired });
      return;
    }
    const result = await removePullRequestReviewer(store, repository.id, number, account.id, username);
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.reviewerForbidden });
        return;
      }
      if (result.notOpen) {
        sendJson(response, 400, { error: PULL_REQUEST_MESSAGES.reviewerNotOpen });
        return;
      }
      if (result.notFound) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.reviewerUnknown });
        return;
      }
      if (result.pullRequestMissing) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    await respondWithPull(response, repository.id, number, account.id, 200);
  }

  /**
   * POST .../pulls/:number/close | /reopen — the unmerged status transition of
   * REQ-6-6. The author, a Maintain, an Admin or an organization Owner closes
   * an Open or Draft pull request and reopens a Closed one; Merged is terminal,
   * and a refusal changes neither the status nor a branch.
   */
  async function handleStatusChange(request, response, repository, account, numberSegment, action) {
    const number = Number.parseInt(String(numberSegment ?? ""), 10);
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.statusSignInRequired });
      return;
    }
    const result = await changePullRequestStatus(store, repository.id, number, account.id, action);
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.statusForbidden });
        return;
      }
      if (result.notAllowed) {
        sendJson(response, 400, {
          error: action === "reopen"
            ? PULL_REQUEST_MESSAGES.statusReopenNotAllowed
            : PULL_REQUEST_MESSAGES.statusCloseNotAllowed,
        });
        return;
      }
      if (result.pullRequestMissing) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    await respondWithPull(response, repository.id, number, account.id, 200);
  }

  /**
   * POST .../pulls/:number/comments — one inline review comment on a changed
   * line of Files changed (REQ-6-3-3). Only a non-author Write, Maintain or
   * Admin may comment on an open pull request; `pending` keeps the body as a
   * draft of `Start a review` that is not public yet. The answer carries the
   * refreshed detail, so the diff and Conversation read the stored record.
   */
  async function handleCommentWrite(request, response, repository, account, numberSegment) {
    const number = Number.parseInt(String(numberSegment ?? ""), 10);
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.commentSignInRequired });
      return;
    }
    const body = await readJson(request);
    const result = await createPullRequestReviewComment(store, repository.id, number, account.id, {
      filePath: asString(body.filePath),
      line: body.line,
      side: asString(body.side),
      body: asString(body.body),
      pending: body.pending === true,
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.commentForbidden });
        return;
      }
      if (result.notOpen) {
        sendJson(response, 400, { error: PULL_REQUEST_MESSAGES.commentNotOpen });
        return;
      }
      if (result.pullRequestMissing) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
        return;
      }
      if (result.errors) {
        const message = Object.values(result.errors)[0] ?? PULL_REQUEST_MESSAGES.commentFailed;
        sendJson(response, 400, { error: message, fields: result.errors });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    await respondWithPull(response, repository.id, number, account.id, 201);
  }

  /**
   * POST .../pulls/:number/reviews — one review decision of the current compare
   * commit (REQ-6-3-4). The reviewer, the decision, the optional summary, the
   * time and the pending comments submitted with the review are stored in one
   * atomic update; a refused review stores nothing.
   */
  async function handleReviewWrite(request, response, repository, account, numberSegment) {
    const number = Number.parseInt(String(numberSegment ?? ""), 10);
    if (!account) {
      sendJson(response, 401, { error: PULL_REQUEST_MESSAGES.reviewSignInRequired });
      return;
    }
    const body = await readJson(request);
    const result = await submitPullRequestReview(store, repository.id, number, account.id, {
      decision: asString(body.decision),
      summary: asString(body.summary),
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: PULL_REQUEST_MESSAGES.reviewForbidden });
        return;
      }
      if (result.notOpen) {
        sendJson(response, 400, { error: PULL_REQUEST_MESSAGES.reviewNotOpen });
        return;
      }
      if (result.pullRequestMissing) {
        sendJson(response, 404, { error: PULL_REQUEST_MESSAGES.notFound });
        return;
      }
      if (result.errors) {
        const message = Object.values(result.errors)[0] ?? PULL_REQUEST_MESSAGES.reviewFailed;
        sendJson(response, 400, { error: message, fields: result.errors });
        return;
      }
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    await respondWithPull(response, repository.id, number, account.id, 201);
  }

  /**
   * Returns true when the request addressed a pull-request sub-resource of this
   * repository and was answered here.
   */
  return async function handlePullRequestRequest(request, response, { data, repository, account, rest, method }) {
    if (rest[0] !== "pulls" && rest[0] !== "protection-rules") return false;

    if (rest.length === 1 && rest[0] === "protection-rules") {
      if (method === "GET") {
        if (!canReadRepository(data, repository, account?.id ?? null)) {
          sendJson(response, 403, { error: "Access denied" });
          return true;
        }
        handleProtectionRuleList(response, data, repository, account);
        return true;
      }
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        await handleProtectionRuleSave(request, response, repository, account);
        return true;
      }
      sendJson(response, 404, { error: "Not found" });
      return true;
    }

    if (rest.length === 3 && rest[0] === "pulls" && rest[2] === "comments"
      && (method === "POST" || method === "PUT" || method === "PATCH")) {
      await handleCommentWrite(request, response, repository, account, rest[1]);
      return true;
    }

    if (rest.length === 3 && rest[0] === "pulls" && rest[2] === "reviews"
      && (method === "POST" || method === "PUT" || method === "PATCH")) {
      await handleReviewWrite(request, response, repository, account, rest[1]);
      return true;
    }

    if (rest.length === 3 && rest[0] === "pulls" && rest[2] === "reviewers"
      && (method === "POST" || method === "PUT")) {
      await handleReviewerRequest(request, response, repository, account, rest[1]);
      return true;
    }

    if (rest.length === 4 && rest[0] === "pulls" && rest[2] === "reviewers" && method === "DELETE") {
      await handleReviewerRemove(request, response, repository, account, rest[1], rest[3]);
      return true;
    }

    if (rest.length === 3 && rest[0] === "pulls" && (rest[2] === "close" || rest[2] === "reopen")
      && (method === "POST" || method === "PUT")) {
      await handleStatusChange(request, response, repository, account, rest[1], rest[2]);
      return true;
    }

    if (rest.length === 3 && rest[0] === "pulls" && rest[2] === "checks"
      && (method === "POST" || method === "PUT" || method === "PATCH")) {
      await handleCheckWrite(request, response, repository, account, rest[1]);
      return true;
    }

    if (rest.length === 3 && rest[0] === "pulls" && rest[2] === "merge"
      && (method === "POST" || method === "PUT")) {
      await handleMerge(request, response, repository, account, rest[1]);
      return true;
    }

    if (rest.length === 3 && rest[0] === "pulls" && rest[2] === "ready"
      && (method === "POST" || method === "PUT")) {
      await handleReady(request, response, repository, account, rest[1]);
      return true;
    }

    if (rest.length === 1 && rest[0] === "pulls" && method === "POST") {
      await handlePullCreate(request, response, repository, account);
      return true;
    }

    if (rest[0] !== "pulls" || rest.length > 2) return false;

    if (method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canReadRepository(data, repository, account?.id ?? null)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    if (rest.length === 1) handlePullList(response, data, repository, account);
    else handlePullDetail(response, data, repository, account, rest[1]);
    return true;
  };
}
