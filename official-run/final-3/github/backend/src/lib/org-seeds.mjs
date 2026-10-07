// Seed records written into `organizations.json` when the data directory is
// still empty. They are the predefined organizations, teams, memberships,
// repositories, branches, commits and access grants every scenario may rely on;
// later user changes are persisted on top of them.
//
// A repository's file list is the head commit of its default branch, so the
// seeds define complete revisions: the browsable tree, the commit history, the
// diff of a commit against its parent revision and the code search all read the
// same stored snapshots.

import { seedAccountId } from "./auth-store.mjs";

const SEED_ORGANIZATION = { id: "acme-demo", displayName: "Acme Demo" };
// REQ-2-1-2 (evolution): the organization an uppercase submission normalizes
// onto, so `EVO-LAB-02` is reported as an already existing identifier. It owns
// no repository, so it never joins the public organization discovery.
const EVO_LAB_DUPLICATE_ORGANIZATION = { id: "evo-lab-02", displayName: "Evo Lab Two" };
// REQ-2-4: the organization whose Owner reads the audit log. The requirement
// names it by its identifier only, so the identifier stays its visible name; its
// single repository is private and therefore out of the public discovery too.
const EVO_AUDIT_ORGANIZATION = { id: "evo-audit-org", displayName: "evo-audit-org" };
const EVO_AUDIT_REPOSITORY = "audit-demo";
// REQ-3-1 / REQ-3-5 (evolution): the personal namespaces of the evolution
// repositories. Both stay personal, so the visitor-facing organization
// discovery and the organization repository lists keep exactly their records.
const EVO_SEARCH_OWNER = "evo-search-owner";
const EVO_ARCHIVE_OWNER = "evo-archive-admin";
// REQ-4-3-1 / REQ-4-5 (evolution): the personal namespaces of the branch-switch
// repositories and of the release repositories (`evo-release-owner` owns the
// release repositories, which is its write permission). Both stay personal, so
// the visitor organization discovery and the organization repository lists keep
// exactly their records.
const EVO_BRANCH_SWITCH_OWNER = "evo-branch-switch-owner";
const EVO_RELEASE_OWNER = "evo-release-owner";
// REQ-5-5 (evolution): the personal namespace of the public repository the
// reaction scenarios open. The account also authors the three work items and
// carries the pre-existing reaction `-s3` starts with.
const EVO_REACTION_OWNER = "evo-reaction-author";
const EVO_REACTION_REPOSITORY_ID = "repo-evo-reaction-s1";
const EVO_REACTION_REPOSITORY_NAME = "evo-reaction-repository-s1";
const EPOCH = new Date(0).toISOString();

export const INITIAL_COMMIT_MESSAGE = "Initial commit";

// Default-branch file snapshots of the seeded repositories; a fork copies the
// files together with the commits that introduced them.
const SEED_FILES = {
  secretResearch: [{ path: "README.md", content: "Internal research notes." }],
  visibilityDemo: [{ path: "README.md", content: "Demonstrates repository visibility and permission checks." }],
  personalAcmeDocs: [{ path: "README.md", content: "Personal copy of acme-docs." }],
  // REQ-3-1 / REQ-3-5 (evolution): one readable file per evolution repository,
  // so an archived repository still shows its `README.md` and the searchable
  // seeds have real content behind their overview.
  evoSearchCatalog: [
    { path: "README.md", content: "# evo-search-catalog-s1\n\nCatalog repository of the evolution search scenarios.\n" },
  ],
  evoSearchNotebook: [
    { path: "README.md", content: "# evo-search-notebook-s2\n\nNotes repository of the evolution search scenarios.\n" },
  ],
  evoArchive: [
    { path: "README.md", content: "# evo-archive-repository\n\nContent kept across the state change.\n" },
  ],
  // REQ-5-5 (evolution): one readable file, so the public reaction repository
  // has real content behind its overview.
  evoReaction: [
    { path: "README.md", content: "# evo-reaction-repository-s1\n\nHolds the evolution reaction scenarios.\n" },
  ],
};

/** One-commit history of a seeded repository, as every repository starts out. */
function singleHistory(files, authorUsername, createdAt) {
  return [{ message: INITIAL_COMMIT_MESSAGE, author: authorUsername, createdAt, files }];
}

/** A seeded timestamp relative to the moment the store is first written. */
function recentTimestamp(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

const ACEME_DOCS_README = "# acme-docs\n\nDocumentation for the Acme Demo organization.\n";

// Branch-switching seeds (REQ-4-3-1, REQ-4-3-2): `main` and `feature-search`,
// where only the target branch carries `main-only.md`.
const BRANCH_SWITCH_README = "# branch-switch-demo\n\nDemonstrates listing and switching branches.\n";
const BRANCH_SWITCH_SET = [
  {
    name: "main",
    commits: [
      {
        message: INITIAL_COMMIT_MESSAGE,
        author: "org-owner",
        createdAt: recentTimestamp(9),
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
        createdAt: recentTimestamp(3),
        parent: { branch: "main", index: 0 },
        files: [
          { path: "README.md", content: BRANCH_SWITCH_README },
          { path: "main-only.md", content: "Only on the feature-search branch.\n" },
        ],
      },
    ],
  },
];

// Default-branch seeds (REQ-4-3-3): `main` is the default, `release` also
// exists and carries an extra file.
const DEFAULT_BRANCH_README = "# default-branch-demo\n\nDemonstrates changing the default branch.\n";
const DEFAULT_BRANCH_SET = [
  {
    name: "main",
    commits: [
      {
        message: INITIAL_COMMIT_MESSAGE,
        author: "org-owner",
        createdAt: recentTimestamp(12),
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
        createdAt: recentTimestamp(2),
        parent: { branch: "main", index: 0 },
        files: [
          { path: "README.md", content: DEFAULT_BRANCH_README },
          { path: "release-notes.md", content: "Release notes for the next version.\n" },
        ],
      },
    ],
  },
];

// Pull-request seeds (REQ-6) and branch-protection seeds (REQ-6-1): the extra
// source branches of `acme-docs` are defined next to its history below.

// Branch-protection seeds (REQ-6-1): a public repository whose `main` branch
// receives the protection rule and whose PR shows the `test` status check.
const BRANCH_PROTECTION_README =
  "# branch-protection-demo\n\nDemonstrates branch protection rules and pull request checks.\n";
const BRANCH_PROTECTION_SET = [
  {
    name: "main",
    commits: [
      {
        message: INITIAL_COMMIT_MESSAGE,
        author: "org-owner",
        createdAt: recentTimestamp(8),
        files: [{ path: "README.md", content: BRANCH_PROTECTION_README }],
      },
    ],
  },
  {
    name: "onboarding-status",
    commits: [
      {
        message: "Add the protection status note",
        author: "protection-admin",
        createdAt: recentTimestamp(1),
        parent: { branch: "main", index: 0 },
        files: [
          { path: "README.md", content: BRANCH_PROTECTION_README },
          { path: "checks.md", content: "Tracks the protection status check.\n" },
        ],
      },
    ],
  },
];

// Branch-switch evolution seeds (REQ-4-3-1): each repository opens on its own
// named active branch and also carries a target branch. The `-s1` and `-s3`
// targets add a file the active branch does not hold, so switching the selector
// changes the browsable snapshot; the target branch starts on top of the active
// branch's commit without copying files or rewriting the base history.
const EVO_BRANCH_SWITCH_S1 = [
  {
    name: "evo-main-s1",
    commits: [
      {
        message: INITIAL_COMMIT_MESSAGE,
        author: EVO_BRANCH_SWITCH_OWNER,
        createdAt: recentTimestamp(8),
        files: [
          { path: "README.md", content: "# evo-branch-switch-s1\n\nDemonstrates switching the active branch.\n" },
        ],
      },
    ],
  },
  {
    name: "evo-feature-s1",
    commits: [
      {
        message: "Add the target-only file",
        author: EVO_BRANCH_SWITCH_OWNER,
        createdAt: recentTimestamp(3),
        parent: { branch: "evo-main-s1", index: 0 },
        files: [
          { path: "README.md", content: "# evo-branch-switch-s1\n\nDemonstrates switching the active branch.\n" },
          { path: "evo-target-s1.md", content: "Only on the evo-feature-s1 branch.\n" },
        ],
      },
    ],
  },
];

const EVO_BRANCH_SWITCH_S2 = [
  {
    name: "evo-main-s2",
    commits: [
      {
        message: INITIAL_COMMIT_MESSAGE,
        author: EVO_BRANCH_SWITCH_OWNER,
        createdAt: recentTimestamp(8),
        files: [
          { path: "README.md", content: "# evo-branch-switch-s2\n\nKeeps the active branch on an unmatched query.\n" },
        ],
      },
    ],
  },
  {
    name: "evo-feature-s2",
    commits: [
      {
        message: "Add the available target branch",
        author: EVO_BRANCH_SWITCH_OWNER,
        createdAt: recentTimestamp(3),
        parent: { branch: "evo-main-s2", index: 0 },
        files: [
          { path: "README.md", content: "# evo-branch-switch-s2\n\nKeeps the active branch on an unmatched query.\n" },
          { path: "evo-feature-s2.md", content: "Only on the evo-feature-s2 branch.\n" },
        ],
      },
    ],
  },
];

const EVO_BRANCH_SWITCH_S3 = [
  {
    name: "evo-main-s3",
    commits: [
      {
        message: INITIAL_COMMIT_MESSAGE,
        author: EVO_BRANCH_SWITCH_OWNER,
        createdAt: recentTimestamp(8),
        files: [
          { path: "README.md", content: "# evo-branch-switch-s3\n\nRestores the selected branch after reload.\n" },
        ],
      },
    ],
  },
  {
    name: "evo-feature-s3",
    commits: [
      {
        message: "Add the target-only file",
        author: EVO_BRANCH_SWITCH_OWNER,
        createdAt: recentTimestamp(3),
        parent: { branch: "evo-main-s3", index: 0 },
        files: [
          { path: "README.md", content: "# evo-branch-switch-s3\n\nRestores the selected branch after reload.\n" },
          { path: "evo-target-s3.md", content: "Only on the evo-feature-s3 branch.\n" },
        ],
      },
    ],
  },
];

// Release evolution seeds (REQ-4-5): each repository carries exactly the branch
// the release scenarios target. `-s1` holds no release yet (the Owner publishes
// the first one), while `-s2` and `-s3` carry a published tag.
const EVO_RELEASE_BRANCHES = {
  s1: [
    {
      name: "evo-main-s1",
      commits: [
        {
          message: INITIAL_COMMIT_MESSAGE,
          author: EVO_RELEASE_OWNER,
          createdAt: recentTimestamp(6),
          files: [
            { path: "README.md", content: "# evo-release-repository-s1\n\nPublishes the first evolution release.\n" },
          ],
        },
      ],
    },
  ],
  s2: [
    {
      name: "evo-main-s2",
      commits: [
        {
          message: INITIAL_COMMIT_MESSAGE,
          author: EVO_RELEASE_OWNER,
          createdAt: recentTimestamp(6),
          files: [
            { path: "README.md", content: "# evo-release-repository-s2\n\nShows a published release to a visitor.\n" },
          ],
        },
      ],
    },
  ],
  s3: [
    {
      name: "evo-main-s3",
      commits: [
        {
          message: INITIAL_COMMIT_MESSAGE,
          author: EVO_RELEASE_OWNER,
          createdAt: recentTimestamp(6),
          files: [
            { path: "README.md", content: "# evo-release-repository-s3\n\nRejects a duplicate release tag.\n" },
          ],
        },
      ],
    },
  ],
};

/**
 * The published releases the release scenarios read (REQ-4-5). Each one is
 * bound to one exact tag, its title/description and the existing branch it
 * targets; `-s1` holds none because its Owner publishes the first release.
 */
const RELEASE_SEEDS = [
  {
    id: "release-evo-release-s2-1",
    repositoryId: "repo-evo-release-s2",
    tag: "evo-v0-1-s2",
    title: "Existing Evolution Release",
    description: "Published release kept for the read-only release scenario.",
    targetBranch: "evo-main-s2",
    authorName: EVO_RELEASE_OWNER,
    authorAccountId: seedAccountId(EVO_RELEASE_OWNER),
    createdAt: recentTimestamp(3),
  },
  {
    id: "release-evo-release-s3-1",
    repositoryId: "repo-evo-release-s3",
    tag: "evo-v0-1-s3",
    title: "Existing Evolution Release Three",
    description: "Published release whose tag the duplicate-tag scenario reuses.",
    targetBranch: "evo-main-s3",
    authorName: EVO_RELEASE_OWNER,
    authorAccountId: seedAccountId(EVO_RELEASE_OWNER),
    createdAt: recentTimestamp(3),
  },
];

/** One extra named branch of an already seeded repository, on top of a commit. */
function seedExtraBranches(repositoryId, specs) {
  const branches = [];
  const commits = [];
  for (const spec of specs) {
    const id = `commit-${repositoryId}-${spec.name}-1`;
    commits.push({
      id,
      repositoryId,
      branch: spec.name,
      message: spec.message,
      authorName: spec.author,
      authorAccountId: seedAccountId(spec.author),
      createdAt: spec.createdAt,
      parentCommitId: spec.parentCommitId,
      files: spec.files.map((file) => ({ ...file })),
    });
    branches.push({
      id: `branch-${repositoryId}-${spec.name}`,
      repositoryId,
      name: spec.name,
      headCommitId: id,
      createdAt: spec.createdAt,
    });
  }
  return { branches, commits };
}

/**
 * Seeded pull requests (REQ-6). Each one is a persistent proposal with a
 * repository-scoped number, the source/target branches, the creation-time base
 * and compare commits and a status. The checks belong to the compare commit
 * they were created for.
 */
function pullRequestSeeds() {
  const pullRequests = [
    {
      id: "pull-acme-docs-1",
      repositoryId: "repo-acme-docs",
      number: 1,
      title: "Improve onboarding",
      description: "Improve the onboarding documentation for new accounts.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "onboarding-docs",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-onboarding-docs-1",
      createdAt: recentTimestamp(3),
      updatedAt: recentTimestamp(3),
      checks: [],
    },
    // REQ-6-3-1 / REQ-6-3-2: the Open pull requests a visitor reads through the
    // detail view, its Commits and its Files changed views.
    {
      id: "pull-acme-docs-2",
      repositoryId: "repo-acme-docs",
      number: 2,
      title: "Overview onboarding PR",
      description: "Shows the pull request overview, its commits and its changed files.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "overview-docs",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-overview-docs-1",
      createdAt: recentTimestamp(4),
      updatedAt: recentTimestamp(4),
      checks: [],
    },
    {
      id: "pull-acme-docs-3",
      repositoryId: "repo-acme-docs",
      number: 3,
      title: "Public onboarding PR",
      description: "Public pull request whose diff includes src/search.ts.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "public-search",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-public-search-1",
      createdAt: recentTimestamp(4),
      updatedAt: recentTimestamp(4),
      checks: [],
    },
    // REQ-6-3-3: two independent reviewable pull requests, one for a published
    // line comment and one for a pending review comment (no pending review yet).
    {
      id: "pull-acme-docs-4",
      repositoryId: "repo-acme-docs",
      number: 4,
      title: "Reviewable onboarding PR",
      description: "Accept line comments from a non-author reviewer.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "review-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-review-feature-1",
      createdAt: recentTimestamp(3),
      updatedAt: recentTimestamp(3),
      checks: [],
    },
    {
      id: "pull-acme-docs-5",
      repositoryId: "repo-acme-docs",
      number: 5,
      title: "Pending review onboarding PR",
      description: "Accept a pending review comment from a non-author reviewer.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "pending-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-pending-feature-1",
      createdAt: recentTimestamp(3),
      updatedAt: recentTimestamp(3),
      checks: [],
    },
    // REQ-6-2-4: the seeded Draft pull request whose author marks it ready.
    {
      id: "pull-acme-docs-6",
      repositoryId: "repo-acme-docs",
      number: 6,
      title: "Draft onboarding update",
      description: "Draft pull request awaiting review.",
      status: "draft",
      authorName: "draft-author",
      authorAccountId: seedAccountId("draft-author"),
      sourceBranch: "draft-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-draft-feature-1",
      createdAt: recentTimestamp(1),
      updatedAt: recentTimestamp(1),
      checks: [],
      requestedReviewers: [],
    },
    // REQ-6-3-4: the Open proposal a non-author reviewer answers with a
    // `Request changes` review carrying an exact summary.
    {
      id: "pull-acme-docs-7",
      repositoryId: "repo-acme-docs",
      number: 7,
      title: "Change request onboarding PR",
      description: "Accepts a Request changes review from a non-author reviewer.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "change-request-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-change-request-feature-1",
      createdAt: recentTimestamp(3),
      updatedAt: recentTimestamp(3),
      checks: [],
      requestedReviewers: [],
    },
    // REQ-6-4: the author manages the pending reviewer requests of this one.
    {
      id: "pull-acme-docs-8",
      repositoryId: "repo-acme-docs",
      number: 8,
      title: "Reviewer request onboarding PR",
      description: "Lets the author request and remove a pending reviewer.",
      status: "open",
      authorName: "pr-author",
      authorAccountId: seedAccountId("pr-author"),
      sourceBranch: "reviewer-request-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-reviewer-request-feature-1",
      createdAt: recentTimestamp(3),
      updatedAt: recentTimestamp(3),
      checks: [],
      requestedReviewers: [],
    },
    // REQ-6-5: the mergeable proposal carries a valid non-author approval and a
    // successful `test` check of its current compare commit, so protected `main`
    // is satisfied; the blocked proposal lacks the approval.
    {
      id: "pull-acme-docs-9",
      repositoryId: "repo-acme-docs",
      number: 9,
      title: "Mergeable onboarding PR",
      description: "Targets protected main with an approval and a passing check.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "merge-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-merge-feature-1",
      createdAt: recentTimestamp(2),
      updatedAt: recentTimestamp(2),
      checks: [
        {
          name: "test",
          status: "success",
          setter: "org-owner",
          commitId: "commit-repo-acme-docs-merge-feature-1",
        },
      ],
      requestedReviewers: [],
    },
    {
      id: "pull-acme-docs-10",
      repositoryId: "repo-acme-docs",
      number: 10,
      title: "Blocked onboarding PR",
      description: "Targets protected main without the required approval.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "blocked-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-blocked-feature-1",
      createdAt: recentTimestamp(2),
      updatedAt: recentTimestamp(2),
      checks: [
        {
          name: "test",
          status: "success",
          setter: "org-owner",
          commitId: "commit-repo-acme-docs-blocked-feature-1",
        },
      ],
      requestedReviewers: [],
    },
    // REQ-6-6: the author closes and reopens this one; the Read-only viewer
    // reads this one without either control being offered.
    {
      id: "pull-acme-docs-11",
      repositoryId: "repo-acme-docs",
      number: 11,
      title: "Closable onboarding PR",
      description: "Lets the author close and reopen the proposal.",
      status: "open",
      authorName: "pr-author",
      authorAccountId: seedAccountId("pr-author"),
      sourceBranch: "closable-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-closable-feature-1",
      createdAt: recentTimestamp(2),
      updatedAt: recentTimestamp(2),
      checks: [],
      requestedReviewers: [],
    },
    {
      id: "pull-acme-docs-12",
      repositoryId: "repo-acme-docs",
      number: 12,
      title: "Protected onboarding PR",
      description: "Readable by the viewer without close or reopen operations.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "protected-feature",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-protected-feature-1",
      createdAt: recentTimestamp(2),
      updatedAt: recentTimestamp(2),
      checks: [],
      requestedReviewers: [],
    },
    // Seed value: an extra Open proposal sourced from the `feature-search` branch.
    {
      id: "pull-acme-docs-13",
      repositoryId: "repo-acme-docs",
      number: 13,
      title: "Fix search",
      description: "A proposal that refines the search helper.",
      status: "open",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      sourceBranch: "feature-search",
      targetBranch: "main",
      baseCommitId: "commit-repo-acme-docs-2",
      creationCompareCommitId: "commit-repo-acme-docs-feature-search-1",
      createdAt: recentTimestamp(2),
      updatedAt: recentTimestamp(2),
      checks: [],
      requestedReviewers: [],
    },
    {
      id: "pull-branch-protection-demo-1",
      repositoryId: "repo-branch-protection-demo",
      number: 1,
      title: "Protection status onboarding PR",
      description: "Tracks the protection status check of this repository.",
      status: "open",
      authorName: "protection-admin",
      authorAccountId: seedAccountId("protection-admin"),
      sourceBranch: "onboarding-status",
      targetBranch: "main",
      baseCommitId: "commit-repo-branch-protection-demo-main-1",
      creationCompareCommitId: "commit-repo-branch-protection-demo-onboarding-status-1",
      createdAt: recentTimestamp(1),
      updatedAt: recentTimestamp(1),
      checks: [
        {
          name: "test",
          status: "pending",
          setter: null,
          commitId: "commit-repo-branch-protection-demo-onboarding-status-1",
        },
      ],
    },
  ];

  const events = pullRequests.map((pull, index) => ({
    id: `event-${pull.id}-${index + 1}`,
    pullRequestId: pull.id,
    type: "created",
    actorName: pull.authorName,
    actorAccountId: pull.authorAccountId,
    detail: "",
    createdAt: pull.createdAt,
  }));

  // REQ-6-5: the valid non-author approval of the mergeable proposal, anchored
  // to its current compare commit so the protection requirement is satisfied.
  const reviews = [
    {
      id: "review-acme-docs-9-bob-reviewer",
      pullRequestId: "pull-acme-docs-9",
      reviewerName: "bob-reviewer",
      reviewerAccountId: seedAccountId("bob-reviewer"),
      decision: "approved",
      summary: "",
      commitId: "commit-repo-acme-docs-merge-feature-1",
      createdAt: recentTimestamp(1),
      updatedAt: recentTimestamp(1),
    },
  ];

  return { pullRequests, pullRequestEvents: events, pullRequestReviews: reviews };
}

// Web-editor seeds (REQ-4-4): the Write contributor adds files here.
const FILE_MANAGEMENT_README =
  "# file-management-demo\n\nDemonstrates adding a file through the web editor.\n";

// The seeded `acme-docs` history: an older revision plus the readable
// "Document search flow" commit of `alice-dev`. Only `src/README.md` carries
// the searchable phrase, which keeps the code search result for `search flow`
// unambiguous while the browsed file still holds the seeded content.
const ACEME_DOCS_HISTORY = [
  {
    message: INITIAL_COMMIT_MESSAGE,
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
    createdAt: recentTimestamp(5),
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

// The pull-request source branches of `acme-docs` (REQ-6): `feature-search`
// changes `src/search.ts` relative to `main`, `onboarding-docs` documents the
// onboarding flow, so the seeded Open PR never occupies the
// `feature-search` -> `main` pair another scenario compares. The remaining
// branches are the sources of the seeded pull requests of REQ-6-2-4 and
// REQ-6-3; every one sits on the stored `main` head so the comparison reads the
// same revision the PR stores.
const ACEME_DOCS_MAIN_FILES = ACEME_DOCS_HISTORY[ACEME_DOCS_HISTORY.length - 1].files;

/** The `main` snapshot with one file replaced, so the diff is one file. */
function acmeDocsWith(path, content) {
  return ACEME_DOCS_MAIN_FILES.map((file) =>
    file.path === path ? { path, content } : { ...file },
  );
}

const ACEME_DOCS_EXTRA_BRANCHES = [
  {
    name: "feature-search",
    message: "Refine the search result",
    author: "alice-dev",
    createdAt: recentTimestamp(2),
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
    createdAt: recentTimestamp(3),
    parentCommitId: "commit-repo-acme-docs-2",
    files: [
      ...ACEME_DOCS_MAIN_FILES.map((file) => ({ ...file })),
      {
        path: "docs/onboarding.md",
        content: "# Onboarding\n\nWalk new accounts through the first steps.\n",
      },
    ],
  },
  // REQ-6-2-4: the source branch of the seeded Draft pull request.
  {
    name: "draft-feature",
    message: "Draft the onboarding update",
    author: "draft-author",
    createdAt: recentTimestamp(2),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith(
      "README.md",
      `${ACEME_DOCS_README}\nDraft onboarding update.\n`,
    ),
  },
  // REQ-6-3-1: the source branch of the Open PR that shows an overview, its
  // commits and its changed files to a visitor.
  {
    name: "overview-docs",
    message: "Add the overview notes",
    author: "alice-dev",
    createdAt: recentTimestamp(4),
    parentCommitId: "commit-repo-acme-docs-2",
    files: [
      ...ACEME_DOCS_MAIN_FILES.map((file) => ({ ...file })),
      { path: "docs/overview.md", content: "# Overview\n\nHow to read a pull request.\n" },
    ],
  },
  // REQ-6-3-2: the source branch whose diff includes `src/search.ts` with both
  // additions and deletions.
  {
    name: "public-search",
    message: "Refine the public search helper",
    author: "alice-dev",
    createdAt: recentTimestamp(4),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith(
      "src/search.ts",
      "export function search(query: string): string[] {\n  const trimmed = query.trim();\n  return trimmed ? [trimmed] : [];\n}\n",
    ),
  },
  // REQ-6-3-3: two independent reviewable PRs, one for a published line
  // comment and one for a pending review comment.
  {
    name: "review-feature",
    message: "Prepare the reviewable change",
    author: "alice-dev",
    createdAt: recentTimestamp(3),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Reviewed line\n"),
  },
  {
    name: "pending-feature",
    message: "Prepare the pending review change",
    author: "alice-dev",
    createdAt: recentTimestamp(3),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith(
      "src/README.md",
      "Document search flow\n\nPending review target.\n",
    ),
  },
  // REQ-6-3-4: the source branch of the pull request whose reviewer submits a
  // `Request changes` review.
  {
    name: "change-request-feature",
    message: "Propose the change request target",
    author: "alice-dev",
    createdAt: recentTimestamp(3),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Change request target\n"),
  },
  // REQ-6-4: the source branch of the pull request whose author manages the
  // requested reviewers.
  {
    name: "reviewer-request-feature",
    message: "Propose the reviewer request target",
    author: "pr-author",
    createdAt: recentTimestamp(3),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Reviewer request target\n"),
  },
  // REQ-6-5: the source branches of the mergeable and the blocked proposal.
  {
    name: "merge-feature",
    message: "Add the mergeable documentation",
    author: "alice-dev",
    createdAt: recentTimestamp(2),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("README.md", `${ACEME_DOCS_README}\nMergeable onboarding note.\n`),
  },
  {
    name: "blocked-feature",
    message: "Add the blocked documentation",
    author: "alice-dev",
    createdAt: recentTimestamp(2),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Blocked onboarding note\n"),
  },
  // REQ-6-6: the source branches of the closeable and the read-only proposal.
  {
    name: "closable-feature",
    message: "Propose the closeable change",
    author: "pr-author",
    createdAt: recentTimestamp(2),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Closeable change\n"),
  },
  {
    name: "protected-feature",
    message: "Propose the protected change",
    author: "alice-dev",
    createdAt: recentTimestamp(2),
    parentCommitId: "commit-repo-acme-docs-2",
    files: acmeDocsWith("src/index.js", "// Search entry point\n// Protected change\n"),
  },
];

/**
 * Branch plus commit chain of one seeded repository. The commits are stored in
 * chronological order and each commit points at the previous one, so the head
 * commit's file list is the browsable snapshot while a difference is derived
 * from the parent revision.
 */
function seedHistory(repositoryId, history) {
  const commits = history.map((spec, index) => ({
    id: `commit-${repositoryId}-${index + 1}`,
    repositoryId,
    branch: "main",
    message: spec.message,
    authorName: spec.author,
    authorAccountId: seedAccountId(spec.author),
    createdAt: spec.createdAt,
    parentCommitId: index === 0 ? null : `commit-${repositoryId}-${index}`,
    files: spec.files.map((file) => ({ ...file })),
  }));
  return {
    branches: [
      {
        id: `branch-${repositoryId}-main`,
        repositoryId,
        name: "main",
        headCommitId: commits[commits.length - 1].id,
        createdAt: history[0].createdAt,
      },
    ],
    commits,
  };
}

/**
 * Several branches of one seeded repository. Every branch stores its own named
 * reference and commit chain; a commit may name another branch's commit as its
 * parent, which is how a target branch is pre-provisioned on top of `main`
 * without copying files or rewriting the base history.
 */
function seedBranchSet(repositoryId, specs) {
  const idOf = (branchName, index) => `commit-${repositoryId}-${branchName}-${index + 1}`;
  const commits = [];
  const branches = [];
  for (const spec of specs) {
    spec.commits.forEach((commit, index) => {
      const parent = commit.parent === undefined
        ? index === 0
          ? null
          : { branch: spec.name, index: index - 1 }
        : commit.parent;
      commits.push({
        id: idOf(spec.name, index),
        repositoryId,
        branch: spec.name,
        message: commit.message,
        authorName: commit.author,
        authorAccountId: seedAccountId(commit.author),
        createdAt: commit.createdAt,
        parentCommitId: parent ? idOf(parent.branch, parent.index) : null,
        files: commit.files.map((file) => ({ ...file })),
      });
    });
    branches.push({
      id: `branch-${repositoryId}-${spec.name}`,
      repositoryId,
      name: spec.name,
      headCommitId: idOf(spec.name, spec.commits.length - 1),
      createdAt: spec.commits[0].createdAt,
    });
  }
  return { branches, commits };
}

// Issue-management seeds (REQ-5): the classification names of `acme-docs` plus
// the work items every read-only and mutation scenario starts from. Their
// numbers are stable because they are scoped to the repository, not to the
// store.
const ISSUE_LABELS = [
  { id: "label-acme-docs-bug", repositoryId: "repo-acme-docs", name: "bug", color: "#d73a4a" },
  { id: "label-acme-docs-documentation", repositoryId: "repo-acme-docs", name: "documentation", color: "#0075ca" },
];

const ISSUE_MILESTONES = [
  { id: "milestone-acme-docs-v1", repositoryId: "repo-acme-docs", name: "v1.0" },
];

/**
 * One seeded issue and its append-only timeline. `events` are stored in
 * chronological order; a comment adds a discussion record and the matching
 * `commented` event in one step.
 */
function seedIssue(spec, author, createdAt) {
  const id = `issue-acme-docs-${spec.number}`;
  return {
    id,
    repositoryId: "repo-acme-docs",
    number: spec.number,
    title: spec.title,
    description: spec.description ?? "",
    status: spec.status ?? "open",
    authorName: author,
    authorAccountId: seedAccountId(author),
    labelIds: spec.labelIds ?? [],
    assigneeIds: [],
    milestoneId: null,
    createdAt,
    updatedAt: createdAt,
    _events: [{ type: "created", actor: author, createdAt }],
  };
}

function issueSeeds() {
  const issues = [
    seedIssue(
      {
        number: 1,
        title: "Improve onboarding",
        description: "Describe the onboarding improvement.",
        labelIds: ["label-acme-docs-documentation"],
      },
      "alice-dev",
      recentTimestamp(6),
    ),
    seedIssue(
      {
        number: 2,
        title: "Legacy welcome text",
        description: "The imported welcome text is out of date.",
        status: "closed",
      },
      "org-owner",
      recentTimestamp(9),
    ),
    seedIssue(
      { number: 3, title: "Commentable onboarding issue", description: "Tracks a discussion added later." },
      "alice-dev",
      recentTimestamp(4),
    ),
    seedIssue(
      { number: 4, title: "Comment validation issue", description: "Tracks empty comment validation." },
      "alice-dev",
      recentTimestamp(3),
    ),
    // REQ-5-2-2 / REQ-5-3-1..3: one isolated work item per mutation scenario so
    // no scenario can change the initial state of another. They carry no
    // assignee, label or milestone until the scenario selects one.
    seedIssue(
      {
        number: 5,
        title: "Editable onboarding issue",
        description: "Tracks editing the onboarding issue title and description.",
      },
      "issue-editor",
      recentTimestamp(2),
    ),
    seedIssue(
      { number: 6, title: "Original issue title", description: "Tracks the rejected empty-title edit." },
      "issue-editor",
      recentTimestamp(2),
    ),
    seedIssue(
      {
        number: 7,
        title: "Assignable onboarding issue",
        description: "Tracks assigning a participant to the onboarding work.",
      },
      "issue-editor",
      recentTimestamp(2),
    ),
    seedIssue(
      { number: 8, title: "Labelable onboarding issue", description: "Tracks applying a repository label." },
      "issue-editor",
      recentTimestamp(2),
    ),
    seedIssue(
      { number: 9, title: "Milestone onboarding issue", description: "Tracks setting a repository milestone." },
      "issue-editor",
      recentTimestamp(2),
    ),
    // REQ-5-4: one isolated Open work item for the close/reopen transition and
    // one read-only work item the viewer scenario opens without any control.
    seedIssue(
      { number: 10, title: "Closable onboarding issue", description: "Tracks closing and reopening the onboarding issue." },
      "issue-editor",
      recentTimestamp(2),
    ),
    seedIssue(
      { number: 11, title: "Protected onboarding issue", description: "Tracks the read-only view of the onboarding issue." },
      "issue-editor",
      recentTimestamp(2),
    ),
  ];

  const comments = [
    {
      id: "comment-acme-docs-1",
      issueId: "issue-acme-docs-1",
      authorName: "alice-dev",
      authorAccountId: seedAccountId("alice-dev"),
      body: "The first run should be gentler for new accounts.",
      createdAt: recentTimestamp(5),
    },
  ];
  issues[0]._events.push({
    type: "commented",
    actor: "alice-dev",
    createdAt: recentTimestamp(5),
  });

  const events = [];
  for (const issue of issues) {
    for (const spec of issue._events) {
      events.push({
        id: `event-${issue.id}-${events.length + 1}`,
        issueId: issue.id,
        type: spec.type,
        actorName: spec.actor,
        actorAccountId: seedAccountId(spec.actor),
        createdAt: spec.createdAt,
      });
    }
    delete issue._events;
  }

  return { issues, comments, events };
}

/**
 * The three work items of the reaction repository (REQ-5-5), one per scenario,
 * so no scenario can change the initial state of another: `-s1` and `-s2` start
 * without any reaction, while `-s3` already carries one `+1` reaction of
 * `evo-reaction-author`, which is the count an unauthenticated visitor reads.
 * The author is the same account in every case, so the count never depends on
 * the account a scenario signs in with. The title, description, status and
 * classification are stored once and read by every scenario.
 */
function reactionIssueSeeds() {
  const issues = [
    { number: 1, title: "Evo reaction issue s1", description: "Tracks adding a reaction that survives a reload." },
    { number: 2, title: "Evo reaction issue s2", description: "Tracks adding and then removing the same reaction." },
    { number: 3, title: "Evo reaction issue s3", description: "Shows an existing reaction count to a visitor." },
  ].map((spec, index) => ({
    id: `issue-evo-reaction-${spec.number}`,
    repositoryId: EVO_REACTION_REPOSITORY_ID,
    number: spec.number,
    title: spec.title,
    description: spec.description,
    status: "open",
    authorName: EVO_REACTION_OWNER,
    authorAccountId: seedAccountId(EVO_REACTION_OWNER),
    labelIds: [],
    assigneeIds: [],
    milestoneId: null,
    createdAt: recentTimestamp(6 - index),
    updatedAt: recentTimestamp(6 - index),
  }));
  const events = issues.map((issue) => ({
    id: `event-${issue.id}-1`,
    issueId: issue.id,
    type: "created",
    actorName: EVO_REACTION_OWNER,
    actorAccountId: seedAccountId(EVO_REACTION_OWNER),
    detail: "",
    createdAt: issue.createdAt,
  }));
  // The stored reaction the `-s3` scenario reads before it signs in; only the
  // `-s1`/`-s2` scenarios add a further one, and each keeps its own issue.
  const reactions = [
    {
      id: "reaction-evo-reaction-s3-1",
      issueId: "issue-evo-reaction-3",
      type: "+1",
      accountName: EVO_REACTION_OWNER,
      accountId: seedAccountId(EVO_REACTION_OWNER),
      createdAt: recentTimestamp(1),
    },
  ];
  return { issues, events, reactions };
}

function seedRepository(spec) {
  return {
    id: spec.id,
    ownerType: spec.ownerType,
    ownerId: spec.ownerId,
    name: spec.name,
    description: spec.description,
    visibility: spec.visibility,
    // REQ-3-5: an archived repository starts with the stored flag, so the
    // overview, the lists and every write check read the same persisted state.
    archived: spec.archived === true,
    defaultBranch: spec.defaultBranch ?? "main",
    forkOfRepositoryId: spec.forkOfRepositoryId ?? null,
    creatorAccountId: spec.creatorAccountId ?? null,
    createdAt: EPOCH,
    updatedAt: spec.updatedAt,
  };
}

export function createSeedState() {
  const createdAt = EPOCH;
  const { issues, comments: issueComments, events: issueEvents } = issueSeeds();
  const reactionSeeds = reactionIssueSeeds();
  const organization = SEED_ORGANIZATION.id;
  const membership = (username, role) => ({ organizationId: organization, accountId: seedAccountId(username), role });
  const team = (name, parent, id) => ({
    id,
    organizationId: organization,
    name,
    parentTeamId: parent,
    createdAt,
  });

  const repositorySpecs = [
    // REQ-2-4: the organization repository the seeded `Repository created`
    // audit event refers to. It stays private, so the organization stays out of
    // the visitor-facing organization discovery.
    {
      spec: {
        id: "repo-evo-audit-demo",
        ownerType: "organization",
        ownerId: EVO_AUDIT_ORGANIZATION.id,
        name: EVO_AUDIT_REPOSITORY,
        description: "Records the organization actions of the audit log.",
        visibility: "private",
        updatedAt: recentTimestamp(4),
      },
      history: singleHistory(
        [{ path: "README.md", content: "# audit-demo\n\nRepository recorded by the organization audit log.\n" }],
        "evo-audit-owner",
        recentTimestamp(4),
      ),
    },
    {
      spec: {
        id: "repo-acme-docs",
        ownerType: "organization",
        ownerId: organization,
        name: "acme-docs",
        description: "Documentation for the Acme Demo organization.",
        visibility: "public",
        updatedAt: recentTimestamp(5),
      },
      history: ACEME_DOCS_HISTORY,
    },
    {
      spec: {
        id: "repo-secret-research",
        ownerType: "organization",
        ownerId: organization,
        name: "secret-research",
        description: "Internal research notes.",
        visibility: "private",
        updatedAt: "2024-06-15T09:30:00.000Z",
      },
      history: singleHistory(SEED_FILES.secretResearch, "org-owner", "2024-06-15T09:30:00.000Z"),
    },
    {
      spec: {
        id: "repo-visibility-demo",
        ownerType: "organization",
        ownerId: organization,
        name: "visibility-demo",
        description: "Demonstrates repository visibility and permission checks.",
        visibility: "private",
        updatedAt: "2024-07-10T12:00:00.000Z",
      },
      history: singleHistory(SEED_FILES.visibilityDemo, "visibility-admin", "2024-07-10T12:00:00.000Z"),
    },
    // Personal namespace of `repo-owner`: the existing repository used for the
    // duplicate-name validation of REQ-3-2-1. It stays private so it can never
    // collide with the organization's public `acme-docs` in visitor search.
    {
      spec: {
        id: "repo-repo-owner-acme-docs",
        ownerType: "account",
        ownerId: seedAccountId("repo-owner"),
        name: "acme-docs",
        description: "Existing personal repository used for duplicate-name validation.",
        visibility: "private",
        creatorAccountId: seedAccountId("repo-owner"),
        updatedAt: "2024-08-01T08:00:00.000Z",
      },
      history: singleHistory(SEED_FILES.personalAcmeDocs, "repo-owner", "2024-08-01T08:00:00.000Z"),
    },
    // Personal namespace of `fork-user`: the existing fork name used by the
    // REQ-3-2-2 conflict scenario. It is also private, so the visitor search for
    // `acme-docs` still has exactly one public match.
    {
      spec: {
        id: "repo-fork-user-acme-docs-fork",
        ownerType: "account",
        ownerId: seedAccountId("fork-user"),
        name: "acme-docs-fork",
        description: "A fork of acme-docs.",
        visibility: "private",
        forkOfRepositoryId: "repo-acme-docs",
        creatorAccountId: seedAccountId("fork-user"),
        updatedAt: "2024-08-02T08:00:00.000Z",
      },
      history: ACEME_DOCS_HISTORY,
    },
    // REQ-4-3-1 / REQ-4-3-2: public repository with two branches and a
    // target-only file, plus the Write contributor who creates branches on it.
    {
      spec: {
        id: "repo-branch-switch-demo",
        ownerType: "organization",
        ownerId: organization,
        name: "branch-switch-demo",
        description: "Demonstrates listing and switching repository branches.",
        visibility: "public",
        updatedAt: recentTimestamp(3),
      },
      branchSet: BRANCH_SWITCH_SET,
    },
    // REQ-4-3-3: public repository whose default branch an administrator moves
    // from `main` to `release`.
    {
      spec: {
        id: "repo-default-branch-demo",
        ownerType: "organization",
        ownerId: organization,
        name: "default-branch-demo",
        description: "Demonstrates changing the repository default branch.",
        visibility: "public",
        updatedAt: recentTimestamp(2),
      },
      branchSet: DEFAULT_BRANCH_SET,
    },
    // REQ-6-1: public repository whose `main` branch is protected and whose
    // Open PR carries the `test` status check.
    {
      spec: {
        id: "repo-branch-protection-demo",
        ownerType: "organization",
        ownerId: organization,
        name: "branch-protection-demo",
        description: "Demonstrates branch protection rules and pull request checks.",
        visibility: "public",
        updatedAt: recentTimestamp(1),
      },
      branchSet: BRANCH_PROTECTION_SET,
    },
    // REQ-4-4: public repository the Write contributor adds files to.
    {
      spec: {
        id: "repo-file-management-demo",
        ownerType: "organization",
        ownerId: organization,
        name: "file-management-demo",
        description: "Demonstrates adding a file through the web editor.",
        visibility: "public",
        updatedAt: recentTimestamp(4),
      },
      history: singleHistory(
        [{ path: "README.md", content: FILE_MANAGEMENT_README }],
        "org-owner",
        recentTimestamp(4),
      ),
    },
    // REQ-3-1 (evolution): the public repositories the global search locates.
    // `evo-search-catalog-s1` is found by its own name (case-insensitively) and
    // `evo-search-notebook-s2` by the description term `evolution-notebook`;
    // both are personal repositories, so no organization joins the visitor
    // discovery besides `acme-demo`.
    {
      spec: {
        id: "repo-evo-search-catalog-s1",
        ownerType: "account",
        ownerId: seedAccountId(EVO_SEARCH_OWNER),
        name: "evo-search-catalog-s1",
        description: "Catalog used to locate a repository by its name.",
        visibility: "public",
        creatorAccountId: seedAccountId(EVO_SEARCH_OWNER),
        updatedAt: recentTimestamp(7),
      },
      history: singleHistory(SEED_FILES.evoSearchCatalog, EVO_SEARCH_OWNER, recentTimestamp(7)),
    },
    {
      spec: {
        id: "repo-evo-search-notebook-s2",
        ownerType: "account",
        ownerId: seedAccountId(EVO_SEARCH_OWNER),
        name: "evo-search-notebook-s2",
        description: "Repository holding the evolution-notebook experiment notes.",
        visibility: "public",
        creatorAccountId: seedAccountId(EVO_SEARCH_OWNER),
        updatedAt: recentTimestamp(7),
      },
      history: singleHistory(SEED_FILES.evoSearchNotebook, EVO_SEARCH_OWNER, recentTimestamp(7)),
    },
    // REQ-3-5 (evolution): the archive scenarios. `-s1` starts Active and is
    // archived by its administrator, while `-s2` and `-s3` are already Archived
    // with a stored `README.md`, so an archived repository stays readable and
    // every write check refuses the change for every account.
    {
      spec: {
        id: "repo-evo-archive-s1",
        ownerType: "account",
        ownerId: seedAccountId(EVO_ARCHIVE_OWNER),
        name: "evo-archive-repository-s1",
        description: "Repository the administrator archives from its settings.",
        visibility: "public",
        creatorAccountId: seedAccountId(EVO_ARCHIVE_OWNER),
        updatedAt: recentTimestamp(6),
      },
      history: singleHistory(SEED_FILES.evoArchive, EVO_ARCHIVE_OWNER, recentTimestamp(6)),
    },
    {
      spec: {
        id: "repo-evo-archive-s2",
        ownerType: "account",
        ownerId: seedAccountId(EVO_ARCHIVE_OWNER),
        name: "evo-archive-repository-s2",
        description: "Repository that stays readable after archiving.",
        visibility: "public",
        archived: true,
        creatorAccountId: seedAccountId(EVO_ARCHIVE_OWNER),
        updatedAt: recentTimestamp(5),
      },
      history: singleHistory(SEED_FILES.evoArchive, EVO_ARCHIVE_OWNER, recentTimestamp(5)),
    },
    {
      spec: {
        id: "repo-evo-archive-s3",
        ownerType: "account",
        ownerId: seedAccountId(EVO_ARCHIVE_OWNER),
        name: "evo-archive-repository-s3",
        description: "Repository the administrator restores from its settings.",
        visibility: "public",
        archived: true,
        creatorAccountId: seedAccountId(EVO_ARCHIVE_OWNER),
        updatedAt: recentTimestamp(4),
      },
      history: singleHistory(SEED_FILES.evoArchive, EVO_ARCHIVE_OWNER, recentTimestamp(4)),
    },
    // REQ-4-3-1 (evolution): three public personal repositories the branch
    // selector scenarios open without signing in. Each one opens on its own
    // active branch and carries a target branch; the target-only files of `-s1`
    // and `-s3` appear only after the selector switches.
    {
      spec: {
        id: "repo-evo-branch-switch-s1",
        ownerType: "account",
        ownerId: seedAccountId(EVO_BRANCH_SWITCH_OWNER),
        name: "evo-branch-switch-s1",
        description: "Active branch and target branch of the first switch scenario.",
        visibility: "public",
        defaultBranch: "evo-main-s1",
        creatorAccountId: seedAccountId(EVO_BRANCH_SWITCH_OWNER),
        updatedAt: recentTimestamp(3),
      },
      branchSet: EVO_BRANCH_SWITCH_S1,
    },
    {
      spec: {
        id: "repo-evo-branch-switch-s2",
        ownerType: "account",
        ownerId: seedAccountId(EVO_BRANCH_SWITCH_OWNER),
        name: "evo-branch-switch-s2",
        description: "Active branch kept across an unmatched branch query.",
        visibility: "public",
        defaultBranch: "evo-main-s2",
        creatorAccountId: seedAccountId(EVO_BRANCH_SWITCH_OWNER),
        updatedAt: recentTimestamp(3),
      },
      branchSet: EVO_BRANCH_SWITCH_S2,
    },
    {
      spec: {
        id: "repo-evo-branch-switch-s3",
        ownerType: "account",
        ownerId: seedAccountId(EVO_BRANCH_SWITCH_OWNER),
        name: "evo-branch-switch-s3",
        description: "Selected branch restored from the page address.",
        visibility: "public",
        defaultBranch: "evo-main-s3",
        creatorAccountId: seedAccountId(EVO_BRANCH_SWITCH_OWNER),
        updatedAt: recentTimestamp(3),
      },
      branchSet: EVO_BRANCH_SWITCH_S3,
    },
    // REQ-4-5 (evolution): the public personal repositories the release
    // scenarios read and publish into. `evo-release-owner` owns them, which is
    // the write permission the release scenarios rely on; `-s2` and `-s3` store
    // the published tags that the read and duplicate-tag scenarios use.
    {
      spec: {
        id: "repo-evo-release-s1",
        ownerType: "account",
        ownerId: seedAccountId(EVO_RELEASE_OWNER),
        name: "evo-release-repository-s1",
        description: "Publishes the first evolution release.",
        visibility: "public",
        defaultBranch: "evo-main-s1",
        creatorAccountId: seedAccountId(EVO_RELEASE_OWNER),
        updatedAt: recentTimestamp(6),
      },
      branchSet: EVO_RELEASE_BRANCHES.s1,
    },
    {
      spec: {
        id: "repo-evo-release-s2",
        ownerType: "account",
        ownerId: seedAccountId(EVO_RELEASE_OWNER),
        name: "evo-release-repository-s2",
        description: "Holds the published release a visitor reads.",
        visibility: "public",
        defaultBranch: "evo-main-s2",
        creatorAccountId: seedAccountId(EVO_RELEASE_OWNER),
        updatedAt: recentTimestamp(6),
      },
      branchSet: EVO_RELEASE_BRANCHES.s2,
    },
    {
      spec: {
        id: "repo-evo-release-s3",
        ownerType: "account",
        ownerId: seedAccountId(EVO_RELEASE_OWNER),
        name: "evo-release-repository-s3",
        description: "Holds the existing tag a second publish reuses.",
        visibility: "public",
        defaultBranch: "evo-main-s3",
        creatorAccountId: seedAccountId(EVO_RELEASE_OWNER),
        updatedAt: recentTimestamp(6),
      },
      branchSet: EVO_RELEASE_BRANCHES.s3,
    },
    // REQ-5-5 (evolution): the public personal repository the reaction
    // scenarios open. It is public, so an unauthenticated visitor reads its
    // issues and their counts; each work item keeps its own reaction state.
    {
      spec: {
        id: EVO_REACTION_REPOSITORY_ID,
        ownerType: "account",
        ownerId: seedAccountId(EVO_REACTION_OWNER),
        name: EVO_REACTION_REPOSITORY_NAME,
        description: "Holds the evolution reaction scenarios.",
        visibility: "public",
        creatorAccountId: seedAccountId(EVO_REACTION_OWNER),
        updatedAt: recentTimestamp(6),
      },
      history: singleHistory(SEED_FILES.evoReaction, EVO_REACTION_OWNER, recentTimestamp(6)),
    },
  ];
  const repositories = [];
  const branches = [];
  const commits = [];
  for (const entry of repositorySpecs) {
    const set = entry.branchSet
      ? seedBranchSet(entry.spec.id, entry.branchSet)
      : seedHistory(entry.spec.id, entry.history);
    repositories.push(seedRepository(entry.spec));
    branches.push(...set.branches);
    commits.push(...set.commits);
  }
  // The pull-request source branches of `acme-docs` sit on top of its `main`
  // head, so the comparison and the seeded PR read the same stored revision.
  const acmeBranches = seedExtraBranches("repo-acme-docs", ACEME_DOCS_EXTRA_BRANCHES);
  branches.push(...acmeBranches.branches);
  commits.push(...acmeBranches.commits);

  const { pullRequests, pullRequestEvents, pullRequestReviews } = pullRequestSeeds();

  return {
    organizations: [
      { ...SEED_ORGANIZATION, createdAt },
      { ...EVO_LAB_DUPLICATE_ORGANIZATION, createdAt },
      { ...EVO_AUDIT_ORGANIZATION, createdAt },
    ],
    memberships: [
      membership("org-owner", "Owner"),
      membership("team-maintainer", "Owner"),
      membership("bob-reviewer", "Member"),
      membership("existing-member", "Member"),
      membership("org-member", "Member"),
      membership("protected-member", "Member"),
      // REQ-2-1-2 / REQ-2-4 (evolution): the existing organization of the
      // account that submits an uppercase duplicate, the Owner that may open
      // the audit log, and the ordinary Member that may only view the
      // organization.
      {
        organizationId: EVO_LAB_DUPLICATE_ORGANIZATION.id,
        accountId: seedAccountId("evo-org-owner"),
        role: "Owner",
      },
      {
        organizationId: EVO_AUDIT_ORGANIZATION.id,
        accountId: seedAccountId("evo-audit-owner"),
        role: "Owner",
      },
      {
        organizationId: EVO_AUDIT_ORGANIZATION.id,
        accountId: seedAccountId("evo-audit-viewer"),
        role: "Member",
      },
    ],
    teams: [
      team("platform-team", null, "team-platform-team"),
      team("frontend-team", "team-platform-team", "team-frontend-team"),
      team("frontend-child", "team-frontend-team", "team-frontend-child"),
      team("access-role-team", null, "team-access-role-team"),
      {
        id: "team-evo-audit-team",
        organizationId: EVO_AUDIT_ORGANIZATION.id,
        name: "audit-team",
        parentTeamId: null,
        createdAt,
      },
    ],
    teamMembers: [],
    repositories,
    branches,
    commits,
    labels: ISSUE_LABELS,
    milestones: ISSUE_MILESTONES,
    issues: [...issues, ...reactionSeeds.issues],
    issueComments,
    issueEvents: [...issueEvents, ...reactionSeeds.events],
    // REQ-5-5 (evolution): the pre-existing reaction of one work item, keyed to
    // the issue and the reacting account.
    issueReactions: reactionSeeds.reactions,
    pullRequests,
    pullRequestComments: [],
    pullRequestEvents,
    pullRequestReviews,
    // REQ-4-5 (evolution): the published releases the read-only and
    // duplicate-tag scenarios start from. The tag is unique inside the
    // repository that holds it, so the same tag name may recur across them.
    releases: RELEASE_SEEDS.map((release) => ({ ...release })),
    // The protected `main` of `acme-docs` (REQ-6-5): the mergeable proposal
    // satisfies 1 approval plus the successful `test` check, the blocked one
    // lacks the approval. `branch-protection-demo` stays rule-free because the
    // REQ-6-1 scenario creates its own rule.
    // REQ-2-4: the persisted organization actions of `evo-audit-org`, holding
    // at least one `Member added` and one `Repository created` entry. Every
    // later organization action of any organization appends to this collection.
    auditEvents: [
      {
        id: "audit-evo-audit-org-1",
        organizationId: EVO_AUDIT_ORGANIZATION.id,
        actorName: "evo-audit-owner",
        action: "Organization created",
        target: EVO_AUDIT_ORGANIZATION.id,
        createdAt: recentTimestamp(6),
      },
      {
        id: "audit-evo-audit-org-2",
        organizationId: EVO_AUDIT_ORGANIZATION.id,
        actorName: "evo-audit-owner",
        action: "Team created",
        target: "audit-team",
        createdAt: recentTimestamp(5),
      },
      {
        id: "audit-evo-audit-org-3",
        organizationId: EVO_AUDIT_ORGANIZATION.id,
        actorName: "evo-audit-owner",
        action: "Repository created",
        target: EVO_AUDIT_REPOSITORY,
        createdAt: recentTimestamp(4),
      },
      {
        id: "audit-evo-audit-org-4",
        organizationId: EVO_AUDIT_ORGANIZATION.id,
        actorName: "evo-audit-owner",
        action: "Member added",
        target: "evo-audit-viewer",
        createdAt: recentTimestamp(3),
      },
    ],
    branchProtectionRules: [
      {
        id: "protection-acme-docs-main",
        repositoryId: "repo-acme-docs",
        branchName: "main",
        requireApprovals: true,
        requireStatusCheck: true,
        statusCheckName: "test",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    accessGrants: [
      {
        id: "grant-access-role-team",
        repositoryId: "repo-acme-docs",
        subjectType: "team",
        subjectId: "team-access-role-team",
        role: "Write",
      },
      {
        id: "grant-repo-admin",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("repo-admin"),
        role: "Admin",
      },
      {
        id: "grant-visibility-admin",
        repositoryId: "repo-visibility-demo",
        subjectType: "account",
        subjectId: seedAccountId("visibility-admin"),
        role: "Admin",
      },
      {
        id: "grant-visibility-collaborator",
        repositoryId: "repo-visibility-demo",
        subjectType: "account",
        subjectId: seedAccountId("collaborator"),
        role: "Read",
      },
      // REQ-4-3-2 / REQ-4-4 / REQ-4-3-3: the write permissions the branch and
      // file scenarios rely on. `default-branch-viewer` deliberately holds no
      // grant, so it can read the public repository but not administer it.
      {
        id: "grant-branch-contributor",
        repositoryId: "repo-branch-switch-demo",
        subjectType: "account",
        subjectId: seedAccountId("branch-contributor"),
        role: "Write",
      },
      {
        id: "grant-file-contributor",
        repositoryId: "repo-file-management-demo",
        subjectType: "account",
        subjectId: seedAccountId("file-contributor"),
        role: "Write",
      },
      {
        id: "grant-default-branch-admin",
        repositoryId: "repo-default-branch-demo",
        subjectType: "account",
        subjectId: seedAccountId("default-branch-admin"),
        role: "Admin",
      },
      // REQ-5-2-1 / REQ-5-2-3: the issue author and commenter hold Write on the
      // public `acme-docs`, which is the operation-specific grant for creating
      // issues and commenting (not an implicit step on a role ladder).
      {
        id: "grant-issue-author",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("issue-author"),
        role: "Write",
      },
      {
        id: "grant-issue-commenter",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("issue-commenter"),
        role: "Write",
      },
      // REQ-5-2-2 / REQ-5-3: Maintain covers the content edits (Write,
      // Maintain, Admin) and the metadata operations (Triage, Maintain, Admin)
      // of the issue-editor account without making it an organization member.
      {
        id: "grant-issue-editor",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("issue-editor"),
        role: "Maintain",
      },
      // REQ-5-4: the viewer holds only Read on the public `acme-docs`, so the
      // issue status stays visible while neither transition control is offered.
      {
        id: "grant-issue-viewer",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("issue-viewer"),
        role: "Read",
      },
      // REQ-6: the PR contributor writes on `acme-docs`; the protection Admin
      // administers `branch-protection-demo`; `protection-viewer` deliberately
      // holds no grant, so the public repository stays readable to it while the
      // `Add branch protection rule` control is not offered.
      {
        id: "grant-pr-contributor",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("pr-contributor"),
        role: "Write",
      },
      // REQ-6-2-4 / REQ-6-3-3: the draft author and the non-author reviewer hold
      // Write on `acme-docs`, the operation-specific permission to review and to
      // author the seeded draft proposal.
      {
        id: "grant-draft-author",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("draft-author"),
        role: "Write",
      },
      {
        id: "grant-pr-reviewer",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("pr-reviewer"),
        role: "Write",
      },
      // REQ-6-5 / REQ-6-6: the mergeable approval belongs to `bob-reviewer`,
      // who holds the review write rule; `pr-author` authors and closes its
      // proposals; `pr-maintainer` holds the merge rule; `pr-viewer` may only
      // read, so neither the close nor the merge control is offered to it.
      {
        id: "grant-bob-reviewer",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("bob-reviewer"),
        role: "Write",
      },
      {
        id: "grant-pr-author",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("pr-author"),
        role: "Write",
      },
      {
        id: "grant-pr-maintainer",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("pr-maintainer"),
        role: "Maintain",
      },
      {
        id: "grant-pr-viewer",
        repositoryId: "repo-acme-docs",
        subjectType: "account",
        subjectId: seedAccountId("pr-viewer"),
        role: "Read",
      },
      {
        id: "grant-protection-admin",
        repositoryId: "repo-branch-protection-demo",
        subjectType: "account",
        subjectId: seedAccountId("protection-admin"),
        role: "Admin",
      },
    ],
  };
}

/**
 * Stable identity of one stored record inside its collection. Entities that
 * carry an `id` are identified by it; the membership rows that carry none are
 * identified by the relationship the requirement states (organization or team
 * plus account), so a repeated upgrade can never duplicate them.
 */
const IDENTITY_KEYS = {
  memberships: (record) => `${record.organizationId}:${record.accountId}`,
  teamMembers: (record) => `${record.teamId}:${record.accountId}`,
};

function identityOf(collection, record) {
  const identity = IDENTITY_KEYS[collection];
  if (identity) return identity(record);
  if (record && typeof record.id === "string") return record.id;
  return JSON.stringify(record);
}

/**
 * Seed generation stamped into the stored state. The merge below runs once per
 * stored file: a record the user removed afterwards (say an organization
 * membership) is never resurrected by a later start, while a file written by an
 * earlier generation still receives the predefined records it lacks.
 */
export const SEED_GENERATION = 5;

/**
 * Idempotent, merge-only seed upgrade: every predefined record the stored state
 * does not hold yet is appended under its stable identity, while the stored
 * records (including later user changes such as a changed role or a renamed
 * display name) stay untouched. It runs for an existing file too, so a store
 * written by an earlier version still receives the records this version adds,
 * and repeating the upgrade never duplicates a record.
 */
export function upgradeSeedState(state) {
  if (Number(state.seedGeneration ?? 0) >= SEED_GENERATION) return state;
  const seeds = createSeedState();
  for (const [collection, records] of Object.entries(seeds)) {
    if (!Array.isArray(state[collection])) state[collection] = [];
    const present = new Set(state[collection].map((record) => identityOf(collection, record)));
    for (const record of records) {
      const identity = identityOf(collection, record);
      if (present.has(identity)) continue;
      state[collection].push(structuredClone(record));
      present.add(identity);
    }
  }
  state.seedGeneration = SEED_GENERATION;
  return state;
}
