/**
 * Issue metadata and status writes (REQ-5-3, REQ-5-4).
 *
 * An “Assignee” is an account associated with an issue and a “Label” one of the
 * pre-existing classification names of the repository; a “Milestone” is one of
 * the pre-existing goals of the repository, and an issue references at most one
 * of them. Every association stores only the issue relationship: assigning an
 * account never changes its repository role, applying a label never creates one,
 * and setting a milestone never creates a cross-repository item.
 *
 * Only Triage, Maintain and Admin may change this metadata or the status
 * (`ISSUE_TRIAGE_ROLES`); Read and Write may only view it. Each accepted change
 * appends one activity record, and the status change touches nothing but the
 * status, so the number, title, description, comments, labels, assignees and
 * milestone of the work item stay exactly as they were.
 */

import {
  ISSUE_MESSAGES,
  ISSUE_STATUSES,
  ISSUE_TRIAGE_ROLES,
  repositoryAssignableMembers,
} from "./issues.mjs";
import {
  appendIssueEvent,
  findIssueByNumber,
  runIssueMutation,
} from "./issue-mutations.mjs";

function trimmed(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/** The pre-existing label of this repository carrying the name, or null. */
function findRepositoryLabel(repository, name) {
  return (repository.labels ?? []).find((label) => label.name === name) ?? null;
}

/** The pre-existing milestone of this repository carrying the title, or null. */
function findRepositoryMilestone(repository, title) {
  return (repository.milestones ?? []).find((milestone) => milestone.title === title) ?? null;
}

/**
 * Adds or removes one issue-account association (REQ-5-3-1).
 *
 * The username must belong to an account holding at least Triage permission on
 * the repository; the account is stored by its username so the metadata of the
 * issue spells it exactly, and the repository grants of the account are never
 * touched. Removing the association deletes only this relationship, so the
 * account and its permission survive.
 */
export async function toggleIssueAssignee(store, repositoryId, accountId, number, input) {
  return runIssueMutation(store, repositoryId, accountId, number, ISSUE_TRIAGE_ROLES, (draft, repository, issue, account) => {
    const name = trimmed(input.username);
    if (!name) return { ok: false, errors: { assignee: ISSUE_MESSAGES.unknownAssignee } };
    if (!repositoryAssignableMembers(draft, repository).includes(name)) {
      return { ok: false, errors: { assignee: ISSUE_MESSAGES.unknownAssignee } };
    }
    if (!Array.isArray(issue.assignees)) issue.assignees = [];
    const index = issue.assignees.indexOf(name);
    const at = new Date().toISOString();
    if (index >= 0) {
      issue.assignees.splice(index, 1);
      appendIssueEvent(issue, "unassigned", account.username, `unassigned ${name}`, at);
    } else {
      issue.assignees.push(name);
      appendIssueEvent(issue, "assigned", account.username, `assigned ${name}`, at);
    }
    issue.updatedAt = at;
    repository.updatedAt = at;
    return { ok: true, removed: index >= 0 };
  });
}

/**
 * Adds or removes one issue-label association (REQ-5-3-2). Only a label that
 * already exists in this repository can be applied: a name of another
 * repository is rejected, and no submission creates a label.
 */
export async function toggleIssueLabel(store, repositoryId, accountId, number, input) {
  return runIssueMutation(store, repositoryId, accountId, number, ISSUE_TRIAGE_ROLES, (draft, repository, issue, account) => {
    const name = trimmed(input.label);
    if (!name || !findRepositoryLabel(repository, name)) {
      return { ok: false, errors: { label: ISSUE_MESSAGES.unknownLabel } };
    }
    if (!Array.isArray(issue.labels)) issue.labels = [];
    const index = issue.labels.indexOf(name);
    const at = new Date().toISOString();
    if (index >= 0) {
      issue.labels.splice(index, 1);
      appendIssueEvent(issue, "unlabeled", account.username, `removed the ${name} label`, at);
    } else {
      issue.labels.push(name);
      appendIssueEvent(issue, "labeled", account.username, `added the ${name} label`, at);
    }
    issue.updatedAt = at;
    repository.updatedAt = at;
    return { ok: true, removed: index >= 0 };
  });
}

/**
 * Associates the issue with one milestone of the repository, or removes the
 * association (REQ-5-3-3). A work item carries at most one milestone, so
 * selecting another one replaces the stored title; an empty value, `null` or
 * the literal `None` of the selector removes it. Only a milestone that already
 * exists in this repository can be selected.
 */
export async function setIssueMilestone(store, repositoryId, accountId, number, input) {
  return runIssueMutation(store, repositoryId, accountId, number, ISSUE_TRIAGE_ROLES, (draft, repository, issue, account) => {
    const raw = trimmed(input.milestone);
    const previous = issue.milestone ?? null;
    const at = new Date().toISOString();
    if (!raw || raw === "None") {
      if (!previous) return { ok: true, unchanged: true };
      issue.milestone = null;
      issue.updatedAt = at;
      appendIssueEvent(issue, "unmilestoned", account.username, `removed this issue from the ${previous} milestone`, at);
      repository.updatedAt = at;
      return { ok: true, removed: true };
    }
    if (!findRepositoryMilestone(repository, raw)) {
      return { ok: false, errors: { milestone: ISSUE_MESSAGES.unknownMilestone } };
    }
    if (previous === raw) return { ok: true, unchanged: true };
    issue.milestone = raw;
    issue.updatedAt = at;
    appendIssueEvent(issue, "milestoned", account.username, `added this issue to the ${raw} milestone`, at);
    repository.updatedAt = at;
    return { ok: true };
  });
}

/**
 * Closes or reopens the issue (REQ-5-4). Only the stored status, the update
 * time and one activity record change; the number, title, description,
 * comments, labels, assignees and milestone are left untouched, and closing an
 * already closed issue (or reopening an open one) is a no-op that stores
 * nothing.
 */
export async function changeIssueStatus(store, repositoryId, accountId, number, input) {
  return runIssueMutation(store, repositoryId, accountId, number, ISSUE_TRIAGE_ROLES, (draft, repository, issue, account) => {
    const next = trimmed(input.status).toLowerCase();
    if (!ISSUE_STATUSES.includes(next)) {
      return { ok: false, errors: { status: ISSUE_MESSAGES.unknownStatus } };
    }
    if (issue.status === next) return { ok: true, unchanged: true };
    const at = new Date().toISOString();
    issue.status = next;
    issue.updatedAt = at;
    // The visible activity names the transition: closing records a “Closed
    // issue” event and reopening the matching reopen event, in order.
    appendIssueEvent(
      issue,
      next === "closed" ? "closed" : "reopened",
      account.username,
      next === "closed" ? "Closed issue" : "Reopened issue",
      at,
    );
    repository.updatedAt = at;
    return { ok: true };
  });
}
