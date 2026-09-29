import { randomUUID } from "node:crypto";

import {
  DEFAULT_BRANCH,
  INITIAL_COMMIT_MESSAGE,
  README_FILE,
  initialReadmeContent,
} from "../domain/repositories.mjs";

/**
 * Read/write helpers over the `repository-content` store: the branches, commits
 * and files of every repository (REQ-3-2-1 initialization, REQ-3-3 file list).
 * A file is content at a path on a branch; directories are only the path
 * hierarchy of the stored files, so they are derived here and never stored.
 */

function normalizePath(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

/** Files of one repository on one branch, ordered by path. */
export function filesOf(content, repositoryId, branch) {
  return content.files
    .filter((file) => file.repositoryId === repositoryId && file.branch === branch)
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function findFile(content, repositoryId, branch, path) {
  const wanted = normalizePath(path);
  return (
    content.files.find(
      (file) => file.repositoryId === repositoryId && file.branch === branch && file.path === wanted,
    ) ?? null
  );
}

export function branchOf(content, repositoryId, name) {
  return (
    content.branches.find(
      (branch) => branch.repositoryId === repositoryId && branch.name === name,
    ) ?? null
  );
}

/** Commits of one repository, newest first, optionally limited to one branch. */
export function commitsOf(content, repositoryId, branch = null) {
  return content.commits
    .filter((commit) => commit.repositoryId === repositoryId && (!branch || commit.branch === branch))
    .slice()
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

/**
 * Entries directly inside `path` on a branch: the files stored at that exact path
 * and one synthesized directory per deeper path segment. `path` is `""` for the
 * branch root.
 */
export function entriesAtPath(content, repositoryId, branch, path = "") {
  const base = normalizePath(path);
  const prefix = base ? `${base}/` : "";
  const entries = new Map();
  for (const file of filesOf(content, repositoryId, branch)) {
    if (prefix && !file.path.startsWith(prefix)) continue;
    if (!prefix && !file.path) continue;
    const remainder = file.path.slice(prefix.length);
    if (!remainder) continue;
    const [segment, ...rest] = remainder.split("/");
    const entryPath = `${prefix}${segment}`;
    const type = rest.length > 0 ? "directory" : "file";
    const existing = entries.get(entryPath);
    // A directory wins over a same-named file so the tree stays browsable.
    if (!existing || (existing.type === "file" && type === "directory")) {
      entries.set(entryPath, { name: segment, path: entryPath, type });
    }
  }
  return [...entries.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/**
 * The branch, commit and README file written atomically with a new repository
 * when the creation form requests an initial commit (REQ-3-2-1).
 */
export function buildInitialization({ repository, authorId, authorName, description = "", now }) {
  const branchId = `branch-${randomUUID()}`;
  const commitId = `commit-${randomUUID()}`;
  const fileId = `file-${randomUUID()}`;
  return {
    branch: {
      id: branchId,
      repositoryId: repository.id,
      name: repository.defaultBranch || DEFAULT_BRANCH,
      commitId,
      createdAt: now,
    },
    commit: {
      id: commitId,
      repositoryId: repository.id,
      branch: repository.defaultBranch || DEFAULT_BRANCH,
      message: INITIAL_COMMIT_MESSAGE,
      authorId,
      authorName,
      createdAt: now,
      parentId: null,
      changedPaths: [README_FILE],
    },
    file: {
      id: fileId,
      repositoryId: repository.id,
      branch: repository.defaultBranch || DEFAULT_BRANCH,
      path: README_FILE,
      content: initialReadmeContent(repository.name, description),
      updatedAt: now,
    },
  };
}

/** Removes every branch, commit and file of a repository (creation rollback). */
export function removeRepositoryContent(content, repositoryId) {
  return {
    branches: content.branches.filter((branch) => branch.repositoryId !== repositoryId),
    commits: content.commits.filter((commit) => commit.repositoryId !== repositoryId),
    files: content.files.filter((file) => file.repositoryId !== repositoryId),
  };
}
