import { render } from "@testing-library/react";
import { vi } from "vitest";

import { App } from "../App";

/**
 * In-memory stand-in for the pull-request API (REQ-6). The data mirrors the seed:
 * `alice-dev/acme-docs` carries the branches `main`, `feature-search`, `release`
 * and `draft-feature`, the Closed pull request `Improve onboarding` and the Open
 * one `Fix search`, both proposing `feature-search` into `main`, plus the Draft
 * pull request `Draft onboarding update` of `carol-dev`, which proposes
 * `draft-feature` into `main` and starts without a submitted review
 * (REQ-6-2-4). No check result and no branch protection rule is stored, so
 * `test` reads as `pending` and the `main` branch is unprotected until a
 * scenario creates a rule.
 */

type Role = "read" | "triage" | "write" | "maintain" | "admin" | null;

interface AccountFixture {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

export const ALICE: AccountFixture = {
  id: "account-alice-dev",
  username: "alice-dev",
  email: "alice.dev@example.test",
  emailVerified: true,
};
export const CAROL: AccountFixture = {
  id: "account-carol-dev",
  username: "carol-dev",
  email: "carol.dev@example.test",
  emailVerified: true,
};
export const BOB: AccountFixture = {
  id: "account-bob-reviewer",
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  emailVerified: true,
};

/**
 * The Write collaborators of `alice-dev/acme-docs`: the owner `alice-dev` plus
 * the seeded Write collaborators `bob-reviewer` and `carol-dev`, who may be
 * asked to review a proposal they do not author (REQ-6-3-3, REQ-6-4).
 */
const WRITE_ACCOUNTS: readonly AccountFixture[] = [ALICE, BOB, CAROL];

interface StubInlineComment {
  id: string;
  author: string;
  path: string;
  line: number;
  lineNumber: number | null;
  body: string;
  state: "published" | "pending";
  commitId: string;
}

interface StubCommit {
  id: string;
  shortId: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  changedFiles: string[];
}

const MAIN_INITIAL: StubCommit = {
  id: "commit-main-1",
  shortId: "main001",
  message: "Initial commit",
  author: "alice-dev",
  createdAt: "2024-01-05T09:00:00.000Z",
  parentId: null,
  changedFiles: ["README.md"],
};
const MAIN_DOCUMENT: StubCommit = {
  id: "commit-main-2",
  shortId: "main002",
  message: "Document search flow",
  author: "alice-dev",
  createdAt: "2024-02-12T09:30:00.000Z",
  parentId: MAIN_INITIAL.id,
  changedFiles: ["README.md", "docs/README.md", "src/search.ts"],
};
const MAIN_LOADER: StubCommit = {
  id: "commit-main-3",
  shortId: "main003",
  message: "Add search loader",
  author: "alice-dev",
  createdAt: "2024-02-20T15:45:00.000Z",
  parentId: MAIN_DOCUMENT.id,
  changedFiles: ["src/loader.ts", "src/search.ts"],
};
/**
 * The head of `feature-search`: one commit ahead of `main`, adding
 * `main-only.md` and editing `src/search.ts`, so the comparison of the seeded
 * pull requests holds one added file and the modified file `src/search.ts`
 * (REQ-6-2-2, REQ-6-3-2).
 */
export const FEATURE_MAIN_ONLY: StubCommit = {
  id: "commit-feature-2",
  shortId: "feat002",
  message: "Add main-only notes",
  author: "alice-dev",
  createdAt: "2024-02-21T10:15:00.000Z",
  parentId: MAIN_LOADER.id,
  changedFiles: ["main-only.md", "src/search.ts"],
};
/** The head of `draft-feature`, the compare branch of the seeded Draft proposal. */
export const DRAFT_FEATURE: StubCommit = {
  id: "commit-draft-1",
  shortId: "draft01",
  message: "Draft the onboarding update",
  author: "carol-dev",
  createdAt: "2024-03-01T10:20:00.000Z",
  parentId: MAIN_LOADER.id,
  changedFiles: ["README.md"],
};

const BRANCH_HEADS: Record<string, string> = {
  main: MAIN_LOADER.id,
  "feature-search": FEATURE_MAIN_ONLY.id,
  release: MAIN_DOCUMENT.id,
  "draft-feature": DRAFT_FEATURE.id,
};

const COMMITS: Record<string, StubCommit> = {
  [MAIN_INITIAL.id]: MAIN_INITIAL,
  [MAIN_DOCUMENT.id]: MAIN_DOCUMENT,
  [MAIN_LOADER.id]: MAIN_LOADER,
  [FEATURE_MAIN_ONLY.id]: FEATURE_MAIN_ONLY,
  [DRAFT_FEATURE.id]: DRAFT_FEATURE,
};

interface StubChangedFile {
  path: string;
  name: string;
  changeType: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  diff: Array<{ kind: string; text: string; oldLine: number | null; newLine: number | null }>;
}

function changedFile(
  path: string,
  changeType: StubChangedFile["changeType"],
  text: string,
  additions = changeType === "deleted" ? 0 : 1,
  deletions = changeType === "added" ? 0 : 1,
): StubChangedFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    changeType,
    additions,
    deletions,
    diff: [
      {
        kind: changeType === "deleted" ? "remove" : "add",
        text,
        oldLine: 1,
        newLine: changeType === "deleted" ? null : 1,
      },
    ],
  };
}

/** The comparison of two branch heads, mirroring the seeded branch contents. */
function comparisonFor(base: string, compare: string, defaultBranch: string) {
  const baseHead = BRANCH_HEADS[base] ?? defaultBranch;
  const compareHead = BRANCH_HEADS[compare] ?? defaultBranch;
  if (!base || !compare || base === compare) {
    return { commits: [], changedFiles: [] as StubChangedFile[], commitCount: 0 };
  }
  if (base === "main" && compare === "feature-search") {
    return {
      commits: [FEATURE_MAIN_ONLY],
      changedFiles: [
        {
          path: "main-only.md",
          name: "main-only.md",
          changeType: "added",
          additions: 3,
          deletions: 0,
          diff: [
            { kind: "add", text: "# Main-only notes", oldLine: null, newLine: 1 },
            { kind: "add", text: "", oldLine: null, newLine: 2 },
            {
              kind: "add",
              text: "This note file exists only on feature-search.",
              oldLine: null,
              newLine: 3,
            },
          ],
        },
        {
          path: "src/search.ts",
          name: "search.ts",
          changeType: "modified",
          additions: 0,
          deletions: 1,
          diff: [
            {
              kind: "context",
              text: "export function searchFlow(query: string, lines: string[]): string[] {",
              oldLine: 1,
              newLine: 1,
            },
            {
              kind: "remove",
              text: "export function countSearchFlow(lines: string[]): number {",
              oldLine: 2,
              newLine: null,
            },
            {
              kind: "context",
              text: "  return lines.filter((line) => line.includes(\"search flow\")).length;",
              oldLine: 3,
              newLine: 3,
            },
          ],
        },
      ],
      commitCount: 1,
    };
  }
  if (base === "release" && compare === "main") {
    return {
      commits: [MAIN_LOADER],
      changedFiles: [
        changedFile("src/loader.ts", "added", "export function loadSearch() {}"),
        changedFile("src/search.ts", "modified", "export function countSearchFlow() {}"),
      ],
      commitCount: 1,
    };
  }
  if (base === "main" && compare === "draft-feature") {
    return {
      commits: [DRAFT_FEATURE],
      changedFiles: [
        changedFile("README.md", "modified", "Onboarding notes, shortened for the first draft."),
      ],
      commitCount: 1,
    };
  }
  void baseHead;
  void compareHead;
  return { commits: [], changedFiles: [] as StubChangedFile[], commitCount: 0 };
}

export interface StubPull {
  number: number;
  title: string;
  description: string;
  status: "draft" | "open" | "closed" | "merged";
  author: string;
  baseBranch: string;
  compareBranch: string;
  baseCommitId: string;
  compareCommitId: string;
  createdAt: string;
  updatedAt: string;
  comments: Array<{ id: string; author: string; body: string; createdAt: string }>;
  reviews: Array<{
    id: string;
    reviewer: string;
    decision: "comment" | "approve" | "request_changes";
    body?: string;
    commitId: string;
    createdAt: string;
  }>;
  reviewerIds: string[];
  /** The stored merge result of a merged proposal (REQ-6-5). */
  mergedBy?: string;
  mergedAt?: string;
  mergeCommitId?: string;
  inlineComments: StubInlineComment[];
  activities: Array<{
    id: string;
    type: string;
    actor: string;
    createdAt: string;
    value?: string | null;
    detail?: string | null;
  }>;
}

export interface StubRule {
  id: string;
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
  createdBy: string;
  createdAt: string;
}

export interface Stub {
  account: AccountFixture | null;
  role: Role;
  pulls: StubPull[];
  checks: Array<{ number: number; commitId: string; status: string; setBy: string; setAt: string }>;
  rules: StubRule[];
  writes: Array<{ method: string; path: string; body: Record<string, unknown> }>;
}

export function initialStub(): Stub {
  return {
    account: null,
    role: null,
    pulls: [
      {
        // The blocked merge seed of the same comparison (REQ-6-5): an Open
        // proposal of `carol-dev` without any approval of its compare commit.
        number: 4,
        title: "Add search flow notes",
        description: "Describe the search flow helpers and the branch-only note file.",
        status: "open",
        author: "carol-dev",
        baseBranch: "main",
        compareBranch: "feature-search",
        baseCommitId: MAIN_LOADER.id,
        compareCommitId: FEATURE_MAIN_ONLY.id,
        createdAt: "2024-03-02T09:15:00.000Z",
        updatedAt: "2024-03-02T09:15:00.000Z",
        comments: [],
        reviews: [],
        reviewerIds: [],
        inlineComments: [],
        activities: [
          {
            id: "pull-activity-blocked-1",
            type: "created",
            actor: "carol-dev",
            createdAt: "2024-03-02T09:15:00.000Z",
          },
        ],
      },
      {
        // The dedicated ready-for-review seed (REQ-6-2-4): a Draft proposal of
        // `carol-dev` with no submitted review.
        number: 3,
        title: "Draft onboarding update",
        description: "Shorten the onboarding notes before asking for a review.",
        status: "draft",
        author: "carol-dev",
        baseBranch: "main",
        compareBranch: "draft-feature",
        baseCommitId: MAIN_LOADER.id,
        compareCommitId: DRAFT_FEATURE.id,
        createdAt: "2024-03-01T10:25:00.000Z",
        updatedAt: "2024-03-01T10:25:00.000Z",
        comments: [],
        reviews: [],
        reviewerIds: [],
        inlineComments: [],
        activities: [
          {
            id: "pull-activity-draft-1",
            type: "created",
            actor: "carol-dev",
            createdAt: "2024-03-01T10:25:00.000Z",
          },
        ],
      },
      {
        number: 2,
        title: "Fix search",
        description: "Search must read the branch that is currently browsed.",
        status: "open",
        author: "alice-dev",
        baseBranch: "main",
        compareBranch: "feature-search",
        baseCommitId: MAIN_LOADER.id,
        compareCommitId: FEATURE_MAIN_ONLY.id,
        createdAt: "2024-02-27T16:20:00.000Z",
        updatedAt: "2024-02-27T16:20:00.000Z",
        comments: [
          {
            id: "pull-comment-1",
            author: "bob-reviewer",
            body: "The helper looks right; please add a check for the loader.",
            createdAt: "2024-02-27T16:40:00.000Z",
          },
        ],
        reviews: [],
        // The seeded Open proposal of `alice-dev` starts without a reviewer
        // request, so its author requests the eligible collaborator on the page
        // (REQ-6-4).
        reviewerIds: [],
        inlineComments: [],
        activities: [
          {
            id: "pull-activity-1",
            type: "created",
            actor: "alice-dev",
            createdAt: "2024-02-27T16:20:00.000Z",
          },
        ],
      },
      {
        number: 1,
        title: "Improve onboarding",
        description: "Rework the onboarding notes.",
        status: "closed",
        author: "alice-dev",
        baseBranch: "main",
        compareBranch: "feature-search",
        baseCommitId: MAIN_LOADER.id,
        compareCommitId: FEATURE_MAIN_ONLY.id,
        createdAt: "2024-02-21T09:10:00.000Z",
        updatedAt: "2024-02-25T11:05:00.000Z",
        comments: [],
        reviews: [],
        reviewerIds: [],
        inlineComments: [],
        activities: [
          {
            id: "pull-activity-2",
            type: "created",
            actor: "alice-dev",
            createdAt: "2024-02-21T09:10:00.000Z",
          },
          {
            id: "pull-activity-3",
            type: "closed",
            actor: "alice-dev",
            createdAt: "2024-02-25T11:05:00.000Z",
          },
        ],
      },
    ],
    checks: [],
    rules: [],
    writes: [],
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

export const REPO = "/api/repositories/alice-dev/acme-docs";

function canWrite(role: Role): boolean {
  return role === "write" || role === "maintain" || role === "admin";
}

function repositoryContext(stub: Stub, branch = "main") {
  return {
    id: "repo-alice-dev-acme-docs",
    name: "acme-docs",
    fullName: "alice-dev/acme-docs",
    ownerDisplayName: "alice-dev",
    owner: { type: "user", login: "alice-dev" },
    visibility: "public",
    description: "Documentation and guides for the Acme platform.",
    defaultBranch: "main",
    updatedAt: "2024-03-02T10:00:00.000Z",
    forkedFrom: null,
    branch,
    branches: Object.keys(BRANCH_HEADS).map((name) => ({
      name,
      headCommitId: BRANCH_HEADS[name],
    })),
    permissions: { role: stub.role, canAdminister: stub.role === "admin" },
  };
}

function checkOf(stub: Stub, pull: StubPull) {
  const stored = stub.checks.find(
    (check) => check.number === pull.number && check.commitId === pull.compareCommitId,
  );
  return {
    name: "test",
    commitId: pull.compareCommitId,
    status: stored?.status ?? "pending",
    setBy: stored?.setBy ?? null,
    setAt: stored?.setAt ?? null,
  };
}

function mergeabilityOf(stub: Stub, pull: StubPull) {
  const rule = stub.rules.find((candidate) => candidate.branchName === pull.baseBranch);
  const check = checkOf(stub, pull);
  const reviews = pull.reviews.filter((review) => review.commitId === pull.compareCommitId);
  const approvals = reviews.filter(
    (review) => review.decision === "approve" && review.reviewer !== pull.author,
  );
  const requestedChanges = reviews.some((review) => review.decision === "request_changes");
  const open = pull.status === "open";
  const approved = approvals.length >= 1;
  const checkPassed = check.status === "success";
  const reasons: string[] = [];
  if (pull.status === "merged") reasons.push("The pull request is already merged.");
  else if (!open) reasons.push("The pull request is not open.");
  if (rule?.requireApproval && !approved) {
    reasons.push("Review required by branch protection");
  }
  if (rule?.requireStatusCheck && !checkPassed) {
    reasons.push("The required check test must be successful.");
  }
  if (requestedChanges) reasons.push("A reviewer requested changes.");

  const conditions = [{ id: "open", label: "Proposal eligible", satisfied: open }];
  if (rule) {
    conditions.push({ id: "approval", label: "1 approval", satisfied: approved });
    conditions.push({ id: "check", label: "Require status check test", satisfied: checkPassed });
  }
  conditions.push({ id: "review", label: "No requested changes", satisfied: !requestedChanges });
  conditions.push({ id: "conflicts", label: "No merge conflicts", satisfied: true });

  return {
    mergeable: reasons.length === 0,
    protectedBranch: Boolean(rule),
    requireApproval: rule?.requireApproval === true,
    requireStatusCheck: rule?.requireStatusCheck === true,
    conflicts: [] as string[],
    conditions,
    reasons,
  };
}

function reviewStatusOf(pull: StubPull): string {
  const current = pull.reviews.filter((review) => review.commitId === pull.compareCommitId);
  if (current.some((review) => review.decision === "request_changes")) return "changes_requested";
  const latest = new Map<string, string>();
  for (const review of current) latest.set(review.reviewer, review.decision);
  return [...latest.values()].includes("approve") ? "approved" : "review_required";
}

function summaryOf(stub: Stub, pull: StubPull) {
  return {
    id: `pull-${pull.number}`,
    number: pull.number,
    title: pull.title,
    description: pull.description,
    status: pull.status,
    statusLabel: pull.status.charAt(0).toUpperCase() + pull.status.slice(1),
    author: pull.author,
    baseBranch: pull.baseBranch,
    compareBranch: pull.compareBranch,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    currentCompareCommitId: pull.compareCommitId,
    reviewStatus: reviewStatusOf(pull),
  };
}

function detailOf(stub: Stub, pull: StubPull) {
  const comparison = comparisonFor(pull.baseBranch, pull.compareBranch, MAIN_LOADER.id);
  const diff = comparison.changedFiles;
  return {
    ...summaryOf(stub, pull),
    baseCommit: {
      id: pull.baseCommitId,
      shortId: pull.baseCommitId.slice(0, 7),
      message: COMMITS[pull.baseCommitId]?.message ?? "",
      author: "alice-dev",
      createdAt: COMMITS[pull.baseCommitId]?.createdAt ?? "",
    },
    compareCommit: {
      id: pull.compareCommitId,
      shortId: pull.compareCommitId.slice(0, 7),
      message: COMMITS[pull.compareCommitId]?.message ?? "",
      author: "alice-dev",
      createdAt: COMMITS[pull.compareCommitId]?.createdAt ?? "",
    },
    creationBaseCommitId: pull.baseCommitId,
    creationCompareCommitId: pull.compareCommitId,
    commits: comparison.commits,
    commitCount: comparison.commitCount,
    changedFiles: diff,
    filesChanged: diff.length,
    additions: diff.reduce((total, file) => total + file.additions, 0),
    deletions: diff.reduce((total, file) => total + file.deletions, 0),
    comments: pull.comments,
    reviews: pull.reviews.map((review) => ({
      id: review.id,
      reviewer: review.reviewer,
      reviewerId: `account-${review.reviewer}`,
      decision: review.decision,
      decisionLabel:
        review.decision === "approve"
          ? "Approved"
          : review.decision === "request_changes"
            ? "Changes requested"
            : "Commented",
      body: review.body ?? "",
      commitId: review.commitId,
      commitShortId: review.commitId.slice(0, 7),
      stale: review.commitId !== pull.compareCommitId,
    })),
    // A pending draft is only returned to the reviewer who wrote it, so it is
    // never displayed as published before the review is submitted (REQ-6-3-3).
    inlineComments: pull.inlineComments
      .filter(
        (comment) => comment.state === "published" || comment.author === stub.account?.username,
      )
      .map((comment) => ({
      id: comment.id,
      author: comment.author,
      authorId: `account-${comment.author}`,
      path: comment.path,
      line: comment.line,
      kind: "add",
      lineNumber: comment.lineNumber,
      body: comment.body,
      state: comment.state,
      commitId: comment.commitId,
      commitShortId: comment.commitId.slice(0, 7),
      outdated: comment.commitId !== pull.compareCommitId,
      createdAt: "2024-03-08T10:00:00.000Z",
    })),
    requestedReviewers: pull.reviewerIds.map((accountId) => accountId.replace("account-", "")),
    reviewerCandidates: WRITE_ACCOUNTS.filter(
      (account) => account.username !== pull.author,
    ).map((account) => account.username),
    checks: [checkOf(stub, pull)],
    activities: pull.activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      actor: activity.actor,
      createdAt: activity.createdAt,
      value: activity.value ?? null,
      detail: activity.detail ?? null,
    })),
    mergeability: mergeabilityOf(stub, pull),
    merge:
      pull.status === "merged" && pull.mergeCommitId
        ? {
            by: pull.mergedBy ?? "",
            at: pull.mergedAt ?? "",
            commitId: pull.mergeCommitId,
            commitShortId: pull.mergeCommitId.slice(0, 7),
            method: "Create a merge commit",
          }
        : null,
    permissions: {
      canWrite: canWrite(stub.role),
      canManage: stub.role === "maintain" || stub.role === "admin",
      isAuthor: stub.account?.username === pull.author,
      canSetCheckStatus: stub.role === "admin",
      canComment: canWrite(stub.role),
      // A Draft accepts no review decision until it is ready for review, the
      // author never reviews the own proposal, and an inline code comment needs
      // a non-author writer on an Open proposal (REQ-6-3-3, REQ-6-3-4).
      canReview:
        canWrite(stub.role) &&
        stub.account?.username !== pull.author &&
        pull.status !== "draft",
      canInlineComment:
        canWrite(stub.role) &&
        stub.account?.username !== pull.author &&
        pull.status === "open",
      canRequestReviewers: canWrite(stub.role),
      canChangeStatus: canWrite(stub.role),
      canMerge: stub.role === "maintain" || stub.role === "admin",
    },
  };
}

/** One stored record of the stub by its repository-scoped number. */
export function pullOf(stub: Stub, number: number): StubPull {
  const pull = stub.pulls.find((candidate) => candidate.number === number);
  if (!pull) throw new Error(`no stored pull request #${number} in the stub`);
  return pull;
}

export function installFetch(stub: Stub) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const pullMatch = path.match(/^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)$/);
    const checkMatch = path.match(/^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)\/checks$/);
    const reviewMatch = path.match(/^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)\/reviews$/);
    const commentMatch = path.match(/^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)\/comments$/);
    const statusMatch = path.match(/^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)\/status$/);
    const mergeMatch = path.match(/^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)\/merge$/);
    const inlineMatch = path.match(
      /^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)\/inline-comments$/,
    );
    const reviewerMatch = path.match(
      /^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)\/reviewers$/,
    );
    const reviewerRemovalMatch = path.match(
      /^\/api\/repositories\/[^/]+\/[^/]+\/pulls\/(\d+)\/reviewers\/(.+)$/,
    );

    if (path === "/api/session") return jsonResponse(200, { account: stub.account });
    if (path === "/api/search") {
      return jsonResponse(200, { query: "", type: "repositories", repositories: [] });
    }
    if (path === "/api/namespaces") return jsonResponse(401, { error: "Not authenticated" });
    if (path === REPO && method === "GET") {
      return jsonResponse(200, { repository: repositoryContext(stub) });
    }
    if (path === `${REPO}/pulls` && method === "GET") {
      return jsonResponse(200, {
        repository: repositoryContext(stub),
        pullRequests: stub.pulls.map((pull) => summaryOf(stub, pull)),
      });
    }
    if (path === `${REPO}/pulls/compare` && method === "GET") {
      const base = url.searchParams.get("base") ?? "";
      const compare = url.searchParams.get("compare") ?? "";
      const comparison = comparisonFor(base, compare, "main");
      return jsonResponse(200, {
        repository: repositoryContext(stub),
        base: { name: base, headCommitId: BRANCH_HEADS[base] ?? null },
        compare: { name: compare, headCommitId: BRANCH_HEADS[compare] ?? null },
        sameBranch: base === compare,
        commitCount: comparison.commitCount,
        commits: comparison.commits,
        changedFiles: comparison.changedFiles,
        filesChanged: comparison.changedFiles.length,
        additions: comparison.changedFiles.reduce((total, file) => total + file.additions, 0),
        deletions: comparison.changedFiles.reduce((total, file) => total + file.deletions, 0),
        canCreate:
          canWrite(stub.role) && base !== compare && comparison.commitCount > 0,
      });
    }
    if (path === `${REPO}/pulls` && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      if (!canWrite(stub.role)) {
        return jsonResponse(403, {
          error: "You need write permission to create a pull request in this repository.",
        });
      }
      // The creation form always submits a title, so a blank or overlong one is
      // refused here just like the server does (REQ-6-2-3).
      const suppliedTitle =
        body?.title === undefined || body?.title === null ? null : String(body.title);
      const description = String(body?.description ?? "").trim();
      if (suppliedTitle !== null) {
        const trimmed = suppliedTitle.trim();
        if (!trimmed) {
          return jsonResponse(400, {
            error: "Pull request creation failed",
            fields: { title: "Title is required" },
          });
        }
        if (trimmed.length > 256) {
          return jsonResponse(400, {
            error: "Pull request creation failed",
            fields: { title: "Title is too long (256 characters maximum)" },
          });
        }
      }
      if (description.length > 65_536) {
        return jsonResponse(400, {
          error: "Pull request creation failed",
          fields: { description: "Description is too long (65536 characters maximum)" },
        });
      }
      const base = String(body?.base ?? "");
      const compare = String(body?.compare ?? "");
      const comparison = comparisonFor(base, compare, "main");
      if (base === compare || comparison.commitCount === 0) {
        return jsonResponse(400, {
          error: "Pull request creation failed",
          fields: { compare: "These branches have no comparable commits" },
        });
      }
      if (
        stub.pulls.some(
          (pull) =>
            pull.baseBranch === base &&
            pull.compareBranch === compare &&
            (pull.status === "draft" || pull.status === "open"),
        )
      ) {
        return jsonResponse(400, {
          error: "Pull request creation failed",
          fields: { compare: "A pull request already exists for these branches" },
        });
      }
      const number = Math.max(...stub.pulls.map((pull) => pull.number)) + 1;
      const created: StubPull = {
        number,
        title: String(suppliedTitle ?? "").trim() || COMMITS[BRANCH_HEADS[compare]]?.message || compare,
        description,
        status: body?.draft === true ? "draft" : "open",
        author: stub.account.username,
        baseBranch: base,
        compareBranch: compare,
        baseCommitId: BRANCH_HEADS[base],
        compareCommitId: BRANCH_HEADS[compare],
        createdAt: "2024-03-04T09:00:00.000Z",
        updatedAt: "2024-03-04T09:00:00.000Z",
        comments: [],
        reviews: [],
        reviewerIds: [],
        inlineComments: [],
        activities: [
          {
            id: `pull-activity-${number}`,
            type: "created",
            actor: stub.account.username,
            createdAt: "2024-03-04T09:00:00.000Z",
          },
        ],
      };
      stub.pulls.unshift(created);
      return jsonResponse(201, {
        repository: repositoryContext(stub, base),
        pullRequest: detailOf(stub, created),
      });
    }
    if (checkMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (stub.role !== "admin") {
        return jsonResponse(403, {
          error: "You must be a repository administrator to update the check status.",
        });
      }
      const number = Number(checkMatch[1]);
      const pull = stub.pulls.find((candidate) => candidate.number === number);
      if (!pull) return jsonResponse(404, { error: "Not found" });
      const status = String(body?.status ?? "");
      stub.checks = stub.checks.filter(
        (check) => !(check.number === number && check.commitId === pull.compareCommitId),
      );
      stub.checks.push({
        number,
        commitId: pull.compareCommitId,
        status,
        setBy: stub.account?.username ?? "alice-dev",
        setAt: "2024-03-05T12:00:00.000Z",
      });
      return jsonResponse(200, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (reviewMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      if (!canWrite(stub.role)) {
        return jsonResponse(403, { error: "You need write permission to add comments or reviews." });
      }
      const pull = stub.pulls.find((candidate) => candidate.number === Number(reviewMatch[1]));
      if (!pull) return jsonResponse(404, { error: "Not found" });
      if (pull.status === "draft") {
        return jsonResponse(403, {
          error: "A draft pull request cannot be reviewed. Mark it ready for review first.",
        });
      }
      if (stub.account.username === pull.author) {
        return jsonResponse(403, { error: "The author of a pull request cannot review it." });
      }
      // Submitting the review publishes the drafts it collected.
      for (const comment of pull.inlineComments) {
        if (comment.author === stub.account.username && comment.state === "pending") {
          comment.state = "published";
        }
      }
      pull.reviews.push({
        id: `review-${pull.reviews.length + 1}`,
        reviewer: stub.account.username,
        decision: String(body?.decision ?? "comment") as "comment",
        body: String(body?.body ?? "").trim(),
        commitId: pull.compareCommitId,
        createdAt: "2024-03-07T10:00:00.000Z",
      });
      return jsonResponse(201, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (commentMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      if (!canWrite(stub.role)) {
        return jsonResponse(403, { error: "You need write permission to add comments or reviews." });
      }
      const pull = stub.pulls.find((candidate) => candidate.number === Number(commentMatch[1]));
      if (!pull) return jsonResponse(404, { error: "Not found" });
      const text = String(body?.body ?? "").trim();
      if (!text) {
        return jsonResponse(400, { error: "Comment failed", fields: { body: "Comment is required" } });
      }
      pull.comments.push({
        id: `pull-comment-${pull.comments.length + 1}`,
        author: stub.account.username,
        body: text,
        createdAt: "2024-03-07T10:00:00.000Z",
      });
      return jsonResponse(201, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (inlineMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      if (!canWrite(stub.role)) {
        return jsonResponse(403, { error: "You need write permission to add comments or reviews." });
      }
      const pull = stub.pulls.find((candidate) => candidate.number === Number(inlineMatch[1]));
      if (!pull) return jsonResponse(404, { error: "Not found" });
      if (stub.account.username === pull.author) {
        return jsonResponse(403, {
          error: "The author of a pull request cannot comment on its code lines.",
        });
      }
      if (pull.status !== "open") {
        return jsonResponse(403, { error: "Only an open pull request accepts review comments." });
      }
      const text = String(body?.body ?? "").trim();
      if (!text) {
        return jsonResponse(400, {
          error: "Comment failed",
          fields: { body: "Comment is required" },
        });
      }
      const file = comparisonFor(pull.baseBranch, pull.compareBranch, "main").changedFiles.find(
        (candidate) => candidate.path === String(body?.path ?? ""),
      );
      const line = Number(body?.line);
      const entry = file?.diff[line];
      if (!entry || (entry.kind !== "add" && entry.kind !== "remove")) {
        return jsonResponse(400, {
          error: "Comment failed",
          fields: { line: "That line cannot be commented on." },
        });
      }
      pull.inlineComments.push({
        id: `inline-${pull.inlineComments.length + 1}`,
        author: stub.account.username,
        path: file.path,
        line,
        lineNumber: entry.kind === "remove" ? entry.oldLine : entry.newLine,
        body: text,
        state: body?.pending === true ? "pending" : "published",
        commitId: pull.compareCommitId,
      });
      return jsonResponse(201, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (reviewerMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      const pull = stub.pulls.find((candidate) => candidate.number === Number(reviewerMatch[1]));
      if (!pull) return jsonResponse(404, { error: "Not found" });
      const isAuthor = stub.account.username === pull.author;
      if (!isAuthor && !(stub.role === "maintain" || stub.role === "admin")) {
        return jsonResponse(403, { error: "Only the author or a maintainer may request reviewers." });
      }
      const username = String(body?.username ?? "").trim();
      const candidate = WRITE_ACCOUNTS.find((account) => account.username === username);
      if (!candidate || candidate.username === pull.author) {
        return jsonResponse(400, {
          error: "Reviewer request failed",
          fields: { username: "That account cannot review this repository" },
        });
      }
      if (!pull.reviewerIds.includes(candidate.id)) pull.reviewerIds.push(candidate.id);
      return jsonResponse(201, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (reviewerRemovalMatch && method === "DELETE") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      const pull = stub.pulls.find(
        (candidate) => candidate.number === Number(reviewerRemovalMatch[1]),
      );
      if (!pull) return jsonResponse(404, { error: "Not found" });
      const isAuthor = stub.account.username === pull.author;
      if (!isAuthor && !(stub.role === "maintain" || stub.role === "admin")) {
        return jsonResponse(403, { error: "Only the author or a maintainer may request reviewers." });
      }
      const wanted = decodeURIComponent(reviewerRemovalMatch[2]);
      const account = WRITE_ACCOUNTS.find((candidate) => candidate.username === wanted);
      if (!account || !pull.reviewerIds.includes(account.id)) {
        return jsonResponse(400, {
          error: "Reviewer request failed",
          fields: { username: "That account is not a requested reviewer." },
        });
      }
      // Only the request is deleted; submitted reviews and comments stay.
      pull.reviewerIds = pull.reviewerIds.filter((accountId) => accountId !== account.id);
      return jsonResponse(200, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (mergeMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      const pull = stub.pulls.find((candidate) => candidate.number === Number(mergeMatch[1]));
      if (!pull) return jsonResponse(404, { error: "Not found" });
      const requestedMethod = String(body?.method ?? "merge").trim().toLowerCase();
      if (requestedMethod !== "merge") {
        return jsonResponse(400, {
          error: "Merge failed",
          fields: { method: "Unknown merge method" },
        });
      }
      if (pull.status === "merged") {
        return jsonResponse(400, {
          error: "Merge failed",
          fields: { status: "A merged pull request cannot be changed" },
        });
      }
      if (!(stub.role === "maintain" || stub.role === "admin")) {
        return jsonResponse(403, {
          error:
            pull.status === "draft"
              ? "A draft pull request cannot be merged. Mark it ready for review first."
              : "Only a maintainer or administrator may merge a pull request.",
        });
      }
      if (pull.status !== "open") {
        return jsonResponse(400, {
          error: "Merge failed",
          fields: { status: "The pull request cannot be merged yet." },
        });
      }
      const mergeability = mergeabilityOf(stub, pull);
      if (!mergeability.mergeable) {
        return jsonResponse(400, {
          error: "Merge failed",
          fields: { status: mergeability.reasons[0] ?? "The pull request cannot be merged yet." },
        });
      }
      const mergeCommitId = `merge${pull.number}abcdef0123456789abcdef01234567`;
      pull.status = "merged";
      pull.mergedBy = stub.account.username;
      pull.mergedAt = "2024-03-09T11:30:00.000Z";
      pull.mergeCommitId = mergeCommitId.slice(0, 40);
      pull.activities.push({
        id: `pull-activity-${pull.number}-merged`,
        type: "merged",
        actor: stub.account.username,
        createdAt: pull.mergedAt,
        value: "merged",
        detail: pull.mergeCommitId,
      });
      return jsonResponse(200, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (statusMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      const pull = stub.pulls.find((candidate) => candidate.number === Number(statusMatch[1]));
      if (!pull) return jsonResponse(404, { error: "Not found" });
      const next = String(body?.status ?? "") as StubPull["status"];
      const isAuthor = stub.account.username === pull.author;
      const canManage = stub.role === "maintain" || stub.role === "admin";
      if (next === "merged") {
        if (pull.status === "draft") {
          return jsonResponse(403, {
            error: "A draft pull request cannot be merged. Mark it ready for review first.",
          });
        }
        if (!canManage) return jsonResponse(403, { error: "Only a maintainer or administrator may merge a pull request." });
        if (!mergeabilityOf(stub, pull).mergeable) {
          return jsonResponse(400, {
            error: "Merge failed",
            fields: { status: "The pull request cannot be merged yet." },
          });
        }
      } else if (!isAuthor && !canManage) {
        return jsonResponse(403, { error: "You may not change the status of this pull request." });
      }
      const previousStatus = pull.status;
      pull.status = next;
      pull.activities.push({
        id: `pull-activity-${pull.number}-${pull.activities.length + 1}`,
        type:
          next === "merged"
            ? "merged"
            : next === "closed"
              ? "closed"
              : previousStatus === "closed"
                ? "reopened"
                : "ready_for_review",
        actor: stub.account.username,
        createdAt: "2024-03-07T10:00:00.000Z",
      });
      return jsonResponse(200, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (pullMatch && method === "GET") {
      const number = Number(pullMatch[1]);
      const pull = stub.pulls.find((candidate) => candidate.number === number);
      if (!pull) {
        return jsonResponse(404, {
          error: "Pull request not found",
          repository: repositoryContext(stub),
        });
      }
      return jsonResponse(200, {
        repository: repositoryContext(stub, pull.baseBranch),
        pullRequest: detailOf(stub, pull),
      });
    }
    if (path === `${REPO}/branch-protection`) {
      return jsonResponse(200, { repository: repositoryContext(stub), rules: stub.rules });
    }
    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
}

/**
 * Opens one address of the application. The caller renders a fresh tree per
 * address, so `<App />` reads the session, the repository and the stored record
 * of the address it was opened with.
 */
export function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

