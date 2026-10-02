/**
 * Read-only comparison of commits and revisions (REQ-4-2-2).
 *
 * A commit is compared against the revision it was created from (its parent
 * commit, or an empty tree for the first commit of a branch) and two revisions
 * can be compared directly. The comparison only reads the immutable snapshots a
 * revision points to: it never creates a commit, a branch, a file or a review.
 *
 * `base` is the earlier (or explicitly requested) revision and `compare` the
 * newer one; a file that has the same content in both revisions is not a
 * changed file.
 */

import {
  commitSnapshot,
  commitSummary,
  findRepositoryBranch,
  findRepositoryCommit,
} from "./repository-branches.mjs";

/** Above this many lines the line diff falls back to a plain block change. */
const MAX_DIFF_CELLS = 400000;

function text(value) {
  return typeof value === "string" ? value : "";
}

/** The lines of a file value; a trailing newline does not add an empty line. */
export function splitLines(value) {
  const content = text(value);
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lcsOps(baseLines, compareLines) {
  const baseCount = baseLines.length;
  const compareCount = compareLines.length;
  if (baseCount === 0) return compareLines.map((line) => ({ type: "added", text: line }));
  if (compareCount === 0) return baseLines.map((line) => ({ type: "removed", text: line }));
  if (baseCount * compareCount > MAX_DIFF_CELLS) {
    return [
      ...baseLines.map((line) => ({ type: "removed", text: line })),
      ...compareLines.map((line) => ({ type: "added", text: line })),
    ];
  }
  const table = [];
  for (let row = 0; row <= baseCount; row += 1) table.push(new Array(compareCount + 1).fill(0));
  for (let row = 1; row <= baseCount; row += 1) {
    for (let column = 1; column <= compareCount; column += 1) {
      table[row][column] = baseLines[row - 1] === compareLines[column - 1]
        ? table[row - 1][column - 1] + 1
        : Math.max(table[row - 1][column], table[row][column - 1]);
    }
  }
  const ops = [];
  let row = baseCount;
  let column = compareCount;
  while (row > 0 && column > 0) {
    if (baseLines[row - 1] === compareLines[column - 1]) {
      ops.push({ type: "context", text: baseLines[row - 1] });
      row -= 1;
      column -= 1;
    } else if (table[row - 1][column] >= table[row][column - 1]) {
      ops.push({ type: "removed", text: baseLines[row - 1] });
      row -= 1;
    } else {
      ops.push({ type: "added", text: compareLines[column - 1] });
      column -= 1;
    }
  }
  while (row > 0) {
    ops.push({ type: "removed", text: baseLines[row - 1] });
    row -= 1;
  }
  while (column > 0) {
    ops.push({ type: "added", text: compareLines[column - 1] });
    column -= 1;
  }
  return ops.reverse();
}

/** The line-by-line comparison of two file values with its counts. */
export function lineDiff(baseContent, compareContent) {
  const baseLines = splitLines(baseContent);
  const compareLines = splitLines(compareContent);
  let start = 0;
  while (start < baseLines.length && start < compareLines.length && baseLines[start] === compareLines[start]) {
    start += 1;
  }
  let endBase = baseLines.length;
  let endCompare = compareLines.length;
  while (endBase > start && endCompare > start && baseLines[endBase - 1] === compareLines[endCompare - 1]) {
    endBase -= 1;
    endCompare -= 1;
  }
  const lines = [];
  for (let index = 0; index < start; index += 1) lines.push({ type: "context", text: baseLines[index] });
  lines.push(...lcsOps(baseLines.slice(start, endBase), compareLines.slice(start, endCompare)));
  for (let index = endBase; index < baseLines.length; index += 1) {
    lines.push({ type: "context", text: baseLines[index] });
  }
  const additions = lines.filter((line) => line.type === "added").length;
  const deletions = lines.filter((line) => line.type === "removed").length;
  return { lines, additions, deletions };
}

/**
 * The changed files between two snapshots: a path only appears when its content
 * differs, so an unchanged file never shows up in a comparison.
 */
export function revisionChanges(baseTree, compareTree) {
  const base = Array.isArray(baseTree) ? baseTree : [];
  const compare = Array.isArray(compareTree) ? compareTree : [];
  const paths = [...new Set([...base.map((file) => file.path), ...compare.map((file) => file.path)])].sort();
  const files = [];
  for (const path of paths) {
    const before = base.find((file) => file.path === path);
    const after = compare.find((file) => file.path === path);
    const baseContent = before ? text(before.content) : null;
    const compareContent = after ? text(after.content) : null;
    if (baseContent === compareContent) continue;
    const diff = lineDiff(baseContent ?? "", compareContent ?? "");
    files.push({
      path,
      change: baseContent === null ? "added" : compareContent === null ? "removed" : "modified",
      additions: diff.additions,
      deletions: diff.deletions,
      lines: diff.lines,
    });
  }
  return files;
}

/** The totals a comparison page spells next to its file list. */
export function diffSummary(files) {
  return {
    filesChanged: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

/**
 * Resolves a revision by identifier: a stored commit id, or a branch name for
 * the commit that branch points to.
 */
export function resolveRevision(repository, ref, fallbackBranch = null) {
  const wanted = text(ref).trim();
  const commit = wanted ? findRepositoryCommit(repository, wanted) : null;
  if (commit) {
    return {
      ref: wanted,
      type: "commit",
      branch: commit.branch ?? fallbackBranch ?? repository?.defaultBranch ?? null,
      commit,
      tree: commitSnapshot(commit),
    };
  }
  const branch = wanted ? findRepositoryBranch(repository, wanted) : null;
  if (branch) {
    const head = findRepositoryCommit(repository, branch.headId);
    if (!head) return null;
    return { ref: branch.name, type: "branch", branch: branch.name, commit: head, tree: commitSnapshot(head) };
  }
  return null;
}

/** The comparison of a commit against its parent (REQ-4-2-2). */
export function commitComparison(repository, commit) {
  const parent = commit?.parentId ? findRepositoryCommit(repository, commit.parentId) : null;
  const base = {
    ref: parent ? parent.id : null,
    commit: parent,
    tree: parent ? commitSnapshot(parent) : [],
  };
  const compare = { ref: commit.id, commit, tree: commitSnapshot(commit) };
  const files = revisionChanges(base.tree, compare.tree);
  return {
    base: base.commit
      ? { ref: base.commit.id, type: "commit", branch: base.commit.branch ?? null, commit: base.commit }
      : { ref: null, type: "empty", branch: null, commit: null },
    compare: { ref: compare.commit.id, type: "commit", branch: compare.commit.branch ?? null, commit: compare.commit },
    files,
    summary: diffSummary(files),
  };
}

/**
 * The commits the compare revision carries that the base revision does not
 * reach: the comparable commits of a revision comparison (REQ-4-2-2). The list
 * is empty when both revisions point at the same commit.
 */
export function comparableCommits(repository, baseCommit, compareCommit) {
  const reached = new Set();
  let cursor = baseCommit;
  while (cursor && !reached.has(cursor.id)) {
    reached.add(cursor.id);
    cursor = cursor.parentId ? findRepositoryCommit(repository, cursor.parentId) : null;
  }
  const commits = [];
  const seen = new Set();
  cursor = compareCommit;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (!reached.has(cursor.id)) commits.push(commitSummary(cursor));
    cursor = cursor.parentId ? findRepositoryCommit(repository, cursor.parentId) : null;
  }
  return commits;
}

/**
 * The comparison of two arbitrary revisions. Both must resolve to a readable
 * commit of the repository, otherwise no diff content is produced.
 */
export function revisionComparison(repository, baseRef, compareRef) {
  const base = resolveRevision(repository, baseRef);
  const compare = resolveRevision(repository, compareRef);
  if (!base || !compare) return null;
  const files = revisionChanges(base.tree, compare.tree);
  return {
    base: { ref: base.ref, type: base.type, branch: base.branch, commit: base.commit },
    compare: { ref: compare.ref, type: compare.type, branch: compare.branch, commit: compare.commit },
    files,
    summary: diffSummary(files),
    commits: comparableCommits(repository, base.commit, compare.commit),
  };
}
