import { canReadRepository, effectiveRepositoryRole } from "../domain/organizations.mjs";
import {
  addIssueComment,
  assignIssueParticipant,
  canChangeIssueState,
  canManageIssueMetadata,
  canWriteIssue,
  commentPayload,
  createIssue,
  findIssueByNumber,
  issueDetailPayload,
  issueSummary,
  listRepositoryIssues,
  repositoryLabels,
  repositoryMilestones,
  setIssueMilestone,
  setIssueState,
  targetReactions,
  toggleIssueLabel,
  toggleIssueReaction,
  unassignIssueParticipant,
  updateIssueDescription,
  updateIssueTitle,
} from "../domain/issues.mjs";
import { readJson, sendJson } from "../lib/http.mjs";

/**
 * REQ-5 issue routes shared by personal and organization repositories: the
 * Issues list, issue creation, the issue detail page, discussion comments,
 * and reaction toggling. Every route resolves the repository through
 * `deps.resolveRepository`, enforces repository-read permission against the
 * current session, and validates the operation-specific role before any
 * write; returns true when the path belongs to this module.
 */
export async function handleIssueRoutes({
  request,
  response,
  url,
  path,
  state,
  store,
  account,
  resolveRepository,
}) {
  const listRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/issues$/);
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
      sendJson(response, 200, {
        issues: listRepositoryIssues(state, repository.id),
        labels: repositoryLabels(state, repository.id),
        milestones: repositoryMilestones(state, repository.id),
        currentRole: effectiveRepositoryRole(state, account?.id, repository),
      });
      return true;
    }
    if (request.method === "POST") {
      if (!account) {
        sendJson(response, 401, { error: "Unauthenticated" });
        return true;
      }
      if (!canWriteIssue(state, account.id, repository)) {
        sendJson(response, 403, { error: "Access denied" });
        return true;
      }
      const body = await readJson(request);
      const repositoryId = repository.id;
      let outcome;
      await store.update((draft) => {
        outcome = createIssue(draft, {
          repositoryId,
          accountId: account.id,
          title: body.title,
          description: body.description,
        });
      });
      if (!outcome.ok) {
        sendJson(response, 400, { errors: outcome.errors });
        return true;
      }
      const freshState = await store.read();
      const freshIssue = freshState.issues.find((candidate) => candidate.id === outcome.issue.id);
      sendJson(response, 201, { issue: issueSummary(freshState, freshIssue) });
      return true;
    }
    return false;
  }

  const detailRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)$/);
  if (detailRoute && (request.method === "GET" || request.method === "PATCH")) {
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
    const issue = findIssueByNumber(state, repository.id, detailRoute[4]);
    if (!issue) {
      sendJson(response, 404, { error: "Issue not found" });
      return true;
    }
    if (request.method === "GET") {
      sendJson(response, 200, {
        ...issueDetailPayload(state, issue, account?.id),
        currentRole: effectiveRepositoryRole(state, account?.id, repository),
      });
      return true;
    }
    // PATCH edits exactly one field of the target issue; Write/Maintain/Admin only.
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    if (!canWriteIssue(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const body = await readJson(request);
    const issueId = issue.id;
    let outcome;
    await store.update((draft) => {
      if (body.title !== undefined) {
        outcome = updateIssueTitle(draft, {
          issueId,
          accountId: account.id,
          title: body.title,
        });
      } else if (body.description !== undefined) {
        outcome = updateIssueDescription(draft, {
          issueId,
          accountId: account.id,
          description: body.description,
        });
      } else {
        outcome = { ok: false, errors: { title: "Title is required" } };
      }
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true, activity: outcome.activity });
    return true;
  }

  const stateRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/state$/,
  );
  if (stateRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      stateRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(stateRoute[2]),
      decodeURIComponent(stateRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    // Close/reopen eligibility is Triage, Maintain, or Admin only; Write and
    // Read requests are rejected even when the caller can read the issue.
    if (!canChangeIssueState(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const issue = findIssueByNumber(state, repository.id, stateRoute[4]);
    if (!issue) {
      sendJson(response, 404, { error: "Issue not found" });
      return true;
    }
    const body = await readJson(request);
    const issueId = issue.id;
    let outcome;
    await store.update((draft) => {
      outcome = setIssueState(draft, {
        issueId,
        accountId: account.id,
        state: body.state,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true, activity: outcome.activity });
    return true;
  }

  const assigneesRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/assignees$/,
  );
  if (assigneesRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      assigneesRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(assigneesRoute[2]),
      decodeURIComponent(assigneesRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    if (!canManageIssueMetadata(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const issue = findIssueByNumber(state, repository.id, assigneesRoute[4]);
    if (!issue) {
      sendJson(response, 404, { error: "Issue not found" });
      return true;
    }
    const body = await readJson(request);
    const issueId = issue.id;
    let outcome;
    await store.update((draft) => {
      if (body.assign) {
        outcome = assignIssueParticipant(draft, {
          issueId,
          operatorAccountId: account.id,
          username: body.username,
        });
      } else {
        outcome = unassignIssueParticipant(draft, {
          issueId,
          operatorAccountId: account.id,
          username: body.username,
        });
      }
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true, activity: outcome.activity });
    return true;
  }

  const labelsRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/labels$/,
  );
  if (labelsRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      labelsRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(labelsRoute[2]),
      decodeURIComponent(labelsRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    if (!canManageIssueMetadata(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const issue = findIssueByNumber(state, repository.id, labelsRoute[4]);
    if (!issue) {
      sendJson(response, 404, { error: "Issue not found" });
      return true;
    }
    const body = await readJson(request);
    const issueId = issue.id;
    let outcome;
    await store.update((draft) => {
      outcome = toggleIssueLabel(draft, {
        issueId,
        accountId: account.id,
        name: body.name,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true, activity: outcome.activity });
    return true;
  }

  const milestoneRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/milestone$/,
  );
  if (milestoneRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      milestoneRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(milestoneRoute[2]),
      decodeURIComponent(milestoneRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    if (!canManageIssueMetadata(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const issue = findIssueByNumber(state, repository.id, milestoneRoute[4]);
    if (!issue) {
      sendJson(response, 404, { error: "Issue not found" });
      return true;
    }
    const body = await readJson(request);
    const issueId = issue.id;
    let outcome;
    await store.update((draft) => {
      outcome = setIssueMilestone(draft, {
        issueId,
        accountId: account.id,
        milestoneTitle: body.milestone ?? null,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    sendJson(response, 200, { ok: true, activity: outcome.activity });
    return true;
  }

  const commentsRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/comments$/,
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
    if (!canWriteIssue(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const issue = findIssueByNumber(state, repository.id, commentsRoute[4]);
    if (!issue) {
      sendJson(response, 404, { error: "Issue not found" });
      return true;
    }
    const body = await readJson(request);
    const issueId = issue.id;
    let outcome;
    await store.update((draft) => {
      outcome = addIssueComment(draft, {
        issueId,
        accountId: account.id,
        body: body.body,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    const freshState = await store.read();
    const freshComment = freshState.issueComments.find((candidate) => candidate.id === outcome.comment.id);
    const activity = freshState.issueActivities.find(
      (candidate) => candidate.type === "commented" && candidate.commentId === freshComment.id,
    );
    sendJson(response, 201, {
      comment: commentPayload(freshState, freshComment, account.id),
      activity: activity ? {
        id: activity.id,
        type: activity.type,
        actor: { username: account.username },
        createdAt: activity.createdAt,
        commentId: activity.commentId ?? null,
        body: freshComment.body,
      } : null,
    });
    return true;
  }

  const reactionsRoute = path.match(
    /^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/reactions$/,
  );
  if (reactionsRoute && request.method === "POST") {
    const repository = resolveRepository(
      state,
      reactionsRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(reactionsRoute[2]),
      decodeURIComponent(reactionsRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    if (!canReadRepository(state, account.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const issue = findIssueByNumber(state, repository.id, reactionsRoute[4]);
    if (!issue) {
      sendJson(response, 404, { error: "Issue not found" });
      return true;
    }
    const body = await readJson(request);
    const issueId = issue.id;
    let outcome;
    await store.update((draft) => {
      outcome = toggleIssueReaction(draft, {
        issueId,
        accountId: account.id,
        targetType: body.targetType,
        targetId: body.targetId,
        reaction: body.reaction,
      });
    });
    if (!outcome.ok) {
      sendJson(response, 400, { errors: outcome.errors });
      return true;
    }
    const freshState = await store.read();
    sendJson(response, 200, {
      reactions: targetReactions(freshState, issueId, body.targetType, body.targetId, account.id),
    });
    return true;
  }

  return false;
}
