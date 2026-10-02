// The read-only Code routes of the same-origin API stand-in used by component
// tests: directory and file reads, the commit history, the commit and
// comparison diffs and the in-repository code search. The answers mirror the
// server's payloads without importing production code.

import {
  stubEntries,
  type StubCommit,
  type StubRepositoryView,
} from "./repository-stub";

export interface StubCodeRouteInput {
  owner: string;
  section: string;
  /** Decoded extra path segments after the section. */
  rest: string[];
  params: URLSearchParams;
  view: StubRepositoryView;
  /** The viewer's effective repository role, or null for a visitor. */
  viewerRole?: string | null;
}

export interface StubCodeRouteResult {
  status: number;
  body: unknown;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".md": "Markdown",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".json": "JSON",
  ".txt": "Text",
  ".css": "CSS",
  ".html": "HTML",
};

function languageOfPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "Other";
  return LANGUAGE_BY_EXTENSION[path.slice(dot).toLowerCase()] ?? "Other";
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function filesOf(commit: StubCommit | null): Array<{ path: string; content: string }> {
  return commit?.files ?? [];
}

function fileIn(commit: StubCommit | null, path: string) {
  return filesOf(commit).find((file) => file.path === path) ?? null;
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  return (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n");
}

function lineDiff(baseContent: string, compareContent: string) {
  const before = splitLines(baseContent);
  const after = splitLines(compareContent);
  const table = Array.from({ length: before.length + 1 }, () =>
    new Array(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines: Array<{ type: "context" | "add" | "remove"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({ type: "context", text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "remove", text: before[i] });
      i += 1;
    } else {
      lines.push({ type: "add", text: after[j] });
      j += 1;
    }
  }
  while (i < before.length) {
    lines.push({ type: "remove", text: before[i] });
    i += 1;
  }
  while (j < after.length) {
    lines.push({ type: "add", text: after[j] });
    j += 1;
  }
  return {
    lines,
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "remove").length,
  };
}

export function stubDiffSnapshots(base: StubCommit | null, compare: StubCommit) {
  return diffSnapshots(base, compare);
}

function diffSnapshots(base: StubCommit | null, compare: StubCommit) {
  const baseFiles = new Map(filesOf(base).map((file) => [file.path, file.content]));
  const compareFiles = new Map(filesOf(compare).map((file) => [file.path, file.content]));
  const paths = [...new Set([...baseFiles.keys(), ...compareFiles.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );

  const files = [];
  let additions = 0;
  let deletions = 0;
  for (const path of paths) {
    const before = baseFiles.get(path);
    const after = compareFiles.get(path);
    if (before === after) continue;
    const diff = lineDiff(before ?? "", after ?? "");
    files.push({
      path,
      status: before === undefined ? "added" : after === undefined ? "removed" : "modified",
      additions: diff.additions,
      deletions: diff.deletions,
      lines: diff.lines,
    });
    additions += diff.additions;
    deletions += diff.deletions;
  }
  return { files, additions, deletions };
}

function changedPaths(base: StubCommit | null, compare: StubCommit): string[] {
  return diffSnapshots(base, compare).files.map((file) => file.path);
}

export function stubCommitBySha(view: StubRepositoryView, revision: string): StubCommit | null {
  return commitBySha(view, revision);
}

function commitBySha(view: StubRepositoryView, revision: string): StubCommit | null {
  if (revision.length === 0) return null;
  return (
    view.commits.find((commit) => commit.sha === revision) ??
    view.commits.find((commit) => commit.sha.startsWith(revision)) ??
    null
  );
}

export function stubHeadCommit(view: StubRepositoryView, branch: string): StubCommit | null {
  return headCommit(view, branch);
}

function headCommit(view: StubRepositoryView, branch: string): StubCommit | null {
  const sha = view.branchHeads[branch];
  if (!sha) return null;
  return commitBySha(view, sha);
}

/** Resolves a branch name or a commit sha of this repository. */
function revisionOf(view: StubRepositoryView, value: string): StubCommit | null {
  if (value.length === 0) return null;
  if (view.branches.includes(value)) return headCommit(view, value);
  return commitBySha(view, value);
}

export function stubCommitChain(view: StubRepositoryView, head: StubCommit | null): StubCommit[] {
  return chainOf(view, head);
}

function chainOf(view: StubRepositoryView, head: StubCommit | null): StubCommit[] {
  const chain: StubCommit[] = [];
  const seen = new Set<string>();
  let current = head;
  while (current && !seen.has(current.sha)) {
    seen.add(current.sha);
    chain.push(current);
    current = current.parentSha ? commitBySha(view, current.parentSha) : null;
  }
  return chain;
}

/** The commits of a linear chain that really changed one path, newest first. */
function commitsChangingPath(chain: StubCommit[], path: string): StubCommit[] {
  const changing: StubCommit[] = [];
  for (let index = 0; index < chain.length; index += 1) {
    const commit = chain[index];
    const parent = chain[index + 1] ?? null;
    const file = fileIn(commit, path);
    if (!file) break;
    const parentFile = fileIn(parent, path);
    if (!parentFile || parentFile.content !== file.content) changing.push(commit);
  }
  return changing;
}

function identityOf(owner: string, view: StubRepositoryView, viewerRole: string | null) {
  return {
    owner,
    name: view.name,
    description: view.description,
    visibility: view.visibility,
    defaultBranch: view.defaultBranch,
    viewerRole,
    source: view.source ?? null,
  };
}

function normalizePath(value: string): string {
  return value
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

function recordOf(commit: StubCommit, view: StubRepositoryView) {
  const parent = commit.parentSha ? commitBySha(view, commit.parentSha) : null;
  return {
    id: `commit-${commit.sha}`,
    sha: commit.sha,
    shortSha: shortSha(commit.sha),
    message: commit.message,
    author: commit.author,
    createdAt: commit.createdAt,
    parentId: parent ? `commit-${parent.sha}` : null,
    parentSha: parent?.sha ?? null,
    parentMessage: parent?.message ?? null,
    changedFiles: changedPaths(parent, commit),
  };
}

function revisionOptions(view: StubRepositoryView) {
  const commits: StubCommit[] = [];
  const seen = new Set<string>();
  for (const branch of view.branches) {
    for (const commit of chainOf(view, headCommit(view, branch))) {
      if (seen.has(commit.sha)) continue;
      seen.add(commit.sha);
      commits.push(commit);
    }
  }
  return commits
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((commit) => ({ value: commit.sha, label: `${shortSha(commit.sha)} ${commit.message}` }));
}

function comparisonOf(
  owner: string,
  view: StubRepositoryView,
  base: StubCommit | null,
  compare: StubCommit,
  path: string,
  viewerRole: string | null,
) {
  const diff = diffSnapshots(base, compare);
  return {
    repository: identityOf(owner, view, viewerRole),
    base: base
      ? {
          id: `commit-${base.sha}`,
          sha: base.sha,
          shortSha: shortSha(base.sha),
          message: base.message,
          author: base.author,
          createdAt: base.createdAt,
        }
      : null,
    compare: {
      id: `commit-${compare.sha}`,
      sha: compare.sha,
      shortSha: shortSha(compare.sha),
      message: compare.message,
      author: compare.author,
      createdAt: compare.createdAt,
    },
    path,
    files: path.length > 0 ? diff.files.filter((file) => file.path === path) : diff.files,
    changedFileCount: diff.files.length,
    additions: diff.additions,
    deletions: diff.deletions,
    revisions: revisionOptions(view),
  };
}

function contextBranch(view: StubRepositoryView, commit: StubCommit): string {
  return (
    view.branches.find((branch) =>
      chainOf(view, headCommit(view, branch)).some((candidate) => candidate.sha === commit.sha),
    ) ?? view.defaultBranch
  );
}

/**
 * Answers one Code route, or `null` when the section is not a Code route. The
 * caller has already resolved the repository and the viewer's read permission.
 */
export function handleRepositoryCodeStub(input: StubCodeRouteInput): StubCodeRouteResult | null {
  const { owner, section, rest, params, view } = input;
  const viewerRole = input.viewerRole ?? null;
  const repository = identityOf(owner, view, viewerRole);
  const branchName = params.get("branch") ?? view.defaultBranch;

  if (section === "tree" || section === "blob") {
    const branch = headCommit(view, branchName);
    if (!branch) return { status: 404, body: { error: "Not found" } };
    const path = normalizePath(params.get("path") ?? "");
    if (section === "tree") {
      if (path.length > 0 && !filesOf(branch).some((file) => file.path.startsWith(`${path}/`))) {
        return { status: 404, body: { error: "Not found" } };
      }
      return {
        status: 200,
        body: {
          repository,
          branch: branchName,
          path,
          branches: view.branches,
          commitCount: chainOf(view, branch).length,
          entries: stubEntries(branch.files, path),
        },
      };
    }
    const chain = chainOf(view, branch);
    const changing = path.length > 0 ? commitsChangingPath(chain, path) : [];
    const commit = changing[0] ?? null;
    if (!commit) return { status: 404, body: { error: "Not found" } };
    const file = fileIn(commit, path);
    if (!file) return { status: 404, body: { error: "Not found" } };
    return {
      status: 200,
      body: {
        repository,
        branch: branchName,
        branches: view.branches,
        path: file.path,
        content: file.content,
        commitCount: changing.length,
        commit: {
          id: `commit-${commit.sha}`,
          sha: commit.sha,
          shortSha: shortSha(commit.sha),
          message: commit.message,
          author: commit.author,
          createdAt: commit.createdAt,
        },
      },
    };
  }

  if (section === "commits") {
    const branch = headCommit(view, branchName);
    if (!branch) return { status: 404, body: { error: "Not found" } };
    const path = normalizePath(params.get("path") ?? "");
    const chain = chainOf(view, branch);
    const commits = path.length > 0 ? commitsChangingPath(chain, path) : chain;
    if (path.length > 0 && commits.length === 0) return { status: 404, body: { error: "Not found" } };

    if (rest.length === 0) {
      return {
        status: 200,
        body: {
          repository,
          branch: branchName,
          branches: view.branches,
          path,
          commitCount: chain.length,
          commits: commits.map((commit) => recordOf(commit, view)),
        },
      };
    }

    const commit = commitBySha(view, rest[0]);
    if (!commit) return { status: 404, body: { error: "Not found" } };
    const parent = commit.parentSha ? commitBySha(view, commit.parentSha) : null;
    return {
      status: 200,
      body: {
        repository,
        branch: contextBranch(view, commit),
        branches: view.branches,
        commit: recordOf(commit, view),
        comparison: comparisonOf(owner, view, parent, commit, path, viewerRole),
      },
    };
  }

  if (section === "compare") {
    const branch = headCommit(view, branchName);
    if (!branch) return { status: 404, body: { error: "Not found" } };
    const requestedBase = params.get("base") ?? "";
    const requestedCompare = params.get("compare") ?? "";
    const compare = requestedCompare ? revisionOf(view, requestedCompare) : branch;
    const base = requestedBase
      ? revisionOf(view, requestedBase)
      : compare?.parentSha
        ? commitBySha(view, compare.parentSha)
        : null;
    if (!compare) return { status: 404, body: { error: "Not found" } };
    if (requestedBase && !base) return { status: 404, body: { error: "Not found" } };
    const path = normalizePath(params.get("path") ?? "");
    return {
      status: 200,
      body: {
        ...comparisonOf(owner, view, base, compare, path, viewerRole),
        branch: branchName,
        branches: view.branches,
      },
    };
  }

  if (section === "search") {
    const branch = headCommit(view, branchName);
    if (!branch) return { status: 404, body: { error: "Not found" } };
    const path = normalizePath(params.get("path") ?? "");
    const language = (params.get("language") ?? "").trim();
    const query = (params.get("q") ?? "").trim();
    const term = query.toLowerCase();

    const files = filesOf(branch)
      .slice()
      .sort((left, right) => left.path.localeCompare(right.path));
    const results = [];
    for (const file of files) {
      if (path.length > 0 && !file.path.startsWith(path)) continue;
      const fileLanguage = languageOfPath(file.path);
      if (language.length > 0 && fileLanguage !== language) continue;
      if (term.length === 0) continue;
      const lines = file.content.split("\n");
      const index = lines.findIndex((line) => line.toLowerCase().includes(term));
      if (index === -1) continue;
      results.push({
        name: file.path.split("/").pop(),
        path: file.path,
        branch: branchName,
        language: fileLanguage,
        line: index + 1,
        snippet: lines[index],
      });
    }

    return {
      status: 200,
      body: {
        repository,
        branch: branchName,
        branches: view.branches,
        query,
        path,
        language,
        languages: [...new Set(files.map((file) => languageOfPath(file.path)))].sort((left, right) =>
          left.localeCompare(right),
        ),
        results,
      },
    };
  }

  return null;
}
