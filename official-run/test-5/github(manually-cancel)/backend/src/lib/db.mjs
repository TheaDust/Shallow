import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hashPassword } from "../domain/accounts.mjs";
import { createJsonStore } from "./json-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = resolve(here, "../../.data");

export function resolveDataDir() {
  const configured = process.env.SHALLOW_DATA_DIR;
  return configured && configured.trim() ? resolve(configured) : defaultDataDir;
}

/**
 * Seed state shared by every scenario of the identity module: the verified,
 * available account `alice-dev`. Seed records are written only when the store
 * file does not exist yet, so user changes survive restarts.
 */
export const SEED_ACCOUNT = {
  id: "acc-alice-dev",
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

/** Seed account that appears as an organization member (REQ-2-1-1 scenarios). */
export const SEED_MEMBER_ACCOUNT = {
  id: "acc-bob-reviewer",
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  password: "Valid-password-123!",
};

/** Seed organization of the REQ-2 module and its governance relationships. */
export const SEED_ORGANIZATION = {
  id: "org-acme-demo",
  name: "Acme Demo",
  displayName: "Acme Demo",
  createdAt: "2024-01-05T09:00:00.000Z",
};

/** Seed teams: `platform-team` → `frontend-team` → `frontend-child`. */
export const SEED_TEAMS = [
  {
    id: "team-platform-team",
    organizationId: SEED_ORGANIZATION.id,
    name: "platform-team",
    description: "Platform engineering",
    parentTeamId: null,
    createdById: SEED_ACCOUNT.id,
    createdAt: "2024-01-06T09:00:00.000Z",
    memberIds: [],
  },
  {
    id: "team-frontend-team",
    organizationId: SEED_ORGANIZATION.id,
    name: "frontend-team",
    description: "Frontend engineering",
    parentTeamId: "team-platform-team",
    createdById: SEED_ACCOUNT.id,
    createdAt: "2024-01-07T09:00:00.000Z",
    memberIds: [],
  },
  {
    id: "team-frontend-child",
    organizationId: SEED_ORGANIZATION.id,
    name: "frontend-child",
    description: "Frontend sub-team",
    parentTeamId: "team-frontend-team",
    createdById: SEED_ACCOUNT.id,
    createdAt: "2024-01-08T09:00:00.000Z",
    memberIds: [],
  },
];

/**
 * Seed repositories of the seed organization: `acme-docs` is the public repository
 * of REQ-2-1-1, `acme-internal` and `secret-research` are private ones that plain
 * organization members and visitors cannot read.
 */
export const SEED_REPOSITORIES = [
  {
    id: "repo-acme-docs",
    ownerType: "organization",
    ownerId: SEED_ORGANIZATION.id,
    name: "acme-docs",
    description: "Public documentation for the Acme platform",
    visibility: "public",
    defaultBranch: "main",
    createdById: SEED_ACCOUNT.id,
    createdAt: "2024-02-01T09:00:00.000Z",
    updatedAt: "2024-03-15T09:30:00.000Z",
  },
  {
    id: "repo-acme-internal",
    ownerType: "organization",
    ownerId: SEED_ORGANIZATION.id,
    name: "acme-internal",
    description: "Private planning material for the Acme platform",
    visibility: "private",
    defaultBranch: "main",
    createdById: SEED_ACCOUNT.id,
    createdAt: "2024-02-10T09:00:00.000Z",
    updatedAt: "2024-04-02T16:45:00.000Z",
  },
  {
    id: "repo-acme-secret-research",
    ownerType: "organization",
    ownerId: SEED_ORGANIZATION.id,
    name: "secret-research",
    description: "Private research material for the Acme platform",
    visibility: "private",
    defaultBranch: "main",
    createdById: SEED_ACCOUNT.id,
    createdAt: "2024-02-12T09:00:00.000Z",
    updatedAt: "2024-04-05T11:20:00.000Z",
  },
];

/**
 * Seed repositories of the personal namespace of the seed account. The REQ-3
 * scenarios read the public `acme-docs` here; the `alice-dev/acme-docs` record
 * also supplies the existing name that the creation form reports as a duplicate.
 */
export const SEED_PERSONAL_REPOSITORIES = [
  {
    id: "repo-alice-acme-docs",
    ownerType: "account",
    ownerId: SEED_ACCOUNT.id,
    name: "acme-docs",
    description: "Alice's public documentation notes",
    visibility: "public",
    defaultBranch: "main",
    createdById: SEED_ACCOUNT.id,
    createdAt: "2024-02-05T09:00:00.000Z",
    updatedAt: "2024-03-20T10:15:00.000Z",
  },
];

/** Seed content: one initialization commit and a few files per seeded repository. */
const SEED_REPOSITORY_FILES = {
  "repo-acme-docs": [
    ["README.md", "# acme-docs\n\nPublic documentation for the Acme platform\n"],
    ["docs/overview.md", "# Overview\n\nHow the Acme platform fits together.\n"],
  ],
  "repo-acme-internal": [["README.md", "# acme-internal\n\nPrivate planning material for the Acme platform\n"]],
  "repo-acme-secret-research": [
    ["README.md", "# secret-research\n\nPrivate research material for the Acme platform\n"],
    ["notes/plan.md", "# Plan\n\nCurrent research questions.\n"],
  ],
  "repo-alice-acme-docs": [["README.md", "# acme-docs\n\nAlice's public documentation notes\n"]],
};

function seedAccountRecord(seed) {
  return {
    id: seed.id,
    username: seed.username,
    email: seed.email,
    passwordHash: hashPassword(seed.password),
    emailVerified: true,
    status: "active",
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

function initialAccountsState() {
  return { accounts: [seedAccountRecord(SEED_ACCOUNT), seedAccountRecord(SEED_MEMBER_ACCOUNT)] };
}

function initialSessionsState() {
  return { sessions: [] };
}

function initialOrganizationsState() {
  return { organizations: [{ ...SEED_ORGANIZATION }] };
}

function initialOrganizationMembersState() {
  return {
    memberships: [
      {
        id: "orgmem-alice-acme",
        organizationId: SEED_ORGANIZATION.id,
        accountId: SEED_ACCOUNT.id,
        role: "owner",
        createdAt: SEED_ORGANIZATION.createdAt,
      },
      {
        id: "orgmem-bob-acme",
        organizationId: SEED_ORGANIZATION.id,
        accountId: SEED_MEMBER_ACCOUNT.id,
        role: "member",
        createdAt: "2024-01-05T10:00:00.000Z",
      },
    ],
  };
}

function initialTeamsState() {
  return { teams: SEED_TEAMS.map((team) => ({ ...team, memberIds: [...team.memberIds] })) };
}

export function seedRepositories() {
  return [...SEED_REPOSITORIES, ...SEED_PERSONAL_REPOSITORIES].map((repository) => ({
    ...repository,
  }));
}

function initialRepositoriesState() {
  return { repositories: seedRepositories() };
}

function initialRepositoryGrantsState() {
  return { grants: [] };
}

/**
 * Branches, commits and files of the seeded repositories: every seeded repository
 * carries its default branch, one initialization commit and the files above, so a
 * seeded repository overview already exposes a file list and a commit history.
 */
function initialRepositoryContentState() {
  const branches = [];
  const commits = [];
  const files = [];
  for (const repository of seedRepositories()) {
    const paths = SEED_REPOSITORY_FILES[repository.id] ?? [];
    const commitId = `commit-${repository.id}-initial`;
    branches.push({
      id: `branch-${repository.id}-main`,
      repositoryId: repository.id,
      name: repository.defaultBranch,
      commitId,
      createdAt: repository.createdAt,
    });
    commits.push({
      id: commitId,
      repositoryId: repository.id,
      branch: repository.defaultBranch,
      message: "Initial commit",
      authorId: SEED_ACCOUNT.id,
      authorName: SEED_ACCOUNT.username,
      createdAt: repository.createdAt,
      parentId: null,
      changedPaths: paths.map(([path]) => path),
    });
    paths.forEach(([path, content], index) => {
      files.push({
        id: `file-${repository.id}-${index}`,
        repositoryId: repository.id,
        branch: repository.defaultBranch,
        path,
        content,
        updatedAt: repository.updatedAt,
      });
    });
  }
  return { branches, commits, files };
}

let cached = null;

export function getStores() {
  const directory = resolveDataDir();
  if (cached && cached.directory === directory) return cached;
  const accounts = createJsonStore(join(directory, "accounts.json"), initialAccountsState());
  const sessions = createJsonStore(join(directory, "sessions.json"), initialSessionsState());
  const organizations = createJsonStore(
    join(directory, "organizations.json"),
    initialOrganizationsState(),
  );
  const organizationMembers = createJsonStore(
    join(directory, "organization-members.json"),
    initialOrganizationMembersState(),
  );
  const teams = createJsonStore(join(directory, "teams.json"), initialTeamsState());
  const repositories = createJsonStore(join(directory, "repositories.json"), initialRepositoriesState());
  const repositoryGrants = createJsonStore(
    join(directory, "repository-grants.json"),
    initialRepositoryGrantsState(),
  );
  const repositoryContent = createJsonStore(
    join(directory, "repository-content.json"),
    initialRepositoryContentState(),
  );
  cached = {
    directory,
    accounts,
    sessions,
    organizations,
    organizationMembers,
    teams,
    repositories,
    repositoryGrants,
    repositoryContent,
    // Persist the seed records so they exist before any scenario runs.
    ready: Promise.all([
      accounts.seedIfMissing(),
      sessions.seedIfMissing(),
      organizations.seedIfMissing(),
      organizationMembers.seedIfMissing(),
      teams.seedIfMissing(),
      repositories.seedIfMissing(),
      repositoryGrants.seedIfMissing(),
      repositoryContent.seedIfMissing(),
    ]),
  };
  return cached;
}

export function ensureSeedData() {
  const stores = getStores();
  return stores.ready.then(() => stores);
}
