// Seed data and file-diff helpers shared by the in-memory organization backend.
// They mirror the server seeds (see backend/src/lib/org-seeds.mjs) so the
// frontend flows see the same repositories, history and code search results.

export interface FakeFile {
  path: string;
  content: string;
}

export interface FakeHistoryEntry {
  message: string;
  author: string;
  createdAt: string;
  files: FakeFile[];
}

export interface FakeDiffLine {
  type: "context" | "added" | "removed";
  text: string;
}

export interface FakeFileChange {
  path: string;
  status: "added" | "modified" | "removed";
  additions: number;
  deletions: number;
  lines: FakeDiffLine[];
}

const ACEME_DOCS_README = "# acme-docs\n\nDocumentation for the Acme Demo organization.\n";

/**
 * Mirrors the server seed: an older revision plus the readable
 * "Document search flow" commit of `alice-dev`. Only `src/README.md` carries the
 * searchable phrase, so the code search result stays unambiguous.
 */
export const ACEME_DOCS_HISTORY: FakeHistoryEntry[] = [
  {
    message: "Initial commit",
    author: "org-owner",
    createdAt: "2024-05-01T10:00:00.000Z",
    files: [
      { path: "README.md", content: ACEME_DOCS_README },
      { path: "src/README.md", content: "Document search flow" },
      { path: "src/index.js", content: "// Search entry point\n" },
      { path: "src/search.ts", content: "export function search(query: string) {\n  return query;\n}\n" },
    ],
  },
  {
    message: "Document search flow",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    files: [
      { path: "README.md", content: ACEME_DOCS_README },
      { path: "src/README.md", content: "Document search flow" },
      { path: "src/index.js", content: "// Search entry point\n" },
      {
        path: "src/search.ts",
        content: "export function search(query: string): boolean {\n  return query.trim().length > 0;\n}\n",
      },
    ],
  },
];

export const SEED_FILES = {
  secretResearch: [{ path: "README.md", content: "Internal research notes." }],
  visibilityDemo: [{ path: "README.md", content: "Demonstrates repository visibility and permission checks." }],
  personalAcmeDocs: [{ path: "README.md", content: "Personal copy of acme-docs." }],
  // REQ-3-1 / REQ-3-5 evolution: the README snapshots of the evolution search
  // and archive repositories, mirroring backend/src/lib/org-seeds.mjs.
  evoSearchCatalog: [
    { path: "README.md", content: "# evo-search-catalog-s1\n\nCatalog of the evolution search fixtures.\n" },
  ],
  evoSearchNotebook: [
    { path: "README.md", content: "# evo-search-notebook-s2\n\nNotebook notes of the evolution track.\n" },
  ],
  evoArchiveActive: [
    { path: "README.md", content: "# evo-archive-repository-s1\n\nActive repository of the archive scenarios.\n" },
  ],
  evoArchiveS2: [
    { path: "README.md", content: "# evo-archive-repository-s2\n\nReadable while it stays archived.\n" },
  ],
  evoArchiveS3: [
    { path: "README.md", content: "# evo-archive-repository-s3\n\nReadable while it stays archived.\n" },
  ],
};

export const singleHistory = (
  files: FakeFile[],
  author: string,
  createdAt: string,
): FakeHistoryEntry[] => [{ message: "Initial commit", author, createdAt, files }];

/** One seeded branch and the commits of its own chain. */
export interface FakeBranchSeed {
  name: string;
  commits: Array<FakeHistoryEntry & { base?: string }>;
}

/** Mirrors the server seed of `branch-switch-demo`. */
export const BRANCH_SWITCH_README = "# branch-switch-demo\n\nDemonstrates listing and switching branches.\n";

export const BRANCH_SWITCH_BRANCHES: FakeBranchSeed[] = [
  {
    name: "main",
    commits: [
      {
        message: "Initial commit",
        author: "org-owner",
        createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
        files: [{ path: "README.md", content: BRANCH_SWITCH_README }],
      },
    ],
  },
  {
    name: "feature-search",
    commits: [
      {
        message: "Add branch-only file",
        author: "alice-dev",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        base: "main",
        files: [
          { path: "README.md", content: BRANCH_SWITCH_README },
          { path: "main-only.md", content: "Only on the feature-search branch.\n" },
        ],
      },
    ],
  },
];

/** Mirrors the server seed of `default-branch-demo`. */export const DEFAULT_BRANCH_README = "# default-branch-demo\n\nDemonstrates changing the default branch.\n";

export const DEFAULT_BRANCH_BRANCHES: FakeBranchSeed[] = [
  {
    name: "main",
    commits: [
      {
        message: "Initial commit",
        author: "org-owner",
        createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
        files: [{ path: "README.md", content: DEFAULT_BRANCH_README }],
      },
    ],
  },
  {
    name: "release",
    commits: [
      {
        message: "Prepare release",
        author: "org-owner",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        base: "main",
        files: [
          { path: "README.md", content: DEFAULT_BRANCH_README },
          { path: "release-notes.md", content: "Release notes for the next version.\n" },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Branch-switching and release evolution seeds (REQ-4-3-1 evolution, REQ-4-5).
// They mirror the server seeds in backend/src/lib/org-seeds.mjs: the active
// branch of each repository is `evo-main-sN`, the second named reference is
// `evo-feature-sN` and the release tags are unique inside their repository.
// ---------------------------------------------------------------------------

const evoReadme = (index: number) =>
  `# evo-branch-switch-s${index}\n\nDemonstrates listing and switching repository branches.\n`;

/** The two branches of one `evo-branch-switch-sN` fixture. */
export const evoBranchSwitchBranches = (
  index: number,
  targetFile: string | null = null,
): FakeBranchSeed[] => {
  const active = `evo-main-s${index}`;
  const target = `evo-feature-s${index}`;
  return [
    {
      name: active,
      commits: [
        {
          message: "Initial commit",
          author: "evo-branch-owner",
          createdAt: new Date(Date.now() - (9 - index) * 24 * 60 * 60 * 1000).toISOString(),
          files: [{ path: "README.md", content: evoReadme(index) }],
        },
      ],
    },
    {
      name: target,
      commits: [
        {
          message: "Add branch-only file",
          author: "evo-branch-owner",
          createdAt: new Date(Date.now() - (6 - index) * 24 * 60 * 60 * 1000).toISOString(),
          base: active,
          files: [
            { path: "README.md", content: evoReadme(index) },
            ...(targetFile
              ? [{ path: targetFile, content: `Only on the ${target} branch.\n` }]
              : []),
          ],
        },
      ],
    },
  ];
};

/** The single named active branch of one `evo-release-repository-sN` fixture. */
export const evoReleaseBranches = (index: number): FakeBranchSeed[] => [
  {
    name: `evo-main-s${index}`,
    commits: [
      {
        message: "Initial commit",
        author: "evo-release-owner",
        createdAt: new Date(Date.now() - (7 - index) * 24 * 60 * 60 * 1000).toISOString(),
        files: [
          {
            path: "README.md",
            content: `# evo-release-repository-s${index}\n\nDemonstrates publishing and reading repository releases.\n`,
          },
        ],
      },
    ],
  },
];

/** The releases the server already published for the REQ-4-5 fixtures. */
export const EVO_RELEASES = [
  {
    repositoryId: "repo-evo-release-repository-s2",
    tag: "evo-v0-1-s2",
    title: "Existing Evolution Release",
    description: "Release description of the existing evolution release.",
    branch: "evo-main-s2",
    author: "evo-release-owner",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    repositoryId: "repo-evo-release-repository-s3",
    tag: "evo-v0-1-s3",
    title: "Already published evolution release",
    description: "Published before, so the tag is already taken.",
    branch: "evo-main-s3",
    author: "evo-release-owner",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Issue seeds (REQ-5-1, REQ-5-2). They mirror the server seeds in
// backend/src/lib/org-seeds.mjs: the classification names of `acme-docs` and the
// work items the read-only and mutation scenarios start from.
// ---------------------------------------------------------------------------

export interface FakeIssueLabel {
  name: string;
  color: string;
}

export interface FakeIssueSeed {
  number: number;
  title: string;
  description: string;
  status: "open" | "closed";
  author: string;
  labels: string[];
  comments: Array<{ author: string; body: string }>;
  createdAt: string;
}

// REQ-5-5 evolution: the public reaction repository, its three issues and the
// one `+1` the third issue already carries. Mirrors backend/src/lib/org-seeds.mjs.
export const EVO_REACTION_REPOSITORY_ID = "repo-evo-reaction-repository-s1";

export const EVO_REACTION_README: FakeFile[] = [
  {
    path: "README.md",
    content: "# evo-reaction-repository-s1\n\nReaction fixture of the evolution scenarios.\n",
  },
];

export const EVO_REACTION_ISSUES: FakeIssueSeed[] = [
  {
    number: 1,
    title: "Evo reaction issue s1",
    description: "Tracks adding a reaction and reading it back.",
    status: "open",
    author: "evo-reaction-author",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 2,
    title: "Evo reaction issue s2",
    description: "Tracks removing the own reaction again.",
    status: "open",
    author: "evo-reaction-author",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 3,
    title: "Evo reaction issue s3",
    description: "Tracks the reaction count a visitor may read.",
    status: "open",
    author: "evo-reaction-author",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const EVO_REACTION_SEED_REACTION = {
  id: "reaction-issue-evo-reaction-repository-s1-3-1",
  issueNumber: 3,
  type: "+1",
  author: "evo-reaction-author",
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
};

export const ACEME_DOCS_ISSUE_LABELS: FakeIssueLabel[] = [
  { name: "bug", color: "#d73a4a" },
  { name: "documentation", color: "#0075ca" },
];

export const ACEME_DOCS_MILESTONES = ["v1.0"];

export const ACEME_DOCS_ISSUES: FakeIssueSeed[] = [
  {
    number: 1,
    title: "Improve onboarding",
    description: "Describe the onboarding improvement.",
    status: "open",
    author: "alice-dev",
    labels: ["documentation"],
    comments: [{ author: "alice-dev", body: "The first run should be gentler for new accounts." }],
    createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 2,
    title: "Legacy welcome text",
    description: "The imported welcome text is out of date.",
    status: "closed",
    author: "org-owner",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 3,
    title: "Commentable onboarding issue",
    description: "Tracks a discussion added later.",
    status: "open",
    author: "alice-dev",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 4,
    title: "Comment validation issue",
    description: "Tracks empty comment validation.",
    status: "open",
    author: "alice-dev",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  // REQ-5-2-2 / REQ-5-3: one isolated work item per mutation scenario, each
  // starting without an assignee, label or milestone.
  {
    number: 5,
    title: "Editable onboarding issue",
    description: "Tracks editing the onboarding issue title and description.",
    status: "open",
    author: "issue-editor",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 6,
    title: "Original issue title",
    description: "Tracks the rejected empty-title edit.",
    status: "open",
    author: "issue-editor",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 7,
    title: "Assignable onboarding issue",
    description: "Tracks assigning a participant to the onboarding work.",
    status: "open",
    author: "issue-editor",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 8,
    title: "Labelable onboarding issue",
    description: "Tracks applying a repository label.",
    status: "open",
    author: "issue-editor",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 9,
    title: "Milestone onboarding issue",
    description: "Tracks setting a repository milestone.",
    status: "open",
    author: "issue-editor",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  // REQ-5-4: the Open work item the close/reopen scenario transitions and the
  // read-only work item the viewer scenario opens.
  {
    number: 10,
    title: "Closable onboarding issue",
    description: "Tracks closing and reopening the onboarding issue.",
    status: "open",
    author: "issue-editor",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 11,
    title: "Protected onboarding issue",
    description: "Tracks the read-only view of the onboarding issue.",
    status: "open",
    author: "issue-editor",
    labels: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

/** Mirrors the server seed of `acme-docs`'s pull-request source branches. */
export interface FakeExtraBranchSeed {
  name: string;
  message: string;
  author: string;
  createdAt: string;
  parentCommitId: string;
  files: FakeFile[];
}

const ACEME_DOCS_MAIN_FILES = ACEME_DOCS_HISTORY[ACEME_DOCS_HISTORY.length - 1].files;

/** The `main` snapshot with one file replaced, so the diff is one file. */
function acmeDocsWith(path: string, content: string): FakeFile[] {
  return ACEME_DOCS_MAIN_FILES.map((file) =>
    file.path === path ? { path, content } : { ...file },
  );
}

export const ACEME_DOCS_EXTRA_BRANCHES: FakeExtraBranchSeed[] = [
  {
    name: "feature-search",
    message: "Refine the search result",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: ACEME_DOCS_MAIN_FILES.map((file) =>
      file.path === "src/search.ts"
        ? {
            path: "src/search.ts",
            content: "export function search(query: string): string[] {\n  return [query];\n}\n",
          }
        : { ...file },
    ),
  },
  {
    name: "onboarding-docs",
    message: "Document the onboarding flow",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: [
      ...ACEME_DOCS_MAIN_FILES.map((file) => ({ ...file })),
      {
        path: "docs/onboarding.md",
        content: "# Onboarding\n\nWalk new accounts through the first steps.\n",
      },
    ],
  },
  {
    name: "draft-feature",
    message: "Draft the onboarding update",
    author: "draft-author",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("README.md", `${ACEME_DOCS_README}\nDraft onboarding update.\n`),
  },
  {
    name: "overview-docs",
    message: "Add the overview notes",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: [
      ...ACEME_DOCS_MAIN_FILES.map((file) => ({ ...file })),
      { path: "docs/overview.md", content: "# Overview\n\nHow to read a pull request.\n" },
    ],
  },
  {
    name: "public-search",
    message: "Refine the public search helper",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith(
      "src/search.ts",
      "export function search(query: string): string[] {\n  const trimmed = query.trim();\n  return trimmed ? [trimmed] : [];\n}\n",
    ),
  },
  {
    name: "review-feature",
    message: "Prepare the reviewable change",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Reviewed line\n"),
  },
  {
    name: "pending-feature",
    message: "Prepare the pending review change",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/README.md", "Document search flow\n\nPending review target.\n"),
  },
  // REQ-6-3-4 / REQ-6-4 / REQ-6-5 / REQ-6-6: the source branches of the pull
  // requests of the review, reviewer, merge and close/reopen scenarios.
  {
    name: "change-request-feature",
    message: "Propose the change request target",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Change request target\n"),
  },
  {
    name: "reviewer-request-feature",
    message: "Propose the reviewer request target",
    author: "pr-author",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Reviewer request target\n"),
  },
  {
    name: "merge-feature",
    message: "Add the mergeable documentation",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("README.md", `${ACEME_DOCS_README}\nMergeable onboarding note.\n`),
  },
  {
    name: "blocked-feature",
    message: "Add the blocked documentation",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Blocked onboarding note\n"),
  },
  {
    name: "closable-feature",
    message: "Propose the closeable change",
    author: "pr-author",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Closeable change\n"),
  },
  {
    name: "protected-feature",
    message: "Propose the protected change",
    author: "alice-dev",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Protected change\n"),
  },
];

/** Mirrors the server seed of `branch-protection-demo` (REQ-6-1). */
export const BRANCH_PROTECTION_BRANCHES: FakeBranchSeed[] = [
  {
    name: "main",
    commits: [
      {
        message: "Initial commit",
        author: "org-owner",
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        files: [
          {
            path: "README.md",
            content:
              "# branch-protection-demo\n\nDemonstrates branch protection rules and pull request checks.\n",
          },
        ],
      },
    ],
  },
  {
    name: "onboarding-status",
    commits: [
      {
        message: "Add the protection status note",
        author: "protection-admin",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        base: "main",
        files: [
          {
            path: "README.md",
            content:
              "# branch-protection-demo\n\nDemonstrates branch protection rules and pull request checks.\n",
          },
          { path: "checks.md", content: "Tracks the protection status check.\n" },
        ],
      },
    ],
  },
];

/** One seeded pull request with the check recorded for its compare commit. */
export interface FakePullRequestSeed {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  description: string;
  status: "draft" | "open" | "closed" | "merged";
  author: string;
  sourceBranch: string;
  targetBranch: string;
  baseCommitId: string;
  creationCompareCommitId: string;
  createdAt: string;
  checks: Array<{ name: string; status: "pending" | "success" | "failure"; commitId: string | null }>;
  requestedReviewers?: string[];
}

/** One seeded review decision of a pull request (REQ-6-3-4 / REQ-6-5). */
export interface FakePullRequestReviewSeed {
  id: string;
  pullRequestId: string;
  reviewer: string;
  decision: "approved" | "changes-requested";
  summary: string;
  commitId: string;
  createdAt: string;
}

/** Mirrors the server seed: the protected `main` of `acme-docs` (REQ-6-5). */
export const ACEME_DOCS_PROTECTION_RULES: Array<{
  id: string;
  repositoryId: string;
  branchName: string;
  requireApprovals: boolean;
  requireStatusCheck: boolean;
}> = [
  {
    id: "protection-acme-docs-main",
    repositoryId: "repo-acme-docs",
    branchName: "main",
    requireApprovals: true,
    requireStatusCheck: true,
  },
];

export const PULL_REQUEST_SEEDS: FakePullRequestSeed[] = [
  {
    id: "pull-acme-docs-1",
    repositoryId: "repo-acme-docs",
    number: 1,
    title: "Improve onboarding",
    description: "Improve the onboarding documentation for new accounts.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "onboarding-docs",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-onboarding-docs-1",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  {
    id: "pull-acme-docs-2",
    repositoryId: "repo-acme-docs",
    number: 2,
    title: "Overview onboarding PR",
    description: "Shows the pull request overview, its commits and its changed files.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "overview-docs",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-overview-docs-1",
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  {
    id: "pull-acme-docs-3",
    repositoryId: "repo-acme-docs",
    number: 3,
    title: "Public onboarding PR",
    description: "Public pull request whose diff includes src/search.ts.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "public-search",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-public-search-1",
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  {
    id: "pull-acme-docs-4",
    repositoryId: "repo-acme-docs",
    number: 4,
    title: "Reviewable onboarding PR",
    description: "Accept line comments from a non-author reviewer.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "review-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-review-feature-1",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  {
    id: "pull-acme-docs-5",
    repositoryId: "repo-acme-docs",
    number: 5,
    title: "Pending review onboarding PR",
    description: "Accept a pending review comment from a non-author reviewer.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "pending-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-pending-feature-1",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  {
    id: "pull-acme-docs-6",
    repositoryId: "repo-acme-docs",
    number: 6,
    title: "Draft onboarding update",
    description: "Draft pull request awaiting review.",
    status: "draft",
    author: "draft-author",
    sourceBranch: "draft-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-draft-feature-1",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  {
    id: "pull-branch-protection-demo-1",
    repositoryId: "repo-branch-protection-demo",
    number: 1,
    title: "Protection status onboarding PR",
    description: "Tracks the protection status check of this repository.",
    status: "open",
    author: "protection-admin",
    sourceBranch: "onboarding-status",
    targetBranch: "main",
    baseCommitId: "commit-repo-branch-protection-demo-main-1",
    creationCompareCommitId: "commit-repo-branch-protection-demo-onboarding-status-1",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [
      {
        name: "test",
        status: "pending",
        commitId: "commit-repo-branch-protection-demo-onboarding-status-1",
      },
    ],
  },
  // REQ-6-3-4: the Open proposal answered with a `Request changes` review.
  {
    id: "pull-acme-docs-7",
    repositoryId: "repo-acme-docs",
    number: 7,
    title: "Change request onboarding PR",
    description: "Accepts a Request changes review from a non-author reviewer.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "change-request-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-change-request-feature-1",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  // REQ-6-4: the author manages the pending reviewer requests of this one.
  {
    id: "pull-acme-docs-8",
    repositoryId: "repo-acme-docs",
    number: 8,
    title: "Reviewer request onboarding PR",
    description: "Lets the author request and remove a pending reviewer.",
    status: "open",
    author: "pr-author",
    sourceBranch: "reviewer-request-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-reviewer-request-feature-1",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  // REQ-6-5: the mergeable and the blocked proposal against protected `main`.
  {
    id: "pull-acme-docs-9",
    repositoryId: "repo-acme-docs",
    number: 9,
    title: "Mergeable onboarding PR",
    description: "Targets protected main with an approval and a passing check.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "merge-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-merge-feature-1",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [
      { name: "test", status: "success", commitId: "commit-repo-acme-docs-merge-feature-1" },
    ],
  },
  {
    id: "pull-acme-docs-10",
    repositoryId: "repo-acme-docs",
    number: 10,
    title: "Blocked onboarding PR",
    description: "Targets protected main without the required approval.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "blocked-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-blocked-feature-1",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [
      { name: "test", status: "success", commitId: "commit-repo-acme-docs-blocked-feature-1" },
    ],
  },
  // REQ-6-6: the closeable proposal and the read-only one.
  {
    id: "pull-acme-docs-11",
    repositoryId: "repo-acme-docs",
    number: 11,
    title: "Closable onboarding PR",
    description: "Lets the author close and reopen the proposal.",
    status: "open",
    author: "pr-author",
    sourceBranch: "closable-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-closable-feature-1",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  {
    id: "pull-acme-docs-12",
    repositoryId: "repo-acme-docs",
    number: 12,
    title: "Protected onboarding PR",
    description: "Readable by the viewer without close or reopen operations.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "protected-feature",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-protected-feature-1",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
  // Seed value: an extra Open proposal sourced from `feature-search`.
  {
    id: "pull-acme-docs-13",
    repositoryId: "repo-acme-docs",
    number: 13,
    title: "Fix search",
    description: "A proposal that refines the search helper.",
    status: "open",
    author: "alice-dev",
    sourceBranch: "feature-search",
    targetBranch: "main",
    baseCommitId: "commit-repo-acme-docs-2",
    creationCompareCommitId: "commit-repo-acme-docs-feature-search-1",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    checks: [],
  },
];

/** Mirrors the server seed: the valid approval of the mergeable proposal. */
export const PULL_REQUEST_REVIEW_SEEDS: FakePullRequestReviewSeed[] = [
  {
    id: "review-acme-docs-9-bob-reviewer",
    pullRequestId: "pull-acme-docs-9",
    reviewer: "bob-reviewer",
    decision: "approved",
    summary: "",
    commitId: "commit-repo-acme-docs-merge-feature-1",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export function splitContentLines(content: string): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Line diff of one file's old and new content, mirroring the server helper. */
export function diffContent(baseContent: string, compareContent: string) {
  const base = splitContentLines(baseContent);
  const compare = splitContentLines(compareContent);
  const table = Array.from({ length: base.length + 1 }, () => new Uint32Array(compare.length + 1));
  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = compare.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        base[i] === compare[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines: FakeDiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;
  while (i < base.length && j < compare.length) {
    if (base[i] === compare[j]) {
      lines.push({ type: "context", text: base[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "removed", text: base[i] });
      deletions += 1;
      i += 1;
      continue;
    }
    lines.push({ type: "added", text: compare[j] });
    additions += 1;
    j += 1;
  }
  while (i < base.length) {
    lines.push({ type: "removed", text: base[i] });
    deletions += 1;
    i += 1;
  }
  while (j < compare.length) {
    lines.push({ type: "added", text: compare[j] });
    additions += 1;
    j += 1;
  }
  return { lines, additions, deletions };
}

/** Difference between two revisions of the same repository. */
export function diffSnapshots(baseFiles: FakeFile[] | null, compareFiles: FakeFile[]) {
  const base = new Map((baseFiles ?? []).map((file) => [file.path, file.content]));
  const compare = new Map(compareFiles.map((file) => [file.path, file.content]));
  const paths = [...new Set([...base.keys(), ...compare.keys()])].sort();
  const files: FakeFileChange[] = [];
  let additions = 0;
  let deletions = 0;
  for (const path of paths) {
    const before = base.get(path);
    const after = compare.get(path);
    if (before === after) continue;
    const diff = diffContent(before ?? "", after ?? "");
    additions += diff.additions;
    deletions += diff.deletions;
    files.push({
      path,
      status: before === undefined ? "added" : after === undefined ? "removed" : "modified",
      additions: diff.additions,
      deletions: diff.deletions,
      lines: diff.lines,
    });
  }
  return { files, totals: { files: files.length, additions, deletions } };
}
