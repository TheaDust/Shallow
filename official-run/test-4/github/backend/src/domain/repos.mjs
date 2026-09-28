import { randomUUID } from "node:crypto";

import {
  canReadRepository,
  effectiveRepositoryRole,
  findOrganization,
  findRepository,
  organizationRole,
} from "./organizations.mjs";
import {
  branchCommitIds,
  branchSnapshot,
  makeSeedCommit,
} from "./vcs.mjs";

const REPO_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const REPO_NAME_MAX = 100;

export function validateRepositoryName(value) {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > REPO_NAME_MAX) return false;
  return REPO_NAME_PATTERN.test(value);
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Seeds the personal repositories of `alice-dev` used by the REQ-3 and REQ-4
 * scenarios: the public `acme-docs` repository with the `main` and
 * `feature-search` branches and the known commit history, a private
 * repository inaccessible to visitors, and the existing fork-name conflict
 * seed in the personal namespace. Only runs when no account-owned repository
 * exists yet; user changes survive restarts.
 */
export function seedRepositories(state) {
  if (state.repositories.some((repository) => repository.ownerType === "account")) return;

  const alice = state.accounts.find((account) => account.username === "alice-dev");
  if (!alice) return;
  const bob = state.accounts.find((account) => account.username === "bob-reviewer");

  const now = new Date().toISOString();
  const makeRepo = (name, description, visibility) => ({
    id: `repo_${randomUUID()}`,
    ownerId: alice.id,
    ownerType: "account",
    name,
    description,
    visibility,
    defaultBranch: "main",
    creatorAccountId: alice.id,
    sourceRepositoryId: null,
    createdAt: now,
    updatedAt: now,
    branches: [],
    commits: [],
  });

  const readmeV1 =
    "# Acme Docs\n\nPublic documentation for the Acme Demo platform.\n\nThe search flow is documented in this repository.\n";
  const guide = "# Guide\n\nHow to use the Acme Demo platform.\n";
  const searchV1 = "export function search(query: string) {\n  return query.trim();\n}\n";
  const readmeV2 =
    "# Acme Docs\n\nPublic documentation for the Acme Demo platform.\n\nThe search flow is documented in this repository.\n\n## Search flow\n\nEnter a keyword in the repository search box and press Enter to see matching files.\n";
  const searchV2 =
    "export function search(query: string) {\n  return query.trim().toLowerCase();\n}\n// search flow scan highlights matching lines.\nexport function highlight(text: string): string {\n  return text;\n}\n";
  const searchV3 =
    "export function search(query: string) {\n  return query.trim().toLowerCase();\n}\n// feature-search highlights matching lines.\nexport function highlight(text: string): string {\n  return text.toUpperCase();\n}\n";

  const acmeDocs = makeRepo("acme-docs", "Documentation for Acme Demo", "public");
  const commitA = makeSeedCommit({
    repositoryId: acmeDocs.id,
    parentId: null,
    parentFiles: [],
    authorAccountId: alice.id,
    authorName: "alice-dev",
    message: "Initial commit",
    createdAt: daysAgo(5),
    files: [
      { path: "README.md", content: readmeV1 },
      { path: "guide.md", content: guide },
      { path: "src/search.ts", content: searchV1 },
    ],
  });
  const commitB = makeSeedCommit({
    repositoryId: acmeDocs.id,
    parentId: commitA.id,
    parentFiles: commitA.files,
    authorAccountId: alice.id,
    authorName: "alice-dev",
    message: "Document search flow",
    createdAt: daysAgo(2),
    files: [
      { path: "README.md", content: readmeV2 },
      { path: "guide.md", content: guide },
      { path: "src/search.ts", content: searchV2 },
      { path: "docs/overview.md", content: "# Overview\n\nGuides and reference material for the Acme Docs platform.\n" },
    ],
  });
  // `feature-search` is exactly one commit ahead of `main`: it carries the
  // main history plus one commit that changes src/search.ts and adds
  // main-only.md (absent from main). REQ-4-3-1 and REQ-6-2-2 both depend on
  // this relationship.
  const commitF = makeSeedCommit({
    repositoryId: acmeDocs.id,
    parentId: commitB.id,
    parentFiles: commitB.files,
    authorAccountId: alice.id,
    authorName: "alice-dev",
    message: "Add feature search docs",
    createdAt: daysAgo(1),
    files: [
      { path: "README.md", content: readmeV2 },
      { path: "guide.md", content: guide },
      { path: "src/search.ts", content: searchV3 },
      { path: "main-only.md", content: "# Main-only\n\nThis file exists only on the feature-search branch.\n" },
    ],
  });
  // `release` is one commit ahead of `main` and changes src/search.ts plus
  // adds CHANGELOG.md, so the seeded Open PR (main ← release) carries one
  // modified and one added file with the known `src/search.ts` path
  // (REQ-6-3-1/6-3-2). `draft-feature` is the compare branch of the seeded
  // ready-for-review Draft PR (REQ-6-2-4); it shares the feature-search head.
  const releaseFiles = commitB.files.map((file) =>
    file.path === "src/search.ts" ? { path: "src/search.ts", content: searchV3 } : file,
  );
  releaseFiles.push({
    path: "CHANGELOG.md",
    content: "# Changelog\n\n- Document the search flow for the next release.\n",
  });
  const commitR = makeSeedCommit({
    repositoryId: acmeDocs.id,
    parentId: commitB.id,
    parentFiles: commitB.files,
    authorAccountId: alice.id,
    authorName: "alice-dev",
    message: "Add changelog",
    createdAt: daysAgo(1),
    files: releaseFiles,
  });
  // `merge-ready` carries one commit ahead of `main` (a new release-notes
  // file) so the seeded merge-eligible Open PR has a real, conflict-free diff
  // on the protected `main` target (REQ-6-5). The other REQ-6 review PRs use
  // branches that point at existing heads so each PR has a distinct pair.
  const mergeFiles = [
    ...commitB.files,
    {
      path: "docs/release-notes.md",
      content: "# Release notes\n\n- Search flow improvements land in this release.\n",
    },
  ];
  const commitM = makeSeedCommit({
    repositoryId: acmeDocs.id,
    parentId: commitB.id,
    parentFiles: commitB.files,
    authorAccountId: alice.id,
    authorName: "alice-dev",
    message: "Prepare release notes",
    createdAt: daysAgo(1),
    files: mergeFiles,
  });
  acmeDocs.commits = [commitA, commitB, commitF, commitR, commitM];
  acmeDocs.branches = [
    { name: "main", commitId: commitB.id, protected: false },
    { name: "feature-search", commitId: commitF.id, protected: true },
    { name: "release", commitId: commitR.id, protected: false },
    { name: "draft-feature", commitId: commitF.id, protected: false },
    { name: "feature-review", commitId: commitR.id, protected: false },
    { name: "review-candidate", commitId: commitF.id, protected: false },
    { name: "merge-ready", commitId: commitM.id, protected: false },
    { name: "merge-blocked", commitId: commitF.id, protected: false },
  ];

  const secretResearch = makeRepo("secret-research", "Confidential research notes", "private");
  const secretCommit = makeSeedCommit({
    repositoryId: secretResearch.id,
    parentId: null,
    parentFiles: [],
    authorAccountId: alice.id,
    authorName: "alice-dev",
    message: "Initial commit",
    createdAt: daysAgo(4),
    files: [
      { path: "README.md", content: "# Secret Research\n\nPrivate research notes. The search flow term is also present here.\n" },
      { path: "notes.md", content: "Findings are stored here. Search flow details stay private.\n" },
    ],
  });
  secretResearch.commits = [secretCommit];
  secretResearch.branches = [{ name: "main", commitId: secretCommit.id, protected: false }];

  const forkConflict = makeRepo(
    "acme-docs-fork",
    "Existing fork name used for the conflict case",
    "private",
  );
  const conflictCommit = makeSeedCommit({
    repositoryId: forkConflict.id,
    parentId: null,
    parentFiles: [],
    authorAccountId: alice.id,
    authorName: "alice-dev",
    message: "Initial commit",
    createdAt: daysAgo(4),
    files: [
      { path: "README.md", content: "# Acme Docs Fork\n\nA repository that already occupies the fork name.\n" },
    ],
  });
  forkConflict.commits = [conflictCommit];
  forkConflict.branches = [{ name: "main", commitId: conflictCommit.id, protected: false }];

  state.repositories.push(acmeDocs, secretResearch, forkConflict);
  if (bob) {
    state.repoGrants.push({
      repositoryId: secretResearch.id,
      subjectType: "account",
      subjectId: bob.id,
      role: "read",
      grantorAccountId: alice.id,
      createdAt: now,
    });
  }
}

export function findAccountRepository(state, accountId, name) {
  return (
    state.repositories.find(
      (candidate) =>
        candidate.ownerId === accountId &&
        candidate.ownerType === "account" &&
        candidate.name === name,
    ) ?? null
  );
}

function ownerName(state, repository) {
  if (repository.ownerType === "organization") {
    return state.organizations.find((candidate) => candidate.id === repository.ownerId)?.name ?? null;
  }
  if (repository.ownerType === "account") {
    return state.accounts.find((candidate) => candidate.id === repository.ownerId)?.username ?? null;
  }
  return null;
}

function accountName(state, accountId) {
  return state.accounts.find((candidate) => candidate.id === accountId)?.username ?? "unknown";
}

/**
 * The repository detail payload: identity, visibility, default branch,
 * update time, the current user's effective role, the named branches, the
 * file snapshot of the requested (or default) branch, the current branch,
 * the branch commit count, and (for forks) the source-repository link. The
 * caller resolves the requested branch name against the repository first and
 * returns a not-found response for unknown branches.
 */
export function describeRepository(state, repository, accountId, branchName = null) {
  const owner = ownerName(state, repository);
  let source = null;
  if (repository.sourceRepositoryId) {
    const sourceRepo = state.repositories.find((candidate) => candidate.id === repository.sourceRepositoryId);
    if (sourceRepo) {
      source = {
        ownerType: sourceRepo.ownerType,
        ownerName: ownerName(state, sourceRepo),
        name: sourceRepo.name,
      };
    }
  }
  const branches = (repository.branches ?? []).map((branch) => ({
    name: branch.name,
    protected: Boolean(branch.protected),
  }));
  const currentBranch =
    branches.find((branch) => branch.name === branchName)?.name ??
    branches.find((branch) => branch.name === repository.defaultBranch)?.name ??
    branches[0]?.name ??
    repository.defaultBranch ??
    "main";
  let files = [];
  let commitCount = 0;
  if (Array.isArray(repository.branches)) {
    const snapshot = branchSnapshot(repository, currentBranch);
    files = (snapshot ?? []).map((file) => ({ path: file.path, content: file.content }));
    commitCount = branchCommitIds(repository, currentBranch).length;
  } else {
    // Legacy record fallback (flat files, no branch store yet).
    files = (repository.files ?? []).map((file) => ({
      path: file.path ?? file.name,
      content: file.content,
    }));
  }
  return {
    ownerType: repository.ownerType,
    ownerName: owner,
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch,
    updatedAt: repository.updatedAt,
    currentRole: effectiveRepositoryRole(state, accountId, repository),
    files,
    branches,
    currentBranch,
    commitCount,
    source,
  };
}

/**
 * Personal repositories of one account, scoped to what the viewer may read.
 */
export function listAccountRepositories(state, account, viewerId) {
  return state.repositories
    .filter(
      (repository) =>
        repository.ownerType === "account" && repository.ownerId === account.id,
    )
    .filter((repository) => canReadRepository(state, viewerId, repository))
    .map((repository) => describeRepository(state, repository, viewerId))
    .filter((repository) => repository.ownerName)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Global repository search: every repository the requester may read whose
 * name contains the query (case-insensitive). Returns owner/name metadata so
 * results can be opened from their direct address.
 */
export function searchRepositories(state, query, accountId) {
  const value = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!value) return [];
  return state.repositories
    .filter((repository) => repository.name.toLowerCase().includes(value))
    .filter((repository) => canReadRepository(state, accountId, repository))
    .map((repository) => describeRepository(state, repository, accountId))
    .filter((repository) => repository.ownerName)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Creation permission in the target namespace: any signed-in account may
 * create personal repositories; only an organization Owner may create (fork
 * into) an organization namespace.
 */
export function canCreateRepositoryInNamespace(state, accountId, ownerType, ownerName) {
  if (!accountId) return false;
  if (ownerType === "account") {
    const account = state.accounts.find((candidate) => candidate.username === ownerName);
    return Boolean(account && account.id === accountId);
  }
  if (ownerType === "organization") {
    const organization = findOrganization(state, ownerName);
    return Boolean(organization && organizationRole(state, organization.id, accountId) === "owner");
  }
  return false;
}

function resolveSource(state, ownerType, ownerName, repoName) {
  if (ownerType === "organization") {
    const organization = findOrganization(state, ownerName);
    if (!organization) return null;
    return findRepository(state, organization.id, repoName);
  }
  if (ownerType === "account") {
    const account = state.accounts.find((candidate) => candidate.username === ownerName);
    if (!account) return null;
    return findAccountRepository(state, account.id, repoName);
  }
  return null;
}

/**
 * Creates an independent fork: copies the source's default branch files and
 * records the source-repository identifier. The fork's owner and visibility
 * come from the target namespace; a private source always yields a private
 * fork. Returns { ok: true, repository } or { ok: false, forbidden } /
 * { ok: false, errors } with a field message for name conflicts or format
 * errors. No fork is created when any check fails.
 */
export function createFork(
  state,
  { accountId, sourceOwnerType, sourceOwner, sourceRepo, targetOwnerType, targetOwner, name, visibility } = {},
) {
  if (!accountId) return { ok: false, forbidden: true };

  const source = resolveSource(state, sourceOwnerType, sourceOwner, sourceRepo);
  if (!source || !canReadRepository(state, accountId, source)) {
    return { ok: false, forbidden: true };
  }

  let targetOwnerId = null;
  let targetOwnerTypeNorm = targetOwnerType;
  if (targetOwnerType === "account") {
    const account = state.accounts.find((candidate) => candidate.username === targetOwner);
    if (!account || account.id !== accountId) return { ok: false, forbidden: true };
    targetOwnerId = account.id;
  } else if (targetOwnerType === "organization") {
    const organization = findOrganization(state, targetOwner);
    if (!organization || organizationRole(state, organization.id, accountId) !== "owner") {
      return { ok: false, forbidden: true };
    }
    targetOwnerId = organization.id;
  } else {
    return { ok: false, forbidden: true };
  }

  const errors = {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!validateRepositoryName(trimmedName)) {
    errors.name = "Repository name format is invalid";
  } else if (
    state.repositories.some(
      (candidate) =>
        candidate.ownerId === targetOwnerId &&
        candidate.ownerType === targetOwnerTypeNorm &&
        candidate.name === trimmedName,
    )
  ) {
    errors.name = "Repository name already exists";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const resolvedVisibility = source.visibility === "private" ? "private" : visibility;
  const finalVisibility =
    resolvedVisibility === "public" || resolvedVisibility === "private" ? resolvedVisibility : source.visibility;

  const now = new Date().toISOString();
  const repository = {
    id: `repo_${randomUUID()}`,
    ownerId: targetOwnerId,
    ownerType: targetOwnerTypeNorm,
    name: trimmedName,
    description: source.description,
    visibility: finalVisibility,
    defaultBranch: source.defaultBranch,
    creatorAccountId: accountId,
    sourceRepositoryId: source.id,
    createdAt: now,
    updatedAt: now,
    branches: [],
    commits: [],
  };
  const sourceSnapshot = branchSnapshot(source, source.defaultBranch) ?? [];
  if (sourceSnapshot.length > 0) {
    const commit = makeSeedCommit({
      repositoryId: repository.id,
      parentId: null,
      parentFiles: [],
      authorAccountId: accountId,
      authorName: accountName(state, accountId),
      message: "Initial commit",
      createdAt: now,
      files: sourceSnapshot,
    });
    repository.commits = [commit];
    repository.branches = [{ name: source.defaultBranch || "main", commitId: commit.id, protected: false }];
  } else {
    repository.branches = [{ name: source.defaultBranch || "main", commitId: null, protected: false }];
  }
  state.repositories.push(repository);
  return { ok: true, repository };
}

/**
 * Creates a new repository in a personal or organization namespace. The
 * signed-in account must own the personal namespace or be an Owner of the
 * organization, the name must be unique in the target namespace, and the
 * visibility must be public or private. When initialization is selected, the
 * initial branch (default branch), README file, and one initialization commit
 * are created atomically with the repository; every failed check happens
 * before anything is pushed, so no partially created repository survives.
 */
export function createRepository(
  state,
  { accountId, ownerType, owner, name, description, visibility, initReadme } = {},
) {
  if (!accountId) return { ok: false, forbidden: true };
  if (!canCreateRepositoryInNamespace(state, accountId, ownerType, owner)) {
    return { ok: false, forbidden: true };
  }

  let ownerId = null;
  let ownerTypeNorm = ownerType;
  if (ownerType === "account") {
    const account = state.accounts.find((candidate) => candidate.username === owner);
    if (!account) return { ok: false, forbidden: true };
    ownerId = account.id;
  } else if (ownerType === "organization") {
    const organization = findOrganization(state, owner);
    if (!organization) return { ok: false, forbidden: true };
    ownerId = organization.id;
  } else {
    return { ok: false, forbidden: true };
  }

  const errors = {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!validateRepositoryName(trimmedName)) {
    errors.name = "Repository name format is invalid";
  } else if (
    state.repositories.some(
      (candidate) =>
        candidate.ownerId === ownerId &&
        candidate.ownerType === ownerTypeNorm &&
        candidate.name === trimmedName,
    )
  ) {
    errors.name = "Repository name already exists";
  }
  const normalizedVisibility = typeof visibility === "string" ? visibility.toLowerCase() : "";
  if (normalizedVisibility !== "public" && normalizedVisibility !== "private") {
    errors.visibility = "Visibility is invalid";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const now = new Date().toISOString();
  const repository = {
    id: `repo_${randomUUID()}`,
    ownerId,
    ownerType: ownerTypeNorm,
    name: trimmedName,
    description: typeof description === "string" ? description.trim() : "",
    visibility: normalizedVisibility,
    defaultBranch: "main",
    creatorAccountId: accountId,
    sourceRepositoryId: null,
    createdAt: now,
    updatedAt: now,
    branches: [{ name: "main", commitId: null, protected: false }],
    commits: [],
  };
  if (initReadme === true) {
    const commit = makeSeedCommit({
      repositoryId: repository.id,
      parentId: null,
      parentFiles: [],
      authorAccountId: accountId,
      authorName: accountName(state, accountId),
      message: "Initial commit",
      createdAt: now,
      files: [{ path: "README.md", content: `# ${trimmedName}\n` }],
    });
    repository.commits = [commit];
    repository.branches[0].commitId = commit.id;
  }
  state.repositories.push(repository);
  return { ok: true, repository };
}

/**
 * Stores a new default branch for a repository (REQ-4-3-3). Only a
 * repository Admin or organization Owner (effective role admin) may change
 * it; the selected branch must already exist. Records the operator and time
 * alongside the new value; existing branches, commits, and the previous
 * default branch are never deleted or rewritten.
 */
export function changeDefaultBranch(state, repository, { accountId, branch } = {}) {
  if (effectiveRepositoryRole(state, accountId, repository) !== "admin") {
    return { ok: false, forbidden: true };
  }
  const name = typeof branch === "string" ? branch : "";
  if (!(repository.branches ?? []).some((candidate) => candidate.name === name)) {
    return { ok: false, errors: { branch: "Branch not found" } };
  }
  const now = new Date().toISOString();
  repository.defaultBranch = name;
  repository.defaultBranchChangedBy = accountId;
  repository.defaultBranchChangedAt = now;
  repository.updatedAt = now;
  return { ok: true };
}

/**
 * Applies the selected visibility to a repository; permission is validated by
 * the caller against the current session before invoking this.
 */
export function changeRepositoryVisibility(state, { repositoryId, visibility } = {}) {
  const normalized = typeof visibility === "string" ? visibility.toLowerCase() : "";
  if (normalized !== "public" && normalized !== "private") {
    return { ok: false, errors: { visibility: "Visibility is invalid" } };
  }
  const repository = state.repositories.find((candidate) => candidate.id === repositoryId);
  if (!repository) return { ok: false, notFound: true };
  repository.visibility = normalized;
  repository.updatedAt = new Date().toISOString();
  return { ok: true };
}
