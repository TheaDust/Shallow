/**
 * Seed fixture for the in-memory fake API: the accounts, organizations and
 * personal repositories that mirror the real backend seed. `fake-api.ts`
 * re-exports all of it, so tests keep importing the constants from there.
 */
export interface FakeAccount {
  id: string;
  username: string;
  email: string;
  password: string;
}

export interface FakeTeam {
  id: string;
  slug: string;
  parent: string | null;
}

export interface FakeCommitChange {
  path: string;
  /** The file content introduced by the change; `null` removes the file. */
  content: string | null;
}

export interface FakeCommit {
  message: string;
  author?: string;
  createdAt?: string;
  changes?: FakeCommitChange[];
}

/** One branch of the fake store: its own history and its own file snapshot. */
export interface FakeBranch {
  name: string;
  files: Array<{ path: string; content: string }>;
  commits: FakeCommit[];
}

export interface FakeRepository {
  id: string;
  ownerType: "account" | "organization";
  /** Organization slug or account username; the URL identifier of the owner. */
  ownerLogin: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
  branches: FakeBranch[];
  forkedFrom?: { ownerLogin: string; name: string };
}

/** A branch of a seeded repository; `base` continues from an earlier branch. */
export interface FakeBranchSeed {
  name: string;
  base?: string;
  files?: Array<{ path: string; content: string }>;
  commits?: FakeCommit[];
}

export interface FakeGrant {
  id: string;
  repositoryName: string;
  subjectType: "account" | "team";
  subjectName: string;
  role: string;
  /** Set on grants stored for a personal namespace. */
  ownerLogin?: string;
}

export interface FakeOrganization {
  id: string;
  slug: string;
  displayName: string;
  members: Array<{ accountId: string; role: "owner" | "member" }>;
  teams: FakeTeam[];
  teamMembers: Array<{ teamSlug: string; accountId: string }>;
  repositories: FakeRepository[];
  repositoryGrants: FakeGrant[];
}

export interface FakeOrganizationSeed {
  slug: string;
  displayName: string;
  members: Array<{ username: string; role: "owner" | "member" }>;
  teams: Array<{ slug: string; parent: string | null }>;
  repositories: Array<{
    name: string;
    description: string;
    visibility: "public" | "private";
    defaultBranch?: string;
    updatedAt: string;
    files?: Array<{ path: string; content: string }>;
    commits?: FakeCommit[];
    branches?: FakeBranchSeed[];
    grants?: Array<{ type: "account" | "team"; name: string; role: string }>;
  }>;
}

/** A repository of a personal namespace (an individual account’s own space). */
export interface FakePersonalRepositorySeed {
  owner: string;
  name: string;
  description?: string;
  visibility: "public" | "private";
  defaultBranch?: string;
  updatedAt?: string;
  files?: Array<{ path: string; content: string }>;
  commits?: FakeCommit[];
  branches?: FakeBranchSeed[];
  forkedFrom?: { ownerLogin: string; name: string };
}

/**
 * The two revisions of the seeded `src/search.ts`, mirroring the backend seed:
 * the commit detail of `acme-docs` must have real additions and deletions.
 */
const SEARCH_FILE_FIRST_REVISION = [
  "export function searchDocuments(query: string) {",
  "  const results = [];",
  "  results.push(query);",
  "  return results;",
  "}",
  "",
].join("\n");

const SEARCH_FILE_SECOND_REVISION = [
  "import { searchIndex } from \"./index\";",
  "",
  "export function searchDocuments(query: string) {",
  "  const results = searchIndex(query);",
  "  return results;",
  "}",
  "",
].join("\n");

/** Mirrors the real seed accounts used by the acceptance scenarios. */
export const DEFAULT_ACCOUNTS: FakeAccount[] = [
  { id: "account-alice", username: "alice-dev", email: "alice.dev@example.test", password: "Valid-password-123!" },
  { id: "account-org-owner", username: "org-owner", email: "org-owner@example.test", password: "Valid-password-123!" },
  { id: "account-team-maintainer", username: "team-maintainer", email: "team-maintainer@example.test", password: "Valid-password-123!" },
  { id: "account-bob", username: "bob-reviewer", email: "bob-reviewer@example.test", password: "Valid-password-123!" },
  { id: "account-new-member", username: "new-member", email: "new-member@example.test", password: "Valid-password-123!" },
  { id: "account-existing-member", username: "existing-member", email: "existing-member@example.test", password: "Valid-password-123!" },
  { id: "account-org-member", username: "org-member", email: "org-member@example.test", password: "Valid-password-123!" },
  { id: "account-protected-member", username: "protected-member", email: "protected-member@example.test", password: "Valid-password-123!" },
  { id: "account-repo-admin", username: "repo-admin", email: "repo-admin@example.test", password: "Valid-password-123!" },
  { id: "account-visibility-admin", username: "visibility-admin", email: "visibility-admin@example.test", password: "Valid-password-123!" },
  { id: "account-collaborator", username: "collaborator", email: "collaborator@example.test", password: "Valid-password-123!" },
  { username: "repo-owner", id: "account-repo-owner", email: "repo-owner@example.test", password: "Valid-password-123!" },
  { username: "fork-user", id: "account-fork-user", email: "fork-user@example.test", password: "Valid-password-123!" },
  { username: "branch-contributor", id: "account-branch-contributor", email: "branch-contributor@example.test", password: "Valid-password-123!" },
  { username: "default-branch-admin", id: "account-default-branch-admin", email: "default-branch-admin@example.test", password: "Valid-password-123!" },
  { username: "default-branch-viewer", id: "account-default-branch-viewer", email: "default-branch-viewer@example.test", password: "Valid-password-123!" },
  { username: "file-contributor", id: "account-file-contributor", email: "file-contributor@example.test", password: "Valid-password-123!" },
];

/** Mirrors the real seed organization used by the acceptance scenarios. */
export const DEFAULT_ORGANIZATIONS: FakeOrganizationSeed[] = [
  {
    slug: "acme-demo",
    displayName: "Acme Demo",
    members: [
      { username: "org-owner", role: "owner" },
      { username: "team-maintainer", role: "owner" },
      { username: "bob-reviewer", role: "member" },
      { username: "existing-member", role: "member" },
      { username: "org-member", role: "member" },
      { username: "protected-member", role: "member" },
    ],
    teams: [
      { slug: "platform-team", parent: null },
      { slug: "frontend-team", parent: "platform-team" },
      { slug: "frontend-child", parent: "frontend-team" },
      { slug: "access-role-team", parent: null },
    ],
    repositories: [
      {
        name: "acme-docs",
        description: "Product documentation for ACME.",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: "2024-05-01T10:00:00.000Z",
        commits: [
          {
            message: "Initial commit",
            author: "alice-dev",
            createdAt: "2024-04-20T09:15:00.000Z",
            changes: [
              { path: "src/README.md", content: "Documentation index\n" },
              { path: "src/search.ts", content: SEARCH_FILE_FIRST_REVISION },
            ],
          },
          {
            message: "Document search flow",
            author: "alice-dev",
            createdAt: "2024-05-01T10:00:00.000Z",
            changes: [
              { path: "src/README.md", content: "Document search flow" },
              { path: "src/search.ts", content: SEARCH_FILE_SECOND_REVISION },
            ],
          },
        ],
        files: [
          { path: "src/README.md", content: "Document search flow" },
          { path: "src/search.ts", content: SEARCH_FILE_SECOND_REVISION },
        ],
        grants: [
          { type: "account", name: "repo-admin", role: "admin" },
          { type: "team", name: "access-role-team", role: "write" },
        ],
      },
      {
        name: "secret-research",
        description: "Research notes for ACME.",
        visibility: "private",
        defaultBranch: "main",
        updatedAt: "2024-06-15T09:30:00.000Z",
      },
      {
        // REQ-4-3-1 / REQ-4-3-2: `main-only.md` exists only on `feature-search`.
        name: "branch-switch-demo",
        description: "Repository used to demonstrate branch switching.",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: "2024-09-01T09:00:00.000Z",
        branches: [
          {
            name: "main",
            commits: [
              {
                message: "Initial commit",
                author: "alice-dev",
                createdAt: "2024-08-10T09:00:00.000Z",
                changes: [{ path: "README.md", content: "# branch-switch-demo\n" }],
              },
            ],
          },
          {
            name: "feature-search",
            base: "main",
            commits: [
              {
                message: "Add main-only file",
                author: "alice-dev",
                createdAt: "2024-09-01T09:00:00.000Z",
                changes: [{ path: "main-only.md", content: "This file only exists on feature-search.\n" }],
              },
            ],
          },
        ],
        grants: [{ type: "account", name: "branch-contributor", role: "write" }],
      },
      {
        // REQ-4-3-3: `release` exists next to the default `main`.
        name: "default-branch-demo",
        description: "Repository used to demonstrate a default-branch change.",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: "2024-09-05T09:00:00.000Z",
        branches: [
          {
            name: "main",
            commits: [
              {
                message: "Initial commit",
                author: "alice-dev",
                createdAt: "2024-08-20T09:00:00.000Z",
                changes: [{ path: "README.md", content: "# default-branch-demo\n" }],
              },
            ],
          },
          {
            name: "release",
            base: "main",
            commits: [
              {
                message: "Prepare release",
                author: "alice-dev",
                createdAt: "2024-09-05T09:00:00.000Z",
                changes: [{ path: "release.md", content: "Release notes\n" }],
              },
            ],
          },
        ],
        grants: [{ type: "account", name: "default-branch-admin", role: "admin" }],
      },
      {
        // REQ-4-4: a writable repository for the web file editor.
        name: "file-management-demo",
        description: "Repository used to demonstrate adding a file.",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: "2024-09-10T09:00:00.000Z",
        branches: [
          {
            name: "main",
            commits: [
              {
                message: "Initial commit",
                author: "alice-dev",
                createdAt: "2024-08-25T09:00:00.000Z",
                changes: [{ path: "README.md", content: "# file-management-demo\n" }],
              },
            ],
          },
        ],
        grants: [{ type: "account", name: "file-contributor", role: "write" }],
      },
      {
        name: "visibility-demo",
        description: "Repository used to demonstrate a visibility change.",
        visibility: "private",
        defaultBranch: "main",
        updatedAt: "2024-07-01T12:00:00.000Z",
        grants: [
          { type: "account", name: "visibility-admin", role: "admin" },
          { type: "account", name: "collaborator", role: "write" },
        ],
      },
    ],
  },
  {
    // The organization namespace of `repo-owner`; it holds no repository, so no
    // visitor-facing list changes.
    slug: "repo-owner-org",
    displayName: "Repo Owner Org",
    members: [{ username: "repo-owner", role: "owner" }],
    teams: [],
    repositories: [],
  },
];

/**
 * Mirrors the personal-namespace seed: the repository that supplies the
 * duplicate-name case and the one that supplies the fork-name conflict case.
 */
export const DEFAULT_PERSONAL_REPOSITORIES: FakePersonalRepositorySeed[] = [
  {
    owner: "repo-owner",
    name: "acme-docs",
    description: "Personal notes kept next to the ACME documentation.",
    visibility: "private",
  },
  {
    owner: "fork-user",
    name: "acme-docs-fork",
    description: "A personal copy kept for experiments.",
    visibility: "private",
  },
];
