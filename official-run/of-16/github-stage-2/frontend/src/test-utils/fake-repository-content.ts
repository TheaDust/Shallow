/**
 * Stored content model of the fake repository API: the files, commits and
 * directory entries a DOM test needs. Every helper is a pure function of one
 * `FakeRepository`, so the request handlers and the overview payload read the
 * same derived state.
 */

/** One changed file of a fake commit; `content: null` removes the file. */
export interface FakeCommitChange {
  path: string;
  content: string | null;
}

/** One immutable commit of a fake repository, in chronological order. */
export interface FakeCommit {
  message: string;
  author: string;
  committedAt: string;
  changes: FakeCommitChange[];
}

export interface FakeRepository {
  name: string;
  description: string;
  visibility: "public" | "private";
  updatedAt: string;
  defaultBranch?: string;
  /** Paths of the files on the default branch; omitted defaults to README.md. */
  files?: string[];
  /** Explicit history; omitted derives one initial commit from `files`. */
  commits?: FakeCommit[];
  /**
   * Further branches of the repository. Each branch carries its own file paths
   * and (optionally) its own history, so a switch changes which snapshot is
   * browsed without touching the other branches.
   */
  branches?: FakeBranch[];
  /** Source of a fork in `"<ownerKind>:<ownerSlug>/<name>"` form. */
  forkedFrom?: string;
}

/** One branch of a fake repository, with the snapshot it browses. */
export interface FakeBranch {
  name: string;
  /** Paths on this branch; omitted uses the repository `files`. */
  files?: string[];
  /** Explicit history of this branch; omitted derives it from the branch files. */
  commits?: FakeCommit[];
}

export interface FakeDiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

export interface FakeCommitRecord {
  id: string;
  shortId: string;
  message: string;
  authorName: string;
  committedAt: string;
  parentId: string | null;
  additions: number;
  deletions: number;
  changedFiles: string[];
  files: {
    path: string;
    additions: number;
    deletions: number;
    lines: FakeDiffLine[];
  }[];
}

export interface FakeDirectoryEntry {
  kind: "file" | "directory";
  name: string;
  path: string;
}

/** Stored content of one fake path; mirrors the seeded acme-docs content. */
export function repositoryFileContent(path: string): string {
  if (path === "src/README.md") return "Document search flow";
  if (path === "README.md") return "# acme-docs\n\nDocumentation, guides and release notes for Acme Demo.";
  return `Content of ${path}`;
}

/** Lines of one stored content value, without a single trailing newline. */
export function contentLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Line count of the added and removed lines of one change. */
function diffStats(before: string | null, after: string | null): { additions: number; deletions: number } {
  const base = before === null ? [] : contentLines(before);
  const compare = after === null ? [] : contentLines(after);
  if (before !== null && before === after) return { additions: 0, deletions: 0 };
  return { additions: compare.length, deletions: base.length };
}

/** Paths of a repository's default branch, as the stored head snapshot. */
export function defaultBranchNameOf(repository: FakeRepository): string {
  return repository.defaultBranch ?? "main";
}

/**
 * Branch records of a fake repository. A repository without explicit branches
 * behaves like one repository with a single default branch, so every existing
 * fixture keeps working unchanged.
 */
export function branchesOf(repository: FakeRepository): FakeBranch[] {
  if (repository.branches && repository.branches.length > 0) return repository.branches;
  return [{
    name: defaultBranchNameOf(repository),
    files: repository.files,
    commits: repository.commits,
  }];
}

/** Names of the branches, default branch first, mirroring the server payload. */
export function branchNamesOf(repository: FakeRepository): string[] {
  const names = branchesOf(repository).map((branch) => branch.name);
  const stored = defaultBranchNameOf(repository);
  const index = names.indexOf(stored);
  if (index > 0) {
    names.splice(index, 1);
    names.unshift(stored);
  }
  return names;
}

/** The addressed branch, or the default branch for an unknown/missing name. */
export function branchOf(repository: FakeRepository, name?: string): FakeBranch {
  const branches = branchesOf(repository);
  const wanted = name && name.length > 0 ? name : defaultBranchNameOf(repository);
  return branches.find((branch) => branch.name === wanted) ?? branches[0];
}

/** Paths of one branch of a fake repository. */
export function pathsOf(repository: FakeRepository, branchName?: string): string[] {
  return branchOf(repository, branchName).files ?? ["README.md"];
}

/** Stored history of one branch: the explicit one or one initial commit. */
export function commitsOf(repository: FakeRepository, branchName?: string): FakeCommit[] {
  const branch = branchOf(repository, branchName);
  if (branch.commits) return branch.commits;
  return [{
    message: "Initial commit",
    author: "ShallowCode",
    committedAt: repository.updatedAt,
    changes: pathsOf(repository, branch.name).map((path) => ({ path, content: repositoryFileContent(path) })),
  }];
}

/** Stored content of one branch head of a fake repository, by path. */
export function headSnapshotOf(repository: FakeRepository, branchName?: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const commit of commitsOf(repository, branchName)) {
    for (const change of commit.changes) {
      if (change.content === null) snapshot.delete(change.path);
      else snapshot.set(change.path, change.content);
    }
  }
  return snapshot;
}

/** Commit records of one branch, oldest first, with their changed files. */
export function commitRecordsOf(repository: FakeRepository, branchName?: string): FakeCommitRecord[] {
  const branch = branchOf(repository, branchName);
  const idPrefix = branch.name === defaultBranchNameOf(repository)
    ? `commit-${repository.name}`
    : `commit-${repository.name}-${branch.name}`;
  const snapshot = new Map<string, string>();
  const records: FakeCommitRecord[] = [];
  let parentId: string | null = null;
  commitsOf(repository, branch.name).forEach((commit, index) => {
    const files = commit.changes.map((change) => {
      const before = snapshot.has(change.path) ? snapshot.get(change.path)! : null;
      if (change.content === null) snapshot.delete(change.path);
      else snapshot.set(change.path, change.content);
      const { additions, deletions } = diffStats(before, change.content);
      const baseLines = before === null ? [] : contentLines(before);
      const compareLines = change.content === null ? [] : contentLines(change.content);
      const lines: FakeDiffLine[] = before !== null && before === change.content
        ? compareLines.map((text) => ({ type: "context" as const, text }))
        : [
          ...baseLines.map((text) => ({ type: "remove" as const, text })),
          ...compareLines.map((text) => ({ type: "add" as const, text })),
        ];
      return { path: change.path, additions, deletions, lines };
    });
    const record: FakeCommitRecord = {
      id: `${idPrefix}-${index}`,
      shortId: `${idPrefix}${index}`.replace(/[^a-z0-9]/gi, "").slice(0, 8).padEnd(8, "0"),
      message: commit.message,
      authorName: commit.author,
      committedAt: commit.committedAt,
      parentId,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      changedFiles: files.map((file) => file.path),
      files,
    };
    records.push(record);
    parentId = record.id;
  });
  return records;
}

/**
 * Stores one added file as a new commit of one branch. The branch history, the
 * branch snapshot and the stored file list are refreshed together, so the file
 * view, the directory listing and the commit history of that branch describe
 * the same revision while every other branch stays untouched. A repository
 * without explicit branches materializes them first.
 */
export function appendRepositoryFile(
  repository: FakeRepository,
  branchName: string,
  change: { path: string; content: string; message: string; author: string; committedAt: string },
): void {
  if (!repository.branches || repository.branches.length === 0) {
    repository.branches = [{
      name: defaultBranchNameOf(repository),
      files: repository.files,
      commits: repository.commits,
    }];
  }
  const branch = branchOf(repository, branchName);
  branch.commits = [
    ...commitsOf(repository, branch.name),
    {
      message: change.message,
      author: change.author,
      committedAt: change.committedAt,
      changes: [{ path: change.path, content: change.content }],
    },
  ];
  branch.files = [...pathsOf(repository, branch.name), change.path];
}

/** Files and directories at one path, derived from the stored file paths. */
export function directoryEntriesOf(paths: string[], prefix: string): FakeDirectoryEntry[] {
  const base = prefix.length > 0 ? `${prefix}/` : "";
  const entries = new Map<string, FakeDirectoryEntry>();
  for (const fullPath of paths) {
    if (!fullPath.startsWith(base)) continue;
    const rest = fullPath.slice(base.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      entries.set(rest, { kind: "file", name: rest, path: fullPath });
      continue;
    }
    const name = rest.slice(0, slash);
    if (!entries.has(name)) entries.set(name, { kind: "directory", name, path: `${base}${name}` });
  }
  return [...entries.values()].sort((left, right) => (
    left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "directory" ? -1 : 1
  ));
}
