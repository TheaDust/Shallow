// Persistence of issue records, their discussion comments and their append-only
// activity timeline.
//
// An issue is identified by its repository plus its number: the number is
// unique inside that repository only. A comment adds one independent discussion
// record and one timeline entry in the same store update, so a failure at any
// step leaves the issue, its discussion and its timeline unchanged.

import { randomUUID } from "node:crypto";

import { ISSUE_REACTION_TYPES } from "./issue-rules.mjs";

const COLLECTIONS = [
  "labels",
  "milestones",
  "issues",
  "issueComments",
  "issueEvents",
  "issueReactions",
];

function normalize(state) {
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  return state;
}

function byCreatedAt(left, right) {
  const difference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return difference !== 0 ? difference : 0;
}

/**
 * Public shape of one issue: the stored title, description and status plus the
 * classification names the repository already holds. Label and milestone names
 * are resolved from the same state, so an issue never carries a name of its own.
 */
function describeIssue(state, issue) {
  const milestone = issue.milestoneId
    ? state.milestones.find((entry) => entry.id === issue.milestoneId) ?? null
    : null;
  return {
    number: issue.number,
    title: issue.title,
    description: issue.description ?? "",
    status: issue.status,
    author: issue.authorName,
    labels: (issue.labelIds ?? [])
      .map((id) => state.labels.find((entry) => entry.id === id) ?? null)
      .filter(Boolean)
      .map((label) => ({ name: label.name, color: label.color })),
    assigneeIds: [...(issue.assigneeIds ?? [])],
    milestone: milestone ? { name: milestone.name } : null,
    commentCount: state.issueComments.filter((entry) => entry.issueId === issue.id).length,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

export function createIssueStore(store) {
  async function readState() {
    return normalize(await store.read());
  }

  return {
    /** Every issue of one repository, in repository-scoped number order. */
    async listIssues(repositoryId) {
      const state = await readState();
      return state.issues
        .filter((entry) => entry.repositoryId === repositoryId)
        .sort((left, right) => left.number - right.number)
        .map((issue) => describeIssue(state, issue));
    },

    /** One issue with its discussion comments and its timeline. */
    async getIssue(repositoryId, number) {
      const state = await readState();
      const issue = state.issues.find(
        (entry) => entry.repositoryId === repositoryId && entry.number === number,
      );
      if (!issue) return null;
      return {
        issue: describeIssue(state, issue),
        comments: state.issueComments
          .filter((entry) => entry.issueId === issue.id)
          .sort(byCreatedAt)
          .map((entry) => ({
            id: entry.id,
            author: entry.authorName,
            body: entry.body,
            createdAt: entry.createdAt,
          })),
        events: state.issueEvents
          .filter((entry) => entry.issueId === issue.id)
          .sort(byCreatedAt)
          .map((entry) => ({
            id: entry.id,
            type: entry.type,
            actor: entry.actorName,
            detail: entry.detail ?? "",
            createdAt: entry.createdAt,
          })),
      };
    },

    /**
     * Creates one Open issue with a number unique inside the repository and the
     * matching `created` timeline entry. Both records are written together.
     */
    async createIssue({ repositoryId, title, description, authorName, authorAccountId }) {
      let created = null;
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        const numbers = draft.issues
          .filter((entry) => entry.repositoryId === repositoryId)
          .map((entry) => entry.number);
        const issue = {
          id: `issue-${randomUUID()}`,
          repositoryId,
          number: numbers.length > 0 ? Math.max(...numbers) + 1 : 1,
          title,
          description: description ?? "",
          status: "open",
          authorName,
          authorAccountId: authorAccountId ?? null,
          labelIds: [],
          assigneeIds: [],
          milestoneId: null,
          createdAt: now,
          updatedAt: now,
        };
        draft.issues.push(issue);
        draft.issueEvents.push({
          id: `event-${randomUUID()}`,
          issueId: issue.id,
          type: "created",
          actorName: authorName,
          actorAccountId: authorAccountId ?? null,
          detail: "",
          createdAt: now,
        });
        created = { id: issue.id, number: issue.number };
      });
      return created;
    },

    /**
     * Edits the title and/or the description of one issue (REQ-5-2-2). Only the
     * fields the caller passed are validated and written, so a title save can
     * never change the description. Each changed field appends its own timeline
     * entry in the same store update; an issue that does not exist writes
     * nothing.
     */
    async updateIssueContent({ repositoryId, number, title, description, actorName, actorAccountId }) {
      let result = { ok: false, reason: "issue-missing", issue: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        const issue = draft.issues.find(
          (entry) => entry.repositoryId === repositoryId && entry.number === number,
        );
        if (!issue) return;
        let changed = false;
        if (typeof title === "string" && title !== issue.title) {
          issue.title = title;
          draft.issueEvents.push({
            id: `event-${randomUUID()}`,
            issueId: issue.id,
            type: "renamed",
            actorName,
            actorAccountId: actorAccountId ?? null,
            detail: title,
            createdAt: now,
          });
          changed = true;
        }
        if (typeof description === "string" && description !== (issue.description ?? "")) {
          issue.description = description;
          draft.issueEvents.push({
            id: `event-${randomUUID()}`,
            issueId: issue.id,
            type: "description-edited",
            actorName,
            actorAccountId: actorAccountId ?? null,
            detail: "",
            createdAt: now,
          });
          changed = true;
        }
        if (changed) issue.updatedAt = now;
        result = { ok: true, reason: changed ? "ok" : "unchanged", issue: { ...issue } };
      });
      return result;
    },

    /**
     * Assigns or unassigns one repository member on one issue (REQ-5-3-1). The
     * relationship is stored as an account id; the member account and its
     * repository grants are never touched. Removing an assignment that does not
     * exist is a no-op that still answers with the stored issue.
     */
    async setIssueAssignee({
      repositoryId,
      number,
      accountId,
      username,
      assigned,
      actorName,
      actorAccountId,
    }) {
      let result = { ok: false, reason: "issue-missing", issue: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        const issue = draft.issues.find(
          (entry) => entry.repositoryId === repositoryId && entry.number === number,
        );
        if (!issue) return;
        const ids = new Set(issue.assigneeIds ?? []);
        const before = ids.size;
        if (assigned) ids.add(accountId);
        else ids.delete(accountId);
        if (ids.size !== before) {
          issue.assigneeIds = [...ids];
          issue.updatedAt = now;
          draft.issueEvents.push({
            id: `event-${randomUUID()}`,
            issueId: issue.id,
            type: assigned ? "assigned" : "unassigned",
            actorName,
            actorAccountId: actorAccountId ?? null,
            detail: username,
            createdAt: now,
          });
        }
        result = { ok: true, reason: "ok", issue: { ...issue } };
      });
      return result;
    },

    /**
     * Applies or removes one existing label of the same repository on one issue
     * (REQ-5-3-2). A name the repository does not define is refused without
     * writing, so a label is never created by the selector.
     */
    async setIssueLabel({
      repositoryId,
      number,
      name,
      applied,
      actorName,
      actorAccountId,
    }) {
      let result = { ok: false, reason: "issue-missing", issue: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        const issue = draft.issues.find(
          (entry) => entry.repositoryId === repositoryId && entry.number === number,
        );
        if (!issue) return;
        const label = draft.labels.find(
          (entry) => entry.repositoryId === repositoryId && entry.name === name,
        );
        if (!label) {
          result = { ok: false, reason: "label-missing", issue: null };
          return;
        }
        const ids = new Set(issue.labelIds ?? []);
        const before = ids.size;
        if (applied) ids.add(label.id);
        else ids.delete(label.id);
        if (ids.size !== before) {
          issue.labelIds = [...ids];
          issue.updatedAt = now;
          draft.issueEvents.push({
            id: `event-${randomUUID()}`,
            issueId: issue.id,
            type: applied ? "labeled" : "unlabeled",
            actorName,
            actorAccountId: actorAccountId ?? null,
            detail: label.name,
            createdAt: now,
          });
        }
        result = { ok: true, reason: "ok", issue: { ...issue } };
      });
      return result;
    },

    /**
     * Sets or clears the milestone of one issue (REQ-5-3-3). The milestone must
     * already exist in the same repository; passing an empty name clears the
     * stored relationship. The issue content and status stay untouched.
     */
    async setIssueMilestone({ repositoryId, number, name, actorName, actorAccountId }) {
      let result = { ok: false, reason: "issue-missing", issue: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        const issue = draft.issues.find(
          (entry) => entry.repositoryId === repositoryId && entry.number === number,
        );
        if (!issue) return;
        let milestoneId = null;
        if (name) {
          const milestone = draft.milestones.find(
            (entry) => entry.repositoryId === repositoryId && entry.name === name,
          );
          if (!milestone) {
            result = { ok: false, reason: "milestone-missing", issue: null };
            return;
          }
          milestoneId = milestone.id;
        }
        if (milestoneId !== (issue.milestoneId ?? null)) {
          issue.milestoneId = milestoneId;
          issue.updatedAt = now;
          draft.issueEvents.push({
            id: `event-${randomUUID()}`,
            issueId: issue.id,
            type: milestoneId ? "milestone-set" : "milestone-cleared",
            actorName,
            actorAccountId: actorAccountId ?? null,
            detail: name ?? "",
            createdAt: now,
          });
        }
        result = { ok: true, reason: "ok", issue: { ...issue } };
      });
      return result;
    },

    /**
     * Closes or reopens one issue (REQ-5-4). The status and the matching
     * `closed`/`reopened` timeline entry are written in one store update, so a
     * failure at any step leaves the stored issue unchanged. Only the status
     * changes: title, description, comments, labels, assignees and milestone
     * stay exactly as they were. Repeating the current status is a no-op that
     * still answers with the stored issue.
     */
    async setIssueStatus({ repositoryId, number, status, actorName, actorAccountId }) {
      let result = { ok: false, reason: "issue-missing", issue: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        const issue = draft.issues.find(
          (entry) => entry.repositoryId === repositoryId && entry.number === number,
        );
        if (!issue) return;
        if (issue.status !== status) {
          issue.status = status;
          issue.updatedAt = now;
          draft.issueEvents.push({
            id: `event-${randomUUID()}`,
            issueId: issue.id,
            type: status === "closed" ? "closed" : "reopened",
            actorName,
            actorAccountId: actorAccountId ?? null,
            detail: "",
            createdAt: now,
          });
        }
        result = { ok: true, reason: "ok", issue: { ...issue } };
      });
      return result;
    },

    /**
     * Reactions of one issue (REQ-5-5), aggregated by type in the canonical
     * display order. `reacted` answers whether the reading account itself holds
     * that type, which is what turns a chip into the removable own reaction; an
     * unauthenticated reader never owns a reaction, so every flag stays false.
     * Types with no stored reaction at all are omitted.
     */
    async listIssueReactions(repositoryId, number, accountId) {
      const state = await readState();
      const issue = state.issues.find(
        (entry) => entry.repositoryId === repositoryId && entry.number === number,
      );
      if (!issue) return [];
      const stored = state.issueReactions.filter((entry) => entry.issueId === issue.id);
      return ISSUE_REACTION_TYPES.map((type) => {
        const ofType = stored.filter((entry) => entry.type === type);
        return {
          type,
          count: ofType.length,
          reacted: Boolean(accountId) && ofType.some((entry) => entry.accountId === accountId),
        };
      }).filter((entry) => entry.count > 0);
    },

    /**
     * Adds one reaction of one account to one issue. The record is identified by
     * the issue, the account and the type, so a repeated add of the same type is
     * a no-op that never stores a second row or inflates the count. The issue
     * itself (title, description, status, comments, labels, assignees and
     * milestone) is never touched, and no timeline entry is appended because the
     * activity timeline does not record reactions.
     */
    async addIssueReaction({ repositoryId, number, type, accountId }) {
      let result = { ok: false, reason: "issue-missing" };
      await store.update((draft) => {
        normalize(draft);
        const issue = draft.issues.find(
          (entry) => entry.repositoryId === repositoryId && entry.number === number,
        );
        if (!issue) return;
        const exists = draft.issueReactions.some(
          (entry) => entry.issueId === issue.id && entry.accountId === accountId && entry.type === type,
        );
        if (!exists) {
          draft.issueReactions.push({
            id: `reaction-${randomUUID()}`,
            issueId: issue.id,
            repositoryId,
            accountId,
            type,
            createdAt: new Date().toISOString(),
          });
        }
        result = { ok: true, reason: exists ? "unchanged" : "ok" };
      });
      return result;
    },

    /**
     * Removes the reaction one account holds of one type on one issue. Only that
     * single record is deleted, so the reactions of every other account stay and
     * the count decreases by exactly one; removing a reaction the account does
     * not hold is a no-op that still answers with the stored issue.
     */
    async removeIssueReaction({ repositoryId, number, type, accountId }) {
      let result = { ok: false, reason: "issue-missing" };
      await store.update((draft) => {
        normalize(draft);
        const issue = draft.issues.find(
          (entry) => entry.repositoryId === repositoryId && entry.number === number,
        );
        if (!issue) return;
        const before = draft.issueReactions.length;
        draft.issueReactions = draft.issueReactions.filter(
          (entry) =>
            !(entry.issueId === issue.id && entry.accountId === accountId && entry.type === type),
        );
        result = { ok: true, reason: draft.issueReactions.length === before ? "unchanged" : "ok" };
      });
      return result;
    },

    /** Classification names the current repository already defines (REQ-5-3). */
    async listRepositoryLabels(repositoryId) {
      const state = await readState();
      return state.labels
        .filter((entry) => entry.repositoryId === repositoryId)
        .map((entry) => ({ name: entry.name, color: entry.color }));
    },

    async listRepositoryMilestones(repositoryId) {
      const state = await readState();
      return state.milestones
        .filter((entry) => entry.repositoryId === repositoryId)
        .map((entry) => ({ name: entry.name }));
    },

    /**
     * Appends one discussion comment and its `commented` timeline entry to an
     * existing issue. A missing issue writes nothing. The issue's content and
     * status are untouched.
     */
    async addIssueComment({ repositoryId, number, body, authorName, authorAccountId }) {
      let result = { ok: false, reason: "issue-missing", comment: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        const issue = draft.issues.find(
          (entry) => entry.repositoryId === repositoryId && entry.number === number,
        );
        if (!issue) return;
        const comment = {
          id: `comment-${randomUUID()}`,
          issueId: issue.id,
          authorName,
          authorAccountId: authorAccountId ?? null,
          body,
          createdAt: now,
        };
        draft.issueComments.push(comment);
        draft.issueEvents.push({
          id: `event-${randomUUID()}`,
          issueId: issue.id,
          type: "commented",
          actorName: authorName,
          actorAccountId: authorAccountId ?? null,
          detail: "",
          createdAt: now,
        });
        issue.updatedAt = now;
        result = { ok: true, reason: "ok", comment: { ...comment } };
      });
      return result;
    },
  };
}
