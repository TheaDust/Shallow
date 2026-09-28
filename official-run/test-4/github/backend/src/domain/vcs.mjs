import { randomUUID } from "node:crypto";

import { effectiveRepositoryRole } from "./organizations.mjs";

const COMMIT_PREFIX = "commit_";
const SHORT_LENGTH = 7;

/**
 * Write permission for code-and-version-control operations: only Write,
 * Maintain, Admin, or an organization Owner may create commits. Read and
 * Triage (or anonymous visitors) may only view.
 */
export function canWriteRepository(state, accountId, repository) {
  if (!accountId || !repository) return false;
  const role = effectiveRepositoryRole(state, accountId, repository);
  return role === "write" || role === "maintain" || role === "admin";
}

export function shortId(commit) {
  return commit.id.slice(COMMIT_PREFIX.length, COMMIT_PREFIX.length + SHORT_LENGTH);
}

const BRANCH_NAME_MAX = 255;
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

/**
 * Branch-name validation (REQ-4-3): 1–255 characters of ASCII letters,
 * digits, `-`, `_`, `.`, `/`; must not end with `/` or `.`, and must not
 * contain consecutive `..` or `//`.
 */
export function isValidBranchName(value) {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > BRANCH_NAME_MAX) return false;
  if (!BRANCH_NAME_PATTERN.test(value)) return false;
  if (value.endsWith("/") || value.endsWith(".")) return false;
  if (value.includes("..") || value.includes("//")) return false;
  return true;
}

/**
 * Read-only comparison of two branches for pull-request views and creation:
 * the commits on the compare branch that are not reachable from the base
 * branch, the per-file diff between the two branch heads, and the comparable
 * commit count. `noDifference` is true when the branches are the same or
 * there are no comparable commits.
 */
export function compareBranches(state, repository, baseBranch, compareBranch) {
  const base = findBranch(repository, baseBranch);
  const compare = findBranch(repository, compareBranch);
  if (!base || !compare) return null;
  const baseIds = new Set(branchCommitIds(repository, base.name));
  const commits = branchCommitIds(repository, compare.name)
    .filter((id) => !baseIds.has(id))
    .map((id) => (repository.commits ?? []).find((commit) => commit.id === id))
    .filter(Boolean)
    .map((commit) => commitPayload(commit));
  const files = diffSnapshots(
    branchSnapshot(repository, base.name) ?? [],
    branchSnapshot(repository, compare.name) ?? [],
  );
  const commitCount = commits.length;
  return {
    baseBranch: base.name,
    compareBranch: compare.name,
    baseCommitId: base.commitId,
    compareCommitId: compare.commitId,
    sameBranch: base.name === compare.name,
    commitCount,
    commits,
    files,
    noDifference: base.name === compare.name || commitCount === 0,
  };
}

/**
 * Creates a new branch reference at the head of `baseBranch` (defaults to
 * the repository's default branch). Validates write permission, the name
 * rules, and uniqueness; stores the branch name, base commit, creator, and
 * creation time. Never copies files or rewrites base history.
 */
export function createBranch(state, repository, { accountId, name, baseBranch } = {}) {
  if (!canWriteRepository(state, accountId, repository)) {
    return { ok: false, forbidden: true };
  }
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!isValidBranchName(trimmed)) {
    return { ok: false, errors: { name: "Branch name is invalid" } };
  }
  if ((repository.branches ?? []).some((branch) => branch.name === trimmed)) {
    return { ok: false, errors: { name: "Branch already exists" } };
  }
  const base = findBranch(repository, typeof baseBranch === "string" ? baseBranch : repository.defaultBranch);
  if (!base) {
    return { ok: false, errors: { branch: "Branch not found" } };
  }
  repository.branches.push({
    name: trimmed,
    commitId: base.commitId,
    protected: false,
    createdByAccountId: accountId ?? null,
    createdAt: new Date().toISOString(),
  });
  return { ok: true, branch: { name: trimmed, commitId: base.commitId } };
}

export function findBranch(repository, branchName) {
  return (repository.branches ?? []).find((candidate) => candidate.name === branchName) ?? null;
}

export function findCommit(repository, commitId) {
  return (
    (repository.commits ?? []).find((candidate) => candidate.id === commitId) ??
    (repository.commits ?? []).find((candidate) => shortId(candidate) === commitId) ??
    null
  );
}

/**
 * The file snapshot at the head of a branch: files of the branch's commit.
 * Returns null when the branch does not exist, otherwise an array of
 * `{path, content}` records (empty for a branch without a commit).
 */
export function branchSnapshot(repository, branchName) {
  const branch = findBranch(repository, branchName);
  if (!branch) return null;
  if (!branch.commitId) return [];
  const commit = (repository.commits ?? []).find((candidate) => candidate.id === branch.commitId);
  return commit ? commit.files ?? [] : [];
}

/**
 * Commit ids reachable from a branch head, walking parent links. Newest
 * first; a guard prevents infinite loops on malformed data.
 */
export function branchCommitIds(repository, branchName) {
  const branch = findBranch(repository, branchName);
  if (!branch || !branch.commitId) return [];
  const byId = new Map((repository.commits ?? []).map((commit) => [commit.id, commit]));
  const ids = [];
  let cursor = branch.commitId;
  while (cursor && byId.has(cursor) && !ids.includes(cursor)) {
    ids.push(cursor);
    cursor = byId.get(cursor).parentId;
  }
  return ids;
}

export function commitPayload(commit) {
  return {
    id: commit.id,
    shortId: shortId(commit),
    parentId: commit.parentId,
    authorAccountId: commit.authorAccountId ?? null,
    authorName: commit.authorName ?? "unknown",
    message: commit.message,
    createdAt: commit.createdAt,
    changes: (commit.changes ?? []).map((change) => ({
      path: change.path,
      status: change.status,
      additions: change.additions,
      deletions: change.deletions,
    })),
  };
}

/**
 * Branch history newest first. When `path` is given, only commits whose
 * stored changes include that exact path are returned (file-scoped history).
 */
export function branchCommitList(repository, branchName, path = null) {
  const commits = branchCommitIds(repository, branchName)
    .map((id) => (repository.commits ?? []).find((candidate) => candidate.id === id))
    .filter(Boolean)
    .map((commit) => commitPayload(commit));
  if (!path) return commits;
  return commits.filter((commit) => (commit.changes ?? []).some((change) => change.path === path));
}

/**
 * Every commit stored in the repository, newest first (compare-page options).
 */
export function allCommits(repository) {
  return (repository.commits ?? [])
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((commit) => commitPayload(commit));
}

function splitLines(content) {
  if (typeof content !== "string") return [];
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Line-by-line diff of two line arrays using an LCS reconstruction. Returns
 * ordered lines (`context`/`add`/`del`) plus addition/deletion counts.
 */
function lineDiff(baseLines, compareLines) {
  const n = baseLines.length;
  const m = compareLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        baseLines[i] === compareLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (baseLines[i] === compareLines[j]) {
      lines.push({ type: "context", text: baseLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: "del", text: baseLines[i] });
      deletions += 1;
      i += 1;
    } else {
      lines.push({ type: "add", text: compareLines[j] });
      additions += 1;
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ type: "del", text: baseLines[i] });
    deletions += 1;
    i += 1;
  }
  while (j < m) {
    lines.push({ type: "add", text: compareLines[j] });
    additions += 1;
    j += 1;
  }
  return { lines, additions, deletions };
}

function fileDiff(baseFile, compareFile) {
  const baseLines = splitLines(baseFile?.content ?? "");
  const compareLines = splitLines(compareFile?.content ?? "");
  if (!baseFile) {
    return {
      lines: compareLines.map((text) => ({ type: "add", text })),
      additions: compareLines.length,
      deletions: 0,
    };
  }
  if (!compareFile) {
    return {
      lines: baseLines.map((text) => ({ type: "del", text })),
      additions: 0,
      deletions: baseLines.length,
    };
  }
  return lineDiff(baseLines, compareLines);
}

/**
 * Per-file diff between two snapshots. Files present on both sides with
 * identical content are omitted (unchanged files do not appear).
 */
export function diffSnapshots(baseFiles, compareFiles) {
  const baseMap = new Map((baseFiles ?? []).map((file) => [file.path, file]));
  const compareMap = new Map((compareFiles ?? []).map((file) => [file.path, file]));
  const paths = new Set([...baseMap.keys(), ...compareMap.keys()]);
  const changed = [];
  for (const path of [...paths].sort()) {
    const base = baseMap.get(path) ?? null;
    const compare = compareMap.get(path) ?? null;
    const diff = fileDiff(base, compare);
    const status = !base ? "added" : !compare ? "deleted" : "modified";
    if (status === "modified" && diff.additions === 0 && diff.deletions === 0) continue;
    changed.push({
      path,
      status,
      additions: diff.additions,
      deletions: diff.deletions,
      lines: diff.lines,
    });
  }
  return changed;
}

/**
 * Valid file path: non-empty, no leading or trailing `/`, and no empty or
 * `..` segment (a `..` segment is explicitly forbidden by the requirements).
 */
export function isValidFilePath(path) {
  if (typeof path !== "string") return false;
  if (path.length === 0) return false;
  if (path.startsWith("/") || path.endsWith("/")) return false;
  const segments = path.split("/");
  return !segments.some((segment) => segment === "" || segment === "..");
}

/**
 * A new path conflicts when a file already exists at that exact path, when a
 * directory occupies that path (some file lies below it), or when any parent
 * segment is occupied by an existing file.
 */
function pathConflict(snapshot, filePath) {
  const paths = new Set(snapshot.map((file) => file.path));
  if (paths.has(filePath)) return true;
  for (const existing of paths) {
    if (existing.startsWith(`${filePath}/`)) return true;
  }
  const segments = filePath.split("/");
  for (let i = 1; i < segments.length; i += 1) {
    if (paths.has(segments.slice(0, i).join("/"))) return true;
  }
  return false;
}

function accountName(state, accountId) {
  if (!accountId) return "unknown";
  return state.accounts.find((candidate) => candidate.id === accountId)?.username ?? "unknown";
}

/**
 * Builds an immutable commit record from a parent snapshot, computing the
 * stored change list from the file difference. Used by seeds and by the
 * repository domain when creating initial commits.
 */
export function makeSeedCommit({
  repositoryId,
  parentId,
  parentFiles,
  authorAccountId,
  authorName,
  message,
  createdAt,
  files,
}) {
  const changes = diffSnapshots(parentFiles ?? [], files ?? []).map(
    ({ path, status, additions, deletions }) => ({ path, status, additions, deletions }),
  );
  return {
    id: `${COMMIT_PREFIX}${randomUUID()}`,
    repositoryId,
    parentId: parentId ?? null,
    authorAccountId: authorAccountId ?? null,
    authorName: authorName ?? "unknown",
    message,
    createdAt: createdAt ?? new Date().toISOString(),
    changes,
    files: (files ?? []).map((file) => ({ path: file.path, content: file.content })),
  };
}

/**
 * Creates one new commit that adds or replaces the file at `path` on the
 * target branch, then moves the branch head to the new commit. All checks
 * (permission, path validity, conflicts, message length, branch protection)
 * happen before anything is written; a failed submission changes neither
 * files, branch head, nor history.
 */
export function createFileCommit(
  state,
  repository,
  { accountId, authorName, branch, path, content, message } = {},
) {
  if (!canWriteRepository(state, accountId, repository)) {
    return { ok: false, forbidden: true };
  }
  normalizeRepository(state, repository);
  const branchRecord = findBranch(repository, branch ?? repository.defaultBranch);
  if (!branchRecord) return { ok: false, errors: { branch: "Branch not found" } };
  if (branchRecord.protected) {
    return { ok: false, errors: { branch: "Branch is protected" } };
  }

  const errors = {};
  const filePath = typeof path === "string" ? path : "";
  const messageValue = typeof message === "string" ? message.trim() : "";
  if (!isValidFilePath(filePath)) {
    errors.path = "Invalid file path";
  } else if (pathConflict(branchSnapshot(repository, branchRecord.name), filePath)) {
    errors.path = "File already exists at this path";
  }
  if (messageValue.length === 0) {
    errors.message = "Commit message is required";
  } else if (messageValue.length > 72) {
    errors.message = "Commit message must be 1-72 characters";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const parentCommit = branchRecord.commitId
    ? (repository.commits ?? []).find((candidate) => candidate.id === branchRecord.commitId) ?? null
    : null;
  const parentFiles = parentCommit ? parentCommit.files ?? [] : [];
  const files = [
    ...parentFiles.filter((file) => file.path !== filePath),
    { path: filePath, content: typeof content === "string" ? content : "" },
  ];
  const commit = makeSeedCommit({
    repositoryId: repository.id,
    parentId: parentCommit ? parentCommit.id : null,
    parentFiles,
    authorAccountId: accountId ?? null,
    authorName: authorName ?? accountName(state, accountId),
    message: messageValue,
    files,
  });
  repository.commits = [...(repository.commits ?? []), commit];
  branchRecord.commitId = commit.id;
  repository.updatedAt = commit.createdAt;
  return { ok: true, commit };
}

/**
 * Diff of one commit against its parent revision. For the initial commit the
 * base is empty. Returns null when the commit is unknown.
 */
export function commitDiff(state, repository, commitId) {
  const commit = findCommit(repository, commitId);
  if (!commit) return null;
  const parent = commit.parentId
    ? (repository.commits ?? []).find((candidate) => candidate.id === commit.parentId) ?? null
    : null;
  return {
    commit: commitPayload(commit),
    base: parent ? { id: parent.id, shortId: shortId(parent) } : null,
    files: diffSnapshots(parent ? parent.files ?? [] : [], commit.files ?? []),
  };
}

/**
 * Diff between two arbitrary revisions of the same repository. Returns null
 * when either revision is unknown.
 */
export function compareDiff(state, repository, baseId, compareId, path = null) {
  const base = findCommit(repository, baseId);
  const compare = findCommit(repository, compareId);
  if (!base || !compare) return null;
  const files = diffSnapshots(base.files ?? [], compare.files ?? []);
  const scoped = path ? files.filter((file) => file.path === path) : files;
  return {
    base: { id: base.id, shortId: shortId(base) },
    compare: { id: compare.id, shortId: shortId(compare) },
    files: scoped,
  };
}

const LANGUAGE_BY_EXTENSION = new Map([
  ["ts", "TypeScript"],
  ["tsx", "TypeScript"],
  ["js", "JavaScript"],
  ["jsx", "JavaScript"],
  ["md", "Markdown"],
  ["markdown", "Markdown"],
  ["json", "JSON"],
  ["css", "CSS"],
  ["html", "HTML"],
  ["htm", "HTML"],
  ["py", "Python"],
  ["go", "Go"],
  ["rs", "Rust"],
  ["java", "Java"],
  ["c", "C"],
  ["h", "C"],
  ["cpp", "C++"],
  ["hpp", "C++"],
  ["rb", "Ruby"],
  ["php", "PHP"],
  ["sh", "Shell"],
  ["bash", "Shell"],
  ["yml", "YAML"],
  ["yaml", "YAML"],
  ["txt", "Text"],
]);

/** The display language of a file path, derived from its extension. */
export function fileLanguage(filePath) {
  const base = String(filePath ?? "").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION.get(ext) ?? (ext ? `${ext.charAt(0).toUpperCase()}${ext.slice(1)}` : "Text");
}

/**
 * Repository code search (REQ-4-2-3): case-insensitive keyword matching on
 * the file content of one branch snapshot, scoped to the current repository
 * only. Optional `path` (prefix) and `language` filters narrow the files;
 * results carry the matching line numbers and texts plus the branch name.
 */
export function searchCode(repository, branchName, query, { path = null, language = null } = {}) {
  const snapshot = branchSnapshot(repository, branchName);
  if (!snapshot) return { branch: branchName, results: [] };
  const term = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!term) return { branch: branchName, results: [] };
  const results = [];
  for (const file of snapshot) {
    if (path && !file.path.startsWith(path)) continue;
    if (language && fileLanguage(file.path) !== language) continue;
    const lines = splitLines(file.content);
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].toLowerCase().includes(term)) {
        matches.push({ lineNumber: index + 1, text: lines[index] });
      }
    }
    if (matches.length > 0) {
      results.push({ path: file.path, branch: branchName, matches });
    }
  }
  return { branch: branchName, results };
}

/**
 * Upgrades a legacy repository record (flat `files` on the default branch,
 * optional old-format `commits`) into the version-control shape: a `branches`
 * array of named references and a `commits` array of immutable snapshots.
 * Idempotent: records that already carry `branches`/`commits` are untouched.
 */
export function normalizeRepository(state, repository) {
  if (Array.isArray(repository.branches) && Array.isArray(repository.commits)) {
    return repository;
  }
  const legacyFiles = (repository.files ?? []).map((file) => ({
    path: file.path ?? file.name,
    content: file.content,
  }));
  const legacyCommit = (repository.commits ?? [])[0] ?? null;
  let commits = [];
  let commitId = null;
  if (legacyFiles.length > 0) {
    const commit = {
      id: legacyCommit?.id ?? `${COMMIT_PREFIX}${randomUUID()}`,
      repositoryId: repository.id,
      parentId: null,
      authorAccountId: repository.creatorAccountId ?? null,
      authorName: accountName(state, repository.creatorAccountId),
      message: legacyCommit?.message ?? "Initial commit",
      createdAt: legacyCommit?.createdAt ?? repository.createdAt ?? new Date().toISOString(),
      changes: legacyFiles.map((file) => ({
        path: file.path,
        status: "added",
        additions: splitLines(file.content).length,
        deletions: 0,
      })),
      files: legacyFiles,
    };
    commits = [commit];
    commitId = commit.id;
  }
  repository.branches = [
    { name: repository.defaultBranch || "main", commitId, protected: false },
  ];
  repository.commits = commits;
  delete repository.files;
  return repository;
}

export function normalizeRepositories(state) {
  for (const repository of state.repositories) {
    normalizeRepository(state, repository);
  }
  return state;
}
