// HTTP surface of the pull-request views (REQ-6): the repository-scoped list,
// the branch comparison, creation, one detail view with its conversation,
// commits, files and checks, the status transitions and the status-check
// update.
//
// Every read re-applies the shared repository read rule, so a pull request of a
// private repository is never exposed to a caller without permission. The
// operations are checked per operation against the stored grants rather than
// trusted from the UI: creating a pull request needs the write rule (Write,
// Maintain, Admin or organization Owner), the status transitions additionally
// accept the author, and setting a status check needs the repository
// administrator rule (Admin or organization Owner).

import { readJson, sendJson } from "./http.mjs";
import { ISSUE_MESSAGES } from "./issue-rules.mjs";
import { ORG_MESSAGES } from "./org-rules.mjs";
import {
  MERGE_MESSAGES,
  PULL_MESSAGES,
  isValidCheckStatus,
  isValidPullTransition,
  isValidReviewDecision,
  validatePullDescription,
  validatePullTitle,
  validateReviewComment,
  validateReviewSummary,
} from "./pull-request-rules.mjs";
import { publicRepository } from "./org-store.mjs";

const REPOSITORIES_PREFIX = "/api/repositories/";
const PULLS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls$/;
const PULL_COMPARE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/compare$/;
const PULL_STATUS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/status$/;
const PULL_CHECKS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/checks$/;
const PULL_COMMENTS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments$/;
const PULL_MERGE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/;
const PULL_REVIEWS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/;
const PULL_REVIEWERS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviewers$/;
const PULL_REVIEWER_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviewers\/([^/]+)$/;
const PULL_MILESTONE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/milestone$/;
const PULL_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/;

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readBody(request) {
  return readJson(request).catch(() => ({}));
}

export function createPullRequestRoutes({ store, orgStore, findRepository, describeOwner, currentUser }) {
  async function readableRepository(response, owner, name, user) {
    const repository = await findRepository(decodeSegment(owner), decodeSegment(name));
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return null;
    }
    if (!(await orgStore.canReadRepository(repository, user?.id ?? null))) {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return null;
    }
    return repository;
  }

  async function withOwner(repository) {
    return {
      ...publicRepository(repository),
      owner: await describeOwner(repository.ownerType, repository.ownerId),
    };
  }

  /** One pull-request view plus the caller's operation-specific permissions. */
  async function pullView(repository, detail, user) {
    const canWrite = await orgStore.canWriteRepository(repository, user?.id ?? null);
    const canMaintain = await orgStore.canMaintainRepository(repository, user?.id ?? null);
    const canManage = await orgStore.canManageRepository(repository, user?.id ?? null);
    // Reviewing needs a signed-in non-author with the write rule on an Open PR;
    // the UI only mirrors this flag.
    const canReview =
      Boolean(user) &&
      canWrite &&
      detail.pullRequest.status === "open" &&
      detail.pullRequest.author !== user.username;
    // The author or a Maintain/Admin/Owner manages the pending reviewer
    // requests (REQ-6-4).
    const canManageReviewers =
      Boolean(user) && (detail.pullRequest.author === user.username || canMaintain);
    const memberIds = await orgStore.listRepositoryMemberAccountIds(repository.id);
    const memberAccounts = await store.findAccountsByIds(memberIds);
    const availableReviewers = memberAccounts
      .map((account) => account.username)
      .filter((username) => username !== detail.pullRequest.author)
      .sort((left, right) => left.localeCompare(right));
    return {
      repository: await withOwner(repository),
      ...detail,
      availableReviewers,
      availableMilestones: await orgStore.listRepositoryMilestones(repository.id),
      canWrite,
      canMaintain,
      canManage,
      canTriage: await orgStore.canTriageRepository(repository, user?.id ?? null),
      canReview,
      canManageReviewers,
    };
  }

  return async function handlePullRequests(request, response, url, method) {
    const { pathname } = url;
    if (!pathname.startsWith(REPOSITORIES_PREFIX)) return false;

    const pullsMatch = pathname.match(PULLS_PATH);
    const compareMatch = pathname.match(PULL_COMPARE_PATH);
    const statusMatch = pathname.match(PULL_STATUS_PATH);
    const checksMatch = pathname.match(PULL_CHECKS_PATH);
    const commentsMatch = pathname.match(PULL_COMMENTS_PATH);
    const mergeMatch = pathname.match(PULL_MERGE_PATH);
    const reviewsMatch = pathname.match(PULL_REVIEWS_PATH);
    const reviewersMatch = pathname.match(PULL_REVIEWERS_PATH);
    const reviewerMatch = pathname.match(PULL_REVIEWER_PATH);
    const milestoneMatch = pathname.match(PULL_MILESTONE_PATH);
    const pullMatch =
      compareMatch ||
      statusMatch ||
      checksMatch ||
      commentsMatch ||
      mergeMatch ||
      reviewsMatch ||
      reviewersMatch ||
      reviewerMatch ||
      milestoneMatch
        ? null
        : pathname.match(PULL_PATH);
    const match =
      pullsMatch ??
      compareMatch ??
      statusMatch ??
      checksMatch ??
      commentsMatch ??
      mergeMatch ??
      reviewsMatch ??
      reviewersMatch ??
      reviewerMatch ??
      milestoneMatch ??
      pullMatch;
    if (!match) return false;

    const user = await currentUser(request);
    const repository = await readableRepository(response, match[1], match[2], user);
    if (!repository) return true;

    // GET .../pulls — the persisted pull requests of this repository.
    if (pullsMatch && method === "GET") {
      sendJson(response, 200, {
        repository: await withOwner(repository),
        pullRequests: await orgStore.listPullRequests(repository.id),
        canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
        canMaintain: await orgStore.canMaintainRepository(repository, user?.id ?? null),
        canManage: await orgStore.canManageRepository(repository, user?.id ?? null),
      });
      return true;
    }

    // POST .../pulls — one Open (or Draft) proposal from a valid comparison.
    if (pullsMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canWriteRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const title = typeof body.title === "string" ? body.title : "";
      const description = typeof body.description === "string" ? body.description : "";
      const base = (typeof body.base === "string" ? body.base : "").trim();
      const compare = (typeof body.compare === "string" ? body.compare : "").trim();
      const draft = body.draft === true;

      const fieldErrors = {};
      const titleResult = validatePullTitle(title);
      if (titleResult === "required") fieldErrors.title = PULL_MESSAGES.titleRequired;
      if (titleResult === "too-long") fieldErrors.title = PULL_MESSAGES.titleTooLong;
      if (!validatePullDescription(description)) {
        fieldErrors.description = PULL_MESSAGES.descriptionTooLong;
      }
      if (!base || !compare) fieldErrors.compare = PULL_MESSAGES.branchMissing;
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      const created = await orgStore.createPullRequest({
        repositoryId: repository.id,
        title: title.trim(),
        description,
        sourceBranch: compare,
        targetBranch: base,
        draft,
        authorName: user.username,
        authorAccountId: user.id,
      });
      if (!created.ok) {
        const message =
          created.reason === "identical"
            ? PULL_MESSAGES.identical
            : PULL_MESSAGES.branchMissing;
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { compare: message },
        });
        return true;
      }
      const detail = await orgStore.getPullRequest(repository.id, created.number);
      sendJson(response, 201, await pullView(repository, detail, user));
      return true;
    }

    // GET .../pulls/compare — the commits and the per-file differences between
    // two branches; the request never writes to the repository.
    if (compareMatch && method === "GET") {
      const comparison = await orgStore.compareBranches(repository.id, {
        base: (url.searchParams.get("base") ?? "").trim(),
        compare: (url.searchParams.get("compare") ?? "").trim(),
      });
      if (!comparison) {
        sendJson(response, 404, { message: PULL_MESSAGES.branchMissing });
        return true;
      }
      sendJson(response, 200, {
        repository: await withOwner(repository),
        ...comparison,
        canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
      });
      return true;
    }

    // GET .../pulls/:number — the complete read view of one pull request.
    if (pullMatch && method === "GET") {
      const detail = await orgStore.getPullRequest(repository.id, Number(pullMatch[3]));
      if (!detail) {
        sendJson(response, 404, { message: PULL_MESSAGES.pullNotFound });
        return true;
      }
      sendJson(response, 200, await pullView(repository, detail, user));
      return true;
    }

    // PATCH .../pulls/:number/status — ready for review, close or reopen. The
    // author or a Maintain/Admin may transition it; Merged stays terminal.
    if (statusMatch && method === "PATCH") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const detail = await orgStore.getPullRequest(repository.id, Number(statusMatch[3]));
      if (!detail) {
        sendJson(response, 404, { message: PULL_MESSAGES.pullNotFound });
        return true;
      }
      const maintainer = await orgStore.canMaintainRepository(repository, user.id);
      if (detail.pullRequest.author !== user.username && !maintainer) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const status = typeof body.status === "string" ? body.status : "";
      if (!isValidPullTransition(status)) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { status: PULL_MESSAGES.statusInvalid },
        });
        return true;
      }
      const result = await orgStore.setPullRequestStatus({
        repositoryId: repository.id,
        number: Number(statusMatch[3]),
        status,
        actorName: user.username,
        actorAccountId: user.id,
      });
      if (!result.ok) {
        sendJson(response, 400, {
          message: PULL_MESSAGES.transitionInvalid,
          fieldErrors: { status: PULL_MESSAGES.transitionInvalid },
        });
        return true;
      }
      const updated = await orgStore.getPullRequest(repository.id, Number(statusMatch[3]));
      sendJson(response, 200, await pullView(repository, updated, user));
      return true;
    }

    // PATCH .../pulls/:number/checks — set one status check of the compare
    // commit (REQ-6-1). Only the repository administrator may do it, and the
    // stored status together with its setter is what the Checks area reads.
    if (checksMatch && method === "PATCH") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canManageRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const name = (typeof body.name === "string" ? body.name : "").trim();
      const status = typeof body.status === "string" ? body.status : "";
      if (!isValidCheckStatus(status)) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { status: PULL_MESSAGES.checkStatusInvalid },
        });
        return true;
      }
      const result = await orgStore.setPullRequestCheck({
        repositoryId: repository.id,
        number: Number(checksMatch[3]),
        name,
        status,
        setter: user.username,
        actorAccountId: user.id,
      });
      if (!result.ok) {
        const message =
          result.reason === "pull-missing" ? PULL_MESSAGES.pullNotFound : PULL_MESSAGES.checkMissing;
        sendJson(response, result.reason === "pull-missing" ? 404 : 400, {
          message,
          fieldErrors: { status: message },
        });
        return true;
      }
      const updated = await orgStore.getPullRequest(repository.id, Number(checksMatch[3]));
      sendJson(response, 200, await pullView(repository, updated, user));
      return true;
    }

    // POST .../pulls/:number/comments — one line comment of the current compare
    // revision (REQ-6-3-3). A non-author reviewer with the write rule comments
    // on an Open pull request; `state` publishes it immediately or keeps it as a
    // pending review comment.
    if (commentsMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const detail = await orgStore.getPullRequest(repository.id, Number(commentsMatch[3]));
      if (!detail) {
        sendJson(response, 404, { message: PULL_MESSAGES.pullNotFound });
        return true;
      }
      const canWrite = await orgStore.canWriteRepository(repository, user.id);
      const canReview =
        canWrite &&
        detail.pullRequest.status === "open" &&
        detail.pullRequest.author !== user.username;
      if (!canReview) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const rawBody = typeof body.body === "string" ? body.body : "";
      const commentCheck = validateReviewComment(rawBody);
      if (commentCheck !== "ok") {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: {
            comment:
              commentCheck === "too-long" ? PULL_MESSAGES.descriptionTooLong : PULL_MESSAGES.commentRequired,
          },
        });
        return true;
      }
      const filePath = typeof body.filePath === "string" ? body.filePath : "";
      const lineIndex = Number.isInteger(body.lineIndex) ? body.lineIndex : null;
      const state = body.state === "pending" ? "pending" : "published";
      await orgStore.addPullRequestReviewComment({
        repositoryId: repository.id,
        number: Number(commentsMatch[3]),
        body: rawBody.trim(),
        filePath,
        lineIndex,
        state,
        authorName: user.username,
        authorAccountId: user.id,
      });
      const updated = await orgStore.getPullRequest(repository.id, Number(commentsMatch[3]));
      sendJson(response, 200, await pullView(repository, updated, user));
      return true;
    }

    // POST .../pulls/:number/merge — merge the compare branch into the base
    // branch of an Open pull request (REQ-6). Only Maintain/Admin or the
    // organization Owner may merge, and Merged is terminal.
    if (mergeMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const detail = await orgStore.getPullRequest(repository.id, Number(mergeMatch[3]));
      if (!detail) {
        sendJson(response, 404, { message: PULL_MESSAGES.pullNotFound });
        return true;
      }
      if (!(await orgStore.canMaintainRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const result = await orgStore.mergePullRequest({
        repositoryId: repository.id,
        number: Number(mergeMatch[3]),
        actorName: user.username,
        actorAccountId: user.id,
      });
      if (!result.ok) {
        const message =
          result.reason === "pull-missing"
            ? PULL_MESSAGES.pullNotFound
            : result.message ?? PULL_MESSAGES.mergeNotAllowed;
        sendJson(response, result.reason === "pull-missing" ? 404 : 400, {
          message,
          fieldErrors: { status: message },
        });
        return true;
      }
      const updated = await orgStore.getPullRequest(repository.id, Number(mergeMatch[3]));
      sendJson(response, 200, await pullView(repository, updated, user));
      return true;
    }

    // POST .../pulls/:number/reviews — one review decision of the current
    // compare revision (REQ-6-3-4). A non-author reviewer with the write rule
    // approves or requests changes on an Open pull request.
    if (reviewsMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const detail = await orgStore.getPullRequest(repository.id, Number(reviewsMatch[3]));
      if (!detail) {
        sendJson(response, 404, { message: PULL_MESSAGES.pullNotFound });
        return true;
      }
      const canWrite = await orgStore.canWriteRepository(repository, user.id);
      const canReview =
        canWrite &&
        detail.pullRequest.status === "open" &&
        detail.pullRequest.author !== user.username;
      if (!canReview) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const decision = typeof body.decision === "string" ? body.decision : "";
      const summary = typeof body.summary === "string" ? body.summary : "";
      const fieldErrors = {};
      if (!isValidReviewDecision(decision)) fieldErrors.decision = PULL_MESSAGES.decisionInvalid;
      if (!validateReviewSummary(summary)) fieldErrors.summary = PULL_MESSAGES.summaryTooLong;
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }
      await orgStore.addPullRequestReview({
        repositoryId: repository.id,
        number: Number(reviewsMatch[3]),
        decision,
        summary,
        reviewerName: user.username,
        reviewerAccountId: user.id,
      });
      const updated = await orgStore.getPullRequest(repository.id, Number(reviewsMatch[3]));
      sendJson(response, 200, await pullView(repository, updated, user));
      return true;
    }

    // PUT .../pulls/:number/milestone sets an existing milestone of this
    // repository on the pull request; DELETE clears the stored relationship
    // (REQ-5-3-3). It needs the triage rule; the selector never creates a
    // milestone and never borrows one from another repository.
    if (milestoneMatch && (method === "PUT" || method === "DELETE")) {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canTriageRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = method === "PUT" ? await readBody(request) : {};
      const name = method === "PUT" && typeof body.name === "string" ? body.name.trim() : "";
      const updated = await orgStore.setPullRequestMilestone({
        repositoryId: repository.id,
        number: Number(milestoneMatch[3]),
        name,
        actorName: user.username,
        actorAccountId: user.id,
      });
      if (updated.reason === "pull-missing") {
        sendJson(response, 404, { message: PULL_MESSAGES.pullNotFound });
        return true;
      }
      if (!updated.ok) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { milestone: ISSUE_MESSAGES.milestoneInvalid },
        });
        return true;
      }
      const detail = await orgStore.getPullRequest(repository.id, Number(milestoneMatch[3]));
      sendJson(response, 200, await pullView(repository, detail, user));
      return true;
    }

    // POST .../pulls/:number/reviewers + DELETE .../reviewers/:username — one
    // pending reviewer request, saved or removed immediately (REQ-6-4). The
    // author or a Maintain/Admin/Owner manages it and only an eligible
    // collaborator may be requested.
    if ((reviewersMatch || reviewerMatch) && (method === "POST" || method === "DELETE")) {
      const matchTarget = reviewersMatch ?? reviewerMatch;
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const detail = await orgStore.getPullRequest(repository.id, Number(matchTarget[3]));
      if (!detail) {
        sendJson(response, 404, { message: PULL_MESSAGES.pullNotFound });
        return true;
      }
      const canMaintain = await orgStore.canMaintainRepository(repository, user.id);
      if (detail.pullRequest.author !== user.username && !canMaintain) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      let username = "";
      if (reviewerMatch) username = decodeSegment(reviewerMatch[4] ?? "").trim();
      else {
        const body = await readBody(request);
        username = (typeof body.username === "string" ? body.username : "").trim();
      }
      const memberIds = await orgStore.listRepositoryMemberAccountIds(repository.id);
      const memberAccounts = await store.findAccountsByIds(memberIds);
      const eligible = memberAccounts
        .map((account) => account.username)
        .filter((name) => name !== detail.pullRequest.author);
      if (!eligible.includes(username)) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { reviewer: PULL_MESSAGES.reviewerInvalid },
        });
        return true;
      }
      if (method === "POST") {
        await orgStore.requestPullRequestReviewer({
          repositoryId: repository.id,
          number: Number(matchTarget[3]),
          username,
        });
      } else {
        await orgStore.removePullRequestReviewer({
          repositoryId: repository.id,
          number: Number(matchTarget[3]),
          username,
        });
      }
      const updated = await orgStore.getPullRequest(repository.id, Number(matchTarget[3]));
      sendJson(response, 200, await pullView(repository, updated, user));
      return true;
    }

    return false;
  };
}
