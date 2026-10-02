// Issue metadata operations: assigning and unassigning participants, applying
// and removing a label of the current repository, setting or clearing the
// single milestone association and closing or reopening the issue.
//
// Triage, Maintain and Admin own these operations; Write and Read may only
// view. Every operation runs as one indivisible write: the stored permission,
// the addressed issue and the input are validated before anything changes, and
// the association, its operator and its time are recorded together with an
// append-only activity record.

import { randomUUID } from "node:crypto";

import { canBeAssignedToIssue, canTriageRepository } from "./access.mjs";
import {
  issueByNumber,
  issueDetailPayload,
  labelsOfRepository,
  milestonesOfRepository,
} from "./issues.mjs";
import { collection, resolveRepositoryForViewer } from "./repository-code.mjs";

export const ISSUE_METADATA_MESSAGES = {
  notAuthenticated: "Not authenticated",
  notFound: "Not found",
  accessDenied: "Access denied",
  memberNotAssignable: "Member is not assignable",
  labelUnsupported: "Label is not supported",
  milestoneUnsupported: "Milestone is not supported",
  stateUnsupported: "State is not supported",
  metadataNotSaved: "Issue metadata not saved",
  stateNotSaved: "Issue state not saved",
};

let clock = () => new Date().toISOString();

/** The two states a close/reopen request may name, or null when it names none. */
export function requestedIssueState(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "open" || normalized === "reopen" || normalized === "reopened") {
    return "open";
  }
  if (normalized === "closed" || normalized === "close") return "closed";
  return null;
}

function hasField(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function event(type, issueId, actorId, createdAt, data = {}) {
  return { id: `issue-event-${randomUUID()}`, issueId, type, actorId, createdAt, data };
}

function text(source, ...keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

export function createIssueMetadataService(store) {
  /**
   * Runs one triage operation: the session, the repository, the stored role and
   * the addressed issue are re-read inside the same update that stores the
   * change, so a refused request leaves every relationship untouched. `apply`
   * either mutates the state and answers null, or answers the refusal to send.
   */
  async function mutate(owner, repositoryName, number, accountId, apply) {
    if (!accountId) return { status: "unauthorized" };
    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      if (!canTriageRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      const issue = issueByNumber(state, repository.id, number);
      if (!issue) {
        outcome = { status: "not-found" };
        return;
      }

      const refusal = apply(state, repository, issue);
      if (refusal) {
        outcome = refusal;
        return;
      }
      const updated = issueByNumber(state, repository.id, number) ?? issue;
      outcome = {
        status: "ok",
        detail: issueDetailPayload(state, repository, updated, accountId),
      };
    });
    return outcome;
  }

  /** Stores or deletes one issue-account relationship. */
  async function assignForViewer(owner, repositoryName, number, input, accountId) {
    const source = input ?? {};
    const username = text(source, "username", "assignee");
    return mutate(owner, repositoryName, number, accountId, (state, repository, issue) => {
      const account = collection(state, "accounts").find(
        (candidate) => candidate.username === username || candidate.email === username,
      );
      if (!account) {
        return {
          status: "invalid",
          error: ISSUE_METADATA_MESSAGES.metadataNotSaved,
          fieldErrors: { username: ISSUE_METADATA_MESSAGES.memberNotAssignable },
        };
      }
      const assigneeIds = Array.isArray(issue.assigneeIds) ? issue.assigneeIds : [];
      const assigned = assigneeIds.includes(account.id);
      const desired = typeof source.assigned === "boolean" ? source.assigned : !assigned;
      if (desired && !canBeAssignedToIssue(state, repository, account.id)) {
        return {
          status: "invalid",
          error: ISSUE_METADATA_MESSAGES.metadataNotSaved,
          fieldErrors: { username: ISSUE_METADATA_MESSAGES.memberNotAssignable },
        };
      }
      if (desired === assigned) return null;

      const updatedAt = clock();
      state.issues = collection(state, "issues").map((candidate) =>
        candidate.id === issue.id
          ? {
              ...candidate,
              assigneeIds: desired
                ? [...assigneeIds, account.id]
                : assigneeIds.filter((candidateId) => candidateId !== account.id),
              updatedAt,
            }
          : candidate,
      );
      state.issueEvents = [
        ...collection(state, "issueEvents"),
        event(desired ? "assigned" : "unassigned", issue.id, accountId, updatedAt, {
          assignee: account.username,
        }),
      ];
      return null;
    });
  }

  /** Stores or deletes one issue-label relationship of this repository. */
  async function labelForViewer(owner, repositoryName, number, input, accountId) {
    const source = input ?? {};
    const name = text(source, "name", "label", "labelName");
    return mutate(owner, repositoryName, number, accountId, (state, repository, issue) => {
      const label = labelsOfRepository(state, repository.id).find(
        (candidate) => candidate.name === name,
      );
      if (!label) {
        return {
          status: "invalid",
          error: ISSUE_METADATA_MESSAGES.metadataNotSaved,
          fieldErrors: { name: ISSUE_METADATA_MESSAGES.labelUnsupported },
        };
      }
      const labelIds = Array.isArray(issue.labelIds) ? issue.labelIds : [];
      const applied = labelIds.includes(label.id);
      const desired = typeof source.applied === "boolean" ? source.applied : !applied;
      if (desired === applied) return null;

      const updatedAt = clock();
      state.issues = collection(state, "issues").map((candidate) =>
        candidate.id === issue.id
          ? {
              ...candidate,
              labelIds: desired
                ? [...labelIds, label.id]
                : labelIds.filter((candidateId) => candidateId !== label.id),
              updatedAt,
            }
          : candidate,
      );
      state.issueEvents = [
        ...collection(state, "issueEvents"),
        event(desired ? "labeled" : "unlabeled", issue.id, accountId, updatedAt, {
          labelName: label.name,
        }),
      ];
      return null;
    });
  }

  /** Sets the single milestone association, or deletes it when `None` is named. */
  async function milestoneForViewer(owner, repositoryName, number, input, accountId) {
    const source = input ?? {};
    if (!hasField(source, "title") && !hasField(source, "milestone")) {
      return {
        status: "invalid",
        error: ISSUE_METADATA_MESSAGES.metadataNotSaved,
        fieldErrors: { title: ISSUE_METADATA_MESSAGES.milestoneUnsupported },
      };
    }
    const raw = hasField(source, "title") ? source.title : source.milestone;
    const title = typeof raw === "string" ? raw.trim() : null;

    return mutate(owner, repositoryName, number, accountId, (state, repository, issue) => {
      if (title === null || title.length === 0) {
        if (!issue.milestoneId) return null;
        const updatedAt = clock();
        state.issues = collection(state, "issues").map((candidate) =>
          candidate.id === issue.id
            ? { ...candidate, milestoneId: null, updatedAt }
            : candidate,
        );
        state.issueEvents = [
          ...collection(state, "issueEvents"),
          event("unmilestoned", issue.id, accountId, updatedAt),
        ];
        return null;
      }

      const milestone = milestonesOfRepository(state, repository.id).find(
        (candidate) => candidate.title === title,
      );
      if (!milestone) {
        return {
          status: "invalid",
          error: ISSUE_METADATA_MESSAGES.metadataNotSaved,
          fieldErrors: { title: ISSUE_METADATA_MESSAGES.milestoneUnsupported },
        };
      }
      if (issue.milestoneId === milestone.id) return null;

      const updatedAt = clock();
      state.issues = collection(state, "issues").map((candidate) =>
        candidate.id === issue.id
          ? { ...candidate, milestoneId: milestone.id, updatedAt }
          : candidate,
      );
      state.issueEvents = [
        ...collection(state, "issueEvents"),
        event("milestoned", issue.id, accountId, updatedAt, {
          milestoneTitle: milestone.title,
        }),
      ];
      return null;
    });
  }

  /**
   * Stores the Open or Closed status with its operator and time. The transition
   * only touches the status fields and appends its activity record, so the
   * title, the description, the comments, the labels, the assignees and the
   * milestone stay exactly as they were.
   */
  async function stateForViewer(owner, repositoryName, number, input, accountId) {
    const source = input ?? {};
    const desired = requestedIssueState(
      typeof source.state === "string"
        ? source.state
        : typeof source.action === "string"
          ? source.action
          : "",
    );
    if (!desired) {
      return {
        status: "invalid",
        error: ISSUE_METADATA_MESSAGES.stateNotSaved,
        fieldErrors: { state: ISSUE_METADATA_MESSAGES.stateUnsupported },
      };
    }

    return mutate(owner, repositoryName, number, accountId, (state, repository, issue) => {
      if (issue.state === desired) return null;
      const updatedAt = clock();
      state.issues = collection(state, "issues").map((candidate) =>
        candidate.id === issue.id
          ? {
              ...candidate,
              state: desired,
              updatedAt,
              closedAt: desired === "closed" ? updatedAt : null,
              closedById: desired === "closed" ? accountId : null,
            }
          : candidate,
      );
      state.issueEvents = [
        ...collection(state, "issueEvents"),
        event(desired === "closed" ? "closed" : "reopened", issue.id, accountId, updatedAt),
      ];
      return null;
    });
  }

  return { assignForViewer, labelForViewer, milestoneForViewer, stateForViewer };
}
