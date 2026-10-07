// HTTP surface of the issue list and the issue detail view (REQ-5-1 to REQ-5-3).
//
// Every read re-applies the shared repository read rule, so an issue of a
// private repository is never exposed to a caller without permission. The
// operations are checked per operation against the stored grants rather than
// trusted from the UI: creating, editing the content and commenting need the
// write rule (Write, Maintain, Admin), while assigning, labelling, setting a
// milestone and the other metadata changes need the triage rule (Triage,
// Maintain, Admin). A `Read` grant is refused with 403 on every mutation.

import { readJson, sendJson } from "./http.mjs";
import {
  ISSUE_MESSAGES,
  isValidIssueStatus,
  isValidReactionType,
  validateIssueComment,
  validateIssueDescription,
  validateIssueTitle,
} from "./issue-rules.mjs";
import { ORG_MESSAGES } from "./org-rules.mjs";
import { publicRepository } from "./org-store.mjs";

const REPOSITORIES_PREFIX = "/api/repositories/";
const ISSUES_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues$/;
const ISSUE_COMMENTS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/;
const ISSUE_ASSIGNEES_PATH =
  /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)\/assignees(?:\/([^/]+))?$/;
const ISSUE_LABELS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)\/labels(?:\/([^/]+))?$/;
const ISSUE_MILESTONE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)\/milestone$/;
const ISSUE_STATUS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)\/status$/;
const ISSUE_REACTIONS_PATH =
  /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)\/reactions(?:\/([^/]+))?$/;
const ISSUE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;

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

export function createIssueRoutes({ store, orgStore, findRepository, describeOwner, currentUser }) {
  async function withOwner(repository) {
    return {
      ...publicRepository(repository),
      owner: await describeOwner(repository.ownerType, repository.ownerId),
    };
  }

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

  /** Assignee ids become the member usernames the detail view displays. */
  async function assigneeNames(ids) {
    if (!ids || ids.length === 0) return [];
    const accounts = await store.findAccountsByIds(ids);
    const byId = new Map(accounts.map((account) => [account.id, account.username]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  /** Usernames a metadata editor may assign to this issue (REQ-5-3-1). */
  async function eligibleAssigneeNames(repository) {
    const ids = await orgStore.listRepositoryMemberAccountIds(repository.id);
    const accounts = await store.findAccountsByIds(ids);
    return accounts.map((account) => account.username).sort((left, right) => left.localeCompare(right));
  }

  async function issueView(repository, view, user) {
    const { assigneeIds, ...issue } = view.issue;
    const canWrite = await orgStore.canWriteRepository(repository, user?.id ?? null);
    const canTriage = await orgStore.canTriageRepository(repository, user?.id ?? null);
    // REQ-5-5: every signed-in account that may read the issue may react to it;
    // the read rule was already applied by the caller, so the only extra fact is
    // whether an identity is present at all. An archived repository stays
    // read-only, exactly like every other write it holds.
    const canReact =
      Boolean(user) && repository.archived !== true && (await orgStore.canReadRepository(repository, user.id));
    return {
      repository: await withOwner(repository),
      issue: { ...issue, assignees: await assigneeNames(assigneeIds) },
      comments: view.comments,
      events: view.events,
      canWrite,
      canTriage,
      canReact,
      reactions: await orgStore.listIssueReactions(repository.id, view.issue.number, user?.id ?? null),
      // The selectable classification of the *current* repository, plus the
      // eligible members the assignee selector offers; the metadata selectors
      // never create a label or a milestone of their own.
      availableLabels: await orgStore.listRepositoryLabels(repository.id),
      availableMilestones: await orgStore.listRepositoryMilestones(repository.id),
      availableAssignees: canTriage ? await eligibleAssigneeNames(repository) : [],
    };
  }

  return async function handleIssues(request, response, url, method) {
    const { pathname } = url;
    if (!pathname.startsWith(REPOSITORIES_PREFIX)) return false;

    const issuesMatch = pathname.match(ISSUES_PATH);
    const commentsMatch = pathname.match(ISSUE_COMMENTS_PATH);
    const assigneesMatch = pathname.match(ISSUE_ASSIGNEES_PATH);
    const labelsMatch = pathname.match(ISSUE_LABELS_PATH);
    const milestoneMatch = pathname.match(ISSUE_MILESTONE_PATH);
    const statusMatch = pathname.match(ISSUE_STATUS_PATH);
    const reactionsMatch = pathname.match(ISSUE_REACTIONS_PATH);
    const issueMatch =
      commentsMatch || assigneesMatch || labelsMatch || milestoneMatch || statusMatch || reactionsMatch
        ? null
        : pathname.match(ISSUE_PATH);
    const match =
      issuesMatch ??
      commentsMatch ??
      assigneesMatch ??
      labelsMatch ??
      milestoneMatch ??
      statusMatch ??
      reactionsMatch ??
      issueMatch;
    if (!match) return false;

    const user = await currentUser(request);
    const repository = await readableRepository(response, match[1], match[2], user);
    if (!repository) return true;

    // GET .../issues — the persisted work items of this repository.
    if (issuesMatch && method === "GET") {
      sendJson(response, 200, {
        repository: await withOwner(repository),
        issues: await orgStore.listIssues(repository.id),
        canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
        canTriage: await orgStore.canTriageRepository(repository, user?.id ?? null),
      });
      return true;
    }

    // POST .../issues — one Open issue with a unique repository-scoped number.
    if (issuesMatch && method === "POST") {
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
      const fieldErrors = {};
      const titleResult = validateIssueTitle(title);
      if (titleResult === "required") fieldErrors.title = ISSUE_MESSAGES.titleRequired;
      if (titleResult === "too-long") fieldErrors.title = ISSUE_MESSAGES.titleTooLong;
      if (!validateIssueDescription(description)) {
        fieldErrors.description = ISSUE_MESSAGES.descriptionTooLong;
      }
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }
      const created = await orgStore.createIssue({
        repositoryId: repository.id,
        title: title.trim(),
        description,
        authorName: user.username,
        authorAccountId: user.id,
      });
      if (!created) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors: { title: ISSUE_MESSAGES.titleRequired } });
        return true;
      }
      const view = await orgStore.getIssue(repository.id, created.number);
      sendJson(response, 201, await issueView(repository, view, user));
      return true;
    }

    // GET .../issues/:number — the complete read view of one issue.
    if (issueMatch && method === "GET") {
      const view = await orgStore.getIssue(repository.id, Number(issueMatch[3]));
      if (!view) {
        sendJson(response, 404, { message: ISSUE_MESSAGES.issueNotFound });
        return true;
      }
      sendJson(response, 200, await issueView(repository, view, user));
      return true;
    }

    // POST .../issues/:number/comments — one appended discussion comment.
    if (commentsMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canWriteRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const comment = typeof body.body === "string" ? body.body : "";
      const result = validateIssueComment(comment);
      if (result !== "ok") {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: {
            body: result === "too-long" ? ISSUE_MESSAGES.commentTooLong : ISSUE_MESSAGES.commentRequired,
          },
        });
        return true;
      }
      const added = await orgStore.addIssueComment({
        repositoryId: repository.id,
        number: Number(commentsMatch[3]),
        body: comment.trim(),
        authorName: user.username,
        authorAccountId: user.id,
      });
      if (!added.ok) {
        sendJson(response, 404, { message: ISSUE_MESSAGES.issueNotFound });
        return true;
      }
      const view = await orgStore.getIssue(repository.id, Number(commentsMatch[3]));
      sendJson(response, 201, await issueView(repository, view, user));
      return true;
    }

    // PATCH .../issues/:number — edits only the selected content field
    // (REQ-5-2-2). A rejected title writes nothing, so the stored issue keeps
    // its original value.
    if (issueMatch && method === "PATCH") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canWriteRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const fieldErrors = {};
      let title;
      if (body.title !== undefined) {
        const verdict = validateIssueTitle(body.title);
        if (verdict === "required") fieldErrors.title = ISSUE_MESSAGES.titleRequired;
        else if (verdict === "too-long") fieldErrors.title = ISSUE_MESSAGES.titleTooLong;
        else title = String(body.title).trim();
      }
      let description;
      if (body.description !== undefined) {
        if (!validateIssueDescription(body.description)) {
          fieldErrors.description = ISSUE_MESSAGES.descriptionTooLong;
        } else {
          description = typeof body.description === "string" ? body.description : "";
        }
      }
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }
      const updated = await orgStore.updateIssueContent({
        repositoryId: repository.id,
        number: Number(issueMatch[3]),
        title,
        description,
        actorName: user.username,
        actorAccountId: user.id,
      });
      if (!updated.ok) {
        sendJson(response, 404, { message: ISSUE_MESSAGES.issueNotFound });
        return true;
      }
      const view = await orgStore.getIssue(repository.id, Number(issueMatch[3]));
      sendJson(response, 200, await issueView(repository, view, user));
      return true;
    }

    // POST .../issues/:number/assignees + DELETE .../assignees/:username — one
    // issue-assignee relationship, saved immediately (REQ-5-3-1).
    if (assigneesMatch && (method === "POST" || method === "DELETE")) {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canTriageRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = method === "POST" ? await readBody(request) : {};
      const username = assigneesMatch[4]
        ? decodeSegment(assigneesMatch[4])
        : typeof body.username === "string"
          ? body.username.trim()
          : "";
      const account = username ? await store.findAccountByIdentifier(username) : null;
      const eligible = account
        ? (await orgStore.listRepositoryMemberAccountIds(repository.id)).includes(account.id)
        : false;
      if (!account || !eligible) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { assignee: ISSUE_MESSAGES.assigneeInvalid },
        });
        return true;
      }
      const updated = await orgStore.setIssueAssignee({
        repositoryId: repository.id,
        number: Number(assigneesMatch[3]),
        accountId: account.id,
        username: account.username,
        assigned: method === "POST",
        actorName: user.username,
        actorAccountId: user.id,
      });
      if (!updated.ok) {
        sendJson(response, 404, { message: ISSUE_MESSAGES.issueNotFound });
        return true;
      }
      const view = await orgStore.getIssue(repository.id, Number(assigneesMatch[3]));
      sendJson(response, 200, await issueView(repository, view, user));
      return true;
    }

    // POST .../issues/:number/labels + DELETE .../labels/:name — applies an
    // existing label of this repository to the issue (REQ-5-3-2).
    if (labelsMatch && (method === "POST" || method === "DELETE")) {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canTriageRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = method === "POST" ? await readBody(request) : {};
      const name = labelsMatch[4]
        ? decodeSegment(labelsMatch[4])
        : typeof body.name === "string"
          ? body.name.trim()
          : "";
      const updated = await orgStore.setIssueLabel({
        repositoryId: repository.id,
        number: Number(labelsMatch[3]),
        name,
        applied: method === "POST",
        actorName: user.username,
        actorAccountId: user.id,
      });
      if (updated.reason === "issue-missing") {
        sendJson(response, 404, { message: ISSUE_MESSAGES.issueNotFound });
        return true;
      }
      if (!updated.ok) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { label: ISSUE_MESSAGES.labelInvalid },
        });
        return true;
      }
      const view = await orgStore.getIssue(repository.id, Number(labelsMatch[3]));
      sendJson(response, 200, await issueView(repository, view, user));
      return true;
    }

    // PUT .../issues/:number/milestone sets an existing milestone of this
    // repository; DELETE clears the stored relationship (REQ-5-3-3).
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
      const updated = await orgStore.setIssueMilestone({
        repositoryId: repository.id,
        number: Number(milestoneMatch[3]),
        name,
        actorName: user.username,
        actorAccountId: user.id,
      });
      if (updated.reason === "issue-missing") {
        sendJson(response, 404, { message: ISSUE_MESSAGES.issueNotFound });
        return true;
      }
      if (!updated.ok) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { milestone: ISSUE_MESSAGES.milestoneInvalid },
        });
        return true;
      }
      const view = await orgStore.getIssue(repository.id, Number(milestoneMatch[3]));
      sendJson(response, 200, await issueView(repository, view, user));
      return true;
    }

    // PATCH .../issues/:number/status — closes or reopens the issue in place
    // (REQ-5-4). The transition needs the triage rule, so a Write or Read
    // caller is refused; closing only stores the status and its activity and
    // never touches the content, discussion or metadata of the issue.
    if (statusMatch && method === "PATCH") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canTriageRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const status = body.status;
      if (!isValidIssueStatus(status)) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { status: ISSUE_MESSAGES.statusInvalid },
        });
        return true;
      }
      const updated = await orgStore.setIssueStatus({
        repositoryId: repository.id,
        number: Number(statusMatch[3]),
        status,
        actorName: user.username,
        actorAccountId: user.id,
      });
      if (!updated.ok) {
        sendJson(response, 404, { message: ISSUE_MESSAGES.issueNotFound });
        return true;
      }
      const view = await orgStore.getIssue(repository.id, Number(statusMatch[3]));
      sendJson(response, 200, await issueView(repository, view, user));
      return true;
    }

    // POST .../issues/:number/reactions adds one reaction of the signed-in
    // account, DELETE .../reactions/:type removes exactly that account's
    // reaction (REQ-5-5). Both need only the read rule: reacting is a
    // per-operation action any viewer may perform, not a Write/Triage grant.
    // The routes re-check it, so a visitor is refused even without a control.
    if (reactionsMatch && (method === "POST" || method === "DELETE")) {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (repository.archived === true) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = method === "POST" ? await readBody(request) : {};
      const type = reactionsMatch[4]
        ? decodeSegment(reactionsMatch[4])
        : typeof body.type === "string"
          ? body.type
          : "";
      if (!isValidReactionType(type)) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { type: ISSUE_MESSAGES.reactionInvalid },
        });
        return true;
      }
      const number = Number(reactionsMatch[3]);
      const changed =
        method === "POST"
          ? await orgStore.addIssueReaction({
              repositoryId: repository.id,
              number,
              type,
              accountId: user.id,
            })
          : await orgStore.removeIssueReaction({
              repositoryId: repository.id,
              number,
              type,
              accountId: user.id,
            });
      if (!changed.ok) {
        sendJson(response, 404, { message: ISSUE_MESSAGES.issueNotFound });
        return true;
      }
      const view = await orgStore.getIssue(repository.id, number);
      sendJson(response, 200, await issueView(repository, view, user));
      return true;
    }

    return false;
  };
}
