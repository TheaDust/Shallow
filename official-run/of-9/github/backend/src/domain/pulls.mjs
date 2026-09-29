// Pull request domain: repository-scoped pull requests with their activity
// timeline, ordinary comments, review requests, per-commit check results and
// branch protection rules. A pull request is a persistent proposal to merge
// code changes from the compare branch into the base branch; it is not a
// branch, commit or issue. PR numbers are unique per repository and allocated
// atomically inside the update, so a failed creation never leaves a partial
// record. Reviews submitted later (REQ-6-3-4) are read by the merge-eligibility
// computation: for a given reviewer on the same current compare commit only the
// latest decision counts, decisions on older commits are stale, and the author
// can never satisfy the approval requirement.

import { randomUUID } from "node:crypto";

import { diffLines } from "../lib/diff.mjs";
import { createPullReviewsDomain } from "./pull-reviews.mjs";
import {
  effectiveRole,
  repositoryAccessible,
  resolveRevision,
  snapshotAt,
  snapshotDiff,
} from "./organizations.mjs";
import { seedRepositoryPullRequests } from "./pulls-seed.mjs";

export const TITLE_MAX = 256;
export const BODY_MAX = 65536;
export const PR_STATUSES = ["draft", "open", "closed", "merged"];

const WRITE_ROLES = new Set(["write", "maintain", "admin"]);
const MERGE_ROLES = new Set(["maintain", "admin"]);
const REVIEW_DECISIONS = new Set(["comment", "approve", "request_changes"]);
const CHECK_STATUSES = new Set(["pending", "success", "failure"]);

export function prKey(repoId, number) {
  return `${repoId}:${number}`;
}

function normalizeTitle(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBody(value) {
  return typeof value === "string" ? value.trim() : "";
}

// The current compare commit is the head of the compare branch at read time;
// the PR record keeps the creation-time compare commit. When the compare
// branch gains a new commit, the derived head changes and the checks area for
// the new commit starts with pending (no check record exists yet).
function currentCompareCommit(git, pr) {
  return git?.branches?.[pr.compareBranch] ?? pr.compareCommit;
}

function baseHeadCommit(git, pr) {
  return git?.branches?.[pr.baseBranch] ?? pr.baseCommit;
}

// Commits on the compare branch that are not reachable from the base head,
// newest first (REQ-6-3-1 Commit summary / Commits tab).
function comparableCommits(git, pr) {
  const baseHead = baseHeadCommit(git, pr);
  const compareHead = currentCompareCommit(git, pr);
  if (!baseHead || !compareHead) return [];
  const reachableFromBase = new Set();
  let cursor = baseHead;
  while (cursor && git.commits?.[cursor]) {
    reachableFromBase.add(cursor);
    cursor = git.commits[cursor].parentId;
  }
  const commits = [];
  cursor = compareHead;
  while (cursor && git.commits?.[cursor]) {
    if (reachableFromBase.has(cursor)) break;
    const commit = git.commits[cursor];
    commits.push({
      id: commit.id,
      shortId: commit.id.length > 7 ? commit.id.slice(0, 7) : commit.id,
      message: commit.message,
      author: commit.author,
      createdAt: commit.createdAt,
      changes: (commit.changes ?? []).map((change) => ({
        path: change.path,
        additions: change.additions,
        deletions: change.deletions,
      })),
    });
    cursor = commit.parentId;
  }
  return commits;
}

// Diff between the current base and compare heads used by the PR detail
// Files changed tab and by the merge-eligibility checks.
function pullRequestDiff(git, pr) {
  const baseHead = baseHeadCommit(git, pr);
  const compareHead = currentCompareCommit(git, pr);
  if (!baseHead || !compareHead) return { files: [], totalAdditions: 0, totalDeletions: 0 };
  const diff = snapshotDiff(snapshotAt(git, baseHead), snapshotAt(git, compareHead));
  return {
    files: diff.files.map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      lines: file.lines,
    })),
    totalAdditions: diff.totalAdditions,
    totalDeletions: diff.totalDeletions,
  };
}

// Three-way merge of the creation-time base snapshot with the current target
// and compare heads. Used both to detect merge conflicts and to produce the
// merged content of a successful merge commit.
function threeWayMerge(baseSnapshot, targetSnapshot, compareSnapshot) {
  const paths = new Set([
    ...Object.keys(baseSnapshot ?? {}),
    ...Object.keys(targetSnapshot ?? {}),
    ...Object.keys(compareSnapshot ?? {}),
  ]);
  const result = {};
  const conflicts = [];
  for (const path of paths) {
    const base = baseSnapshot?.[path] ?? null;
    const target = targetSnapshot?.[path] ?? null;
    const compare = compareSnapshot?.[path] ?? null;
    if (target === compare) {
      if (target !== null) result[path] = target;
    } else if (target === base) {
      if (compare !== null) result[path] = compare;
    } else if (compare === base) {
      if (target !== null) result[path] = target;
    } else {
      conflicts.push(path);
    }
  }
  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, files: result };
}

// Latest effective review decision per reviewer on one compare commit.
// Only the reviewer's newest decision among Comment, Approve and Request
// changes counts; records from older commits are stale and ignored.
function effectiveReviewDecisions(state, key, commitId) {
  const byReviewer = new Map();
  for (const review of Object.values(state.pullRequestReviews?.[key] ?? {})) {
    if (review.commitId !== commitId) continue;
    const existing = byReviewer.get(review.reviewer);
    // The newest decision counts; equal timestamps fall back to insertion
    // order (later records replace earlier ones).
    if (
      !existing ||
      existing.createdAt < review.createdAt ||
      (existing.createdAt === review.createdAt && existing.id < review.id)
    ) {
      byReviewer.set(review.reviewer, review);
    }
  }
  return [...byReviewer.values()].map((review) => ({
    reviewer: review.reviewer,
    decision: review.decision,
    createdAt: review.createdAt,
    explanation: review.explanation ?? "",
  }));
}

function serializeCheck(state, key, commitId) {
  const record = state.pullRequestChecks?.[key]?.[commitId]?.test;
  return {
    status: record?.status ?? "pending",
    setter: record?.setter ?? null,
    setAt: record?.setAt ?? null,
  };
}

// Merge eligibility for an Open PR: no merge conflicts, no valid Request
// changes decision on the current compare commit, and, when the target branch
// is protected, every enabled rule requirement enforced independently (1 valid
// non-author Approve and/or the `test` check being success for the current
// compare commit).
function mergeEligibility(state, repo, pr) {
  const git = state.git?.[repo.id];
  const conditions = [];
  const reasons = [];
  const baseCommit = pr.baseCommit;
  const targetHead = baseHeadCommit(git, pr);
  const compareHead = currentCompareCommit(git, pr);
  if (!baseCommit || !targetHead || !compareHead) {
    return { eligible: false, reasons: ["The pull request branches are unavailable"] };
  }
  const merged = threeWayMerge(
    snapshotAt(git, baseCommit),
    snapshotAt(git, targetHead),
    snapshotAt(git, compareHead),
  );
  if (!merged.ok) reasons.push("Merge conflicts must be resolved");
  conditions.push({ label: "No merge conflicts", satisfied: merged.ok });

  const key = prKey(repo.id, pr.number);
  const decisions = effectiveReviewDecisions(state, key, compareHead);
  const blockingRequests = decisions.filter(
    (decision) => decision.decision === "request_changes" && decision.reviewer !== pr.author,
  );
  if (blockingRequests.length > 0) reasons.push("Requested changes must be resolved");
  conditions.push({ label: "No valid Request changes", satisfied: blockingRequests.length === 0 });

  const rule = git?.protectedBranches?.[pr.baseBranch];
  if (rule?.requireApproval) {
    const approvals = decisions.filter(
      (decision) => decision.decision === "approve" && decision.reviewer !== pr.author,
    );
    if (approvals.length < 1) reasons.push("Review required by branch protection");
    conditions.push({ label: "1 approval", satisfied: approvals.length >= 1 });
  }
  if (rule?.requireCheck) {
    const check = state.pullRequestChecks?.[key]?.[compareHead]?.test;
    if (check?.status !== "success") {
      reasons.push("Required status check test must be successful");
    }
    conditions.push({ label: "Status check test is success", satisfied: check?.status === "success" });
  }
  return { eligible: reasons.length === 0, reasons, conditions };
}

function serializeTimelineEntry(entry) {
  const serialized = {
    id: entry.id,
    type: entry.type,
    author: entry.author,
    createdAt: entry.createdAt,
  };
  if (entry.commentId) serialized.commentId = entry.commentId;
  if (entry.targetUsername !== undefined) serialized.targetUsername = entry.targetUsername;
  if (entry.reviewer !== undefined) serialized.reviewer = entry.reviewer;
  if (entry.decision !== undefined) serialized.decision = entry.decision;
  if (entry.status !== undefined) serialized.status = entry.status;
  return serialized;
}

function serializeComment(comment) {
  return {
    id: comment.id,
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

function serializeRequestedReviewers(state, key) {
  return (state.pullRequestReviewers?.[key] ?? [])
    .filter((request) => !request.removedAt)
    .map((request) => ({
      username: request.username,
      requestedBy: request.requestedBy,
      createdAt: request.createdAt,
    }));
}

function serializePullSummary(state, repo, pr) {
  const key = prKey(repo.id, pr.number);
  const git = state.git?.[repo.id];
  const compareHead = currentCompareCommit(git, pr);
  return {
    number: pr.number,
    title: pr.title,
    author: pr.author,
    status: pr.status,
    baseBranch: pr.baseBranch,
    compareBranch: pr.compareBranch,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    reviews: effectiveReviewDecisions(state, key, compareHead).map((decision) => ({
      reviewer: decision.reviewer,
      decision: decision.decision,
    })),
    reviewRequested: (state.pullRequestReviewers?.[key] ?? []).some(
      (request) => !request.removedAt,
    ),
  };
}

function serializeInlineComment(currentCommit, record) {
  return {
    id: record.id,
    path: record.path,
    line: record.line,
    commitId: record.commitId,
    author: record.author,
    body: record.body,
    state: record.state,
    createdAt: record.createdAt,
    outdated: currentCommit !== record.commitId,
  };
}

function serializePullDetail(state, repo, pr) {
  const key = prKey(repo.id, pr.number);
  const git = state.git?.[repo.id];
  const compareHead = currentCompareCommit(git, pr);
  return {
    number: pr.number,
    title: pr.title,
    description: pr.description ?? "",
    status: pr.status,
    author: pr.author,
    baseBranch: pr.baseBranch,
    compareBranch: pr.compareBranch,
    baseCommit: pr.baseCommit,
    compareCommit: pr.compareCommit,
    currentCompareCommit: compareHead,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedBy: pr.mergedBy ?? null,
    mergedAt: pr.mergedAt ?? null,
    mergeCommitId: pr.mergeCommitId ?? null,
    comments: Object.values(state.pullRequestComments?.[key] ?? {})
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(serializeComment),
    inlineComments: Object.values(state.pullRequestInlineComments?.[key] ?? {})
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((record) => serializeInlineComment(compareHead, record)),
    requestedReviewers: serializeRequestedReviewers(state, key),
    checks: serializeCheck(state, key, compareHead),
    reviewSummary: effectiveReviewDecisions(state, key, compareHead).map((decision) => ({
      reviewer: decision.reviewer,
      decision: decision.decision,
      createdAt: decision.createdAt,
      explanation: decision.explanation,
    })),
    timeline: [...(state.pullRequestTimelines?.[key] ?? [])]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(serializeTimelineEntry),
  };
}

// Accounts eligible to be requested as reviewers: distinct from the PR author
// with Write, Maintain or Admin on the repository (REQ-6-4).
function eligibleReviewers(state, repo, pr) {
  const requested = new Set(
    (state.pullRequestReviewers?.[prKey(repo.id, pr.number)] ?? [])
      .filter((request) => !request.removedAt)
      .map((request) => request.username),
  );
  const candidates = [];
  for (const account of Object.values(state.accounts ?? {})) {
    if (account.username === pr.author) continue;
    const role = effectiveRole(state, repo, account.username);
    if (role && WRITE_ROLES.has(role)) candidates.push(account.username);
  }
  return candidates
    .filter((username) => !requested.has(username))
    .sort((a, b) => a.localeCompare(b));
}

export function createPullsDomain(store) {
  async function seedIfEmpty() {
    await store.update(async (state) => {
      if (state.pullRequests && Object.keys(state.pullRequests).length > 0) return;
      state.pullRequests = state.pullRequests ?? {};
      state.pullRequestTimelines = state.pullRequestTimelines ?? {};
      state.pullRequestComments = state.pullRequestComments ?? {};
      state.pullRequestReviews = state.pullRequestReviews ?? {};
      state.pullRequestReviewers = state.pullRequestReviewers ?? {};
      state.pullRequestChecks = state.pullRequestChecks ?? {};
      state.pullRequestInlineComments = state.pullRequestInlineComments ?? {};

      const repoIds = Object.keys(state.repositories ?? {}).filter(
        (id) => state.repositories[id].name === "acme-docs",
      );
      for (const repoId of repoIds) {
        seedRepositoryPullRequests(state, repoId, state.repositories[repoId]);
      }
    });
  }

  async function listPullRequests(owner, name, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const pulls = Object.values(state.pullRequests?.[repo.id] ?? {})
      .map((pr) => serializePullSummary(state, repo, pr))
      .sort((a, b) => b.number - a.number);
    return {
      repository: { owner: repo.ownerId, name: repo.name },
      myRole: effectiveRole(state, repo, accountId),
      pulls,
    };
  }

  async function getPullRequest(owner, name, number, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const pr = state.pullRequests?.[repo.id]?.[number];
    if (!pr) return { notFound: true };
    const git = state.git?.[repo.id];
    return {
      pull: serializePullDetail(state, repo, pr),
      myRole: effectiveRole(state, repo, accountId),
      branches: Object.keys(git?.branches ?? {}).sort(),
      commits: comparableCommits(git, pr),
      files: pullRequestDiff(git, pr),
      eligibleReviewers: eligibleReviewers(state, repo, pr),
      mergeEligibility: mergeEligibility(state, repo, pr),
    };
  }

  // Comparison data for the PR creation flow. Only signed-in users with Write,
  // Maintain, Admin or organization Owner status may compare branches; Read
  // and Triage may view existing PRs but cannot enter the creation-comparison
  // flow. The result is temporary read-only context and never writes a PR,
  // commit or branch change.
  async function getComparisonData(owner, name, input = {}, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    const role = effectiveRole(state, repo, accountId);
    if (!role || !WRITE_ROLES.has(role)) return { denied: true };
    const git = state.git?.[repo.id];
    const branches = Object.keys(git?.branches ?? {}).sort();
    const base = typeof input.base === "string" ? input.base : "";
    const compare = typeof input.compare === "string" ? input.compare : "";
    let result = {
      repository: { owner: repo.ownerId, name: repo.name },
      myRole: role,
      branches,
      base,
      compare,
      baseCommit: null,
      compareCommit: null,
      commitCount: 0,
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      valid: false,
      reason: null,
    };
    if (!base || !compare || base === compare) {
      if (base && compare && base === compare) result.reason = "same_branch";
      return result;
    }
    const baseCommit = resolveRevision(git, base);
    const compareCommit = resolveRevision(git, compare);
    if (!baseCommit || !compareCommit) return result;
    const diff = snapshotDiff(snapshotAt(git, baseCommit), snapshotAt(git, compareCommit));
    const commitCount = comparableCommits(git, { baseBranch: base, compareBranch: compare, baseCommit, compareCommit })
      .length;
    result = {
      ...result,
      baseCommit,
      compareCommit,
      commitCount,
      files: diff.files.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        lines: file.lines,
      })),
      totalAdditions: diff.totalAdditions,
      totalDeletions: diff.totalDeletions,
      valid: commitCount > 0 && diff.files.length > 0,
      reason: commitCount === 0 || diff.files.length === 0 ? "no_changes" : null,
    };
    return result;
  }

  // Atomically create an Open pull request. The repository-scoped number is
  // allocated only after validation and permission checks pass, so a failure
  // never allocates a number or leaves a partial record.
  async function createPullRequest(accountId, owner, name, input = {}) {
    const base = typeof input.base === "string" ? input.base : "";
    const compare = typeof input.compare === "string" ? input.compare : "";
    const title = normalizeTitle(input.title);
    const description = normalizeBody(input.description ?? "");
    const draft = Boolean(input.draft);
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const role = effectiveRole(state, repo, accountId);
      if (!role || !WRITE_ROLES.has(role)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const git = state.git?.[repo.id];
      const errors = {};
      if (!title) errors.title = "Title is required";
      else if (title.length > TITLE_MAX) {
        errors.title = `Title must be at most ${TITLE_MAX} characters`;
      }
      if (description.length > BODY_MAX) {
        errors.description = `Description must be at most ${BODY_MAX} characters`;
      }
      if (!base || !compare) {
        errors.branch = "Base and compare branches are required";
      } else if (base === compare) {
        errors.branch = "Base and compare branches must be different";
      } else {
        if (!git?.branches?.[base]) errors.branch = "Base branch not found";
        else if (!git?.branches?.[compare]) errors.branch = "Compare branch not found";
      }
      if (Object.keys(errors).length === 0) {
        const diff = snapshotDiff(
          snapshotAt(git, git.branches[base]),
          snapshotAt(git, git.branches[compare]),
        );
        if (diff.files.length === 0) errors.branch = "No changes to merge";
        const duplicate = Object.values(state.pullRequests?.[repo.id] ?? {}).some(
          (pr) =>
            (pr.status === "open" || pr.status === "draft") &&
            pr.baseBranch === base &&
            pr.compareBranch === compare,
        );
        if (duplicate) errors.branch = "A pull request already exists for these branches";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const numbers = Object.values(state.pullRequests?.[repo.id] ?? {}).map((pr) => pr.number);
      const number = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
      const now = new Date().toISOString();
      const pr = {
        id: `${repo.id}:${number}`,
        repoId: repo.id,
        number,
        title,
        description,
        author: accountId,
        status: draft ? "draft" : "open",
        baseBranch: base,
        compareBranch: compare,
        baseCommit: git.branches[base],
        compareCommit: git.branches[compare],
        createdAt: now,
        updatedAt: now,
      };
      state.pullRequests = state.pullRequests ?? {};
      state.pullRequests[repo.id] = state.pullRequests[repo.id] ?? {};
      state.pullRequests[repo.id][number] = pr;
      const key = prKey(repo.id, number);
      state.pullRequestTimelines = state.pullRequestTimelines ?? {};
      state.pullRequestTimelines[key] = [
        { id: `${key}:tl:1`, type: "created", author: accountId, createdAt: now },
      ];
      state.pullRequestChecks = state.pullRequestChecks ?? {};
      state.pullRequestChecks[key] = {};
      result = { ok: true, pull: serializePullDetail(state, repo, pr) };
    });
    return result;
  }

  // Mark a Draft PR as ready for review: the author, Maintain, Admin or
  // organization Owner may convert a Draft to Open. Branches, commits, title
  // and number never change; the transition appends a Ready for review
  // activity so Conversation shows the status event after reload.
  async function readyForReview(accountId, owner, name, number) {
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const pr = state.pullRequests?.[repo.id]?.[number];
      if (!pr) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageReviewers(state, repo, pr, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      if (pr.status !== "draft") {
        result = { ok: false, errors: { status: "Only draft pull requests can be marked as ready for review" } };
        return;
      }
      const now = new Date().toISOString();
      pr.status = "open";
      pr.updatedAt = now;
      const key = prKey(repo.id, pr.number);
      state.pullRequestTimelines = state.pullRequestTimelines ?? {};
      state.pullRequestTimelines[key] = state.pullRequestTimelines[key] ?? [];
      state.pullRequestTimelines[key].push({
        id: `${key}:tl:${state.pullRequestTimelines[key].length + 1}`,
        type: "ready-for-review",
        author: accountId,
        createdAt: now,
      });
      result = { ok: true, pull: serializePullDetail(state, repo, pr) };
    });
    return result;
  }

  // Add an inline review comment anchored to one added/deleted line of a
  // changed file on the current compare commit. Only a signed-in reviewer
  // with Write, Maintain or Admin who is not the PR author may comment on an
  // Open PR. `draft: true` keeps the comment pending (visible only to its
  // author) until a review is submitted (REQ-6-3-4); published comments stay
  // at their original commit and line and are marked Outdated when the
  // compare commit moves on.
  async function addInlineComment(accountId, owner, name, number, input = {}) {
    const path = typeof input.path === "string" ? input.path : "";
    const line = Number(input.line);
    const body = normalizeBody(input.body);
    const draft = Boolean(input.draft);
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const pr = state.pullRequests?.[repo.id]?.[number];
      if (!pr) {
        result = { ok: false, notFound: true };
        return;
      }
      if (pr.status !== "open") {
        result = { ok: false, errors: { comment: "Only Open pull requests accept review comments" } };
        return;
      }
      const role = effectiveRole(state, repo, accountId);
      if (!role || !WRITE_ROLES.has(role) || accountId === pr.author) {
        result = { ok: false, forbidden: true };
        return;
      }
      const errors = {};
      if (!body) errors.comment = "Comment is required";
      else if (body.length > BODY_MAX) {
        errors.comment = `Comment must be at most ${BODY_MAX} characters`;
      }
      const git = state.git?.[repo.id];
      const commitId = currentCompareCommit(git, pr);
      const diff = pullRequestDiff(git, pr);
      const file = diff.files.find((entry) => entry.path === path);
      if (!file) {
        errors.comment = "File is not part of this pull request's diff";
      } else if (!Number.isInteger(line) || line < 1 || line > file.lines.length) {
        errors.comment = "Line is not part of this pull request's diff";
      } else {
        const lineEntry = file.lines[line - 1];
        if (lineEntry.type !== "add" && lineEntry.type !== "del") {
          errors.comment = "Comments can only be added to changed lines";
        }
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const key = prKey(repo.id, pr.number);
      state.pullRequestInlineComments = state.pullRequestInlineComments ?? {};
      state.pullRequestInlineComments[key] = state.pullRequestInlineComments[key] ?? {};
      const id = `${key}:inline:${Object.keys(state.pullRequestInlineComments[key]).length + 1}`;
      const record = {
        id,
        prKey: key,
        path,
        line,
        commitId,
        author: accountId,
        body,
        state: draft ? "pending" : "published",
        createdAt: now,
      };
      state.pullRequestInlineComments[key][id] = record;
      pr.updatedAt = now;
      result = { ok: true, comment: serializeInlineComment(commitId, record) };
    });
    return result;
  }

  // Submit a review decision (Comment, Approve or Request changes) on an Open
  // PR (REQ-6-3-4). Implemented in `pull-reviews.mjs`; only a signed-in
  // reviewer with Write, Maintain or Admin who is not the PR author may
  // submit, and the decision is stored against the current compare commit.
  const reviewDomain = createPullReviewsDomain(store, {
    effectiveRole,
    prKey,
    currentCompareCommit,
    serializePullDetail,
    WRITE_ROLES,
    REVIEW_DECISIONS,
    BODY_MAX,
  });

  async function requestReviewer(accountId, owner, name, number, username) {
    const target = typeof username === "string" ? username.trim() : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const pr = state.pullRequests?.[repo.id]?.[number];
      if (!pr) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageReviewers(state, repo, pr, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      if (pr.status !== "open" && pr.status !== "draft") {
        result = { ok: false, errors: { reviewers: "Only Open or Draft pull requests can request reviewers" } };
        return;
      }
      const errors = {};
      if (!target) {
        errors.reviewers = "Reviewer is required";
      } else if (target === pr.author) {
        errors.reviewers = "The pull request author cannot be requested as a reviewer";
      } else {
        const candidate = state.accounts?.[target];
        if (!candidate) errors.reviewers = "Account not found";
        else {
          const role = effectiveRole(state, repo, target);
          if (!role || !WRITE_ROLES.has(role)) {
            errors.reviewers = "Account is not eligible to review this repository";
          }
        }
      }
      const key = prKey(repo.id, pr.number);
      const alreadyRequested = (state.pullRequestReviewers?.[key] ?? []).some(
        (request) => request.username === target && !request.removedAt,
      );
      if (!errors.reviewers && alreadyRequested) {
        errors.reviewers = "Reviewer already requested";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      state.pullRequestReviewers = state.pullRequestReviewers ?? {};
      state.pullRequestReviewers[key] = state.pullRequestReviewers[key] ?? [];
      state.pullRequestReviewers[key].push({
        id: `${key}:request:${randomUUID()}`,
        prKey: key,
        username: target,
        requestedBy: accountId,
        createdAt: now,
      });
      state.pullRequestTimelines = state.pullRequestTimelines ?? {};
      state.pullRequestTimelines[key] = state.pullRequestTimelines[key] ?? [];
      state.pullRequestTimelines[key].push({
        id: `${key}:tl:${state.pullRequestTimelines[key].length + 1}`,
        type: "reviewer-requested",
        author: accountId,
        targetUsername: target,
        createdAt: now,
      });
      pr.updatedAt = now;
      result = { ok: true, pull: serializePullDetail(state, repo, pr) };
    });
    return result;
  }

  // Remove a reviewer request without deleting reviews, comments or activity
  // records already submitted by that user and without changing their
  // effective review decision.
  async function removeReviewer(accountId, owner, name, number, username) {
    const target = typeof username === "string" ? username.trim() : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const pr = state.pullRequests?.[repo.id]?.[number];
      if (!pr) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageReviewers(state, repo, pr, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const key = prKey(repo.id, pr.number);
      const request = (state.pullRequestReviewers?.[key] ?? []).find(
        (record) => record.username === target && !record.removedAt,
      );
      if (!request) {
        result = { ok: false, errors: { reviewers: "Reviewer request not found" } };
        return;
      }
      const now = new Date().toISOString();
      request.removedBy = accountId;
      request.removedAt = now;
      state.pullRequestTimelines = state.pullRequestTimelines ?? {};
      state.pullRequestTimelines[key] = state.pullRequestTimelines[key] ?? [];
      state.pullRequestTimelines[key].push({
        id: `${key}:tl:${state.pullRequestTimelines[key].length + 1}`,
        type: "reviewer-removed",
        author: accountId,
        targetUsername: target,
        createdAt: now,
      });
      pr.updatedAt = now;
      result = { ok: true, pull: serializePullDetail(state, repo, pr) };
    });
    return result;
  }

  function canManageReviewers(state, repo, pr, accountId) {
    if (!accountId) return false;
    if (pr.author === accountId) return true;
    const role = effectiveRole(state, repo, accountId);
    return role === "maintain" || role === "admin";
  }

  // Close or reopen an unmerged PR. The author, Maintain, Admin or
  // organization Owner may transition an Open or Draft PR to Closed and a
  // Closed PR back to Open; Merged is terminal. The transition never updates
  // any branch.
  async function setPullRequestStatus(accountId, owner, name, number, input = {}) {
    const targetStatus = typeof input.status === "string" ? input.status : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const pr = state.pullRequests?.[repo.id]?.[number];
      if (!pr) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canCloseOrReopen(state, repo, pr, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const errors = {};
      if (!["open", "closed"].includes(targetStatus)) {
        errors.status = "Status is invalid";
      } else if (pr.status === "merged") {
        errors.status = "Merged pull requests cannot be closed or reopened";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      if (pr.status === targetStatus) {
        result = { ok: true, pull: serializePullDetail(state, repo, pr), unchanged: true };
        return;
      }
      const now = new Date().toISOString();
      pr.status = targetStatus;
      pr.updatedAt = now;
      const key = prKey(repo.id, pr.number);
      state.pullRequestTimelines = state.pullRequestTimelines ?? {};
      state.pullRequestTimelines[key] = state.pullRequestTimelines[key] ?? [];
      state.pullRequestTimelines[key].push({
        id: `${key}:tl:${state.pullRequestTimelines[key].length + 1}`,
        type: targetStatus === "closed" ? "closed" : "reopened",
        author: accountId,
        createdAt: now,
      });
      result = { ok: true, pull: serializePullDetail(state, repo, pr) };
    });
    return result;
  }

  function canCloseOrReopen(state, repo, pr, accountId) {
    if (!accountId) return false;
    if (pr.author === accountId) return true;
    const role = effectiveRole(state, repo, accountId);
    return role === "maintain" || role === "admin";
  }

  // Update the `test` check status for the PR's current compare commit. Only a
  // repository Admin may update this status from the Checks area; the setter
  // and time are stored with the result.
  async function updatePullRequestCheck(accountId, owner, name, number, input = {}) {
    const status = typeof input.status === "string" ? input.status : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const pr = state.pullRequests?.[repo.id]?.[number];
      if (!pr) {
        result = { ok: false, notFound: true };
        return;
      }
      const role = effectiveRole(state, repo, accountId);
      if (role !== "admin") {
        result = { ok: false, forbidden: true };
        return;
      }
      if (!CHECK_STATUSES.has(status)) {
        result = { ok: false, errors: { status: "Status is invalid" } };
        return;
      }
      const git = state.git?.[repo.id];
      const commitId = currentCompareCommit(git, pr);
      const now = new Date().toISOString();
      const key = prKey(repo.id, pr.number);
      state.pullRequestChecks = state.pullRequestChecks ?? {};
      state.pullRequestChecks[key] = state.pullRequestChecks[key] ?? {};
      state.pullRequestChecks[key][commitId] = state.pullRequestChecks[key][commitId] ?? {};
      state.pullRequestChecks[key][commitId].test = { status, setter: accountId, setAt: now };
      pr.updatedAt = now;
      result = {
        ok: true,
        checks: serializeCheck(state, key, commitId),
        commitId,
      };
    });
    return result;
  }

  // Merge an eligible Open PR by creating a merge commit whose parents are the
  // target-branch head at merge time and the current compare commit, updating
  // the target-branch head and setting the PR to Merged. Only Maintain, Admin
  // or organization Owner may merge; if any condition is unsatisfied the page
  // explains the reason and neither the target branch nor the PR changes.
  async function mergePullRequest(accountId, owner, name, number) {
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const pr = state.pullRequests?.[repo.id]?.[number];
      if (!pr) {
        result = { ok: false, notFound: true };
        return;
      }
      const role = effectiveRole(state, repo, accountId);
      if (!role || !MERGE_ROLES.has(role)) {
        result = { ok: false, forbidden: true };
        return;
      }
      if (pr.status === "merged") {
        result = { ok: false, errors: { merge: "This pull request has already been merged" } };
        return;
      }
      if (pr.status === "draft") {
        result = { ok: false, errors: { merge: "Draft pull requests cannot be merged" } };
        return;
      }
      if (pr.status === "closed") {
        result = { ok: false, errors: { merge: "A closed pull request cannot be merged" } };
        return;
      }
      const git = state.git?.[repo.id];
      const baseCommit = pr.baseCommit;
      const targetHead = git?.branches?.[pr.baseBranch];
      const compareHead = git?.branches?.[pr.compareBranch];
      if (!baseCommit || !targetHead || !compareHead) {
        result = { ok: false, errors: { merge: "The pull request branches are unavailable" } };
        return;
      }
      const eligibility = mergeEligibility(state, repo, pr);
      if (!eligibility.eligible) {
        result = { ok: false, blocked: true, reasons: eligibility.reasons };
        return;
      }
      const merged = threeWayMerge(
        snapshotAt(git, baseCommit),
        snapshotAt(git, targetHead),
        snapshotAt(git, compareHead),
      );
      if (!merged.ok) {
        result = { ok: false, blocked: true, reasons: ["Merge conflicts must be resolved"] };
        return;
      }
      const now = new Date().toISOString();
      const commitId = `c${Object.keys(git.commits ?? {}).length + 1}`;
      const baseSnapshot = snapshotAt(git, baseCommit);
      const changes = [];
      for (const path of Object.keys(merged.files)) {
        const newContent = merged.files[path];
        const oldContent = baseSnapshot?.[path] ?? null;
        if (oldContent === newContent) continue;
        const diff = diffLines(oldContent ?? "", newContent ?? "");
        changes.push({
          path,
          additions: diff.additions,
          deletions: diff.deletions,
          oldContent,
          newContent,
        });
      }
      git.commits = git.commits ?? {};
      git.commits[commitId] = {
        id: commitId,
        message: `Merge pull request #${pr.number} from ${pr.compareBranch}`,
        author: accountId,
        createdAt: now,
        parentId: targetHead,
        parents: [targetHead, compareHead],
        changes,
      };
      git.branches[pr.baseBranch] = commitId;
      git.files = git.files ?? {};
      git.files[pr.baseBranch] = {};
      for (const path of Object.keys(merged.files)) {
        git.files[pr.baseBranch][path] = { content: merged.files[path], commitId };
      }
      pr.status = "merged";
      pr.mergedBy = accountId;
      pr.mergedAt = now;
      pr.mergeCommitId = commitId;
      pr.updatedAt = now;
      const key = prKey(repo.id, pr.number);
      state.pullRequestTimelines = state.pullRequestTimelines ?? {};
      state.pullRequestTimelines[key] = state.pullRequestTimelines[key] ?? [];
      state.pullRequestTimelines[key].push({
        id: `${key}:tl:${state.pullRequestTimelines[key].length + 1}`,
        type: "merged",
        author: accountId,
        createdAt: now,
      });
      result = {
        ok: true,
        pull: serializePullDetail(state, repo, pr),
        commit: { id: commitId, message: git.commits[commitId].message, author: accountId, createdAt: now },
      };
    });
    return result;
  }

  // Branch protection rules: persistent merge restrictions bound to one exact
  // branch name, stored with the rule toggles. Only a repository Admin (or
  // organization Owner) may create or modify rules; commits to a protected
  // branch are rejected elsewhere ("This branch is protected").
  async function listProtectionRules(owner, name, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    const role = effectiveRole(state, repo, accountId);
    if (!role || role !== "admin") return { forbidden: true };
    const git = state.git?.[repo.id];
    const rules = Object.values(git?.protectedBranches ?? {})
      .map((rule) => ({
        branch: rule.branch,
        requireApproval: Boolean(rule.requireApproval),
        requireCheck: Boolean(rule.requireCheck),
        createdBy: rule.createdBy,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      }))
      .sort((a, b) => a.branch.localeCompare(b.branch));
    return { rules };
  }

  async function setProtectionRule(accountId, owner, name, input = {}) {
    const branch = typeof input.branch === "string" ? input.branch.trim() : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const role = effectiveRole(state, repo, accountId);
      if (!role || role !== "admin") {
        result = { ok: false, forbidden: true };
        return;
      }
      const git = state.git?.[repo.id];
      const errors = {};
      if (!branch) errors.branch = "Branch name pattern is required";
      else if (!git?.branches?.[branch]) errors.branch = "Branch not found";
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      git.protectedBranches = git.protectedBranches ?? {};
      const existing = git.protectedBranches[branch];
      git.protectedBranches[branch] = {
        branch,
        requireApproval: Boolean(input.requireApproval),
        requireCheck: Boolean(input.requireCheck),
        createdBy: existing?.createdBy ?? accountId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      result = { ok: true, rule: git.protectedBranches[branch] };
    });
    return result;
  }

  return {
    seedIfEmpty,
    listPullRequests,
    getPullRequest,
    getComparisonData,
    createPullRequest,
    readyForReview,
    addInlineComment,
    submitPullRequestReview: reviewDomain.submitPullRequestReview,
    requestReviewer,
    removeReviewer,
    setPullRequestStatus,
    updatePullRequestCheck,
    mergePullRequest,
    listProtectionRules,
    setProtectionRule,
  };
}
