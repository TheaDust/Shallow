// The shared pull-request fixture of the component tests: the public
// repository `acme-docs` with the branches, the commit graph and the stored
// pull requests the requirement names. The values mirror the backend seed
// (`seed-code.mjs` and `seed-pull-requests.mjs`).

import type { StubOrganization } from "./auth-stub";
import type { StubCommit } from "./repository-stub";

export const PULL_OWNER = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

export const PULL_REVIEWER = {
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  password: "Valid-password-123!",
};

/** The Maintain account the merge requirements supply. */
export const PULL_MAINTAINER = {
  username: "carol-maintainer",
  email: "carol.maintainer@example.test",
  password: "Valid-password-123!",
};

export const PULLS_ADDRESS = "#/repositories/acme-demo/acme-docs/pulls";
/** The mergeable seeded pull request and the blocked one of the same target. */
export const MERGEABLE_PULL_NUMBER = 6;
export const BLOCKED_PULL_NUMBER = 7;
export const MERGEABLE_PULL_ADDRESS = `${PULLS_ADDRESS}/${MERGEABLE_PULL_NUMBER}`;
export const BLOCKED_PULL_ADDRESS = `${PULLS_ADDRESS}/${BLOCKED_PULL_NUMBER}`;

const README_WITH_SEARCH = [
  "# Acme Docs",
  "",
  "Documentation for the Acme Demo platform.",
  "",
  "The search flow starts in the search box at the top of every page.",
  "",
].join("\n");

const GETTING_STARTED_INITIAL =
  "# Getting started\n\nInstall the Acme Demo CLI and sign in.\n\nOpen the docs from the repository list.\n";

const GETTING_STARTED =
  "# Getting started\n\nInstall the Acme Demo CLI and sign in.\n\nOpen the docs from the Code page.\n";

const README_PROTOTYPE = [
  "# Acme Docs",
  "",
  "Draft documentation for the search prototype.",
  "",
  "The search flow of this prototype is still being written.",
  "",
].join("\n");

const MAIN_ONLY = [
  "# Prototype notes",
  "",
  "This file only exists on the feature-search branch.",
  "",
].join("\n");

const SEARCH_SOURCE = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  return query.trim().length === 0 ? [] : [query.trim()];",
  "}",
  "",
].join("\n");

const SEARCH_GUIDE =
  "# Searching\n\nType a repository name in the top search box and press Enter.\n";

const RELEASE_NOTES = "# Release 1.0\n";

// The release revision refreshes the search source, so the recorded pull
// request `Improve onboarding` really shows the modified file `src/search.ts`
// next to exactly one added file.
const RELEASE_SEARCH_SOURCE = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  const trimmed = query.trim();",
  "  return trimmed.length === 0 ? [] : [trimmed];",
  "}",
  "",
].join("\n");

// The revision of the mergeable pull request: it refreshes the search source
// and adds exactly one file, so the merge really integrates new content.
const FIXES_SEARCH_SOURCE = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  const fixed = query.trim();",
  "  return fixed.length === 0 ? [] : [fixed];",
  "}",
  "",
].join("\n");

const MATCHING_SOURCE = "export const matches = true;\n";

// The revision of the blocked pull request of the same protected target.
const POLISH_SEARCH_SOURCE = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  const polished = query.trim();",
  "  return polished.length === 0 ? [] : [polished];",
  "}",
  "",
].join("\n");

const LAYOUT_NOTES = "# Layout\n";

const MAIN_FILES = [
  { path: "README.md", content: README_WITH_SEARCH },
  { path: "docs/getting-started.md", content: GETTING_STARTED },
  { path: "docs/search.md", content: SEARCH_GUIDE },
  { path: "src/search.ts", content: SEARCH_SOURCE },
];

export const PULL_COMMITS: StubCommit[] = [
  {
    sha: "a1b2c3d",
    message: "Initial commit",
    author: "alice-dev",
    createdAt: "2024-01-02T00:00:00.000Z",
    parentSha: null,
    files: [{ path: "docs/getting-started.md", content: GETTING_STARTED_INITIAL }],
  },
  {
    sha: "d4e5f6a",
    message: "Document search flow",
    author: "alice-dev",
    createdAt: "2024-01-03T00:00:00.000Z",
    parentSha: "a1b2c3d",
    files: MAIN_FILES.map((file) => ({ ...file })),
  },
  {
    sha: "f7a8b9c",
    message: "Draft search prototype",
    author: "alice-dev",
    createdAt: "2024-01-04T00:00:00.000Z",
    parentSha: "d4e5f6a",
    files: [
      { path: "README.md", content: README_PROTOTYPE },
      { path: "main-only.md", content: MAIN_ONLY },
      { path: "prototype/search.ts", content: "export const searchPrototype = true;\n" },
    ],
  },
  {
    sha: "b8c9d0e",
    message: "Prepare release",
    author: "alice-dev",
    createdAt: "2024-01-05T00:00:00.000Z",
    parentSha: "d4e5f6a",
    files: [
      ...MAIN_FILES.filter((file) => file.path !== "src/search.ts"),
      { path: "src/search.ts", content: RELEASE_SEARCH_SOURCE },
      { path: "RELEASE.md", content: RELEASE_NOTES },
    ],
  },
  {
    sha: "e1f2a3b",
    message: "Ship the search fixes",
    author: "alice-dev",
    createdAt: "2024-01-08T00:00:00.000Z",
    parentSha: "d4e5f6a",
    files: [
      ...MAIN_FILES.filter((file) => file.path !== "src/search.ts"),
      { path: "src/search.ts", content: FIXES_SEARCH_SOURCE },
      { path: "src/matching.ts", content: MATCHING_SOURCE },
    ],
  },
  {
    sha: "f2a3b4c",
    message: "Refresh the docs layout",
    author: "alice-dev",
    createdAt: "2024-01-08T01:00:00.000Z",
    parentSha: "d4e5f6a",
    files: [
      ...MAIN_FILES.filter((file) => file.path !== "src/search.ts"),
      { path: "src/search.ts", content: POLISH_SEARCH_SOURCE },
      { path: "docs/layout.md", content: LAYOUT_NOTES },
    ],
  },
];

export const PULL_BRANCH_HEADS = {
  main: "d4e5f6a",
  "feature-search": "f7a8b9c",
  "draft-feature": "f7a8b9c",
  release: "b8c9d0e",
  "search-fixes": "e1f2a3b",
  "docs-polish": "f2a3b4c",
};

/** The seeded organization, its public repository and its stored pull requests. */
export const PULLS_SEED_ORGANIZATION: StubOrganization = {
  name: "acme-demo",
  displayName: "Acme Demo",
  members: [
    { username: "alice-dev", role: "owner" },
    { username: "bob-reviewer", role: "member" },
  ],
  teams: [{ name: "platform-team" }],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation for the Acme Demo platform.",
      visibility: "public",
      defaultBranch: "main",
      branches: [
        "docs-polish",
        "draft-feature",
        "feature-search",
        "main",
        "release",
        "search-fixes",
      ],
      commits: PULL_COMMITS,
      branchHeads: PULL_BRANCH_HEADS,
      // The same protected target branch as the seeded product state: `main`
      // carries both selectable requirements of a branch protection rule.
      branchProtectionRules: [
        { branchName: "main", requireApproval: true, requireStatusCheck: true },
      ],
      // The pull-request requirements supply a non-author Write reviewer:
      // `bob-reviewer` holds Write on this repository, so he is the eligible
      // candidate of the `Reviewers` picker of the seeded pull requests, and
      // `carol-maintainer` holds Maintain without being an Admin.
      grants: [
        { subjectType: "account", subjectName: "bob-reviewer", role: "write" },
        { subjectType: "account", subjectName: "carol-maintainer", role: "maintain" },
      ],
      pullRequests: [
        {
          number: 1,
          title: "Improve onboarding",
          description: "Document the onboarding improvement.",
          author: "alice-dev",
          status: "open",
          sourceBranch: "release",
          targetBranch: "main",
          reviewers: [],
          reviews: [],
          comments: [
            {
              author: "bob-reviewer",
              body: "The onboarding steps read well; the search example still needs a second pass.",
              createdAt: "2024-01-05T11:00:00.000Z",
            },
          ],
          // No stored result for the compare commit: the area starts pending.
          checks: [],
          events: [
            {
              type: "created",
              actor: "alice-dev",
              createdAt: "2024-01-05T10:00:00.000Z",
              data: {},
            },
            {
              type: "commented",
              actor: "bob-reviewer",
              createdAt: "2024-01-05T11:00:00.000Z",
              data: {},
            },
          ],
          baseCommitSha: "d4e5f6a",
          compareCommitSha: "b8c9d0e",
          createdAt: "2024-01-05T10:00:00.000Z",
          updatedAt: "2024-01-05T10:05:00.000Z",
        },
        {
          number: 2,
          title: "Fix search",
          description: "Correct the search prototype before it ships.",
          author: "alice-dev",
          status: "closed",
          sourceBranch: "feature-search",
          targetBranch: "main",
          reviewers: [],
          reviews: [],
          // No stored result for the compare commit: the area starts pending.
          checks: [],
          events: [
            {
              type: "created",
              actor: "alice-dev",
              createdAt: "2024-01-04T10:00:00.000Z",
              data: {},
            },
            {
              type: "closed",
              actor: "alice-dev",
              createdAt: "2024-01-04T12:00:00.000Z",
              data: {},
            },
          ],
          baseCommitSha: "d4e5f6a",
          compareCommitSha: "f7a8b9c",
          createdAt: "2024-01-04T10:00:00.000Z",
          updatedAt: "2024-01-04T12:00:00.000Z",
          closedAt: "2024-01-04T12:00:00.000Z",
        },
        {
          number: 3,
          title: "Draft onboarding update",
          description: "Work in progress on the onboarding update.",
          author: "alice-dev",
          status: "draft",
          sourceBranch: "draft-feature",
          targetBranch: "main",
          reviewers: [],
          reviews: [],
          // No stored result for the compare commit: the area starts pending.
          checks: [],
          events: [
            {
              type: "created",
              actor: "alice-dev",
              createdAt: "2024-01-06T10:00:00.000Z",
              data: {},
            },
          ],
          baseCommitSha: "d4e5f6a",
          compareCommitSha: "f7a8b9c",
          createdAt: "2024-01-06T10:00:00.000Z",
          updatedAt: "2024-01-06T10:00:00.000Z",
        },
        // The mergeable record: the valid non-author approval and the
        // successful `test` check of its current compare commit, so the merge
        // requirements of the protected `main` all hold.
        {
          number: MERGEABLE_PULL_NUMBER,
          title: "Ship the search fixes",
          description: "Ship the search fixes that were prepared for the release.",
          author: "alice-dev",
          status: "open",
          sourceBranch: "search-fixes",
          targetBranch: "main",
          reviewers: [],
          reviews: [
            {
              reviewer: "bob-reviewer",
              decision: "approved",
              body: "",
              commitId: "e1f2a3b",
              stale: false,
              superseded: false,
              createdAt: "2024-01-08T11:00:00.000Z",
            },
          ],
          checks: [
            {
              name: "test",
              status: "success",
              commitSha: "e1f2a3b",
              updatedBy: "alice-dev",
              updatedAt: "2024-01-08T11:30:00.000Z",
            },
          ],
          events: [
            {
              type: "created",
              actor: "alice-dev",
              createdAt: "2024-01-08T09:00:00.000Z",
              data: {},
            },
            {
              type: "reviewed",
              actor: "bob-reviewer",
              createdAt: "2024-01-08T11:00:00.000Z",
              data: { decision: "approved" },
            },
          ],
          baseCommitSha: "d4e5f6a",
          compareCommitSha: "e1f2a3b",
          createdAt: "2024-01-08T09:00:00.000Z",
          updatedAt: "2024-01-08T11:30:00.000Z",
        },
        // The blocked record of the same protected target branch: no valid
        // approval and no stored `test` result (the check starts pending).
        {
          number: BLOCKED_PULL_NUMBER,
          title: "Refresh the docs layout",
          description: "Refresh the layout of the documentation pages.",
          author: "alice-dev",
          status: "open",
          sourceBranch: "docs-polish",
          targetBranch: "main",
          reviewers: [],
          reviews: [],
          checks: [],
          events: [
            {
              type: "created",
              actor: "alice-dev",
              createdAt: "2024-01-08T09:30:00.000Z",
              data: {},
            },
          ],
          baseCommitSha: "d4e5f6a",
          compareCommitSha: "f2a3b4c",
          createdAt: "2024-01-08T09:30:00.000Z",
          updatedAt: "2024-01-08T09:30:00.000Z",
        },
      ],
    },
  ],
};
