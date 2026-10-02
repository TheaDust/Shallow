import { randomUUID } from "node:crypto";

import {
  MESSAGES,
  hasErrors,
  normalizeFilePath,
  validateBranchName,
  validateFileChange,
} from "./validation.mjs";

// The canonical storage form of a file path lives with the field rules.
export { normalizeFilePath };

/**
 * Branch, commit and file content of a repository. A branch is a named pointer
 * at one commit; commits are immutable records with a parent link; files are
 * content at a path inside one branch. The default branch of a repository is
 * stored on the repository (`defaultBranch`) and every read goes through it, so
 * the overview, the file pages and the fork copy always describe the same
 * version of the repository.
 */
export const DEFAULT_BRANCH_NAME = "main";
export const README_FILE_NAME = "README.md";
export const INITIAL_COMMIT_MESSAGE = "Initial commit";

/** Largest line matrix the line-by-line diff computes before falling back. */
const MAX_DIFF_CELLS = 250_000;

function nowIso() {
  return new Date().toISOString();
}

/** Lines of one stored content value; a single trailing newline is not a line. */
export function contentLines(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Line-by-line comparison of two stored file contents. `before` is the base
 * (earlier or parent) revision, `after` the compared one; the returned lines
 * carry the shared context plus the added and removed lines, together with the
 * numeric additions and deletions used by the comparison views.
 */
export function diffLines(before, after) {
  const base = contentLines(before);
  const compare = contentLines(after);
  if (base.length * compare.length > MAX_DIFF_CELLS) {
    return {
      lines: [
        ...base.map((text) => ({ type: "remove", text })),
        ...compare.map((text) => ({ type: "add", text })),
      ],
      additions: compare.length,
      deletions: base.length,
    };
  }

  // Longest common subsequence so unchanged lines stay shared context.
  const table = Array.from({ length: base.length + 1 }, () => new Uint32Array(compare.length + 1));
  for (let left = base.length - 1; left >= 0; left -= 1) {
    for (let right = compare.length - 1; right >= 0; right -= 1) {
      table[left][right] = base[left] === compare[right]
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }

  const lines = [];
  let additions = 0;
  let deletions = 0;
  let left = 0;
  let right = 0;
  while (left < base.length && right < compare.length) {
    if (base[left] === compare[right]) {
      lines.push({ type: "context", text: base[left] });
      left += 1;
      right += 1;
    } else if (table[left + 1][right] >= table[left][right + 1]) {
      lines.push({ type: "remove", text: base[left] });
      deletions += 1;
      left += 1;
    } else {
      lines.push({ type: "add", text: compare[right] });
      additions += 1;
      right += 1;
    }
  }
  while (left < base.length) {
    lines.push({ type: "remove", text: base[left] });
    deletions += 1;
    left += 1;
  }
  while (right < compare.length) {
    lines.push({ type: "add", text: compare[right] });
    additions += 1;
    right += 1;
  }
  return { lines, additions, deletions };
}

export function fileNameOf(path) {
  const segments = normalizeFilePath(path).split("/");
  return segments[segments.length - 1] ?? "";
}

export function defaultReadmeContent(repository) {
  return `# ${repository.name}\n`;
}

export function findBranch(state, repository, name) {
  const needle = typeof name === "string" ? name.trim() : "";
  return state.branches.find((branch) => (
    branch.repositoryId === repository.id && (needle.length === 0 || branch.name === needle)
  )) ?? null;
}

export function defaultBranchOf(state, repository) {
  return findBranch(state, repository, repository.defaultBranch ?? DEFAULT_BRANCH_NAME);
}

export function hasBranch(state, repository) {
  return state.branches.some((branch) => branch.repositoryId === repository.id);
}

/** Every branch record of one repository, in the order they were created. */
export function listRepositoryBranches(state, repository) {
  return state.branches.filter((branch) => branch.repositoryId === repository.id);
}

/**
 * Names of the branches a repository currently has, default branch first. The
 * list is read by the branch selector and the default-branch setting, so both
 * describe the same stored set.
 */
export function branchNames(state, repository) {
  const names = listRepositoryBranches(state, repository).map((branch) => branch.name);
  const stored = repository.defaultBranch ?? DEFAULT_BRANCH_NAME;
  const index = names.indexOf(stored);
  if (index > 0) {
    names.splice(index, 1);
    names.unshift(stored);
  }
  return names;
}

/**
 * Creates a named branch pointing at the head commit of a base branch. No
 * commit is written and no base history is rewritten: the new reference starts
 * a browsing snapshot equal to the base revision, which is materialized for the
 * new branch only.
 */
export function createBranch(state, repository, input = {}) {
  const { errors, values } = validateBranchName(input.branch ?? input.name);
  const baseName = typeof input.baseBranch === "string" && input.baseBranch.trim().length > 0
    ? input.baseBranch.trim()
    : (repository.defaultBranch ?? DEFAULT_BRANCH_NAME);
  const base = findBranch(state, repository, baseName);
  if (!base) return { errors: { ...errors, branch: MESSAGES.branchNotFound } };
  if (hasErrors(errors)) return { errors };
  if (findBranch(state, repository, values.branch)) {
    return { errors: { branch: MESSAGES.branchNameExists } };
  }

  const branch = {
    id: randomUUID(),
    repositoryId: repository.id,
    name: values.branch,
    headCommitId: base.headCommitId ?? null,
    createdAt: nowIso(),
  };
  state.branches.push(branch);
  for (const file of listBranchFiles(state, repository, base.name)) {
    state.repositoryFiles.push({
      id: randomUUID(),
      repositoryId: repository.id,
      branchId: branch.id,
      path: file.path,
      content: file.content,
      updatedAt: file.updatedAt,
    });
  }
  return { branch };
}

/**
 * Appends one immutable commit to a branch and refreshes the stored snapshot of
 * that branch. The parent is the previous head of the branch, so a branch
 * created from another revision only adds its own commits on top of the shared
 * history. Nothing of the base branch is touched.
 */
export function appendCommit(state, repository, branchName, input = {}) {
  const branch = findBranch(state, repository, branchName);
  if (!branch) return null;
  const committedAt = input.committedAt ?? nowIso();
  const snapshot = new Map(
    listBranchFiles(state, repository, branch.name).map((file) => [file.path, file.content]),
  );
  const changes = (input.changes ?? []).map((change) => {
    const path = normalizeFilePath(change.path);
    const before = snapshot.has(path) ? snapshot.get(path) : null;
    const after = typeof change.content === "string" ? change.content : null;
    if (after === null) snapshot.delete(path);
    else snapshot.set(path, after);
    const { additions, deletions } = diffLines(before, after);
    return { path, before, after, additions, deletions };
  });

  const commit = {
    id: input.id ?? randomUUID(),
    repositoryId: repository.id,
    branchId: branch.id,
    parentId: branch.headCommitId ?? null,
    message: input.message ?? INITIAL_COMMIT_MESSAGE,
    authorAccountId: input.authorAccountId ?? null,
    authorName: input.authorName ?? "",
    committedAt,
    changes,
  };
  state.commits.push(commit);
  branch.headCommitId = commit.id;

  const stored = state.repositoryFiles.filter((file) => (
    file.repositoryId === repository.id && file.branchId === branch.id
  ));
  for (const file of stored) {
    if (!snapshot.has(file.path)) continue;
    file.content = snapshot.get(file.path);
    file.updatedAt = committedAt;
  }
  const known = new Set(stored.map((file) => file.path));
  for (const [path, content] of snapshot) {
    if (known.has(path)) continue;
    state.repositoryFiles.push({
      id: randomUUID(),
      repositoryId: repository.id,
      branchId: branch.id,
      path,
      content,
      updatedAt: committedAt,
    });
  }
  state.repositoryFiles = state.repositoryFiles.filter((file) => (
    file.repositoryId !== repository.id || file.branchId !== branch.id || snapshot.has(file.path)
  ));
  return commit;
}

/**
 * Adds one file to one branch through a single immutable commit. The path, the
 * content and the commit message are validated first, so a rejected submission
 * writes nothing: the stored files, the branch head and the commit history stay
 * exactly as they were. A successful submission appends one commit whose parent
 * is the previous head of the branch, records the author and the changed file,
 * and advances the branch reference at the same time.
 */
export function createFileCommit(state, repository, account, input = {}) {
  const requested = typeof input.branch === "string" ? input.branch.trim() : "";
  const branchName = requested.length > 0
    ? requested
    : (repository.defaultBranch ?? DEFAULT_BRANCH_NAME);
  const branch = findBranch(state, repository, branchName);
  if (!branch) return { errors: { branch: MESSAGES.branchNotFound } };

  const existingPaths = listBranchFiles(state, repository, branch.name).map((file) => file.path);
  const { errors, values } = validateFileChange(input, existingPaths);
  if (hasErrors(errors)) return { errors };

  const commit = appendCommit(state, repository, branch.name, {
    message: values.message,
    authorAccountId: account?.id ?? null,
    authorName: account?.username ?? "",
    changes: [{ path: values.path, content: values.content }],
  });
  if (!commit) return { errors: { branch: MESSAGES.branchNotFound } };

  return {
    branch: branch.name,
    commit,
    file: {
      name: fileNameOf(values.path),
      path: values.path,
      branch: branch.name,
      content: values.content,
    },
  };
}

/**
 * Points the repository default branch at an existing branch. Only the stored
 * `defaultBranch` changes: every branch, commit and file of the repository
 * stays exactly as it was.
 */
export function changeDefaultBranch(state, repository, name) {
  const needle = typeof name === "string" ? name.trim() : "";
  if (needle.length === 0) return { errors: { branch: MESSAGES.branchNotFound } };
  const branch = findBranch(state, repository, needle);
  if (!branch) return { errors: { branch: MESSAGES.branchNotFound } };
  repository.defaultBranch = branch.name;
  return { repository, branch };
}

export function listBranchFiles(state, repository, branchName) {
  const branch = findBranch(state, repository, branchName);
  if (!branch) return [];
  return state.repositoryFiles.filter((file) => (
    file.repositoryId === repository.id && file.branchId === branch.id
  ));
}

/**
 * Commits of one branch, newest first. A branch is a reference at one commit,
 * so its history is the parent chain of that commit: a branch created from
 * another revision shares the history it points at instead of copying it.
 */
export function listBranchCommits(state, repository, branchName) {
  const branch = findBranch(state, repository, branchName);
  if (!branch || !branch.headCommitId) return [];
  const byId = new Map(
    state.commits
      .filter((commit) => commit.repositoryId === repository.id)
      .map((commit) => [commit.id, commit]),
  );
  const commits = [];
  const seen = new Set();
  let current = byId.get(branch.headCommitId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    commits.push(current);
    current = current.parentId ? byId.get(current.parentId) ?? null : null;
  }
  return commits;
}

/** Changed files stored by one commit; older records without them stay empty. */
export function commitChanges(commit) {
  return Array.isArray(commit?.changes) ? commit.changes : [];
}

/** Short display form of a commit identifier. */
export function shortCommitId(id) {
  return typeof id === "string" ? id.slice(0, 8) : "";
}

/**
 * History of one branch, optionally narrowed to the commits that changed one
 * file path. Commits are immutable records, so the same stored change list is
 * read by the history, the comparison and the file views.
 */
export function listBranchHistory(state, repository, branchName, path = "") {
  const commits = listBranchCommits(state, repository, branchName);
  const needle = normalizeFilePath(path);
  if (!needle) return commits;
  return commits.filter((commit) => commitChanges(commit).some((change) => change.path === needle));
}

/** One commit of one repository by identifier, or null. */
export function readCommit(state, repository, id) {
  const needle = typeof id === "string" ? id.trim() : "";
  if (!needle) return null;
  return state.commits.find((commit) => commit.repositoryId === repository.id && commit.id === needle) ?? null;
}

/** List record of one commit: identity, author, time, parent and change stats. */
export function commitRecordView(commit) {
  if (!commit) return null;
  const changes = commitChanges(commit);
  return {
    id: commit.id,
    shortId: shortCommitId(commit.id),
    message: commit.message,
    authorName: commit.authorName ?? "",
    committedAt: commit.committedAt,
    parentId: commit.parentId ?? null,
    additions: changes.reduce((total, change) => total + (change.additions ?? 0), 0),
    deletions: changes.reduce((total, change) => total + (change.deletions ?? 0), 0),
    changedFiles: changes.map((change) => change.path),
  };
}

/**
 * Comparison payload of one commit: the commit record plus, for every changed
 * file, the line-by-line difference between its parent revision and the stored
 * content of this commit. Read-only: nothing is created or modified here.
 */
export function commitDetailView(state, repository, branchName, commit) {
  const record = commitRecordView(commit);
  if (!record) return null;
  return {
    ...record,
    branch: branchName,
    files: commitChanges(commit).map((change) => {
      const diff = diffLines(change.before ?? null, change.after ?? null);
      return {
        path: change.path,
        additions: change.additions ?? diff.additions,
        deletions: change.deletions ?? diff.deletions,
        lines: diff.lines,
      };
    }),
  };
}

/**
 * Code search inside one repository: only files of one branch take part, and
 * only the lines that actually contain the query are returned. The search is
 * read-only and never creates a commit or changes a file.
 */
export function searchRepositoryContent(state, repository, branchName, query) {
  const raw = typeof query === "string" ? query : "";
  const needle = raw.trim().toLowerCase();
  if (needle.length === 0) return { query: raw, total: 0, results: [] };
  const results = [];
  for (const file of listBranchFiles(state, repository, branchName)) {
    const matched = [];
    const lines = contentLines(file.content);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(needle)) continue;
      if (matched.length >= 5) break;
      matched.push({ number: index + 1, text: lines[index] });
    }
    if (matched.length === 0) continue;
    results.push({ path: file.path, name: fileNameOf(file.path), lines: matched });
  }
  results.sort((left, right) => left.path.localeCompare(right.path));
  return { query: raw, total: results.length, results };
}

export function readRepositoryFile(state, repository, branchName, path) {
  const needle = normalizeFilePath(path);
  if (!needle) return null;
  return listBranchFiles(state, repository, branchName)
    .find((file) => file.path === needle) ?? null;
}

/**
 * Directory entries at `path` ("" is the repository root): direct files and the
 * directories derived from deeper paths. Entries are sorted by name with
 * directories first, mirroring the way a code page lists a tree.
 */
export function listDirectoryEntries(state, repository, branchName, path = "") {
  const base = normalizeFilePath(path);
  const prefix = base.length > 0 ? `${base}/` : "";
  const entries = new Map();
  for (const file of listBranchFiles(state, repository, branchName)) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      entries.set(rest, { kind: "file", name: rest, path: file.path });
      continue;
    }
    const name = rest.slice(0, slash);
    if (!entries.has(name)) {
      entries.set(name, { kind: "directory", name, path: `${prefix}${name}` });
    }
  }
  return [...entries.values()].sort((left, right) => (
    left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "directory" ? -1 : 1
  ));
}

/**
 * Writes one branch of a repository together with an ordered commit history.
 * Every commit records the changed files (path, base content, stored content)
 * and the resulting additions and deletions, the branch head points at the last
 * commit and the branch files are the content of that last revision. Called
 * once per repository, either for a new repository (initialization) or while
 * seeding a missing seed repository, so a restart never rewrites history.
 */
export function initializeRepositoryHistory(state, repository, options = {}) {
  const branchName = options.branchName ?? DEFAULT_BRANCH_NAME;
  const branch = {
    id: randomUUID(),
    repositoryId: repository.id,
    name: branchName,
    headCommitId: null,
    createdAt: options.createdAt ?? nowIso(),
  };
  state.branches.push(branch);

  const snapshot = new Map();
  let parentId = null;
  let lastCommittedAt = branch.createdAt;
  for (const entry of options.commits ?? []) {
    const committedAt = entry.committedAt ?? nowIso();
    const changes = (entry.changes ?? []).map((change) => {
      const path = normalizeFilePath(change.path);
      const before = snapshot.has(path) ? snapshot.get(path) : null;
      const after = typeof change.content === "string" ? change.content : null;
      if (after === null) snapshot.delete(path);
      else snapshot.set(path, after);
      const { additions, deletions } = diffLines(before, after);
      return { path, before, after, additions, deletions };
    });
    const commit = {
      id: entry.id ?? randomUUID(),
      repositoryId: repository.id,
      branchId: branch.id,
      parentId,
      message: entry.message ?? INITIAL_COMMIT_MESSAGE,
      authorAccountId: entry.authorAccountId ?? null,
      authorName: entry.authorName ?? "",
      committedAt,
      changes,
    };
    state.commits.push(commit);
    parentId = commit.id;
    lastCommittedAt = committedAt;
  }

  for (const [path, content] of snapshot) {
    state.repositoryFiles.push({
      id: randomUUID(),
      repositoryId: repository.id,
      branchId: branch.id,
      path,
      content,
      updatedAt: lastCommittedAt,
    });
  }

  branch.headCommitId = parentId;
  repository.defaultBranch = branch.name;
  return branch;
}

/**
 * Writes the pinned content of one repository as a single initial commit that
 * adds every file. Kept for the repositories whose seed has no explicit
 * history: the default branch, its files and the commit pointing at them are
 * written exactly once.
 */
export function initializeRepositoryContent(state, repository, options = {}) {
  const committedAt = options.committedAt ?? nowIso();
  const files = options.files ?? [{
    path: README_FILE_NAME,
    content: options.readmeContent ?? defaultReadmeContent(repository),
  }];
  return initializeRepositoryHistory(state, repository, {
    branchName: DEFAULT_BRANCH_NAME,
    createdAt: committedAt,
    commits: [{
      message: options.message ?? INITIAL_COMMIT_MESSAGE,
      authorAccountId: options.authorAccountId ?? null,
      authorName: options.authorName ?? "",
      committedAt,
      changes: files.map((file) => ({
        path: file.path,
        content: typeof file.content === "string" ? file.content : "",
      })),
    }],
  });
}

/**
 * Copies the default-branch files and history of a source repository into a
 * fork. Every copy gets fresh identifiers and the parent links are rebuilt, so
 * later commits to the fork never touch the source repository.
 */
export function copyDefaultBranchContent(state, source, target) {
  const sourceBranch = defaultBranchOf(state, source);
  target.defaultBranch = sourceBranch?.name ?? DEFAULT_BRANCH_NAME;
  if (!sourceBranch) return null;

  const branch = {
    id: randomUUID(),
    repositoryId: target.id,
    name: sourceBranch.name,
    headCommitId: null,
    createdAt: nowIso(),
  };
  state.branches.push(branch);

  for (const file of listBranchFiles(state, source, sourceBranch.name)) {
    state.repositoryFiles.push({
      id: randomUUID(),
      repositoryId: target.id,
      branchId: branch.id,
      path: file.path,
      content: file.content,
      updatedAt: file.updatedAt,
    });
  }

  const commits = listBranchCommits(state, source, sourceBranch.name).slice().reverse();
  const copiedIds = new Map();
  let previousId = null;
  for (const commit of commits) {
    const copy = {
      id: randomUUID(),
      repositoryId: target.id,
      branchId: branch.id,
      parentId: commit.parentId ? copiedIds.get(commit.parentId) ?? previousId : null,
      message: commit.message,
      authorAccountId: commit.authorAccountId ?? null,
      authorName: commit.authorName ?? "",
      committedAt: commit.committedAt,
      // The copied history keeps the recorded changed files, so the fork shows
      // the same immutable changes as its source.
      changes: commitChanges(commit).map((change) => ({ ...change })),
    };
    state.commits.push(copy);
    copiedIds.set(commit.id, copy.id);
    previousId = copy.id;
  }
  branch.headCommitId = previousId;
  return branch;
}
