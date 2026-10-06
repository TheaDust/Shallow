// Persistence of pull requests (REQ-6): the proposal to merge one branch into
// another, its status checks, its discussion and its activity timeline.
//
// A pull request is identified by its repository plus its repository-scoped
// number, so two repositories may both hold a PR #1. It stores the source and
// target branches, the creation-time base commit, the creation-time compare
// commit and the persisted status. The *current* compare commit is derived from
// the source branch head, so a new commit on the compare branch is reflected by
// the same stored proposal instead of a second copy of the branch state.
//
// A status transition and its activity record are written in one store update,
// so a rejected transition leaves the stored status unchanged.

import { randomUUID } from "node:crypto";

import { MERGE_MESSAGES } from "./pull-request-rules.mjs";
import { diffFileSnapshots } from "./text-diff.mjs";
import { findBranch, headCommitOfBranch, publicCommit } from "./repository-code-store.mjs";

const COLLECTIONS = [
  "pullRequests",
  "pullRequestComments",
  "pullRequestEvents",
  "pullRequestReviews",
  "pullRequestReviewComments",
];

function normalize(state) {
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  for (const pull of state.pullRequests) {
    if (!Array.isArray(pull.requestedReviewers)) pull.requestedReviewers = [];
  }
  return state;
}

function findCommit(state, commitId) {
  if (!commitId) return null;
  return state.commits.find((entry) => entry.id === commitId) ?? null;
}

/** One branch chain, head first, walked through the stored parent links. */
function chainOf(state, repositoryId, branchName) {
  const ordered = [];
  const seen = new Set();
  let cursor = headCommitOfBranch(state, repositoryId, branchName);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    ordered.push(cursor);
    cursor = findCommit(state, cursor.parentCommitId);
  }
  return ordered;
}

function byRecency(left, right) {
  const difference = Date.parse(right.commit.createdAt) - Date.parse(left.commit.createdAt);
  return difference !== 0 ? difference : right.index - left.index;
}

/** The transitions a persisted status may still take (Merged is terminal). */
function allowedTransition(from, to) {
  if (from === to) return true;
  if (from === "merged") return false;
  if (to === "open") return from === "draft" || from === "closed";
  if (to === "closed") return from === "draft" || from === "open";
  return false;
}

function transitionEventType(from, to) {
  if (to === "closed") return "closed";
  if (from === "draft" && to === "open") return "ready-for-review";
  return "reopened";
}

export function createPullRequestStore(store) {
  async function readState() {
    return normalize(await store.read());
  }

  const findPull = (state, repositoryId, number) =>
    state.pullRequests.find(
      (entry) => entry.repositoryId === repositoryId && entry.number === number,
    ) ?? null;

  /** The revision the comparison currently reads: the source branch head. */
  const compareCommitOf = (state, pull) =>
    headCommitOfBranch(state, pull.repositoryId, pull.sourceBranch);

  const baseCommitOf = (state, pull) => findCommit(state, pull.baseCommitId);

  /** The repository-scoped milestone of one pull request, if it holds one. */
  function milestoneOf(state, pull) {
    if (!pull.milestoneId) return null;
    const milestone = (state.milestones ?? []).find((entry) => entry.id === pull.milestoneId);
    return milestone ? { name: milestone.name } : null;
  }

  function describePull(state, pull) {
    const compare = compareCommitOf(state, pull);
    return {
      number: pull.number,
      title: pull.title,
      description: pull.description ?? "",
      status: pull.status,
      author: pull.authorName,
      sourceBranch: pull.sourceBranch,
      targetBranch: pull.targetBranch,
      createdAt: pull.createdAt,
      updatedAt: pull.updatedAt,
      commentCount: state.pullRequestComments.filter(
        (entry) => entry.pullRequestId === pull.id,
      ).length,
      compareCommitId: compare?.id ?? null,
      creationCompareCommitId: pull.creationCompareCommitId ?? null,
      baseCommitId: pull.baseCommitId ?? null,
      mergedBy: pull.mergedByName ?? null,
      mergedAt: pull.mergedAt ?? null,
      mergedCommitId: pull.mergedCommitId ?? null,
      milestone: milestoneOf(state, pull),
    };
  }

  /** The persistent protection rule bound to the exact target branch, if any. */
  function protectionRuleFor(state, pull) {
    return (
      (state.branchProtectionRules ?? []).find(
        (rule) => rule.repositoryId === pull.repositoryId && rule.branchName === pull.targetBranch,
      ) ?? null
    );
  }

  /**
   * Whether the compare changes can be applied over the current target head. A
   * conflict is reported when the target branch moved past the stored base
   * commit and touched a file the compare branch also changed; the seeded
   * proposals keep the target head at the creation-time base commit.
   */
  function hasMergeConflict(state, pull) {
    const target = findBranch(state, pull.repositoryId, pull.targetBranch);
    const targetHeadId = target?.headCommitId ?? null;
    const baseId = pull.baseCommitId ?? null;
    if (!targetHeadId || !baseId || targetHeadId === baseId) return false;
    const baseFiles = new Map(
      (findCommit(state, baseId)?.files ?? []).map((file) => [file.path, String(file.content ?? "")]),
    );
    const targetFiles = new Map(
      (findCommit(state, targetHeadId)?.files ?? []).map((file) => [file.path, String(file.content ?? "")]),
    );
    const compare = compareCommitOf(state, pull);
    for (const file of compare?.files ?? []) {
      const before = baseFiles.get(file.path);
      const after = String(file.content ?? "");
      if (after === before) continue;
      if (targetFiles.has(file.path) !== baseFiles.has(file.path)) return true;
      if (targetFiles.has(file.path) && targetFiles.get(file.path) !== before) return true;
    }
    return false;
  }

  /**
   * Merge eligibility of one pull request (REQ-6-5): the protect rule of the
   * exact target branch is enforced rule by rule, while every target still
   * requires no merge conflict and no valid `Request changes` review.
   */
  function mergeStateOf(state, pull) {
    const rule = protectionRuleFor(state, pull);
    const compareId = compareCommitOf(state, pull)?.id ?? null;
    const validReviews = state.pullRequestReviews.filter(
      (entry) => entry.pullRequestId === pull.id && (entry.commitId ?? null) === compareId,
    );
    const changesRequested = validReviews.some((entry) => entry.decision === "changes-requested");
    const approvals = validReviews.filter(
      (entry) => entry.decision === "approved" && entry.reviewerName !== pull.authorName,
    ).length;
    const checks = checksOf(state, pull);
    const approvalRequired = rule?.requireApprovals === true;
    const checkRequired = rule?.requireStatusCheck === true;
    const checkName = rule?.statusCheckName ?? "test";
    const approvalSatisfied = !approvalRequired || approvals >= 1;
    const checkSatisfied =
      !checkRequired || checks.some((check) => check.name === checkName && check.status === "success");
    const conflict = hasMergeConflict(state, pull);
    const open = pull.status === "open";

    const conditions = [
      { key: "conflicts", label: "No merge conflicts", satisfied: !conflict },
      { key: "changes-requested", label: "No changes requested", satisfied: !changesRequested },
    ];
    if (approvalRequired) {
      conditions.push({ key: "approval", label: "At least 1 approval", satisfied: approvalSatisfied });
    }
    if (checkRequired) {
      conditions.push({ key: "check", label: `Status check ${checkName}`, satisfied: checkSatisfied });
    }

    const eligible = open && conditions.every((entry) => entry.satisfied);
    let blockedReason = null;
    if (!open) blockedReason = MERGE_MESSAGES.notOpen;
    else if (conflict) blockedReason = MERGE_MESSAGES.conflict;
    else if (changesRequested) blockedReason = MERGE_MESSAGES.changesRequested;
    else if (!approvalSatisfied) blockedReason = MERGE_MESSAGES.reviewRequired;
    else if (!checkSatisfied) blockedReason = MERGE_MESSAGES.checkRequired;

    return {
      eligible,
      method: "Create a merge commit",
      conditions,
      reviewRequired: approvalRequired && !approvalSatisfied,
      blockedReason,
    };
  }

  /** Commits the compare branch adds on top of the base branch, newest first. */
  function commitsRelativeToBase(state, pull) {
    const compareChain = chainOf(state, pull.repositoryId, pull.sourceBranch);
    const reachableFromBase = new Set();
    const seen = new Set();
    let cursor = baseCommitOf(state, pull);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      reachableFromBase.add(cursor.id);
      cursor = findCommit(state, cursor.parentCommitId);
    }
    return compareChain
      .map((commit, index) => ({ commit, index }))
      .filter(({ commit }) => !reachableFromBase.has(commit.id))
      .sort(byRecency)
      .map(({ commit }) => publicCommit(commit));
  }

  function changesOf(state, pull) {
    const base = baseCommitOf(state, pull);
    const compare = compareCommitOf(state, pull);
    return diffFileSnapshots(base?.files ?? [], compare?.files ?? []);
  }

  /** Checks recorded for the revision the comparison currently reads. */
  function checksOf(state, pull) {
    const compare = compareCommitOf(state, pull);
    const commitId = compare?.id ?? null;
    return (pull.checks ?? [])
      .filter((entry) => entry.commitId === commitId || entry.commitId === undefined)
      .map((entry) => ({
        name: entry.name,
        status: entry.status,
        setter: entry.setter ?? null,
      }));
  }

  function detailOf(state, pull) {
    const base = baseCommitOf(state, pull);
    const compare = compareCommitOf(state, pull);
    const compareId = compare?.id ?? null;
    return {
      pullRequest: describePull(state, pull),
      baseCommit: base ? publicCommit(base) : null,
      compareCommit: compare ? publicCommit(compare) : null,
      commits: commitsRelativeToBase(state, pull),
      changes: changesOf(state, pull).files,
      totals: changesOf(state, pull).totals,
      checks: checksOf(state, pull),
      comments: state.pullRequestComments
        .filter((entry) => entry.pullRequestId === pull.id)
        .map((entry) => ({
          id: entry.id,
          author: entry.authorName,
          body: entry.body,
          createdAt: entry.createdAt,
        })),
      // Line comments stay anchored to the revision they were written on; a
      // later revision of the compare branch marks them Outdated instead of
      // moving or dropping them.
      reviewComments: state.pullRequestReviewComments
        .filter((entry) => entry.pullRequestId === pull.id)
        .map((entry) => ({
          id: entry.id,
          author: entry.authorName,
          body: entry.body,
          filePath: entry.filePath,
          lineIndex: entry.lineIndex,
          state: entry.state,
          commitId: entry.commitId ?? null,
          outdated: (entry.commitId ?? null) !== compareId,
          createdAt: entry.createdAt,
        })),
      events: state.pullRequestEvents
        .filter((entry) => entry.pullRequestId === pull.id)
        .map((entry) => ({
          id: entry.id,
          type: entry.type,
          actor: entry.actorName,
          detail: entry.detail ?? "",
          createdAt: entry.createdAt,
        })),
      reviews: state.pullRequestReviews
        .filter((entry) => entry.pullRequestId === pull.id)
        .map((entry) => ({
          id: entry.id,
          reviewer: entry.reviewerName,
          decision: entry.decision,
          summary: entry.summary ?? "",
          commitId: entry.commitId ?? null,
          // A review written for an earlier revision stays in the timeline but
          // no longer decides the merge (REQ-6).
          stale: (entry.commitId ?? null) !== compareId,
          createdAt: entry.createdAt,
        })),
      requestedReviewers: [...(pull.requestedReviewers ?? [])],
      merge: mergeStateOf(state, pull),
    };
  }

  return {
    /** The persisted pull requests of one repository, newest number first. */
    async listPullRequests(repositoryId) {
      const state = await readState();
      return state.pullRequests
        .filter((entry) => entry.repositoryId === repositoryId)
        .sort((left, right) => right.number - left.number)
        .map((pull) => describePull(state, pull));
    },

    /** One pull request with its comparison, checks, discussion and timeline. */
    async getPullRequest(repositoryId, number) {
      const state = await readState();
      const pull = findPull(state, repositoryId, number);
      if (!pull) return null;
      return detailOf(state, pull);
    },

    /**
     * The comparison of two branches of one repository: the commits the compare
     * branch adds on top of the base branch and the per-file differences. An
     * unknown branch answers `null`.
     */
    async compareBranches(repositoryId, { base = "", compare = "" } = {}) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return null;
      const baseName = base || repository.defaultBranch || "main";
      const compareName = compare || baseName;
      const baseBranch = findBranch(state, repositoryId, baseName);
      const compareBranch = findBranch(state, repositoryId, compareName);
      if (!baseBranch || !compareBranch) return null;
      const probe = {
        repositoryId,
        sourceBranch: compareName,
        targetBranch: baseName,
        baseCommitId: baseBranch.headCommitId ?? null,
      };
      const difference = changesOf(state, probe);
      return {
        base: baseName,
        compare: compareName,
        baseCommit: baseCommitOf(state, probe)
          ? publicCommit(baseCommitOf(state, probe))
          : null,
        compareCommit: compareCommitOf(state, probe)
          ? publicCommit(compareCommitOf(state, probe))
          : null,
        commits: commitsRelativeToBase(state, probe),
        changes: difference.files,
        totals: difference.totals,
        identical: difference.totals.files === 0,
      };
    },

    /**
     * Creates one pull request. A normal creation stores Open and a draft
     * creation stores Draft; both store the target branch head as the
     * creation-time base commit and the source branch head as the creation-time
     * compare commit. Nothing is written when a branch is missing or both sides
     * are identical.
     */
    async createPullRequest({
      repositoryId,
      title,
      description,
      sourceBranch,
      targetBranch,
      draft,
      authorName,
      authorAccountId,
    }) {
      let result = { ok: false, reason: "repository-missing", number: null };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const repository = (draftState.repositories ?? []).find(
          (entry) => entry.id === repositoryId,
        );
        if (!repository) return;
        const source = findBranch(draftState, repositoryId, sourceBranch);
        const target = findBranch(draftState, repositoryId, targetBranch);
        if (!source || !target) {
          result = { ok: false, reason: "branch-missing", number: null };
          return;
        }
        const base = findCommit(draftState, target.headCommitId);
        const compare = findCommit(draftState, source.headCommitId);
        const difference = diffFileSnapshots(base?.files ?? [], compare?.files ?? []);
        if (difference.totals.files === 0) {
          result = { ok: false, reason: "identical", number: null };
          return;
        }
        const numbers = draftState.pullRequests
          .filter((entry) => entry.repositoryId === repositoryId)
          .map((entry) => entry.number);
        const pull = {
          id: `pull-${randomUUID()}`,
          repositoryId,
          number: numbers.length > 0 ? Math.max(...numbers) + 1 : 1,
          title,
          description: description ?? "",
          status: draft ? "draft" : "open",
          authorName,
          authorAccountId: authorAccountId ?? null,
          sourceBranch,
          targetBranch,
          baseCommitId: target.headCommitId ?? null,
          creationCompareCommitId: source.headCommitId ?? null,
          createdAt: now,
          updatedAt: now,
          checks: [],
        };
        draftState.pullRequests.push(pull);
        draftState.pullRequestEvents.push({
          id: `event-${randomUUID()}`,
          pullRequestId: pull.id,
          type: "created",
          actorName: authorName,
          actorAccountId: authorAccountId ?? null,
          detail: "",
          createdAt: now,
        });
        result = { ok: true, reason: "ok", number: pull.number };
      });
      return result;
    },

    /**
     * Applies one status transition (REQ-6). Merged is terminal and `draft` is
     * only ever the result of a draft creation, so an unsupported pair writes
     * nothing and answers `transition`.
     */
    async setPullRequestStatus({ repositoryId, number, status, actorName, actorAccountId }) {
      let result = { ok: false, reason: "pull-missing" };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const pull = findPull(draftState, repositoryId, number);
        if (!pull) return;
        if (!allowedTransition(pull.status, status)) {
          result = { ok: false, reason: "transition" };
          return;
        }
        if (pull.status === status) {
          result = { ok: true, reason: "unchanged" };
          return;
        }
        const previous = pull.status;
        pull.status = status;
        pull.updatedAt = now;
        draftState.pullRequestEvents.push({
          id: `event-${randomUUID()}`,
          pullRequestId: pull.id,
          type: transitionEventType(previous, status),
          actorName,
          actorAccountId: actorAccountId ?? null,
          detail: "",
          createdAt: now,
        });
        result = { ok: true, reason: "ok" };
      });
      return result;
    },

    /**
     * Stores one status check of the revision the comparison reads (REQ-6-1),
     * together with the account that set it. A check the compare commit does
     * not carry writes nothing.
     */
    async setPullRequestCheck({ repositoryId, number, name, status, setter, actorAccountId }) {
      let result = { ok: false, reason: "pull-missing" };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const pull = findPull(draftState, repositoryId, number);
        if (!pull) return;
        const compare = headCommitOfBranch(draftState, pull.repositoryId, pull.sourceBranch);
        const commitId = compare?.id ?? null;
        const check = (pull.checks ?? []).find(
          (entry) => entry.name === name && (entry.commitId === commitId || entry.commitId === undefined),
        );
        if (!check) {
          result = { ok: false, reason: "check-missing" };
          return;
        }
        check.status = status;
        check.setter = setter ?? null;
        check.setterAccountId = actorAccountId ?? null;
        check.updatedAt = now;
        pull.updatedAt = now;
        result = { ok: true, reason: "ok" };
      });
      return result;
    },

    /**
     * Sets or clears the milestone of one pull request (REQ-5-3-3). The
     * milestone must already exist in the same repository, so the selector can
     * never create one or borrow one from another repository; an empty name
     * clears the stored relationship. The title, description, status, checks,
     * discussion and reviewers of the pull request stay untouched.
     */
    async setPullRequestMilestone({ repositoryId, number, name, actorName, actorAccountId }) {
      let result = { ok: false, reason: "pull-missing" };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const pull = findPull(draftState, repositoryId, number);
        if (!pull) return;
        let milestoneId = null;
        if (name) {
          const milestone = (draftState.milestones ?? []).find(
            (entry) => entry.repositoryId === repositoryId && entry.name === name,
          );
          if (!milestone) {
            result = { ok: false, reason: "milestone-missing" };
            return;
          }
          milestoneId = milestone.id;
        }
        if (milestoneId !== (pull.milestoneId ?? null)) {
          pull.milestoneId = milestoneId;
          pull.updatedAt = now;
          draftState.pullRequestEvents.push({
            id: `event-${randomUUID()}`,
            pullRequestId: pull.id,
            type: milestoneId ? "milestone-set" : "milestone-cleared",
            actorName,
            actorAccountId: actorAccountId ?? null,
            detail: name ?? "",
            createdAt: now,
          });
        }
        result = { ok: true, reason: "ok" };
      });
      return result;
    },

    /**
     * Stores one line comment of a pull request (REQ-6-3-3), anchored to the
     * revision the comparison currently reads plus the file path and the line
     * index it was written on. `state` is `published` for `Add single comment`
     * and `pending` for `Start a review`; the caller has already re-checked the
     * review permission and the Open status.
     */
    async addPullRequestReviewComment({
      repositoryId,
      number,
      body,
      filePath,
      lineIndex,
      state,
      authorName,
      authorAccountId,
    }) {
      let result = { ok: false, reason: "pull-missing" };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const pull = findPull(draftState, repositoryId, number);
        if (!pull) return;
        const compare = compareCommitOf(draftState, pull);
        draftState.pullRequestReviewComments.push({
          id: `review-comment-${randomUUID()}`,
          pullRequestId: pull.id,
          authorName,
          authorAccountId: authorAccountId ?? null,
          body,
          filePath,
          lineIndex: Number.isInteger(lineIndex) ? lineIndex : null,
          state: state === "pending" ? "pending" : "published",
          commitId: compare?.id ?? null,
          createdAt: now,
        });
        pull.updatedAt = now;
        result = { ok: true, reason: "ok" };
      });
      return result;
    },

    /**
     * Stores one review decision of the current compare revision (REQ-6-3-4).
     * A reviewer keeps a single decision record, replaced when the same reviewer
     * resubmits; a later compare commit makes the stored decision stale without
     * deleting it. The caller has already re-checked the review permission and
     * the Open status.
     */
    async addPullRequestReview({
      repositoryId,
      number,
      decision,
      summary,
      reviewerName,
      reviewerAccountId,
    }) {
      let result = { ok: false, reason: "pull-missing" };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const pull = findPull(draftState, repositoryId, number);
        if (!pull) return;
        const compare = compareCommitOf(draftState, pull);
        const existing = draftState.pullRequestReviews.find(
          (entry) => entry.pullRequestId === pull.id && entry.reviewerName === reviewerName,
        );
        if (existing) {
          existing.decision = decision;
          existing.summary = summary ?? "";
          existing.commitId = compare?.id ?? null;
          existing.updatedAt = now;
        } else {
          draftState.pullRequestReviews.push({
            id: `review-${randomUUID()}`,
            pullRequestId: pull.id,
            reviewerName,
            reviewerAccountId: reviewerAccountId ?? null,
            decision,
            summary: summary ?? "",
            commitId: compare?.id ?? null,
            createdAt: now,
            updatedAt: now,
          });
        }
        pull.updatedAt = now;
        draftState.pullRequestEvents.push({
          id: `event-${randomUUID()}`,
          pullRequestId: pull.id,
          type: "reviewed",
          actorName: reviewerName,
          actorAccountId: reviewerAccountId ?? null,
          detail: decision,
          createdAt: now,
        });
        result = { ok: true, reason: "ok" };
      });
      return result;
    },

    /** Saves one pending reviewer request (REQ-6-4); the caller re-checks it. */
    async requestPullRequestReviewer({ repositoryId, number, username }) {
      let result = { ok: false, reason: "pull-missing" };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const pull = findPull(draftState, repositoryId, number);
        if (!pull) return;
        if (!pull.requestedReviewers.includes(username)) pull.requestedReviewers.push(username);
        pull.updatedAt = now;
        result = { ok: true, reason: "ok" };
      });
      return result;
    },

    /** Removes one pending reviewer request without touching any review (REQ-6-4). */
    async removePullRequestReviewer({ repositoryId, number, username }) {
      let result = { ok: false, reason: "pull-missing" };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const pull = findPull(draftState, repositoryId, number);
        if (!pull) return;
        pull.requestedReviewers = pull.requestedReviewers.filter((entry) => entry !== username);
        pull.updatedAt = now;
        result = { ok: true, reason: "ok" };
      });
      return result;
    },

    /**
     * Merges the compare branch into the base branch of an Open pull request
     * (REQ-6-5). Before writing, the target head, current compare commit, the
     * conflict state and the protection rules are reread, so an unsatisfied
     * condition leaves both the target branch and the pull request untouched.
     * The appended merge commit names the target head and the compare commit as
     * its parents, the target head moves to it and the PR becomes Merged.
     */
    async mergePullRequest({ repositoryId, number, actorName, actorAccountId }) {
      let result = { ok: false, reason: "pull-missing" };
      const now = new Date().toISOString();
      await store.update((draftState) => {
        normalize(draftState);
        const pull = findPull(draftState, repositoryId, number);
        if (!pull) return;
        const mergeState = mergeStateOf(draftState, pull);
        if (!mergeState.eligible) {
          result = { ok: false, reason: "ineligible", message: mergeState.blockedReason };
          return;
        }
        const target = findBranch(draftState, repositoryId, pull.targetBranch);
        const compare = compareCommitOf(draftState, pull);
        if (!target || !compare) {
          result = { ok: false, reason: "branch-missing", message: MERGE_MESSAGES.branchMissing };
          return;
        }
        const base = findCommit(draftState, target.headCommitId);
        const baseMap = new Map((base?.files ?? []).map((file) => [file.path, String(file.content ?? "")]));
        const compareMap = new Map(
          (compare.files ?? []).map((file) => [file.path, String(file.content ?? "")]),
        );
        const paths = [...new Set([...baseMap.keys(), ...compareMap.keys()])].sort();
        const files = [];
        for (const path of paths) {
          if (!compareMap.has(path)) continue;
          files.push({ path, content: compareMap.get(path) });
        }
        const commit = {
          id: `commit-${randomUUID()}`,
          repositoryId,
          branch: pull.targetBranch,
          message: `Merge pull request #${pull.number} from ${pull.sourceBranch} into ${pull.targetBranch}`,
          authorName: actorName,
          authorAccountId: actorAccountId ?? null,
          createdAt: now,
          parentCommitId: target.headCommitId ?? null,
          secondParentCommitId: compare.id,
          files,
        };
        draftState.commits.push(commit);
        target.headCommitId = commit.id;
        pull.status = "merged";
        pull.mergedCommitId = commit.id;
        pull.mergedByName = actorName;
        pull.mergedAt = now;
        pull.updatedAt = now;
        draftState.pullRequestEvents.push({
          id: `event-${randomUUID()}`,
          pullRequestId: pull.id,
          type: "merged",
          actorName,
          actorAccountId: actorAccountId ?? null,
          detail: commit.id,
          createdAt: now,
        });
        result = { ok: true, reason: "ok", commitId: commit.id };
      });
      return result;
    },
  };
}
