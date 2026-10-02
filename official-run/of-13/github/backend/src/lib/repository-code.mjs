// Read-only code model shared by the repository overview, the Code pages, the
// commit views and the in-repository code search. A branch is a named
// reference to a commit, and a commit stores the file snapshot of that
// revision, so history is never rewritten by reading it. Access always goes
// through `canReadRepository`.

import {
  canReadRepository,
  effectiveRepositoryRole,
  ownerNameOf,
  repositoryByOwnerAndName,
} from "./access.mjs";
import { sourceRepositorySummary } from "./repositories.mjs";

export function collection(state, key) {
  const value = state?.[key];
  return Array.isArray(value) ? value : [];
}

export function branchesOf(state, repositoryId) {
  return collection(state, "branches").filter(
    (branch) => branch.repositoryId === repositoryId,
  );
}

export function branchByName(state, repositoryId, name) {
  if (typeof name !== "string" || name.length === 0) return null;
  return branchesOf(state, repositoryId).find((branch) => branch.name === name) ?? null;
}

export function commitById(state, id) {
  return collection(state, "commits").find((commit) => commit.id === id) ?? null;
}

/** Normalizes a repository-relative path; `null` means the path is invalid. */
export function normalizePath(value) {
  if (typeof value !== "string") return "";
  const parts = value.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

export function filesOfCommit(commit) {
  return Array.isArray(commit?.files) ? commit.files : [];
}

/** The short form of a stored commit sha, as every history list shows it. */
export function shortSha(sha) {
  return typeof sha === "string" && sha.length > 7 ? sha.slice(0, 7) : (sha ?? "");
}

export function authorNameOf(state, commit) {
  return (
    collection(state, "accounts").find((account) => account.id === commit?.authorId)?.username ??
    null
  );
}

/**
 * The commits reachable from a revision, newest first, following the stored
 * parent links. A malformed cycle stops the walk instead of looping forever.
 */
export function commitChain(state, headId) {
  const commits = [];
  const seen = new Set();
  let current = commitById(state, headId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    commits.push(current);
    current = current.parentId ? commitById(state, current.parentId) : null;
  }
  return commits;
}

/** The commits of a branch, newest first. */
export function branchCommitChain(state, branch) {
  return branch ? commitChain(state, branch.commitId) : [];
}

export function fileInCommit(commit, filePath) {
  return filesOfCommit(commit).find((file) => file.path === filePath) ?? null;
}

/** Directory entries derived from the file snapshot of a commit. */
export function entriesInDirectory(commit, directoryPath) {
  const prefix = directoryPath.length > 0 ? `${directoryPath}/` : "";
  const directories = new Set();
  const files = [];
  for (const file of filesOfCommit(commit)) {
    const path = typeof file?.path === "string" ? file.path : "";
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) files.push({ name: rest, path, type: "file" });
    else directories.add(rest.slice(0, slash));
  }
  const directoryEntries = [...directories]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      path: directoryPath.length > 0 ? `${directoryPath}/${name}` : name,
      type: "directory",
    }));
  return [
    ...directoryEntries,
    ...files.sort((left, right) => left.name.localeCompare(right.name)),
  ];
}

/**
 * Resolves `owner/name` for a viewer. The same access rule as every other
 * repository read: unknown stays 404, unreadable stays 403.
 */
export function resolveRepositoryForViewer(state, owner, name, accountId) {
  const repository = repositoryByOwnerAndName(state, owner, name);
  if (!repository) return { status: "not-found" };
  if (!canReadRepository(state, repository, accountId)) return { status: "denied" };
  return { status: "ok", repository };
}

/**
 * The repository identity every Code read returns. `viewerRole` is the
 * effective role of the reader (null for a visitor without access), so the
 * pages can offer Write-level actions only where the server would accept them.
 */
export function publicRepositoryPayload(state, repository, accountId = null) {
  return {
    owner: ownerNameOf(state, repository),
    name: repository.name,
    description: repository.description ?? "",
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch ?? null,
    viewerRole: effectiveRepositoryRole(state, repository, accountId),
    // Present only for a fork: the frontend renders the source link from it.
    source: sourceRepositorySummary(state, repository),
  };
}

export function branchNamesOf(state, repository) {
  return branchesOf(state, repository.id)
    .map((branch) => branch.name)
    .sort((left, right) => left.localeCompare(right));
}

/** The most recent commit of a chain that changed one path, or null. */
export function lastCommitTouching(commits, filePath) {
  return commitsTouchingPath(commits, filePath)[0] ?? null;
}

/**
 * The commits of a linear chain (newest first) that really changed one path:
 * a commit counts when the file content differs from its parent revision, so a
 * commit that merely carries the file along is left out. The walk stops at the
 * first revision without the file, because from there on the path does not
 * exist on that branch.
 */
export function commitsTouchingPath(commits, filePath) {
  const changing = [];
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    const parent = commits[index + 1] ?? null;
    const file = fileInCommit(commit, filePath);
    if (!file) break;
    const parentFile = fileInCommit(parent, filePath);
    if (!parentFile || parentFile.content !== file.content) changing.push(commit);
  }
  return changing;
}

export function createRepositoryCodeService(store) {
  function resolveRepository(state, owner, name, accountId) {
    return resolveRepositoryForViewer(state, owner, name, accountId);
  }

  async function treeForViewer(owner, repositoryName, options, accountId) {
    const state = await store.read();
    const resolved = resolveRepository(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;

    const branch = branchByName(
      state,
      repository.id,
      options?.branch ?? repository.defaultBranch,
    );
    if (!branch) return { status: "branch-not-found" };

    const directoryPath = normalizePath(options?.path ?? "");
    if (directoryPath === null) return { status: "not-found" };

    // A repository created without initialization still has its default
    // branch, but no commit yet: the code root stays browsable and empty.
    const commit = commitById(state, branch.commitId);
    if (directoryPath.length > 0) {
      const directoryExists = filesOfCommit(commit).some((file) =>
        String(file?.path ?? "").startsWith(`${directoryPath}/`),
      );
      if (!directoryExists) return { status: "not-found" };
    }

    return {
      status: "ok",
      tree: {
        repository: publicRepositoryPayload(state, repository, accountId),
        branch: branch.name,
        path: directoryPath,
        branches: branchNamesOf(state, repository),
        commitCount: branchCommitChain(state, branch).length,
        entries: entriesInDirectory(commit, directoryPath),
      },
    };
  }

  async function blobForViewer(owner, repositoryName, options, accountId) {
    const state = await store.read();
    const resolved = resolveRepository(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;

    const branch = branchByName(
      state,
      repository.id,
      options?.branch ?? repository.defaultBranch,
    );
    if (!branch) return { status: "branch-not-found" };

    const filePath = normalizePath(options?.path ?? "");
    if (filePath === null || filePath.length === 0) return { status: "file-not-found" };

    const history = branchCommitChain(state, branch);
    const commit = lastCommitTouching(history, filePath);
    if (!commit) return { status: "file-not-found" };

    const file = fileInCommit(commit, filePath);
    return {
      status: "ok",
      blob: {
        repository: publicRepositoryPayload(state, repository, accountId),
        branch: branch.name,
        branches: branchNamesOf(state, repository),
        path: file.path,
        content: typeof file.content === "string" ? file.content : "",
        commitCount: commitsTouchingPath(history, filePath).length,
        // The most recent commit that changed this path on this branch.
        commit: {
          id: commit.id,
          sha: commit.sha,
          shortSha: shortSha(commit.sha),
          message: commit.message,
          author: authorNameOf(state, commit),
          createdAt: commit.createdAt,
        },
      },
    };
  }

  return { treeForViewer, blobForViewer };
}
