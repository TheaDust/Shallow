/**
 * Repository visibility, search and read views (REQ-3, REQ-4).
 *
 * The same access decision backs search results, repository overviews, file
 * reads and commit views, so a visibility change or a new grant is visible
 * everywhere at once. File trees, file content and commit history are derived
 * from the stored commit graph (`domain/commit-graph.mjs`) so every view
 * describes the same revision.
 */

import { effectiveRepositoryRole } from "./repository-access.mjs";
import {
  commitDiff,
  compareRevisions,
  directoryAt,
  fileAt,
  listCommits,
  resolveRevision,
  revisionDescriptor,
  shortCommitId,
} from "./commit-graph.mjs";

export const SEARCH_TYPES = ["repositories", "code", "issues", "pull-requests"];

export function normalizeSearchType(type) {
  const value = String(type ?? "").trim().toLowerCase();
  return SEARCH_TYPES.includes(value) ? value : "repositories";
}

export function findRepository(state, ownerLogin, name) {
  const owner = String(ownerLogin ?? "").trim().toLowerCase();
  const repositoryName = String(name ?? "").trim().toLowerCase();
  if (!owner || !repositoryName) return null;
  return (
    (state.repositories ?? []).find(
      (candidate) =>
        candidate.owner.login.toLowerCase() === owner &&
        candidate.name.toLowerCase() === repositoryName,
    ) ?? null
  );
}

/** `owner/name` reference used by repository-scoped code search. */
export function findRepositoryByFullName(state, fullName) {
  const [owner, ...rest] = String(fullName ?? "").split("/");
  return findRepository(state, owner, rest.join("/"));
}

/**
 * A public repository is readable by everyone. A private repository is readable
 * only by its owner, by an organization Owner and by subjects holding an
 * explicit grant; organization membership alone never grants access. The same
 * check backs search, overviews, files, commits and comparisons.
 */
export function canViewRepository(state, repository, viewer) {
  if (!repository) return false;
  if (repository.visibility !== "private") return true;
  return effectiveRepositoryRole(state, repository, viewer) !== null;
}

export function matchesSearch(repository, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return false;
  return [repository.name, repository.owner.login, repository.description ?? ""].some((value) =>
    String(value).toLowerCase().includes(needle),
  );
}

export function searchRepositories(state, viewer, { query = "", type = "repositories" } = {}) {
  const normalizedType = normalizeSearchType(type);
  const repositories =
    normalizedType === "repositories"
      ? (state.repositories ?? [])
          .filter(
            (repository) =>
              matchesSearch(repository, query) && canViewRepository(state, repository, viewer),
          )
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((repository) => toRepositorySummary(repository, state))
      : [];
  return { query: String(query ?? ""), type: normalizedType, repositories };
}

function toForkSource(source) {
  if (!source) return null;
  return {
    id: source.id,
    owner: source.owner,
    name: source.name,
    fullName: `${source.owner}/${source.name}`,
  };
}

/**
 * Display label of one repository owner: an organization is shown by its
 * display name (REQ-2 repository and team headings read
 * "organization name/repository name"), an account by its login.
 */
export function repositoryOwnerDisplayName(state, owner) {
  if (owner?.type === "organization") {
    const organization =
      (state?.organizations ?? []).find((candidate) => candidate.id === owner.id) ?? null;
    if (organization) return organization.name ?? organization.login;
  }
  return owner?.login ?? "";
}

export function toRepositorySummary(repository, state) {
  return {
    id: repository.id,
    name: repository.name,
    fullName: `${repository.owner.login}/${repository.name}`,
    ownerDisplayName: repositoryOwnerDisplayName(state, repository.owner),
    owner: { type: repository.owner.type, login: repository.owner.login },
    visibility: repository.visibility,
    description: repository.description ?? "",
    defaultBranch: repository.defaultBranch,
    updatedAt: repository.updatedAt,
    forkedFrom: toForkSource(repository.sourceRepository),
  };
}

/** Returns the branch to read, or null when the requested branch does not exist. */
export function resolveBranch(repository, branch) {
  const requested = String(branch ?? "").trim();
  if (!requested) return repository.defaultBranch;
  return (repository.branches ?? []).some((candidate) => candidate.name === requested)
    ? requested
    : null;
}

/** The viewer's permissions travel with every repository view. */
export function repositoryPermissions(state, repository, viewer) {
  const role = effectiveRepositoryRole(state, repository, viewer);
  return { role, canAdminister: role === "admin" };
}

export function listBranchNames(repository) {
  return (repository.branches ?? []).map((branch) => ({
    name: branch.name,
    headCommitId: branch.headCommitId ?? null,
  }));
}

/**
 * Repository identity plus the branch context every code view displays: the
 * current branch, the available branches and the viewer's permission.
 */
export function toRepositoryContext(repository, state, viewer, branch) {
  return {
    ...toRepositorySummary(repository, state),
    branch,
    branches: listBranchNames(repository),
    permissions: repositoryPermissions(state, repository, viewer),
  };
}

/**
 * Code view of one directory on one branch, or null when the path is not a
 * directory of that branch.
 */
export function toRepositoryView(repository, state, viewer, branch, path = "") {
  const directory = directoryAt(repository, branch, path);
  if (!directory) return null;
  return {
    ...toRepositoryContext(repository, state, viewer, branch),
    path: directory.path,
    entries: directory.entries,
    commits: listCommits(repository, branch),
  };
}

function toCommitReference(repository, commit) {
  if (!commit) return null;
  return {
    id: commit.id,
    shortId: shortCommitId(commit.id),
    message: commit.message ?? "",
    author: commit.authorLogin ?? "",
    createdAt: commit.createdAt ?? "",
  };
}

/** Stored content, file name and most recent commit of one file (REQ-4-1). */
export function toFilePayload(repository, branch, path) {
  const file = fileAt(repository, branch, path);
  if (!file) return null;
  return {
    path: file.path,
    name: file.path.split("/").pop(),
    branch,
    content: file.content,
    commit: toCommitReference(repository, file.commit),
  };
}

/** Commit record with its parent, changed files and line-level diff (REQ-4-2-2). */
export function toCommitPayload(repository, commit) {
  const diff = commitDiff(repository, commit);
  return {
    id: commit.id,
    shortId: shortCommitId(commit.id),
    message: commit.message ?? "",
    author: commit.authorLogin ?? "",
    createdAt: commit.createdAt ?? "",
    parentId: commit.parentId ?? null,
    parent: toCommitReference(
      repository,
      (repository.commits ?? []).find((candidate) => candidate.id === commit.parentId) ?? null,
    ),
    // A merge commit (REQ-6-5) carries the merged compare commit as its second
    // parent next to the target-branch head it was written on.
    secondParentId: commit.secondParentId ?? null,
    secondParentShortId: commit.secondParentId ? shortCommitId(commit.secondParentId) : null,
    base: diff.base,
    compare: diff.compare,
    changedFiles: diff.changedFiles,
    filesChanged: diff.filesChanged,
    additions: diff.additions,
    deletions: diff.deletions,
  };
}

/**
 * Comparison of two readable revisions, or null when either reference is
 * unknown (REQ-4-2-2).
 */
export function toComparisonPayload(repository, baseReference, compareReference) {
  const base = resolveRevision(repository, baseReference);
  const compare = resolveRevision(repository, compareReference);
  if (!base || !compare) return null;
  const diff = compareRevisions(repository, base.commit.id, compare.commit.id);
  return {
    base: revisionDescriptor(base),
    compare: revisionDescriptor(compare),
    changedFiles: diff.changedFiles,
    filesChanged: diff.filesChanged,
    additions: diff.additions,
    deletions: diff.deletions,
  };
}

export function listCommitPayloads(repository, branch, path = "") {
  return listCommits(repository, branch, path);
}
