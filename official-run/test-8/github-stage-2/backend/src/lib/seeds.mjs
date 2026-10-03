import { randomUUID } from "node:crypto";

import { hashPassword } from "./accounts.mjs";
import { normalizeRepositoryOwners, repositoryOwnedBy } from "./repository-ownership.mjs";

/**
 * Pre-provisioned accounts required by the acceptance scenarios. They are
 * written into empty storage on first use; later restarts keep the stored
 * state (including user modifications) untouched.
 */
export const SEED_ACCOUNTS = [
  { username: "alice-dev", email: "alice.dev@example.test", password: "Valid-password-123!" },
  { username: "recovery-visibility", email: "recovery-visibility@example.test", password: "Valid-password-123!" },
  { username: "recovery-invalid-code", email: "recovery-invalid-code@example.test", password: "Valid-password-123!" },
  { username: "recovery-success", email: "recovery-success@example.test", password: "Valid-password-123!" },
  { username: "password-change-success", email: "password-change-success@example.test", password: "Valid-password-123!" },
  { username: "password-change-invalid", email: "password-change-invalid@example.test", password: "Valid-password-123!" },
  { username: "password-change-required", email: "password-change-required@example.test", password: "Valid-password-123!" },
  { username: "org-owner", email: "org-owner@example.test", password: "Valid-password-123!" },
  { username: "team-maintainer", email: "team-maintainer@example.test", password: "Valid-password-123!" },
  { username: "bob-reviewer", email: "bob-reviewer@example.test", password: "Valid-password-123!" },
  { username: "new-member", email: "new-member@example.test", password: "Valid-password-123!" },
  { username: "existing-member", email: "existing-member@example.test", password: "Valid-password-123!" },
  { username: "org-member", email: "org-member@example.test", password: "Valid-password-123!" },
  { username: "protected-member", email: "protected-member@example.test", password: "Valid-password-123!" },
  { username: "repo-admin", email: "repo-admin@example.test", password: "Valid-password-123!" },
  { username: "visibility-admin", email: "visibility-admin@example.test", password: "Valid-password-123!" },
  { username: "collaborator", email: "collaborator@example.test", password: "Valid-password-123!" },
  { username: "repo-owner", email: "repo-owner@example.test", password: "Valid-password-123!" },
  { username: "fork-user", email: "fork-user@example.test", password: "Valid-password-123!" },
  { username: "branch-contributor", email: "branch-contributor@example.test", password: "Valid-password-123!" },
  { username: "default-branch-admin", email: "default-branch-admin@example.test", password: "Valid-password-123!" },
  { username: "default-branch-viewer", email: "default-branch-viewer@example.test", password: "Valid-password-123!" },
  { username: "file-contributor", email: "file-contributor@example.test", password: "Valid-password-123!" },
];

/**
 * Organization, team and repository seed data. The organization's `slug` is the
 * globally unique identifier used in URLs; `displayName` is the human name shown
 * on links (e.g. “Acme Demo”). Parents are resolved after all teams exist.
 *
 * A seeded repository may carry `commits` for its default branch. Each commit is
 * an immutable record with the `changes` it introduced (`content` is the new file
 * content, `null` for a deletion); the branch snapshot, the file pages, the
 * history and the diffs are all derived from that one chain, so the seed can
 * never show a tree that disagrees with its history. A repository may still list
 * plain `files` instead.
 */

/**
 * `src/search.ts` is the seeded changed file of REQ-4-2-2; its two revisions are
 * deliberately different so the commit detail has real additions and deletions.
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

export const SEED_ORGANIZATIONS = [
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
        // REQ-4-3-1 / REQ-4-3-2: `feature-search` is a branch of its own that
        // adds `main-only.md`, so the file is absent from `main`.
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
    // The organization namespace of `repo-owner`: an Owner may create a
    // repository there as well as in the personal namespace. It holds no
    // repository, so no visitor-facing list changes.
    slug: "repo-owner-org",
    displayName: "Repo Owner Org",
    members: [{ username: "repo-owner", role: "owner" }],
    teams: [],
    repositories: [],
  },
];

/**
 * Personal-namespace seed repositories. `repo-owner/acme-docs` supplies the
 * duplicate-name case of the personal namespace and `fork-user/acme-docs-fork`
 * the fork-name conflict case. Both stay private so they never join the public
 * explore list or a visitor’s search results.
 */
export const SEED_PERSONAL_REPOSITORIES = [
  {
    owner: "repo-owner",
    name: "acme-docs",
    description: "Personal notes kept next to the ACME documentation.",
    visibility: "private",
    defaultBranch: "main",
    updatedAt: "2024-08-01T08:00:00.000Z",
  },
  {
    owner: "fork-user",
    name: "acme-docs-fork",
    description: "A personal copy kept for experiments.",
    visibility: "private",
    defaultBranch: "main",
    updatedAt: "2024-08-02T08:00:00.000Z",
  },
];

export function createSeedAccount(seed) {
  return {
    id: randomUUID(),
    username: seed.username,
    email: seed.email,
    emailVerified: true,
    status: "available",
    passwordHash: hashPassword(seed.password),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Branch + commit chain + files of one seeded repository snapshot. The file
 * snapshot is replayed from the commit chain, so tree, file content and history
 * always describe the same revision.
 *
 * A repository may instead list `branches`, each with its own commits. A branch
 * carrying `base` continues from that branch’s head (its snapshot is the base
 * revision plus its own changes), which is how `feature-search`/`release` exist
 * next to `main` without rewriting it.
 */
function seedRepositoryAssets(state, repository, seed) {
  if (Array.isArray(seed.branches) && seed.branches.length > 0) {
    seedRepositoryBranches(state, repository, seed);
    return;
  }
  const commits = seed.commits ?? [];
  const files = seed.files ?? [];
  if (commits.length === 0 && files.length === 0) return;
  const branch = seed.branch ?? repository.defaultBranch ?? "main";
  let headCommitId = null;
  const snapshot = new Map();
  for (const commit of commits) {
    const id = randomUUID();
    for (const change of commit.changes ?? []) {
      if (change.content === null || change.content === undefined) snapshot.delete(change.path);
      else snapshot.set(change.path, change.content);
    }
    state.commits.push({
      id,
      repositoryId: repository.id,
      branch,
      parentCommitId: headCommitId,
      message: commit.message,
      authorId: null,
      authorName: commit.author ?? "",
      createdAt: commit.createdAt ?? new Date().toISOString(),
      changes: (commit.changes ?? []).map((change) => ({
        path: change.path,
        content: change.content ?? null,
      })),
    });
    headCommitId = id;
  }
  state.branches.push({
    id: randomUUID(),
    repositoryId: repository.id,
    name: branch,
    headCommitId,
    createdAt: repository.createdAt,
  });
  // A seed may still list the snapshot directly instead of a commit chain.
  for (const file of files) snapshot.set(file.path, file.content ?? "");
  for (const [path, content] of snapshot) {
    state.files.push({
      id: randomUUID(),
      repositoryId: repository.id,
      branch,
      path,
      content,
      commitId: headCommitId,
    });
  }
}

/**
 * Seeds several branches of one repository. `branches` is processed in order,
 * so a branch may only reference an earlier `base`; every branch gets its own
 * commit records, branch record and materialized file snapshot.
 */
function seedRepositoryBranches(state, repository, seed) {
  const snapshots = new Map();
  for (const branch of seed.branches) {
    const base = branch.base ? snapshots.get(branch.base) : undefined;
    const snapshot = new Map(base ? base.snapshot : []);
    let headCommitId = base ? base.headCommitId : null;
    for (const commit of branch.commits ?? []) {
      const id = randomUUID();
      for (const change of commit.changes ?? []) {
        if (change.content === null || change.content === undefined) snapshot.delete(change.path);
        else snapshot.set(change.path, change.content);
      }
      state.commits.push({
        id,
        repositoryId: repository.id,
        branch: branch.name,
        parentCommitId: headCommitId,
        message: commit.message,
        authorId: null,
        authorName: commit.author ?? "",
        createdAt: commit.createdAt ?? new Date().toISOString(),
        changes: (commit.changes ?? []).map((change) => ({
          path: change.path,
          content: change.content ?? null,
        })),
      });
      headCommitId = id;
    }
    for (const file of branch.files ?? []) snapshot.set(file.path, file.content ?? "");
    state.branches.push({
      id: randomUUID(),
      repositoryId: repository.id,
      name: branch.name,
      headCommitId,
      createdAt: repository.createdAt ?? new Date().toISOString(),
    });
    snapshots.set(branch.name, { snapshot, headCommitId });
  }
  for (const [name, { snapshot, headCommitId }] of snapshots) {
    for (const [path, content] of snapshot) {
      state.files.push({
        id: randomUUID(),
        repositoryId: repository.id,
        branch: name,
        path,
        content,
        commitId: headCommitId,
      });
    }
  }
}

function seedPersonalRepositories(state) {
  for (const seed of SEED_PERSONAL_REPOSITORIES) {
    const account = state.accounts.find((candidate) => candidate.username === seed.owner);
    if (!account) continue;
    const exists = state.repositories.some(
      (candidate) => repositoryOwnedBy(candidate, account.id) && candidate.name === seed.name,
    );
    if (exists) continue;
    const repository = {
      id: randomUUID(),
      ownerType: "account",
      ownerId: account.id,
      name: seed.name,
      description: seed.description,
      visibility: seed.visibility,
      defaultBranch: seed.defaultBranch ?? "main",
      forkedFromRepositoryId: null,
      createdBy: account.id,
      updatedAt: seed.updatedAt,
      createdAt: new Date().toISOString(),
    };
    state.repositories.push(repository);
    seedRepositoryAssets(state, repository, seed);
  }
}

function seedOrganizations(state) {
  for (const seed of SEED_ORGANIZATIONS) {
    let organization = state.organizations.find((candidate) => candidate.slug === seed.slug);
    if (!organization) {
      organization = {
        id: randomUUID(),
        slug: seed.slug,
        displayName: seed.displayName,
        createdAt: new Date().toISOString(),
      };
      state.organizations.push(organization);
    }

    // Organization memberships are written once per organization: a membership
    // the Owner later removes must stay removed across restarts, while a data
    // document created by an earlier stage still gains the current seed members.
    if (!organization.seededMembers) {
      for (const member of seed.members ?? []) {
        const account = state.accounts.find((candidate) => candidate.username === member.username);
        if (!account) continue;
        const exists = state.memberships.some(
          (candidate) => candidate.organizationId === organization.id && candidate.accountId === account.id,
        );
        if (!exists) {
          state.memberships.push({
            id: randomUUID(),
            organizationId: organization.id,
            accountId: account.id,
            role: member.role,
            createdAt: new Date().toISOString(),
          });
        }
      }
      organization.seededMembers = true;
    }

    for (const team of seed.teams ?? []) {
      const exists = state.teams.some(
        (candidate) => candidate.organizationId === organization.id && candidate.slug === team.slug,
      );
      if (!exists) {
        state.teams.push({
          id: randomUUID(),
          organizationId: organization.id,
          slug: team.slug,
          parentTeamId: null,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Resolve parents after the whole team list exists so order never matters.
    for (const team of seed.teams ?? []) {
      if (!team.parent) continue;
      const child = state.teams.find(
        (candidate) => candidate.organizationId === organization.id && candidate.slug === team.slug,
      );
      const parent = state.teams.find(
        (candidate) => candidate.organizationId === organization.id && candidate.slug === team.parent,
      );
      if (child && parent && child.parentTeamId !== parent.id) child.parentTeamId = parent.id;
    }

    for (const repository of seed.repositories ?? []) {
      let stored = state.repositories.find(
        (candidate) => repositoryOwnedBy(candidate, organization.id) && candidate.name === repository.name,
      );
      if (!stored) {
        stored = {
          id: randomUUID(),
          ownerType: "organization",
          ownerId: organization.id,
          name: repository.name,
          description: repository.description,
          visibility: repository.visibility,
          defaultBranch: repository.defaultBranch ?? "main",
          forkedFromRepositoryId: null,
          updatedAt: repository.updatedAt,
          createdAt: new Date().toISOString(),
        };
        state.repositories.push(stored);
        seedRepositoryAssets(state, stored, repository);
      } else if (!stored.defaultBranch && repository.defaultBranch) {
        // Add-if-missing: a document written by an earlier stage gains the
        // default branch without overwriting a stored change.
        stored.defaultBranch = repository.defaultBranch;
      }
    }

    // Access grants are topped up after teams, accounts and repositories exist.
    for (const repository of seed.repositories ?? []) {
      const stored = state.repositories.find(
        (candidate) => repositoryOwnedBy(candidate, organization.id) && candidate.name === repository.name,
      );
      if (!stored) continue;
      for (const grant of repository.grants ?? []) {
        const subjectId = grant.type === "team"
          ? state.teams.find((team) => team.organizationId === organization.id && team.slug === grant.name)?.id
          : state.accounts.find((account) => account.username === grant.name)?.id;
        if (!subjectId) continue;
        const exists = state.repositoryGrants.some(
          (candidate) => candidate.repositoryId === stored.id
            && candidate.subjectType === grant.type
            && candidate.subjectId === subjectId,
        );
        if (!exists) {
          state.repositoryGrants.push({
            id: randomUUID(),
            repositoryId: stored.id,
            subjectType: grant.type,
            subjectId,
            role: grant.role,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }
}

export async function ensureSeeded(store) {
  await store.update((state) => {
    for (const key of [
      "accounts",
      "sessions",
      "organizations",
      "memberships",
      "teams",
      "teamMembers",
      "repositories",
      "repositoryGrants",
      "branches",
      "commits",
      "files",
    ]) {
      if (!Array.isArray(state[key])) state[key] = [];
    }

    // A document written before personal namespaces existed only stores
    // `organizationId`; rewriting the owner fields keeps later reads exact.
    normalizeRepositoryOwners(state);

    // Top up any missing seed account without touching existing records, so a
    // storage document seeded by an earlier stage still gains new accounts and
    // restarts keep user registrations and password changes intact.
    for (const seed of SEED_ACCOUNTS) {
      const exists = state.accounts.some((account) => account.username === seed.username);
      if (!exists) state.accounts.push(createSeedAccount(seed));
    }

    seedOrganizations(state);
    seedPersonalRepositories(state);

    if (!state.seededAt) state.seededAt = new Date().toISOString();
  });
}
