/**
 * Pull request writes (REQ-6, REQ-6-1, REQ-6-2).
 *
 * The Checks area of a pull request detail page stores the status of the `test`
 * check for the current compare commit together with its setter and time; only
 * a repository Admin may write it, which the server checks inside the same
 * atomic update that stores the result. Merging applies the requirements of the
 * rule bound to the base branch, so a protected base branch cannot be changed
 * by merging a pull request that does not satisfy its rule.
 *
 * Creating a pull request turns a valid branch comparison into a persisted
 * proposal to merge the compare branch into the base branch: the source and
 * target branches, the current compare commit, the creation-time base commit,
 * the title, the description, the author, the status and the first activity are
 * stored in one atomic update, and every refusal — a missing permission, an
 * empty or overlong title, the same branch chosen twice, no difference between
 * the branches or an already open proposal for the same pair — stores nothing.
 * Marking a draft ready for review moves the same pull request from Draft to
 * Open and appends the activity; it changes neither branches, commits, title
 * nor number.
 *
 * Closing and reopening change only the status of the proposal (REQ-6-6): the
 * author, a Maintain, an Admin or an organization Owner closes an unmerged Open
 * or Draft pull request and reopens a Closed one, while the discussion, the
 * reviews, the diff and the branch references stay viewable and no branch moves.
 * Merged is terminal, so a merged pull request refuses both transitions.
 *
 * A rejected write stores nothing: the check result, the branches and the pull
 * request stay exactly as they were.
 */

import { randomUUID } from "node:crypto";

import { REQUIRED_CHECK_NAME } from "./branch-protection.mjs";
import { COMMIT_ROLES, effectiveRepositoryRole } from "./repository-access.mjs";
import {
  commitSnapshot,
  findRepositoryBranch,
  findRepositoryCommit,
} from "./repository-branches.mjs";
import { diffSummary, revisionChanges } from "./repository-diff.mjs";
import {
  checkStatusValue,
  findRepositoryPullRequest,
  MAX_PULL_REQUEST_DESCRIPTION,
  MAX_PULL_REQUEST_TITLE,
  PULL_REQUEST_MESSAGES,
  pullRequestCheck,
  pullRequestChangedFiles,
  pullRequestMergeState,
  pullRequestStatus,
  repositoryPullRequests,
} from "./pull-requests.mjs";

function activity(actor, text, timestamp, type = "checks") {
  return { id: randomUUID(), type, actor, text, createdAt: timestamp };
}

/**
 * The changes the compare branch carries relative to the base branch: a
 * comparison of the two commits the branches point at right now, which stores
 * nothing (REQ-6-2-2). The comparison is the same read model the comparison
 * page and the created pull request use.
 */
export function branchComparison(repository, baseName, compareName) {
  const base = findRepositoryBranch(repository, baseName);
  const compare = findRepositoryBranch(repository, compareName);
  if (!base || !compare) return null;
  const baseCommit = findRepositoryCommit(repository, base.headId);
  const compareCommit = findRepositoryCommit(repository, compare.headId);
  const files = revisionChanges(
    baseCommit ? commitSnapshot(baseCommit) : [],
    compareCommit ? commitSnapshot(compareCommit) : [],
  );
  return {
    baseBranch: base.name,
    compareBranch: compare.name,
    baseCommitId: base.headId ?? null,
    compareCommitId: compare.headId ?? null,
    files,
    summary: diffSummary(files),
  };
}

/**
 * Creates a pull request from a valid branch comparison (REQ-6-2-3, REQ-6-2-4).
 *
 * A signed-in account with Write, Maintain, Admin or organization Owner status
 * stores the proposal in Draft or Open state. The stored record keeps the
 * repository-scoped number, the source and target branches, the current compare
 * commit, the creation-time base commit, the title, the description, the author,
 * the creation time and its first activity. Every refusal — no session, no
 * creation permission, an unknown branch, the same branch on both sides, an
 * empty or overlong title, an overlong description, no difference between the
 * branches or an already existing Draft/Open proposal for the same pair —
 * returns without storing a partial record.
 */
export async function createPullRequest(store, repositoryId, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account) {
      outcome = { ok: false, unauthorized: true };
      return undefined;
    }
    // Only Write, Maintain, Admin or an organization Owner may open a pull
    // request; Read and Triage may only view existing ones.
    if (!COMMIT_ROLES.includes(effectiveRepositoryRole(draft, repository, accountId))) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const baseName = typeof input.base === "string" ? input.base.trim() : "";
    const compareName = typeof input.compare === "string" ? input.compare.trim() : "";
    if (!findRepositoryBranch(repository, baseName) || !findRepositoryBranch(repository, compareName)) {
      outcome = {
        ok: false,
        errors: {
          ...(findRepositoryBranch(repository, baseName) ? {} : { base: PULL_REQUEST_MESSAGES.unknownBranch }),
          ...(findRepositoryBranch(repository, compareName) ? {} : { compare: PULL_REQUEST_MESSAGES.unknownBranch }),
        },
      };
      return undefined;
    }

    const title = typeof input.title === "string" ? input.title.trim() : "";
    const description = typeof input.description === "string" ? input.description : "";
    const errors = {};
    if (!title) errors.title = PULL_REQUEST_MESSAGES.titleRequired;
    else if (title.length > MAX_PULL_REQUEST_TITLE) errors.title = PULL_REQUEST_MESSAGES.titleTooLong;
    if (description.length > MAX_PULL_REQUEST_DESCRIPTION) {
      errors.description = PULL_REQUEST_MESSAGES.descriptionTooLong;
    }
    if (baseName === compareName) errors.compare = PULL_REQUEST_MESSAGES.sameBranches;
    if (Object.keys(errors).length > 0) {
      outcome = { ok: false, errors };
      return undefined;
    }

    const comparison = branchComparison(repository, baseName, compareName);
    if (!comparison || comparison.files.length === 0) {
      outcome = { ok: false, errors: { compare: PULL_REQUEST_MESSAGES.noChanges } };
      return undefined;
    }

    // The same repository must not hold a second Draft or Open proposal for the
    // same source/target pair; a Closed or Merged one does not block a new one.
    const duplicate = repositoryPullRequests(draft, repository).find(
      (pullRequest) => pullRequest.baseBranch === baseName
        && pullRequest.compareBranch === compareName
        && ["draft", "open"].includes(pullRequestStatus(pullRequest)),
    );
    if (duplicate) {
      outcome = { ok: false, duplicate: true, number: duplicate.number, errors: { compare: PULL_REQUEST_MESSAGES.duplicatePair } };
      return undefined;
    }

    const status = input.draft === true ? "draft" : "open";
    const timestamp = new Date().toISOString();
    const number = repositoryPullRequests(draft, repository)
      .reduce((highest, pullRequest) => Math.max(highest, Number(pullRequest.number ?? 0)), 0) + 1;
    const pullRequest = {
      id: randomUUID(),
      repositoryId: repository.id,
      number,
      title,
      description,
      authorId: account.id,
      author: account.username,
      status,
      baseBranch: baseName,
      compareBranch: compareName,
      baseCommitId: comparison.baseCommitId,
      compareCommitId: comparison.compareCommitId,
      currentCompareCommitId: comparison.compareCommitId,
      reviewers: [],
      reviews: [],
      comments: [],
      checks: [],
      timeline: [
        activity(
          account.username,
          status === "draft" ? "opened this draft pull request" : "opened this pull request",
          timestamp,
          "created",
        ),
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!Array.isArray(draft.pullRequests)) draft.pullRequests = [];
    draft.pullRequests.push(pullRequest);
    repository.updatedAt = timestamp;
    outcome = { ok: true, number, status };
    return draft;
  });
  return outcome;
}

/**
 * Moves a draft pull request to Open (REQ-6-2-4). Only the author, Maintain,
 * Admin or an organization Owner may do it; the same pull request keeps its
 * number, title, description, branches and commits and gains one activity
 * record. A pull request that is not a draft, or that vanished, is refused
 * without changing anything.
 */
export async function markPullRequestReadyForReview(store, repositoryId, number, accountId) {
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account) {
      outcome = { ok: false, unauthorized: true };
      return undefined;
    }
    const pullRequest = findRepositoryPullRequest(draft, repository, number);
    if (!pullRequest) {
      outcome = { ok: false, pullRequestMissing: true };
      return undefined;
    }
    const role = effectiveRepositoryRole(draft, repository, accountId);
    const isAuthor = pullRequest.authorId === accountId;
    const maintainer = role === "Maintain" || role === "Admin";
    if (!isAuthor && !maintainer) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    if (pullRequestStatus(pullRequest) !== "draft") {
      outcome = { ok: false, notDraft: true };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    pullRequest.status = "open";
    pullRequest.readyForReviewAt = timestamp;
    pullRequest.updatedAt = timestamp;
    pullRequest.timeline = Array.isArray(pullRequest.timeline) ? pullRequest.timeline : [];
    pullRequest.timeline.push(
      activity(account.username, "marked this pull request as Ready for review", timestamp, "ready_for_review"),
    );
    repository.updatedAt = timestamp;
    outcome = { ok: true, number: Number(pullRequest.number) };
    return draft;
  });
  return outcome;
}

/**
 * Changes the status of an unmerged pull request (REQ-6-6).
 *
 * `action` is `close` or `reopen`. Only the author, a Maintain, an Admin or an
 * organization Owner may do it: closing needs an Open or Draft pull request,
 * reopening a Closed one, and a merged pull request refuses both because Merged
 * is terminal. The write stores the status, the operator and the time and
 * appends the transition to the activity records; it neither merges commits nor
 * updates a branch, and every refusal leaves the pull request unchanged.
 */
export async function changePullRequestStatus(store, repositoryId, number, accountId, action) {
  const reopening = action === "reopen";
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account) {
      outcome = { ok: false, unauthorized: true };
      return undefined;
    }
    const pullRequest = findRepositoryPullRequest(draft, repository, number);
    if (!pullRequest) {
      outcome = { ok: false, pullRequestMissing: true };
      return undefined;
    }
    const role = effectiveRepositoryRole(draft, repository, accountId);
    const isAuthor = pullRequest.authorId === accountId;
    if (!isAuthor && role !== "Maintain" && role !== "Admin") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const status = pullRequestStatus(pullRequest);
    if (reopening ? status !== "closed" : status !== "open" && status !== "draft") {
      // Merged is terminal, and a closed pull request cannot be closed twice.
      outcome = { ok: false, notAllowed: true, status };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    pullRequest.status = reopening ? "open" : "closed";
    if (reopening) pullRequest.reopenedAt = timestamp;
    else pullRequest.closedAt = timestamp;
    pullRequest.updatedAt = timestamp;
    pullRequest.timeline = Array.isArray(pullRequest.timeline) ? pullRequest.timeline : [];
    pullRequest.timeline.push({
      id: randomUUID(),
      type: reopening ? "reopened" : "closed",
      actor: account.username,
      text: reopening ? "reopened this pull request" : "closed this pull request",
      createdAt: timestamp,
    });
    outcome = { ok: true, status: pullRequest.status };
    return draft;
  });
  return outcome;
}

/**
 * Stores the status of one check of the pull request's current compare commit
 * (REQ-6-1). Only a repository Admin may update it; a non-Admin request is
 * refused and no result is stored.
 */
export async function updatePullRequestCheck(store, repositoryId, number, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account) {
      outcome = { ok: false, unauthorized: true };
      return undefined;
    }
    const pullRequest = findRepositoryPullRequest(draft, repository, number);
    if (!pullRequest) {
      outcome = { ok: false, pullRequestMissing: true };
      return undefined;
    }
    // Only a repository Admin (or an organization Owner) may update the check
    // status from the Checks area.
    if (effectiveRepositoryRole(draft, repository, accountId) !== "Admin") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : REQUIRED_CHECK_NAME;
    const status = checkStatusValue(input.status);
    if (!status) {
      outcome = { ok: false, errors: { status: PULL_REQUEST_MESSAGES.checkStatusUnknown } };
      return undefined;
    }

    const current = pullRequestCheck(repository, pullRequest);
    const commitId = current.commitId;
    const timestamp = new Date().toISOString();
    if (!Array.isArray(pullRequest.checks)) pullRequest.checks = [];
    const existing = pullRequest.checks.find(
      (check) => check && check.name === name && String(check.commitId ?? "") === String(commitId),
    );
    if (existing) {
      existing.status = status;
      existing.setBy = account.username;
      existing.setById = account.id;
      existing.setAt = timestamp;
    } else {
      pullRequest.checks.push({
        id: randomUUID(),
        name,
        commitId,
        status,
        setBy: account.username,
        setById: account.id,
        setAt: timestamp,
      });
    }
    pullRequest.timeline = Array.isArray(pullRequest.timeline) ? pullRequest.timeline : [];
    pullRequest.timeline.push(
      activity(account.username, `set the ${name} check to ${status}`, timestamp),
    );
    pullRequest.updatedAt = timestamp;
    repository.updatedAt = timestamp;
    outcome = { ok: true, status, name, commitId };
    return draft;
  });
  return outcome;
}

/**
 * Merges the compare branch of a pull request into its base branch (REQ-6).
 * Only Maintain, Admin or an organization Owner may merge, the pull request has
 * to be open, and the rule bound to the base branch has to be satisfied. The
 * accepted merge records one commit on the base branch and marks the pull
 * request Merged, which is terminal.
 */
export async function mergePullRequest(store, repositoryId, number, accountId) {
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account) {
      outcome = { ok: false, unauthorized: true };
      return undefined;
    }
    const pullRequest = findRepositoryPullRequest(draft, repository, number);
    if (!pullRequest) {
      outcome = { ok: false, pullRequestMissing: true };
      return undefined;
    }
    // Only Maintain, Admin or an organization Owner (an Admin) may merge.
    const role = effectiveRepositoryRole(draft, repository, accountId);
    if (role !== "Maintain" && role !== "Admin") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const merge = pullRequestMergeState(repository, pullRequest);
    if (!merge.mergeable) {
      outcome = { ok: false, blocked: true, merge };
      return undefined;
    }

    const baseBranch = findRepositoryBranch(repository, pullRequest.baseBranch);
    const compareCommitId = pullRequestCheck(repository, pullRequest).commitId;
    const timestamp = new Date().toISOString();
    const changed = pullRequestChangedFiles(repository, pullRequest).map((file) => ({
      path: file.path,
      change: file.change,
    }));
    const tree = (repository.commits ?? []).find((commit) => commit?.id === compareCommitId);
    const mergeCommit = {
      id: randomUUID(),
      message: `Merge pull request #${pullRequest.number} from ${pullRequest.compareBranch}`,
      authorId: account.id,
      author: account.username,
      branch: baseBranch?.name ?? pullRequest.baseBranch,
      parentId: baseBranch?.headId ?? null,
      createdAt: timestamp,
      files: changed,
      tree: tree ? commitSnapshot(tree) : [],
    };
    if (!Array.isArray(repository.commits)) repository.commits = [];
    repository.commits.push(mergeCommit);
    if (baseBranch) baseBranch.headId = mergeCommit.id;
    repository.updatedAt = timestamp;

    pullRequest.status = "merged";
    pullRequest.mergedAt = timestamp;
    pullRequest.mergedBy = account.username;
    pullRequest.mergeCommitId = mergeCommit.id;
    pullRequest.updatedAt = timestamp;
    pullRequest.timeline = Array.isArray(pullRequest.timeline) ? pullRequest.timeline : [];
    pullRequest.timeline.push({
      id: randomUUID(),
      type: "merged",
      actor: account.username,
      text: "merged this pull request",
      createdAt: timestamp,
    });
    outcome = { ok: true, mergeCommitId: mergeCommit.id };
    return draft;
  });
  return outcome;
}
