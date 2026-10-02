// The pull-request routes of the same-origin API stand-in used by component
// tests: the list of one repository, the read-only branch comparison of the
// creation page, the detail of one numbered pull request and the status
// transitions of the ready-for-review and merge entries. The answers mirror the
// server's payloads without importing production code.

import {
  stubCommitBySha,
  stubCommitChain,
  stubDiffSnapshots,
  stubHeadCommit,
} from "./repository-code-stub";
import type { StubCommit, StubPullRequest, StubRepositoryView } from "./repository-stub";

export const STUB_PULL_MESSAGES = {
  notFound: "Pull request not found",
  notCreated: "Pull request not created",
  notUpdated: "Pull request not updated",
  titleRequired: "Title is required",
  titleTooLong: "Title must be 256 characters or fewer",
  descriptionTooLong: "Description must be 65536 characters or fewer",
  branchNotFound: "Branch not found",
  sameBranch: "No changes: the base and compare branch are the same",
  noChanges: "No changes: the compare branch has no new commits",
  pairExists: "A pull request for these branches already exists",
  notDraft: "Pull request is not a draft",
  notOpen: "Pull request is not open",
  commentRequired: "Comment is required",
  commentTooLong: "Comment must be 65536 characters or fewer",
  commentAnchor: "The comment must target a changed line of this pull request",
  decisionRequired: "Choose a review decision",
  summaryTooLong: "Summary must be 65536 characters or fewer",
  reviewNotOpen: "Only an Open pull request can be reviewed",
  notClosable: "Only an unmerged Open or Draft pull request can be closed",
  notReopenable: "Only a Closed pull request can be reopened",
  reviewerRequired: "Choose a reviewer",
  reviewerNotEligible: "Member is not eligible to review this pull request",
  reviewerNotRequestable: "Only an Open or Draft pull request accepts reviewer requests",
  reviewRequiredByProtection: "Review required by branch protection",
  statusCheckRequired: "Required status check test must succeed",
  conflicts: "This branch has conflicts that must be resolved",
  changesRequested: "Changes requested must be resolved before merging",
};

export const STUB_CHECK_NAME = "test";
export const STUB_CHECK_STATUSES = ["pending", "success", "failure"];

export const STUB_PULL_TITLE_MAX_LENGTH = 256;
export const STUB_PULL_DESCRIPTION_MAX_LENGTH = 65536;
export const STUB_PULL_COMMENT_MAX_LENGTH = 65536;

/** The stored decisions of a review, and the aliases a form may send. */
const DECISION_ALIASES = new Map([
  ["comment", "comment"],
  ["approve", "approved"],
  ["approved", "approved"],
  ["request_changes", "changes_requested"],
  ["changes_requested", "changes_requested"],
]);

const WRITE_ROLES = new Set(["write", "maintain", "admin"]);
const MANAGE_ROLES = new Set(["maintain", "admin"]);
const LIVE_STATUSES = new Set(["draft", "open"]);

export interface StubPullRouteResult {
  status: number;
  body: unknown;
}

export interface StubPullReadInput {
  owner: string;
  target: "list" | "compare" | "detail";
  number?: string | null;
  params: URLSearchParams;
  view: StubRepositoryView;
  viewerRole: string | null;
  username: string | null;
  /** Every account with Write or higher on the repository. */
  reviewerCandidates: string[];
}

export interface StubPullWriteInput {
  owner: string;
  action:
    | "create"
    | "ready"
    | "merge"
    | "comment"
    | "review"
    | "check"
    | "requestReviewer"
    | "removeReviewer"
    | "close"
    | "reopen";
  number?: string | null;
  /** The addressed reviewer username, for the reviewer-request routes. */
  target?: string | null;
  view: StubRepositoryView;
  viewerRole: string | null;
  username: string;
  body: unknown;
  /** Every account with Write or higher on the repository. */
  reviewerCandidates: string[];
}

function now(): string {
  return new Date().toISOString();
}

let mergeSequence = 0;

/** A unique short sha for the merge commit the stub creates. */
function stubMergeSha(view: StubRepositoryView): string {
  mergeSequence += 1;
  let sha = `merge${mergeSequence}`;
  while (view.commits.some((commit) => commit.sha === sha)) {
    mergeSequence += 1;
    sha = `merge${mergeSequence}`;
  }
  return sha;
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

export function stubCanWritePullRequests(viewerRole: string | null): boolean {
  return viewerRole !== null && WRITE_ROLES.has(viewerRole);
}

function canManage(viewerRole: string | null): boolean {
  return viewerRole !== null && MANAGE_ROLES.has(viewerRole);
}

/** True while the viewer may request or remove reviewers or change the status. */
function canActOnPullRequest(
  viewerRole: string | null,
  username: string | null,
  pullRequest: StubPullRequest,
): boolean {
  return username !== null && (pullRequest.author === username || canManage(viewerRole));
}

/** The effective review status of one fixture pull request. */
export function stubPullReviewStatus(
  pullRequest: StubPullRequest,
  compareSha?: string | null,
): string {
  const decisions = (pullRequest.reviews ?? [])
    .filter((review) => review.stale !== true && review.superseded !== true)
    .filter(
      (review) => compareSha === undefined || (review.commitId ?? compareSha) === compareSha,
    )
    .map((review) => review.decision);
  if (decisions.includes("changes_requested")) return "changes_requested";
  if (decisions.includes("approved")) return "approved";
  return "review_required";
}

/** The approval accounts of the current compare commit, author excluded. */
export function stubApproversOf(pullRequest: StubPullRequest, compareSha: string | null) {
  const reviewers = (pullRequest.reviews ?? [])
    .filter(
      (review) =>
        review.decision === "approved" &&
        review.stale !== true &&
        review.superseded !== true &&
        (review.commitId ?? compareSha) === compareSha,
    )
    .map((review) => review.reviewer);
  return [...new Set(reviewers)].filter((reviewer) => reviewer !== pullRequest.author);
}

/** The stored branch protection rule bound to exactly this branch name. */
export function stubProtectionRule(view: StubRepositoryView, branchName: string) {
  return view.branchProtectionRules.find((rule) => rule.branchName === branchName) ?? null;
}

/** The `test` status of the current compare commit, with its setter. */
export function stubCheckPayload(view: StubRepositoryView, pullRequest: StubPullRequest) {
  const compareSha = compareShaOf(view, pullRequest);
  const stored =
    (pullRequest.checks ?? []).find(
      (check) =>
        check.name === STUB_CHECK_NAME && (check.commitSha ?? compareSha) === compareSha,
    ) ?? null;
  return {
    id: `pull-request-check-${pullRequest.number}-${STUB_CHECK_NAME}`,
    name: STUB_CHECK_NAME,
    status: stored?.status ?? "pending",
    commitId: compareSha ? `commit-${compareSha}` : null,
    updatedBy: stored?.updatedBy ?? null,
    updatedAt: stored?.updatedAt ?? null,
  };
}

function fileMapOf(commit: StubCommit | null) {
  const map = new Map<string, string>();
  for (const file of commit?.files ?? []) map.set(file.path, file.content);
  return map;
}

function contentOf(map: Map<string, string>, path: string): string | null {
  return map.has(path) ? (map.get(path) as string) : null;
}

/** The paths both revisions changed since the base with a different result. */
export function stubMergeConflictsOf(view: StubRepositoryView, pullRequest: StubPullRequest) {
  const base = fileMapOf(commitOfSha(view, baseShaOf(view, pullRequest)));
  const target = fileMapOf(commitOfSha(view, view.branchHeads[pullRequest.targetBranch] ?? null));
  const compare = fileMapOf(commitOfSha(view, compareShaOf(view, pullRequest)));
  const paths = new Set([...base.keys(), ...target.keys(), ...compare.keys()]);
  const conflicts: string[] = [];
  for (const path of paths) {
    const baseValue = contentOf(base, path);
    const targetValue = contentOf(target, path);
    const compareValue = contentOf(compare, path);
    const targetChanged = targetValue !== baseValue;
    const compareChanged = compareValue !== baseValue;
    if (targetChanged && compareChanged && targetValue !== compareValue) conflicts.push(path);
  }
  return conflicts.sort((left, right) => left.localeCompare(right));
}

/** The file snapshot the merge commit carries. */
export function stubMergedFilesOf(view: StubRepositoryView, pullRequest: StubPullRequest) {
  const base = fileMapOf(commitOfSha(view, baseShaOf(view, pullRequest)));
  const target = fileMapOf(commitOfSha(view, view.branchHeads[pullRequest.targetBranch] ?? null));
  const compare = fileMapOf(commitOfSha(view, compareShaOf(view, pullRequest)));
  const paths = new Set([...base.keys(), ...target.keys(), ...compare.keys()]);
  const files: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    const baseValue = contentOf(base, path);
    const compareValue = contentOf(compare, path);
    const targetValue = contentOf(target, path);
    const selected = compareValue !== baseValue ? compareValue : targetValue;
    if (selected !== null) files.push({ path, content: selected });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** Every merge condition with its state, exactly as the server evaluates it. */
export function stubMergeConditionsOf(view: StubRepositoryView, pullRequest: StubPullRequest) {
  const compareSha = compareShaOf(view, pullRequest);
  const rule = stubProtectionRule(view, pullRequest.targetBranch);
  const conditions: Array<{ id: string; label: string; satisfied: boolean }> = [
    {
      id: "changes_requested",
      label: STUB_PULL_MESSAGES.changesRequested,
      satisfied: stubPullReviewStatus(pullRequest, compareSha) !== "changes_requested",
    },
  ];
  if (rule?.requireApproval === true) {
    conditions.push({
      id: "approval",
      label: STUB_PULL_MESSAGES.reviewRequiredByProtection,
      satisfied: stubApproversOf(pullRequest, compareSha).length >= 1,
    });
  }
  if (rule?.requireStatusCheck === true) {
    conditions.push({
      id: "status_check",
      label: STUB_PULL_MESSAGES.statusCheckRequired,
      satisfied: stubCheckPayload(view, pullRequest).status === "success",
    });
  }
  conditions.push({
    id: "conflicts",
    label: STUB_PULL_MESSAGES.conflicts,
    satisfied: stubMergeConflictsOf(view, pullRequest).length === 0,
  });
  return conditions;
}

function identityOf(owner: string, view: StubRepositoryView, viewerRole: string | null) {
  return {
    owner,
    name: view.name,
    description: view.description,
    visibility: view.visibility,
    defaultBranch: view.defaultBranch,
    viewerRole,
    source: view.source ?? null,
  };
}

function commitIdentity(commit: StubCommit | null) {
  if (!commit) return null;
  return {
    id: `commit-${commit.sha}`,
    sha: commit.sha,
    shortSha: shortSha(commit.sha),
    message: commit.message,
    author: commit.author,
    createdAt: commit.createdAt,
  };
}

function commitOfSha(view: StubRepositoryView, sha: string | null): StubCommit | null {
  return sha ? stubCommitBySha(view, sha) : null;
}

function baseShaOf(view: StubRepositoryView, pullRequest: StubPullRequest): string | null {
  return pullRequest.baseCommitSha ?? view.branchHeads[pullRequest.targetBranch] ?? null;
}

function compareShaOf(view: StubRepositoryView, pullRequest: StubPullRequest): string | null {
  return (
    pullRequest.compareCommitSha ?? view.branchHeads[pullRequest.sourceBranch] ?? null
  );
}

/** The comparable commits and the line diff between two stored revisions. */
function comparisonOf(
  view: StubRepositoryView,
  baseSha: string | null,
  compareSha: string | null,
) {
  const baseCommit = commitOfSha(view, baseSha);
  const compareCommit = commitOfSha(view, compareSha);
  const chain = compareCommit ? stubCommitChain(view, compareCommit) : [];
  const index = baseCommit ? chain.findIndex((commit) => commit.sha === baseCommit.sha) : -1;
  const commits = index === -1 ? chain : chain.slice(0, index);
  const diff =
    baseCommit || compareCommit
      ? stubDiffSnapshots(baseCommit, compareCommit ?? {
          sha: "",
          message: "",
          author: "",
          createdAt: "",
          parentSha: null,
          files: [],
        })
      : { files: [], additions: 0, deletions: 0 };
  return {
    commits: commits.map((commit) => commitIdentity(commit)),
    commitCount: commits.length,
    files: diff.files,
    changedFileCount: diff.files.length,
    additions: diff.additions,
    deletions: diff.deletions,
    noChanges: commits.length === 0 || diff.files.length === 0,
  };
}

function rowOf(view: StubRepositoryView, pullRequest: StubPullRequest) {
  const createdAt = pullRequest.createdAt ?? view.updatedAt;
  return {
    id: `pull-request-${view.name}-${pullRequest.number}`,
    number: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.description ?? "",
    author: pullRequest.author,
    status: pullRequest.status,
    sourceBranch: pullRequest.sourceBranch,
    targetBranch: pullRequest.targetBranch,
    reviewers: [...(pullRequest.reviewers ?? [])],
    reviewStatus: stubPullReviewStatus(pullRequest, compareShaOf(view, pullRequest)),
    commentCount: (pullRequest.comments ?? []).length,
    createdAt,
    updatedAt: pullRequest.updatedAt ?? createdAt,
  };
}

function eventRecords(pullRequest: StubPullRequest) {
  const createdAt = pullRequest.createdAt ?? now();
  const stored =
    pullRequest.events && pullRequest.events.length > 0
      ? pullRequest.events
      : [{ type: "created", actor: pullRequest.author, createdAt, data: {} }];
  return stored.map((event, index) => ({
    id: `pull-request-event-${pullRequest.number}-${index + 1}`,
    type: event.type,
    actor: event.actor,
    createdAt: event.createdAt,
    data: event.data ?? {},
  }));
}

function findPullRequest(
  view: StubRepositoryView,
  number: string | null | undefined,
): StubPullRequest | undefined {
  if (number === null || number === undefined) return undefined;
  const requested = Number.parseInt(String(number).replace(/^#/, ""), 10);
  if (!Number.isInteger(requested)) return undefined;
  return view.pullRequests.find((candidate) => candidate.number === requested);
}

function detailOf(
  owner: string,
  view: StubRepositoryView,
  pullRequest: StubPullRequest,
  viewerRole: string | null,
  username: string | null,
  reviewerCandidates: string[],
) {
  const baseCommit = commitOfSha(view, baseShaOf(view, pullRequest));
  const compareCommit = commitOfSha(view, compareShaOf(view, pullRequest));
  const compareSha = compareShaOf(view, pullRequest);
  const canManagePull = canManage(viewerRole);
  const canAct = canActOnPullRequest(viewerRole, username, pullRequest);
  const rule = stubProtectionRule(view, pullRequest.targetBranch);
  const mergeConditions = stubMergeConditionsOf(view, pullRequest);
  const mergeable = mergeConditions.every((condition) => condition.satisfied);
  return {
    repository: identityOf(owner, view, viewerRole),
    pullRequest: {
      ...rowOf(view, pullRequest),
      baseCommit: commitIdentity(baseCommit),
      compareCommit: commitIdentity(compareCommit),
      closedAt: pullRequest.closedAt ?? null,
      mergedAt: pullRequest.mergedAt ?? null,
      mergedBy: pullRequest.mergedBy ?? null,
      mergeCommitId: pullRequest.mergeCommitSha ? `commit-${pullRequest.mergeCommitSha}` : null,
      mergeCommitSha: pullRequest.mergeCommitSha ?? null,
    },
    comparison: comparisonOf(view, baseShaOf(view, pullRequest), compareSha),
    checks: [stubCheckPayload(view, pullRequest)],
    reviews: (pullRequest.reviews ?? []).map((review, index) => ({
      id: `pull-request-review-${pullRequest.number}-${index + 1}`,
      reviewer: review.reviewer,
      decision: review.decision,
      body: review.body ?? "",
      commitId: review.commitId ?? compareSha,
      stale: review.stale === true,
      superseded: review.superseded === true,
      createdAt: review.createdAt ?? pullRequest.createdAt ?? now(),
    })),
    // A pending review draft stays visible to its author only.
    comments: (pullRequest.comments ?? [])
      .filter((comment) => comment.pending !== true || comment.author === username)
      .map((comment, index) => ({
        id: `pull-request-comment-${pullRequest.number}-${index + 1}`,
        author: comment.author,
        body: comment.body,
        path: comment.path ?? null,
        line: comment.line ?? null,
        commitId: comment.commitId ?? compareSha,
        outdated: comment.outdated === true,
        pending: comment.pending === true,
        createdAt: comment.createdAt ?? pullRequest.createdAt ?? now(),
      })),
    events: eventRecords(pullRequest),
    viewerRole,
    canWrite: stubCanWritePullRequests(viewerRole),
    reviewerCandidates: reviewerCandidates
      .filter((candidate) => candidate !== pullRequest.author)
      .slice()
      .sort((left, right) => left.localeCompare(right)),
    canRequestReviewers:
      canAct && (pullRequest.status === "open" || pullRequest.status === "draft"),
    canClose: canAct && (pullRequest.status === "open" || pullRequest.status === "draft"),
    canReopen: canAct && pullRequest.status === "closed",
    targetProtection: rule
      ? {
          branchName: rule.branchName,
          requireApproval: rule.requireApproval === true,
          requireStatusCheck: rule.requireStatusCheck === true,
        }
      : null,
    mergeConditions,
    mergeable,
    mergeBlocker: mergeConditions.find((condition) => !condition.satisfied)?.label ?? null,
    canMerge:
      canManagePull && pullRequest.status === "open" && mergeable,
    canReadyForReview:
      pullRequest.status === "draft" &&
      (pullRequest.author === username || canManagePull),
  };
}

/**
 * Answers a read of one pull-request route. The caller has already resolved the
 * repository and the viewer's read permission; the comparison entry re-checks
 * the Write permission like the server does.
 */
export function handleRepositoryPullReadStub(input: StubPullReadInput): StubPullRouteResult {
  const { owner, view, params } = input;
  const viewerRole = input.viewerRole;
  const username = input.username;
  const rows = [...view.pullRequests].sort((left, right) => right.number - left.number);

  if (input.target === "list") {
    return {
      status: 200,
      body: {
        repository: identityOf(owner, view, viewerRole),
        canCreate: stubCanWritePullRequests(viewerRole),
        counts: {
          draft: rows.filter((row) => row.status === "draft").length,
          open: rows.filter((row) => row.status === "open").length,
          closed: rows.filter((row) => row.status === "closed").length,
          merged: rows.filter((row) => row.status === "merged").length,
          all: rows.length,
        },
        pullRequests: rows.map((row) => rowOf(view, row)),
      },
    };
  }

  if (input.target === "compare") {
    if (!stubCanWritePullRequests(viewerRole)) {
      return { status: 403, body: { error: "Access denied" } };
    }
    const baseName = (params.get("base") ?? "").trim() || view.defaultBranch;
    const compareName = (params.get("compare") ?? "").trim() || view.defaultBranch;
    if (!view.branches.includes(baseName) || !view.branches.includes(compareName)) {
      return { status: 404, body: { error: STUB_PULL_MESSAGES.notFound } };
    }
    const baseCommit = stubHeadCommit(view, baseName);
    const compareCommit = stubHeadCommit(view, compareName);
    const comparison = comparisonOf(view, baseCommit?.sha ?? null, compareCommit?.sha ?? null);
    const sameBranch = baseName === compareName;
    return {
      status: 200,
      body: {
        repository: identityOf(owner, view, viewerRole),
        branches: [...view.branches],
        base: { name: baseName, commit: commitIdentity(baseCommit) },
        compare: { name: compareName, commit: commitIdentity(compareCommit) },
        sameBranch,
        ...comparison,
        noChanges: sameBranch || comparison.noChanges,
        canCreate: !sameBranch && !comparison.noChanges,
      },
    };
  }

  const pullRequest = findPullRequest(view, input.number ?? null);
  if (!pullRequest) return { status: 404, body: { error: STUB_PULL_MESSAGES.notFound } };
  return {
    status: 200,
    body: detailOf(
      owner,
      view,
      pullRequest,
      viewerRole,
      username,
      input.reviewerCandidates,
    ),
  };
}

/**
 * Answers one pull-request write. The caller has already refused a visitor and
 * an unreadable repository; this mirrors the server rules for the stored role,
 * the field rules and the branch pair.
 */
export function handleRepositoryPullWriteStub(input: StubPullWriteInput): StubPullRouteResult {
  const { view, viewerRole, username } = input;
  const body = (input.body ?? {}) as Record<string, unknown>;
  const detail = (pullRequest: StubPullRequest) =>
    detailOf(input.owner, view, pullRequest, viewerRole, username, input.reviewerCandidates);

  if (input.action === "create") {
    if (!stubCanWritePullRequests(viewerRole)) {
      return { status: 403, body: { error: "Access denied" } };
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description : "";
    const fieldErrors: Record<string, string> = {};
    if (title.length === 0) fieldErrors.title = STUB_PULL_MESSAGES.titleRequired;
    else if (title.length > STUB_PULL_TITLE_MAX_LENGTH) {
      fieldErrors.title = STUB_PULL_MESSAGES.titleTooLong;
    }
    if (description.length > STUB_PULL_DESCRIPTION_MAX_LENGTH) {
      fieldErrors.description = STUB_PULL_MESSAGES.descriptionTooLong;
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { status: 400, body: { error: STUB_PULL_MESSAGES.notCreated, fieldErrors } };
    }

    const baseName = String(body.base ?? "").trim() || view.defaultBranch;
    const compareName = String(body.compare ?? "").trim() || view.defaultBranch;
    const errors: Record<string, string> = {};
    if (!view.branches.includes(baseName)) errors.base = STUB_PULL_MESSAGES.branchNotFound;
    if (!view.branches.includes(compareName)) {
      errors.compare = STUB_PULL_MESSAGES.branchNotFound;
    }
    if (Object.keys(errors).length === 0) {
      if (baseName === compareName) errors.compare = STUB_PULL_MESSAGES.sameBranch;
      else {
        const baseCommit = stubHeadCommit(view, baseName);
        const compareCommit = stubHeadCommit(view, compareName);
        const comparison = comparisonOf(view, baseCommit?.sha ?? null, compareCommit?.sha ?? null);
        if (comparison.noChanges) errors.compare = STUB_PULL_MESSAGES.noChanges;
        else if (
          view.pullRequests.some(
            (existing) =>
              LIVE_STATUSES.has(existing.status) &&
              existing.sourceBranch === compareName &&
              existing.targetBranch === baseName,
          )
        ) {
          errors.compare = STUB_PULL_MESSAGES.pairExists;
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      return { status: 400, body: { error: STUB_PULL_MESSAGES.notCreated, fieldErrors: errors } };
    }

    const createdAt = now();
    const number =
      view.pullRequests.reduce((highest, existing) => Math.max(highest, existing.number), 0) + 1;
    const pullRequest: StubPullRequest = {
      number,
      title,
      description,
      author: username,
      status: body.draft === true ? "draft" : "open",
      sourceBranch: compareName,
      targetBranch: baseName,
      reviewers: [],
      reviews: [],
      comments: [],
      checks: [],
      events: [{ type: "created", actor: username, createdAt, data: {} }],
      baseCommitSha: view.branchHeads[baseName] ?? null,
      compareCommitSha: view.branchHeads[compareName] ?? null,
      createdAt,
      updatedAt: createdAt,
    };
    view.pullRequests.push(pullRequest);
    return { status: 201, body: detail(pullRequest) };
  }

  const pullRequest = findPullRequest(view, input.number ?? null);
  if (!pullRequest) return { status: 404, body: { error: STUB_PULL_MESSAGES.notFound } };

  // The reviewer requests: one pending-review relationship per candidate
  // account, stored and deleted at once by the author or a manager.
  if (input.action === "requestReviewer" || input.action === "removeReviewer") {
    if (!canActOnPullRequest(viewerRole, username, pullRequest)) {
      return { status: 403, body: { error: "Access denied" } };
    }
    if (pullRequest.status !== "open" && pullRequest.status !== "draft") {
      return {
        status: 400,
        body: {
          error: STUB_PULL_MESSAGES.notUpdated,
          fieldErrors: { status: STUB_PULL_MESSAGES.reviewerNotRequestable },
        },
      };
    }
    const requested =
      input.action === "requestReviewer"
        ? typeof body.username === "string"
          ? body.username.trim()
          : ""
        : String(input.target ?? "").trim();
    const candidate = input.reviewerCandidates.find((name) => name === requested) ?? null;
    if (requested.length === 0 || !candidate || candidate === pullRequest.author) {
      return {
        status: 400,
        body: {
          error: STUB_PULL_MESSAGES.notUpdated,
          fieldErrors: {
            username:
              requested.length === 0
                ? STUB_PULL_MESSAGES.reviewerRequired
                : STUB_PULL_MESSAGES.reviewerNotEligible,
          },
        },
      };
    }
    const at = now();
    if (input.action === "requestReviewer") {
      // Requesting an already requested reviewer stores one relationship only.
      if (!(pullRequest.reviewers ?? []).includes(candidate)) {
        pullRequest.reviewers = [...(pullRequest.reviewers ?? []), candidate];
        pullRequest.updatedAt = at;
        pullRequest.events = [
          ...(pullRequest.events ?? []),
          {
            type: "review_requested",
            actor: username,
            createdAt: at,
            data: { reviewer: candidate },
          },
        ];
      }
      return { status: 201, body: detail(pullRequest) };
    }
    if ((pullRequest.reviewers ?? []).includes(candidate)) {
      pullRequest.reviewers = (pullRequest.reviewers ?? []).filter((name) => name !== candidate);
      pullRequest.updatedAt = at;
      pullRequest.events = [
        ...(pullRequest.events ?? []),
        {
          type: "review_request_removed",
          actor: username,
          createdAt: at,
          data: { reviewer: candidate },
        },
      ];
    }
    return { status: 200, body: detail(pullRequest) };
  }

  // Closing and reopening only change the status and the activity history; no
  // branch, commit, comment or review is touched.
  if (input.action === "close" || input.action === "reopen") {
    if (!canActOnPullRequest(viewerRole, username, pullRequest)) {
      return { status: 403, body: { error: "Access denied" } };
    }
    const allowed = input.action === "close" ? ["open", "draft"] : ["closed"];
    if (!allowed.includes(pullRequest.status)) {
      return {
        status: 400,
        body: {
          error: STUB_PULL_MESSAGES.notUpdated,
          fieldErrors: {
            status:
              input.action === "close"
                ? STUB_PULL_MESSAGES.notClosable
                : STUB_PULL_MESSAGES.notReopenable,
          },
        },
      };
    }
    const at = now();
    pullRequest.status = input.action === "close" ? "closed" : "open";
    pullRequest.closedAt = input.action === "close" ? at : null;
    pullRequest.updatedAt = at;
    pullRequest.events = [
      ...(pullRequest.events ?? []),
      {
        type: input.action === "close" ? "closed" : "reopened",
        actor: username,
        createdAt: at,
        data: {},
      },
    ];
    return { status: 200, body: detail(pullRequest) };
  }

  if (input.action === "comment") {
    if (!stubCanWritePullRequests(viewerRole)) {
      return { status: 403, body: { error: "Access denied" } };
    }
    const commentBody = typeof body.body === "string" ? body.body.trim() : "";
    const path = typeof body.path === "string" ? body.path : "";
    const line = Number.parseInt(String(body.line ?? ""), 10);
    const fieldErrors: Record<string, string> = {};
    if (commentBody.length === 0) fieldErrors.body = STUB_PULL_MESSAGES.commentRequired;
    else if (commentBody.length > STUB_PULL_COMMENT_MAX_LENGTH) {
      fieldErrors.body = STUB_PULL_MESSAGES.commentTooLong;
    }
    const comparison = comparisonOf(
      view,
      baseShaOf(view, pullRequest),
      compareShaOf(view, pullRequest),
    );
    const file = comparison.files.find((entry) => entry.path === path);
    if (!file) fieldErrors.path = STUB_PULL_MESSAGES.commentAnchor;
    else if (
      !Number.isInteger(line) ||
      line < 1 ||
      line > file.lines.length ||
      file.lines[line - 1]?.type === "context"
    ) {
      fieldErrors.line = STUB_PULL_MESSAGES.commentAnchor;
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { status: 400, body: { error: STUB_PULL_MESSAGES.notUpdated, fieldErrors } };
    }
    const commentCreatedAt = now();
    const pending = body.pending === true;
    pullRequest.comments = [
      ...(pullRequest.comments ?? []),
      {
        author: username,
        body: commentBody,
        path,
        line,
        commitId: compareShaOf(view, pullRequest),
        outdated: false,
        pending,
        createdAt: commentCreatedAt,
      },
    ];
    if (!pending) {
      pullRequest.events = [
        ...(pullRequest.events ?? []),
        { type: "commented", actor: username, createdAt: commentCreatedAt, data: {} },
      ];
    }
    pullRequest.updatedAt = commentCreatedAt;
    return { status: 201, body: detail(pullRequest) };
  }

  if (input.action === "review") {
    if (!stubCanWritePullRequests(viewerRole)) {
      return { status: 403, body: { error: "Access denied" } };
    }
    // The author of a pull request never reviews it, and only an Open record
    // accepts a review submission.
    if (pullRequest.author === username) {
      return { status: 403, body: { error: "Access denied" } };
    }
    if (pullRequest.status !== "open") {
      return {
        status: 400,
        body: {
          error: STUB_PULL_MESSAGES.notUpdated,
          fieldErrors: { status: STUB_PULL_MESSAGES.reviewNotOpen },
        },
      };
    }
    const decision = DECISION_ALIASES.get(String(body.decision ?? "").trim()) ?? null;
    if (decision === null) {
      return {
        status: 400,
        body: {
          error: STUB_PULL_MESSAGES.notUpdated,
          fieldErrors: { decision: STUB_PULL_MESSAGES.decisionRequired },
        },
      };
    }
    const summary = typeof body.body === "string" ? body.body.trim() : "";
    if (summary.length > STUB_PULL_COMMENT_MAX_LENGTH) {
      return {
        status: 400,
        body: {
          error: STUB_PULL_MESSAGES.notUpdated,
          fieldErrors: { summary: STUB_PULL_MESSAGES.summaryTooLong },
        },
      };
    }
    const reviewCreatedAt = now();
    const commitSha = compareShaOf(view, pullRequest);
    const published = (pullRequest.comments ?? []).filter(
      (comment) => comment.author === username && comment.pending === true,
    );
    pullRequest.reviews = (pullRequest.reviews ?? []).map((review) =>
      review.reviewer === username &&
      (review.commitId ?? commitSha) === commitSha &&
      review.superseded !== true
        ? { ...review, superseded: true }
        : review,
    );
    pullRequest.comments = (pullRequest.comments ?? []).map((comment) =>
      comment.author === username && comment.pending === true
        ? { ...comment, pending: false }
        : comment,
    );
    pullRequest.reviews = [
      ...pullRequest.reviews,
      {
        reviewer: username,
        decision,
        body: summary,
        commitId: commitSha,
        stale: false,
        superseded: false,
        createdAt: reviewCreatedAt,
      },
    ];
    pullRequest.events = [
      ...(pullRequest.events ?? []),
      ...published.map(() => ({
        type: "commented",
        actor: username,
        createdAt: reviewCreatedAt,
        data: {},
      })),
      { type: "reviewed", actor: username, createdAt: reviewCreatedAt, data: { decision } },
    ];
    pullRequest.updatedAt = reviewCreatedAt;
    return { status: 201, body: detail(pullRequest) };
  }

  if (input.action === "check") {
    // Only a repository Admin may store the `test` status, and the result
    // belongs to the compare commit of the record.
    if (viewerRole !== "admin") {
      return { status: 403, body: { error: "Access denied" } };
    }
    const name = typeof body.name === "string" ? body.name.trim() : STUB_CHECK_NAME;
    const status = typeof body.status === "string" ? body.status.trim() : "";
    if (name !== STUB_CHECK_NAME || !STUB_CHECK_STATUSES.includes(status)) {
      return {
        status: 400,
        body: {
          error: STUB_PULL_MESSAGES.notUpdated,
          fieldErrors: { status: "Check status is not supported" },
        },
      };
    }
    const compareSha = compareShaOf(view, pullRequest);
    const at = now();
    const stored = (pullRequest.checks ?? []).find(
      (check) =>
        check.name === STUB_CHECK_NAME && (check.commitSha ?? compareSha) === compareSha,
    );
    if (stored) {
      stored.status = status;
      stored.updatedBy = username;
      stored.updatedAt = at;
    } else {
      pullRequest.checks = [
        ...(pullRequest.checks ?? []),
        {
          name: STUB_CHECK_NAME,
          status,
          commitSha: compareSha,
          updatedBy: username,
          updatedAt: at,
        },
      ];
    }
    pullRequest.updatedAt = at;
    return { status: 200, body: detail(pullRequest) };
  }

  if (input.action === "ready") {
    if (pullRequest.author !== username && !canManage(viewerRole)) {
      return { status: 403, body: { error: "Access denied" } };
    }
    if (pullRequest.status !== "draft") {
      return {
        status: 400,
        body: {
          error: STUB_PULL_MESSAGES.notUpdated,
          fieldErrors: { status: STUB_PULL_MESSAGES.notDraft },
        },
      };
    }
    const updatedAt = now();
    pullRequest.status = "open";
    pullRequest.updatedAt = updatedAt;
    pullRequest.events = [
      ...(pullRequest.events ?? []),
      { type: "ready_for_review", actor: username, createdAt: updatedAt, data: {} },
    ];
    return { status: 200, body: detail(pullRequest) };
  }

  if (!canManage(viewerRole)) return { status: 403, body: { error: "Access denied" } };
  if (pullRequest.status !== "open") {
    return {
      status: 400,
      body: {
        error: STUB_PULL_MESSAGES.notUpdated,
        fieldErrors: { status: STUB_PULL_MESSAGES.notOpen },
      },
    };
  }
  // Every condition is re-evaluated here: an unmet review or protection
  // requirement, or a merge conflict, refuses the merge without moving any
  // branch and without changing the record.
  const unmet = stubMergeConditionsOf(view, pullRequest).find(
    (condition) => !condition.satisfied,
  );
  if (unmet) {
    return {
      status: 400,
      body: { error: STUB_PULL_MESSAGES.notUpdated, fieldErrors: { merge: unmet.label } },
    };
  }
  const mergedAt = now();
  const targetHeadSha = view.branchHeads[pullRequest.targetBranch] ?? null;
  const mergeCommit: StubCommit = {
    sha: stubMergeSha(view),
    message: `Merge pull request #${pullRequest.number} from ${pullRequest.sourceBranch} into ${pullRequest.targetBranch}`,
    author: username,
    createdAt: mergedAt,
    parentSha: targetHeadSha,
    files: stubMergedFilesOf(view, pullRequest),
  };
  view.commits.push(mergeCommit);
  view.branchHeads[pullRequest.targetBranch] = mergeCommit.sha;
  pullRequest.status = "merged";
  pullRequest.updatedAt = mergedAt;
  pullRequest.mergedAt = mergedAt;
  pullRequest.mergedBy = username;
  pullRequest.mergeCommitSha = mergeCommit.sha;
  pullRequest.events = [
    ...(pullRequest.events ?? []),
    {
      type: "merged",
      actor: username,
      createdAt: mergedAt,
      data: { sha: mergeCommit.sha, commitMessage: mergeCommit.message },
    },
  ];
  return { status: 200, body: detail(pullRequest) };
}
