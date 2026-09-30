/**
 * Issue reads and writes of one repository (REQ-5-1, REQ-5-2, REQ-5-3).
 *
 * Every write recomputes the viewer's permission from the persisted state and
 * applies the whole change in one atomic store update: a refused creation does
 * not allocate a number, a refused edit keeps the stored value, and a stored
 * change survives a restart. The list page and the detail page both read the
 * records written here, so they never disagree.
 *
 * Each operation asks for the role it needs instead of walking a ladder: Write,
 * Maintain and Admin create, edit and comment, while Triage, Maintain and Admin
 * change the assignees, the labels, the milestone and the status. Reactions need
 * only a session that may read the issue, and every signed-in reader may toggle
 * their own reaction on an issue or on one of its comments.
 */

import {
  ISSUE_MESSAGES,
  appendActivity,
  assignableMemberLogins,
  buildIssue,
  canManageIssues,
  canWriteIssues,
  commentError,
  findIssue,
  isReactionType,
  isIssueStatus,
  issueDescriptionError,
  issueTitleError,
  issuesOfRepository,
  nextActivityId,
  nextIssueNumber,
  normalizeComment,
  normalizeIssueDescription,
  normalizeIssueTitle,
  toClassificationOptions,
  toIssueDetail,
  toIssueSummary,
} from "./domain/issues.mjs";
import {
  canViewRepository,
  findRepository,
  toRepositoryContext,
} from "./domain/repositories.mjs";

function failure(status, error, fields) {
  return { ok: false, status, error, fields: fields ?? {} };
}

export function createIssueHandlers({ jsonStore, resolveViewer }) {
  /**
   * Resolves the repository of one request for a read: an unknown repository and
   * an unreadable private one are answered alike, while a signed-in viewer who
   * may not read an existing repository learns that it is denied.
   */
  function readRepository(state, sessionId, owner, name) {
    const viewer = resolveViewer(state, sessionId);
    const repository = findRepository(state, owner, name);
    if (!repository) return { status: 404 };
    if (!canViewRepository(state, repository, viewer)) return { status: viewer ? 403 : 404 };
    return { viewer, repository };
  }

  /**
   * The answer of every issue read and write: the repository context, the stored
   * issue, the classification options of this repository and the members that
   * may be assigned. It is the same shape after a write, so the page shows the
   * persisted record instead of a locally patched copy.
   */
  function payloadOf(state, repository, viewer, issue) {
    return {
      repository: toRepositoryContext(repository, state, viewer, repository.defaultBranch),
      issue: toIssueDetail(issue, state, repository.id, viewer),
      ...toClassificationOptions(state, repository.id),
      // The members that may be assigned are only listed for a viewer who may
      // manage the issue; everybody else reads the stored assignees instead.
      assignableMembers:
        viewer && canManageIssues(state, repository, viewer)
          ? assignableMemberLogins(state, repository)
          : [],
    };
  }

  /** Rows of the Issues list, with the labels and milestones of the repository. */
  async function listRepositoryIssues(sessionId, owner, name) {
    const state = await jsonStore.read();
    const loaded = readRepository(state, sessionId, owner, name);
    if (loaded.status) return loaded;
    const { repository, viewer } = loaded;
    return {
      status: 200,
      payload: {
        repository: toRepositoryContext(repository, state, viewer, repository.defaultBranch),
        issues: issuesOfRepository(state, repository.id).map((issue) =>
          toIssueSummary(issue, state, repository.id),
        ),
        ...toClassificationOptions(state, repository.id),
      },
    };
  }

  /** The complete view of one issue, addressed by its repository-scoped number. */
  async function getRepositoryIssue(sessionId, owner, name, number) {
    const state = await jsonStore.read();
    const loaded = readRepository(state, sessionId, owner, name);
    if (loaded.status) return loaded;
    const { repository, viewer } = loaded;
    const issue = findIssue(state, repository.id, number);
    // An unknown number of a readable repository is the same kind of answer as an
    // unknown file: the repository context lets the page show it as absent.
    if (!issue) {
      return {
        status: 404,
        missingIssue: true,
        repository: toRepositoryContext(repository, state, viewer, repository.defaultBranch),
      };
    }
    return { status: 200, payload: payloadOf(state, repository, viewer, issue) };
  }

  /**
   * Runs one operation on the target issue inside a single atomic update. The
   * role check happens before `apply`, so a refused operation leaves the issue,
   * the timeline and every other stored record untouched.
   *
   * `requireSession` marks the operations that need their own signed-in viewer
   * (reactions); everything else asks for a role, which already implies a session.
   */
  async function withIssue(
    sessionId,
    owner,
    name,
    number,
    { requireWrite = false, requireManage = false },
    apply,
  ) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      // Every one of these operations writes a persisted record, so it needs the
      // session of its author before the role of that author is asked for.
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      const issue = findIssue(state, repository.id, number);
      if (!issue) {
        outcome = failure(404, "Not found");
        return;
      }
      if (requireWrite && !canWriteIssues(state, repository, viewer)) {
        outcome = failure(403, ISSUE_MESSAGES.forbiddenWrite);
        return;
      }
      if (requireManage && !canManageIssues(state, repository, viewer)) {
        outcome = failure(403, ISSUE_MESSAGES.forbiddenManage);
        return;
      }
      const refused = apply({ state, repository, viewer, issue });
      if (refused) {
        outcome = refused;
        return;
      }
      outcome = { ok: true, status: 200, payload: payloadOf(state, repository, viewer, issue) };
    });
    return outcome;
  }

  /**
   * Creates one issue with the next repository-scoped number. Title, description,
   * the session and the write permission are all validated before the record is
   * written, so a refused submission adds neither an issue nor a number.
   */
  async function createRepositoryIssue(sessionId, owner, name, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!canWriteIssues(state, repository, viewer)) {
        outcome = failure(403, ISSUE_MESSAGES.forbiddenWrite);
        return;
      }
      const fields = {};
      const titleError = issueTitleError(input.title);
      if (titleError) fields.title = titleError;
      const descriptionError = issueDescriptionError(input.description);
      if (descriptionError) fields.description = descriptionError;
      if (Object.keys(fields).length > 0) {
        outcome = failure(400, "Issue creation failed", fields);
        return;
      }

      const createdAt = new Date().toISOString();
      const number = nextIssueNumber(state, repository.id);
      const issue = buildIssue({
        id: `issue-${repository.id}-${number}`,
        repositoryId: repository.id,
        number,
        title: normalizeIssueTitle(input.title),
        description: normalizeIssueDescription(input.description),
        authorId: viewer.id,
        createdAt,
      });
      state.issues = state.issues ?? [];
      state.issues.push(issue);
      outcome = { ok: true, status: 201, payload: payloadOf(state, repository, viewer, issue) };
    });
    return outcome;
  }

  /**
   * Writes one field of the target issue only. The repository, the number and the
   * new value are validated first, so a refused save keeps the stored issue and
   * its timeline untouched.
   */
  async function updateIssueField(sessionId, owner, name, number, input, field) {
    return withIssue(sessionId, owner, name, number, { requireWrite: true }, ({ viewer, issue }) => {
      const errors = {};
      const value =
        field === "title"
          ? normalizeIssueTitle(input.title)
          : normalizeIssueDescription(input.description);
      const fieldError =
        field === "title" ? issueTitleError(input.title) : issueDescriptionError(input.description);
      if (fieldError) errors[field] = fieldError;
      if (Object.keys(errors).length > 0) return failure(400, "Issue update failed", errors);

      const editedAt = new Date().toISOString();
      if (field === "title") {
        const from = issue.title;
        issue.title = value;
        appendActivity(issue, {
          id: nextActivityId(issue),
          type: "title_changed",
          actorId: viewer.id,
          createdAt: editedAt,
          from,
          to: value,
        });
      } else {
        issue.description = value;
        appendActivity(issue, {
          id: nextActivityId(issue),
          type: "description_changed",
          actorId: viewer.id,
          createdAt: editedAt,
          to: value,
        });
      }
      issue.updatedAt = editedAt;
      return null;
    });
  }

  function updateIssueTitle(sessionId, owner, name, number, input = {}) {
    return updateIssueField(sessionId, owner, name, number, input, "title");
  }

  function updateIssueDescription(sessionId, owner, name, number, input = {}) {
    return updateIssueField(sessionId, owner, name, number, input, "description");
  }

  /**
   * Appends one comment to the discussion (REQ-5-2-3). The body is validated
   * before anything is stored, so an empty or overlong comment adds neither a
   * comment record nor an activity entry.
   */
  async function addIssueComment(sessionId, owner, name, number, input = {}) {
    return withIssue(sessionId, owner, name, number, { requireWrite: true }, ({ viewer, issue }) => {
      const complaint = commentError(input.body);
      if (complaint) return failure(400, "Comment failed", { body: complaint });

      const createdAt = new Date().toISOString();
      const commentId = `${issue.id}-comment-${(issue.comments ?? []).length + 1}`;
      issue.comments = issue.comments ?? [];
      issue.comments.push({
        id: commentId,
        authorId: viewer.id,
        body: normalizeComment(input.body),
        createdAt,
      });
      appendActivity(issue, {
        id: nextActivityId(issue),
        type: "commented",
        actorId: viewer.id,
        createdAt,
        commentId,
      });
      issue.updatedAt = createdAt;
      return null;
    });
  }

  /**
   * Toggles one "subject-target-reaction type" association (REQ-5-2-3). Every
   * signed-in reader may react; for one account, one target and one type only a
   * single association is stored, so choosing the same reaction again removes it
   * instead of storing a duplicate.
   */
  async function toggleIssueReaction(sessionId, owner, name, number, input = {}) {
    return withIssue(sessionId, owner, name, number, {}, ({ state, viewer, issue }) => {
      const type = String(input.type ?? "");
      if (!isReactionType(type)) {
        return failure(400, "Reaction failed", { type: ISSUE_MESSAGES.reactionUnknown });
      }
      const commentId = input.commentId ? String(input.commentId) : null;
      if (commentId && !(issue.comments ?? []).some((comment) => comment.id === commentId)) {
        return failure(404, "Not found");
      }

      state.reactions = state.reactions ?? [];
      const existing = state.reactions.findIndex(
        (reaction) =>
          reaction.issueId === issue.id &&
          (reaction.commentId ?? null) === commentId &&
          reaction.accountId === viewer.id &&
          reaction.type === type,
      );
      if (existing >= 0) {
        state.reactions.splice(existing, 1);
      } else {
        state.reactions.push({
          id: `reaction-${issue.id}-${state.reactions.length + 1}`,
          issueId: issue.id,
          commentId,
          accountId: viewer.id,
          type,
          createdAt: new Date().toISOString(),
        });
      }
      return null;
    });
  }

  /**
   * Assigns or unassigns one participant (REQ-5-3-1). Only accounts with at
   * least Triage permission on this repository may be assigned; the association
   * and one activity record are stored, and the account itself is untouched.
   */
  async function updateIssueAssignees(sessionId, owner, name, number, input = {}) {
    return withIssue(
      sessionId,
      owner,
      name,
      number,
      { requireManage: true },
      ({ state, repository, viewer, issue }) => {
        const login = String(input.username ?? "").trim();
        const account = (state.accounts ?? []).find(
          (candidate) => candidate.username.toLowerCase() === login.toLowerCase(),
        );
        if (!account) {
          return failure(400, "Assignee update failed", {
            username: ISSUE_MESSAGES.assigneeUnknown,
          });
        }
        const assigned = input.assigned !== false;
        const assignable = assignableMemberLogins(state, repository);
        if (assigned && !assignable.includes(account.username)) {
          return failure(400, "Assignee update failed", {
            username: ISSUE_MESSAGES.assigneeNotAssignable,
          });
        }

        issue.assigneeIds = issue.assigneeIds ?? [];
        const already = issue.assigneeIds.includes(account.id);
        if (already === assigned) return null;

        const changedAt = new Date().toISOString();
        if (assigned) {
          issue.assigneeIds.push(account.id);
          appendActivity(issue, {
            id: nextActivityId(issue),
            type: "assigned",
            actorId: viewer.id,
            createdAt: changedAt,
            to: account.username,
          });
        } else {
          issue.assigneeIds = issue.assigneeIds.filter((id) => id !== account.id);
          appendActivity(issue, {
            id: nextActivityId(issue),
            type: "unassigned",
            actorId: viewer.id,
            createdAt: changedAt,
            from: account.username,
          });
        }
        issue.updatedAt = changedAt;
        return null;
      },
    );
  }

  /**
   * Applies or removes one label of the current repository (REQ-5-3-2). A label
   * of another repository is refused instead of being associated or copied.
   */
  async function updateIssueLabels(sessionId, owner, name, number, input = {}) {
    return withIssue(
      sessionId,
      owner,
      name,
      number,
      { requireManage: true },
      ({ state, repository, viewer, issue }) => {
        const labelId = String(input.labelId ?? "");
        const label = (state.labels ?? []).find(
          (candidate) => candidate.id === labelId && candidate.repositoryId === repository.id,
        );
        if (!label) {
          return failure(400, "Label update failed", { labelId: ISSUE_MESSAGES.labelUnknown });
        }
        const applied = input.applied !== false;
        issue.labelIds = issue.labelIds ?? [];
        if (issue.labelIds.includes(label.id) === applied) return null;

        const changedAt = new Date().toISOString();
        if (applied) {
          issue.labelIds.push(label.id);
          appendActivity(issue, {
            id: nextActivityId(issue),
            type: "labeled",
            actorId: viewer.id,
            createdAt: changedAt,
            to: label.name,
          });
        } else {
          issue.labelIds = issue.labelIds.filter((id) => id !== label.id);
          appendActivity(issue, {
            id: nextActivityId(issue),
            type: "unlabeled",
            actorId: viewer.id,
            createdAt: changedAt,
            from: label.name,
          });
        }
        issue.updatedAt = changedAt;
        return null;
      },
    );
  }

  /**
   * Sets the milestone of the work item or removes it (REQ-5-3-3). At most one
   * milestone is associated; the selectable items are the milestones of this
   * repository only, and `null` deletes the association.
   */
  async function updateIssueMilestone(sessionId, owner, name, number, input = {}) {
    return withIssue(
      sessionId,
      owner,
      name,
      number,
      { requireManage: true },
      ({ state, repository, viewer, issue }) => {
        const milestoneId = input.milestoneId == null ? null : String(input.milestoneId);
        const milestone = milestoneId
          ? (state.milestones ?? []).find(
              (candidate) =>
                candidate.id === milestoneId && candidate.repositoryId === repository.id,
            )
          : null;
        if (milestoneId && !milestone) {
          return failure(400, "Milestone update failed", {
            milestoneId: ISSUE_MESSAGES.milestoneUnknown,
          });
        }
        const nextId = milestone ? milestone.id : null;
        if ((issue.milestoneId ?? null) === nextId) return null;

        const changedAt = new Date().toISOString();
        const previous = (state.milestones ?? []).find(
          (candidate) => candidate.id === issue.milestoneId,
        );
        issue.milestoneId = nextId;
        if (milestone) {
          appendActivity(issue, {
            id: nextActivityId(issue),
            type: "milestoned",
            actorId: viewer.id,
            createdAt: changedAt,
            to: milestone.title,
          });
        } else {
          appendActivity(issue, {
            id: nextActivityId(issue),
            type: "unmilestoned",
            actorId: viewer.id,
            createdAt: changedAt,
            ...(previous ? { from: previous.title } : {}),
          });
        }
        issue.updatedAt = changedAt;
        return null;
      },
    );
  }

  /**
   * Closes or reopens the target issue (REQ-5-4). Triage, Maintain and Admin may
   * change the status; the operation stores the new status with its operator and
   * time and appends one history record, while the number, title, description,
   * comments, labels, assignees and milestone stay exactly as they were.
   */
  async function updateIssueStatus(sessionId, owner, name, number, input = {}) {
    return withIssue(
      sessionId,
      owner,
      name,
      number,
      { requireManage: true },
      ({ viewer, issue }) => {
        const status = String(input.status ?? "");
        if (!isIssueStatus(status)) {
          return failure(400, "Status update failed", { status: ISSUE_MESSAGES.statusUnknown });
        }
        // The stored status is already the requested one: no transition happens,
        // so the timeline gains no record either.
        if (issue.status === status) return null;

        const changedAt = new Date().toISOString();
        issue.status = status;
        appendActivity(issue, {
          id: nextActivityId(issue),
          type: status === "closed" ? "closed" : "reopened",
          actorId: viewer.id,
          createdAt: changedAt,
        });
        issue.updatedAt = changedAt;
        return null;
      },
    );
  }

  return {
    listRepositoryIssues,
    getRepositoryIssue,
    createRepositoryIssue,
    updateIssueTitle,
    updateIssueDescription,
    addIssueComment,
    toggleIssueReaction,
    updateIssueAssignees,
    updateIssueLabels,
    updateIssueMilestone,
    updateIssueStatus,
  };
}
