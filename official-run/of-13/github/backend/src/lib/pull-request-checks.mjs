// The `Checks` area of one pull request: the results attached to its current
// compare commit.
//
// The product supports the single status check `test`, whose stored state is
// `pending`, `success` or `failure` together with the setter and the time.
// Reading is open to every viewer with repository-read permission; only a
// repository Admin may update the status from this area, and the stored
// permission is re-checked inside the same atomic update that stores the
// result. The record is bound to the current compare commit, so a new commit of
// the compare branch starts with `pending` again and the earlier result can
// never be reused for the merge of the new revision.

import { randomUUID } from "node:crypto";

import { canAdministerRepository } from "./access.mjs";
import { CHECK_NAME, CHECK_STATUSES, checkPayloadsOf } from "./pull-request-decisions.mjs";
import {
  PULL_REQUEST_MESSAGES,
  pullRequestByNumber,
  pullRequestDetailPayload,
  syncCompareCommit,
} from "./pull-requests.mjs";
import { collection, resolveRepositoryForViewer } from "./repository-code.mjs";

export const CHECK_MESSAGES = {
  ...PULL_REQUEST_MESSAGES,
  nameUnsupported: "Only the test check is supported",
  statusUnsupported: "Check status is not supported",
};

let clock = () => new Date().toISOString();

export function createPullRequestCheckService(store) {
  async function listForViewer(owner, repositoryName, number, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const pullRequest = pullRequestByNumber(state, resolved.repository.id, number);
    if (!pullRequest) return { status: "not-found" };
    return {
      status: "ok",
      checks: { checks: checkPayloadsOf(state, pullRequest) },
    };
  }

  async function setCheckForViewer(owner, repositoryName, number, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const name = typeof input?.name === "string" ? input.name.trim() : CHECK_NAME;
    const status = typeof input?.status === "string" ? input.status.trim() : "";
    const fieldErrors = {};
    if (name !== CHECK_NAME) fieldErrors.name = CHECK_MESSAGES.nameUnsupported;
    if (!CHECK_STATUSES.includes(status)) fieldErrors.status = CHECK_MESSAGES.statusUnsupported;
    if (Object.keys(fieldErrors).length > 0) {
      return {
        status: "invalid",
        error: PULL_REQUEST_MESSAGES.notUpdated,
        fieldErrors,
      };
    }

    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      const stored = pullRequestByNumber(state, repository.id, number);
      if (!stored) {
        outcome = { status: "not-found" };
        return;
      }
      // Only a repository Admin may set the status of the check from this area.
      if (!canAdministerRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      const updatedAt = clock();
      // The result always belongs to the compare commit of the compare branch
      // now, so an earlier result never leaks onto a newer revision.
      const pullRequest = syncCompareCommit(state, stored, updatedAt);
      const commitId = pullRequest.compareCommitId ?? null;
      const existing = collection(state, "pullRequestChecks").find(
        (check) =>
          check.pullRequestId === pullRequest.id &&
          check.commitId === commitId &&
          check.name === CHECK_NAME,
      );
      const record = existing
        ? { ...existing, status, updatedById: accountId, updatedAt }
        : {
            id: `pull-request-check-${randomUUID()}`,
            pullRequestId: pullRequest.id,
            commitId,
            name: CHECK_NAME,
            status,
            updatedById: accountId,
            createdAt: updatedAt,
            updatedAt,
          };
      state.pullRequestChecks = existing
        ? collection(state, "pullRequestChecks").map((check) =>
            check.id === record.id ? record : check,
          )
        : [...collection(state, "pullRequestChecks"), record];
      outcome = {
        status: "ok",
        detail: pullRequestDetailPayload(state, repository, pullRequest, accountId),
      };
    });
    return outcome;
  }

  return { listForViewer, setCheckForViewer };
}
