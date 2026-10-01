import { vi } from "vitest";

import { installSyncXhr } from "./sync-xhr";
import {
  diffSummary,
  fileLanguage,
  fileName,
  numberFileLines,
  revisionChanges,
  splitLines,
} from "./repository-mock-reads";

/**
 * In-memory stand-in for the repository HTTP surface (REQ-3-2, REQ-3-4, REQ-4).
 *
 * It stores repositories per namespace and applies the same rules as the
 * server: a personal namespace belongs to its account, an organization
 * namespace to its Owners, names are unique per namespace, a private source can
 * only be forked as private, only a repository Admin can change its visibility,
 * the repository list only carries repositories the caller may read, and the
 * Code page reads files through the branch a commit chain points to. The tests
 * observe the request log and the stored state.
 */

export interface MockRepositoryFile {
  path: string;
  content: string;
}

export interface MockRepositoryCommit {
  id: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  branch: string;
  files: Array<{ path: string; change: string }>;
  tree: MockRepositoryFile[];
}

export interface MockRepositoryBranch {
  name: string;
  headId: string;
  protected?: boolean;
}

/** A pre-existing colored label name of the repository (REQ-5). */
export interface MockRepositoryLabel {
  name: string;
  color: string;
  description?: string;
}

/** A pre-existing milestone of the repository (REQ-5). */
export interface MockRepositoryMilestone {
  id: string;
  title: string;
  state?: string;
}

/** One stored reaction of an issue or of one of its comments (REQ-5-2-3). */
export interface MockIssueReaction {
  targetType: "issue" | "comment";
  targetId: string;
  account: string;
  type: string;
}

/** One branch protection rule of a repository (REQ-6-1). */
export interface MockBranchProtectionRule {
  id: string;
  pattern: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
}

/** One stored check result of a pull request's compare commit (REQ-6-1). */
export interface MockPullRequestCheck {
  name: string;
  commitId: string;
  status: "pending" | "success" | "failure";
  setBy: string | null;
  setAt: string | null;
}

/** One stored inline review comment of a pull request (REQ-6-3-3). */
export interface MockPullRequestReviewComment {
  id: string;
  filePath: string;
  line: number;
  side: "added" | "removed";
  commitId: string;
  author: string;
  body: string;
  pending: boolean;
  createdAt: string;
}

/** One stored pull request of a repository (REQ-6). */
export interface MockPullRequest {
  id: string;
  number: number;
  title: string;
  description: string;
  author: string;
  status: "draft" | "open" | "closed" | "merged";
  baseBranch: string;
  compareBranch: string;
  baseCommitId: string;
  compareCommitId: string;
  reviewers: string[];
  reviews: Array<{
    id: string;
    reviewer: string;
    decision: string;
    summary?: string;
    commitId: string;
    createdAt: string;
  }>;
  comments: Array<{ id: string; author: string; body: string; createdAt: string }>;
  reviewComments: MockPullRequestReviewComment[];
  checks: MockPullRequestCheck[];
  timeline: Array<{ id: string; type: string; actor: string; text: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
  /** REQ-6-5: the merger, the time and the resulting commit of a merge. */
  mergedBy?: string;
  mergedAt?: string;
  mergeCommitId?: string;
  /** REQ-6-6: the time the pull request was last closed. */
  closedAt?: string;
}

/** One stored work item of a repository (REQ-5). */
export interface MockIssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  reactions: MockIssueReaction[];
}

export interface MockIssueEvent {
  id: string;
  type: string;
  actor: string;
  text: string;
  createdAt: string;
}

export interface MockIssue {
  id?: string;
  number: number;
  title: string;
  body: string;
  status: "open" | "closed";
  author: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  createdAt: string;
  updatedAt: string;
  comments: MockIssueComment[];
  reactions: MockIssueReaction[];
  timeline: MockIssueEvent[];
}

export interface MockRepository {
  id: string;
  owner: string;
  ownerType: "account" | "organization";
  ownerDisplayName: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  branches: MockRepositoryBranch[];
  commits: MockRepositoryCommit[];
  sourceRepositoryId: string | null;
  /** Accounts holding a direct role on the repository. */
  grants: Array<{ account: string; role: MockRole }>;
  /** The pre-existing classification items of the repository (REQ-5). */
  labels: MockRepositoryLabel[];
  milestones: MockRepositoryMilestone[];
  issues: MockIssue[];
  /** The stored branch protection rules of the repository (REQ-6-1). */
  protectionRules: MockBranchProtectionRule[];
  /** The stored pull requests of the repository (REQ-6). */
  pullRequests: MockPullRequest[];
}

export interface MockRepositoryRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/** The repository roles of the permission rules (REQ-2-3, REQ-5). */
export type MockRole = "Read" | "Triage" | "Write" | "Maintain" | "Admin";

export interface MockRepositoryState {
  viewer: string | null;
  organizations: Array<{ name: string; displayName: string; role: "Owner" | "Member" }>;
  repositories: MockRepository[];
  requests: MockRepositoryRequest[];
}

export interface MockRepositoryServer {
  state: MockRepositoryState;
  install(): void;
}

const TIMESTAMP = "2024-06-01T00:00:00.000Z";
const WRITE_ROLES = ["Write", "Maintain", "Admin"];

/** The operation-specific role lists of the issue workflow (REQ-5). */
const ISSUE_CONTENT_ROLES = ["Write", "Maintain", "Admin"];
const ISSUE_TRIAGE_ROLES = ["Triage", "Maintain", "Admin"];

/** The reaction types the UI offers (REQ-5-2-3). */
const REACTION_TYPES = ["👍", "👎", "😄", "🎉", "😕", "❤", "🚀", "👀"];

/** The seeded work items of `acme-docs` (REQ-5, REQ-5-1). */
export function seedIssues(): MockIssue[] {
  return [
    {
      number: 1,
      title: "Improve onboarding",
      body: "Describe the onboarding improvement.",
      status: "open",
      author: "alice-dev",
      labels: ["bug", "documentation"],
      assignees: ["bob-reviewer"],
      milestone: "Q3 launch",
      createdAt: "2024-06-05T09:00:00.000Z",
      updatedAt: "2024-06-06T10:00:00.000Z",
      comments: [
        {
          id: "comment-acme-docs-1-1",
          author: "bob-reviewer",
          body: "Great idea. Let us start with the welcome screen.",
          createdAt: "2024-06-06T10:00:00.000Z",
          reactions: [],
        },
      ],
      reactions: [],
      timeline: [
        {
          id: "event-acme-docs-1-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this issue",
          createdAt: "2024-06-05T09:00:00.000Z",
        },
        {
          id: "event-acme-docs-1-labeled-bug",
          type: "labeled",
          actor: "alice-dev",
          text: "added the bug label",
          createdAt: "2024-06-05T09:05:00.000Z",
        },
        {
          id: "event-acme-docs-1-assigned",
          type: "assigned",
          actor: "alice-dev",
          text: "assigned bob-reviewer",
          createdAt: "2024-06-05T09:15:00.000Z",
        },
        {
          id: "event-acme-docs-1-commented",
          type: "commented",
          actor: "bob-reviewer",
          text: "commented",
          createdAt: "2024-06-06T10:00:00.000Z",
        },
      ],
    },
    {
      number: 2,
      title: "Legacy welcome text",
      body: "The welcome text still names the retired demo environment.",
      status: "closed",
      author: "bob-reviewer",
      labels: ["bug"],
      assignees: [],
      milestone: null,
      createdAt: "2024-05-20T08:00:00.000Z",
      updatedAt: "2024-05-28T16:00:00.000Z",
      comments: [],
      reactions: [],
      timeline: [
        {
          id: "event-acme-docs-2-created",
          type: "created",
          actor: "bob-reviewer",
          text: "opened this issue",
          createdAt: "2024-05-20T08:00:00.000Z",
        },
        {
          id: "event-acme-docs-2-closed",
          type: "closed",
          actor: "alice-dev",
          text: "closed this issue",
          createdAt: "2024-05-28T16:00:00.000Z",
        },
      ],
    },
    // REQ-5-2-2: the invalid-edit seed, whose original title must survive a
    // rejected save.
    {
      number: 3,
      title: "Original issue title",
      body: "The original description of the seeded issue.",
      status: "open",
      author: "alice-dev",
      labels: [],
      assignees: [],
      milestone: null,
      createdAt: "2024-06-07T09:00:00.000Z",
      updatedAt: "2024-06-07T09:00:00.000Z",
      comments: [],
      reactions: [],
      timeline: [
        {
          id: "event-acme-docs-3-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this issue",
          createdAt: "2024-06-07T09:00:00.000Z",
        },
      ],
    },
    // REQ-5-3: the isolated work item of the metadata scenarios. It starts
    // Open without an assignee, a label or a milestone.
    {
      number: 4,
      title: "Add changelog page",
      body: "Collect the released changes on one page.",
      status: "open",
      author: "alice-dev",
      labels: [],
      assignees: [],
      milestone: null,
      createdAt: "2024-06-08T09:00:00.000Z",
      updatedAt: "2024-06-08T09:00:00.000Z",
      comments: [],
      reactions: [],
      timeline: [
        {
          id: "event-acme-docs-4-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this issue",
          createdAt: "2024-06-08T09:00:00.000Z",
        },
      ],
    },
  ];
}

const ACME_DOCS_README = "# Acme Docs\n\nDocumentation for the Acme Demo platform.\n\nThe search flow finds documentation across the repository.\n";
const ACME_DOCS_README_V1 = "# Acme Docs\n\nDraft notes\n\nDocumentation for the Acme Demo platform.\n";
const ACME_DOCS_CONTRIBUTING = "# Contributing\n\nOpen an issue before sending a change.\n";
const ACME_DOCS_INTRO = "# Introduction\n\nThis is the introduction to the Acme Demo documentation.\n\nStart browsing from the Code page.\n";
const ACME_DOCS_INTRO_V1 = "# Introduction\n\nThis is the introduction to the Acme Demo documentation.\n";
const ACME_DOCS_SEARCH_TS =
  "export function search(query: string): string {\n"
  + "  return `search flow for ${query}`;\n"
  + "}\n\nexport const SEARCH_FLOW_LABEL = \"Search flow\";\n";
const ACME_DOCS_MAIN_ONLY = "# Main-only notes\n\nThis file exists only on the feature-search branch.\n";
/**
 * The modified version of the code file on the head of `onboarding-docs`: it
 * drops the exported label, so the comparison of that branch against `main` is
 * one added file of three lines and one modified file with a single deleted
 * line (REQ-6-3-2 spells `3 additions, 1 deletions`).
 */
const ACME_DOCS_SEARCH_TS_V2 =
  "export function search(query: string): string {\n"
  + "  return `search flow for ${query}`;\n"
  + "}\n\n";
const ACME_DOCS_ONBOARDING =
  "# Onboarding\n\nA short path from cloning the repository to the first contribution.\n";
const ACME_DOCS_DRAFT_NOTES =
  "# Draft notes\n\nWork in progress notes for the onboarding draft.\n";

/**
 * The seeded pull requests of `acme-docs` (REQ-6, REQ-6-1, REQ-6-2).
 *
 * `Improve onboarding` is the stable, uniquely titled Open pull request a
 * visitor reads on the public Pull requests page; it targets `main` from
 * `onboarding-docs` and holds no stored check result, so the `test` check of its
 * current compare commit starts pending (REQ-6-1). `Fix search` is the seeded
 * Closed pull request of the same list, authored by the same account the
 * filtering scenario narrows the list to. `Draft onboarding update` is the
 * separate ready-for-review seed pull request: it belongs to `alice-dev`, is
 * Draft, targets `main` from `draft-feature` and has no submitted review. The
 * pair `main` ← `feature-search` carries no Draft or Open pull request, so it
 * stays a valid comparison and creation context.
 */
export function seedPullRequests(): MockPullRequest[] {
  return [
    {
      id: "pull-request-acme-docs-1",
      number: 1,
      title: "Improve onboarding",
      description: "Rewrite the onboarding notes so a new contributor can start quickly.",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "onboarding-docs",
      baseCommitId: "9c3e5b1-acme-docs-search",
      compareCommitId: "c5d8f41-acme-docs-onboarding",
      reviewers: [],
      reviews: [],
      // REQ-6-3-1: the seeded discussion of the public pull request.
      comments: [
        {
          id: "comment-acme-docs-pull-1-1",
          author: "bob-reviewer",
          body: "The onboarding steps read much better now. Please add a screenshot of the first run.",
          createdAt: "2024-06-10T11:00:00.000Z",
        },
      ],
      reviewComments: [],
      checks: [],
      timeline: [
        {
          id: "event-acme-docs-pull-1-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this pull request",
          createdAt: "2024-06-10T09:00:00.000Z",
        },
        {
          id: "event-acme-docs-pull-1-commented",
          type: "commented",
          actor: "bob-reviewer",
          text: "commented",
          createdAt: "2024-06-10T11:00:00.000Z",
        },
      ],
      createdAt: "2024-06-10T09:00:00.000Z",
      updatedAt: "2024-06-10T11:00:00.000Z",
    },
    {
      id: "pull-request-acme-docs-2",
      number: 2,
      title: "Fix search",
      description: "Correct the search snippets on the documentation page.",
      author: "alice-dev",
      status: "closed",
      baseBranch: "main",
      compareBranch: "feature-search",
      baseCommitId: "9c3e5b1-acme-docs-search",
      compareCommitId: "d7b2a08-acme-docs-branch-only",
      reviewers: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      checks: [],
      timeline: [
        {
          id: "event-acme-docs-pull-2-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this pull request",
          createdAt: "2024-06-11T09:00:00.000Z",
        },
        {
          id: "event-acme-docs-pull-2-closed",
          type: "closed",
          actor: "alice-dev",
          text: "closed this pull request",
          createdAt: "2024-06-12T09:00:00.000Z",
        },
      ],
      createdAt: "2024-06-11T09:00:00.000Z",
      updatedAt: "2024-06-12T09:00:00.000Z",
    },
    {
      id: "pull-request-acme-docs-3",
      number: 3,
      title: "Draft onboarding update",
      description: "Collect the onboarding screenshots before asking for a review.",
      author: "alice-dev",
      status: "draft",
      baseBranch: "main",
      compareBranch: "draft-feature",
      baseCommitId: "9c3e5b1-acme-docs-search",
      compareCommitId: "a71b3e6-acme-docs-draft-notes",
      reviewers: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      checks: [],
      timeline: [
        {
          id: "event-acme-docs-pull-3-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this draft pull request",
          createdAt: "2024-06-13T09:00:00.000Z",
        },
      ],
      createdAt: "2024-06-13T09:00:00.000Z",
      updatedAt: "2024-06-13T09:00:00.000Z",
    },
    {
      // REQ-6-3-3 and REQ-6-3-4: the Open pull request the inline comments and
      // the Approve are recorded on.
      id: "pull-request-acme-docs-4",
      number: 4,
      title: "Add onboarding notes for the release",
      description: "Carry the onboarding notes into the release branch.",
      author: "alice-dev",
      status: "open",
      baseBranch: "release",
      compareBranch: "onboarding-docs",
      baseCommitId: "9c3e5b1-acme-docs-search",
      compareCommitId: "c5d8f41-acme-docs-onboarding",
      reviewers: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      checks: [],
      timeline: [
        {
          id: "event-acme-docs-pull-4-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this pull request",
          createdAt: "2024-06-14T09:00:00.000Z",
        },
      ],
      createdAt: "2024-06-14T09:00:00.000Z",
      updatedAt: "2024-06-14T09:00:00.000Z",
    },
    {
      // The second Open pull request: the pending draft and the Request changes
      // decision of the review scenarios.
      id: "pull-request-acme-docs-5",
      number: 5,
      title: "Add draft notes for the release",
      description: "Carry the draft notes into the release branch.",
      author: "alice-dev",
      status: "open",
      baseBranch: "release",
      compareBranch: "draft-feature",
      baseCommitId: "9c3e5b1-acme-docs-search",
      compareCommitId: "a71b3e6-acme-docs-draft-notes",
      reviewers: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      checks: [],
      timeline: [
        {
          id: "event-acme-docs-pull-5-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this pull request",
          createdAt: "2024-06-15T09:00:00.000Z",
        },
      ],
      createdAt: "2024-06-15T09:00:00.000Z",
      updatedAt: "2024-06-15T09:00:00.000Z",
    },
  ];
}

/**
 * The seeded pull requests of `merge-lab` (REQ-6-5): `Merge the release notes`
 * is the eligible one (a non-author approval and a successful `test` check on
 * its current compare commit), `Update the merge checklist` is blocked by the
 * missing approval and `Document the release process` still has `test: pending`.
 * No pull request of this repository starts with a pending-review relationship
 * (REQ-6-4).
 */
export function seedMergeLabPullRequests(): MockPullRequest[] {
  const created = "2024-06-21T09:00:00.000Z";
  return [
    {
      id: "pull-request-merge-lab-1",
      number: 1,
      title: "Merge the release notes",
      description: "Publish the release notes of the first release.",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "feature-merge",
      baseCommitId: "7e2b9c1-merge-lab-initial",
      compareCommitId: "b4d8f30-merge-lab-release-notes",
      reviewers: [],
      reviews: [
        {
          id: "review-merge-lab-1-1",
          reviewer: "bob-reviewer",
          decision: "approve",
          summary: "The release notes read well.",
          commitId: "b4d8f30-merge-lab-release-notes",
          createdAt: "2024-06-21T11:00:00.000Z",
        },
      ],
      comments: [],
      reviewComments: [],
      checks: [
        {
          name: "test",
          commitId: "b4d8f30-merge-lab-release-notes",
          status: "success",
          setBy: "alice-dev",
          setAt: "2024-06-21T12:00:00.000Z",
        },
      ],
      timeline: [
        {
          id: "event-merge-lab-pull-1-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this pull request",
          createdAt: created,
        },
      ],
      createdAt: created,
      updatedAt: created,
    },
    {
      id: "pull-request-merge-lab-2",
      number: 2,
      title: "Update the merge checklist",
      description: "Refresh the merge checklist of the release process.",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "feature-blocked",
      baseCommitId: "7e2b9c1-merge-lab-initial",
      compareCommitId: "c7a1e58-merge-lab-checklist",
      reviewers: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      checks: [
        {
          name: "test",
          commitId: "c7a1e58-merge-lab-checklist",
          status: "success",
          setBy: "alice-dev",
          setAt: "2024-06-22T12:00:00.000Z",
        },
      ],
      timeline: [
        {
          id: "event-merge-lab-pull-2-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this pull request",
          createdAt: "2024-06-22T09:00:00.000Z",
        },
      ],
      createdAt: "2024-06-22T09:00:00.000Z",
      updatedAt: "2024-06-22T09:00:00.000Z",
    },
    {
      id: "pull-request-merge-lab-3",
      number: 3,
      title: "Document the release process",
      description: "Describe how a release is prepared.",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "feature-pending",
      baseCommitId: "7e2b9c1-merge-lab-initial",
      compareCommitId: "d9f3b24-merge-lab-process",
      reviewers: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      checks: [],
      timeline: [
        {
          id: "event-merge-lab-pull-3-created",
          type: "created",
          actor: "alice-dev",
          text: "opened this pull request",
          createdAt: "2024-06-23T09:00:00.000Z",
        },
      ],
      createdAt: "2024-06-23T09:00:00.000Z",
      updatedAt: "2024-06-23T09:00:00.000Z",
    },
  ];
}

export function seedRepositories(): MockRepository[] {
  const acmeDocs: MockRepository = {
    id: "repository-alice-dev-acme-docs",
    owner: "alice-dev",
    ownerType: "account",
    ownerDisplayName: "alice-dev",
    name: "acme-docs",
    description: "Documentation for the Acme Demo platform",
    visibility: "public",
    defaultBranch: "main",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    // REQ-4-1: `main` carries the nested directory `docs` with the text file
    // `docs/intro.md` inside it; `feature-search` adds `main-only.md` on top of
    // it (REQ-4-3-1).
    // REQ-4-3-3: `release` is the second branch the default-branch settings can
    // select; it points at the same head commit as `main`. REQ-6-2:
    // `onboarding-docs` carries the changes of the seeded public pull request
    // and `draft-feature` those of the seeded draft pull request.
    branches: [
      { name: "main", headId: "9c3e5b1-acme-docs-search" },
      { name: "feature-search", headId: "d7b2a08-acme-docs-branch-only" },
      { name: "release", headId: "9c3e5b1-acme-docs-search" },
      { name: "onboarding-docs", headId: "c5d8f41-acme-docs-onboarding" },
      { name: "draft-feature", headId: "a71b3e6-acme-docs-draft-notes" },
    ],
    commits: [
      {
        id: "9c3e5b1-acme-docs-search",
        message: "Document search flow",
        author: "alice-dev",
        createdAt: "2024-06-01T00:00:00.000Z",
        parentId: "4a1f7c2-acme-docs-initial",
        branch: "main",
        files: [
          { path: "README.md", change: "modified" },
          { path: "docs/intro.md", change: "modified" },
          { path: "src/search.ts", change: "added" },
        ],
        tree: [
          { path: "README.md", content: ACME_DOCS_README },
          { path: "CONTRIBUTING.md", content: ACME_DOCS_CONTRIBUTING },
          { path: "docs/intro.md", content: ACME_DOCS_INTRO },
          { path: "src/search.ts", content: ACME_DOCS_SEARCH_TS },
        ],
      },
      {
        id: "4a1f7c2-acme-docs-initial",
        message: "Initial commit",
        author: "alice-dev",
        createdAt: "2024-05-01T00:00:00.000Z",
        parentId: null,
        branch: "main",
        files: [
          { path: "README.md", change: "added" },
          { path: "CONTRIBUTING.md", change: "added" },
          { path: "docs/intro.md", change: "added" },
        ],
        tree: [
          { path: "README.md", content: ACME_DOCS_README_V1 },
          { path: "CONTRIBUTING.md", content: ACME_DOCS_CONTRIBUTING },
          { path: "docs/intro.md", content: ACME_DOCS_INTRO_V1 },
        ],
      },
      {
        id: "d7b2a08-acme-docs-branch-only",
        message: "Add branch-only notes",
        author: "alice-dev",
        createdAt: "2024-06-02T00:00:00.000Z",
        parentId: "9c3e5b1-acme-docs-search",
        branch: "feature-search",
        files: [
          { path: "main-only.md", change: "added" },
          { path: "src/search.ts", change: "modified" },
        ],
        tree: [
          { path: "README.md", content: ACME_DOCS_README },
          { path: "CONTRIBUTING.md", content: ACME_DOCS_CONTRIBUTING },
          { path: "docs/intro.md", content: ACME_DOCS_INTRO },
          { path: "main-only.md", content: ACME_DOCS_MAIN_ONLY },
          { path: "src/search.ts", content: ACME_DOCS_SEARCH_TS_V2 },
        ],
      },
      {
        id: "c5d8f41-acme-docs-onboarding",
        message: "Draft the onboarding notes",
        author: "alice-dev",
        createdAt: "2024-06-03T00:00:00.000Z",
        parentId: "9c3e5b1-acme-docs-search",
        branch: "onboarding-docs",
        files: [
          { path: "docs/onboarding.md", change: "added" },
          { path: "src/search.ts", change: "modified" },
        ],
        tree: [
          { path: "README.md", content: ACME_DOCS_README },
          { path: "CONTRIBUTING.md", content: ACME_DOCS_CONTRIBUTING },
          { path: "docs/intro.md", content: ACME_DOCS_INTRO },
          { path: "docs/onboarding.md", content: ACME_DOCS_ONBOARDING },
          { path: "src/search.ts", content: ACME_DOCS_SEARCH_TS_V2 },
        ],
      },
      {
        id: "a71b3e6-acme-docs-draft-notes",
        message: "Start the onboarding draft",
        author: "alice-dev",
        createdAt: "2024-06-04T00:00:00.000Z",
        parentId: "9c3e5b1-acme-docs-search",
        branch: "draft-feature",
        files: [{ path: "docs/draft-notes.md", change: "added" }],
        tree: [
          { path: "README.md", content: ACME_DOCS_README },
          { path: "CONTRIBUTING.md", content: ACME_DOCS_CONTRIBUTING },
          { path: "docs/intro.md", content: ACME_DOCS_INTRO },
          { path: "docs/draft-notes.md", content: ACME_DOCS_DRAFT_NOTES },
          { path: "src/search.ts", content: ACME_DOCS_SEARCH_TS },
        ],
      },
    ],
    sourceRepositoryId: null,
    grants: [],
    labels: [
      { name: "bug", color: "d73a4a", description: "Something is not working" },
      { name: "documentation", color: "0075ca", description: "Improvements or additions to documentation" },
    ],
    milestones: [
      { id: "milestone-acme-docs-q3-launch", title: "Q3 launch", state: "open" },
      { id: "milestone-acme-docs-v1-0", title: "v1.0", state: "open" },
    ],
    issues: seedIssues(),
    // REQ-6-1: no rule exists for `main` before the settings page creates one.
    protectionRules: [],
    pullRequests: seedPullRequests(),
  };
  // The direct grants of `acme-docs`: the Maintain grant of `carol-maintainer`
  // makes her an assignable member, and the Write grant of `bob-reviewer` makes
  // him the non-author reviewer of the pull requests (REQ-6-3). `dana-observer`
  // holds no role on any repository.
  acmeDocs.grants = [
    { account: "carol-maintainer", role: "Maintain" },
    { account: "bob-reviewer", role: "Write" },
  ];
  // REQ-6-5: the repository of the merge scenarios. Its `main` branch carries
  // both protection requirements, so the eligible pull request needs one valid
  // non-author approval and a successful `test` check before it may merge,
  // while the blocked one lacks that approval. `acme-docs` keeps its `main`
  // free of any rule, because the branch-protection scenario creates the first
  // rule there.
  const mergeLab: MockRepository = {
    id: "repository-alice-dev-merge-lab",
    owner: "alice-dev",
    ownerType: "account",
    ownerDisplayName: "alice-dev",
    name: "merge-lab",
    description: "Merge experiments for the Acme Demo platform",
    visibility: "public",
    defaultBranch: "main",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    branches: [
      { name: "main", headId: "7e2b9c1-merge-lab-initial" },
      { name: "feature-merge", headId: "b4d8f30-merge-lab-release-notes" },
      { name: "feature-blocked", headId: "c7a1e58-merge-lab-checklist" },
      { name: "feature-pending", headId: "d9f3b24-merge-lab-process" },
    ],
    commits: [
      {
        id: "7e2b9c1-merge-lab-initial",
        message: "Initial commit",
        author: "alice-dev",
        createdAt: "2024-06-16T00:00:00.000Z",
        parentId: null,
        branch: "main",
        files: [{ path: "README.md", change: "added" }],
        tree: [{ path: "README.md", content: "# Merge Lab\n" }],
      },
      {
        id: "b4d8f30-merge-lab-release-notes",
        message: "Write the release notes",
        author: "alice-dev",
        createdAt: "2024-06-17T00:00:00.000Z",
        parentId: "7e2b9c1-merge-lab-initial",
        branch: "feature-merge",
        files: [{ path: "RELEASE-NOTES.md", change: "added" }],
        tree: [
          { path: "README.md", content: "# Merge Lab\n" },
          { path: "RELEASE-NOTES.md", content: "# Release notes\n" },
        ],
      },
      {
        id: "c7a1e58-merge-lab-checklist",
        message: "Draft the merge checklist",
        author: "alice-dev",
        createdAt: "2024-06-18T00:00:00.000Z",
        parentId: "7e2b9c1-merge-lab-initial",
        branch: "feature-blocked",
        files: [{ path: "docs/checklist.md", change: "added" }],
        tree: [
          { path: "README.md", content: "# Merge Lab\n" },
          { path: "docs/checklist.md", content: "# Merge checklist\n" },
        ],
      },
      {
        id: "d9f3b24-merge-lab-process",
        message: "Describe the release process",
        author: "alice-dev",
        createdAt: "2024-06-19T00:00:00.000Z",
        parentId: "7e2b9c1-merge-lab-initial",
        branch: "feature-pending",
        files: [{ path: "docs/process.md", change: "added" }],
        tree: [
          { path: "README.md", content: "# Merge Lab\n" },
          { path: "docs/process.md", content: "# Release process\n" },
        ],
      },
    ],
    sourceRepositoryId: null,
    grants: [
      { account: "carol-maintainer", role: "Maintain" },
      { account: "bob-reviewer", role: "Write" },
    ],
    labels: [],
    milestones: [],
    issues: [],
    protectionRules: [
      { id: "rule-merge-lab-main", pattern: "main", requireApproval: true, requireStatusCheck: true },
    ],
    pullRequests: seedMergeLabPullRequests(),
  };
  return [
    acmeDocs,
    mergeLab,
    {
      ...acmeDocs,
      id: "repository-alice-dev-acme-docs-fork",
      name: "acme-docs-fork",
      description: "A private fork of acme-docs used for experiments",
      visibility: "private",
      sourceRepositoryId: acmeDocs.id,
      // The fork keeps classification items of its own; a selector of
      // `acme-docs` must never offer them (REQ-5-3-2, REQ-5-3-3).
      labels: [
        { name: "bug", color: "d73a4a", description: "Something is not working" },
        { name: "frontend", color: "1d76db", description: "Work on the public website" },
      ],
      milestones: [{ id: "milestone-acme-docs-fork-web-launch", title: "Web launch", state: "open" }],
      issues: [],
      protectionRules: [],
      pullRequests: [],
    },
    {
      ...acmeDocs,
      id: "repository-alice-dev-secret-research",
      name: "secret-research",
      description: "Private research notes for the Acme Demo platform",
      visibility: "private",
      branches: [{ name: "main", headId: "e1c9f34-secret-research-initial" }],
      commits: [
        {
          id: "e1c9f34-secret-research-initial",
          message: "Initial commit",
          author: "alice-dev",
          createdAt: "2024-05-01T00:00:00.000Z",
          parentId: null,
          branch: "main",
          files: [{ path: "research/notes.md", change: "added" }],
          tree: [
            {
              path: "research/notes.md",
              content: "# Notes\n\nThe private search flow notes must not leak.\n",
            },
          ],
        },
      ],
      grants: [{ account: "bob-reviewer", role: "Write" }],
      labels: [],
      milestones: [],
      protectionRules: [],
      pullRequests: [],
      // REQ-5-4: the protected work item of the private repository.
      issues: [
        {
          number: 1,
          title: "Summarize the early findings",
          body: "Draft the summary of the research notes before publishing.",
          status: "open",
          author: "alice-dev",
          labels: [],
          assignees: [],
          milestone: null,
          createdAt: "2024-06-09T09:00:00.000Z",
          updatedAt: "2024-06-09T09:00:00.000Z",
          comments: [],
          reactions: [],
          timeline: [
            {
              id: "event-secret-research-1-created",
              type: "created",
              actor: "alice-dev",
              text: "opened this issue",
              createdAt: "2024-06-09T09:00:00.000Z",
            },
          ],
        },
      ],
    },
    {
      ...acmeDocs,
      id: "repository-acme-demo-acme-web",
      owner: "acme-demo",
      ownerType: "organization",
      ownerDisplayName: "Acme Demo",
      name: "acme-web",
      description: "Public website of the Acme Demo platform",
      branches: [{ name: "main", headId: "8b4c0e7-acme-web-initial" }],
      commits: [
        {
          id: "8b4c0e7-acme-web-initial",
          message: "Initial commit",
          author: "alice-dev",
          createdAt: "2024-04-01T00:00:00.000Z",
          parentId: null,
          branch: "main",
          files: [{ path: "README.md", change: "added" }],
          tree: [{ path: "README.md", content: "# Acme Web\n" }],
        },
      ],
      labels: [],
      milestones: [],
      issues: [],
      protectionRules: [],
      pullRequests: [],
    },
  ];
}

function entriesOf(files: MockRepositoryFile[], path: string) {
  const prefix = path ? `${path}/` : "";
  const seen = new Map<string, { name: string; path: string; type: "file" | "directory" }>();
  for (const file of files) {
    if (prefix && !file.path.startsWith(prefix)) continue;
    const remainder = path ? file.path.slice(prefix.length) : file.path;
    const [first, ...rest] = remainder.split("/");
    if (!first) continue;
    const entryPath = path ? `${path}/${first}` : first;
    if (rest.length > 0) seen.set(entryPath, { name: first, path: entryPath, type: "directory" });
    else if (!seen.has(entryPath)) seen.set(entryPath, { name: first, path: entryPath, type: "file" });
  }
  return [...seen.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function pathError(rawPath: string): string | null {
  const path = rawPath.trim();
  if (!path || path.startsWith("/")) return "Invalid file path";
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "Invalid file path";
  return null;
}

/** The branch-name rule of the server: 1–255 `[A-Za-z0-9._/-]`, no trailing
 * `/` or `.`, no `..` and no `//` (REQ-4-3-3). */
function branchNameError(rawName: string): string | null {
  const name = rawName.trim();
  if (!name || name.length > 255) return "Invalid branch";
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return "Invalid branch";
  if (name.endsWith("/") || name.endsWith(".")) return "Invalid branch";
  if (name.includes("..") || name.includes("//")) return "Invalid branch";
  return null;
}

export function createRepositoryMock(
  options: { viewer?: string | null; repositories?: MockRepository[] } = {},
): MockRepositoryServer {
  const state: MockRepositoryState = {
    viewer: options.viewer ?? null,
    organizations: [
      { name: "acme-demo", displayName: "Acme Demo", role: "Owner" },
    ],
    repositories: options.repositories ?? seedRepositories(),
    requests: [],
  };

  /** The known accounts of the mock, as the server would hold them. */
  const ACCOUNTS = ["alice-dev", "bob-reviewer", "carol-maintainer", "dana-observer"];

  /** The direct role one account holds on a repository, or null. */
  function roleOf(repository: MockRepository, username: string): MockRole | null {
    if (repository.ownerType === "account" && repository.owner === username) return "Admin";
    if (repository.owner === "acme-demo" && username === "alice-dev") return "Admin";
    const grant = repository.grants.find((entry) => entry.account === username);
    return grant?.role ?? null;
  }

  /** The accounts that may be assigned: at least Triage permission (REQ-5-3-1). */
  function assignableMembers(repository: MockRepository): string[] {
    const roles: MockRole[] = ["Triage", "Write", "Maintain", "Admin"];
    return ACCOUNTS.filter((account) => {
      const role = roleOf(repository, account);
      return role !== null && roles.includes(role);
    }).sort((left, right) => left.localeCompare(right));
  }

  function viewerRole(repository: MockRepository): MockRole | null {
    if (!state.viewer) return null;
    return roleOf(repository, state.viewer);
  }

  function canRead(repository: MockRepository): boolean {
    return repository.visibility === "public" || viewerRole(repository) !== null;
  }

  function branchOf(repository: MockRepository, name?: string | null): MockRepositoryBranch | null {
    const wanted = (name ?? "").trim();
    if (wanted) return repository.branches.find((branch) => branch.name === wanted) ?? null;
    return repository.branches.find((branch) => branch.name === repository.defaultBranch) ?? repository.branches[0] ?? null;
  }

  /** The file set of a branch: the tree of the commit it points to. */
  function snapshot(repository: MockRepository, name?: string | null): MockRepositoryFile[] {
    const branch = branchOf(repository, name);
    if (!branch) return [];
    const head = repository.commits.find((commit) => commit.id === branch.headId);
    return head ? head.tree.map((file) => ({ ...file })) : [];
  }

  function history(repository: MockRepository, name?: string | null): MockRepositoryCommit[] {
    const branch = branchOf(repository, name);
    if (!branch) return [];
    const historyList: MockRepositoryCommit[] = [];
    const seen = new Set<string>();
    let cursor = repository.commits.find((commit) => commit.id === branch.headId) ?? null;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      historyList.push(cursor);
      const parentId: string | null = cursor.parentId;
      cursor = parentId ? repository.commits.find((commit) => commit.id === parentId) ?? null : null;
    }
    return historyList;
  }

  function summary(repository: MockRepository) {
    return {
      name: repository.name,
      owner: repository.owner,
      ownerType: repository.ownerType,
      ownerDisplayName: repository.ownerDisplayName,
      fullName: `${repository.ownerDisplayName}/${repository.name}`,
      description: repository.description,
      visibility: repository.visibility,
      defaultBranch: repository.defaultBranch,
      createdAt: repository.createdAt,
      updatedAt: repository.updatedAt,
    };
  }

  function forkedFrom(repository: MockRepository) {
    const source = state.repositories.find((entry) => entry.id === repository.sourceRepositoryId);
    if (!source) return null;
    return { owner: source.owner, name: source.name, fullName: `${source.ownerDisplayName}/${source.name}` };
  }

  function overview(repository: MockRepository) {
    const role = viewerRole(repository);
    const defaultFiles = snapshot(repository, repository.defaultBranch);
    return {
      ...summary(repository),
      viewerRole: role,
      canChangeVisibility: role === "Admin",
      canChangeDefaultBranch: role === "Admin",
      canWrite: role !== null && WRITE_ROLES.includes(role),
      forkedFrom: forkedFrom(repository),
      branches: repository.branches.map((branch) => ({ name: branch.name, protected: branch.protected === true })),
      // REQ-6-1: the settings page lists the stored rules and only a repository
      // Admin sees the entry that saves one.
      protectionRules: repository.protectionRules.map((rule) => ({ ...rule })),
      canManageBranchProtection: role === "Admin",
      files: defaultFiles.map((file) => ({ path: file.path })),
      entries: entriesOf(defaultFiles, ""),
      cloneUrls: {
        https: `https://github.local/${repository.owner}/${repository.name}.git`,
        ssh: `git@github.local:${repository.owner}/${repository.name}.git`,
      },
    };
  }

  function find(owner: string, name: string): MockRepository | undefined {
    return state.repositories.find((repository) => repository.owner === owner && repository.name === name);
  }

  /** The rule bound to exactly this branch name, or null (REQ-6-1). */
  function protectionRuleFor(repository: MockRepository, branchName: string): MockBranchProtectionRule | null {
    return repository.protectionRules.find((rule) => rule.pattern === branchName) ?? null;
  }

  /** The commit the compare branch points at right now (REQ-6-1). */
  function compareCommitOf(repository: MockRepository, pullRequest: MockPullRequest): MockRepositoryCommit | null {
    const branch = branchOf(repository, pullRequest.compareBranch);
    const head = branch ? repository.commits.find((commit) => commit.id === branch.headId) ?? null : null;
    if (head) return head;
    return repository.commits.find((commit) => commit.id === pullRequest.compareCommitId) ?? null;
  }

  /** The `test` check of the current compare commit; pending without a record. */
  function pullCheck(repository: MockRepository, pullRequest: MockPullRequest) {
    const commit = compareCommitOf(repository, pullRequest);
    const commitId = commit?.id ?? "";
    const record = pullRequest.checks.find((check) => check.name === "test" && check.commitId === commitId) ?? null;
    return {
      name: "test" as const,
      status: record?.status ?? ("pending" as const),
      commitId,
      setBy: record?.setBy ?? null,
      setAt: record?.setAt ?? null,
    };
  }

  /** The merge state the rule of the base branch produces (REQ-6-1, REQ-6-3-4). */
  function pullMergeState(repository: MockRepository, pullRequest: MockPullRequest) {
    const rule = protectionRuleFor(repository, pullRequest.baseBranch);
    const usable = rule && (rule.requireApproval || rule.requireStatusCheck) ? rule : null;
    const check = pullCheck(repository, pullRequest);
    // The latest decision of every reviewer on the current compare commit; a
    // decision of the author never counts.
    const commitId = compareCommitOf(repository, pullRequest)?.id ?? "";
    const latest = new Map<string, { decision: string; createdAt: string }>();
    for (const review of pullRequest.reviews) {
      if (review.commitId !== commitId) continue;
      const current = latest.get(review.reviewer);
      if (!current || review.createdAt >= current.createdAt) latest.set(review.reviewer, review);
    }
    const decisions = [...latest.entries()]
      .filter(([reviewer]) => reviewer !== pullRequest.author)
      .map(([, review]) => review.decision);
    const approvals = decisions.filter((decision) => decision === "approve").length;
    const changeRequests = decisions.filter((decision) => decision === "request_changes").length;
    const blockers: Array<{ code: string; message: string }> = [];
    if (pullRequest.status === "draft") blockers.push({ code: "draft", message: "This pull request is a draft." });
    else if (pullRequest.status === "closed") {
      blockers.push({ code: "closed", message: "This pull request is closed." });
    } else if (pullRequest.status === "merged") {
      blockers.push({ code: "merged", message: "This pull request is already merged." });
    }
    if (changeRequests > 0) {
      blockers.push({ code: "changes_requested", message: "A reviewer requested changes." });
    }
    if (usable?.requireApproval && approvals < 1) {
      blockers.push({ code: "approval", message: "Review required by branch protection" });
    }
    if (usable?.requireStatusCheck && check.status !== "success") {
      blockers.push({ code: "status_check", message: `The required check test is ${check.status}.` });
    }
    // The conditions the confirmation area spells as satisfied or unsatisfied.
    const conditions: Array<{ code: string; label: string; satisfied: boolean }> = [];
    if (usable?.requireApproval) {
      conditions.push({ code: "approval", label: "Require 1 approval", satisfied: approvals >= 1 });
    }
    if (usable?.requireStatusCheck) {
      conditions.push({
        code: "status_check",
        label: "Require status check test",
        satisfied: check.status === "success",
      });
    }
    conditions.push({
      code: "changes_requested",
      label: "No requested changes",
      satisfied: changeRequests === 0,
    });
    return {
      mergeable: blockers.length === 0,
      status: pullRequest.status,
      blockers,
      conditions,
      rules: {
        requireApproval: usable?.requireApproval === true,
        requireStatusCheck: usable?.requireStatusCheck === true,
        pattern: usable?.pattern ?? null,
      },
      approvals,
      changeRequests,
    };
  }

  /**
   * The inline review comments of the current compare commit (REQ-6-3-3): a
   * pending draft is served to its author only and a published comment of an
   * older commit is marked outdated.
   */
  function pullReviewComments(repository: MockRepository, pullRequest: MockPullRequest) {
    const commitId = compareCommitOf(repository, pullRequest)?.id ?? "";
    return pullRequest.reviewComments
      .filter((comment) => !comment.pending || comment.author === state.viewer)
      .map((comment) => ({
        ...comment,
        outdated: !comment.pending && comment.commitId !== commitId,
      }));
  }

  /** The derived review status of the current compare commit (REQ-6-2-1). */
  function pullReviewStatus(repository: MockRepository, pullRequest: MockPullRequest): string {
    const commitId = compareCommitOf(repository, pullRequest)?.id ?? "";
    const latest = new Map<string, { decision: string; createdAt: string }>();
    for (const review of pullRequest.reviews) {
      if (review.commitId !== commitId) continue;
      const current = latest.get(review.reviewer);
      if (!current || review.createdAt >= current.createdAt) latest.set(review.reviewer, review);
    }
    const decisions = [...latest.entries()]
      .filter(([reviewer]) => reviewer !== pullRequest.author)
      .map(([, review]) => review.decision);
    if (decisions.includes("request_changes")) return "changes_requested";
    if (decisions.includes("approve")) return "approved";
    return "review_required";
  }

  function pullSummary(repository: MockRepository, pullRequest: MockPullRequest) {
    return {
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      description: pullRequest.description,
      author: pullRequest.author,
      status: pullRequest.status,
      baseBranch: pullRequest.baseBranch,
      compareBranch: pullRequest.compareBranch,
      reviewStatus: pullReviewStatus(repository, pullRequest),
      createdAt: pullRequest.createdAt,
      updatedAt: pullRequest.updatedAt,
    };
  }

  function pullPermissions(repository: MockRepository, pullRequest: MockPullRequest) {
    const role = viewerRole(repository);
    const maintainer = role === "Maintain" || role === "Admin";
    const writer = role !== null && WRITE_ROLES.includes(role);
    const isAuthor = Boolean(state.viewer) && pullRequest.author === state.viewer;
    const canReviewOpen = writer && !isAuthor && pullRequest.status === "open";
    const canChangeStatus = isAuthor || maintainer;
    const openOrDraft = pullRequest.status === "open" || pullRequest.status === "draft";
    return {
      canUpdateChecks: role === "Admin",
      canMerge: maintainer,
      canReview: writer,
      canComment: writer,
      canChangeStatus,
      canRequestReviewers: canChangeStatus && openOrDraft,
      canClose: canChangeStatus && openOrDraft,
      canReopen: canChangeStatus && pullRequest.status === "closed",
      canCreate: writer,
      canMarkReady: isAuthor || maintainer,
      canCommentOnLines: canReviewOpen,
      canSubmitReview: canReviewOpen,
    };
  }

  /** The complete detail payload of one pull request (REQ-6, REQ-6-1). */
  function pullDetail(repository: MockRepository, pullRequest: MockPullRequest) {
    const compare = compareCommitOf(repository, pullRequest);
    const base = repository.commits.find((commit) => commit.id === pullRequest.baseCommitId) ?? null;
    const baseIds = new Set<string>();
    let cursor = base;
    while (cursor && !baseIds.has(cursor.id)) {
      baseIds.add(cursor.id);
      cursor = cursor.parentId
        ? repository.commits.find((commit) => commit.id === cursor?.parentId) ?? null
        : null;
    }
    const commits = (compare ? history(repository, pullRequest.compareBranch) : [])
      .filter((commit) => !baseIds.has(commit.id));
    const files = compare ? revisionChanges(base?.tree ?? [], compare.tree).map(numberFileLines) : [];
    return {
      ...pullSummary(repository, pullRequest),
      baseCommitId: pullRequest.baseCommitId,
      compareCommitId: pullRequest.compareCommitId,
      currentCompareCommitId: compare?.id ?? null,
      currentCompareCommit: compare,
      reviewers: pullRequest.reviewers.map((username) => ({ username })),
      reviewerCandidates: ACCOUNTS.filter((account) => account !== pullRequest.author).map((account) => ({
        username: account,
        role: roleOf(repository, account),
      })).filter((candidate) => candidate.role !== null && WRITE_ROLES.includes(candidate.role))
        .sort((left, right) => left.username.localeCompare(right.username)),
      mergedBy: pullRequest.mergedBy ?? null,
      mergedAt: pullRequest.mergedAt ?? null,
      mergeCommitId: pullRequest.mergeCommitId ?? null,
      closedAt: pullRequest.closedAt ?? null,
      reviews: pullRequest.reviews.map((review) => ({
        ...review,
        summary: review.summary ?? "",
        stale: review.commitId !== compare?.id,
      })),
      comments: pullRequest.comments.map((comment) => ({ ...comment })),
      reviewComments: pullReviewComments(repository, pullRequest),
      timeline: pullRequest.timeline.map((event) => ({ ...event })),
      checks: pullRequest.checks.map((check) => ({ ...check })),
      check: pullCheck(repository, pullRequest),
      commits,
      files,
      summary: diffSummary(files),
      merge: pullMergeState(repository, pullRequest),
      permissions: pullPermissions(repository, pullRequest),
    };
  }

  /** POST protection-rules — create or update the rule of one branch (REQ-6-1). */
  function saveProtectionRule(repository: MockRepository, body: Record<string, unknown>) {
    if (!state.viewer) {
      return { status: 401, body: { error: "Sign in is required to manage branch protection rules" } };
    }
    if (viewerRole(repository) !== "Admin") {
      return { status: 403, body: { error: "Only a repository Admin can manage branch protection rules" } };
    }
    const pattern = String(body.pattern ?? "").trim();
    if (!pattern || /[*?\s]/.test(pattern)) {
      const message = pattern ? "Enter an exact branch name" : "Branch name pattern is required";
      return { status: 400, body: { error: message, fields: { pattern: message } } };
    }
    const existing = repository.protectionRules.find((rule) => rule.pattern === pattern);
    if (existing) {
      existing.requireApproval = body.requireApproval === true;
      existing.requireStatusCheck = body.requireStatusCheck === true;
    } else {
      repository.protectionRules.push({
        id: `rule-${repository.protectionRules.length + 1}`,
        pattern,
        requireApproval: body.requireApproval === true,
        requireStatusCheck: body.requireStatusCheck === true,
      });
    }
    return { status: 201, body: { repository: overview(repository) } };
  }

  /** POST pulls/:number/checks — an Admin stores the test status (REQ-6-1). */
  function savePullCheck(repository: MockRepository, pullRequest: MockPullRequest, body: Record<string, unknown>) {
    if (!state.viewer) {
      return { status: 401, body: { error: "Sign in is required to update the check status" } };
    }
    if (viewerRole(repository) !== "Admin") {
      return { status: 403, body: { error: "Only a repository Admin can update the check status" } };
    }
    const status = String(body.status ?? "");
    if (status !== "pending" && status !== "success" && status !== "failure") {
      return { status: 400, body: { error: "Unknown check status", fields: { status: "Unknown check status" } } };
    }
    const current = pullCheck(repository, pullRequest);
    const record = pullRequest.checks.find((check) => check.name === "test" && check.commitId === current.commitId);
    if (record) {
      record.status = status;
      record.setBy = state.viewer;
      record.setAt = TIMESTAMP;
    } else {
      pullRequest.checks.push({
        name: "test",
        commitId: current.commitId,
        status,
        setBy: state.viewer,
        setAt: TIMESTAMP,
      });
    }
    return { status: 200, body: { repository: summary(repository), viewerRole: viewerRole(repository), pullRequest: pullDetail(repository, pullRequest) } };
  }

  /** POST pulls — create a pull request from a valid comparison (REQ-6-2-3). */
  function createPullRequest(repository: MockRepository, body: Record<string, unknown>) {
    if (!state.viewer) {
      return { status: 401, body: { error: "Sign in is required to create a pull request" } };
    }
    const role = viewerRole(repository);
    if (role === null || !WRITE_ROLES.includes(role)) {
      return { status: 403, body: { error: "You do not have permission to create a pull request" } };
    }
    const fields: Record<string, string> = {};
    const baseName = String(body.base ?? "").trim();
    const compareName = String(body.compare ?? "").trim();
    if (!branchOf(repository, baseName)) fields.base = "Branch not found";
    if (!branchOf(repository, compareName)) fields.compare = "Branch not found";
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "");
    if (!title) fields.title = "Title is required";
    else if (title.length > 256) fields.title = "Title must be 256 characters or fewer";
    if (description.length > 65536) fields.description = "Description must be 65536 characters or fewer";
    if (baseName === compareName) fields.compare = "Choose two different branches";
    if (Object.keys(fields).length > 0) {
      return { status: 400, body: { error: Object.values(fields)[0], fields } };
    }
    const base = branchOf(repository, baseName);
    const compare = branchOf(repository, compareName);
    const files = revisionChanges(snapshot(repository, baseName), snapshot(repository, compareName));
    if (files.length === 0) {
      const message = "There are no changes between these branches";
      return { status: 400, body: { error: message, fields: { compare: message } } };
    }
    const duplicate = repository.pullRequests.find(
      (pullRequest) => pullRequest.baseBranch === baseName
        && pullRequest.compareBranch === compareName
        && (pullRequest.status === "draft" || pullRequest.status === "open"),
    );
    if (duplicate) {
      const message = "A pull request for these branches already exists";
      return { status: 400, body: { error: message, fields: { compare: message }, number: duplicate.number } };
    }
    const number = repository.pullRequests.reduce(
      (highest, pullRequest) => Math.max(highest, pullRequest.number),
      0,
    ) + 1;
    const draft = body.draft === true;
    const pullRequest: MockPullRequest = {
      id: `pull-request-${repository.name}-${number}`,
      number,
      title,
      description,
      author: state.viewer,
      status: draft ? "draft" : "open",
      baseBranch: baseName,
      compareBranch: compareName,
      baseCommitId: base?.headId ?? "",
      compareCommitId: compare?.headId ?? "",
      reviewers: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      checks: [],
      timeline: [
        {
          id: `event-pull-${number}-created`,
          type: "created",
          actor: state.viewer,
          text: draft ? "opened this draft pull request" : "opened this pull request",
          createdAt: TIMESTAMP,
        },
      ],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    };
    repository.pullRequests.push(pullRequest);
    return {
      status: 201,
      body: {
        repository: summary(repository),
        viewerRole: role,
        pullRequest: pullDetail(repository, pullRequest),
      },
    };
  }

  /**
   * POST pulls/:number/comments — one inline review comment of the current
   * compare commit (REQ-6-3-3). `pending` keeps the draft of `Start a review`
   * private to its author until the review is submitted.
   */
  function writePullComment(repository: MockRepository, pullRequest: MockPullRequest, body: Record<string, unknown>) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to comment on a pull request" } };
    const role = viewerRole(repository);
    if (role === null || !WRITE_ROLES.includes(role) || pullRequest.author === viewer) {
      return { status: 403, body: { error: "You do not have permission to comment on this pull request" } };
    }
    if (pullRequest.status !== "open") {
      return { status: 400, body: { error: "Only an open pull request can be commented on" } };
    }
    const text = String(body.body ?? "").trim();
    if (!text) {
      return { status: 400, body: { error: "Comment is required", fields: { body: "Comment is required" } } };
    }
    const compare = compareCommitOf(repository, pullRequest);
    const base = repository.commits.find((commit) => commit.id === pullRequest.baseCommitId) ?? null;
    const filePath = String(body.filePath ?? "");
    const side = body.side === "removed" ? "removed" : "added";
    const file = revisionChanges(base?.tree ?? [], compare?.tree ?? [])
      .map(numberFileLines)
      .find((candidate) => candidate.path === filePath);
    if (!file) {
      return {
        status: 400,
        body: { error: "The file is not part of this pull request", fields: { filePath: "The file is not part of this pull request" } },
      };
    }
    const line = file.lines.find((entry) => entry.side === side && entry.lineNumber === Number(body.line));
    if (!line) {
      return {
        status: 400,
        body: { error: "The line is not part of this pull request", fields: { line: "The line is not part of this pull request" } },
      };
    }
    const pending = body.pending === true;
    pullRequest.reviewComments.push({
      id: `review-comment-${pullRequest.reviewComments.length + 1}`,
      filePath,
      line: Number(line.lineNumber),
      side,
      commitId: compare?.id ?? "",
      author: viewer,
      body: text,
      pending,
      createdAt: TIMESTAMP,
    });
    if (!pending) {
      pullRequest.timeline.push({
        id: `event-pull-${pullRequest.number}-inline-${pullRequest.reviewComments.length}`,
        type: "commented",
        actor: viewer,
        text: `commented on ${filePath}`,
        createdAt: TIMESTAMP,
      });
    }
    pullRequest.updatedAt = TIMESTAMP;
    return {
      status: 201,
      body: { repository: summary(repository), viewerRole: role, pullRequest: pullDetail(repository, pullRequest) },
    };
  }

  /**
   * POST pulls/:number/reviews — one review decision of the current compare
   * commit (REQ-6-3-4). The pending comments of that reviewer are published
   * together with the review.
   */
  function writePullReview(repository: MockRepository, pullRequest: MockPullRequest, body: Record<string, unknown>) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to review a pull request" } };
    const role = viewerRole(repository);
    if (role === null || !WRITE_ROLES.includes(role) || pullRequest.author === viewer) {
      return { status: 403, body: { error: "You do not have permission to review this pull request" } };
    }
    if (pullRequest.status !== "open") {
      return { status: 400, body: { error: "Only an open pull request can be reviewed" } };
    }
    const decision = String(body.decision ?? "").toLowerCase();
    if (!["comment", "approve", "request_changes"].includes(decision)) {
      return {
        status: 400,
        body: { error: "Unknown review decision", fields: { decision: "Unknown review decision" } },
      };
    }
    const summaryText = typeof body.summary === "string" ? body.summary : "";
    const commitId = compareCommitOf(repository, pullRequest)?.id ?? "";
    pullRequest.reviews.push({
      id: `review-${pullRequest.reviews.length + 1}`,
      reviewer: viewer,
      decision,
      summary: summaryText,
      commitId,
      createdAt: TIMESTAMP,
    });
    for (const comment of pullRequest.reviewComments) {
      if (comment.pending && comment.author === viewer) comment.pending = false;
    }
    pullRequest.timeline.push({
      id: `event-pull-${pullRequest.number}-reviewed-${pullRequest.reviews.length}`,
      type: "reviewed",
      actor: viewer,
      text: decision === "approve" ? "Approved" : decision === "request_changes" ? "Changes requested" : "Commented",
      createdAt: TIMESTAMP,
    });
    pullRequest.updatedAt = TIMESTAMP;
    return {
      status: 201,
      body: { repository: summary(repository), viewerRole: role, pullRequest: pullDetail(repository, pullRequest) },
    };
  }

  /**
   * POST pulls/:number/reviewers — one pending-review relationship (REQ-6-4).
   * Only the author or a maintainer of an Open or Draft pull request stores it,
   * and the candidate must hold Write or higher and not be the author.
   */
  function requestPullReviewer(repository: MockRepository, pullRequest: MockPullRequest, body: Record<string, unknown>) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to request reviewers" } };
    const role = viewerRole(repository);
    const maintainer = role === "Maintain" || role === "Admin";
    if (pullRequest.author !== viewer && !maintainer) {
      return { status: 403, body: { error: "You do not have permission to request reviewers" } };
    }
    if (pullRequest.status !== "open" && pullRequest.status !== "draft") {
      return { status: 400, body: { error: "Only an open or draft pull request can request reviewers" } };
    }
    const username = String(body.username ?? "").trim();
    const candidateRole = username ? roleOf(repository, username) : null;
    if (!username) {
      return { status: 400, body: { error: "Reviewer is required", fields: { username: "Reviewer is required" } } };
    }
    if (username === pullRequest.author || candidateRole === null || !WRITE_ROLES.includes(candidateRole)) {
      const message = "That account cannot be requested as a reviewer";
      return { status: 400, body: { error: message, fields: { username: message } } };
    }
    if (!pullRequest.reviewers.includes(username)) pullRequest.reviewers.push(username);
    pullRequest.timeline.push({
      id: `event-pull-${pullRequest.number}-reviewer-${pullRequest.reviewers.length}`,
      type: "review_requested",
      actor: viewer,
      text: `requested a review from ${username}`,
      createdAt: TIMESTAMP,
    });
    pullRequest.updatedAt = TIMESTAMP;
    return {
      status: 201,
      body: { repository: summary(repository), viewerRole: role, pullRequest: pullDetail(repository, pullRequest) },
    };
  }

  /** DELETE pulls/:number/reviewers/:username — REQ-6-4. */
  function removePullReviewer(repository: MockRepository, pullRequest: MockPullRequest, username: string) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to request reviewers" } };
    const role = viewerRole(repository);
    const maintainer = role === "Maintain" || role === "Admin";
    if (pullRequest.author !== viewer && !maintainer) {
      return { status: 403, body: { error: "You do not have permission to request reviewers" } };
    }
    if (pullRequest.status !== "open" && pullRequest.status !== "draft") {
      return { status: 400, body: { error: "Only an open or draft pull request can request reviewers" } };
    }
    const index = pullRequest.reviewers.indexOf(username);
    if (index < 0) return { status: 404, body: { error: "Reviewer request not found" } };
    pullRequest.reviewers.splice(index, 1);
    pullRequest.timeline.push({
      id: `event-pull-${pullRequest.number}-reviewer-removed-${Date.now()}`,
      type: "review_requested",
      actor: viewer,
      text: `removed the request for a review from ${username}`,
      createdAt: TIMESTAMP,
    });
    pullRequest.updatedAt = TIMESTAMP;
    return {
      status: 200,
      body: { repository: summary(repository), viewerRole: role, pullRequest: pullDetail(repository, pullRequest) },
    };
  }

  /** POST pulls/:number/close | /reopen — REQ-6-6. Merged is terminal. */
  function changePullStatus(repository: MockRepository, pullRequest: MockPullRequest, action: "close" | "reopen") {
    const viewer = state.viewer;
    if (!viewer) {
      return { status: 401, body: { error: "Sign in is required to change the pull request status" } };
    }
    const role = viewerRole(repository);
    const maintainer = role === "Maintain" || role === "Admin";
    if (pullRequest.author !== viewer && !maintainer) {
      return { status: 403, body: { error: "You do not have permission to change the pull request status" } };
    }
    const reopening = action === "reopen";
    const allowed = reopening
      ? pullRequest.status === "closed"
      : pullRequest.status === "open" || pullRequest.status === "draft";
    if (!allowed) {
      return {
        status: 400,
        body: {
          error: reopening
            ? "Only a closed pull request can be reopened"
            : "Only an open or draft pull request can be closed",
        },
      };
    }
    pullRequest.status = reopening ? "open" : "closed";
    if (reopening) delete pullRequest.closedAt;
    else pullRequest.closedAt = TIMESTAMP;
    pullRequest.updatedAt = TIMESTAMP;
    pullRequest.timeline.push({
      id: `event-pull-${pullRequest.number}-${action}-${Date.now()}`,
      type: reopening ? "reopened" : "closed",
      actor: viewer,
      text: reopening ? "reopened this pull request" : "closed this pull request",
      createdAt: TIMESTAMP,
    });
    return {
      status: 200,
      body: { repository: summary(repository), viewerRole: role, pullRequest: pullDetail(repository, pullRequest) },
    };
  }

  /**
   * POST pulls/:number/merge — the merge writes the compare commit into the
   * base branch (REQ-6-5). Only Maintain, Admin or an organization Owner may
   * merge, and every condition of the base branch rule has to be satisfied.
   */
  function mergePullRequest(repository: MockRepository, pullRequest: MockPullRequest) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to merge this pull request" } };
    const role = viewerRole(repository);
    if (role !== "Maintain" && role !== "Admin") {
      return { status: 403, body: { error: "You do not have permission to merge this pull request" } };
    }
    const mergeState = pullMergeState(repository, pullRequest);
    if (!mergeState.mergeable) {
      return { status: 400, body: { error: "The pull request could not be merged", blockers: mergeState.blockers } };
    }
    const base = branchOf(repository, pullRequest.baseBranch);
    const compare = compareCommitOf(repository, pullRequest);
    const commitId = `commit-merge-${pullRequest.number}-${Date.now()}`;
    repository.commits.push({
      id: commitId,
      message: `Merge pull request #${pullRequest.number} from ${pullRequest.compareBranch}`,
      author: viewer,
      createdAt: TIMESTAMP,
      parentId: base?.headId ?? null,
      branch: base?.name ?? pullRequest.baseBranch,
      files: [],
      tree: compare ? compare.tree.map((file) => ({ ...file })) : [],
    });
    if (base) base.headId = commitId;
    pullRequest.status = "merged";
    pullRequest.mergedBy = viewer;
    pullRequest.mergedAt = TIMESTAMP;
    pullRequest.mergeCommitId = commitId;
    pullRequest.updatedAt = TIMESTAMP;
    pullRequest.timeline.push({
      id: `event-pull-${pullRequest.number}-merged`,
      type: "merged",
      actor: viewer,
      text: "merged this pull request",
      createdAt: TIMESTAMP,
    });
    return {
      status: 200,
      body: { repository: summary(repository), viewerRole: role, pullRequest: pullDetail(repository, pullRequest) },
    };
  }

  /** POST pulls/:number/ready — Draft becomes Open (REQ-6-2-4). */
  function readyPullRequest(repository: MockRepository, pullRequest: MockPullRequest) {
    if (!state.viewer) {
      return { status: 401, body: { error: "Sign in is required to mark this pull request ready for review" } };
    }
    const role = viewerRole(repository);
    const maintainer = role === "Maintain" || role === "Admin";
    if (pullRequest.author !== state.viewer && !maintainer) {
      return { status: 403, body: { error: "You do not have permission to mark this pull request ready for review" } };
    }
    if (pullRequest.status !== "draft") {
      return { status: 400, body: { error: "Only a draft pull request can be marked ready for review" } };
    }
    pullRequest.status = "open";
    pullRequest.updatedAt = TIMESTAMP;
    pullRequest.timeline.push({
      id: `event-pull-${pullRequest.number}-ready`,
      type: "ready_for_review",
      actor: state.viewer,
      text: "marked this pull request as Ready for review",
      createdAt: TIMESTAMP,
    });
    return {
      status: 200,
      body: {
        repository: summary(repository),
        viewerRole: role,
        pullRequest: pullDetail(repository, pullRequest),
      },
    };
  }

  function ownerChoices() {
    if (!state.viewer) return [];
    return [state.viewer, ...state.organizations.filter((org) => org.role === "Owner").map((org) => org.name)];
  }

  function createRepository(body: Record<string, unknown>) {
    const owner = String(body.owner ?? "");
    const name = String(body.name ?? "").trim();
    const fields: Record<string, string> = {};
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to create a repository" } };
    if (!name) fields.name = "Repository name is required";
    if (!ownerChoices().includes(owner)) {
      fields.owner = "You do not have permission to create repositories for this owner";
    }
    if (name && state.repositories.some((repository) => repository.owner === owner && repository.name === name)) {
      fields.name = "Repository name already exists";
    }
    if (Object.keys(fields).length > 0) {
      return { status: 400, body: { error: Object.values(fields)[0], fields } };
    }
    const organization = state.organizations.find((entry) => entry.name === owner);
    const initialize = body.initialize === true;
    const commitId = `commit-${state.repositories.length + 1}-initial`;
    const repository: MockRepository = {
      id: `repository-${state.repositories.length + 1}`,
      owner,
      ownerType: organization ? "organization" : "account",
      ownerDisplayName: organization ? organization.displayName : owner,
      name,
      description: String(body.description ?? ""),
      visibility: body.visibility === "private" ? "private" : "public",
      defaultBranch: "main",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      branches: initialize ? [{ name: "main", headId: commitId }] : [],
      commits: initialize
        ? [
            {
              id: commitId,
              message: "Initial commit",
              author: viewer,
              createdAt: TIMESTAMP,
              parentId: null,
              branch: "main",
              files: [{ path: "README.md", change: "added" }],
              tree: [{ path: "README.md", content: `# ${name}\n` }],
            },
          ]
        : [],
      sourceRepositoryId: null,
      grants: [],
      labels: [],
      milestones: [],
      issues: [],
      protectionRules: [],
      pullRequests: [],
    };
    state.repositories.push(repository);
    return { status: 201, body: { repository: overview(repository) } };
  }

  function forkRepository(source: MockRepository, body: Record<string, unknown>) {
    const viewer = state.viewer;
    const owner = String(body.owner ?? "");
    const name = String(body.name ?? "").trim() || source.name;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to create a repository" } };
    if (!canRead(source)) return { status: 403, body: { error: "You cannot fork a repository you cannot read" } };
    const fields: Record<string, string> = {};
    if (!ownerChoices().includes(owner)) {
      fields.owner = "You do not have permission to create repositories for this owner";
    }
    if (state.repositories.some((repository) => repository.owner === owner && repository.name === name)) {
      fields.name = "Repository name already exists";
    }
    if (Object.keys(fields).length > 0) {
      return { status: 400, body: { error: Object.values(fields)[0], fields } };
    }
    const organization = state.organizations.find((entry) => entry.name === owner);
    const fork: MockRepository = {
      ...source,
      id: `repository-fork-${state.repositories.length + 1}`,
      owner,
      ownerType: organization ? "organization" : "account",
      ownerDisplayName: organization ? organization.displayName : owner,
      name,
      visibility: source.visibility === "private" ? "private" : body.visibility === "private" ? "private" : "public",
      sourceRepositoryId: source.id,
      grants: [],
      branches: source.branches.map((branch) => ({ ...branch })),
      commits: source.commits.map((commit) => ({
        ...commit,
        files: commit.files.map((file) => ({ ...file })),
        tree: commit.tree.map((file) => ({ ...file })),
      })),
    };
    state.repositories.push(fork);
    return { status: 201, body: { repository: overview(fork) } };
  }

  /** One branch reference created at a base commit (REQ-4-3-2). */
  function createBranch(repository: MockRepository, body: Record<string, unknown>) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to create branches" } };
    const role = viewerRole(repository);
    if (role === null || !WRITE_ROLES.includes(role)) {
      return { status: 403, body: { error: "You do not have permission to create branches in this repository" } };
    }
    const name = String(body.name ?? "").trim();
    const invalid = branchNameError(name);
    if (invalid) return { status: 400, body: { error: invalid, fields: { name: invalid } } };
    if (repository.branches.some((branch) => branch.name === name)) {
      return { status: 400, body: { error: "Branch already exists", fields: { name: "Branch already exists" } } };
    }
    const base = String(body.base ?? "").trim() || repository.defaultBranch;
    const baseBranch = repository.branches.find((branch) => branch.name === base);
    const baseCommit = baseBranch ? baseBranch.headId : repository.commits.find((commit) => commit.id === base)?.id;
    if (!baseCommit) {
      return { status: 400, body: { error: "Base revision not found", fields: { base: "Base revision not found" } } };
    }
    repository.branches.push({ name, headId: baseCommit });
    return { status: 201, body: { repository: overview(repository) } };
  }

  /** Moves the default branch for a repository Admin (REQ-4-3-3). */
  function changeDefaultBranch(repository: MockRepository, body: Record<string, unknown>) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Only a repository Admin can change the default branch" } };
    if (viewerRole(repository) !== "Admin") {
      return { status: 403, body: { error: "Only a repository Admin can change the default branch" } };
    }
    const name = String(body.branch ?? "").trim();
    if (!repository.branches.some((branch) => branch.name === name)) {
      return { status: 400, body: { error: "Branch not found", fields: { branch: "Branch not found" } } };
    }
    repository.defaultBranch = name;
    return { status: 200, body: { repository: overview(repository) } };
  }

  function changeVisibility(repository: MockRepository, body: Record<string, unknown>) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Only a repository Admin can change its visibility" } };
    if (viewerRole(repository) !== "Admin") {
      return { status: 403, body: { error: "Only a repository Admin can change its visibility" } };
    }
    const visibility = body.visibility === "private" ? "private" : "public";
    const confirmation = String(body.confirmation ?? "").trim();
    if (confirmation && confirmation !== repository.name && confirmation !== `${repository.owner}/${repository.name}`) {
      return {
        status: 400,
        body: {
          error: "Confirmation text does not match the repository name",
          fields: { confirmation: "Confirmation text does not match the repository name" },
        },
      };
    }
    repository.visibility = visibility;
    return { status: 200, body: { repository: overview(repository) } };
  }

  /** One file change through the Code page (REQ-4-4). */
  function commitFile(repository: MockRepository, body: Record<string, unknown>) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "Sign in is required to edit files" } };
    const role = viewerRole(repository);
    if (role === null || !WRITE_ROLES.includes(role)) {
      return { status: 403, body: { error: "You do not have permission to edit files in this repository" } };
    }
    const branchName = String(body.branch ?? "").trim() || repository.defaultBranch;
    const branch = branchOf(repository, branchName);
    if (!branch) {
      return { status: 404, body: { error: "Branch not found", fields: { branch: "Branch not found" } } };
    }
    const path = String(body.path ?? "").trim();
    const message = String(body.message ?? "").trim();
    const creating = body.create === true;
    const originalPath = String(body.originalPath ?? "").trim();
    const fields: Record<string, string> = {};
    const invalid = pathError(path);
    if (invalid) fields.path = invalid;
    if (!message) fields.message = "Commit message is required";
    else if (message.length > 72) fields.message = "Commit message must be 72 characters or fewer";
    const files = snapshot(repository, branch.name);
    if (!invalid && creating && files.some((file) => file.path === path)) {
      fields.path = "A file or directory already exists at this path";
    }
    const rule = protectionRuleFor(repository, branch.name);
    if (branch.protected === true || (rule && (rule.requireApproval || rule.requireStatusCheck))) {
      fields.branch = "This branch is protected";
    }
    if (Object.keys(fields).length > 0) {
      return { status: 400, body: { error: Object.values(fields)[0], fields } };
    }
    const nextTree = files.filter((file) => !(originalPath && originalPath !== path && file.path === originalPath));
    const content = String(body.content ?? "");
    const existing = nextTree.find((file) => file.path === path);
    if (existing) existing.content = content;
    else nextTree.push({ path, content });
    const commit: MockRepositoryCommit = {
      id: `commit-${repository.commits.length + 1}-${Date.now()}`,
      message,
      author: viewer,
      createdAt: TIMESTAMP,
      parentId: branch.headId,
      branch: branch.name,
      files: [
        ...(originalPath && originalPath !== path ? [{ path: originalPath, change: "removed" }] : []),
        { path, change: creating ? "added" : "modified" },
      ],
      tree: nextTree,
    };
    repository.commits.push(commit);
    branch.headId = commit.id;
    return {
      status: 201,
      body: {
        branch: branch.name,
        path,
        file: { path, content, branch: branch.name, lastCommit: commit },
        commit,
      },
    };
  }

  /** The operation-specific permissions of the issue workflow (REQ-5). */
  function issuePermissionsFor(role: string | null) {
    const content = role !== null && ISSUE_CONTENT_ROLES.includes(role);
    const triage = role !== null && ISSUE_TRIAGE_ROLES.includes(role);
    return {
      canCreateIssue: content,
      canEditIssue: content,
      canComment: content,
      canAssignParticipants: triage,
      canApplyLabels: triage,
      canSetMilestone: triage,
      canChangeStatus: triage,
    };
  }

  /** The reactions of one target summed by type, flagged for the mock viewer. */
  function reactionRow(reactions: MockIssueReaction[], targetType: string, targetId: string) {
    const counts = new Map<string, { type: string; count: number; mine: boolean }>();
    for (const reaction of reactions) {
      if (reaction.targetType !== targetType || reaction.targetId !== targetId) continue;
      const entry = counts.get(reaction.type) ?? { type: reaction.type, count: 0, mine: false };
      entry.count += 1;
      if (reaction.account === state.viewer) entry.mine = true;
      counts.set(reaction.type, entry);
    }
    return [...counts.values()];
  }

  /** The stable target identifier of an issue inside the mock store. */
  function issueTarget(issue: MockIssue): string {
    return issue.id ?? `issue-${issue.number}`;
  }

  /** One list row of a stored issue, with the text the keyword filter matches. */
  function issueRow(issue: MockIssue) {
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      status: issue.status,
      author: issue.author,
      labels: [...issue.labels],
      assignees: [...issue.assignees],
      milestone: issue.milestone,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      commentCount: issue.comments.length,
      reactions: reactionRow(issue.reactions, "issue", issueTarget(issue)),
    };
  }

  /** The complete detail payload of one issue, shared by reads and writes. */
  function issueDetail(repository: MockRepository, issue: MockIssue) {
    const role = viewerRole(repository);
    return {
      repository: summary(repository),
      viewerRole: role,
      permissions: issuePermissionsFor(role),
      labels: repository.labels,
      milestones: repository.milestones,
      assignableMembers: assignableMembers(repository),
      issue: issueRow(issue),
      comments: issue.comments.map((comment) => ({
        ...comment,
        reactions: reactionRow(issue.reactions, "comment", comment.id),
      })),
      timeline: issue.timeline.map((event) => ({ ...event })),
    };
  }

  /** The stored reactions of an issue start as an empty association list. */
  function issueReactions(issue: MockIssue): MockIssueReaction[] {
    if (!Array.isArray(issue.reactions)) issue.reactions = [];
    return issue.reactions;
  }

  function issueEvent(issue: MockIssue, type: string, actor: string, text: string) {
    issue.timeline.push({ id: `event-${issue.timeline.length + 1}-${type}`, type, actor, text, createdAt: TIMESTAMP });
  }

  /** POST issues — create one work item with its number and creation activity. */
  function createIssue(repository: MockRepository, body: Record<string, unknown>) {
    const viewer = state.viewer;
    if (!viewer) return { status: 401, body: { error: "You need write access to create an issue in this repository" } };
    const role = viewerRole(repository);
    if (role === null || !ISSUE_CONTENT_ROLES.includes(role)) {
      return { status: 403, body: { error: "You need write access to create an issue in this repository" } };
    }
    const title = String(body.title ?? "").trim();
    const description = typeof body.description === "string" ? body.description : "";
    const fields: Record<string, string> = {};
    if (!title) fields.title = "Title is required";
    else if (title.length > 256) fields.title = "Title must be 256 characters or fewer";
    if (description.length > 65536) fields.description = "Description must be 65536 characters or fewer";
    if (Object.keys(fields).length > 0) {
      return { status: 400, body: { error: Object.values(fields)[0], fields } };
    }
    const number = repository.issues.reduce((highest, issue) => Math.max(highest, issue.number), 0) + 1;
    const issue: MockIssue = {
      number,
      title,
      body: description,
      status: "open",
      author: viewer,
      labels: [],
      assignees: [],
      milestone: null,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      comments: [],
      reactions: [],
      timeline: [],
    };
    issue.timeline.push({ id: `event-${number}-created`, type: "created", actor: viewer, text: "opened this issue", createdAt: TIMESTAMP });
    repository.issues.push(issue);
    return { status: 201, body: issueDetail(repository, issue) };
  }

  /** POST issues/:number/title|description|comments|reactions. */
  function writeIssue(repository: MockRepository, number: number, target: string, commentId: string | null, body: Record<string, unknown>) {
    const viewer = state.viewer;
    const issue = repository.issues.find((entry) => entry.number === number);
    if (!issue) return { status: 404, body: { error: "Issue not found" } };
    if (!viewer) return { status: 401, body: { error: "You do not have permission to edit this issue" } };
    const role = viewerRole(repository);
    const mayWriteContent = role !== null && ISSUE_CONTENT_ROLES.includes(role);
    const id = issueTarget(issue);
    if (target === "reactions") {
      if (!canRead(repository)) return { status: 403, body: { error: "You do not have permission to react on this issue" } };
      const type = String(body.type ?? "").trim();
      if (!REACTION_TYPES.includes(type)) {
        return { status: 400, body: { error: "Unknown reaction", fields: { reaction: "Unknown reaction" } } };
      }
      const targetType = commentId ? "comment" : "issue";
      const targetId = commentId ?? id;
      if (commentId && !issue.comments.some((comment) => comment.id === commentId)) {
        return { status: 400, body: { error: "Comment not found", fields: { comment: "Comment not found" } } };
      }
      const reactions = issueReactions(issue);
      const index = reactions.findIndex(
        (reaction) =>
          reaction.targetType === targetType
          && reaction.targetId === targetId
          && reaction.account === viewer
          && reaction.type === type,
      );
      if (index >= 0) {
        reactions.splice(index, 1);
        issueEvent(issue, "reacted", viewer, `removed the ${type} reaction`);
      } else {
        reactions.push({ targetType, targetId, account: viewer, type });
        issueEvent(issue, "reacted", viewer, `reacted with ${type}`);
      }
      issue.updatedAt = TIMESTAMP;
      return { status: 200, body: issueDetail(repository, issue) };
    }
    if (!mayWriteContent) return { status: 403, body: { error: "You do not have permission to edit this issue" } };
    if (target === "title") {
      const title = String(body.title ?? "").trim();
      if (!title) return { status: 400, body: { error: "Title is required", fields: { title: "Title is required" } } };
      if (title.length > 256) {
        return { status: 400, body: { error: "Title must be 256 characters or fewer", fields: { title: "Title must be 256 characters or fewer" } } };
      }
      if (title !== issue.title) {
        issue.title = title;
        issue.updatedAt = TIMESTAMP;
        issueEvent(issue, "edited", viewer, `changed the title to “${title}”`);
      }
      return { status: 200, body: issueDetail(repository, issue) };
    }
    if (target === "description") {
      const description = typeof body.description === "string" ? body.description : "";
      if (description.length > 65536) {
        return {
          status: 400,
          body: { error: "Description must be 65536 characters or fewer", fields: { description: "Description must be 65536 characters or fewer" } },
        };
      }
      if (description !== issue.body) {
        issue.body = description;
        issue.updatedAt = TIMESTAMP;
        issueEvent(issue, "edited", viewer, "updated the issue description");
      }
      return { status: 200, body: issueDetail(repository, issue) };
    }
    const commentBody = String(body.body ?? "").trim();
    if (!commentBody) {
      return { status: 400, body: { error: "Comment is required", fields: { comment: "Comment is required" } } };
    }
    if (commentBody.length > 65536) {
      return { status: 400, body: { error: "Comment must be 65536 characters or fewer", fields: { comment: "Comment must be 65536 characters or fewer" } } };
    }
    issue.comments.push({
      id: `comment-${number}-${issue.comments.length + 1}`,
      author: viewer,
      body: commentBody,
      createdAt: TIMESTAMP,
      reactions: [],
    });
    issue.updatedAt = TIMESTAMP;
    issueEvent(issue, "commented", viewer, "commented");
    return { status: 201, body: issueDetail(repository, issue) };
  }

  /**
   * POST issues/:number/assignees|labels|milestone|status — the metadata and
   * status writes of REQ-5-3 and REQ-5-4. Only Triage, Maintain and Admin are
   * allowed; the mock stores the association, appends the activity and keeps
   * every other field of the work item untouched.
   */
  function writeIssueMetadata(
    repository: MockRepository,
    number: number,
    target: string,
    body: Record<string, unknown>,
  ) {
    const viewer = state.viewer;
    const issue = repository.issues.find((entry) => entry.number === number);
    if (!issue) return { status: 404, body: { error: "Issue not found" } };
    const role = viewer ? roleOf(repository, viewer) : null;
    const forbidden = target === "status"
      ? "You do not have permission to change the issue status"
      : "You do not have permission to change the issue metadata";
    if (!viewer || role === null) {
      return { status: viewer ? 403 : 401, body: { error: forbidden } };
    }
    if (!ISSUE_TRIAGE_ROLES.includes(role)) {
      return { status: 403, body: { error: forbidden } };
    }
    if (target === "assignees") {
      const username = String(body.username ?? "").trim();
      if (!assignableMembers(repository).includes(username)) {
        return {
          status: 400,
          body: {
            error: "No account with that username is an assignable member of this repository",
            fields: { assignee: "No account with that username is an assignable member of this repository" },
          },
        };
      }
      issue.updatedAt = TIMESTAMP;
      const index = issue.assignees.indexOf(username);
      if (index >= 0) {
        issue.assignees.splice(index, 1);
        issueEvent(issue, "unassigned", viewer, `unassigned ${username}`);
      } else {
        issue.assignees.push(username);
        issueEvent(issue, "assigned", viewer, `assigned ${username}`);
      }
      return { status: 200, body: issueDetail(repository, issue) };
    }

    if (target === "labels") {
      const label = String(body.label ?? "").trim();
      if (!repository.labels.some((entry) => entry.name === label)) {
        return { status: 400, body: { error: "Unknown label", fields: { label: "Unknown label" } } };
      }
      issue.updatedAt = TIMESTAMP;
      const index = issue.labels.indexOf(label);
      if (index >= 0) {
        issue.labels.splice(index, 1);
        issueEvent(issue, "unlabeled", viewer, `removed the ${label} label`);
      } else {
        issue.labels.push(label);
        issueEvent(issue, "labeled", viewer, `added the ${label} label`);
      }
      return { status: 200, body: issueDetail(repository, issue) };
    }

    if (target === "milestone") {
      const raw = body.milestone === null ? "" : String(body.milestone ?? "").trim();
      if (!raw || raw === "None") {
        const previous = issue.milestone;
        issue.milestone = null;
        issue.updatedAt = TIMESTAMP;
        if (previous) issueEvent(issue, "unmilestoned", viewer, `removed this issue from the ${previous} milestone`);
        return { status: 200, body: issueDetail(repository, issue) };
      }
      if (!repository.milestones.some((entry) => entry.title === raw)) {
        return { status: 400, body: { error: "Unknown milestone", fields: { milestone: "Unknown milestone" } } };
      }
      issue.milestone = raw;
      issue.updatedAt = TIMESTAMP;
      issueEvent(issue, "milestoned", viewer, `added this issue to the ${raw} milestone`);
      return { status: 200, body: issueDetail(repository, issue) };
    }

    const status = String(body.status ?? "").trim().toLowerCase();
    if (status !== "open" && status !== "closed") {
      return { status: 400, body: { error: "Unknown status", fields: { status: "Unknown status" } } };
    }
    if (issue.status !== status) {
      issue.status = status;
      issue.updatedAt = TIMESTAMP;
      issueEvent(issue, status === "closed" ? "closed" : "reopened", viewer, status === "closed" ? "Closed issue" : "Reopened issue");
    }
    return { status: 200, body: issueDetail(repository, issue) };
  }

  function simulate(method: string, path: string, search: string, body: Record<string, unknown>) {
    state.requests.push({ method, path, body });

    if (path === "/api/session" && method === "GET") {
      return {
        status: 200,
        body: {
          user: state.viewer
            ? { username: state.viewer, email: `${state.viewer}@example.test`, organizations: state.organizations }
            : null,
        },
      };
    }

    // Signing in through the account-access page selects the viewer, mirroring
    // how the server resolves the session cookie of a later request.
    if (path === "/api/sessions" && method === "POST") {
      const identifier = String(body.identifier ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const account = ACCOUNTS.find(
        (candidate) => candidate === identifier || `${candidate}@example.test` === identifier,
      );
      if (!account || password !== "Valid-password-123!") {
        return { status: 401, body: { error: "Invalid credentials" } };
      }
      state.viewer = account;
      return {
        status: 200,
        body: {
          user: { username: account, email: `${account}@example.test`, organizations: state.organizations },
        },
      };
    }

    if (path === "/api/repositories" && method === "GET") {
      const repositories = state.repositories
        .filter((repository) => canRead(repository))
        .map(summary)
        .sort((left, right) => left.fullName.localeCompare(right.fullName));
      return { status: 200, body: { repositories } };
    }

    if (path === "/api/repositories" && method === "POST") return createRepository(body);

    if (path === "/api/search/repositories" && method === "GET") {
      const query = (new URL(`http://local${path}${search}`).searchParams.get("q") ?? "").trim().toLowerCase();
      const matches = query
        ? state.repositories.filter((repository) => canRead(repository) && repository.name.toLowerCase().includes(query))
        : [];
      return { status: 200, body: { query, repositories: matches.map(summary) } };
    }

    if (path.startsWith("/api/namespaces/") && method === "GET") {
      const name = decodeURIComponent(path.slice("/api/namespaces/".length));
      if (name !== "alice-dev" && name !== "bob-reviewer" && name !== "acme-demo") {
        return { status: 404, body: { error: "Namespace not found" } };
      }
      return {
        status: 200,
        body: {
          namespace: { type: name === "acme-demo" ? "organization" : "account", name, displayName: name },
          repositories: state.repositories
            .filter((repository) => repository.owner === name && canRead(repository))
            .map(summary),
        },
      };
    }

    const forks = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/forks$/);
    if (forks && method === "POST") {
      const source = find(decodeURIComponent(forks[1]), decodeURIComponent(forks[2]));
      if (!source) return { status: 404, body: { error: "Repository not found" } };
      return forkRepository(source, body);
    }

    const visibility = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/visibility$/);
    if (visibility && method === "POST") {
      const repository = find(decodeURIComponent(visibility[1]), decodeURIComponent(visibility[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return changeVisibility(repository, body);
    }

    const fileWrite = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/contents$/);
    if (fileWrite && method === "POST") {
      const repository = find(decodeURIComponent(fileWrite[1]), decodeURIComponent(fileWrite[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return commitFile(repository, body);
    }

    const branchWrite = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/branches$/);
    if (branchWrite && (method === "POST" || method === "PUT")) {
      const repository = find(decodeURIComponent(branchWrite[1]), decodeURIComponent(branchWrite[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return createBranch(repository, body);
    }

    const defaultBranch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/default-branch$/);
    if (defaultBranch && (method === "POST" || method === "PUT")) {
      const repository = find(decodeURIComponent(defaultBranch[1]), decodeURIComponent(defaultBranch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return changeDefaultBranch(repository, body);
    }

    const commitEntry = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/commits\/(.+)$/);
    if (commitEntry && method === "GET") {
      const repository = find(decodeURIComponent(commitEntry[1]), decodeURIComponent(commitEntry[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      const id = decodeURIComponent(commitEntry[3]);
      const commit = repository.commits.find((entry) => entry.id === id);
      if (!commit) return { status: 404, body: { error: "Commit not found" } };
      const parent = commit.parentId
        ? repository.commits.find((entry) => entry.id === commit.parentId) ?? null
        : null;
      const files = revisionChanges(parent?.tree ?? [], commit.tree);
      return {
        status: 200,
        body: {
          branch: commit.branch ?? repository.defaultBranch,
          commit,
          base: parent
            ? { ref: parent.id, type: "commit", branch: parent.branch, commit: parent }
            : { ref: null, type: "empty", branch: null, commit: null },
          compare: { ref: commit.id, type: "commit", branch: commit.branch, commit },
          summary: diffSummary(files),
          files,
        },
      };
    }

    const revisions = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/revisions$/);
    if (revisions && method === "GET") {
      const repository = find(decodeURIComponent(revisions[1]), decodeURIComponent(revisions[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      return {
        status: 200,
        body: {
          branch: repository.defaultBranch,
          branches: repository.branches.map((branch) => branch.name),
          revisions: [
            ...repository.branches.map((branch) => ({ value: branch.name, label: branch.name, type: "branch" })),
            ...[...repository.commits]
              .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
              .map((commit) => ({
                value: commit.id,
                label: `${commit.id.slice(0, 7)} ${commit.message}`,
                type: "commit",
              })),
          ],
        },
      };
    }

    const compare = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/compare$/);
    if (compare && method === "GET") {
      const repository = find(decodeURIComponent(compare[1]), decodeURIComponent(compare[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      const params = new URL(`http://local${path}${search}`).searchParams;
      const baseRef = params.get("base") ?? "";
      const compareRef = params.get("compare") ?? "";
      if (!baseRef || !compareRef) {
        return { status: 400, body: { error: "Two revisions are required to compare", fields: {} } };
      }
      const resolve = (ref: string) => {
        const commit = repository.commits.find((entry) => entry.id === ref);
        if (commit) return { ref, type: "commit", branch: commit.branch, commit, tree: commit.tree };
        const branch = repository.branches.find((entry) => entry.name === ref);
        if (!branch) return null;
        const head = repository.commits.find((entry) => entry.id === branch.headId);
        if (!head) return null;
        return { ref, type: "branch", branch: branch.name, commit: head, tree: head.tree };
      };
      const base = resolve(baseRef);
      const target = resolve(compareRef);
      if (!base || !target) {
        return { status: 400, body: { error: "Unknown revision", fields: { base: "Unknown revision" } } };
      }
      const files = revisionChanges(base.tree, target.tree);
      const reached = new Set<string>();
      let walker: MockRepositoryCommit | null = base.commit;
      while (walker) {
        const current: MockRepositoryCommit = walker;
        if (reached.has(current.id)) break;
        reached.add(current.id);
        walker = current.parentId
          ? repository.commits.find((entry) => entry.id === current.parentId) ?? null
          : null;
      }
      const comparable: MockRepositoryCommit[] = [];
      const seen = new Set<string>();
      walker = target.commit;
      while (walker) {
        const current: MockRepositoryCommit = walker;
        if (seen.has(current.id)) break;
        seen.add(current.id);
        if (!reached.has(current.id)) comparable.push(current);
        walker = current.parentId
          ? repository.commits.find((entry) => entry.id === current.parentId) ?? null
          : null;
      }
      return {
        status: 200,
        body: {
          base: { ref: base.ref, type: base.type, branch: base.branch, commit: base.commit },
          compare: { ref: target.ref, type: target.type, branch: target.branch, commit: target.commit },
          summary: diffSummary(files),
          files,
          commits: comparable,
        },
      };
    }

    const codeSearch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/code-search$/);
    if (codeSearch && method === "GET") {
      const repository = find(decodeURIComponent(codeSearch[1]), decodeURIComponent(codeSearch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      const params = new URL(`http://local${path}${search}`).searchParams;
      const needle = (params.get("q") ?? "").trim().toLowerCase();
      const pathFilter = (params.get("path") ?? "").trim().toLowerCase();
      const languageFilter = (params.get("language") ?? "").trim().toLowerCase();
      const languages = [
        ...new Set(
          repository.branches.flatMap((branch) =>
            snapshot(repository, branch.name).map((file) => fileLanguage(file.path)),
          ),
        ),
      ].sort();
      const ordered = [
        ...repository.branches.filter((branch) => branch.name === repository.defaultBranch),
        ...repository.branches.filter((branch) => branch.name !== repository.defaultBranch),
      ];
      const results: Array<Record<string, unknown>> = [];
      const matched = new Set<string>();
      if (needle) {
        for (const branch of ordered) {
          for (const file of snapshot(repository, branch.name)) {
            if (matched.has(file.path)) continue;
            if (pathFilter && !file.path.toLowerCase().includes(pathFilter)) continue;
            if (languageFilter && fileLanguage(file.path).toLowerCase() !== languageFilter) continue;
            const lines = splitLines(file.content)
              .map((text, index) => ({ number: index + 1, text }))
              .filter((line) => line.text.toLowerCase().includes(needle));
            if (lines.length === 0) continue;
            matched.add(file.path);
            results.push({
              path: file.path,
              name: fileName(file.path),
              branch: branch.name,
              language: fileLanguage(file.path),
              matches: lines.length,
              lines: lines.slice(0, 3),
              snippet: lines[0].text.trim(),
            });
          }
        }
      }
      results.sort((left, right) => String(left.path).localeCompare(String(right.path)));
      return {
        status: 200,
        body: {
          repository: summary(repository),
          query: params.get("q") ?? "",
          path: params.get("path") ?? "",
          language: params.get("language") ?? "",
          languages,
          results,
        },
      };
    }

    const issueListMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/issues$/);
    if (issueListMatch && method === "GET") {
      const repository = find(decodeURIComponent(issueListMatch[1]), decodeURIComponent(issueListMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      const role = viewerRole(repository);
      return {
        status: 200,
        body: {
          repository: summary(repository),
          viewerRole: role,
          permissions: issuePermissionsFor(role),
          labels: repository.labels,
          milestones: repository.milestones,
          assignableMembers: assignableMembers(repository),
          openCount: repository.issues.filter((issue) => issue.status === "open").length,
          closedCount: repository.issues.filter((issue) => issue.status === "closed").length,
          issues: repository.issues.map(issueRow),
        },
      };
    }

    if (issueListMatch && method === "POST") {
      const repository = find(decodeURIComponent(issueListMatch[1]), decodeURIComponent(issueListMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return createIssue(repository, body);
    }

    const issueMetadataMatch = path.match(
      /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/(assignees|labels|milestone|status)$/,
    );
    if (issueMetadataMatch && method === "POST") {
      const repository = find(decodeURIComponent(issueMetadataMatch[1]), decodeURIComponent(issueMetadataMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return writeIssueMetadata(
        repository,
        Number.parseInt(decodeURIComponent(issueMetadataMatch[3]), 10),
        issueMetadataMatch[4],
        body,
      );
    }

    const issueWriteMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/(title|description|comments)$/);
    if (issueWriteMatch && method === "POST") {
      const repository = find(decodeURIComponent(issueWriteMatch[1]), decodeURIComponent(issueWriteMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      const number = Number.parseInt(decodeURIComponent(issueWriteMatch[3]), 10);
      return writeIssue(repository, number, issueWriteMatch[4], null, body);
    }

    const commentReactionMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/comments\/([^/]+)\/reactions$/);
    if (commentReactionMatch && method === "POST") {
      const repository = find(decodeURIComponent(commentReactionMatch[1]), decodeURIComponent(commentReactionMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return writeIssue(
        repository,
        Number.parseInt(decodeURIComponent(commentReactionMatch[3]), 10),
        "reactions",
        decodeURIComponent(commentReactionMatch[4]),
        body,
      );
    }

    const issueReactionMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/reactions$/);
    if (issueReactionMatch && method === "POST") {
      const repository = find(decodeURIComponent(issueReactionMatch[1]), decodeURIComponent(issueReactionMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return writeIssue(repository, Number.parseInt(decodeURIComponent(issueReactionMatch[3]), 10), "reactions", null, body);
    }

    const issueDetailMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(.+)$/);
    if (issueDetailMatch && method === "GET") {
      const repository = find(decodeURIComponent(issueDetailMatch[1]), decodeURIComponent(issueDetailMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      const raw = decodeURIComponent(issueDetailMatch[3]).trim();
      const number = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
      const issue = repository.issues.find((entry) => entry.number === number);
      if (!issue) return { status: 404, body: { error: "Issue not found" } };
      return { status: 200, body: issueDetail(repository, issue) };
    }

    // The branch protection rules of the settings page (REQ-6-1) and the pull
    // requests of the Pull requests page (REQ-6).
    const protectionRules = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/protection-rules$/);
    if (protectionRules) {
      const repository = find(decodeURIComponent(protectionRules[1]), decodeURIComponent(protectionRules[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      const role = viewerRole(repository);
      if (method === "GET") {
        return {
          status: 200,
          body: {
            repository: summary(repository),
            viewerRole: role,
            canManage: role === "Admin",
            protectionRules: repository.protectionRules.map((rule) => ({ ...rule })),
          },
        };
      }
      return saveProtectionRule(repository, body);
    }

    const pullStatusWrite = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/(close|reopen)$/);
    if (pullStatusWrite && method === "POST") {
      const repository = find(decodeURIComponent(pullStatusWrite[1]), decodeURIComponent(pullStatusWrite[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      const pullRequest = repository.pullRequests.find(
        (entry) => entry.number === Number.parseInt(decodeURIComponent(pullStatusWrite[3]), 10),
      );
      if (!pullRequest) return { status: 404, body: { error: "Pull request not found" } };
      return changePullStatus(repository, pullRequest, pullStatusWrite[4] as "close" | "reopen");
    }

    const pullReviewerWrite = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/reviewers$/);
    if (pullReviewerWrite && method === "POST") {
      const repository = find(decodeURIComponent(pullReviewerWrite[1]), decodeURIComponent(pullReviewerWrite[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      const pullRequest = repository.pullRequests.find(
        (entry) => entry.number === Number.parseInt(decodeURIComponent(pullReviewerWrite[3]), 10),
      );
      if (!pullRequest) return { status: 404, body: { error: "Pull request not found" } };
      return requestPullReviewer(repository, pullRequest, body);
    }

    const pullReviewerRemove = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/reviewers\/(.+)$/);
    if (pullReviewerRemove && method === "DELETE") {
      const repository = find(decodeURIComponent(pullReviewerRemove[1]), decodeURIComponent(pullReviewerRemove[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      const pullRequest = repository.pullRequests.find(
        (entry) => entry.number === Number.parseInt(decodeURIComponent(pullReviewerRemove[3]), 10),
      );
      if (!pullRequest) return { status: 404, body: { error: "Pull request not found" } };
      return removePullReviewer(repository, pullRequest, decodeURIComponent(pullReviewerRemove[4]));
    }

    const pullMergeWrite = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/merge$/);
    if (pullMergeWrite && method === "POST") {
      const repository = find(decodeURIComponent(pullMergeWrite[1]), decodeURIComponent(pullMergeWrite[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      const pullRequest = repository.pullRequests.find(
        (entry) => entry.number === Number.parseInt(decodeURIComponent(pullMergeWrite[3]), 10),
      );
      if (!pullRequest) return { status: 404, body: { error: "Pull request not found" } };
      return mergePullRequest(repository, pullRequest);
    }

    const pullReady = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/ready$/);
    if (pullReady && method === "POST") {
      const repository = find(decodeURIComponent(pullReady[1]), decodeURIComponent(pullReady[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      const pullRequest = repository.pullRequests.find(
        (entry) => entry.number === Number.parseInt(decodeURIComponent(pullReady[3]), 10),
      );
      if (!pullRequest) return { status: 404, body: { error: "Pull request not found" } };
      return readyPullRequest(repository, pullRequest);
    }

    const pullCreate = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls$/);
    if (pullCreate && method === "POST") {
      const repository = find(decodeURIComponent(pullCreate[1]), decodeURIComponent(pullCreate[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      return createPullRequest(repository, body);
    }

    const pullChecksWrite = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/(checks|comments|reviews)$/);
    if (pullChecksWrite && method === "POST") {
      const repository = find(decodeURIComponent(pullChecksWrite[1]), decodeURIComponent(pullChecksWrite[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      const pullRequest = repository.pullRequests.find(
        (entry) => entry.number === Number.parseInt(decodeURIComponent(pullChecksWrite[3]), 10),
      );
      if (!pullRequest) return { status: 404, body: { error: "Pull request not found" } };
      if (pullChecksWrite[4] === "comments") return writePullComment(repository, pullRequest, body);
      if (pullChecksWrite[4] === "reviews") return writePullReview(repository, pullRequest, body);
      return savePullCheck(repository, pullRequest, body);
    }

    const pullDetailMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls\/([^/]+)$/);
    if (pullDetailMatch && method === "GET") {
      const repository = find(decodeURIComponent(pullDetailMatch[1]), decodeURIComponent(pullDetailMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      const pullRequest = repository.pullRequests.find(
        (entry) => entry.number === Number.parseInt(decodeURIComponent(pullDetailMatch[3]), 10),
      );
      if (!pullRequest) return { status: 404, body: { error: "Pull request not found" } };
      return {
        status: 200,
        body: {
          repository: summary(repository),
          viewerRole: viewerRole(repository),
          pullRequest: pullDetail(repository, pullRequest),
        },
      };
    }

    const pullListMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls$/);
    if (pullListMatch && method === "GET") {
      const repository = find(decodeURIComponent(pullListMatch[1]), decodeURIComponent(pullListMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      return {
        status: 200,
        body: {
          repository: summary(repository),
          viewerRole: viewerRole(repository),
          canCreatePullRequest: viewerRole(repository) !== null && WRITE_ROLES.includes(viewerRole(repository) as string),
          pullRequests: repository.pullRequests.map((pullRequest) => pullSummary(repository, pullRequest)),
        },
      };
    }

    const repositoryMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)(\/contents|\/commits)?$/);
    if (repositoryMatch && method === "GET") {
      const repository = find(decodeURIComponent(repositoryMatch[1]), decodeURIComponent(repositoryMatch[2]));
      if (!repository) return { status: 404, body: { error: "Repository not found" } };
      if (!canRead(repository)) return { status: 403, body: { error: "Access denied" } };
      if (repositoryMatch[3] === "/contents") {
        const params = new URL(`http://local${path}${search}`).searchParams;
        const requestedBranch = params.get("branch") ?? "";
        if (requestedBranch && !branchOf(repository, requestedBranch)) {
          return { status: 404, body: { error: "Branch not found" } };
        }
        const branch = branchOf(repository, requestedBranch);
        const branchName = branch?.name ?? repository.defaultBranch;
        const files = snapshot(repository, branchName);
        const commitCount = history(repository, branchName).length;
        const requested = params.get("path") ?? "";
        const file = files.find((candidate) => candidate.path === requested);
        if (file) {
          const lastCommit = history(repository, branchName).find((commit) =>
            commit.files.some((entry) => entry.path === requested)) ?? null;
          return {
            status: 200,
            body: {
              branch: branchName,
              path: file.path,
              commitCount,
              file: { path: file.path, content: file.content, branch: branchName, lastCommit },
            },
          };
        }
        const entries = entriesOf(files, requested);
        if (!requested || entries.length > 0) {
          return { status: 200, body: { branch: branchName, path: requested, commitCount, entries } };
        }
        return { status: 404, body: { error: "File not found" } };
      }
      if (repositoryMatch[3] === "/commits") {
        const params = new URL(`http://local${path}${search}`).searchParams;
        const requestedBranch = params.get("branch") ?? "";
        if (requestedBranch && !branchOf(repository, requestedBranch)) {
          return { status: 404, body: { error: "Branch not found" } };
        }
        const branch = branchOf(repository, requestedBranch);
        const branchName = branch?.name ?? repository.defaultBranch;
        const requestedPath = (params.get("path") ?? "").replace(/^\/+|\/+$/g, "");
        const commits = history(repository, branchName).filter((commit) =>
          !requestedPath || commit.files.some((entry) => entry.path === requestedPath));
        return {
          status: 200,
          body: {
            branch: branchName,
            branches: repository.branches.map((entry) => entry.name),
            path: requestedPath,
            files: snapshot(repository, branchName).map((file) => file.path),
            commits,
          },
        };
      }
      return { status: 200, body: { repository: overview(repository) } };
    }

    return { status: 404, body: { error: "Not found" } };
  }

  function install() {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url, "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const result = simulate(method, parsed.pathname, parsed.search, body);
      const headers: Record<string, string> = { "content-type": "application/json" };
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        json: async () => result.body,
        text: async () => JSON.stringify(result.body),
      };
    }) as unknown as typeof fetch;
    // The file editor submits through the blocking transport (REQ-4-4), so the
    // stored file address is active before the submit handler returns.
    installSyncXhr((method, path, body) => {
      const result = simulate(method, path, "", body);
      return { status: result.status, body: result.body };
    });
  }

  return { state, install };
}
