// Commit history and revision comparison.
//
// Both are read-only views over the stored commits: the branch history walks
// the parent links of one branch, and a comparison is the line diff of two
// stored snapshots. Nothing here creates a commit, moves a branch or writes a
// file. Permission is always the repository-read rule resolved from the
// trusted session.

import { changedPaths, diffSnapshots } from "./commit-diff.mjs";
import {
  authorNameOf,
  branchByName,
  branchCommitChain,
  branchNamesOf,
  commitById,
  commitsTouchingPath,
  normalizePath,
  publicRepositoryPayload,
  resolveRepositoryForViewer,
  shortSha,
  collection,
} from "./repository-code.mjs";

function commitIdentity(state, commit) {
  return {
    id: commit.id,
    sha: commit.sha,
    shortSha: shortSha(commit.sha),
    message: commit.message,
    author: authorNameOf(state, commit),
    createdAt: commit.createdAt,
  };
}

function parentOf(state, commit) {
  return commit?.parentId ? commitById(state, commit.parentId) : null;
}

/** One history row: identifier, author, time, message, parent and files. */
function historyRecord(state, commit) {
  const parent = parentOf(state, commit);
  return {
    ...commitIdentity(state, commit),
    parentId: parent?.id ?? null,
    parentSha: parent?.sha ?? null,
    parentMessage: parent?.message ?? null,
    changedFiles: changedPaths(parent, commit),
  };
}

/** Every revision the comparison selects offer: commits and branch names. */
function revisionOptions(state, repository) {
  const commits = [];
  const seen = new Set();
  for (const branch of collection(state, "branches").filter(
    (candidate) => candidate.repositoryId === repository.id,
  )) {
    for (const commit of branchCommitChain(state, branch)) {
      if (seen.has(commit.id)) continue;
      seen.add(commit.id);
      commits.push(commit);
    }
  }
  commits.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return commits.map((commit) => ({
    value: commit.sha,
    label: `${shortSha(commit.sha)} ${commit.message}`,
    createdAt: commit.createdAt,
  }));
}

function comparisonPayload(state, repository, baseCommit, compareCommit, pathFilter) {
  const diff = diffSnapshots(baseCommit, compareCommit);
  const files =
    pathFilter.length > 0 ? diff.files.filter((file) => file.path === pathFilter) : diff.files;
  return {
    base: baseCommit ? commitIdentity(state, baseCommit) : null,
    compare: commitIdentity(state, compareCommit),
    path: pathFilter,
    files,
    // The summary always counts every changed file of the comparison.
    changedFileCount: diff.files.length,
    additions: diff.files.reduce((total, file) => total + file.additions, 0),
    deletions: diff.files.reduce((total, file) => total + file.deletions, 0),
    revisions: revisionOptions(state, repository),
  };
}

/** Resolves a branch name or a commit sha (full or short) of one repository. */
function revisionByNameOrSha(state, repository, value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const wanted = value.trim();
  const branch = branchByName(state, repository.id, wanted);
  if (branch) return branch.commitId ? commitById(state, branch.commitId) : null;
  return (
    collection(state, "commits").find(
      (commit) => commit.repositoryId === repository.id && commit.sha === wanted,
    ) ??
    collection(state, "commits").find(
      (commit) =>
        commit.repositoryId === repository.id &&
        typeof commit.sha === "string" &&
        commit.sha.startsWith(wanted),
    ) ??
    null
  );
}

function contextBranch(state, repository, commit) {
  const branches = collection(state, "branches").filter(
    (candidate) => candidate.repositoryId === repository.id,
  );
  const holding = branches.find((branch) =>
    branchCommitChain(state, branch).some((candidate) => candidate.id === commit.id),
  );
  return (holding ?? branches.find((branch) => branch.name === repository.defaultBranch) ?? branches[0])
    ?.name ?? repository.defaultBranch ?? null;
}

export function createRepositoryHistoryService(store) {
  /** The branch history, or only the history that changed one file path. */
  async function listForViewer(owner, repositoryName, options, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;

    const branch = branchByName(
      state,
      repository.id,
      options?.branch ?? repository.defaultBranch,
    );
    if (!branch) return { status: "branch-not-found" };

    const path = normalizePath(options?.path ?? "");
    if (path === null) return { status: "not-found" };

    const chain = branchCommitChain(state, branch);
    // A file-scoped history only lists the commits that changed that file, so
    // a commit that merely carries the file along is not part of it.
    const commits = path.length > 0 ? commitsTouchingPath(chain, path) : chain;
    if (path.length > 0 && commits.length === 0) return { status: "path-not-found" };

    return {
      status: "ok",
      history: {
        repository: publicRepositoryPayload(state, repository, accountId),
        branch: branch.name,
        branches: branchNamesOf(state, repository),
        path,
        commitCount: chain.length,
        commits: commits.map((commit) => historyRecord(state, commit)),
      },
    };
  }

  /** One commit entry with its parent revision and the diff against it. */
  async function commitForViewer(owner, repositoryName, revision, options, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;

    const commit = revisionByNameOrSha(state, repository, revision);
    if (!commit) return { status: "not-found" };

    const path = normalizePath(options?.path ?? "");
    if (path === null) return { status: "not-found" };

    const branch = contextBranch(state, repository, commit);
    const parent = parentOf(state, commit);
    return {
      status: "ok",
      commitView: {
        repository: publicRepositoryPayload(state, repository, accountId),
        branch,
        branches: branchNamesOf(state, repository),
        commit: historyRecord(state, commit),
        comparison: comparisonPayload(state, repository, parent, commit, path),
      },
    };
  }

  /** The standalone comparison of two readable revisions. */
  async function compareForViewer(owner, repositoryName, options, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;

    const branch = branchByName(
      state,
      repository.id,
      options?.branch ?? repository.defaultBranch,
    );
    if (!branch) return { status: "branch-not-found" };
    const head = branch.commitId ? commitById(state, branch.commitId) : null;
    if (!head) return { status: "not-found" };

    const requestedBase = options?.base ?? "";
    const requestedCompare = options?.compare ?? "";
    const compareCommit = requestedCompare
      ? revisionByNameOrSha(state, repository, requestedCompare)
      : head;
    const baseCommit = requestedBase
      ? revisionByNameOrSha(state, repository, requestedBase)
      : parentOf(state, compareCommit ?? head);
    if (!compareCommit) return { status: "not-found" };
    if (requestedBase && !baseCommit) return { status: "not-found" };

    const path = normalizePath(options?.path ?? "");
    if (path === null) return { status: "not-found" };

    return {
      status: "ok",
      comparison: {
        repository: publicRepositoryPayload(state, repository, accountId),
        branch: branch.name,
        branches: branchNamesOf(state, repository),
        ...comparisonPayload(state, repository, baseCommit, compareCommit, path),
      },
    };
  }

  return { listForViewer, commitForViewer, compareForViewer };
}
