/**
 * Branch, commit and file-snapshot model of a repository (REQ-4).
 *
 * A file is content at a path on a branch: the stored file sets live in the
 * immutable tree of the commit a branch points to, and a branch is nothing but
 * a named reference to one commit plus the parent chain behind it. Switching
 * branches therefore only changes which snapshot the Code page reads, and
 * editing a file appends a new commit instead of rewriting history.
 *
 * A directory is only a path hierarchy derived from the stored paths; it is not
 * an independent collaboration object. Records written before branches existed
 * (a plain `files` array on the default branch) are still readable.
 */

/** Reasons a file change or a branch read is refused (REQ-4-1, REQ-4-4). */
export const BRANCH_MESSAGES = {
  invalidPath: "Invalid file path",
  messageRequired: "Commit message is required",
  messageTooLong: "Commit message must be 72 characters or fewer",
  pathTaken: "A file or directory already exists at this path",
  branchProtected: "This branch is protected",
  branchNotFound: "Branch not found",
  commitFailed: "The commit could not be created",
  forbidden: "You do not have permission to edit files in this repository",
  signInRequired: "Sign in is required to edit files",
};

const MAX_COMMIT_MESSAGE = 72;

/** The stored file set of a branch snapshot, normalized and sorted by path. */
function normalizeSnapshot(files) {
  return (Array.isArray(files) ? files : [])
    .filter((file) => file && typeof file.path === "string" && file.path)
    .map((file) => ({
      path: file.path.replace(/^\/+/, ""),
      content: typeof file.content === "string" ? file.content : "",
      updatedAt: file.updatedAt ?? null,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function repositoryBranchList(repository) {
  const branches = Array.isArray(repository?.branches) ? repository.branches : [];
  return branches.filter((branch) => branch && typeof branch.name === "string" && branch.name);
}

export function findRepositoryBranch(repository, name) {
  const wanted = typeof name === "string" ? name.trim() : "";
  if (!wanted) return null;
  return repositoryBranchList(repository).find((branch) => branch.name === wanted) ?? null;
}

export function repositoryBranchNames(repository) {
  return repositoryBranchList(repository).map((branch) => branch.name);
}

/** The branch list of the overview payload, default branch first. */
export function repositoryBranchSummaries(repository) {
  const branches = repositoryBranchList(repository);
  const ordered = [
    ...branches.filter((branch) => branch.name === repository?.defaultBranch),
    ...branches.filter((branch) => branch.name !== repository?.defaultBranch),
  ];
  return ordered.map((branch) => ({ name: branch.name, protected: branch.protected === true }));
}

/**
 * The branch a page reads: the requested one when it exists, otherwise the
 * default branch, otherwise the first stored branch. An unknown explicit branch
 * has no snapshot at all (null).
 */
export function resolveBranchName(repository, requested) {
  const raw = typeof requested === "string" ? requested.trim() : "";
  if (raw) return findRepositoryBranch(repository, raw) ? raw : null;
  if (findRepositoryBranch(repository, repository?.defaultBranch)) return repository.defaultBranch;
  const first = repositoryBranchList(repository)[0];
  if (first) return first.name;
  return null;
}

function commitById(repository, id) {
  const commits = Array.isArray(repository?.commits) ? repository.commits : [];
  if (!id) return null;
  return commits.find((commit) => commit && commit.id === id) ?? null;
}

/** One stored commit of a repository by its identifier, or null (REQ-4-2). */
export function findRepositoryCommit(repository, id) {
  return commitById(repository, id);
}

/** The stored file snapshot of one commit, normalized and sorted by path. */
export function commitSnapshot(commit) {
  return normalizeSnapshot(commit?.tree);
}

/** The file set stored on a branch (its head commit tree). */
export function branchSnapshot(repository, branchName) {
  const branch = findRepositoryBranch(repository, branchName);
  if (branch) {
    const head = commitById(repository, branch.headId);
    return normalizeSnapshot(head?.tree);
  }
  // Records without any branch (repositories created before REQ-4, or an empty
  // repository) keep their default-branch files readable.
  if (repositoryBranchList(repository).length === 0 && Array.isArray(repository?.files)) {
    return normalizeSnapshot(repository.files);
  }
  return [];
}

/** The stored file at `path` on a branch, or null. */
export function branchFile(repository, branchName, path) {
  const wanted = typeof path === "string" ? path.replace(/^\/+|\/+$/g, "") : "";
  if (!wanted) return null;
  return branchSnapshot(repository, branchName).find((file) => file.path === wanted) ?? null;
}

/**
 * Direct children of a directory of a branch snapshot; the directory tree is
 * derived from the stored paths, so a change to a file path is reflected by the
 * file list at once.
 */
export function directoryEntries(snapshot, path) {
  const prefix = typeof path === "string" ? path.replace(/^\/+|\/+$/g, "") : "";
  const entries = new Map();
  for (const file of snapshot) {
    if (prefix && !file.path.startsWith(`${prefix}/`)) continue;
    const remainder = prefix ? file.path.slice(prefix.length + 1) : file.path;
    if (!remainder) continue;
    const [first, ...rest] = remainder.split("/");
    if (!first) continue;
    const entryPath = prefix ? `${prefix}/${first}` : first;
    if (rest.length > 0) entries.set(entryPath, { name: first, path: entryPath, type: "directory" });
    else if (!entries.has(entryPath)) entries.set(entryPath, { name: first, path: entryPath, type: "file" });
  }
  return [...entries.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function branchDirectory(repository, branchName, path) {
  return directoryEntries(branchSnapshot(repository, branchName), path);
}

/** The read model of one commit: the tree snapshot stays internal. */
export function commitSummary(commit) {
  return {
    id: commit.id ?? "",
    message: commit.message ?? "",
    author: commit.author ?? "",
    authorId: commit.authorId ?? null,
    branch: commit.branch ?? null,
    parentId: commit.parentId ?? null,
    createdAt: commit.createdAt ?? null,
    files: (Array.isArray(commit.files) ? commit.files : []).map((file) => ({
      path: file?.path ?? "",
      change: file?.change ?? "modified",
    })),
  };
}

/** Commits reachable from the branch head, newest first. */
export function branchHistory(repository, branchName) {
  const branch = findRepositoryBranch(repository, branchName);
  if (!branch) return [];
  const commits = Array.isArray(repository?.commits) ? repository.commits : [];
  const byId = new Map(commits.filter((commit) => commit?.id).map((commit) => [commit.id, commit]));
  const history = [];
  const seen = new Set();
  let cursor = byId.get(branch.headId) ?? null;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    history.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) ?? null : null;
  }
  return history.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export function branchCommits(repository, branchName) {
  return branchHistory(repository, branchName).map(commitSummary);
}

/** The stored file paths of a branch snapshot, sorted (REQ-4-2-1 scopes). */
export function branchFilePaths(repository, branchName) {
  return branchSnapshot(repository, branchName).map((file) => file.path);
}

/**
 * The history of one path on a branch: only the commits that modified that
 * path, newest first (REQ-4-2-1). Reading a file's history therefore never
 * shows a commit that did not touch the file.
 */
export function branchHistoryForPath(repository, branchName, path) {
  const wanted = typeof path === "string" ? path.replace(/^\/+|\/+$/g, "") : "";
  if (!wanted) return branchHistory(repository, branchName);
  return branchHistory(repository, branchName).filter((commit) =>
    (Array.isArray(commit.files) ? commit.files : []).some((file) => file?.path === wanted));
}

/** The most recent commit of the branch that touched `path`. */
export function lastCommitForPath(repository, branchName, path) {
  const wanted = typeof path === "string" ? path.replace(/^\/+|\/+$/g, "") : "";
  if (!wanted) return null;
  const commit = branchHistory(repository, branchName).find((candidate) =>
    (Array.isArray(candidate.files) ? candidate.files : []).some((file) => file?.path === wanted));
  return commit ? commitSummary(commit) : null;
}

function pathSegments(rawPath) {
  return String(rawPath ?? "")
    .replace(/^\s+|\s+$/g, "")
    .split("/");
}

/**
 * The rule the file editor applies to a new or renamed path (REQ-4-4): it must
 * not be empty, must not begin with `/`, must not contain a `.` or `..` path
 * segment and must not hold a segment with control characters.
 */
export function filePathError(rawPath) {
  const path = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!path) return BRANCH_MESSAGES.invalidPath;
  if (path.startsWith("/")) return BRANCH_MESSAGES.invalidPath;
  const segments = pathSegments(path);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return BRANCH_MESSAGES.invalidPath;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return BRANCH_MESSAGES.invalidPath;
  if (path.length > 300) return BRANCH_MESSAGES.invalidPath;
  return null;
}

/** The rule the file editor applies to the commit message (REQ-4-4). */
export function commitMessageError(rawMessage) {
  const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
  if (!message) return BRANCH_MESSAGES.messageRequired;
  if (message.length > MAX_COMMIT_MESSAGE) return BRANCH_MESSAGES.messageTooLong;
  return null;
}

/**
 * Whether a new or renamed path collides with the current branch content: an
 * existing file of the same name (unless it is the edited file itself), a
 * directory prefix, or a parent path occupied by a file.
 */
export function pathConflict(repository, branchName, path, ignorePath = null) {
  const target = String(path ?? "").replace(/^\/+|\/+$/g, "");
  if (!target) return true;
  const snapshot = branchSnapshot(repository, branchName);
  const ignored = typeof ignorePath === "string" ? ignorePath.replace(/^\/+|\/+$/g, "") : null;
  const segments = target.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const parent = segments.slice(0, index).join("/");
    if (snapshot.some((file) => file.path === parent)) return true;
  }
  if (target !== ignored && snapshot.some((file) => file.path === target)) return true;
  if (snapshot.some((file) => file.path.startsWith(`${target}/`))) return true;
  return false;
}
