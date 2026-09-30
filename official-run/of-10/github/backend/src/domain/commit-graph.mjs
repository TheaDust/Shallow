/**
 * Commit graph of one repository (REQ-4).
 *
 * A branch is a named reference pointing to a commit; a commit stores its
 * parent, author, message, time and the files it changed. The files of a branch
 * or of any revision are derived from that history, so the file listing, a file
 * read, the commit history and a comparison always describe the same revisions
 * instead of separate caches.
 */

import { diffLines, diffStats } from "./line-diff.mjs";

export const SHORT_COMMIT_LENGTH = 7;

export function shortCommitId(id) {
  return String(id ?? "").slice(0, SHORT_COMMIT_LENGTH);
}

export function parentShortId(repository, commit) {
  return commit?.parentId ? shortCommitId(commit.parentId) : null;
}

/** A commit addressed by its full identifier or by a unique short identifier. */
export function findCommit(repository, commitId) {
  const wanted = String(commitId ?? "").trim();
  if (!wanted) return null;
  const commits = repository?.commits ?? [];
  const exact = commits.find((commit) => commit.id === wanted);
  if (exact) return exact;
  const matches = commits.filter((commit) => commit.id.startsWith(wanted));
  return matches.length === 1 ? matches[0] : null;
}

export function branchHead(repository, branch) {
  const reference = (repository?.branches ?? []).find((candidate) => candidate.name === branch);
  if (!reference?.headCommitId) return null;
  return findCommit(repository, reference.headCommitId);
}

/** The commit itself followed by its ancestors, newest first. */
export function commitAncestors(repository, commitId) {
  const order = [];
  const seen = new Set();
  let current = findCommit(repository, commitId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    order.push(current);
    current = current.parentId ? findCommit(repository, current.parentId) : null;
  }
  return order;
}

export function normalizePath(path) {
  return String(path ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/** Content of one path at one revision, or null when it did not exist there. */
export function fileContentAt(repository, commitId, path) {
  const wanted = normalizePath(path);
  if (!wanted) return null;
  for (const commit of commitAncestors(repository, commitId)) {
    const change = (commit.changes ?? []).find((candidate) => candidate.path === wanted);
    if (change) return change.changeType === "deleted" ? null : String(change.content ?? "");
  }
  return null;
}

/** The commit that last wrote one path at or below a revision. */
export function lastCommitForPath(repository, commitId, path) {
  const wanted = normalizePath(path);
  if (!wanted) return null;
  return (
    commitAncestors(repository, commitId).find((commit) =>
      (commit.changes ?? []).some((change) => change.path === wanted),
    ) ?? null
  );
}

/** Every file that exists at a revision, with its content and writing commit. */
export function revisionFiles(repository, commitId) {
  if (!commitId) return [];
  const paths = new Set();
  for (const commit of commitAncestors(repository, commitId)) {
    for (const change of commit.changes ?? []) paths.add(change.path);
  }
  const files = [];
  for (const path of [...paths].sort()) {
    const content = fileContentAt(repository, commitId, path);
    if (content === null) continue;
    const commit = lastCommitForPath(repository, commitId, path);
    files.push({ path, content, commitId: commit ? commit.id : null });
  }
  return files;
}

function compareEntries(left, right) {
  if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
  return left.name.localeCompare(right.name);
}

export function branchExists(repository, branch) {
  return (repository?.branches ?? []).some((candidate) => candidate.name === branch);
}

/**
 * Entries directly inside one directory of a branch. `path` is the directory
 * path without a trailing slash ("" is the branch root); `null` means the
 * branch itself is unknown, while a branch without commits is empty.
 */
export function listEntries(repository, branch, path = "") {
  if (!branchExists(repository, branch)) return null;
  const head = branchHead(repository, branch);
  if (!head) return [];
  const directory = normalizePath(path);
  const prefix = directory ? `${directory}/` : "";
  const entries = new Map();
  for (const file of revisionFiles(repository, head.id)) {
    if (!file.path.startsWith(prefix)) continue;
    const remainder = file.path.slice(prefix.length);
    if (!remainder) continue;
    const name = remainder.split("/")[0];
    const type = remainder.includes("/") ? "dir" : "file";
    const existing = entries.get(name);
    if (!existing || type === "dir") {
      entries.set(name, { type, name, path: `${prefix}${name}` });
    }
  }
  return [...entries.values()].sort(compareEntries);
}

/** Every file path that exists at the head of one branch. */
export function branchPaths(repository, branch) {
  const head = branchHead(repository, branch);
  if (!head) return [];
  return revisionFiles(repository, head.id).map((file) => file.path);
}

/** Directory view of one branch, or null when the path is not a directory. */
export function directoryAt(repository, branch, path = "") {
  const directory = normalizePath(path);
  const entries = listEntries(repository, branch, directory);
  if (!entries) return null;
  if (directory) {
    const parentSlash = directory.lastIndexOf("/");
    const parentPath = parentSlash === -1 ? "" : directory.slice(0, parentSlash);
    const parentEntries = listEntries(repository, branch, parentPath) ?? [];
    if (!parentEntries.some((entry) => entry.type === "dir" && entry.path === directory)) return null;
  }
  return { path: directory, entries };
}

export function fileAt(repository, branch, path) {
  const head = branchHead(repository, branch);
  if (!head) return null;
  const wanted = normalizePath(path);
  if (!wanted) return null;
  const content = fileContentAt(repository, head.id, wanted);
  if (content === null) return null;
  return {
    path: wanted,
    content,
    commit: lastCommitForPath(repository, head.id, wanted),
  };
}

export function toCommitRecord(repository, commit) {
  const changes = commit.changes ?? [];
  return {
    id: commit.id,
    shortId: shortCommitId(commit.id),
    message: commit.message ?? "",
    author: commit.authorLogin ?? "",
    createdAt: commit.createdAt ?? "",
    parentId: commit.parentId ?? null,
    parentShortId: parentShortId(repository, commit),
    // A merge commit carries the compare commit as its second parent (REQ-6-5),
    // next to the target-branch head it was written on top of.
    secondParentId: commit.secondParentId ?? null,
    secondParentShortId: commit.secondParentId ? shortCommitId(commit.secondParentId) : null,
    changedFiles: changes.map((change) => change.path),
  };
}

/**
 * History of one branch, newest first; with a `path` only the commits that
 * changed that file remain (REQ-4-2-1).
 */
export function listCommits(repository, branch, path = "") {
  const head = branchHead(repository, branch);
  if (!head) return [];
  const wanted = normalizePath(path);
  return commitAncestors(repository, head.id)
    .filter(
      (commit) => !wanted || (commit.changes ?? []).some((change) => change.path === wanted),
    )
    .map((commit) => toCommitRecord(repository, commit));
}

/** Resolves a revision reference: a branch name, a full or a short commit id. */
export function resolveRevision(repository, reference) {
  const wanted = String(reference ?? "").trim();
  if (!wanted) return null;
  const branch = (repository?.branches ?? []).find((candidate) => candidate.name === wanted);
  if (branch) {
    const head = branchHead(repository, branch.name);
    return head ? { kind: "branch", ref: branch.name, commit: head } : null;
  }
  const commit = findCommit(repository, wanted);
  return commit ? { kind: "commit", ref: commit.id, commit } : null;
}

/** Identifier, short identifier and reference kind of a resolved revision. */
export function revisionDescriptor(revision) {
  return {
    id: revision.commit.id,
    shortId: shortCommitId(revision.commit.id),
    ref: revision.ref,
    kind: revision.kind,
  };
}

/**
 * Changed files and line-by-line additions/deletions between two revisions.
 * Unchanged files are left out (REQ-4-2-2).
 */
export function compareRevisions(repository, baseCommitId, compareCommitId) {
  const baseFiles = new Map(
    revisionFiles(repository, baseCommitId).map((file) => [file.path, file.content]),
  );
  const compareFiles = new Map(
    revisionFiles(repository, compareCommitId).map((file) => [file.path, file.content]),
  );
  const paths = [...new Set([...baseFiles.keys(), ...compareFiles.keys()])].sort();

  const changedFiles = [];
  let additions = 0;
  let deletions = 0;
  for (const path of paths) {
    const before = baseFiles.has(path) ? baseFiles.get(path) : null;
    const after = compareFiles.has(path) ? compareFiles.get(path) : null;
    if (before === after) continue;
    const diff = diffLines(before ?? "", after ?? "");
    const stats = diffStats(diff);
    additions += stats.additions;
    deletions += stats.deletions;
    changedFiles.push({
      path,
      name: path.split("/").pop(),
      changeType: before === null ? "added" : after === null ? "deleted" : "modified",
      additions: stats.additions,
      deletions: stats.deletions,
      diff,
    });
  }

  return {
    changedFiles,
    filesChanged: changedFiles.length,
    additions,
    deletions,
  };
}

/**
 * Diff of one revision against its parent, or the parent-less diff of a root
 * commit (every file counts as added).
 */
export function commitDiff(repository, commit) {
  const comparison = compareRevisions(repository, commit.parentId ?? null, commit.id);
  return {
    ...comparison,
    base: commit.parentId
      ? { id: commit.parentId, shortId: shortCommitId(commit.parentId), ref: commit.parentId, kind: "commit" }
      : { id: null, shortId: null, ref: "root", kind: "root" },
    compare: {
      id: commit.id,
      shortId: shortCommitId(commit.id),
      ref: commit.id,
      kind: "commit",
    },
  };
}