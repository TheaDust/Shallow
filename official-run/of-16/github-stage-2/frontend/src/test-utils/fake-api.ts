import { vi } from "vitest";

import {
  appendRepositoryFile,
  branchNamesOf,
  branchOf,
  branchesOf,
  commitRecordsOf,
  defaultBranchNameOf,
  directoryEntriesOf,
  headSnapshotOf,
  pathsOf,
  type FakeRepository,
} from "./fake-repository-content";
import { isValidBranchName } from "../repositories/branchName";
import {
  handleRepositoryReads,
  type FakeResponse,
  type RepositoryOwnerRef,
} from "./fake-repository-reads";

export type { FakeCommit, FakeCommitChange, FakeRepository } from "./fake-repository-content";
export type { FakeResponse } from "./fake-repository-reads";

export interface FakeAccount {
  username: string;
  email: string;
  password: string;
  /** Personal repositories of this account, mirroring the seeded ones. */
  repositories?: FakeRepository[];
}

/** One changed file of a fake commit; `content: null` removes the file. */
export interface FakeTeam {
  id: string;
  name: string;
  parentTeamId: string | null;
}

export interface FakeOrganization {
  slug: string;
  name: string;
  displayName: string;
  owners?: string[];
  members?: string[];
  teams?: { name: string; parent?: string }[];
  repositories?: FakeRepository[];
}

export interface FakeRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

export type FakeRepositoryRole = "read" | "triage" | "write" | "maintain" | "admin";

/** One direct repository access grant held by a team or an account. */
export interface FakeAccessGrant {
  id: string;
  repositoryName: string;
  teamName?: string;
  username?: string;
  role: FakeRepositoryRole;
}

export interface FakeApiOptions {
  accounts?: FakeAccount[];
  organizations?: FakeOrganization[];
  /** Direct repository access grants, mirroring the seeded grants. */
  grants?: FakeAccessGrant[];
  /** Overrides the register response, e.g. to reproduce server-side field errors. */
  register?: (request: FakeRequest) => FakeResponse | undefined;
  /** Overrides the reset-step response. */
  passwordResetRequest?: (request: FakeRequest) => FakeResponse | undefined;
  /** Overrides the password-update response. */
  passwordResetConfirm?: (request: FakeRequest) => FakeResponse | undefined;
  /** Overrides the change-password response of the signed-in account. */
  changePassword?: (request: FakeRequest) => FakeResponse | undefined;
}

/** Mirrors the server password rule so DOM tests exercise the same reasons. */
function isCompliantPassword(password: string): boolean {
  if (password.length < 12 || password.length > 128) return false;
  if (/\s/.test(password)) return false;
  return /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

/** Mirrors the server organization-name rule (same format as a username). */
function isValidOrganizationName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length >= 1 && name.length <= 39;
}

/** Mirrors the server team-name rule. */
function isValidTeamName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) && name.length >= 1 && name.length <= 50;
}

/** Mirrors the server commit-message rule: 1–72 characters after trimming. */
const COMMIT_MESSAGE_MAX_LENGTH = 72;

/** Mirrors the server storage form of a file path. */
function normalizeFilePath(value: string): string {
  return value.split("/").map((segment) => segment.trim()).filter((segment) => segment.length > 0).join("/");
}

/** Mirrors the server rule of a newly created file path. */
function isValidNewFilePath(value: string, existingPaths: readonly string[]): boolean {
  const raw = value.trim();
  if (raw.length === 0) return false;
  if (raw.startsWith("/")) return false;
  if (raw.split("/").some((segment) => segment.trim() === "..")) return false;
  const path = normalizeFilePath(raw);
  if (path.length === 0) return false;
  if (existingPaths.includes(path)) return false;
  return !existingPaths.some((candidate) => candidate.startsWith(`${path}/`));
}

const REPOSITORY_ROLES: FakeRepositoryRole[] = ["read", "triage", "write", "maintain", "admin"];

/** Roles that may create repository content, mirroring the server rule. */
const REPOSITORY_WRITE_ROLES: FakeRepositoryRole[] = ["write", "maintain", "admin"];

/** An unknown or missing role falls back to the least-privileged role. */
function normalizeRepositoryRole(value: unknown): FakeRepositoryRole {
  return REPOSITORY_ROLES.includes(value as FakeRepositoryRole) ? (value as FakeRepositoryRole) : "read";
}

const DEFAULT_ACCOUNTS: FakeAccount[] = [
  { username: "alice-dev", email: "alice.dev@example.test", password: "Valid-password-123!" },
];

const DEFAULT_ORGANIZATIONS: FakeOrganization[] = [
  {
    slug: "acme-demo",
    name: "Acme Demo",
    displayName: "Acme Demo",
    owners: ["org-owner"],
    repositories: [
      {
        name: "acme-docs",
        description: "Documentation, guides and release notes for Acme Demo.",
        visibility: "public",
        updatedAt: "2024-05-02T09:30:00.000Z",
      },
      {
        name: "secret-research",
        description: "Confidential research notes, visible to authorized members only.",
        visibility: "private",
        updatedAt: "2024-05-03T11:15:00.000Z",
      },
    ],
  },
];

interface StoredTeam extends FakeTeam {
  members: string[];
}

interface StoredOrganization extends FakeOrganization {
  teams: StoredTeam[];
}

/** Public team payload, without the stored team membership list. */
function publicTeam(team: StoredTeam) {
  return { id: team.id, name: team.name, parentTeamId: team.parentTeamId };
}

/** Builds the stored team records of one organization from `{name, parent}` seeds. */
function buildTeams(slug: string, seeds: { name: string; parent?: string }[]): StoredTeam[] {
  const teams: StoredTeam[] = seeds.map((seed) => ({
    id: `team-${slug}-${seed.name}`,
    name: seed.name,
    parentTeamId: null,
    members: [],
  }));
  for (const seed of seeds) {
    if (!seed.parent) continue;
    const team = teams.find((candidate) => candidate.name === seed.name);
    const parent = teams.find((candidate) => candidate.name === seed.parent);
    if (team && parent) team.parentTeamId = parent.id;
  }
  return teams;
}

/** True when `team` is the parent itself or one of its ancestors (a cycle). */
function isCycle(teams: StoredTeam[], parent: StoredTeam, team: StoredTeam): boolean {
  const visited = new Set<string>();
  let current: StoredTeam | null = parent;
  while (current && !visited.has(current.id)) {
    if (current.id === team.id) return true;
    visited.add(current.id);
    current = teams.find((candidate) => candidate.id === current?.parentTeamId) ?? null;
  }
  return false;
}

interface FakePathMatch {
  params: Record<string, string>;
}

function matchPath(pattern: string, path: string): FakePathMatch | null {
  const expected = pattern.split("/").filter(Boolean);
  const actual = path.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(":")) params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
    else if (expected[index] !== actual[index]) return null;
  }
  return { params };
}

/**
 * In-memory stand-in for the auth and organization API. It keeps only the data
 * behaviour a DOM test needs (accounts, sessions, organizations, visibility);
 * the field rules themselves live on the server and are covered by the backend
 * suite.
 */
export function createFakeApi(options: FakeApiOptions = {}) {
  const accounts: FakeAccount[] = (options.accounts ?? DEFAULT_ACCOUNTS).map((account) => ({
    ...account,
    repositories: (account.repositories ?? []).map((repository) => ({ ...repository })),
  }));
  const organizations: StoredOrganization[] = (options.organizations ?? DEFAULT_ORGANIZATIONS).map((organization) => ({
    ...organization,
    owners: [...(organization.owners ?? [])],
    members: [...(organization.members ?? [])],
    teams: buildTeams(organization.slug, organization.teams ?? []),
    repositories: (organization.repositories ?? []).map((repository) => ({ ...repository })),
  }));
  const requests: FakeRequest[] = [];
  const session = { username: null as string | null };
  const grants: FakeAccessGrant[] = (options.grants ?? []).map((grant) => ({ ...grant }));

  const publicAccount = (account: FakeAccount) => ({
    id: `acc-${account.username}`,
    username: account.username,
    email: account.email,
    verified: true,
    status: "available",
  });

  const ok = (status: number, body: unknown): FakeResponse => ({ status, body });

  const publicOrganization = (organization: FakeOrganization) => ({
    slug: organization.slug,
    name: organization.name,
    displayName: organization.displayName,
    createdAt: "2024-01-01T00:00:00.000Z",
  });

  const roleOf = (organization: FakeOrganization, username: string | null) => {
    if (!username) return null;
    if ((organization.owners ?? []).includes(username)) return "owner" as const;
    if ((organization.members ?? []).includes(username)) return "member" as const;
    return null;
  };

  const visibleRepositories = (organization: FakeOrganization, username: string | null) => (
    (organization.repositories ?? []).filter((repository) => (
      repository.visibility === "public" || roleOf(organization, username) === "owner"
    ))
  );

  /** Organization member rows with their roles, Owners first. */
  const memberRows = (organization: FakeOrganization) => [
    ...(organization.owners ?? []).map((username) => ({ username, role: "owner" })),
    ...(organization.members ?? []).map((username) => ({ username, role: "member" })),
  ];

  /**
   * Whether the account may manage a repository's access list. Mirrors the
   * server rule: only an organization Owner or a repository Admin qualifies.
   */
  const canManageAccess = (organization: StoredOrganization, repositoryName: string, username: string | null) => {
    if (!username) return false;
    if (roleOf(organization, username) === "owner") return true;
    const repositoryGrants = grants.filter((grant) => grant.repositoryName === repositoryName);
    if (repositoryGrants.some((grant) => grant.username === username && grant.role === "admin")) return true;
    const memberTeams = organization.teams
      .filter((team) => team.members.includes(username))
      .map((team) => team.name);
    return repositoryGrants.some(
      (grant) => grant.teamName !== undefined && memberTeams.includes(grant.teamName) && grant.role === "admin",
    );
  };

  /** Access rows of one repository: the exact name, the kind and the role. */
  const accessRows = (repositoryName: string) => grants
    .filter((grant) => grant.repositoryName === repositoryName)
    .map((grant) => ({
      id: grant.id,
      kind: grant.teamName ? "team" : "account",
      name: grant.teamName ?? grant.username ?? "",
      role: grant.role,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const accessBody = (organization: StoredOrganization, repository: FakeRepository) => ({
    repository: { ...repository, organization: publicOrganization(organization), canManageAccess: true },
    canManageAccess: true,
    grants: accessRows(repository.name),
    teams: organization.teams.map(publicTeam),
  });

  const defaultBranchOf = (repository: FakeRepository) => defaultBranchNameOf(repository);
  const filesOf = (repository: FakeRepository, branchName?: string) => pathsOf(repository, branchName);

  /** Stored content of one branch head, by path. */
  const contentOf = (repository: FakeRepository, path: string, branchName?: string): string | null => {
    const snapshot = headSnapshotOf(repository, branchName);
    return snapshot.has(path) ? snapshot.get(path)! : null;
  };

  const accountOf = (username: string) => accounts.find((candidate) => candidate.username === username) ?? null;
  const organizationOf = (slug: string) => organizations.find((candidate) => candidate.slug === slug) ?? null;

  /** Direct (non-team) role of one account on a repository, or null. */
  const directRole = (repositoryName: string, username: string | null) => {
    if (!username) return null;
    const grant = grants.find((candidate) => (
      candidate.repositoryName === repositoryName
      && candidate.username === username
      && candidate.teamName === undefined
    ));
    return grant?.role ?? null;
  };

  function repositoriesOfOwner(ownerKind: "organization" | "account", ownerSlug: string): FakeRepository[] {
    if (ownerKind === "organization") return organizationOf(ownerSlug)?.repositories ?? [];
    return accountOf(ownerSlug)?.repositories ?? [];
  }

  function ownerRef(ownerKind: "organization" | "account", ownerSlug: string): RepositoryOwnerRef {
    if (ownerKind === "organization") {
      const organization = organizationOf(ownerSlug);
      return { kind: "organization", name: organization?.name ?? ownerSlug, slug: ownerSlug };
    }
    return { kind: "account", name: ownerSlug, slug: ownerSlug };
  }

  function findRepositoryRecord(ownerKind: "organization" | "account", ownerSlug: string, name: string) {
    return repositoriesOfOwner(ownerKind, ownerSlug)
      .find((repository) => repository.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  /** Read rule mirrored from the server: public, own repository, direct grant, organization Owner. */
  function canReadRepository(ownerKind: "organization" | "account", ownerSlug: string, repository: FakeRepository) {
    if (repository.visibility === "public") return true;
    if (!session.username) return false;
    if (ownerKind === "account") {
      return session.username === ownerSlug || directRole(repository.name, session.username) !== null;
    }
    return roleOf(organizationOf(ownerSlug) ?? { displayName: ownerSlug, name: ownerSlug, slug: ownerSlug }, session.username) === "owner";
  }

  /**
   * Manage rule mirrored from the server: the personal owner, an organization
   * Owner or a repository Admin.
   */
  function canManageRepository(ownerKind: "organization" | "account", ownerSlug: string, repository: FakeRepository) {
    if (!session.username) return false;
    if (ownerKind === "account") {
      return session.username === ownerSlug || directRole(repository.name, session.username) === "admin";
    }
    const organization = organizationOf(ownerSlug);
    if (!organization) return false;
    return canManageAccess(organization, repository.name, session.username);
  }

  /**
   * Write rule mirrored from the server: the personal owner, an organization
   * Owner or a Write/Maintain/Admin grant. Read and Triage only browse.
   */
  function canWriteRepository(ownerKind: "organization" | "account", ownerSlug: string, repository: FakeRepository) {
    if (!session.username) return false;
    if (ownerKind === "account" && session.username === ownerSlug) return true;
    const organization = organizationOf(ownerSlug);
    if (organization && roleOf(organization, session.username) === "owner") return true;
    const direct = directRole(repository.name, session.username);
    if (direct !== null && REPOSITORY_WRITE_ROLES.includes(direct)) return true;
    if (!organization) return false;
    const memberTeams = organization.teams
      .filter((team) => team.members.includes(session.username!))
      .map((team) => team.name);
    return grants.some((grant) => (
      grant.repositoryName === repository.name
      && grant.teamName !== undefined
      && memberTeams.includes(grant.teamName)
      && REPOSITORY_WRITE_ROLES.includes(grant.role)
    ));
  }

  function forkSourceOf(repository: FakeRepository) {
    if (!repository.forkedFrom) return null;
    const [ownerPart, namePart] = repository.forkedFrom.split("/");
    const [ownerKind, ownerSlug] = ownerPart.split(":");
    if (!ownerSlug || !namePart) return null;
    return {
      owner: ownerRef(ownerKind === "organization" ? "organization" : "account", ownerSlug),
      name: namePart,
    };
  }

  /** Overview payload shared by organization and personal repositories. */
  function repositoryViewPayload(
    ownerKind: "organization" | "account",
    ownerSlug: string,
    repository: FakeRepository,
    requestedBranch?: string | null,
  ) {
    const owner = ownerRef(ownerKind, ownerSlug);
    const defaultBranch = defaultBranchOf(repository);
    const wanted = typeof requestedBranch === "string" ? requestedBranch : "";
    const branch = wanted.length > 0 && branchNamesOf(repository).includes(wanted)
      ? wanted
      : defaultBranch;
    const paths = filesOf(repository, branch);
    const canManage = canManageRepository(ownerKind, ownerSlug, repository);
    const records = commitRecordsOf(repository, branch);
    const latest = records.length > 0 ? records[records.length - 1] : null;
    return {
      id: `${ownerKind}:${ownerSlug}/${repository.name}`,
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility,
      defaultBranch,
      branch,
      branches: branchNamesOf(repository),
      updatedAt: repository.updatedAt,
      createdAt: "2024-01-01T00:00:00.000Z",
      owner,
      canManage,
      canManageAccess: canManage,
      canWrite: canWriteRepository(ownerKind, ownerSlug, repository),
      forkSource: forkSourceOf(repository),
      files: directoryEntriesOf(paths, ""),
      latestCommit: latest
        ? {
          id: latest.id,
          message: latest.message,
          authorName: latest.authorName,
          committedAt: latest.committedAt,
        }
        : null,
      commitCount: records.length,
    };
  }

  function repositoryTaken(ownerKind: "organization" | "account", ownerSlug: string, name: string) {
    return repositoriesOfOwner(ownerKind, ownerSlug)
      .some((repository) => repository.name.toLowerCase() === name.toLowerCase());
  }

  /** List entry built from an overview payload. */
  function repositoryViewToSummary(view: ReturnType<typeof repositoryViewPayload>) {
    return {
      name: view.name,
      description: view.description,
      visibility: view.visibility,
      defaultBranch: view.defaultBranch,
      updatedAt: view.updatedAt,
      createdAt: view.createdAt,
      owner: view.owner,
    };
  }

  /** Repository creation and fork requests, mirroring the server checks. */
  function handleRepositories(method: string, path: string, body: Record<string, unknown>): FakeResponse | undefined {
    // The address may carry a query string (repository search, branch snapshot);
    // exact paths and route patterns are matched on the pathname only.
    const [pathname, searchString] = path.split("?");
    const search = new URLSearchParams(searchString ?? "");

    if (method === "GET" && path.startsWith("/api/search/repositories")) {
      const query = new URLSearchParams(path.split("?")[1] ?? "").get("q") ?? "";
      const needle = query.trim().toLowerCase();
      const candidates = [
        ...organizations.flatMap((organization) => (organization.repositories ?? []).map((repository) => ({
          ownerKind: "organization" as const,
          ownerSlug: organization.slug,
          repository,
        }))),
        ...accounts.flatMap((account) => (account.repositories ?? []).map((repository) => ({
          ownerKind: "account" as const,
          ownerSlug: account.username,
          repository,
        }))),
      ];
      const repositories = needle.length === 0
        ? []
        : candidates
          .filter(({ ownerKind, ownerSlug, repository }) => canReadRepository(ownerKind, ownerSlug, repository))
          .filter(({ ownerKind, ownerSlug, repository }) => {
            const owner = ownerRef(ownerKind, ownerSlug);
            return [repository.name, `${owner.name}/${repository.name}`, owner.name, owner.slug]
              .some((candidate) => candidate.toLowerCase().includes(needle));
          })
          .map(({ ownerKind, ownerSlug, repository }) => (
            repositoryViewToSummary(repositoryViewPayload(ownerKind, ownerSlug, repository))
          ))
          .sort((left, right) => (
            `${left.owner.name}/${left.name}`.localeCompare(`${right.owner.name}/${right.name}`)
          ));
      return ok(200, { query, repositories });
    }

    if (method === "GET" && pathname === "/api/explore/repositories") {
      const repositories = [
        ...organizations.flatMap((organization) => (organization.repositories ?? [])
          .filter((repository) => repository.visibility === "public")
          .map((repository) => repositoryViewPayload("organization", organization.slug, repository))),
        ...accounts.flatMap((account) => (account.repositories ?? [])
          .filter((repository) => repository.visibility === "public")
          .map((repository) => repositoryViewPayload("account", account.username, repository))),
      ];
      return ok(200, { repositories: repositories.map((repository) => repositoryViewToSummary(repository)) });
    }

    if (method === "POST" && pathname === "/api/repositories") {
      if (!session.username) return ok(401, { error: "Sign in required" });
      const ownerKind = body.ownerKind === "organization" ? "organization" : "account";
      const ownerSlug = String(body.owner ?? session.username).trim();
      const name = String(body.name ?? "").trim();
      const ownerError = namespaceError(ownerKind, ownerSlug);
      if (ownerError) return ownerError;
      if (name.length === 0) return ok(400, { errors: { name: "Repository name is required" } });
      if (repositoryTaken(ownerKind, ownerSlug, name)) {
        return ok(400, { errors: { name: "Repository name already exists" } });
      }
      const repository: FakeRepository = {
        name,
        description: String(body.description ?? "").trim(),
        visibility: body.visibility === "private" ? "private" : "public",
        updatedAt: new Date().toISOString(),
        defaultBranch: "main",
        files: body.initializeWithReadme === true ? ["README.md"] : [],
      };
      repositoriesOfOwner(ownerKind, ownerSlug).push(repository);
      return ok(201, { repository: repositoryViewPayload(ownerKind, ownerSlug, repository) });
    }

    if (method === "GET" && path.startsWith("/api/repositories/")) {
      const read = handleRepositoryReads(
        {
          signedInUsername: session.username,
          ok,
          ownerRef,
          defaultBranchOf,
          findRepositoryRecord,
          canReadRepository,
        },
        method,
        path,
      );
      if (read) return read;
    }

    // Branch creation: only a write-capable account, only a valid unused name,
    // and the new reference starts at the head of the submitted base branch.
    if (method === "POST" && pathname === "/api/repositories/branches") {
      if (!session.username) return ok(401, { error: "Sign in required" });
      const ownerKind = body.ownerKind === "organization" ? "organization" as const : "account" as const;
      const ownerSlug = String(body.owner ?? "").trim();
      const repository = findRepositoryRecord(ownerKind, ownerSlug, String(body.name ?? ""));
      if (!repository) return ok(404, { error: "Not found" });
      if (!canReadRepository(ownerKind, ownerSlug, repository)) return ok(403, { error: "Access denied" });
      if (!canWriteRepository(ownerKind, ownerSlug, repository)) return ok(403, { error: "Access denied" });
      const branchName = String(body.branch ?? "").trim();
      if (!isValidBranchName(branchName)) {
        return ok(400, { errors: { branch: "Invalid branch" } });
      }
      if (branchNamesOf(repository).includes(branchName)) {
        return ok(400, { errors: { branch: "Branch name already exists" } });
      }
      const baseName = String(body.baseBranch ?? "").trim() || defaultBranchOf(repository);
      if (!branchNamesOf(repository).includes(baseName)) {
        return ok(400, { errors: { branch: "Branch not found" } });
      }
      const branches = branchesOf(repository);
      branches.push({ name: branchName, files: [...filesOf(repository, baseName)] });
      return ok(201, {
        repository: repositoryViewPayload(ownerKind, ownerSlug, repository, branchName),
      });
    }

    // Adding one file on one branch: a write-capable account may submit, and
    // the path and commit-message rules are mirrored from the server so a
    // rejected submission stores nothing.
    if (method === "POST" && pathname === "/api/repositories/files") {
      if (!session.username) return ok(401, { error: "Sign in required" });
      const ownerKind = body.ownerKind === "organization" ? "organization" as const : "account" as const;
      const ownerSlug = String(body.owner ?? "").trim();
      const repository = findRepositoryRecord(ownerKind, ownerSlug, String(body.name ?? ""));
      if (!repository) return ok(404, { error: "Not found" });
      if (!canReadRepository(ownerKind, ownerSlug, repository)) return ok(403, { error: "Access denied" });
      if (!canWriteRepository(ownerKind, ownerSlug, repository)) return ok(403, { error: "Access denied" });
      const branchName = String(body.branch ?? "").trim() || defaultBranchOf(repository);
      if (!branchNamesOf(repository).includes(branchName)) {
        return ok(400, { errors: { branch: "Branch not found" } });
      }
      const existing = [...headSnapshotOf(repository, branchName).keys()];
      const message = String(body.message ?? "").trim();
      const errors: Record<string, string> = {};
      if (!isValidNewFilePath(String(body.path ?? ""), existing)) {
        errors.path = "Invalid file path";
      }
      if (message.length === 0) errors.message = "Commit message is required";
      else if (message.length > COMMIT_MESSAGE_MAX_LENGTH) {
        errors.message = "Commit message must be 72 characters or less";
      }
      if (Object.keys(errors).length > 0) return ok(400, { errors });
      const path = normalizeFilePath(String(body.path ?? ""));
      const content = typeof body.content === "string" ? body.content : "";
      appendRepositoryFile(repository, branchName, {
        path,
        content,
        message,
        author: session.username,
        committedAt: new Date().toISOString(),
      });
      const records = commitRecordsOf(repository, branchName);
      return ok(201, {
        file: {
          name: path.split("/").pop() ?? path,
          path,
          branch: branchName,
          content,
          repository: repository.name,
          owner: ownerRef(ownerKind, ownerSlug),
        },
        commit: records[records.length - 1] ?? null,
      });
    }

    // Default-branch change: only the repository administrator may store it,
    // and only an existing branch is accepted.
    if (method === "POST" && pathname === "/api/repositories/default-branch") {
      if (!session.username) return ok(401, { error: "Sign in required" });
      const ownerKind = body.ownerKind === "organization" ? "organization" as const : "account" as const;
      const ownerSlug = String(body.owner ?? "").trim();
      const repository = findRepositoryRecord(ownerKind, ownerSlug, String(body.name ?? ""));
      if (!repository) return ok(404, { error: "Not found" });
      if (!canReadRepository(ownerKind, ownerSlug, repository)) return ok(403, { error: "Access denied" });
      if (!canManageRepository(ownerKind, ownerSlug, repository)) return ok(403, { error: "Access denied" });
      const branchName = String(body.branch ?? "").trim();
      if (!branchNamesOf(repository).includes(branchName)) {
        return ok(400, { errors: { branch: "Branch not found" } });
      }
      repository.defaultBranch = branchName;
      return ok(200, {
        repository: repositoryViewPayload(ownerKind, ownerSlug, repository, branchName),
      });
    }

    if (method === "POST" && pathname === "/api/repositories/visibility") {
      if (!session.username) return ok(401, { error: "Sign in required" });
      const ownerKind = body.ownerKind === "organization" ? "organization" : "account";
      const ownerSlug = String(body.owner ?? "").trim();
      const repository = findRepositoryRecord(ownerKind, ownerSlug, String(body.name ?? ""));
      if (!repository) return ok(404, { error: "Not found" });
      if (!canManageRepository(ownerKind, ownerSlug, repository)) {
        return ok(403, { error: "Access denied" });
      }
      const visibility = body.visibility;
      if (visibility !== "public" && visibility !== "private") {
        return ok(400, { errors: { visibility: "Visibility is invalid" } });
      }
      repository.visibility = visibility;
      repository.updatedAt = new Date().toISOString();
      return ok(200, { repository: repositoryViewPayload(ownerKind, ownerSlug, repository) });
    }

    const userListMatch = matchPath("/api/users/:username/repositories", pathname);
    if (method === "GET" && userListMatch) {
      const account = accountOf(userListMatch.params.username);
      if (!account) return ok(404, { error: "Not found" });
      const visible = (account.repositories ?? [])
        .filter((repository) => canReadRepository("account", account.username, repository))
        .map((repository) => repositoryViewToSummary(repositoryViewPayload("account", account.username, repository)));
      return ok(200, { owner: ownerRef("account", account.username), repositories: visible });
    }

    const userViewMatch = matchPath("/api/users/:username/repositories/:name", pathname);
    if (method === "GET" && userViewMatch) {
      const repository = findRepositoryRecord("account", userViewMatch.params.username, userViewMatch.params.name);
      if (!repository) return ok(404, { error: "Not found" });
      if (!canReadRepository("account", userViewMatch.params.username, repository)) {
        return session.username ? ok(403, { error: "Access denied" }) : ok(404, { error: "Not found" });
      }
      return ok(200, {
        repository: repositoryViewPayload(
          "account",
          userViewMatch.params.username,
          repository,
          search.get("branch"),
        ),
      });
    }

    const forkUserMatch = matchPath("/api/users/:username/repositories/:name/fork", pathname);
    const forkOrganizationMatch = matchPath("/api/organizations/:slug/repositories/:name/fork", pathname);
    if (method === "POST" && (forkUserMatch || forkOrganizationMatch)) {
      if (!session.username) return ok(401, { error: "Sign in required" });
      const sourceKind = forkOrganizationMatch ? "organization" : "account";
      const sourceSlug = forkOrganizationMatch ? forkOrganizationMatch.params.slug : forkUserMatch!.params.username;
      const sourceName = forkOrganizationMatch ? forkOrganizationMatch.params.name : forkUserMatch!.params.name;
      const source = findRepositoryRecord(sourceKind, sourceSlug, sourceName);
      if (!source) return ok(404, { error: "Not found" });
      if (!canReadRepository(sourceKind, sourceSlug, source)) return ok(403, { error: "Access denied" });
      const ownerKind = body.ownerKind === "organization" ? "organization" : "account";
      const ownerSlug = String(body.owner ?? session.username).trim();
      const ownerError = namespaceError(ownerKind, ownerSlug);
      if (ownerError) return ownerError;
      const name = String(body.name ?? "").trim();
      if (name.length === 0) return ok(400, { errors: { name: "Repository name is required" } });
      if (repositoryTaken(ownerKind, ownerSlug, name)) {
        return ok(400, { errors: { name: "Repository name already exists" } });
      }
      const fork: FakeRepository = {
        name,
        description: source.description,
        visibility: source.visibility === "private"
          ? "private"
          : (body.visibility === "private" ? "private" : "public"),
        updatedAt: new Date().toISOString(),
        defaultBranch: defaultBranchOf(source),
        files: [...filesOf(source)],
        forkedFrom: `${sourceKind}:${sourceSlug}/${source.name}`,
      };
      repositoriesOfOwner(ownerKind, ownerSlug).push(fork);
      return ok(201, { repository: repositoryViewPayload(ownerKind, ownerSlug, fork) });
    }

    return undefined;
  }

  /** The submitted namespace must exist and allow the signed-in account. */
  function namespaceError(ownerKind: "organization" | "account", ownerSlug: string): FakeResponse | undefined {
    const forbidden = ok(400, { errors: { owner: "You cannot create repositories in this namespace" } });
    if (ownerKind === "organization") {
      const organization = organizationOf(ownerSlug);
      if (!organization || roleOf(organization, session.username) !== "owner") return forbidden;
      return undefined;
    }
    if (!accountOf(ownerSlug)) return forbidden;
    if (session.username !== ownerSlug) return forbidden;
    return undefined;
  }

  /** Organization routes, mirroring the server's visibility and access rules. */
  function handleOrganizations(method: string, path: string, body: Record<string, unknown>): FakeResponse | undefined {
    const [pathname, searchString] = path.split("?");
    const search = new URLSearchParams(searchString ?? "");
    if (method === "GET" && pathname === "/api/explore/organizations") {
      return ok(200, { organizations: organizations.map(publicOrganization) });
    }
    if (method === "GET" && pathname === "/api/organizations") {
      if (!session.username) return ok(401, { error: "Sign in required" });
      const mine = organizations
        .map((organization) => ({ organization, role: roleOf(organization, session.username) }))
        .filter(({ role }) => role !== null)
        .map(({ organization, role }) => ({ ...publicOrganization(organization), role }));
      return ok(200, { organizations: mine });
    }
    if (method === "POST" && pathname === "/api/organizations") {
      if (!session.username) return ok(401, { error: "Sign in required" });
      const name = String(body.name ?? "").trim();
      const displayName = String(body.displayName ?? "").trim();
      const key = name.toLowerCase();
      const slug = key.replace(/\s+/g, "-");
      if (organizations.some((organization) => (
        organization.name.toLowerCase() === key
        || organization.displayName.toLowerCase() === key
        || organization.slug === slug
      ))) {
        return ok(400, { errors: { name: "Organization name already exists" } });
      }
      const errors: Record<string, string> = {};
      if (!isValidOrganizationName(name)) errors.name = "Organization name format is invalid";
      if (displayName.length === 0) errors.displayName = "Display name is required";
      else if (displayName.length > 100) errors.displayName = "Display name is invalid";
      if (Object.keys(errors).length > 0) return ok(400, { errors });
      const created: StoredOrganization = {
        slug,
        name,
        displayName,
        owners: [session.username],
        teams: [],
        repositories: [],
      };
      organizations.push(created);
      return ok(201, { organization: publicOrganization(created) });
    }

    const repositoryMatch = matchPath("/api/organizations/:slug/repositories/:name", pathname);
    if (method === "GET" && repositoryMatch) {
      const organization = organizations.find((candidate) => candidate.slug === repositoryMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      const repository = findRepositoryRecord("organization", organization.slug, repositoryMatch.params.name);
      if (!repository) return ok(404, { error: "Not found" });
      if (!canReadRepository("organization", organization.slug, repository)) {
        return session.username ? ok(403, { error: "Access denied" }) : ok(404, { error: "Not found" });
      }
      return ok(200, {
        repository: {
          ...repositoryViewPayload("organization", organization.slug, repository, search.get("branch")),
          organization: publicOrganization(organization),
        },
      });
    }

    const accessGrantMatch = matchPath("/api/organizations/:slug/repositories/:name/access/:grantId", pathname);
    if (accessGrantMatch) {
      const organization = organizations.find((candidate) => candidate.slug === accessGrantMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      const repository = (organization.repositories ?? []).find(
        (candidate) => candidate.name.toLowerCase() === accessGrantMatch.params.name.toLowerCase(),
      );
      if (!repository) return ok(404, { error: "Not found" });
      if (!session.username) return ok(401, { error: "Sign in required" });
      if (!canManageAccess(organization, repository.name, session.username)) {
        return ok(403, { error: "Access denied" });
      }
      if (method === "PATCH") {
        const grant = grants.find((candidate) => candidate.id === accessGrantMatch.params.grantId);
        if (!grant || grant.repositoryName !== repository.name) {
          return ok(400, { errors: { role: "Access grant not found" } });
        }
        grant.role = normalizeRepositoryRole(body.role);
        return ok(200, accessBody(organization, repository));
      }
    }

    const accessMatch = matchPath("/api/organizations/:slug/repositories/:name/access", pathname);
    if (accessMatch) {
      const organization = organizations.find((candidate) => candidate.slug === accessMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      const repository = (organization.repositories ?? []).find(
        (candidate) => candidate.name.toLowerCase() === accessMatch.params.name.toLowerCase(),
      );
      if (!repository) return ok(404, { error: "Not found" });
      if (!session.username) return ok(401, { error: "Sign in required" });
      if (!canManageAccess(organization, repository.name, session.username)) {
        return ok(403, { error: "Access denied" });
      }
      if (method === "GET") return ok(200, accessBody(organization, repository));
      if (method === "POST") {
        const teamName = String(body.teamName ?? "").trim();
        const team = organization.teams.find((candidate) => candidate.name === teamName);
        if (!team) return ok(400, { errors: { teamName: "Team not found" } });
        const role = normalizeRepositoryRole(body.role);
        const existing = grants.find(
          (candidate) => candidate.repositoryName === repository.name && candidate.teamName === teamName,
        );
        if (existing) existing.role = role;
        else {
          grants.push({
            id: `grant-${organization.slug}-${repository.name}-${teamName}`,
            repositoryName: repository.name,
            teamName,
            role,
          });
        }
        return ok(200, accessBody(organization, repository));
      }
    }

    const repositoriesMatch = matchPath("/api/organizations/:slug/repositories", pathname);
    if (method === "GET" && repositoriesMatch) {
      const organization = organizations.find((candidate) => candidate.slug === repositoriesMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      return ok(200, {
        organization: publicOrganization(organization),
        repositories: visibleRepositories(organization, session.username).map((repository) => ({ ...repository })),
      });
    }

    const membersMatch = matchPath("/api/organizations/:slug/members", pathname);
    if (membersMatch) {
      const organization = organizations.find((candidate) => candidate.slug === membersMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      if (method === "GET") return ok(200, { members: memberRows(organization) });
      if (method === "POST") {
        if (!session.username) return ok(401, { error: "Sign in required" });
        if (roleOf(organization, session.username) !== "owner") return ok(403, { error: "Access denied" });
        const identifier = String(body.identifier ?? "").trim();
        const account = accounts.find(
          (candidate) => candidate.username === identifier || candidate.email === identifier,
        );
        if (!account) return ok(400, { errors: { identifier: "Account not found" } });
        if (roleOf(organization, account.username) !== null) {
          return ok(400, { errors: { identifier: "Account is already a member" } });
        }
        const role = body.role === "owner" ? "owner" : "member";
        organization[role === "owner" ? "owners" : "members"]!.push(account.username);
        return ok(200, { members: memberRows(organization) });
      }
    }

    const memberMatch = matchPath("/api/organizations/:slug/members/:username", pathname);
    if (method === "DELETE" && memberMatch) {
      const organization = organizations.find((candidate) => candidate.slug === memberMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      if (!session.username) return ok(401, { error: "Sign in required" });
      if (roleOf(organization, session.username) !== "owner") return ok(403, { error: "Access denied" });
      const { username } = memberMatch.params;
      if ((organization.owners ?? []).includes(username) && organization.owners!.length <= 1) {
        return ok(400, { error: "Organization must have at least one owner" });
      }
      organization.owners = (organization.owners ?? []).filter((candidate) => candidate !== username);
      organization.members = (organization.members ?? []).filter((candidate) => candidate !== username);
      return ok(200, { members: memberRows(organization) });
    }

    const teamsMatch = matchPath("/api/organizations/:slug/teams", pathname);
    if (teamsMatch) {
      const organization = organizations.find((candidate) => candidate.slug === teamsMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      if (method === "GET") return ok(200, { teams: organization.teams.map(publicTeam) });
      if (method === "POST") {
        if (!session.username) return ok(401, { error: "Sign in required" });
        if (roleOf(organization, session.username) !== "owner") return ok(403, { error: "Access denied" });
        const name = String(body.name ?? "").trim();
        if (!isValidTeamName(name)) return ok(400, { errors: { name: "Team name is invalid" } });
        if (organization.teams.some((team) => team.name.toLowerCase() === name.toLowerCase())) {
          return ok(400, { errors: { name: "Team name already exists" } });
        }
        const created: StoredTeam = { id: `team-${organization.slug}-${name}`, name, parentTeamId: null, members: [] };
        organization.teams.push(created);
        return ok(201, { team: publicTeam(created) });
      }
    }

    const teamMembersMatch = matchPath("/api/organizations/:slug/teams/:name/members", pathname);
    if (teamMembersMatch) {
      const organization = organizations.find((candidate) => candidate.slug === teamMembersMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      const team = organization.teams.find((candidate) => candidate.name === teamMembersMatch.params.name);
      if (!team) return ok(404, { error: "Not found" });
      if (method === "GET") return ok(200, { members: team.members.map((username) => ({ username })) });
      if (method === "POST") {
        if (!session.username) return ok(401, { error: "Sign in required" });
        if (roleOf(organization, session.username) !== "owner") return ok(403, { error: "Access denied" });
        const username = String(body.username ?? "").trim();
        const account = accounts.find((candidate) => candidate.username === username);
        if (!account) return ok(400, { errors: { username: "Account not found" } });
        if (roleOf(organization, username) === null) {
          return ok(400, { errors: { username: "Account is not an organization member" } });
        }
        if (!team.members.includes(username)) team.members.push(username);
        return ok(200, { members: team.members.map((member) => ({ username: member })) });
      }
    }

    const teamMemberMatch = matchPath("/api/organizations/:slug/teams/:name/members/:username", pathname);
    if (method === "DELETE" && teamMemberMatch) {
      const organization = organizations.find((candidate) => candidate.slug === teamMemberMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      const team = organization.teams.find((candidate) => candidate.name === teamMemberMatch.params.name);
      if (!team) return ok(404, { error: "Not found" });
      team.members = team.members.filter((username) => username !== teamMemberMatch.params.username);
      return ok(200, { members: team.members.map((username) => ({ username })) });
    }

    const teamMatch = matchPath("/api/organizations/:slug/teams/:name", pathname);
    if (teamMatch) {
      const organization = organizations.find((candidate) => candidate.slug === teamMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      const team = organization.teams.find((candidate) => candidate.name === teamMatch.params.name);
      if (!team) return ok(404, { error: "Not found" });
      if (method === "GET") {
        const parent = organization.teams.find((candidate) => candidate.id === team.parentTeamId) ?? null;
        return ok(200, {
          team: publicTeam(team),
          parentTeam: parent ? publicTeam(parent) : null,
          organization: publicOrganization(organization),
          role: roleOf(organization, session.username),
          teams: organization.teams.map(publicTeam),
        });
      }
      if (method === "PATCH") {
        if (!session.username) return ok(401, { error: "Sign in required" });
        if (roleOf(organization, session.username) !== "owner") return ok(403, { error: "Access denied" });
        const parentName = String(body.parentTeamName ?? "").trim();
        const parent = parentName
          ? organization.teams.find((candidate) => candidate.name === parentName) ?? null
          : null;
        if (parentName && !parent) return ok(400, { errors: { parentTeam: "Parent team is invalid" } });
        if (parent && isCycle(organization.teams, parent, team)) {
          return ok(400, { errors: { parentTeam: "Cyclic team hierarchy is not allowed" } });
        }
        team.parentTeamId = parent ? parent.id : null;
        return ok(200, { team: publicTeam(team) });
      }
    }

    const overviewMatch = matchPath("/api/organizations/:slug", pathname);
    if (method === "GET" && overviewMatch) {
      const organization = organizations.find((candidate) => candidate.slug === overviewMatch.params.slug);
      if (!organization) return ok(404, { error: "Not found" });
      return ok(200, {
        organization: publicOrganization(organization),
        role: roleOf(organization, session.username),
      });
    }

    return undefined;
  }

  function handle(method: string, path: string, body: Record<string, unknown>): FakeResponse {
    const account = accounts.find(
      (candidate) => candidate.username === body.identifier || candidate.email === body.identifier,
    );

    if (method === "GET" && path === "/api/auth/session") {
      const current = accounts.find((candidate) => candidate.username === session.username);
      return ok(200, { account: current ? publicAccount(current) : null });
    }
    if (method === "POST" && path === "/api/auth/signin") {
      if (!account || account.password !== body.password) return ok(401, { error: "Invalid credentials" });
      session.username = account.username;
      return ok(200, { account: publicAccount(account) });
    }
    if (method === "POST" && path === "/api/auth/signout") {
      session.username = null;
      return ok(200, { ok: true });
    }
    if (method === "POST" && path === "/api/auth/password") {
      const custom = options.changePassword?.({ method, path, body });
      if (custom) return custom;
      const current = accounts.find((candidate) => candidate.username === session.username);
      if (!current) return ok(401, { error: "Sign in required" });
      const currentPassword = String(body.currentPassword ?? "");
      if (currentPassword.length === 0) {
        return ok(400, { errors: { currentPassword: "Current password is required" } });
      }
      if (current.password !== currentPassword) {
        return ok(400, { errors: { currentPassword: "Current password is incorrect" } });
      }
      const newPassword = String(body.newPassword ?? "");
      if (!isCompliantPassword(newPassword)) {
        return ok(400, { errors: { newPassword: "Password requirements are not satisfied" } });
      }
      if (body.confirmPassword !== newPassword) {
        return ok(400, { errors: { confirmPassword: "Password confirmation does not match" } });
      }
      current.password = newPassword;
      return ok(200, { message: "Password updated" });
    }
    if (method === "POST" && path === "/api/auth/register") {
      const custom = options.register?.({ method, path, body });
      if (custom) return custom;
      if (accounts.some((candidate) => candidate.username === body.username)) {
        return ok(400, { errors: { username: "Username already exists" } });
      }
      if (accounts.some((candidate) => candidate.email === body.email)) {
        return ok(400, { errors: { email: "Email already exists" } });
      }
      const created: FakeAccount = {
        username: String(body.username),
        email: String(body.email),
        password: String(body.password),
      };
      accounts.push(created);
      return ok(201, { account: publicAccount(created) });
    }
    if (method === "POST" && path === "/api/auth/password-reset/request") {
      return options.passwordResetRequest?.({ method, path, body }) ?? ok(200, { code: "123456" });
    }
    if (method === "POST" && path === "/api/auth/password-reset/confirm") {
      const custom = options.passwordResetConfirm?.({ method, path, body });
      if (custom) return custom;
      if (body.code !== "123456") return ok(400, { errors: { code: "Verification code is invalid" } });
      const target = accounts.find((candidate) => candidate.email === body.email);
      if (target) target.password = String(body.newPassword);
      return ok(200, { message: "Password updated" });
    }

    return handleRepositories(method, path, body)
      ?? handleOrganizations(method, path, body)
      ?? ok(404, { error: "Not found" });
  }

  const api = {
    accounts,
    organizations,
    grants,
    requests,
    signInAs(username: string | null) {
      session.username = username;
    },
    currentUsername() {
      return session.username;
    },
    install() {
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
        const method = (init?.method ?? "GET").toUpperCase();
        const body =
          typeof init?.body === "string" && init.body.length > 0
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        requests.push({ method, path, body });
        const { status, body: payload } = handle(method, path, body);
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as unknown as Response;
      });
      return api;
    },
  };

  return api;
}
