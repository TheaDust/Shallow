/**
 * Pull request reads and writes of one repository (REQ-6).
 *
 * Every write recomputes the viewer's permission from the persisted state and
 * applies the whole change in one atomic store update, so a refused creation
 * allocates no number, a refused check update keeps the stored result and a
 * stored change survives a restart. Each operation asks for the role it needs
 * instead of walking a ladder: Write, Maintain and Admin create pull requests,
 * comment and review, Maintain and Admin request reviewers, change the status
 * and merge, and only a repository Admin updates the check result.
 */

import { randomUUID } from "node:crypto";

import { newCommitId } from "./domain/file-edits.mjs";
import {
  PULL_REQUEST_MESSAGES,
  canManagePullRequests,
  canWritePullRequests,
  currentBaseCommitId,
  findPullRequest,
  isCheckStatus,
  isMergeMethod,
  isPullRequestStatus,
  mergeabilityOf,
  nextPullRequestNumber,
  normalizePullRequestText,
  pullRequestComparison,
  pullRequestDescriptionError,
  pullRequestTitleError,
  pullRequestsOfRepository,
  currentCompareCommitId,
  toPullRequestDetail,
  toPullRequestSummary,
} from "./domain/pull-requests.mjs";
import { fileContentAt, findCommit, revisionFiles } from "./domain/commit-graph.mjs";
import { canViewRepository, findRepository, toRepositoryContext } from "./domain/repositories.mjs";
import { effectiveRepositoryRole } from "./domain/repository-access.mjs";
import { createPullRequestReviewHandlers } from "./store-pull-request-reviews.mjs";

function failure(status, error, fields) {
  return { ok: false, status, error, fields: fields ?? {} };
}

/** Every file path that exists at one commit. */
function pathsAt(repository, commitId) {
  if (!commitId) return [];
  return revisionFiles(repository, commitId).map((file) => file.path);
}

/**
 * Writes the one commit a merge of this pull request creates (REQ-6-5). The
 * commit is written on the base branch: its first parent is the base-branch head
 * at merge time, its second parent is the current compare commit, and its
 * content transforms the base tree into the compare tree. So the base branch
 * keeps its history, receives the compare content and moves to the merge result,
 * which is exactly the `Create a merge commit` method the page offers.
 */
function mergeCompareBranch(
  repository,
  pullRequest,
  { baseHeadCommitId, compareCommitId, authorLogin, at },
) {
  const baseCommitId = baseHeadCommitId ?? pullRequest.baseCommitId;
  const paths = [...new Set([...pathsAt(repository, baseCommitId), ...pathsAt(repository, compareCommitId)])].sort();
  const changes = [];
  for (const path of paths) {
    const before = fileContentAt(repository, baseCommitId, path);
    const content = fileContentAt(repository, compareCommitId, path);
    if (before === content) continue;
    changes.push({
      path,
      changeType: before === null ? "added" : content === null ? "deleted" : "modified",
      content: content ?? null,
    });
  }
  const commit = {
    id: newCommitId(),
    branch: pullRequest.baseBranch,
    message: `Merge pull request #${pullRequest.number} from ${pullRequest.compareBranch}`,
    authorLogin,
    createdAt: at,
    parentId: baseCommitId,
    secondParentId: compareCommitId,
    changes,
  };
  repository.commits = repository.commits ?? [];
  repository.commits.push(commit);
  const reference = (repository.branches ?? []).find(
    (branch) => branch.name === pullRequest.baseBranch,
  );
  if (reference) reference.headCommitId = commit.id;
  repository.updatedAt = at;
  return commit;
}

export function createPullRequestHandlers({ jsonStore, resolveViewer }) {
  /** Resolves the repository of one request for a read, like the issue reads do. */
  function readRepository(state, sessionId, owner, name) {
    const viewer = resolveViewer(state, sessionId);
    const repository = findRepository(state, owner, name);
    if (!repository) return { status: 404 };
    if (!canViewRepository(state, repository, viewer)) return { status: viewer ? 403 : 404 };
    return { viewer, repository };
  }

  function payloadOf(state, repository, viewer, pullRequest) {
    return {
      repository: toRepositoryContext(repository, state, viewer, pullRequest.baseBranch),
      pullRequest: toPullRequestDetail(state, repository, viewer, pullRequest),
    };
  }

  /**
   * Applies the validated merge of one pull request: the merge commit is written
   * on the base branch, the pull request becomes terminal `merged` and the
   * merger, the time and the resulting commit identifier are stored with it. The
   * caller runs this inside one atomic store update, so a refused merge never
   * moves the base branch or the pull request.
   */
  function performMerge(repository, viewer, pullRequest) {
    const baseHeadCommitId = currentBaseCommitId(repository, pullRequest);
    const compareCommitId = currentCompareCommitId(repository, pullRequest);
    const at = new Date().toISOString();
    const commit = mergeCompareBranch(repository, pullRequest, {
      baseHeadCommitId,
      compareCommitId,
      authorLogin: viewer.username,
      at,
    });
    pullRequest.status = "merged";
    pullRequest.mergedById = viewer.id;
    pullRequest.mergedAt = at;
    pullRequest.mergeCommitId = commit.id;
    // The creation-time base commit stays as stored; only the current compare
    // commit is re-read, so the record keeps saying which comparison was merged.
    pullRequest.compareCommitId = compareCommitId ?? pullRequest.compareCommitId;
    pullRequest.updatedAt = at;
    pullRequest.activities = pullRequest.activities ?? [];
    pullRequest.activities.push({
      id: randomUUID(),
      type: "merged",
      actorId: viewer.id,
      createdAt: at,
      value: "merged",
      detail: commit.id,
    });
    return commit;
  }

  /**
   * The reasons that currently block a merge, in the order the merge area shows
   * them. The whole eligibility is recalculated here from the persisted state,
   * so a request that bypasses the page cannot merge an ineligible proposal.
   */
  function mergeRefusal(state, repository, pullRequest) {
    const mergeability = mergeabilityOf(state, repository, pullRequest);
    if (mergeability.mergeable) return null;
    return mergeability.reasons[0] ?? PULL_REQUEST_MESSAGES.notMergeable;
  }

  /** Rows of the Pull requests list: only the records of this repository. */
  async function listRepositoryPullRequests(sessionId, owner, name) {
    const state = await jsonStore.read();
    const loaded = readRepository(state, sessionId, owner, name);
    if (loaded.status) return loaded;
    const { repository, viewer } = loaded;
    return {
      status: 200,
      payload: {
        repository: toRepositoryContext(repository, state, viewer, repository.defaultBranch),
        pullRequests: pullRequestsOfRepository(state, repository.id).map((pullRequest) =>
          toPullRequestSummary(state, pullRequest, repository),
        ),
      },
    };
  }

  /**
   * The read-only comparison shown before a pull request exists (REQ-6-2-2).
   * Nothing is stored: the comparable commits, the changed files and the diff
   * are derived from the commits the two branches currently point at.
   */
  async function compareRepositoryPullRequestBranches(sessionId, owner, name, { base, compare } = {}) {
    const state = await jsonStore.read();
    const loaded = readRepository(state, sessionId, owner, name);
    if (loaded.status) return loaded;
    const { repository, viewer } = loaded;
    const baseBranch = String(base ?? "").trim();
    const compareBranch = String(compare ?? "").trim();
    const branchNames = (repository.branches ?? []).map((branch) => branch.name);
    if (!branchNames.includes(baseBranch) || !branchNames.includes(compareBranch)) {
      return failure(404, "Not found");
    }
    const comparison = pullRequestComparison(repository, baseBranch, compareBranch);
    const canCreate = canWritePullRequests(state, repository, viewer);
    const sameBranch = baseBranch === compareBranch;
    return {
      status: 200,
      payload: {
        repository: toRepositoryContext(repository, state, viewer, baseBranch),
        base: { name: baseBranch, headCommitId: comparison.baseCommitId },
        compare: { name: compareBranch, headCommitId: comparison.compareCommitId },
        sameBranch,
        commitCount: comparison.commitCount,
        commits: comparison.commits,
        changedFiles: comparison.changedFiles,
        filesChanged: comparison.filesChanged,
        additions: comparison.additions,
        deletions: comparison.deletions,
        // The creation entry is enabled only for a writer reading two different
        // branches that actually have comparable changes.
        canCreate:
          canCreate &&
          !sameBranch &&
          comparison.commitCount > 0 &&
          comparison.filesChanged > 0,
      },
    };
  }

  /** One pull request detail, addressed by its repository-scoped number. */
  async function getRepositoryPullRequest(sessionId, owner, name, number) {
    const state = await jsonStore.read();
    const loaded = readRepository(state, sessionId, owner, name);
    if (loaded.status) return loaded;
    const { repository, viewer } = loaded;
    const pullRequest = findPullRequest(state, repository.id, number);
    if (!pullRequest) {
      // A readable repository without that number is not an unknown address: the
      // page keeps the repository context and shows the number as absent.
      return {
        status: 404,
        missingPullRequest: true,
        repository: toRepositoryContext(repository, state, viewer, repository.defaultBranch),
      };
    }
    return { status: 200, payload: payloadOf(state, repository, viewer, pullRequest) };
  }

  /**
   * Creates one pull request from a valid comparison (REQ-6-2). The source and
   * target branches, both commits, the title, the description, the author and
   * the status are stored together, so a rejected creation leaves no record and
   * allocates no number. A submitted title is required and trimmed to 1–256
   * characters and a submitted description honours its own limit (REQ-6-2-3);
   * the comparison, the branch pair and the role are all re-checked here, so a
   * request that bypasses the creation form is refused just the same.
   */
  async function createRepositoryPullRequest(sessionId, owner, name, input = {}) {
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
      if (!canWritePullRequests(state, repository, viewer)) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotCreate);
        return;
      }
      // The creation form always submits the Title field, so an empty or
      // overlong title is refused here as well: a request that names no title
      // at all keeps the default of the compare branch's head message.
      const suppliedTitle = input.title === undefined || input.title === null ? null : input.title;
      const description = normalizePullRequestText(input.description);
      const descriptionComplaint = pullRequestDescriptionError(description);
      if (suppliedTitle !== null) {
        const titleComplaint = pullRequestTitleError(suppliedTitle);
        if (titleComplaint) {
          outcome = failure(400, "Pull request creation failed", { title: titleComplaint });
          return;
        }
      }
      if (descriptionComplaint) {
        outcome = failure(400, "Pull request creation failed", {
          description: descriptionComplaint,
        });
        return;
      }
      const baseBranch = String(input.base ?? input.baseBranch ?? "").trim();
      const compareBranch = String(input.compare ?? input.compareBranch ?? "").trim();
      const comparison = pullRequestComparison(repository, baseBranch, compareBranch);
      if (!comparison) {
        outcome = failure(400, "Pull request creation failed", {
          base: PULL_REQUEST_MESSAGES.sameBranch,
        });
        return;
      }
      if (baseBranch === compareBranch) {
        outcome = failure(400, "Pull request creation failed", {
          compare: PULL_REQUEST_MESSAGES.sameBranch,
        });
        return;
      }
      if (comparison.commitCount === 0 || comparison.filesChanged === 0) {
        outcome = failure(400, "Pull request creation failed", {
          compare: PULL_REQUEST_MESSAGES.noComparableCommits,
        });
        return;
      }
      const duplicate = (state.pullRequests ?? []).find(
        (candidate) =>
          candidate.repositoryId === repository.id &&
          candidate.baseBranch === baseBranch &&
          candidate.compareBranch === compareBranch &&
          (candidate.status === "draft" || candidate.status === "open"),
      );
      if (duplicate) {
        outcome = failure(400, "Pull request creation failed", {
          compare: PULL_REQUEST_MESSAGES.duplicate,
        });
        return;
      }

      const createdAt = new Date().toISOString();
      const headCommit = findCommit(repository, comparison.compareCommitId);
      const requestedTitle = normalizePullRequestText(suppliedTitle);
      const title = requestedTitle || (headCommit?.message ?? "").trim() || compareBranch;
      const pullRequest = {
        id: randomUUID(),
        repositoryId: repository.id,
        number: nextPullRequestNumber(state, repository.id),
        title,
        description,
        status: input.draft === true ? "draft" : "open",
        authorId: viewer.id,
        baseBranch,
        compareBranch,
        baseCommitId: comparison.baseCommitId,
        compareCommitId: comparison.compareCommitId,
        creationCompareCommitId: comparison.compareCommitId,
        createdAt,
        updatedAt: createdAt,
        comments: [],
        reviews: [],
        reviewerIds: [],
        activities: [
          {
            id: randomUUID(),
            type: "created",
            actorId: viewer.id,
            createdAt,
          },
        ],
      };
      state.pullRequests = state.pullRequests ?? [];
      state.pullRequests.push(pullRequest);
      outcome = { ok: true, status: 201, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  /**
   * Merges one pull request (REQ-6-5). Only Maintain, Admin or an organization
   * Owner merges, only an unmerged Open proposal is merged, and the whole
   * eligibility — the target-branch head, the current compare commit, the merge
   * conflicts and the protection rules of the target branch — is reread from the
   * persisted state before anything is written. The merge writes the base branch
   * (never a direct branch update) and stores the merger, the time and the
   * resulting commit identifier in one atomic update, so a refused merge leaves
   * both the base branch and the pull request unchanged.
   */
  async function mergeRepositoryPullRequest(sessionId, owner, name, number, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      const pullRequest = findPullRequest(state, repository.id, number);
      if (!pullRequest) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      // `Create a merge commit` is the only supported method, so any other
      // requested method is refused instead of silently merging differently.
      const method = String(input.method ?? "merge").trim().toLowerCase();
      if (!isMergeMethod(method)) {
        outcome = failure(400, "Merge failed", {
          method: PULL_REQUEST_MESSAGES.unknownMergeMethod,
        });
        return;
      }
      if (pullRequest.status === "draft") {
        outcome = failure(403, PULL_REQUEST_MESSAGES.draftMerge);
        return;
      }
      if (pullRequest.status === "merged") {
        outcome = failure(400, "Merge failed", { status: PULL_REQUEST_MESSAGES.mergedTerminal });
        return;
      }
      if (!canManagePullRequests(state, repository, viewer)) {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotMerge);
        return;
      }
      if (pullRequest.status !== "open") {
        outcome = failure(400, "Merge failed", { status: PULL_REQUEST_MESSAGES.notMergeable });
        return;
      }
      const refusal = mergeRefusal(state, repository, pullRequest);
      if (refusal) {
        outcome = failure(400, "Merge failed", { status: refusal });
        return;
      }
      performMerge(repository, viewer, pullRequest);
      outcome = { ok: true, status: 200, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  /**
   * Stores the `test` result of the pull request's current compare commit. Only
   * a repository Admin may update it; because the record is bound to that commit
   * id, a new compare commit reads as `pending` again.
   */
  async function savePullRequestCheckStatus(sessionId, owner, name, number, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      const pullRequest = findPullRequest(state, repository.id, number);
      if (!pullRequest) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (effectiveRepositoryRole(state, repository, viewer) !== "admin") {
        outcome = failure(403, PULL_REQUEST_MESSAGES.cannotSetChecks);
        return;
      }
      const status = String(input.status ?? "").trim().toLowerCase();
      if (!isCheckStatus(status)) {
        outcome = failure(400, "Check update failed", {
          status: PULL_REQUEST_MESSAGES.unknownCheck,
        });
        return;
      }
      const compareCommitId = pullRequest.compareCommitId;
      const at = new Date().toISOString();
      state.pullRequestChecks = state.pullRequestChecks ?? [];
      const existing = state.pullRequestChecks.find(
        (check) =>
          check.pullRequestId === pullRequest.id &&
          check.commitId === compareCommitId &&
          check.name === "test",
      );
      if (existing) {
        existing.status = status;
        existing.setById = viewer.id;
        existing.setAt = at;
      } else {
        state.pullRequestChecks.push({
          id: randomUUID(),
          pullRequestId: pullRequest.id,
          repositoryId: repository.id,
          commitId: compareCommitId,
          name: "test",
          status,
          setById: viewer.id,
          setAt: at,
        });
      }
      pullRequest.updatedAt = at;
      pullRequest.activities = pullRequest.activities ?? [];
      pullRequest.activities.push({
        id: randomUUID(),
        type: "check_status",
        actorId: viewer.id,
        createdAt: at,
        value: `test: ${status}`,
      });
      outcome = { ok: true, status: 200, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  /**
   * Status transitions and merging (REQ-6). The author or a maintainer marks a
   * draft ready, closes an unmerged pull request and reopens a closed one; only
   * Maintain, Admin or an organization Owner merges, and only while the base
   * branch's protection rule (when one exists) is satisfied. Merged is terminal.
   * Merging writes one commit on the base branch that brings the compare
   * branch's content into it, so the rule can never be bypassed by a direct
   * write to the protected branch.
   */
  async function updatePullRequestStatus(sessionId, owner, name, number, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      const pullRequest = findPullRequest(state, repository.id, number);
      if (!pullRequest) {
        outcome = failure(404, "Not found");
        return;
      }
      const status = String(input.status ?? "").trim().toLowerCase();
      if (!isPullRequestStatus(status)) {
        outcome = failure(400, "Status update failed", {
          status: PULL_REQUEST_MESSAGES.unknownStatus,
        });
        return;
      }
      if (pullRequest.status === "merged") {
        outcome = failure(400, "Status update failed", {
          status: PULL_REQUEST_MESSAGES.mergedTerminal,
        });
        return;
      }
      const isAuthor = Boolean(viewer) && viewer.id === pullRequest.authorId;
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      const canManage = canManagePullRequests(state, repository, viewer);
      const allowed = {
        // Draft → Open is "Ready for review"; Closed → Open reopens.
        open:
          (pullRequest.status === "draft" || pullRequest.status === "closed") &&
          (isAuthor || canManage),
        closed:
          (pullRequest.status === "open" || pullRequest.status === "draft") &&
          (isAuthor || canManage),
        merged: pullRequest.status === "open" && canManage,
        draft: false,
      }[status];
      if (!allowed) {
        outcome = failure(
          403,
          status === "merged"
            ? pullRequest.status === "draft"
              ? PULL_REQUEST_MESSAGES.draftMerge
              : PULL_REQUEST_MESSAGES.cannotMerge
            : PULL_REQUEST_MESSAGES.cannotChangeStatus,
        );
        return;
      }
      if (status === "merged" && !mergeabilityOf(state, repository, pullRequest).mergeable) {
        outcome = failure(400, "Merge failed", {
          status: mergeRefusal(state, repository, pullRequest) ?? PULL_REQUEST_MESSAGES.notMergeable,
        });
        return;
      }

      const previousStatus = pullRequest.status;
      const at = new Date().toISOString();
      if (status === "merged") {
        performMerge(repository, viewer, pullRequest);
        outcome = { ok: true, status: 200, payload: payloadOf(state, repository, viewer, pullRequest) };
        return;
      }
      pullRequest.status = status;
      pullRequest.updatedAt = at;
      pullRequest.activities = pullRequest.activities ?? [];
      pullRequest.activities.push({
        id: randomUUID(),
        type: status === "closed" ? "closed" : previousStatus === "closed" ? "reopened" : "ready_for_review",
        actorId: viewer.id,
        createdAt: at,
        value: status,
      });
      outcome = { ok: true, status: 200, payload: payloadOf(state, repository, viewer, pullRequest) };
    });
    return outcome;
  }

  // The discussion and review writes (REQ-6-3, REQ-6-4) live in their own
  // module and share these helpers, so every write reads the same repository and
  // answers with the same detail payload as the reads above.
  const reviews = createPullRequestReviewHandlers({
    jsonStore,
    readRepository,
    payloadOf,
    failure,
  });

  return {
    listRepositoryPullRequests,
    compareRepositoryPullRequestBranches,
    getRepositoryPullRequest,
    createRepositoryPullRequest,
    savePullRequestCheckStatus,
    updatePullRequestStatus,
    mergeRepositoryPullRequest,
    ...reviews,
  };
}
