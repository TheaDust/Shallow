import { hashPassword } from "./domain/credentials.mjs";

const SEEDED_PASSWORD = "Valid-password-123!";

const ALICE_OWNER = { type: "user", id: "account-alice-dev", login: "alice-dev" };
const BOB_OWNER = { type: "user", id: "account-bob-reviewer", login: "bob-reviewer" };
const ACME_ORGANIZATION_ID = "org-acme-demo";
const ACME_ORGANIZATION_OWNER = {
  type: "organization",
  id: ACME_ORGANIZATION_ID,
  login: "acme-demo",
};

/**
 * Shared text of the REQ-4 seed: the code search query `search flow` occurs in
 * exactly two files of `main` (`README.md` and `src/search.ts`), the private
 * `secret-research` repository also carries it, and `no-such-token` occurs
 * nowhere.
 */
export const SEED_README_INITIAL =
  "# acme-docs\n\nDocumentation and guides for the Acme platform.\n";
export const SEED_README_CURRENT =
  "# acme-docs\n\nDocumentation and guides for the Acme platform.\n\n## Search flow\n\nThe repository code search follows the search flow described below.\nOpen the Code page and use the search box to run a search flow query.\n";
/** The text file inside the `docs/` directory of the default branch. */
export const SEED_DOCS_README =
  "# Getting started\n\nInstall the Acme CLI, then run the setup command to create your first workspace.\n";
export const SEED_SEARCH_TS =
  "// Search flow helpers used by the repository code search page.\nexport function searchFlow(query: string, lines: string[]): string[] {\n  return lines.filter((line) => line.includes(query));\n}\n";
export const SEED_SEARCH_TS_PLUS =
  "// Search flow helpers used by the repository code search page.\nexport function searchFlow(query: string, lines: string[]): string[] {\n  return lines.filter((line) => line.includes(query));\n}\n\nexport function countSearchFlow(lines: string[]): number {\n  return lines.filter((line) => line.includes(\"search flow\")).length;\n}\n";
export const SEED_SEARCH_LOADER_TS =
  '// Loads the helpers used by the repository code search page.\nimport { searchFlow } from "./search";\n\nexport function loadSearch(query: string, lines: string[]): string[] {\n  return searchFlow(query, lines);\n}\n';
/**
 * The `feature-search` revision of `src/search.ts`: the branch drops the blank
 * separator line between the two helpers, so the comparison of the seeded pull
 * requests shows one modified file with a single deletion and no addition.
 */
export const SEED_SEARCH_TS_FEATURE = SEED_SEARCH_TS_PLUS.replace(
  "}\n\nexport function countSearchFlow",
  "}\nexport function countSearchFlow",
);
/**
 * The README of the `draft-feature` branch: the dedicated ready-for-review seed
 * pull request `Draft onboarding update` proposes bringing this revision into
 * `main` (REQ-6-2-4).
 */
export const SEED_README_DRAFT_FEATURE =
  "# acme-docs\n\nOnboarding notes for new contributors, shortened for the first draft.\n";
/**
 * The file only `feature-search` carries: it is absent from `main` (and from
 * `release`), so switching branches visibly changes the file list of the same
 * repository.
 */
export const SEED_MAIN_ONLY_MD =
  "# Main-only notes\n\nThis note file exists only on the feature-search branch.\n";

function commit({ id, branch, message, authorLogin, createdAt, parentId = null, changes }) {
  return { id, branch, message, authorLogin, createdAt, parentId, changes };
}

function added(path, content) {
  return { path, changeType: "added", content };
}

function modified(path, content) {
  return { path, changeType: "modified", content };
}

/**
 * The REQ-4 repository. Its default branch `main` holds the root file
 * `README.md`, the nested directory `docs/` with exactly one text file inside it
 * (`docs/README.md`) and the directory `src/`, so a directory page and a file
 * page have a stored path to show. `feature-search` is a second branch one commit
 * ahead of `main` whose commit adds `main-only.md` (absent from `main`) and edits
 * `src/search.ts`, so a branch switch changes the read snapshot while the branch
 * comparison of the seeded pull requests shows exactly one added and one modified
 * file (REQ-6-2-2, REQ-6-3-2). `release` points at an earlier commit of the same
 * history and is the branch the REQ-4-3-3 default-branch change selects.
 *
 * `main` keeps three commits: `Initial commit` writes `README.md`,
 * `Document search flow` modifies it and adds `docs/README.md` plus
 * `src/search.ts`, and `Add search loader` — the newest one — changes only
 * `src/`, so a file-scoped history is visibly narrower than the branch history
 * while every commit still lists the files it changed.
 */
function seedAcmeDocs() {
  const id = "repo-alice-dev-acme-docs";
  const initial = commit({
    id: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    branch: "main",
    message: "Initial commit",
    authorLogin: "alice-dev",
    createdAt: "2024-01-05T09:00:00.000Z",
    changes: [added("README.md", SEED_README_INITIAL)],
  });
  const documentSearchFlow = commit({
    id: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
    branch: "main",
    message: "Document search flow",
    authorLogin: "alice-dev",
    createdAt: "2024-02-12T09:30:00.000Z",
    parentId: initial.id,
    changes: [
      modified("README.md", SEED_README_CURRENT),
      added("docs/README.md", SEED_DOCS_README),
      added("src/search.ts", SEED_SEARCH_TS),
    ],
  });
  const addSearchLoader = commit({
    id: "3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09",
    branch: "main",
    message: "Add search loader",
    authorLogin: "alice-dev",
    createdAt: "2024-02-20T15:45:00.000Z",
    parentId: documentSearchFlow.id,
    changes: [
      added("src/loader.ts", SEED_SEARCH_LOADER_TS),
      modified("src/search.ts", SEED_SEARCH_TS_PLUS),
    ],
  });
  // `feature-search` is one commit ahead of `main`: that commit adds the note
  // file `main-only.md` and edits `src/search.ts`, so the branch comparison
  // carries the known changed-file path `src/search.ts` next to one added file
  // and never a difference of `README.md` (REQ-6-2-2, REQ-6-3-2).
  const featureOnlyFile = commit({
    id: "8a7b6c5d4e3f2a1908b7c6d5e4f3a2b190807162",
    branch: "feature-search",
    message: "Add main-only notes",
    authorLogin: "alice-dev",
    createdAt: "2024-02-21T10:15:00.000Z",
    parentId: addSearchLoader.id,
    changes: [
      added("main-only.md", SEED_MAIN_ONLY_MD),
      modified("src/search.ts", SEED_SEARCH_TS_FEATURE),
    ],
  });
  // The compare branch of the seeded Draft pull request `Draft onboarding
  // update`: it branches off the current `main` head, so the draft proposes one
  // commit and a real diff of `README.md` without touching the other branches.
  const draftFeature = commit({
    id: "b7a6c5d4e3f2a1908b7c6d5e4f3a2b190807161",
    branch: "draft-feature",
    message: "Draft the onboarding update",
    authorLogin: "carol-dev",
    createdAt: "2024-03-01T10:20:00.000Z",
    parentId: addSearchLoader.id,
    changes: [modified("README.md", SEED_README_DRAFT_FEATURE)],
  });

  return {
    id,
    owner: ALICE_OWNER,
    name: "acme-docs",
    visibility: "public",
    description: "Documentation and guides for the Acme platform.",
    defaultBranch: "main",
    createdAt: "2024-01-05T09:00:00.000Z",
    updatedAt: addSearchLoader.createdAt,
    sourceRepository: null,
    branches: [
      { name: "main", headCommitId: addSearchLoader.id },
      { name: "feature-search", headCommitId: featureOnlyFile.id },
      // `release` points at an ancestor commit of `main`, so changing the default
      // branch (REQ-4-3-3) never copies files or rewrites a history: the branch
      // reads an earlier snapshot of the same commits.
      { name: "release", headCommitId: documentSearchFlow.id },
      // The compare branch of the seeded Draft pull request (REQ-6-2-4).
      { name: "draft-feature", headCommitId: draftFeature.id },
    ],
    commits: [initial, documentSearchFlow, addSearchLoader, featureOnlyFile, draftFeature],
  };
}

/**
 * One-commit repository used by the remaining seed records: the commit adds
 * every file of the branch, so a file read is derived from the same history.
 */
function seedRepository({
  id,
  commitId,
  owner = ALICE_OWNER,
  authorLogin = owner.login,
  name,
  visibility,
  description,
  createdAt,
  updatedAt,
  files,
  commitMessage = "Initial commit",
}) {
  const initialFiles =
    files ?? [{ path: "README.md", content: `# ${name}\n\n${description}\n` }];
  return {
    id,
    owner,
    name,
    visibility,
    description,
    defaultBranch: "main",
    createdAt,
    updatedAt,
    sourceRepository: null,
    branches: [{ name: "main", headCommitId: commitId }],
    commits: [
      {
        id: commitId,
        branch: "main",
        message: commitMessage,
        authorLogin,
        createdAt,
        parentId: null,
        changes: initialFiles.map((file) => added(file.path, file.content)),
      },
    ],
  };
}

/**
 * `alice-dev/acme-docs-fork` is the fork-name conflict used by REQ-3-2-2: it is
 * a private fork of the public source, and forking a public source as private is
 * allowed.
 */
function seedForkRepository({ id, commitId, name, source, visibility, createdAt, updatedAt }) {
  return {
    id,
    owner: ALICE_OWNER,
    name,
    visibility,
    description: source.description,
    defaultBranch: source.defaultBranch,
    createdAt,
    updatedAt,
    sourceRepository: { id: source.id, owner: source.owner.login, name: source.name },
    branches: [{ name: source.defaultBranch, headCommitId: commitId }],
    commits: [
      commit({
        id: commitId,
        branch: source.defaultBranch,
        message: "Initial commit",
        authorLogin: "alice-dev",
        createdAt,
        changes: [added("README.md", SEED_README_INITIAL)],
      }),
    ],
  };
}

/**
 * Shared initial state written into an empty data directory.
 * Seed accounts and repositories are compatibility-stable: later feature
 * packages extend this list instead of replacing existing entries.
 *
 * The seed spans two namespaces that declare the same repository name:
 * `alice-dev/acme-docs` (REQ-3) and `acme-demo/acme-docs` (REQ-2). They are kept
 * as two independent records instead of one default record, because a repository
 * has exactly one owner.
 */
/**
 * Planning data of one `acme-docs` repository (REQ-5): the labels `bug` and
 * `documentation`, the milestones `Q3 launch` and `v1.0`, and the issues the
 * scenarios read.
 *
 * `Improve onboarding` is the Open issue with the `bug` label, one assignee and
 * one comment, `Legacy welcome text` is the Closed issue that carries the same
 * label, and `Original issue title` is the separate seed the invalid-title edit
 * starts from. Both `acme-docs` records receive the same planning data because
 * the scenarios only name the repository `acme-docs`, while the milestone and
 * the label stay repository-scoped: each record holds its own copies.
 */
function acmeDocsPlanning({ repositoryId }) {
  const labelId = (name) => `label-${repositoryId}-${name}`;
  const milestoneId = `milestone-${repositoryId}-q3-launch`;
  const labels = [
    {
      id: labelId("bug"),
      repositoryId,
      name: "bug",
      color: "d73a4a",
      description: "Something is not working",
      createdAt: "2024-01-05T09:00:00.000Z",
    },
    {
      id: labelId("documentation"),
      repositoryId,
      name: "documentation",
      color: "0075ca",
      description: "Improvements or additions to documentation",
      createdAt: "2024-01-05T09:00:00.000Z",
    },
  ];
  const milestones = [
    {
      id: milestoneId,
      repositoryId,
      title: "Q3 launch",
      description: "Documentation release of the third quarter.",
      state: "open",
      createdAt: "2024-01-05T09:00:00.000Z",
    },
    // The selectable milestone of the association scenario: the issue starts on
    // `Q3 launch` and `v1.0` is the goal it can be moved to.
    {
      id: `milestone-${repositoryId}-v1-0`,
      repositoryId,
      title: "v1.0",
      description: "First public release.",
      state: "open",
      createdAt: "2024-01-06T09:00:00.000Z",
    },
  ];

  const onboardingId = `issue-${repositoryId}-1`;
  const legacyId = `issue-${repositoryId}-2`;
  const originalId = `issue-${repositoryId}-3`;
  const issues = [
    {
      id: onboardingId,
      repositoryId,
      number: 1,
      title: "Improve onboarding",
      description: "Describe the onboarding improvement.",
      status: "open",
      authorId: "account-alice-dev",
      createdAt: "2024-02-21T09:00:00.000Z",
      updatedAt: "2024-02-22T10:15:00.000Z",
      labelIds: [labelId("bug")],
      assigneeIds: ["account-alice-dev"],
      milestoneId,
      comments: [
        {
          id: `${onboardingId}-comment-1`,
          authorId: "account-alice-dev",
          body: "The first-run wizard should mention the CLI install step.",
          createdAt: "2024-02-22T10:15:00.000Z",
        },
      ],
      activities: [
        {
          id: `${onboardingId}-activity-1`,
          type: "created",
          actorId: "account-alice-dev",
          createdAt: "2024-02-21T09:00:00.000Z",
        },
        {
          id: `${onboardingId}-activity-2`,
          type: "commented",
          actorId: "account-alice-dev",
          createdAt: "2024-02-22T10:15:00.000Z",
          commentId: `${onboardingId}-comment-1`,
        },
      ],
    },
    {
      id: legacyId,
      repositoryId,
      number: 2,
      title: "Legacy welcome text",
      description:
        "The legacy welcome text still describes the Improve onboarding flow, so it needs an update for the new release.",
      status: "closed",
      authorId: "account-alice-dev",
      createdAt: "2024-02-10T08:20:00.000Z",
      updatedAt: "2024-02-19T16:40:00.000Z",
      labelIds: [labelId("bug")],
      assigneeIds: [],
      milestoneId: null,
      comments: [],
      activities: [
        {
          id: `${legacyId}-activity-1`,
          type: "created",
          actorId: "account-alice-dev",
          createdAt: "2024-02-10T08:20:00.000Z",
        },
        {
          id: `${legacyId}-activity-2`,
          type: "closed",
          actorId: "account-alice-dev",
          createdAt: "2024-02-19T16:40:00.000Z",
        },
      ],
    },
    {
      id: originalId,
      repositoryId,
      number: 3,
      title: "Original issue title",
      description: "This description is here for the editing workflow.",
      status: "open",
      authorId: "account-alice-dev",
      createdAt: "2024-02-23T13:05:00.000Z",
      updatedAt: "2024-02-23T13:05:00.000Z",
      labelIds: [],
      assigneeIds: [],
      milestoneId: null,
      comments: [],
      activities: [
        {
          id: `${originalId}-activity-1`,
          type: "created",
          actorId: "account-alice-dev",
          createdAt: "2024-02-23T13:05:00.000Z",
        },
      ],
    },
  ];

  return { labels, milestones, issues };
}

/**
 * The pull-request seed of one `acme-docs` repository (REQ-6).
 *
 * `Improve onboarding` and `Fix search` propose the same pair: the compare branch
 * `feature-search` into the `main` branch. `Improve onboarding` is the Closed
 * pull request of the list and filter scenarios, `Fix search` is the Open one of
 * `alice-dev`.
 *
 * `Fix search` is the eligible merge seed (REQ-6-5): its target `main` is
 * protected, a non-author collaborator already approved the current compare
 * commit and that commit's `test` check is a success, so a maintainer merges it
 * with `Create a merge commit`. The author of that approval is `carol-dev`, so
 * the seeded `bob-reviewer` still has no effective decision of his own on any
 * seeded proposal (REQ-6-3-4).
 *
 * The second Open record is the blocked merge seed of the same comparison
 * (REQ-6-3-3, REQ-6-3-4, REQ-6-6, REQ-6-5): `carol-dev` proposes
 * `feature-search` into `main` without a single approval, so a protected `main`
 * blocks its merge with `Review required by branch protection`, while every
 * review or reviewer scenario finds an Open proposal that is not the one another
 * scenario already wrote to.
 *
 * The fourth record is the dedicated ready-for-review seed of REQ-6-2-4: the
 * Draft pull request `Draft onboarding update` of the Write collaborator
 * `carol-dev`, proposing `draft-feature` into `main`, with no submitted review.
 */
function seedPullRequests(repository) {
  const head = (branch) =>
    (repository.branches ?? []).find((candidate) => candidate.name === branch)?.headCommitId ??
    null;
  const mainHead = head("main");
  const compareHead = head("feature-search");
  const draftHead = head("draft-feature");
  const base = {
    repositoryId: repository.id,
    authorId: "account-alice-dev",
    baseBranch: "main",
    compareBranch: "feature-search",
    baseCommitId: mainHead,
    compareCommitId: compareHead,
    creationCompareCommitId: compareHead,
    reviews: [],
  };
  return [
    {
      ...base,
      id: `pull-${repository.id}-1`,
      number: 1,
      title: "Improve onboarding",
      description:
        "Rework the onboarding notes so a new contributor can start from the README.",
      status: "closed",
      createdAt: "2024-02-21T09:10:00.000Z",
      updatedAt: "2024-02-25T11:05:00.000Z",
      comments: [],
      reviewerIds: [],
      activities: [
        {
          id: `pull-${repository.id}-1-activity-1`,
          type: "created",
          actorId: "account-alice-dev",
          createdAt: "2024-02-21T09:10:00.000Z",
        },
        {
          id: `pull-${repository.id}-1-activity-2`,
          type: "closed",
          actorId: "account-alice-dev",
          createdAt: "2024-02-25T11:05:00.000Z",
          value: "closed",
        },
      ],
    },
    {
      ...base,
      id: `pull-${repository.id}-2`,
      number: 2,
      title: "Fix search",
      description: "Search must read the branch that is currently browsed.",
      status: "open",
      createdAt: "2024-02-27T16:20:00.000Z",
      updatedAt: "2024-02-27T16:20:00.000Z",
      comments: [
        {
          id: `pull-${repository.id}-2-comment-1`,
          authorId: "account-bob-reviewer",
          body: "The helper looks right; please add a check for the loader.",
          createdAt: "2024-02-27T16:40:00.000Z",
        },
      ],
      // The proposal starts without a reviewer request; its author requests the
      // eligible collaborator on the page (REQ-6-4). The stored approval below
      // belongs to the current compare commit, so it is the valid non-author
      // approval of the eligible merge seed (REQ-6-5).
      reviewerIds: [],
      reviews: [
        {
          id: `pull-${repository.id}-2-review-1`,
          reviewerId: "account-carol-dev",
          decision: "approve",
          body: "The search helper reads the browsed branch now.",
          commitId: compareHead,
          createdAt: "2024-02-28T09:05:00.000Z",
        },
      ],
      activities: [
        {
          id: `pull-${repository.id}-2-activity-1`,
          type: "created",
          actorId: "account-alice-dev",
          createdAt: "2024-02-27T16:20:00.000Z",
        },
        {
          id: `pull-${repository.id}-2-activity-2`,
          type: "commented",
          actorId: "account-bob-reviewer",
          createdAt: "2024-02-27T16:40:00.000Z",
          detail: "The helper looks right; please add a check for the loader.",
        },
        {
          id: `pull-${repository.id}-2-activity-3`,
          type: "reviewed",
          actorId: "account-carol-dev",
          createdAt: "2024-02-28T09:05:00.000Z",
          value: "approve",
        },
      ],
    },
    {
      // The second Open proposal of the same comparison (REQ-6-3-3, REQ-6-3-4,
      // REQ-6-4, REQ-6-5, REQ-6-6): it keeps a separate Open proposal without a
      // single approval available for the pending-comment, request-changes,
      // blocked-merge and viewer-permission scenarios.
      ...base,
      id: `pull-${repository.id}-4`,
      number: 4,
      title: "Add search flow notes",
      description: "Describe the search flow helpers and the branch-only note file.",
      status: "open",
      authorId: "account-carol-dev",
      createdAt: "2024-03-02T09:15:00.000Z",
      updatedAt: "2024-03-02T09:15:00.000Z",
      comments: [],
      reviewerIds: [],
      activities: [
        {
          id: `pull-${repository.id}-4-activity-1`,
          type: "created",
          actorId: "account-carol-dev",
          createdAt: "2024-03-02T09:15:00.000Z",
        },
      ],
    },
    {
      // The dedicated ready-for-review seed of REQ-6-2-4: a Draft proposal of the
      // seeded Write collaborator `carol-dev` that brings `draft-feature` into
      // `main`. It starts without a single submitted review, so its author or a
      // maintainer converts it to Open from its detail page.
      id: `pull-${repository.id}-3`,
      number: 3,
      repositoryId: repository.id,
      title: "Draft onboarding update",
      description: "Shorten the onboarding notes before asking for a review.",
      status: "draft",
      authorId: "account-carol-dev",
      baseBranch: "main",
      compareBranch: "draft-feature",
      baseCommitId: mainHead,
      compareCommitId: draftHead,
      creationCompareCommitId: draftHead,
      createdAt: "2024-03-01T10:25:00.000Z",
      updatedAt: "2024-03-01T10:25:00.000Z",
      comments: [],
      reviews: [],
      reviewerIds: [],
      activities: [
        {
          id: `pull-${repository.id}-3-activity-1`,
          type: "created",
          actorId: "account-carol-dev",
          createdAt: "2024-03-01T10:25:00.000Z",
        },
      ],
    },
  ];
}

/**
 * One classification name that only an unrelated repository defines: the label
 * `bug` exists in more than one repository, and each repository stores its own
 * record. A selector of one repository must never offer the other repository's
 * name, and it never copies one either.
 */
function secretResearchPlanning({ repositoryId }) {
  return {
    labels: [
      {
        id: `label-${repositoryId}-bug`,
        repositoryId,
        name: "bug",
        color: "b60205",
        description: "Something is not working",
        createdAt: "2024-01-08T11:15:00.000Z",
      },
    ],
    milestones: [],
  };
}

/**
 * The protected repository keeps one issue: `bob-reviewer` holds a read grant on
 * `acme-demo/acme-internal`, so a Read viewer can open an issue and must not be
 * offered its editing controls. Its label and milestone are repository-scoped
 * names no other repository defines.
 */
function internalPlanning({ repositoryId }) {
  const labelId = `label-${repositoryId}-internal`;
  const issueId = `issue-${repositoryId}-1`;
  return {
    labels: [
      {
        id: labelId,
        repositoryId,
        name: "internal",
        color: "0e8a16",
        description: "Internal planning item",
        createdAt: "2024-01-12T08:30:00.000Z",
      },
    ],
    milestones: [
      {
        id: `milestone-${repositoryId}-internal-beta`,
        repositoryId,
        title: "Internal beta",
        description: "Internal preview of the next release.",
        state: "open",
        createdAt: "2024-01-12T08:30:00.000Z",
      },
    ],
    issues: [
      {
        id: issueId,
        repositoryId,
        number: 1,
        title: "Internal review checklist",
        description: "Collect the checks the internal release needs.",
        status: "open",
        authorId: "account-alice-dev",
        createdAt: "2024-02-18T14:05:00.000Z",
        updatedAt: "2024-02-18T14:05:00.000Z",
        labelIds: [],
        assigneeIds: [],
        milestoneId: null,
        comments: [],
        activities: [
          {
            id: `${issueId}-activity-1`,
            type: "created",
            actorId: "account-alice-dev",
            createdAt: "2024-02-18T14:05:00.000Z",
          },
        ],
      },
    ],
  };
}

export function createInitialState() {
  const acmeDocs = seedAcmeDocs();
  const secretResearch = seedRepository({
    id: "repo-alice-dev-secret-research",
    commitId: "f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d",
    name: "secret-research",
    visibility: "private",
    description: "Confidential research notes for the Acme platform.",
    createdAt: "2024-01-08T11:15:00.000Z",
    updatedAt: "2024-02-20T16:45:00.000Z",
    // The private repository also carries the code-search term, so a search in
    // a public repository must never reach its content.
    files: [
      {
        path: "README.md",
        content: "# secret-research\n\nConfidential research notes for the Acme platform.\n",
      },
      {
        path: "notes/search-flow.md",
        content: "# Search flow findings\n\nThe search flow experiment stays private until it is reviewed.\n",
      },
    ],
    commitMessage: "Draft the search flow findings",
  });
  const acmeDocsFork = seedForkRepository({
    id: "repo-alice-dev-acme-docs-fork",
    commitId: "7b6a5c4d3e2f10a9b8c7d6e5f4a3b2c1d0e9f8a7",
    name: "acme-docs-fork",
    source: acmeDocs,
    visibility: "private",
    createdAt: "2024-02-14T10:05:00.000Z",
    updatedAt: "2024-02-14T10:05:00.000Z",
  });
  // The seed organization owns a public and a distinct private repository. The
  // private one carries a direct grant for `bob-reviewer` so the removal rule of
  // REQ-2-2-4 ("all direct grants on repositories of the organization") has a
  // visible effect on the removed account's effective access.
  const acmeOrganizationDocs = seedRepository({
    id: "repo-acme-demo-acme-docs",
    commitId: "4e3d2c1b0a9f8e7d6c5b4a39281706152e3d4c5b",
    owner: ACME_ORGANIZATION_OWNER,
    name: "acme-docs",
    visibility: "public",
    description: "Documentation and guides for the Acme platform.",
    createdAt: "2024-01-10T09:00:00.000Z",
    updatedAt: "2024-02-15T10:20:00.000Z",
  });
  const acmeInternal = seedRepository({
    id: "repo-acme-demo-acme-internal",
    commitId: "a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3",
    owner: ACME_ORGANIZATION_OWNER,
    name: "acme-internal",
    visibility: "private",
    description: "Internal planning notes of the Acme Demo organization.",
    createdAt: "2024-01-12T08:30:00.000Z",
    updatedAt: "2024-02-18T14:05:00.000Z",
  });
  // The member of the REQ-2-2-4 removal scenario keeps an accessible personal
  // account and personal repository afterwards.
  const bobNotes = seedRepository({
    id: "repo-bob-reviewer-bob-notes",
    commitId: "6f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2",
    owner: BOB_OWNER,
    name: "bob-notes",
    visibility: "public",
    description: "Review notes of bob-reviewer.",
    createdAt: "2024-01-15T13:45:00.000Z",
    updatedAt: "2024-02-11T11:10:00.000Z",
  });

  const acmeDocsPlanningData = acmeDocsPlanning({ repositoryId: acmeDocs.id });
  const organizationPlanningData = acmeDocsPlanning({
    repositoryId: acmeOrganizationDocs.id,
  });
  const internalPlanningData = internalPlanning({ repositoryId: acmeInternal.id });
  const secretPlanningData = secretResearchPlanning({ repositoryId: secretResearch.id });

  return {
    accounts: [
      {
        id: "account-alice-dev",
        username: "alice-dev",
        email: "alice.dev@example.test",
        emailVerified: true,
        status: "active",
        credential: hashPassword(SEEDED_PASSWORD),
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "account-bob-reviewer",
        username: "bob-reviewer",
        email: "bob.reviewer@example.test",
        emailVerified: true,
        status: "active",
        credential: hashPassword(SEEDED_PASSWORD),
        createdAt: "2024-01-02T00:00:00.000Z",
      },
      // The collaborator of the issue metadata scenarios: she holds Write on both
      // `acme-docs` records, which makes her an assignable member without giving
      // her the metadata controls of Triage and above.
      {
        id: "account-carol-dev",
        username: "carol-dev",
        email: "carol.dev@example.test",
        emailVerified: true,
        status: "active",
        credential: hashPassword(SEEDED_PASSWORD),
        createdAt: "2024-01-03T00:00:00.000Z",
      },
    ],
    sessions: [],
    // `alice-dev` owns the organization, `bob-reviewer` is an ordinary member:
    // the non-Owner of the REQ-2-2-4 denial case.
    organizations: [
      {
        id: ACME_ORGANIZATION_ID,
        login: "acme-demo",
        name: "Acme Demo",
        createdAt: "2024-01-03T00:00:00.000Z",
        createdBy: { accountId: "account-alice-dev", login: "alice-dev" },
        members: [
          {
            accountId: "account-alice-dev",
            role: "owner",
            createdAt: "2024-01-03T00:00:00.000Z",
          },
          {
            accountId: "account-bob-reviewer",
            role: "member",
            createdAt: "2024-01-04T00:00:00.000Z",
          },
        ],
      },
    ],
    // Team membership and hierarchy are independent relationships; the seed team
    // has no member yet (REQ-2-2-2 adds `bob-reviewer` through the UI).
    teams: [
      {
        id: "team-acme-demo-frontend-team",
        organizationId: ACME_ORGANIZATION_ID,
        name: "frontend-team",
        description: "Frontend engineers of the Acme platform.",
        parentTeamId: null,
        createdBy: { accountId: "account-alice-dev", login: "alice-dev" },
        createdAt: "2024-01-06T00:00:00.000Z",
      },
    ],
    teamMemberships: [],
    // `bob-reviewer` is the non-Admin collaborator of the private repository:
    // Write grants read access without any administrator capability. His second
    // grant is on a repository of the organization and is removed together with
    // his organization membership. His Write grant on `alice-dev/acme-docs` makes
    // him the seeded non-author reviewer of the pull-request review scenarios
    // (REQ-6-3-3, REQ-6-3-4, REQ-6-4).
    repositoryGrants: [
      {
        repositoryId: secretResearch.id,
        subjectType: "account",
        subjectId: "account-bob-reviewer",
        role: "write",
        grantorId: "account-alice-dev",
        createdAt: "2024-02-21T09:00:00.000Z",
      },
      {
        repositoryId: acmeDocs.id,
        subjectType: "account",
        subjectId: "account-bob-reviewer",
        role: "write",
        grantorId: "account-alice-dev",
        createdAt: "2024-02-21T09:30:00.000Z",
      },
      {
        repositoryId: acmeInternal.id,
        subjectType: "account",
        subjectId: "account-bob-reviewer",
        role: "read",
        grantorId: "account-alice-dev",
        createdAt: "2024-02-19T09:00:00.000Z",
      },
      {
        repositoryId: acmeDocs.id,
        subjectType: "account",
        subjectId: "account-carol-dev",
        role: "write",
        grantorId: "account-alice-dev",
        createdAt: "2024-02-20T09:00:00.000Z",
      },
      {
        repositoryId: acmeOrganizationDocs.id,
        subjectType: "account",
        subjectId: "account-carol-dev",
        role: "write",
        grantorId: "account-alice-dev",
        createdAt: "2024-02-20T09:05:00.000Z",
      },
    ],
    repositories: [
      acmeDocs,
      secretResearch,
      acmeDocsFork,
      acmeOrganizationDocs,
      acmeInternal,
      bobNotes,
    ],
    // Planning data of REQ-5: label and milestone definitions belong to exactly
    // one repository, and every issue carries its repository-scoped number,
    // metadata, comments and append-only activity timeline.
    labels: [
      ...acmeDocsPlanningData.labels,
      ...organizationPlanningData.labels,
      ...internalPlanningData.labels,
      ...secretPlanningData.labels,
    ],
    milestones: [
      ...acmeDocsPlanningData.milestones,
      ...organizationPlanningData.milestones,
      ...internalPlanningData.milestones,
      ...secretPlanningData.milestones,
    ],
    issues: [
      ...acmeDocsPlanningData.issues,
      ...organizationPlanningData.issues,
      ...internalPlanningData.issues,
    ],
    // Pull requests (REQ-6). Only the repository that carries the seeded
    // `main`/`feature-search`/`release` branches holds the seeded pull requests.
    pullRequests: seedPullRequests(acmeDocs),
    // The `test` result of the current compare commit of the eligible merge seed
    // `Fix search` (REQ-6-5). The result belongs to one commit of one pull
    // request, so a new compare commit reads as `pending` again; every other
    // proposal starts without a stored result.
    pullRequestChecks: [
      {
        id: "check-acme-docs-2-test",
        pullRequestId: `pull-${acmeDocs.id}-2`,
        repositoryId: acmeDocs.id,
        commitId: acmeDocs.branches.find((branch) => branch.name === "feature-search")
          .headCommitId,
        name: "test",
        status: "success",
        setById: "account-alice-dev",
        setAt: "2024-02-28T09:30:00.000Z",
      },
    ],
    // Inline review comments on changed code lines (REQ-6-3-3): one record per
    // comment, anchored to a pull request, a file path, a compare commit and a
    // line position, with its own publication state.
    pullRequestInlineComments: [],
    // The merge restriction of the `main` branch of `alice-dev/acme-docs`
    // (REQ-6-1, REQ-6-5): both independent requirements are enabled, so a merge
    // into `main` needs one valid non-author approval of the current compare
    // commit and a successful `test` check. Writes to `main` itself are blocked
    // by the same rule, which is why the file-editor flows work on another
    // branch.
    branchProtectionRules: [
      {
        id: "rule-acme-docs-main",
        repositoryId: acmeDocs.id,
        branchName: "main",
        requireApproval: true,
        requireStatusCheck: true,
        createdBy: "alice-dev",
        createdAt: "2024-02-20T16:00:00.000Z",
        updatedBy: "alice-dev",
        updatedAt: "2024-02-20T16:00:00.000Z",
      },
    ],
  };
}
