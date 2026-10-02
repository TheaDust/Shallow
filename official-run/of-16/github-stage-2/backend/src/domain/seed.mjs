import { randomUUID } from "node:crypto";

import { findAccountByEmail, findAccountByUsername, hashPassword } from "./identity.mjs";
import { ORGANIZATION_ROLE_MEMBER, ORGANIZATION_ROLE_OWNER } from "./organizations.mjs";
import {
  DEFAULT_BRANCH_NAME,
  appendCommit,
  createBranch,
  hasBranch,
  initializeRepositoryContent,
  initializeRepositoryHistory,
} from "./repository-content.mjs";

/**
 * Seed history of the public repository `acme-docs`. The messages, authors and
 * relative ages are the ones the read-only history and comparison scenarios
 * expect; the two revisions touch `src/search.ts` so its changed-file path is
 * reachable from either history record.
 */
const SEARCH_TS_INITIAL = [
  "export function searchFiles(files, query) {",
  "  return files.filter((file) => file.content.includes(query));",
  "}",
].join("\n");

const SEARCH_TS_CURRENT = [
  "export function searchFiles(files, query) {",
  "  if (query.length === 0) return [];",
  "  const needle = query.toLowerCase();",
  "  return files.filter((file) => file.content.toLowerCase().includes(needle));",
  "}",
].join("\n");

/** Readme of the repository root; the searched phrase lives in `src/README.md`. */
const ROOT_README_CONTENT = "# acme-docs\n\nDocumentation, guides and release notes for Acme Demo.\n";

/** ISO timestamp a number of hours before the seed is written. */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** ISO timestamp a number of whole days before the seed is written. */
function daysAgo(days) {
  return hoursAgo(days * 24);
}

/**
 * Shared seed accounts. Every account is verified and available, and is stored
 * with a sign-in capable credential. Later stages append their own accounts and
 * relationships here without touching existing entries.
 */
export const SEED_ACCOUNTS = [
  {
    username: "alice-dev",
    email: "alice.dev@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "recovery-visibility",
    email: "recovery-visibility@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "recovery-invalid-code",
    email: "recovery-invalid-code@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "recovery-success",
    email: "recovery-success@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "password-change-success",
    email: "password-change-success@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "password-change-invalid",
    email: "password-change-invalid@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "password-change-required",
    email: "password-change-required@example.test",
    password: "Valid-password-123!",
  },
  {
    // Owner of the seeded organization; verified and able to create organizations.
    username: "org-owner",
    email: "org-owner@example.test",
    password: "Valid-password-123!",
  },
  {
    // Second Owner of the seeded organization; manages teams in the same organization.
    username: "team-maintainer",
    email: "team-maintainer@example.test",
    password: "Valid-password-123!",
  },
  {
    // Registered organization member available as a candidate for team membership.
    username: "bob-reviewer",
    email: "bob-reviewer@example.test",
    password: "Valid-password-123!",
  },
  {
    // Registered account that is not a member yet; can be added by an Owner.
    username: "new-member",
    email: "new-member@example.test",
    password: "Valid-password-123!",
  },
  {
    // Existing ordinary member of the seeded organization.
    username: "existing-member",
    email: "existing-member@example.test",
    password: "Valid-password-123!",
  },
  {
    // Ordinary non-Owner member of the seeded organization.
    username: "org-member",
    email: "org-member@example.test",
    password: "Valid-password-123!",
  },
  {
    // Another ordinary member of the seeded organization.
    username: "protected-member",
    email: "protected-member@example.test",
    password: "Valid-password-123!",
  },
  {
    // Holds the repository Admin role on the seeded repository `acme-docs` and
    // may therefore manage that repository's access list.
    username: "repo-admin",
    email: "repo-admin@example.test",
    password: "Valid-password-123!",
  },
  {
    // Owns a personal namespace and may create repositories inside it; its
    // personal namespace already contains a repository named `acme-docs`.
    username: "repo-owner",
    email: "repo-owner@example.test",
    password: "Valid-password-123!",
  },
  {
    // May read the public `acme-docs` and create repositories in its personal
    // namespace, which already contains the fork `acme-docs-fork`.
    username: "fork-user",
    email: "fork-user@example.test",
    password: "Valid-password-123!",
  },
  {
    // Administrator of the personal repository `visibility-demo`: as its owner
    // this account reaches the repository Settings and may change visibility.
    username: "visibility-admin",
    email: "visibility-admin@example.test",
    password: "Valid-password-123!",
  },
  {
    // Non-admin collaborator of `visibility-demo`: holds the Write role through
    // a direct grant, so the repository is readable without being manageable.
    username: "collaborator",
    email: "collaborator@example.test",
    password: "Valid-password-123!",
  },
  {
    // Contributor of the branch scenarios: holds Write on `branch-switch-demo`
    // and may therefore create a branch on it.
    username: "branch-contributor",
    email: "branch-contributor@example.test",
    password: "Valid-password-123!",
  },
  {
    // Administrator of `default-branch-demo`: holds the repository Admin role,
    // which is the operation-specific capability the branch settings check.
    username: "default-branch-admin",
    email: "default-branch-admin@example.test",
    password: "Valid-password-123!",
  },
  {
    // Readable non-administrator of `default-branch-demo`: the public
    // repository is browsable while no repository-administration role is held.
    username: "default-branch-viewer",
    email: "default-branch-viewer@example.test",
    password: "Valid-password-123!",
  },
  {
    // Contributor of the file-management scenario: holds Write on the public
    // repository `file-management-demo` and may therefore add a file through a
    // new commit. Read and Triage accounts of the same repository only browse.
    username: "file-contributor",
    email: "file-contributor@example.test",
    password: "Valid-password-123!",
  },
];

/**
 * Seed organization with its repository catalogue and team hierarchy. `name` is
 * the organization's unique name (also the overview heading), `slug` its URL
 * identifier and `displayName` the human-readable name shown in lists. A team's
 * optional `parent` names another team of the same organization.
 */
export const SEED_ORGANIZATIONS = [
  {
    slug: "acme-demo",
    name: "Acme Demo",
    displayName: "Acme Demo",
    owners: ["org-owner", "team-maintainer"],
    // repo-admin holds the repository Admin role below and is a plain member of
    // the organization, so the organization (with that repository) is reachable
    // through "Your organizations" while membership alone grants no other access.
    members: ["repo-admin", "bob-reviewer", "existing-member", "org-member", "protected-member"],
    teams: [
      { name: "platform-team" },
      { name: "frontend-team", parent: "platform-team" },
      { name: "frontend-child", parent: "frontend-team" },
      { name: "access-role-team" },
    ],
    repositories: [
      {
        name: "acme-docs",
        description: "Documentation, guides and release notes for Acme Demo.",
        visibility: "public",
        updatedAt: hoursAgo(3),
        // Two immutable revisions: the initial import of the documentation and
        // the tip that authors `src/search.ts`. The tip is recent so the history
        // reads as a relative timestamp, the older record is dated.
        history: [
          {
            message: "Initial commit",
            author: "ShallowCode",
            committedAt: daysAgo(45),
            changes: [
              { path: "README.md", content: ROOT_README_CONTENT },
              { path: "src/README.md", content: "Document search flow" },
              { path: "src/search.ts", content: SEARCH_TS_INITIAL },
            ],
          },
          {
            message: "Document search flow",
            author: "alice-dev",
            committedAt: hoursAgo(3),
            changes: [{ path: "src/search.ts", content: SEARCH_TS_CURRENT }],
          },
        ],
        // Direct access grants present before the access-management scenarios:
        // repo-admin holds the repository Admin role while access-role-team holds
        // exactly one Write grant. frontend-team deliberately has no grant yet.
        grants: [
          { account: "repo-admin", role: "admin" },
          { team: "access-role-team", role: "write" },
        ],
      },
      {
        name: "secret-research",
        description: "Confidential research notes, visible to authorized members only.",
        visibility: "private",
        updatedAt: "2024-05-03T11:15:00.000Z",
        files: [{ path: "README.md", content: "Confidential research notes" }],
      },
      {
        // Branch demo of the branch selector scenarios: `main` is the active
        // branch, `feature-search` the target branch and `main-only.md` exists
        // on the target branch only. `branch-contributor` holds Write so the
        // same repository also serves the branch-creation scenario.
        name: "branch-switch-demo",
        description: "Demonstrates listing and switching repository branches.",
        visibility: "public",
        updatedAt: hoursAgo(2),
        history: [
          {
            message: "Initial commit",
            author: "ShallowCode",
            committedAt: daysAgo(12),
            changes: [
              { path: "README.md", content: "# branch-switch-demo\n\nBranch browsing demo.\n" },
            ],
          },
        ],
        branches: [
          {
            name: "feature-search",
            message: "Add the branch search notes",
            author: "alice-dev",
            committedAt: hoursAgo(2),
            changes: [
              { path: "main-only.md", content: "# Branch notes\n\nOnly the feature-search branch carries this file.\n" },
            ],
          },
        ],
        grants: [{ account: "branch-contributor", role: "write" }],
      },
      {
        // Default-branch demo of the branch settings scenarios: `main` starts as
        // the default branch while `release` exists as an ordinary branch.
        name: "default-branch-demo",
        description: "Demonstrates changing the repository default branch.",
        visibility: "public",
        updatedAt: hoursAgo(5),
        history: [
          {
            message: "Initial commit",
            author: "ShallowCode",
            committedAt: daysAgo(9),
            changes: [{ path: "README.md", content: "# default-branch-demo\n" }],
          },
        ],
        branches: [
          {
            name: "release",
            message: "Prepare the release branch",
            author: "default-branch-admin",
            committedAt: hoursAgo(5),
            changes: [
              { path: "release-notes.md", content: "Release notes for the next version.\n" },
            ],
          },
        ],
        grants: [{ account: "default-branch-admin", role: "admin" }],
      },
    ],
  },
];

/**
 * Personal repositories of seed accounts. `owner` names the account whose
 * personal namespace holds the repository, `forkedFrom` names the seeded
 * organization repository the fork was copied from (`<slug>/<name>`) and
 * `grants` lists the direct access grants written once with the repository.
 */
export const SEED_USER_REPOSITORIES = [
  {
    // Supplied for duplicate-name validation in the default personal namespace.
    owner: "repo-owner",
    name: "acme-docs",
    description: "Personal notes kept next to the Acme Demo documentation.",
    visibility: "private",
    updatedAt: "2024-05-04T08:00:00.000Z",
    files: [{ path: "README.md", content: "# acme-docs personal copy" }],
  },
  {
    // Existing fork name in the personal namespace of the fork account.
    owner: "fork-user",
    name: "acme-docs-fork",
    description: "Fork of Acme Demo/acme-docs.",
    visibility: "private",
    updatedAt: "2024-05-05T10:00:00.000Z",
    forkedFrom: "acme-demo/acme-docs",
    files: [{ path: "README.md", content: "Document search flow" }],
  },
  {
    // Private repository of the visibility scenarios. Its owner is the
    // repository administrator while `collaborator` holds a non-admin Write
    // grant, so both accounts can open it but only the owner may manage it.
    owner: "visibility-admin",
    name: "visibility-demo",
    description: "Demonstrates changing repository visibility.",
    visibility: "private",
    updatedAt: "2024-05-06T09:00:00.000Z",
    files: [{ path: "README.md", content: "Visibility demo" }],
    grants: [{ account: "collaborator", role: "write" }],
  },
  {
    // Public repository of the file-management scenario. Its own namespace is
    // the contributor's, so `file-contributor` holds the Write capability the
    // scenario expects: the Code page offers “Add file” and the submission
    // creates one commit on the current branch. It starts with the default
    // branch `main` and one stored README.md, so an added file is the first
    // change of the repository.
    owner: "file-contributor",
    name: "file-management-demo",
    description: "Demonstrates adding files through the web interface.",
    visibility: "public",
    updatedAt: hoursAgo(6),
    files: [{ path: "README.md", content: "# file-management-demo\n\nAdd and browse repository files.\n" }],
  },
];

export function createSeedAccount(seed) {
  const { salt, hash } = hashPassword(seed.password);
  return {
    id: seed.id ?? `seed-${seed.username}`,
    username: seed.username,
    email: seed.email,
    emailVerified: seed.emailVerified ?? true,
    status: seed.status ?? "available",
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: seed.createdAt ?? "2024-01-01T00:00:00.000Z",
  };
}

/**
 * Adds any missing seed account while leaving existing accounts (and any user
 * changes to them) untouched.
 */
export function ensureSeedAccounts(state) {
  state.accounts = Array.isArray(state.accounts) ? state.accounts : [];
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  for (const seed of SEED_ACCOUNTS) {
    if (findAccountByUsername(state, seed.username) || findAccountByEmail(state, seed.email)) continue;
    state.accounts.push(createSeedAccount(seed));
  }
}

/**
 * Adds the seed organizations with their memberships and repositories. Existing
 * organizations, relationships and user changes are left untouched.
 */
export function ensureSeedOrganizations(state) {
  state.organizations = Array.isArray(state.organizations) ? state.organizations : [];
  state.organizationMembers = Array.isArray(state.organizationMembers) ? state.organizationMembers : [];
  state.repositories = Array.isArray(state.repositories) ? state.repositories : [];
  state.repositoryGrants = Array.isArray(state.repositoryGrants) ? state.repositoryGrants : [];
  state.teams = Array.isArray(state.teams) ? state.teams : [];
  state.teamMembers = Array.isArray(state.teamMembers) ? state.teamMembers : [];
  state.branches = Array.isArray(state.branches) ? state.branches : [];
  state.commits = Array.isArray(state.commits) ? state.commits : [];
  state.repositoryFiles = Array.isArray(state.repositoryFiles) ? state.repositoryFiles : [];

  for (const seed of SEED_ORGANIZATIONS) {
    let organization = state.organizations.find((candidate) => candidate.slug === seed.slug);
    const isNewOrganization = !organization;
    if (!organization) {
      organization = {
        id: `seed-org-${seed.slug}`,
        slug: seed.slug,
        name: seed.name,
        displayName: seed.displayName,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      state.organizations.push(organization);
    }

    // Membership relationships are written together with the organization and
    // only then: a member a user removed must never come back after a restart.
    if (isNewOrganization) {
      const rolesByUsername = [
        ...seed.owners.map((username) => ({ username, role: ORGANIZATION_ROLE_OWNER })),
        ...seed.members.map((username) => ({ username, role: ORGANIZATION_ROLE_MEMBER })),
      ];
      for (const { username, role } of rolesByUsername) {
        const account = findAccountByUsername(state, username);
        if (!account) continue;
        state.organizationMembers.push({
          id: randomUUID(),
          organizationId: organization.id,
          accountId: account.id,
          role,
          createdAt: "2024-01-01T00:00:00.000Z",
        });
      }
    }

    const createdTeams = [];
    for (const team of seed.teams ?? []) {
      const existing = state.teams.find((candidate) => (
        candidate.organizationId === organization.id && candidate.name === team.name
      ));
      if (existing) continue;
      const created = {
        id: `seed-team-${seed.slug}-${team.name}`,
        organizationId: organization.id,
        name: team.name,
        parentTeamId: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      state.teams.push(created);
      createdTeams.push({ created, parentName: team.parent });
    }

    // Parents are linked once, right after the teams of this seed are stored, so
    // a later user change to the hierarchy survives a restart.
    for (const { created, parentName } of createdTeams) {
      if (!parentName) continue;
      const parent = state.teams.find((candidate) => (
        candidate.organizationId === organization.id && candidate.name === parentName
      ));
      if (parent) created.parentTeamId = parent.id;
    }

    const createdRepositories = [];
    for (const repository of seed.repositories) {
      const existing = state.repositories.find((candidate) => (
        candidate.organizationId === organization.id && candidate.name === repository.name
      ));
      if (existing) {
        seedRepositoryContent(state, existing, repository);
        continue;
      }
      const created = {
        id: `seed-repo-${seed.slug}-${repository.name}`,
        organizationId: organization.id,
        ownerAccountId: null,
        name: repository.name,
        description: repository.description,
        visibility: repository.visibility,
        defaultBranch: DEFAULT_BRANCH_NAME,
        forkedFromRepositoryId: null,
        createdByAccountId: null,
        updatedAt: repository.updatedAt,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      state.repositories.push(created);
      seedRepositoryContent(state, created, repository);
      createdRepositories.push({ created, grants: repository.grants ?? [] });
    }

    // Access grants are written once, with the repository they belong to: a role
    // a user later changes must survive a restart instead of being re-seeded.
    for (const { created, grants } of createdRepositories) {
      for (const grant of grants) {
        const principal = grant.team
          ? { teamId: state.teams.find((candidate) => (
            candidate.organizationId === organization.id && candidate.name === grant.team
          ))?.id }
          : { accountId: findAccountByUsername(state, grant.account)?.id };
        if (!principal.teamId && !principal.accountId) continue;
        state.repositoryGrants.push({
          id: `seed-grant-${seed.slug}-${created.name}-${grant.team ?? grant.account}`,
          repositoryId: created.id,
          role: grant.role,
          createdAt: "2024-01-01T00:00:00.000Z",
          ...principal,
        });
      }
    }
  }
}

/**
 * Writes the default-branch content of one seed repository, but only while it
 * has no branch yet: a later user change to files, commits or the branch list
 * is never overwritten by a restart. A seed may pin a full history instead of a
 * single initial commit, and may add further branches whose first commit is
 * written on top of the base revision.
 */
function seedRepositoryContent(state, repository, seed) {
  if (hasBranch(state, repository)) return;
  if (Array.isArray(seed.history)) {
    initializeRepositoryHistory(state, repository, {
      commits: seed.history.map((entry) => ({
        message: entry.message,
        authorName: entry.author ?? "",
        committedAt: entry.committedAt,
        changes: entry.changes,
      })),
    });
  } else {
    initializeRepositoryContent(state, repository, {
      files: seed.files,
      committedAt: seed.updatedAt,
      authorName: "ShallowCode",
    });
  }

  for (const branch of seed.branches ?? []) {
    const created = createBranch(state, repository, {
      branch: branch.name,
      baseBranch: branch.base,
    });
    if (!created.branch) continue;
    if (!Array.isArray(branch.changes)) continue;
    appendCommit(state, repository, created.branch.name, {
      message: branch.message,
      authorName: branch.author ?? "ShallowCode",
      committedAt: branch.committedAt,
      changes: branch.changes,
    });
  }
}

/** Finds a seeded repository by `"<organization slug>/<name>"`. */
function findSeedOrganizationRepository(state, reference) {
  const [slug, name] = typeof reference === "string" ? reference.split("/") : [];
  if (!slug || !name) return null;
  const organization = state.organizations.find((candidate) => candidate.slug === slug.trim());
  if (!organization) return null;
  return state.repositories.find((candidate) => (
    candidate.organizationId === organization.id && candidate.name === name.trim()
  )) ?? null;
}

/**
 * Adds the personal repositories of seed accounts (their default branch,
 * files and initialization commit included) without touching existing records.
 */
export function ensureSeedUserRepositories(state) {
  state.repositories = Array.isArray(state.repositories) ? state.repositories : [];
  state.repositoryGrants = Array.isArray(state.repositoryGrants) ? state.repositoryGrants : [];
  state.branches = Array.isArray(state.branches) ? state.branches : [];
  state.commits = Array.isArray(state.commits) ? state.commits : [];
  state.repositoryFiles = Array.isArray(state.repositoryFiles) ? state.repositoryFiles : [];

  for (const seed of SEED_USER_REPOSITORIES) {
    const account = findAccountByUsername(state, seed.owner);
    if (!account) continue;
    let repository = state.repositories.find((candidate) => (
      candidate.ownerAccountId === account.id && candidate.name === seed.name
    ));
    let created = false;
    if (!repository) {
      const source = seed.forkedFrom ? findSeedOrganizationRepository(state, seed.forkedFrom) : null;
      repository = {
        id: `seed-repo-user-${seed.owner}-${seed.name}`,
        organizationId: null,
        ownerAccountId: account.id,
        name: seed.name,
        description: seed.description,
        visibility: seed.visibility,
        defaultBranch: DEFAULT_BRANCH_NAME,
        forkedFromRepositoryId: source?.id ?? null,
        createdByAccountId: account.id,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: seed.updatedAt,
      };
      state.repositories.push(repository);
      created = true;
    }
    // Access grants are written once, with the repository they belong to, so a
    // role a user later changes survives a restart instead of being re-seeded.
    if (created) {
      for (const grant of seed.grants ?? []) {
        const grantee = findAccountByUsername(state, grant.account);
        if (!grantee) continue;
        state.repositoryGrants.push({
          id: `seed-grant-user-${seed.owner}-${seed.name}-${grant.account}`,
          repositoryId: repository.id,
          accountId: grantee.id,
          role: grant.role,
          createdAt: "2024-01-01T00:00:00.000Z",
        });
      }
    }
    seedRepositoryContent(state, repository, seed);
  }
}

/** Applies every seed group once, before the first read of a fresh data dir. */
export function ensureSeedData(state) {
  ensureSeedAccounts(state);
  ensureSeedOrganizations(state);
  ensureSeedUserRepositories(state);
}
