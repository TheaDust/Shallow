// Seed data for the repository code model: one branch per named reference and
// one commit per revision, each commit carrying the complete file snapshot of
// that revision so browsing history never rewrites older content.
//
// `acme-docs` is the public repository the visitor scenarios open. Its default
// branch `main` holds a nested directory with text files, the code search
// sources under `src/`, and two commits: the initial one carrying only
// `docs/getting-started.md`, and the later `Document search flow` commit that
// adds `README.md`, `docs/search.md` and `src/search.ts` and modifies the
// getting-started guide. The second branch `feature-search` holds a snapshot
// without the `docs` and `src` directories, with its own `README.md` revision
// and an extra `main-only.md`, so switching to it hides a file of `main` and
// shows a file that only exists there. The third branch `release` carries one
// more revision on top of the recorded `main` history; changing the repository
// default branch to it leaves `main` and its commits untouched. That revision
// refreshes `src/search.ts` and adds `RELEASE.md`, so the seeded pull requests
// of this repository all show the known modified file `src/search.ts` next to
// one added file, with `3 additions, 1 deletions`.
//
// The last two branches carry one reviewable revision each on top of `main`
// with the same shape: `src/search.ts` refreshed plus exactly one added file.
// They own the separate Open pull requests the review-comment and
// review-submission scenarios start from.

export const SEED_BRANCHES = [
  {
    id: "branch-acme-docs-main",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "main",
    commitId: "commit-acme-docs-search-flow",
    createdAt: "2024-01-03T00:00:00.000Z",
  },
  {
    id: "branch-acme-docs-feature-search",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "feature-search",
    commitId: "commit-acme-docs-search-prototype",
    createdAt: "2024-01-04T00:00:00.000Z",
  },
  // The second seeded branch that keeps its own history: changing the default
  // branch to `release` leaves `main` and every commit untouched.
  {
    id: "branch-acme-docs-release",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "release",
    commitId: "commit-acme-docs-release-prepare",
    createdAt: "2024-01-05T00:00:00.000Z",
  },
  // The work-in-progress reference of the seeded draft pull request. It points
  // at the recorded prototype revision, so the comparison of the draft never
  // needs a commit of its own and no existing history is rewritten.
  {
    id: "branch-acme-docs-draft-feature",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "draft-feature",
    commitId: "commit-acme-docs-search-prototype",
    createdAt: "2024-01-06T00:00:00.000Z",
  },
  {
    id: "branch-acme-docs-search-filters",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "search-filters",
    commitId: "commit-acme-docs-search-filters",
    createdAt: "2024-01-06T01:00:00.000Z",
  },
  {
    id: "branch-acme-docs-search-ranking",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "search-ranking",
    commitId: "commit-acme-docs-search-ranking",
    createdAt: "2024-01-07T00:00:00.000Z",
  },
  // The two references the merge requirements own: `search-fixes` carries one
  // reviewable revision whose result is already approved and successful, and
  // `docs-polish` carries a revision whose required check is still pending.
  // Both point at their own commit on top of the recorded `main` history.
  {
    id: "branch-acme-docs-search-fixes",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "search-fixes",
    commitId: "commit-acme-docs-search-fixes",
    createdAt: "2024-01-08T00:00:00.000Z",
  },
  {
    id: "branch-acme-docs-docs-polish",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "docs-polish",
    commitId: "commit-acme-docs-docs-polish",
    createdAt: "2024-01-08T01:00:00.000Z",
  },
  {
    id: "branch-secret-research-main",
    repositoryId: "repository-acme-demo-secret-research",
    name: "main",
    commitId: "commit-secret-research-initial",
    createdAt: "2024-01-02T00:00:00.000Z",
  },
  {
    id: "branch-bob-notes-main",
    repositoryId: "repository-bob-reviewer-bob-notes",
    name: "main",
    commitId: "commit-bob-notes-initial",
    createdAt: "2024-01-05T00:00:00.000Z",
  },
  {
    id: "branch-acme-docs-fork-main",
    repositoryId: "repository-alice-dev-acme-docs-fork",
    name: "main",
    commitId: "commit-acme-docs-fork-initial",
    createdAt: "2024-01-06T00:00:00.000Z",
  },
];

const ACME_DOCS_README_WITH_SEARCH = [
  "# Acme Docs",
  "",
  "Documentation for the Acme Demo platform.",
  "",
  "The search flow starts in the search box at the top of every page.",
  "",
].join("\n");

// The first revision carries only this file, so the later commit both adds
// files and modifies this one, and `README.md` does not exist yet.
const ACME_DOCS_GETTING_STARTED_INITIAL =
  "# Getting started\n\nInstall the Acme Demo CLI and sign in.\n\nOpen the docs from the repository list.\n";

const ACME_DOCS_GETTING_STARTED =
  "# Getting started\n\nInstall the Acme Demo CLI and sign in.\n\nOpen the docs from the Code page.\n";

// The second branch has its own README revision (so the two branches differ in
// the content of a known file) and carries `main-only.md`, which does not exist
// on `main`.
const ACME_DOCS_README_PROTOTYPE = [
  "# Acme Docs",
  "",
  "Draft documentation for the search prototype.",
  "",
  "The search flow of this prototype is still being written.",
  "",
].join("\n");

const ACME_DOCS_MAIN_ONLY = [
  "# Prototype notes",
  "",
  "This file only exists on the feature-search branch.",
  "",
].join("\n");

const ACME_DOCS_RELEASE_NOTES = ["# Release 1.0", ""].join("\n");

// The three reviewable revisions refresh the same line of the search source,
// so every seeded pull request of the module shows the modified file
// `src/search.ts` with two additions and one deletion.
const ACME_DOCS_SEARCH_SOURCE_RELEASE = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  const trimmed = query.trim();",
  "  return trimmed.length === 0 ? [] : [trimmed];",
  "}",
  "",
].join("\n");

const ACME_DOCS_SEARCH_SOURCE_FILTERS = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  const filtered = query.trim();",
  "  return filtered.length === 0 ? [] : [filtered];",
  "}",
  "",
].join("\n");

const ACME_DOCS_SEARCH_SOURCE_RANKING = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  const ranked = query.trim();",
  "  return ranked.length === 0 ? [] : [ranked];",
  "}",
  "",
].join("\n");

const ACME_DOCS_FILTER_SOURCE = "export const filters = true;\n";

const ACME_DOCS_RANKING_NOTES = "# Ranking\n";

// The revision of the `search-fixes` branch: the same modified search source
// plus exactly one added file, so the mergeable pull request really carries
// `src/search.ts` next to one added file.
const ACME_DOCS_SEARCH_SOURCE_FIXES = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  const fixed = query.trim();",
  "  return fixed.length === 0 ? [] : [fixed];",
  "}",
  "",
].join("\n");

const ACME_DOCS_MATCHING_SOURCE = "export const matches = true;\n";

// The revision of the `docs-polish` branch, which owns the blocked pull
// request: its `test` check has never been stored, so the Checks area of that
// record starts as pending.
const ACME_DOCS_SEARCH_SOURCE_POLISH = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  const polished = query.trim();",
  "  return polished.length === 0 ? [] : [polished];",
  "}",
  "",
].join("\n");

const ACME_DOCS_LAYOUT_NOTES = "# Layout\n";

/** The default-branch snapshot with `src/search.ts` replaced by one revision. */
function filesWithSearchSource(searchSource) {
  return ACME_DOCS_FILES.map((file) =>
    file.path === "src/search.ts" ? { path: "src/search.ts", content: searchSource } : { ...file },
  );
}

const ACME_DOCS_SEARCH_GUIDE =
  "# Searching\n\nType a repository name in the top search box and press Enter.\n";

// The second file of the default branch that contains the searched phrase; it
// lives under `src/`, the path filter of the code search scenario.
const ACME_DOCS_SEARCH_SOURCE = [
  "// Repository code search: the search flow of the Acme Docs site.",
  "export function searchFlow(query: string): string[] {",
  "  return query.trim().length === 0 ? [] : [query.trim()];",
  "}",
  "",
].join("\n");

const ACME_DOCS_FILES = [
  { path: "README.md", content: ACME_DOCS_README_WITH_SEARCH },
  { path: "docs/getting-started.md", content: ACME_DOCS_GETTING_STARTED },
  { path: "docs/search.md", content: ACME_DOCS_SEARCH_GUIDE },
  { path: "src/search.ts", content: ACME_DOCS_SEARCH_SOURCE },
];

export const SEED_COMMITS = [
  {
    id: "commit-acme-docs-initial",
    repositoryId: "repository-acme-demo-acme-docs",
    sha: "a1b2c3d",
    message: "Initial commit",
    authorId: "account-alice-dev",
    parentId: null,
    createdAt: "2024-01-02T00:00:00.000Z",
    files: [{ path: "docs/getting-started.md", content: ACME_DOCS_GETTING_STARTED_INITIAL }],
  },
  {
    id: "commit-acme-docs-search-flow",
    repositoryId: "repository-acme-demo-acme-docs",
    sha: "d4e5f6a",
    message: "Document search flow",
    authorId: "account-alice-dev",
    parentId: "commit-acme-docs-initial",
    createdAt: "2024-01-03T00:00:00.000Z",
    files: ACME_DOCS_FILES.map((file) => ({ ...file })),
  },
  // The second branch keeps its own snapshot: no `docs` directory and no
  // `src` directory, so a file that only exists on `main` disappears here.
  {
    id: "commit-acme-docs-search-prototype",
    repositoryId: "repository-acme-demo-acme-docs",
    sha: "f7a8b9c",
    message: "Draft search prototype",
    authorId: "account-alice-dev",
    parentId: "commit-acme-docs-search-flow",
    createdAt: "2024-01-04T00:00:00.000Z",
    files: [
      { path: "README.md", content: ACME_DOCS_README_PROTOTYPE },
      { path: "main-only.md", content: ACME_DOCS_MAIN_ONLY },
      { path: "prototype/search.ts", content: "export const searchPrototype = true;\n" },
    ],
  },
  // The `release` branch keeps on top of the recorded `main` history one extra
  // revision, so it has its own head and `main` and its commits stay intact.
  {
    id: "commit-acme-docs-release-prepare",
    repositoryId: "repository-acme-demo-acme-docs",
    sha: "b8c9d0e",
    message: "Prepare release",
    authorId: "account-alice-dev",
    parentId: "commit-acme-docs-search-flow",
    createdAt: "2024-01-05T00:00:00.000Z",
    files: [
      ...filesWithSearchSource(ACME_DOCS_SEARCH_SOURCE_RELEASE),
      { path: "RELEASE.md", content: ACME_DOCS_RELEASE_NOTES },
    ],
  },
  // The revision of the `search-filters` branch: the same modified search
  // source plus exactly one added file.
  {
    id: "commit-acme-docs-search-filters",
    repositoryId: "repository-acme-demo-acme-docs",
    sha: "c9d0e1f",
    message: "Add search filters",
    authorId: "account-alice-dev",
    parentId: "commit-acme-docs-search-flow",
    createdAt: "2024-01-06T01:00:00.000Z",
    files: [
      ...filesWithSearchSource(ACME_DOCS_SEARCH_SOURCE_FILTERS),
      { path: "src/filters.ts", content: ACME_DOCS_FILTER_SOURCE },
    ],
  },
  // The revision of the `search-ranking` branch, with its own added file.
  {
    id: "commit-acme-docs-search-ranking",
    repositoryId: "repository-acme-demo-acme-docs",
    sha: "d0e1f2a",
    message: "Refine search ranking",
    authorId: "account-alice-dev",
    parentId: "commit-acme-docs-search-flow",
    createdAt: "2024-01-07T00:00:00.000Z",
    files: [
      ...filesWithSearchSource(ACME_DOCS_SEARCH_SOURCE_RANKING),
      { path: "docs/ranking.md", content: ACME_DOCS_RANKING_NOTES },
    ],
  },
  // The new reference carries its own revision on top of the recorded `main`
  // history, so merging it moves `main` forward without rewriting anything.
  {
    id: "commit-acme-docs-search-fixes",
    repositoryId: "repository-acme-demo-acme-docs",
    sha: "e1f2a3b",
    message: "Ship the search fixes",
    authorId: "account-alice-dev",
    parentId: "commit-acme-docs-search-flow",
    createdAt: "2024-01-08T00:00:00.000Z",
    files: [
      ...filesWithSearchSource(ACME_DOCS_SEARCH_SOURCE_FIXES),
      { path: "src/matching.ts", content: ACME_DOCS_MATCHING_SOURCE },
    ],
  },
  {
    id: "commit-acme-docs-docs-polish",
    repositoryId: "repository-acme-demo-acme-docs",
    sha: "f2a3b4c",
    message: "Refresh the docs layout",
    authorId: "account-alice-dev",
    parentId: "commit-acme-docs-search-flow",
    createdAt: "2024-01-08T01:00:00.000Z",
    files: [
      ...filesWithSearchSource(ACME_DOCS_SEARCH_SOURCE_POLISH),
      { path: "docs/layout.md", content: ACME_DOCS_LAYOUT_NOTES },
    ],
  },
  {
    id: "commit-secret-research-initial",
    repositoryId: "repository-acme-demo-secret-research",
    sha: "b2c3d4e",
    message: "Start research notes",
    authorId: "account-alice-dev",
    parentId: null,
    createdAt: "2024-01-02T00:00:00.000Z",
    files: [
      { path: "README.md", content: "# Secret research\n\nPrivate notes for the Acme Demo team.\n" },
      // The unreadable private repository mentions the same phrase, so a code
      // search of the public repository must never leak it.
      {
        path: "research/notes.md",
        content: "# Notes\n\nResearch questions and findings about the search flow.\n",
      },
    ],
  },
  {
    id: "commit-bob-notes-initial",
    repositoryId: "repository-bob-reviewer-bob-notes",
    sha: "c3d4e5f",
    message: "Initial commit",
    authorId: "account-bob-reviewer",
    parentId: null,
    createdAt: "2024-01-05T00:00:00.000Z",
    files: [
      { path: "README.md", content: "# Bob notes\n\nPersonal notes of bob-reviewer.\n" },
    ],
  },
  // The seeded fork starts from the copied default-branch snapshot of its
  // source `acme-docs`; its records are its own, never a shared reference.
  {
    id: "commit-acme-docs-fork-initial",
    repositoryId: "repository-alice-dev-acme-docs-fork",
    sha: "e5f6a7b",
    message: "Initial commit",
    authorId: "account-alice-dev",
    parentId: null,
    createdAt: "2024-01-06T00:00:00.000Z",
    files: ACME_DOCS_FILES.map((file) => ({ ...file })),
  },
];
