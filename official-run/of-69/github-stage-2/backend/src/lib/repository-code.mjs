// Code browsing, commit history, diff and code search over the repository
// records of the single organization aggregate store. Every helper reads one
// state snapshot, so a branch, its files, its commits and the diffs they
// describe always come from the same version relationship.

import { randomUUID } from "node:crypto";

import { repositoryFiles } from "./organizations.mjs";

/** The changed files a commit records; a commit without them changed nothing. */
export function commitChanges(commit) {
  return Array.isArray(commit?.changes) ? commit.changes : [];
}

/** The branch names of one repository, alphabetically; the default when unrecorded. */
export function branchNames(state, repository) {
  if (!repository) return [];
  const names = [
    ...new Set(
      (state.branches ?? [])
        .filter((branch) => branch.repositoryId === repository.id)
        .map((branch) => branch.name),
    ),
  ];
  if (names.length === 0 && repository.defaultBranch) names.push(repository.defaultBranch);
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * The branch a request reads: the requested name when that branch exists,
 * otherwise the repository's default branch. Reading never creates a branch.
 */
export function resolveBranchName(state, repository, requested) {
  if (!repository) return null;
  const names = branchNames(state, repository);
  const key = typeof requested === "string" ? requested.trim() : "";
  if (key && names.includes(key)) return key;
  return repository.defaultBranch ?? names[0] ?? null;
}

/** The files of one branch as `{ path, content }`, sorted by path. */
export function branchFileList(state, repository, branch) {
  return repositoryFiles(state, repository, branch).map((file) => ({
    path: file.path,
    content: file.content ?? "",
  }));
}

/**
 * Direct children of `path` on one branch: directories first, then files, each
 * alphabetical. A directory is only a path prefix of the stored files and is
 * never a record of its own.
 */
export function directoryEntries(files, path) {
  const prefix = typeof path === "string" && path.length > 0 ? `${path}/` : "";
  const directories = new Set();
  const entries = [];
  for (const file of files) {
    if (prefix && !file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) entries.push({ type: "file", name: rest, path: `${prefix}${rest}` });
    else directories.add(rest.slice(0, slash));
  }
  return [
    ...[...directories]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ type: "directory", name, path: `${prefix}${name}` })),
    ...entries.sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

function splitLines(value) {
  if (value === null || value === undefined) return [];
  const text = String(value).replace(/\n$/, "");
  return text.length === 0 ? [] : text.split("\n");
}

/**
 * A line-by-line comparison of one file between its parent revision (`previous`)
 * and this revision (`content`), where the base is the earlier revision. The
 * additions and deletions are counted from the same comparison, so the numbers
 * a page shows always match the lines it renders.
 */
export function computeLineDiff(previous, content) {
  const before = splitLines(previous);
  const after = splitLines(content);
  const lines = [];
  if (before.length * after.length > 250_000) {
    for (const text of before) lines.push({ type: "deletion", text });
    for (const text of after) lines.push({ type: "addition", text });
  } else {
    const table = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0));
    for (let i = before.length - 1; i >= 0; i -= 1) {
      for (let j = after.length - 1; j >= 0; j -= 1) {
        table[i][j] =
          before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < before.length && j < after.length) {
      if (before[i] === after[j]) {
        lines.push({ type: "context", text: before[i] });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        lines.push({ type: "deletion", text: before[i] });
        i += 1;
      } else {
        lines.push({ type: "addition", text: after[j] });
        j += 1;
      }
    }
    while (i < before.length) lines.push({ type: "deletion", text: before[i++] });
    while (j < after.length) lines.push({ type: "addition", text: after[j++] });
  }
  return {
    lines,
    additions: lines.filter((line) => line.type === "addition").length,
    deletions: lines.filter((line) => line.type === "deletion").length,
  };
}

function authorName(accounts, accountId) {
  return accounts.find((account) => account.id === accountId)?.username ?? "Unknown";
}

/** One commit as the history list describes it. */
export function publicCommit(commit, accounts) {
  return {
    id: commit.id,
    message: commit.message,
    author: authorName(accounts, commit.authorId),
    createdAt: commit.createdAt,
    parentId: commit.parentId ?? null,
    changedFiles: commitChanges(commit).map((change) => change.path),
  };
}

/**
 * The commits of one branch in reverse chronological order, optionally only the
 * commits that changed one file path.
 */
export async function commitHistory(database, repository, branch, filePath) {
  if (!repository || !branch) return [];
  const [{ commits }, { accounts }] = await Promise.all([
    database.organizationState.read(),
    database.accounts.read(),
  ]);
  const path = typeof filePath === "string" ? filePath.trim() : "";
  return (commits ?? [])
    .filter((commit) => commit.repositoryId === repository.id && commit.branch === branch)
    .filter((commit) => !path || commitChanges(commit).some((change) => change.path === path))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((commit) => publicCommit(commit, accounts));
}

/**
 * One commit and the difference it represents against its parent revision:
 * every changed file with its line-by-line comparison and the numeric
 * additions and deletions counted from it.
 */
export async function commitDetail(database, repository, commitId) {
  if (!repository) return null;
  const [{ commits }, { accounts }] = await Promise.all([
    database.organizationState.read(),
    database.accounts.read(),
  ]);
  const commit = (commits ?? []).find(
    (candidate) => candidate.id === commitId && candidate.repositoryId === repository.id,
  );
  if (!commit) return null;
  const parent = commit.parentId
    ? (commits ?? []).find((candidate) => candidate.id === commit.parentId) ?? null
    : null;
  const files = commitChanges(commit).map((change) => {
    const diff = computeLineDiff(change.previous ?? null, change.content ?? null);
    return { path: change.path, additions: diff.additions, deletions: diff.deletions, lines: diff.lines };
  });
  return {
    commit: {
      ...publicCommit(commit, accounts),
      parentAuthor: parent ? authorName(accounts, parent.authorId) : null,
      parentMessage: parent ? parent.message : null,
    },
    branch: commit.branch ?? repository.defaultBranch ?? null,
    totals: {
      files: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
    },
    files,
  };
}

/**
 * The files a code search may read: the files directly inside one directory of
 * the branch — the repository root's own files when `path` is empty. A search
 * never leaves the directory it was submitted from.
 */export function filesInDirectory(files, path) {
  const scope = typeof path === "string" ? path.trim().replace(/^\/+|\/+$/g, "") : "";
  if (!scope) return files.filter((file) => !file.path.includes("/"));
  const prefix = `${scope}/`;
  return files.filter((file) => file.path.startsWith(prefix));
}

/**
 * Code search over the readable file content of one branch. The query matches
 * case-insensitively inside file content only; file names and paths are not
 * searched and nothing is written.
 */
export function searchCode(files, rawQuery) {
  const query = typeof rawQuery === "string" ? rawQuery.trim().toLowerCase() : "";
  if (!query) return [];
  const results = [];
  for (const file of files) {
    const lines = String(file.content ?? "")
      .split("\n")
      .filter((line) => line.toLowerCase().includes(query));
    if (lines.length > 0) {
      results.push({ path: file.path, lines: lines.map((line) => line.trim()), matches: lines.length });
    }
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The newest commit of one branch, or null when the branch has none yet. A new
 * commit records it as its parent, so the branch head is a chain, not a field.
 */
export function branchHeadCommit(state, repository, branch) {
  if (!repository || !branch) return null;
  return (state.commits ?? [])
    .filter((commit) => commit.repositoryId === repository.id && commit.branch === branch)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .at(-1) ?? null;
}

/**
 * Whether a candidate new-file path may be created on a branch. A path is
 * invalid when it is empty, starts with `/`, holds an empty, `.` or `..`
 * segment, or clashes with an existing file or directory (a path that repeats
 * an existing file, sits inside an existing file, or already holds files).
 */
export function isValidNewFilePath(files, rawPath) {
  const path = typeof rawPath === "string" ? rawPath.trim() : "";
  if (path.length === 0) return false;
  if (path.startsWith("/")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  return !files.some(
    (file) =>
      file.path === path ||
      file.path.startsWith(`${path}/`) ||
      path.startsWith(`${file.path}/`),
  );
}

/**
 * Creates a new branch reference at the head of a base branch. The new branch
 * receives its own copy of the base revision's history and file snapshot, so it
 * can be browsed and committed to on its own; the base branch, its commits and
 * its files are never rewritten or removed.
 */
export function createBranchReference(state, repository, { name, baseBranch, createdAt }) {
  state.branches ??= [];
  state.commits ??= [];
  state.files ??= [];
  state.branches.push({
    id: `branch-${randomUUID()}`,
    repositoryId: repository.id,
    name,
    createdAt,
  });
  const idMap = new Map();
  const baseCommits = (state.commits ?? [])
    .filter((commit) => commit.repositoryId === repository.id && commit.branch === baseBranch)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const commit of baseCommits) {
    const copy = {
      ...commit,
      id: `commit-${randomUUID()}`,
      branch: name,
      parentId: commit.parentId ? (idMap.get(commit.parentId) ?? null) : null,
      changes: commitChanges(commit).map((change) => ({ ...change })),
    };
    idMap.set(commit.id, copy.id);
    state.commits.push(copy);
  }
  for (const file of (state.files ?? []).filter(
    (candidate) => candidate.repositoryId === repository.id && candidate.branch === baseBranch,
  )) {
    state.files.push({ ...file, id: `file-${randomUUID()}`, branch: name });
  }
  return state.branches.at(-1);
}

/**
 * Appends one commit that adds a file to a branch and advances that branch's
 * file snapshot. The commit records the path, the content, the message, the
 * author, the parent revision and the target branch; the previous revisions of
 * other files are untouched.
 */
export function addFileCommit(state, repository, { branch, path, content, message, authorId, createdAt }) {
  state.commits ??= [];
  state.files ??= [];
  const parent = branchHeadCommit(state, repository, branch);
  const commit = {
    id: `commit-${randomUUID()}`,
    repositoryId: repository.id,
    branch,
    message,
    authorId,
    createdAt,
    parentId: parent?.id ?? null,
    changes: [{ path, previous: null, content }],
  };
  state.commits.push(commit);
  state.files.push({
    id: `file-${randomUUID()}`,
    repositoryId: repository.id,
    branch,
    path,
    content,
  });
  return commit;
}
