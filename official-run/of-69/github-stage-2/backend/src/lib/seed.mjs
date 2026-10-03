import { hashPassword } from "./passwords.mjs";

const SEED_PASSWORD = "Valid-password-123!";

// Pre-provisioned verified and available accounts required by the scenarios.
// Identities stay stable across restarts; the shared password satisfies the
// REQ-1 password rules.
const SEED_ACCOUNTS = [
  { username: "alice-dev", email: "alice.dev@example.test" },
  { username: "recovery-visibility", email: "recovery-visibility@example.test" },
  { username: "recovery-invalid-code", email: "recovery-invalid-code@example.test" },
  { username: "recovery-success", email: "recovery-success@example.test" },
  { username: "password-change-success", email: "password-change-success@example.test" },
  { username: "password-change-invalid", email: "password-change-invalid@example.test" },
  { username: "password-change-required", email: "password-change-required@example.test" },
  // REQ-2 organization governance.
  { username: "org-owner", email: "org-owner@example.test" },
  { username: "team-maintainer", email: "team-maintainer@example.test" },
  { username: "bob-reviewer", email: "bob-reviewer@example.test" },
  // REQ-2-2 membership and REQ-2-3 repository access scenarios. `new-member`
  // owns an account but no organization membership; `unknown-reviewer`
  // deliberately has no account at all.
  { username: "new-member", email: "new-member@example.test" },
  { username: "existing-member", email: "existing-member@example.test" },
  { username: "org-member", email: "org-member@example.test" },
  { username: "protected-member", email: "protected-member@example.test" },
  { username: "repo-admin", email: "repo-admin@example.test" },
  // REQ-3-4 visibility scenario. `visibility-admin` administers
  // `visibility-demo` directly; `collaborator` only holds a non-admin (Read)
  // grant, so the repository stays openable but not administrable.
  { username: "visibility-admin", email: "visibility-admin@example.test" },
  { username: "collaborator", email: "collaborator@example.test" },
  // REQ-3-2 repository creation and forking. `repo-owner` owns a personal
  // namespace that already contains the duplicate-name `acme-docs`;
  // `fork-user` owns a personal namespace that already holds the fork
  // `acme-docs-fork`.
  { username: "repo-owner", email: "repo-owner@example.test" },
  { username: "fork-user", email: "fork-user@example.test" },
  // REQ-4-3/REQ-4-4 branch and web file editing contributors. Each one holds
  // the stated repository grant on its own demo repository: `branch-contributor`
  // and `file-contributor` Write, `default-branch-admin` Admin, and
  // `default-branch-viewer` Read without repository administration.
  { username: "branch-contributor", email: "branch-contributor@example.test" },
  { username: "file-contributor", email: "file-contributor@example.test" },
  { username: "default-branch-admin", email: "default-branch-admin@example.test" },
  { username: "default-branch-viewer", email: "default-branch-viewer@example.test" },
];

export const SEED_ACCOUNT_PASSWORD = SEED_PASSWORD;

export function createSeedAccounts() {
  return SEED_ACCOUNTS.map(({ username, email }) => ({
    id: `account-${username}`,
    username,
    email,
    emailVerified: true,
    status: "available",
    password: hashPassword(SEED_PASSWORD),
    createdAt: "2024-01-01T00:00:00.000Z",
  }));
}

// Pre-provisioned organization `Acme Demo`: owner accounts, one plain member,
// four teams, and the public/private repository set used by the browse,
// visibility, creation and fork scenarios. Personal namespaces (owned by an
// individual account) carry the duplicate-name and fork-conflict seeds.
const ACME_DEMO_ID = "org-acme-demo";
const ACME_DEMO_CREATED_AT = "2024-01-02T00:00:00.000Z";
const DEMO_LABS_ID = "org-demo-labs";
const DEMO_LABS_CREATED_AT = "2024-04-01T00:00:00.000Z";
const README_CONTENT = (name, summary) => `# ${name}\n\n${summary}\n`;

const SEED_REPOSITORIES = [
  {
    id: "repo-acme-demo-acme-docs",
    ownerType: "organization",
    ownerId: ACME_DEMO_ID,
    ownerName: "acme-demo",
    name: "acme-docs",
    description: "Public documentation for Acme products",
    visibility: "public",
    defaultBranch: "main",
    creatorId: "account-org-owner",
    forkedFrom: null,
    createdAt: ACME_DEMO_CREATED_AT,
    updatedAt: "2024-03-01T10:00:00.000Z",
  },
  {
    id: "repo-acme-demo-secret-research",
    ownerType: "organization",
    ownerId: ACME_DEMO_ID,
    ownerName: "acme-demo",
    name: "secret-research",
    description: "Confidential research notes for the Acme team",
    visibility: "private",
    defaultBranch: "main",
    creatorId: "account-org-owner",
    forkedFrom: null,
    createdAt: ACME_DEMO_CREATED_AT,
    updatedAt: "2024-03-02T10:00:00.000Z",
  },
  {
    id: "repo-acme-demo-visibility-demo",
    ownerType: "organization",
    ownerId: ACME_DEMO_ID,
    ownerName: "acme-demo",
    name: "visibility-demo",
    description: "Private repository used to demonstrate a visibility change",
    visibility: "private",
    defaultBranch: "main",
    creatorId: "account-visibility-admin",
    forkedFrom: null,
    createdAt: ACME_DEMO_CREATED_AT,
    updatedAt: "2024-03-03T10:00:00.000Z",
  },
  // `repo-owner`'s personal namespace already contains `acme-docs`, so the
  // creation form reports a duplicate name instead of creating a second one.
  {
    id: "repo-repo-owner-acme-docs",
    ownerType: "user",
    ownerId: "account-repo-owner",
    ownerName: "repo-owner",
    name: "acme-docs",
    description: "Personal scratch notes",
    visibility: "private",
    defaultBranch: "main",
    creatorId: "account-repo-owner",
    forkedFrom: null,
    createdAt: "2024-02-01T00:00:00.000Z",
    updatedAt: "2024-02-01T00:00:00.000Z",
  },
  // `fork-user`'s personal namespace already contains the fork
  // `acme-docs-fork`, so a second fork with that name is a conflict.
  {
    id: "repo-fork-user-acme-docs-fork",
    ownerType: "user",
    ownerId: "account-fork-user",
    ownerName: "fork-user",
    name: "acme-docs-fork",
    description: "Fork of acme-docs",
    visibility: "private",
    defaultBranch: "main",
    creatorId: "account-fork-user",
    forkedFrom: "repo-acme-demo-acme-docs",
    createdAt: "2024-02-10T00:00:00.000Z",
    updatedAt: "2024-02-10T00:00:00.000Z",
  },
  // REQ-4-3/REQ-4-4 demo repositories of the public `Demo Labs` organization:
  // a branch-switching repository, one with a second `release` branch, and the
  // repository the web file editor commits to.
  {
    id: "repo-demo-labs-branch-switch-demo",
    ownerType: "organization",
    ownerId: DEMO_LABS_ID,
    ownerName: "demo-labs",
    name: "branch-switch-demo",
    description: "Public repository used to demonstrate listing and switching branches",
    visibility: "public",
    defaultBranch: "main",
    creatorId: "account-branch-contributor",
    forkedFrom: null,
    createdAt: DEMO_LABS_CREATED_AT,
    updatedAt: "2024-04-02T10:00:00.000Z",
  },
  {
    id: "repo-demo-labs-default-branch-demo",
    ownerType: "organization",
    ownerId: DEMO_LABS_ID,
    ownerName: "demo-labs",
    name: "default-branch-demo",
    description: "Public repository used to demonstrate changing the default branch",
    visibility: "public",
    defaultBranch: "main",
    creatorId: "account-default-branch-admin",
    forkedFrom: null,
    createdAt: DEMO_LABS_CREATED_AT,
    updatedAt: "2024-04-03T10:00:00.000Z",
  },
  {
    id: "repo-demo-labs-file-management-demo",
    ownerType: "organization",
    ownerId: DEMO_LABS_ID,
    ownerName: "demo-labs",
    name: "file-management-demo",
    description: "Public repository used to demonstrate adding a file through the web interface",
    visibility: "public",
    defaultBranch: "main",
    creatorId: "account-file-contributor",
    forkedFrom: null,
    createdAt: DEMO_LABS_CREATED_AT,
    updatedAt: "2024-04-04T10:00:00.000Z",
  },
];

// The public documentation repository of REQ-3-3/REQ-4: its default branch
// holds the `src` directory with the text file `README.md`, and its history
// records the change that documented the search flow.
const ACME_DOCS_README_V1 =
  "# acme-docs\n\nPublic documentation for Acme products\n\nDocumentation is coming soon.\n\nSee the docs site for the full guide.\n";
const ACME_DOCS_README_V2 =
  "# acme-docs\n\nPublic documentation for Acme products\n\nDocument search flow\n";
const ACME_DOCS_SRC_README = "Document search flow\n";
const ACME_DOCS_SRC_SEARCH =
  "export function search(text: string, query: string) {\n  return text.includes(query);\n}\n";

// Default-branch history of each seeded repository: one branch, its commits
// (each with the files it changed and the content before and after) and the
// files that branch holds. A fork copies exactly this accessible history.
// A repository may instead list `branches`, each with its own commits and
// files, when it is seeded with more than one readable branch.
const SEED_HISTORY = {
  "repo-acme-demo-acme-docs": {
    commits: [
      {
        id: "commit-acme-docs-1",
        message: "Initial commit",
        authorId: "account-org-owner",
        createdAt: "2024-01-05T09:00:00.000Z",
        parentId: null,
        changes: [{ path: "README.md", previous: null, content: "# acme-docs\n" }],
      },
      {
        id: "commit-acme-docs-2",
        message: "Document installation",
        authorId: "account-org-owner",
        createdAt: "2024-01-06T09:00:00.000Z",
        parentId: "commit-acme-docs-1",
        changes: [{ path: "README.md", previous: "# acme-docs\n", content: ACME_DOCS_README_V1 }],
      },
      {
        id: "commit-acme-docs-3",
        message: "Document search flow",
        authorId: "account-alice-dev",
        createdAt: "2024-03-05T09:00:00.000Z",
        parentId: "commit-acme-docs-2",
        changes: [
          { path: "README.md", previous: ACME_DOCS_README_V1, content: ACME_DOCS_README_V2 },
          { path: "src/README.md", previous: null, content: ACME_DOCS_SRC_README },
          { path: "src/search.ts", previous: null, content: ACME_DOCS_SRC_SEARCH },
        ],
      },
    ],
    files: [
      { id: "file-acme-docs-readme", path: "README.md", content: ACME_DOCS_README_V2 },
      { id: "file-acme-docs-src-readme", path: "src/README.md", content: ACME_DOCS_SRC_README },
      { id: "file-acme-docs-src-search", path: "src/search.ts", content: ACME_DOCS_SRC_SEARCH },
    ],
  },
  "repo-acme-demo-secret-research": {
    commits: [
      {
        id: "commit-secret-research-1",
        message: "Initial commit",
        authorId: "account-org-owner",
        createdAt: "2024-01-07T09:00:00.000Z",
        parentId: null,
        changes: [
          {
            path: "README.md",
            previous: null,
            content: README_CONTENT("secret-research", "Confidential research notes for the Acme team"),
          },
        ],
      },
    ],
    files: [
      { id: "file-secret-research-readme", path: "README.md", content: README_CONTENT("secret-research", "Confidential research notes for the Acme team") },
    ],
  },
  "repo-acme-demo-visibility-demo": {
    commits: [
      {
        id: "commit-visibility-demo-1",
        message: "Initial commit",
        authorId: "account-visibility-admin",
        createdAt: "2024-01-08T09:00:00.000Z",
        parentId: null,
        changes: [
          {
            path: "README.md",
            previous: null,
            content: README_CONTENT("visibility-demo", "Private repository used to demonstrate a visibility change"),
          },
        ],
      },
    ],
    files: [
      { id: "file-visibility-demo-readme", path: "README.md", content: README_CONTENT("visibility-demo", "Private repository used to demonstrate a visibility change") },
    ],
  },
  "repo-repo-owner-acme-docs": {
    commits: [
      {
        id: "commit-repo-owner-acme-docs-1",
        message: "Initial commit",
        authorId: "account-repo-owner",
        createdAt: "2024-02-01T00:00:00.000Z",
        parentId: null,
        changes: [{ path: "README.md", previous: null, content: README_CONTENT("acme-docs", "Personal scratch notes") }],
      },
    ],
    files: [
      { id: "file-repo-owner-acme-docs-readme", path: "README.md", content: README_CONTENT("acme-docs", "Personal scratch notes") },
    ],
  },
  "repo-fork-user-acme-docs-fork": {
    commits: [
      {
        id: "commit-fork-user-acme-docs-fork-1",
        message: "Initial commit",
        authorId: "account-org-owner",
        createdAt: "2024-01-05T09:00:00.000Z",
        parentId: null,
        changes: [{ path: "README.md", previous: null, content: "# acme-docs\n" }],
      },
      {
        id: "commit-fork-user-acme-docs-fork-2",
        message: "Document installation",
        authorId: "account-org-owner",
        createdAt: "2024-01-06T09:00:00.000Z",
        parentId: "commit-fork-user-acme-docs-fork-1",
        changes: [
          { path: "README.md", previous: "# acme-docs\n", content: README_CONTENT("acme-docs", "Public documentation for Acme products") },
        ],
      },
    ],
    files: [
      { id: "file-fork-user-acme-docs-fork-readme", path: "README.md", content: README_CONTENT("acme-docs", "Public documentation for Acme products") },
    ],
  },
  // REQ-4-3-1/REQ-4-3-2: `main` is the active branch and `feature-search` is
  // the target; `main-only.md` exists on the target branch only.
  "repo-demo-labs-branch-switch-demo": {
    branches: [
      {
        name: "main",
        commits: [
          {
            id: "commit-branch-switch-demo-main-1",
            message: "Initial commit",
            authorId: "account-branch-contributor",
            createdAt: "2024-04-02T09:00:00.000Z",
            parentId: null,
            changes: [
              {
                path: "README.md",
                previous: null,
                content: README_CONTENT("branch-switch-demo", "Demonstrates listing and switching repository branches"),
              },
            ],
          },
        ],
        files: [
          {
            id: "file-branch-switch-demo-main-readme",
            path: "README.md",
            content: README_CONTENT("branch-switch-demo", "Demonstrates listing and switching repository branches"),
          },
        ],
      },
      {
        name: "feature-search",
        createdAt: "2024-04-02T11:00:00.000Z",
        commits: [
          {
            id: "commit-branch-switch-demo-feature-1",
            message: "Initial commit",
            authorId: "account-branch-contributor",
            createdAt: "2024-04-02T09:00:00.000Z",
            parentId: null,
            changes: [
              {
                path: "README.md",
                previous: null,
                content: README_CONTENT("branch-switch-demo", "Demonstrates listing and switching repository branches"),
              },
            ],
          },
          {
            id: "commit-branch-switch-demo-feature-2",
            message: "Add branch notes",
            authorId: "account-branch-contributor",
            createdAt: "2024-04-02T11:00:00.000Z",
            parentId: "commit-branch-switch-demo-feature-1",
            changes: [{ path: "main-only.md", previous: null, content: "Only available on the feature-search branch.\n" }],
          },
        ],
        files: [
          {
            id: "file-branch-switch-demo-feature-readme",
            path: "README.md",
            content: README_CONTENT("branch-switch-demo", "Demonstrates listing and switching repository branches"),
          },
          {
            id: "file-branch-switch-demo-feature-notes",
            path: "main-only.md",
            content: "Only available on the feature-search branch.\n",
          },
        ],
      },
    ],
  },
  // REQ-4-3-3: `main` is the default branch and `release` is the branch the
  // administrator selects; both keep their own files and commits.
  "repo-demo-labs-default-branch-demo": {
    branches: [
      {
        name: "main",
        commits: [
          {
            id: "commit-default-branch-demo-main-1",
            message: "Initial commit",
            authorId: "account-default-branch-admin",
            createdAt: "2024-04-03T09:00:00.000Z",
            parentId: null,
            changes: [
              {
                path: "README.md",
                previous: null,
                content: README_CONTENT("default-branch-demo", "Demonstrates changing the default branch of a repository"),
              },
            ],
          },
        ],
        files: [
          {
            id: "file-default-branch-demo-main-readme",
            path: "README.md",
            content: README_CONTENT("default-branch-demo", "Demonstrates changing the default branch of a repository"),
          },
        ],
      },
      {
        name: "release",
        createdAt: "2024-04-03T11:00:00.000Z",
        commits: [
          {
            id: "commit-default-branch-demo-release-1",
            message: "Initial commit",
            authorId: "account-default-branch-admin",
            createdAt: "2024-04-03T09:00:00.000Z",
            parentId: null,
            changes: [
              {
                path: "README.md",
                previous: null,
                content: README_CONTENT("default-branch-demo", "Demonstrates changing the default branch of a repository"),
              },
            ],
          },
          {
            id: "commit-default-branch-demo-release-2",
            message: "Prepare release",
            authorId: "account-default-branch-admin",
            createdAt: "2024-04-03T11:00:00.000Z",
            parentId: "commit-default-branch-demo-release-1",
            changes: [{ path: "RELEASE.md", previous: null, content: "Release notes for the upcoming release.\n" }],
          },
        ],
        files: [
          {
            id: "file-default-branch-demo-release-readme",
            path: "README.md",
            content: README_CONTENT("default-branch-demo", "Demonstrates changing the default branch of a repository"),
          },
          {
            id: "file-default-branch-demo-release-notes",
            path: "RELEASE.md",
            content: "Release notes for the upcoming release.\n",
          },
        ],
      },
    ],
  },
  // REQ-4-4: the repository the Write contributor adds a file to.
  "repo-demo-labs-file-management-demo": {
    commits: [
      {
        id: "commit-file-management-demo-1",
        message: "Initial commit",
        authorId: "account-file-contributor",
        createdAt: "2024-04-04T09:00:00.000Z",
        parentId: null,
        changes: [
          {
            path: "README.md",
            previous: null,
            content: README_CONTENT("file-management-demo", "Demonstrates adding a repository file through the web interface"),
          },
        ],
      },
    ],
    files: [
      {
        id: "file-file-management-demo-readme",
        path: "README.md",
        content: README_CONTENT("file-management-demo", "Demonstrates adding a repository file through the web interface"),
      },
    ],
  },
};

function createSeedHistory() {
  const branches = [];
  const commits = [];
  const files = [];
  for (const repository of SEED_REPOSITORIES) {
    const history = SEED_HISTORY[repository.id];
    if (!history) continue;
    // Either one default-branch history or a list of branch histories.
    const branchHistories = history.branches ?? [
      { name: repository.defaultBranch, commits: history.commits ?? [], files: history.files ?? [] },
    ];
    for (const branchHistory of branchHistories) {
      branches.push({
        id: `branch-${repository.id}-${branchHistory.name}`,
        repositoryId: repository.id,
        name: branchHistory.name,
        createdAt: branchHistory.createdAt ?? repository.createdAt,
      });
      for (const commit of branchHistory.commits ?? []) {
        commits.push({ ...commit, repositoryId: repository.id, branch: branchHistory.name });
      }
      for (const file of branchHistory.files ?? []) {
        files.push({ ...file, repositoryId: repository.id, branch: branchHistory.name });
      }
    }
  }
  return { branches, commits, files };
}

export function createSeedOrganizationState() {
  const { branches, commits, files } = createSeedHistory();
  return {
    organizations: [
      {
        id: ACME_DEMO_ID,
        name: "acme-demo",
        displayName: "Acme Demo",
        createdAt: ACME_DEMO_CREATED_AT,
      },
      // The public organization that owns the REQ-4 branch and file demo
      // repositories. Its repositories are public and reachable by search, the
      // home list and a direct link, so no visitor needs a membership.
      {
        id: DEMO_LABS_ID,
        name: "demo-labs",
        displayName: "Demo Labs",
        createdAt: DEMO_LABS_CREATED_AT,
      },
    ],
    memberships: [
      { id: "membership-acme-demo-org-owner", organizationId: ACME_DEMO_ID, accountId: "account-org-owner", role: "owner", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-team-maintainer", organizationId: ACME_DEMO_ID, accountId: "account-team-maintainer", role: "owner", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-bob-reviewer", organizationId: ACME_DEMO_ID, accountId: "account-bob-reviewer", role: "member", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-existing-member", organizationId: ACME_DEMO_ID, accountId: "account-existing-member", role: "member", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-org-member", organizationId: ACME_DEMO_ID, accountId: "account-org-member", role: "member", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-protected-member", organizationId: ACME_DEMO_ID, accountId: "account-protected-member", role: "member", createdAt: ACME_DEMO_CREATED_AT },
    ],
    teams: [
      { id: "team-acme-demo-platform-team", organizationId: ACME_DEMO_ID, name: "platform-team", parentTeamId: null, createdAt: ACME_DEMO_CREATED_AT },
      { id: "team-acme-demo-frontend-team", organizationId: ACME_DEMO_ID, name: "frontend-team", parentTeamId: "team-acme-demo-platform-team", createdAt: ACME_DEMO_CREATED_AT },
      { id: "team-acme-demo-frontend-child", organizationId: ACME_DEMO_ID, name: "frontend-child", parentTeamId: "team-acme-demo-frontend-team", createdAt: ACME_DEMO_CREATED_AT },
      { id: "team-acme-demo-access-role-team", organizationId: ACME_DEMO_ID, name: "access-role-team", parentTeamId: null, createdAt: ACME_DEMO_CREATED_AT },
    ],
    teamMemberships: [],
    // Direct repository grants. `repo-admin` administers `acme-docs` through a
    // direct Admin grant (no organization membership needed); `acme-docs`
    // starts without any grant to `frontend-team`; `access-role-team` already
    // holds exactly one direct Write grant so its role can be changed in place.
    repositoryGrants: [
      { id: "grant-acme-docs-repo-admin", repositoryId: "repo-acme-demo-acme-docs", accountId: "account-repo-admin", role: "admin", createdAt: ACME_DEMO_CREATED_AT },
      { id: "grant-acme-docs-access-role-team", repositoryId: "repo-acme-demo-acme-docs", teamId: "team-acme-demo-access-role-team", role: "write", createdAt: ACME_DEMO_CREATED_AT },
      { id: "grant-visibility-demo-visibility-admin", repositoryId: "repo-acme-demo-visibility-demo", accountId: "account-visibility-admin", role: "admin", createdAt: ACME_DEMO_CREATED_AT },
      { id: "grant-visibility-demo-collaborator", repositoryId: "repo-acme-demo-visibility-demo", accountId: "account-collaborator", role: "read", createdAt: ACME_DEMO_CREATED_AT },
      // REQ-4-3/REQ-4-4 demo repository grants (direct account grants; these
      // accounts need no organization membership to hold them).
      { id: "grant-branch-switch-demo-branch-contributor", repositoryId: "repo-demo-labs-branch-switch-demo", accountId: "account-branch-contributor", role: "write", createdAt: DEMO_LABS_CREATED_AT },
      { id: "grant-default-branch-demo-default-branch-admin", repositoryId: "repo-demo-labs-default-branch-demo", accountId: "account-default-branch-admin", role: "admin", createdAt: DEMO_LABS_CREATED_AT },
      { id: "grant-default-branch-demo-default-branch-viewer", repositoryId: "repo-demo-labs-default-branch-demo", accountId: "account-default-branch-viewer", role: "read", createdAt: DEMO_LABS_CREATED_AT },
      { id: "grant-file-management-demo-file-contributor", repositoryId: "repo-demo-labs-file-management-demo", accountId: "account-file-contributor", role: "write", createdAt: DEMO_LABS_CREATED_AT },
    ],
    repositories: SEED_REPOSITORIES,
    branches,
    commits,
    files,
  };
}
