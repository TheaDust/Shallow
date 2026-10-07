// Pure read helpers over the persisted repository state: branches, the commit
// chain of one branch, the directory tree, one stored file, a commit compared
// with its parent revision and the code search.
//
// A branch is a named reference pointing at a commit; the head commit holds the
// full file snapshot of that branch, so the tree, the file view and the code
// search of a branch all derive from the same stored revision. Commits are
// append-only, which is why browsing, history and diffs can never rewrite
// stored content.
//
// Every function here takes the already-read state, so the store facade in
// `org-store.mjs` stays a thin persistence layer and the routes can never read
// a branch, a file or a commit outside the repository's read rule.

import { diffFileSnapshots } from "./text-diff.mjs";

export const DEFAULT_BRANCH_NAME = "main";

const README_PATTERN = /^readme(?:\.[a-z0-9]+)?$/i;

export function publicCommit(commit) {
  return {
    id: commit.id,
    message: commit.message,
    authorName: commit.authorName,
    createdAt: commit.createdAt,
    parentCommitId: commit.parentCommitId ?? null,
  };
}

/** Newest first; two commits written in the same millisecond keep their order. */
function byRecency(left, right) {
  const difference = Date.parse(right.commit.createdAt) - Date.parse(left.commit.createdAt);
  return difference !== 0 ? difference : right.index - left.index;
}

export function defaultBranchName(repository) {
  return repository?.defaultBranch || DEFAULT_BRANCH_NAME;
}

export function findBranch(state, repositoryId, name) {
  return (
    state.branches.find((entry) => entry.repositoryId === repositoryId && entry.name === name) ?? null
  );
}

/** Branch names of one repository in creation order. */
export function listBranchRecords(state, repositoryId) {
  return state.branches
    .filter((entry) => entry.repositoryId === repositoryId)
    .map((entry) => ({
      name: entry.name,
      headCommitId: entry.headCommitId ?? null,
      createdAt: entry.createdAt ?? null,
    }));
}

function findCommit(state, commitId) {
  if (!commitId) return null;
  return state.commits.find((entry) => entry.id === commitId) ?? null;
}

/** The head commit of one branch, or null when the branch has no revision. */
export function headCommitOfBranch(state, repositoryId, branchName) {
  const branch = findBranch(state, repositoryId, branchName);
  return findCommit(state, branch?.headCommitId);
}

/** The file list of one branch's head commit, or null when it has none. */
export function branchHeadFiles(state, repositoryId, branchName) {
  return headCommitOfBranch(state, repositoryId, branchName)?.files ?? null;
}

/**
 * Flattens a file snapshot into the entries of one directory level. A path is
 * a real directory only because some stored file lives below it, so the tree
 * and the file list can never disagree about the branch content.
 */
export function treeEntries(files, path) {
  const prefix = path ? `${path}/` : "";
  const entries = new Map();
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      entries.set(rest, { name: rest, path: file.path, type: "file" });
      continue;
    }
    const directory = rest.slice(0, slash);
    entries.set(directory, { name: directory, path: `${prefix}${directory}`, type: "directory" });
  }
  return [...entries.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/** Content of one file in a revision, or undefined when the revision lacks it. */
function contentAt(commit, path) {
  return commit?.files?.find((file) => file.path === path)?.content;
}

/**
 * Whether one revision introduced, removed or changed the file at `path`
 * compared with its parent revision. Used by the file-scoped history filter, so
 * it only compares the single file instead of the whole snapshot.
 */
function commitTouchesPath(state, commit, path) {
  return contentAt(commit, path) !== contentAt(findCommit(state, commit.parentCommitId), path);
}

/**
 * Commit chain of one branch: the head commit followed by its ancestors. The
 * chain is walked through the stored parent links, so a branch created from
 * another branch keeps that branch's history.
 */
function branchChain(state, repositoryId, branchName) {
  const ordered = [];
  const seen = new Set();
  let cursor = headCommitOfBranch(state, repositoryId, branchName);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    ordered.push(cursor);
    cursor = findCommit(state, cursor.parentCommitId);
  }
  return ordered;
}

/** Directory listing of one branch. `path` is "" for the root. */
export function listRepositoryTree(state, repository, { branch = "", path = "" } = {}) {
  const branchName = branch || defaultBranchName(repository);
  const files = branchHeadFiles(state, repository.id, branchName);
  if (!files) return null;
  return { branch: branchName, defaultBranch: defaultBranchName(repository), path, entries: treeEntries(files, path) };
}

/** One stored file of one branch, or null when the branch or file is missing. */
export function getRepositoryFile(state, repository, { branch = "", path = "" } = {}) {
  const branchName = branch || defaultBranchName(repository);
  const files = branchHeadFiles(state, repository.id, branchName);
  const file = files?.find((entry) => entry.path === path);
  if (!file) return null;
  return {
    branch: branchName,
    defaultBranch: defaultBranchName(repository),
    path: file.path,
    name: file.path.split("/").at(-1),
    content: file.content,
  };
}

/**
 * Commit history of one branch, newest first. An optional `path` narrows the
 * same history to the commits that changed that file, which is what the file
 * page's history link asks for.
 */
export function listRepositoryCommits(state, repository, { branch = "", path = "" } = {}) {
  const branchName = branch || defaultBranchName(repository);
  const ordered = branchChain(state, repository.id, branchName)
    .map((commit, index) => ({ commit, index }))
    .sort(byRecency);
  const wanted = typeof path === "string" ? path : "";
  return ordered
    .filter(({ commit }) => !wanted || commitTouchesPath(state, commit, wanted))
    .map(({ commit }) => publicCommit(commit));
}

/**
 * One commit with the file differences against its parent revision. The
 * comparison is derived from the stored snapshots, so opening it never writes
 * to the repository.
 */
export function getRepositoryCommit(state, repository, commitId) {
  const commit = state.commits.find(
    (entry) => entry.id === commitId && entry.repositoryId === repository.id,
  );
  if (!commit) return null;
  const parent = findCommit(state, commit.parentCommitId);
  const difference = diffFileSnapshots(parent?.files ?? [], commit.files ?? []);
  return {
    branch: commit.branch ?? defaultBranchName(repository),
    defaultBranch: defaultBranchName(repository),
    commit: publicCommit(commit),
    base: parent ? publicCommit(parent) : null,
    changes: difference.files,
    totals: difference.totals,
  };
}

/**
 * Keyword search inside the readable file content of one branch. Only content
 * is searched, so a file name can never produce a match; the result carries the
 * matching lines of every matching file.
 */
export function searchRepositoryCode(state, repository, { branch = "", query = "" } = {}) {
  const branchName = branch || defaultBranchName(repository);
  const needle = String(query ?? "").trim().toLowerCase();
  const matches = [];
  if (needle) {
    for (const file of branchHeadFiles(state, repository.id, branchName) ?? []) {
      const lines = String(file.content ?? "").split("\n");
      const found = [];
      for (let index = 0; index < lines.length && found.length < 3; index += 1) {
        if (lines[index].toLowerCase().includes(needle)) {
          found.push({ number: index + 1, text: lines[index] });
        }
      }
      if (found.length > 0) {
        matches.push({ path: file.path, name: file.path.split("/").at(-1), lines: found });
      }
    }
    matches.sort((left, right) => left.path.localeCompare(right.path));
  }
  return { branch: branchName, defaultBranch: defaultBranchName(repository), matches };
}

/** Root README of a branch, or null when that branch has none. */
export function getRepositoryReadmePath(state, repository, { branch = "" } = {}) {
  const branchName = branch || defaultBranchName(repository);
  const files = branchHeadFiles(state, repository.id, branchName) ?? [];
  const readme = files.find((file) => !file.path.includes("/") && README_PATTERN.test(file.path));
  return readme ? readme.path : null;
}
