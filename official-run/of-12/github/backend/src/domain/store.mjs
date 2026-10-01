import { join } from "node:path";

import { createJsonStore } from "../lib/json-store.mjs";
import { hashPassword } from "./passwords.mjs";

const SEED_CREATED_AT = "2024-01-01T00:00:00.000Z";
const SEED_BRANCH_AT = "2024-05-01T00:00:00.000Z";

/** Seed file content of the default branch of `acme-docs` (REQ-4-1, REQ-4-2). */
const ACME_DOCS_README_V1 =
  "# Acme Docs\n\nDraft notes\n\nDocumentation for the Acme Demo platform.\n";
const ACME_DOCS_README =
  "# Acme Docs\n\nDocumentation for the Acme Demo platform.\n\nThe search flow finds documentation across the repository.\n";
const ACME_DOCS_CONTRIBUTING = "# Contributing\n\nOpen an issue before sending a change.\n";
const ACME_DOCS_INTRO_V1 = "# Introduction\n\nThis is the introduction to the Acme Demo documentation.\n";
const ACME_DOCS_INTRO =
  "# Introduction\n\nThis is the introduction to the Acme Demo documentation.\n\nStart browsing from the Code page.\n";
/**
 * The code file the `Document search flow` commit added under `src/` (REQ-4-2-2
 * needs a known changed-file path and REQ-4-2-3 a readable match below `src/`).
 */
const ACME_DOCS_SEARCH_TS =
  "export function search(query: string): string {\n"
  + "  return `search flow for ${query}`;\n"
  + "}\n\nexport const SEARCH_FLOW_LABEL = \"Search flow\";\n";
const ACME_DOCS_MAIN_ONLY = "# Main-only notes\n\nThis file exists only on the feature-search branch.\n";
/**
 * The changed version of the code file on the head of `onboarding-docs`, so the
 * seeded public pull request modifies the known path `src/search.ts` and adds
 * one file (REQ-6-2, REQ-6-3-2). The comparison of that branch against `main`
 * is one added file of three lines and one modified file that drops one line,
 * so the aggregate the pull request spells is `3 additions, 1 deletions`.
 */
const ACME_DOCS_SEARCH_TS_V2 =
  "export function search(query: string): string {\n"
  + "  return `search flow for ${query}`;\n"
  + "}\n\n";
/** The file the head of `onboarding-docs` adds (REQ-6-3-2: one added file). */
const ACME_DOCS_ONBOARDING =
  "# Onboarding\n\nA short path from cloning the repository to the first contribution.\n";
/** The file the head of `draft-feature` adds — the draft pull request's diff. */
const ACME_DOCS_DRAFT_NOTES =
  "# Draft notes\n\nWork in progress notes for the onboarding draft.\n";

/**
 * The classification items of `acme-docs` (REQ-5): `bug` and `documentation`
 * are pre-existing colored label names of that repository and `Q3 launch` a
 * pre-existing milestone an issue can be associated with.
 */
const ACME_DOCS_LABELS = [
  { name: "bug", color: "d73a4a", description: "Something is not working" },
  { name: "documentation", color: "0075ca", description: "Improvements or additions to documentation" },
];

/**
 * A classification item of another repository (REQ-5-3-2, REQ-5-3-3): the
 * public organization repository `acme-web` carries its own labels and its own
 * milestone, one label even sharing the name `bug` with `acme-docs`, so a
 * selector that leaked across repositories would expose an item that does not
 * belong to the current repository.
 */
const ACME_WEB_LABELS = [
  { name: "bug", color: "d73a4a", description: "Something is not working" },
  { name: "frontend", color: "1d76db", description: "Work on the public website" },
];

/** A seeded branch: a named reference to one commit (REQ-4/REQ-4-1). */
function seedBranch(name, headId, { createdBy = "account-alice-dev", createdAt = SEED_BRANCH_AT } = {}) {
  return { name, headId, createdBy, createdAt };
}

/** A seeded commit: parent, author, message, time, changed files and snapshot. */
function seedCommit({
  id,
  message,
  createdAt,
  files,
  tree,
  parentId = null,
  branch = "main",
  authorId = "account-alice-dev",
  author = "alice-dev",
}) {
  return { id, message, authorId, author, branch, parentId, createdAt, files, tree };
}

/** Collections every document carries; older documents are normalized to them. */
const COLLECTIONS = [
  "accounts",
  "sessions",
  "organizations",
  "memberships",
  "teams",
  "teamMembers",
  "repositories",
  "issues",
  "pullRequests",
];

/**
 * Shared seed state.
 *
 * REQ-1 supplies the verified, sign-in-capable account `alice-dev`. REQ-2
 * adds the public organization `Acme Demo` (`acme-demo`): `alice-dev` is its
 * Owner, `bob-reviewer` is an ordinary member, `frontend-team` is a team of
 * the organization, and the organization owns a public repository plus a
 * distinct private repository visitors cannot read.
 *
 * REQ-3 states the ownership of its seeded repositories explicitly: the public
 * repository `acme-docs` and the private repository `secret-research` belong to
 * the individual account `alice-dev` (the personal namespace the repository
 * creation page selects by default), so both are account-owned repositories.
 * The organization keeps its own repositories (`acme-web` public with no
 * grant — the REQ-2-3 creation case — and `acme-internal` private with one
 * already saved grant: team `platform-team` holds Write — the REQ-2-3
 * replacement case). A public repository is readable and searchable without
 * sign-in; a private one is readable only by its owner or an explicitly
 * authorized subject (`bob-reviewer` holds Write on `secret-research`).
 *
 * REQ-2-2 adds the team hierarchy `platform-team` → `frontend-team` →
 * `frontend-child`, so a team with an existing parent, a selectable descendant
 * (the cycle scenario) and `platform-team` as a valid cycle-free parent are
 * all there. Passwords are hashed at seed time, so plain values never touch
 * disk.
 *
 * REQ-3-2-2 needs an existing fork name in the personal namespace the fork form
 * selects by default, used by the conflict case: `alice-dev/acme-docs-fork` is a
 * fork of the readable public `acme-docs`. It stays private so the
 * visitor-facing search and namespace lists of REQ-3-1 / REQ-3-3 keep returning
 * only the seeded public repository.
 *
 * REQ-4 gives every repository its branch and commit records. `acme-docs` has
 * the branches `main`, `feature-search` and `release`: `main` carries the nested directory
 * `docs` with the text file `docs/intro.md` inside it, the code file
 * `src/search.ts` and the commit `Document search flow` (which added
 * `src/search.ts` and modified `README.md` and `docs/intro.md`), while
 * `feature-search` carries `main-only.md` and does not carry the nested file, so
 * switching branches changes the file snapshot a page reads. Editing a file
 * appends a commit; the earlier snapshots stay. `release` is the second branch
 * of the default-branch scenario (REQ-4-3-3) and points at the same head commit
 * as `main`, so moving the default branch rewrites no history.
 *
 * REQ-5 stores the work items in the `issues` collection: `acme-docs` carries
 * the seeded open issue `Improve onboarding` and the seeded closed issue
 * `Legacy welcome text`, each with its labels, assignees, milestone, comments
 * and append-only activity timeline. Numbers are unique within a repository.
 */
export function createSeedData() {
  return {
    accounts: [
      {
        id: "account-alice-dev",
        username: "alice-dev",
        email: "alice.dev@example.test",
        emailVerified: true,
        status: "available",
        passwordHash: hashPassword("Valid-password-123!"),
        createdAt: SEED_CREATED_AT,
      },
      {
        id: "account-bob-reviewer",
        username: "bob-reviewer",
        email: "bob.reviewer@example.test",
        emailVerified: true,
        status: "available",
        passwordHash: hashPassword("Valid-password-123!"),
        createdAt: SEED_CREATED_AT,
      },
      // REQ-5-3-1: an eligible assignee of `acme-docs` who is not assigned to
      // any seeded issue yet, and the non-owner account that may maintain the
      // issues of the repository (REQ-5-3, REQ-5-4). Her access comes from the
      // direct grant below, not from organization membership.
      {
        id: "account-carol-maintainer",
        username: "carol-maintainer",
        email: "carol.maintainer@example.test",
        emailVerified: true,
        status: "available",
        passwordHash: hashPassword("Valid-password-123!"),
        createdAt: SEED_CREATED_AT,
      },
      // The account that is outside the collaborator scope of every seeded
      // repository: it holds no role anywhere, so it never appears as an
      // assignable member and never may comment on or review a pull request.
      {
        id: "account-dana-observer",
        username: "dana-observer",
        email: "dana.observer@example.test",
        emailVerified: true,
        status: "available",
        passwordHash: hashPassword("Valid-password-123!"),
        createdAt: SEED_CREATED_AT,
      },
    ],
    sessions: [],
    organizations: [
      {
        id: "organization-acme-demo",
        name: "acme-demo",
        displayName: "Acme Demo",
        createdAt: SEED_CREATED_AT,
      },
    ],
    memberships: [
      {
        id: "membership-alice-dev-acme-demo",
        organizationId: "organization-acme-demo",
        accountId: "account-alice-dev",
        role: "Owner",
        createdAt: SEED_CREATED_AT,
      },
      {
        id: "membership-bob-reviewer-acme-demo",
        organizationId: "organization-acme-demo",
        accountId: "account-bob-reviewer",
        role: "Member",
        createdAt: SEED_CREATED_AT,
      },
    ],
    teams: [
      {
        id: "team-platform-team",
        organizationId: "organization-acme-demo",
        name: "platform-team",
        description: "Platform owners for Acme Demo",
        parentTeamId: null,
        createdBy: "account-alice-dev",
        createdAt: SEED_CREATED_AT,
      },
      {
        id: "team-frontend-team",
        organizationId: "organization-acme-demo",
        name: "frontend-team",
        description: "Reviewers for the Acme Demo frontend",
        // Stored as the parent team id while the team tree displays the
        // parent team name `platform-team`.
        parentTeamId: "team-platform-team",
        createdBy: "account-alice-dev",
        createdAt: SEED_CREATED_AT,
      },
      {
        id: "team-frontend-child",
        organizationId: "organization-acme-demo",
        name: "frontend-child",
        description: "A descendant team of the Acme Demo frontend team",
        parentTeamId: "team-frontend-team",
        createdBy: "account-alice-dev",
        createdAt: SEED_CREATED_AT,
      },
    ],
    // Membership of a team is an independent relationship: `bob-reviewer`
    // belongs to the organization but not to `frontend-team` yet.
    teamMembers: [],
    repositories: [
      {
        id: "repository-alice-dev-acme-docs",
        ownerType: "user",
        ownerId: "account-alice-dev",
        name: "acme-docs",
        description: "Documentation for the Acme Demo platform",
        visibility: "public",
        defaultBranch: "main",
        createdAt: SEED_CREATED_AT,
        updatedAt: "2024-06-01T00:00:00.000Z",
        createdBy: "account-alice-dev",
        // REQ-5-3-1: `carol-maintainer` holds a direct Maintain grant, so she
        // is an assignable member of this repository. REQ-6-3: `bob-reviewer`
        // is the seeded non-author reviewer of the repository's pull requests
        // and holds a direct Write grant, so he may comment on a changed line
        // and submit a review decision.
        grants: [
          {
            id: "grant-acme-docs-carol-maintainer",
            subjectType: "account",
            subjectId: "account-carol-maintainer",
            role: "Maintain",
            grantedBy: "account-alice-dev",
            createdAt: SEED_CREATED_AT,
          },
          {
            id: "grant-acme-docs-bob-reviewer",
            subjectType: "account",
            subjectId: "account-bob-reviewer",
            role: "Write",
            grantedBy: "account-alice-dev",
            createdAt: SEED_CREATED_AT,
          },
        ],
        // REQ-5: the pre-existing classification items of this repository:
        // the colored labels `bug` and `documentation` and the milestones
        // `Q3 launch` and `v1.0`. An issue of this repository may reference
        // them, and neither changes the content or the status of an issue.
        labels: ACME_DOCS_LABELS.map((label) => ({ ...label })),
        milestones: [
          {
            id: "milestone-acme-docs-q3-launch",
            title: "Q3 launch",
            description: "Documentation goals for the Q3 launch",
            state: "open",
            createdAt: SEED_CREATED_AT,
          },
          {
            id: "milestone-acme-docs-v1-0",
            title: "v1.0",
            description: "Documentation goals for the first release",
            state: "open",
            createdAt: SEED_CREATED_AT,
          },
        ],
        // REQ-4-1: the branches `main` and `feature-search`, the nested
        // directory `docs` holding the text file `docs/intro.md`, and the
        // commit `Document search flow` on the default branch (REQ-4-2: the
        // newest commit of `main`, adding `src/search.ts` and modifying
        // `README.md` and `docs/intro.md`).
        branches: [
          seedBranch("main", "9c3e5b1-acme-docs-document-search-flow"),
          seedBranch("feature-search", "d7b2a08-acme-docs-branch-notes"),
          // REQ-4-3-3: `release` is a second existing branch an administrator
          // can move the default to. It points at the current default-branch
          // head, so changing the default branch moves no commit.
          seedBranch("release", "9c3e5b1-acme-docs-document-search-flow"),
          // REQ-6-2: `onboarding-docs` carries the changes of the seeded public
          // pull request — it is one commit ahead of `main` and modifies the
          // known path `src/search.ts`. `draft-feature` carries the changes of
          // the seeded draft pull request. Neither pair is used by another
          // open or draft pull request of `main` ← `feature-search`, so the
          // comparison of that pair stays a valid creation context.
          seedBranch("onboarding-docs", "c5d8f41-acme-docs-onboarding-notes"),
          seedBranch("draft-feature", "a71b3e6-acme-docs-draft-notes"),
        ],
        commits: [
          seedCommit({
            id: "4a1f7c2-acme-docs-initial",
            message: "Initial commit",
            createdAt: "2024-05-01T00:00:00.000Z",
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
          }),
          seedCommit({
            id: "9c3e5b1-acme-docs-document-search-flow",
            message: "Document search flow",
            parentId: "4a1f7c2-acme-docs-initial",
            createdAt: "2024-06-01T00:00:00.000Z",
            // The newest commit of the default branch: it adds the code file
            // `src/search.ts` and modifies two readable files, so REQ-4-2-2 has
            // a commit with added and modified files whose parent is reachable.
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
          }),
          // `feature-search` starts from the `main` head, adds `main-only.md`
          // — the file only that branch carries (REQ-4-3-1) — and drops one
          // line of `src/search.ts`. Comparing `main` with it therefore shows
          // one added file and one modified file with `3 additions, 1
          // deletions`, the change the seeded pull request `Fix search`
          // carries (REQ-6-2-2, REQ-6-3-2).
          seedCommit({
            id: "d7b2a08-acme-docs-branch-notes",
            message: "Add branch-only notes",
            branch: "feature-search",
            parentId: "9c3e5b1-acme-docs-document-search-flow",
            createdAt: "2024-06-02T00:00:00.000Z",
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
          }),
          // The head of `onboarding-docs`: one commit ahead of the `main` head,
          // adding `docs/onboarding.md` and modifying `src/search.ts`, so the
          // seeded public pull request shows one added and one modified file
          // and spells the known changed-file path verbatim (REQ-6-3-2).
          seedCommit({
            id: "c5d8f41-acme-docs-onboarding-notes",
            message: "Draft the onboarding notes",
            branch: "onboarding-docs",
            parentId: "9c3e5b1-acme-docs-document-search-flow",
            createdAt: "2024-06-03T00:00:00.000Z",
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
          }),
          // The head of `draft-feature`: the compare branch of the draft pull
          // request, one commit ahead of `main`.
          seedCommit({
            id: "a71b3e6-acme-docs-draft-notes",
            message: "Start the onboarding draft",
            branch: "draft-feature",
            parentId: "9c3e5b1-acme-docs-document-search-flow",
            createdAt: "2024-06-04T00:00:00.000Z",
            files: [{ path: "docs/draft-notes.md", change: "added" }],
            tree: [
              { path: "README.md", content: ACME_DOCS_README },
              { path: "CONTRIBUTING.md", content: ACME_DOCS_CONTRIBUTING },
              { path: "docs/intro.md", content: ACME_DOCS_INTRO },
              { path: "docs/draft-notes.md", content: ACME_DOCS_DRAFT_NOTES },
              { path: "src/search.ts", content: ACME_DOCS_SEARCH_TS },
            ],
          }),
        ],
      },
      {
        id: "repository-alice-dev-secret-research",
        ownerType: "user",
        ownerId: "account-alice-dev",
        name: "secret-research",
        description: "Private research notes for the Acme Demo platform",
        visibility: "private",
        defaultBranch: "main",
        createdAt: SEED_CREATED_AT,
        updatedAt: "2024-05-01T00:00:00.000Z",
        createdBy: "account-alice-dev",
        // The distinct non-Admin collaborator of REQ-3-4: a private personal
        // repository is readable only by its owner and subjects granted here.
        grants: [
          {
            id: "grant-secret-research-bob-reviewer",
            subjectType: "account",
            subjectId: "account-bob-reviewer",
            role: "Write",
            grantedBy: "account-alice-dev",
            createdAt: SEED_CREATED_AT,
          },
        ],
        branches: [seedBranch("main", "e1c9f34-secret-research-initial")],
        commits: [
          seedCommit({
            id: "e1c9f34-secret-research-initial",
            message: "Initial commit",
            createdAt: "2024-05-01T00:00:00.000Z",
            files: [
              { path: "README.md", change: "added" },
              { path: "research/notes.md", change: "added" },
            ],
            tree: [
              { path: "README.md", content: "# Secret Research\n\nFindings that are not ready to be published.\n" },
              // The term below also lives in this private repository, so a code
              // search that leaks across repositories would expose it.
              {
                path: "research/notes.md",
                content: "# Notes\n\nEarly research notes.\n\nThe private search flow notes must not leak.\n",
              },
            ],
          }),
        ],
      },
      {
        id: "repository-alice-dev-acme-docs-fork",
        ownerType: "user",
        ownerId: "account-alice-dev",
        name: "acme-docs-fork",
        description: "A private fork of acme-docs used for experiments",
        visibility: "private",
        defaultBranch: "main",
        createdAt: SEED_CREATED_AT,
        updatedAt: "2024-06-02T00:00:00.000Z",
        createdBy: "account-alice-dev",
        // REQ-3-2-2: the fork conflict seed. The source identifier is stored so
        // the fork overview can spell "Forked from acme-docs" after a reload.
        sourceRepositoryId: "repository-alice-dev-acme-docs",
        forkedAt: SEED_CREATED_AT,
        grants: [],
        branches: [seedBranch("main", "2f6d1ba-acme-docs-fork-initial")],
        commits: [
          seedCommit({
            id: "2f6d1ba-acme-docs-fork-initial",
            message: "Initial commit",
            createdAt: SEED_BRANCH_AT,
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
          }),
        ],
      },
      {
        id: "repository-acme-web",
        ownerType: "organization",
        ownerId: "organization-acme-demo",
        name: "acme-web",
        description: "Public website of the Acme Demo platform",
        visibility: "public",
        defaultBranch: "main",
        createdAt: SEED_CREATED_AT,
        updatedAt: "2024-04-01T00:00:00.000Z",
        createdBy: "account-alice-dev",
        // REQ-2-3 creation case: a repository without any direct grant. It
        // carries its own classification items (REQ-5-3): a label sharing the
        // name `bug` with `acme-docs`, a label of its own and its own
        // milestone, none of which may appear in a selector of another
        // repository.
        grants: [],
        labels: ACME_WEB_LABELS.map((label) => ({ ...label })),
        milestones: [
          {
            id: "milestone-acme-web-launch",
            title: "Web launch",
            description: "Goals for the Acme Web launch",
            state: "open",
            createdAt: SEED_CREATED_AT,
          },
        ],
        branches: [seedBranch("main", "8b4c0e7-acme-web-initial")],
        commits: [
          seedCommit({
            id: "8b4c0e7-acme-web-initial",
            message: "Initial commit",
            createdAt: "2024-04-01T00:00:00.000Z",
            files: [{ path: "README.md", change: "added" }],
            tree: [
              { path: "README.md", content: "# Acme Web\n\nThe public website of the Acme Demo platform.\n" },
            ],
          }),
        ],
      },
      {
        // REQ-6-5: the dedicated repository of the merge scenarios. Its `main`
        // branch carries the two protection requirements, so the merge of an
        // eligible pull request is gated by them; it stays a repository of its
        // own, because `acme-docs` keeps its `main` free of any rule so the
        // branch-protection scenario can still create the first one.
        id: "repository-alice-dev-merge-lab",
        ownerType: "user",
        ownerId: "account-alice-dev",
        name: "merge-lab",
        description: "Merge experiments for the Acme Demo platform",
        visibility: "public",
        defaultBranch: "main",
        createdAt: SEED_CREATED_AT,
        updatedAt: "2024-06-20T00:00:00.000Z",
        createdBy: "account-alice-dev",
        // `carol-maintainer` is the seeded Maintain account of the merge
        // scenarios and `bob-reviewer` the non-author reviewer whose approval
        // satisfies the approval requirement of the eligible pull request.
        grants: [
          {
            id: "grant-merge-lab-carol-maintainer",
            subjectType: "account",
            subjectId: "account-carol-maintainer",
            role: "Maintain",
            grantedBy: "account-alice-dev",
            createdAt: SEED_CREATED_AT,
          },
          {
            id: "grant-merge-lab-bob-reviewer",
            subjectType: "account",
            subjectId: "account-bob-reviewer",
            role: "Write",
            grantedBy: "account-alice-dev",
            createdAt: SEED_CREATED_AT,
          },
        ],
        labels: [],
        milestones: [],
        branches: [
          seedBranch("main", "7e2b9c1-merge-lab-initial"),
          seedBranch("feature-merge", "b4d8f30-merge-lab-release-notes"),
          seedBranch("feature-blocked", "c7a1e58-merge-lab-checklist"),
          seedBranch("feature-pending", "d9f3b24-merge-lab-process"),
        ],
        commits: [
          seedCommit({
            id: "7e2b9c1-merge-lab-initial",
            message: "Initial commit",
            createdAt: "2024-06-16T00:00:00.000Z",
            files: [{ path: "README.md", change: "added" }],
            tree: [
              { path: "README.md", content: "# Merge Lab\n\nRelease notes for the Acme Demo platform.\n" },
            ],
          }),
          seedCommit({
            id: "b4d8f30-merge-lab-release-notes",
            message: "Write the release notes",
            branch: "feature-merge",
            parentId: "7e2b9c1-merge-lab-initial",
            createdAt: "2024-06-17T00:00:00.000Z",
            files: [{ path: "RELEASE-NOTES.md", change: "added" }],
            tree: [
              { path: "README.md", content: "# Merge Lab\n\nRelease notes for the Acme Demo platform.\n" },
              { path: "RELEASE-NOTES.md", content: "# Release notes\n\nThe first release ships the merge control.\n" },
            ],
          }),
          seedCommit({
            id: "c7a1e58-merge-lab-checklist",
            message: "Draft the merge checklist",
            branch: "feature-blocked",
            parentId: "7e2b9c1-merge-lab-initial",
            createdAt: "2024-06-18T00:00:00.000Z",
            files: [{ path: "docs/checklist.md", change: "added" }],
            tree: [
              { path: "README.md", content: "# Merge Lab\n\nRelease notes for the Acme Demo platform.\n" },
              { path: "docs/checklist.md", content: "# Merge checklist\n\n- [ ] Ask for a review\n" },
            ],
          }),
          seedCommit({
            id: "d9f3b24-merge-lab-process",
            message: "Describe the release process",
            branch: "feature-pending",
            parentId: "7e2b9c1-merge-lab-initial",
            createdAt: "2024-06-19T00:00:00.000Z",
            files: [{ path: "docs/process.md", change: "added" }],
            tree: [
              { path: "README.md", content: "# Merge Lab\n\nRelease notes for the Acme Demo platform.\n" },
              { path: "docs/process.md", content: "# Release process\n\nDescribe how a release is prepared.\n" },
            ],
          }),
        ],
        // REQ-6-5: `main` is protected by both independently selectable
        // requirements, so the eligible pull request needs 1 valid non-author
        // approval and a successful `test` check before it may merge.
        protectionRules: [
          {
            id: "rule-merge-lab-main",
            pattern: "main",
            requireApproval: true,
            requireStatusCheck: true,
            createdBy: "alice-dev",
            createdById: "account-alice-dev",
            createdAt: "2024-06-20T08:00:00.000Z",
            updatedBy: "alice-dev",
            updatedAt: "2024-06-20T08:00:00.000Z",
          },
        ],
      },
      {
        id: "repository-acme-internal",
        ownerType: "organization",
        ownerId: "organization-acme-demo",
        name: "acme-internal",
        description: "Private internal notes for the Acme Demo organization",
        visibility: "private",
        defaultBranch: "main",
        createdAt: SEED_CREATED_AT,
        updatedAt: "2024-05-01T00:00:00.000Z",
        createdBy: "account-alice-dev",
        // REQ-2-3: an already saved team grant the replacement scenario can
        // change.
        grants: [
          {
            id: "grant-acme-internal-platform-team",
            subjectType: "team",
            subjectId: "team-platform-team",
            role: "Write",
            grantedBy: "account-alice-dev",
            createdAt: SEED_CREATED_AT,
          },
        ],
        branches: [seedBranch("main", "5d0a93c-acme-internal-initial")],
        commits: [
          seedCommit({
            id: "5d0a93c-acme-internal-initial",
            message: "Initial commit",
            createdAt: "2024-05-01T00:00:00.000Z",
            files: [{ path: "README.md", change: "added" }],
            tree: [
              { path: "README.md", content: "# Internal notes\n\nPrivate notes of the Acme Demo organization.\n" },
            ],
          }),
        ],
      },
    ],
    // REQ-5: the work items of `acme-docs` live in their own collection and
    // reference the repository by its id. Issue 1 is the seeded open issue a
    // visitor can read (title, description, metadata and discussion), issue 2
    // the seeded closed one; both carry the label `bug`, so a label filter
    // finds them. Every issue keeps its comments and its append-only activity
    // timeline next to it, and the numbers are unique within the repository.
    issues: [
      {
        id: "issue-acme-docs-1",
        repositoryId: "repository-alice-dev-acme-docs",
        number: 1,
        title: "Improve onboarding",
        body: "Describe the onboarding improvement.",
        status: "open",
        authorId: "account-alice-dev",
        author: "alice-dev",
        labels: ["bug", "documentation"],
        assignees: ["bob-reviewer"],
        milestone: "Q3 launch",
        createdAt: "2024-06-05T09:00:00.000Z",
        updatedAt: "2024-06-06T10:00:00.000Z",
        reactions: [],
        comments: [
          {
            id: "comment-acme-docs-1-1",
            authorId: "account-bob-reviewer",
            author: "bob-reviewer",
            body: "Great idea. Let us start with the welcome screen.",
            createdAt: "2024-06-06T10:00:00.000Z",
          },
        ],
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
            id: "event-acme-docs-1-labeled-documentation",
            type: "labeled",
            actor: "alice-dev",
            text: "added the documentation label",
            createdAt: "2024-06-05T09:06:00.000Z",
          },
          {
            id: "event-acme-docs-1-milestoned",
            type: "milestoned",
            actor: "alice-dev",
            text: "added this issue to the Q3 launch milestone",
            createdAt: "2024-06-05T09:10:00.000Z",
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
        id: "issue-acme-docs-2",
        repositoryId: "repository-alice-dev-acme-docs",
        number: 2,
        title: "Legacy welcome text",
        body: "The welcome text still names the retired demo environment.",
        status: "closed",
        authorId: "account-bob-reviewer",
        author: "bob-reviewer",
        labels: ["bug"],
        assignees: [],
        milestone: null,
        createdAt: "2024-05-20T08:00:00.000Z",
        updatedAt: "2024-05-28T16:00:00.000Z",
        reactions: [],
        comments: [],
        timeline: [
          {
            id: "event-acme-docs-2-created",
            type: "created",
            actor: "bob-reviewer",
            text: "opened this issue",
            createdAt: "2024-05-20T08:00:00.000Z",
          },
          {
            id: "event-acme-docs-2-labeled-bug",
            type: "labeled",
            actor: "alice-dev",
            text: "added the bug label",
            createdAt: "2024-05-21T09:00:00.000Z",
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
      // REQ-5-2-2: the invalid-edit seed — a separate issue whose original
      // title `Original issue title` must survive a rejected save. It carries no
      // label, assignee or milestone, so the REQ-5-1-1 label filter keeps
      // returning only the issues that really have the label.
      {
        id: "issue-acme-docs-3",
        repositoryId: "repository-alice-dev-acme-docs",
        number: 3,
        title: "Original issue title",
        body: "The original description of the seeded issue.",
        status: "open",
        authorId: "account-alice-dev",
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
      // REQ-5-4: the protected work item. It lives in the private repository
      // `secret-research`, where `bob-reviewer` holds a role that lets him
      // read it without being allowed to manage it: he sees the content and
      // neither a close nor a reopen control. The visitor cannot read it at
      // all.
      {
        id: "issue-secret-research-1",
        repositoryId: "repository-alice-dev-secret-research",
        number: 1,
        title: "Summarize the early findings",
        body: "Draft the summary of the research notes before publishing.",
        status: "open",
        authorId: "account-alice-dev",
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
      // REQ-5-3: an isolated work item for the metadata operations. It starts
      // Open with no assignee, no label and no milestone, so an assignable
      // member is not assigned yet, both labels of the repository are still
      // unapplied and both milestones are still free — the initial state of
      // the metadata scenarios is not shared with the read-only seed above.
      {
        id: "issue-acme-docs-4",
        repositoryId: "repository-alice-dev-acme-docs",
        number: 4,
        title: "Add changelog page",
        body: "Collect the released changes on one page.",
        status: "open",
        authorId: "account-alice-dev",
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
    ],
    // REQ-6 / REQ-6-1: the pull requests of `acme-docs`. They live in their own
    // collection and reference the repository by its id, exactly like an issue.
    pullRequests: [...seedPullRequests(), ...seedMergeLabPullRequests()],
  };
}

/**
 * The seeded pull requests of `acme-docs` (REQ-6, REQ-6-1, REQ-6-2).
 *
 * A pull request proposes to merge the changes of its compare branch into its
 * base branch; it is not a branch, a commit or an issue, so it carries its own
 * repository-scoped number and status next to the creation-time and current
 * compare commits.
 *
 * `Improve onboarding` is the stable, uniquely titled Open pull request a
 * visitor of the public repository reads on the Pull requests page; it targets
 * `main` from `onboarding-docs` and holds no stored check result, so the `test`
 * check of its current compare commit starts pending (REQ-6-1). `Fix search` is
 * the seeded Closed pull request of the same list, authored by the same account
 * the filtering scenario narrows the list to. `Draft onboarding update` is the
 * separate ready-for-review seed pull request: it belongs to `alice-dev`, is
 * Draft, targets `main` from `draft-feature` and has no submitted review.
 *
 * The pair `main` ← `feature-search` carries no Draft or Open pull request, so
 * it stays a valid comparison and creation context for the PR flows.
 */
function seedPullRequests() {
  const created = "2024-06-10T09:00:00.000Z";
  const commented = "2024-06-10T11:00:00.000Z";
  const closedAt = "2024-06-12T09:00:00.000Z";
  return [
    {
      id: "pull-request-acme-docs-1",
      repositoryId: "repository-alice-dev-acme-docs",
      number: 1,
      title: "Improve onboarding",
      description: "Rewrite the onboarding notes so a new contributor can start quickly.",
      authorId: "account-alice-dev",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "onboarding-docs",
      baseCommitId: "9c3e5b1-acme-docs-document-search-flow",
      compareCommitId: "c5d8f41-acme-docs-onboarding-notes",
      currentCompareCommitId: "c5d8f41-acme-docs-onboarding-notes",
      // REQ-6-4: the Open pull request of the signed-in author starts without a
      // pending-review relationship, so the Reviewers area exercises the
      // request/remove cycle entirely through the documented controls (asking
      // for a review grants no decision and no approval by itself).
      reviewers: [],
      reviews: [],
      // REQ-6-3-1: the seeded discussion of the public pull request — one
      // ordinary comment with no code location, next to its description.
      comments: [
        {
          id: "comment-acme-docs-pull-1-1",
          authorId: "account-bob-reviewer",
          author: "bob-reviewer",
          body: "The onboarding steps read much better now. Please add a screenshot of the first run.",
          createdAt: commented,
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
          createdAt: created,
        },
        {
          id: "event-acme-docs-pull-1-commented",
          type: "commented",
          actor: "bob-reviewer",
          text: "commented",
          createdAt: commented,
        },
      ],
      createdAt: created,
      updatedAt: commented,
    },
    {
      id: "pull-request-acme-docs-2",
      repositoryId: "repository-alice-dev-acme-docs",
      number: 2,
      title: "Fix search",
      description: "Correct the search snippets on the documentation page.",
      authorId: "account-alice-dev",
      author: "alice-dev",
      status: "closed",
      baseBranch: "main",
      compareBranch: "feature-search",
      baseCommitId: "9c3e5b1-acme-docs-document-search-flow",
      compareCommitId: "d7b2a08-acme-docs-branch-notes",
      currentCompareCommitId: "d7b2a08-acme-docs-branch-notes",
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
          createdAt: closedAt,
        },
      ],
      createdAt: "2024-06-11T09:00:00.000Z",
      updatedAt: closedAt,
    },
    {
      // REQ-6-2-4: the dedicated ready-for-review seed pull request. It is
      // separate from the draft creation flow, belongs to the supplied author,
      // carries no requested reviewer and no submitted review, and spells its
      // title and both branches verbatim on its detail page.
      id: "pull-request-acme-docs-3",
      repositoryId: "repository-alice-dev-acme-docs",
      number: 3,
      title: "Draft onboarding update",
      description: "Collect the onboarding screenshots before asking for a review.",
      authorId: "account-alice-dev",
      author: "alice-dev",
      status: "draft",
      baseBranch: "main",
      compareBranch: "draft-feature",
      baseCommitId: "9c3e5b1-acme-docs-document-search-flow",
      compareCommitId: "a71b3e6-acme-docs-draft-notes",
      currentCompareCommitId: "a71b3e6-acme-docs-draft-notes",
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
      // REQ-6-3-3 and REQ-6-3-4: an Open pull request of the same repository
      // that carries changed lines and no decision of `bob-reviewer` yet, so an
      // inline comment may be published on it and an Approve may be recorded
      // without touching the seeded discussion of the first pull request.
      id: "pull-request-acme-docs-4",
      repositoryId: "repository-alice-dev-acme-docs",
      number: 4,
      title: "Add onboarding notes for the release",
      description: "Carry the onboarding notes into the release branch.",
      authorId: "account-alice-dev",
      author: "alice-dev",
      status: "open",
      baseBranch: "release",
      compareBranch: "onboarding-docs",
      baseCommitId: "9c3e5b1-acme-docs-document-search-flow",
      compareCommitId: "c5d8f41-acme-docs-onboarding-notes",
      currentCompareCommitId: "c5d8f41-acme-docs-onboarding-notes",
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
      // REQ-6-3-3 scenario 2 and REQ-6-3-4 scenario 2: the second Open pull
      // request, whose review workspace stays free of the records the first one
      // collects.
      id: "pull-request-acme-docs-5",
      repositoryId: "repository-alice-dev-acme-docs",
      number: 5,
      title: "Add draft notes for the release",
      description: "Carry the draft notes into the release branch.",
      authorId: "account-alice-dev",
      author: "alice-dev",
      status: "open",
      baseBranch: "release",
      compareBranch: "draft-feature",
      baseCommitId: "9c3e5b1-acme-docs-document-search-flow",
      compareCommitId: "a71b3e6-acme-docs-draft-notes",
      currentCompareCommitId: "a71b3e6-acme-docs-draft-notes",
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
 * The seeded pull requests of `merge-lab` (REQ-6-5).
 *
 * All three are Open proposals of `alice-dev` into the protected `main` branch
 * of the repository, and each one carries a distinct merge state:
 *
 * - `Merge the release notes` is the eligible pull request: `bob-reviewer`
 *   approved its current compare commit and the `test` check of that commit is
 *   `success`, so both requirements of the branch protection rule are met and
 *   the merge entry is enabled.
 * - `Update the merge checklist` is the blocked pull request: the compare
 *   commit carries no valid non-author approval while its check is already
 *   `success`, so its disabled merge entry is explained by the missing approval
 *   alone.
 * - `Document the release process` is the pull request whose current compare
 *   commit still has no stored check result, so its Checks area reads
 *   `test: pending`.
 *
 * No seeded pull request of this repository starts with a pending-review
 * relationship, so the Reviewers area exercises the request/remove cycle
 * through the documented controls (REQ-6-4).
 */
function seedMergeLabPullRequests() {
  const created = "2024-06-21T09:00:00.000Z";
  const approved = "2024-06-21T11:00:00.000Z";
  const checked = "2024-06-21T12:00:00.000Z";
  return [
    {
      id: "pull-request-merge-lab-1",
      repositoryId: "repository-alice-dev-merge-lab",
      number: 1,
      title: "Merge the release notes",
      description: "Publish the release notes of the first release.",
      authorId: "account-alice-dev",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "feature-merge",
      baseCommitId: "7e2b9c1-merge-lab-initial",
      compareCommitId: "b4d8f30-merge-lab-release-notes",
      currentCompareCommitId: "b4d8f30-merge-lab-release-notes",
      reviewers: [],
      // The one valid non-author approval of the current compare commit; the
      // approval requirement of the protected branch is satisfied by it.
      reviews: [
        {
          id: "review-merge-lab-1-1",
          reviewerId: "account-bob-reviewer",
          reviewer: "bob-reviewer",
          decision: "approve",
          summary: "The release notes read well.",
          commitId: "b4d8f30-merge-lab-release-notes",
          createdAt: approved,
        },
      ],
      comments: [],
      reviewComments: [],
      checks: [
        {
          id: "check-merge-lab-1-test",
          name: "test",
          commitId: "b4d8f30-merge-lab-release-notes",
          status: "success",
          setBy: "alice-dev",
          setById: "account-alice-dev",
          setAt: checked,
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
        {
          id: "event-merge-lab-pull-1-reviewed",
          type: "reviewed",
          actor: "bob-reviewer",
          text: "Approved",
          createdAt: approved,
        },
        {
          id: "event-merge-lab-pull-1-checked",
          type: "checks",
          actor: "alice-dev",
          text: "set the test check to success",
          createdAt: checked,
        },
      ],
      createdAt: created,
      updatedAt: checked,
    },
    {
      // The blocked merge candidate: a successful check without the required
      // non-author approval, so its merge entry is disabled and explained by
      // `Review required by branch protection` alone.
      id: "pull-request-merge-lab-2",
      repositoryId: "repository-alice-dev-merge-lab",
      number: 2,
      title: "Update the merge checklist",
      description: "Refresh the merge checklist of the release process.",
      authorId: "account-alice-dev",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "feature-blocked",
      baseCommitId: "7e2b9c1-merge-lab-initial",
      compareCommitId: "c7a1e58-merge-lab-checklist",
      currentCompareCommitId: "c7a1e58-merge-lab-checklist",
      reviewers: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      checks: [
        {
          id: "check-merge-lab-2-test",
          name: "test",
          commitId: "c7a1e58-merge-lab-checklist",
          status: "success",
          setBy: "alice-dev",
          setById: "account-alice-dev",
          setAt: "2024-06-21T13:00:00.000Z",
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
      // The pull request whose current compare commit carries no stored check
      // result yet, so its Checks area reads `test: pending` for an Admin.
      id: "pull-request-merge-lab-3",
      repositoryId: "repository-alice-dev-merge-lab",
      number: 3,
      title: "Document the release process",
      description: "Describe how a release is prepared.",
      authorId: "account-alice-dev",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "feature-pending",
      baseCommitId: "7e2b9c1-merge-lab-initial",
      compareCommitId: "d9f3b24-merge-lab-process",
      currentCompareCommitId: "d9f3b24-merge-lab-process",
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

function normalizeDocument(data) {
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(data[collection])) data[collection] = [];
  }
  return data;
}

export function createAppStore(dataDir) {
  const store = createJsonStore(join(dataDir, "data.json"), createSeedData());
  return {
    read: async () => normalizeDocument(await store.read()),
    update: (mutator) => store.update((draft) => mutator(normalizeDocument(draft))),
  };
}
