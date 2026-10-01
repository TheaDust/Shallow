/**
 * Shared plumbing of the issue writes (REQ-5-2, REQ-5-3, REQ-5-4).
 *
 * Every write of an issue is one atomic store update built on these helpers:
 * the repository, the addressed issue and the role of the operation are
 * resolved inside the draft, so a rejected submission (missing permission,
 * unknown target, invalid input) changes nothing at all — no partial field, no
 * activity record and no consumed key.
 *
 * The role lists are those of the module, not a cumulative ladder (REQ-5): the
 * content writes need Write, Maintain or Admin, while assignment, labels,
 * milestones and the status need Triage, Maintain or Admin.
 */

import { randomUUID } from "node:crypto";

import { canReadRepository, effectiveRepositoryRole } from "./repository-access.mjs";

/** The issue of this repository carrying the number, or null. */
export function findIssueByNumber(draft, repository, number) {
  if (!Number.isInteger(number)) return null;
  return (draft.issues ?? []).find(
    (candidate) => candidate.repositoryId === repository.id && candidate.number === number,
  ) ?? null;
}

/** The next repository-scoped number: the stored maximum plus one. */
export function nextIssueNumber(draft, repository) {
  return (draft.issues ?? [])
    .filter((issue) => issue.repositoryId === repository.id)
    .reduce((highest, issue) => Math.max(highest, Number(issue.number) || 0), 0) + 1;
}

/**
 * Appends one record to the append-only activity history of an issue. The
 * history is never rewritten, so a later change leaves the earlier records —
 * including the ones describing relationships that no longer exist — in place.
 */
export function appendIssueEvent(issue, type, actor, text, createdAt) {
  if (!Array.isArray(issue.timeline)) issue.timeline = [];
  issue.timeline.push({ id: randomUUID(), type, actor, text, createdAt });
}

/**
 * One atomic update around an addressed issue: the repository, the issue and
 * the role the operation needs are resolved inside the draft. `roles` is the
 * operation-specific role list (REQ-5); a null list only needs a signed-in
 * viewer who may read the issue. Every accepted mutation updates `updatedAt`.
 */
export async function runIssueMutation(store, repositoryId, accountId, number, roles, mutate) {
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    const issue = findIssueByNumber(draft, repository, number);
    if (!issue) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const role = effectiveRepositoryRole(draft, repository, accountId);
    if (roles ? !roles.includes(role) : !canReadRepository(draft, repository, accountId)) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    outcome = mutate(draft, repository, issue, account) ?? { ok: true };
    return draft;
  });
  return outcome;
}
