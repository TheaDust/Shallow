// Read-only code views of the in-memory organization backend: the directory
// tree, one stored file, the commit list, the difference of a commit against
// its parent revision and the code search. The rules mirror the server routes
// (backend/src/lib/repository-code-routes.mjs) including the shared read check.

import { reply } from "./fake-response";
import { diffSnapshots, type FakeFile } from "./fake-org-seed";

export interface FakeRepository {
  id: string;
  ownerType: "organization" | "account";
  ownerId: string;
  ownerDisplayName: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  /** REQ-3-5: Archived status, a stored flag the code views only read. */
  archived?: boolean;
  defaultBranch: string;
  forkOfRepositoryId: string | null;
  updatedAt: string;
}

export interface FakeCommit {
  id: string;
  repositoryId: string;
  branch: string;
  message: string;
  authorName: string;
  createdAt: string;
  parentCommitId: string | null;
  files: FakeFile[];
}

export interface FakeBranch {
  id: string;
  repositoryId: string;
  name: string;
  headCommitId: string | null;
  createdAt: string;
}

export interface FakeViewer {
  username: string;
  accountId: string | null;
}

export function createFakeCodeApi({
  repositories,
  commits,
  branches,
  canRead,
  describeRepository,
}: {
  repositories: FakeRepository[];
  commits: FakeCommit[];
  branches: FakeBranch[];
  canRead(repository: FakeRepository, viewer: FakeViewer | null): boolean;
  describeRepository(repository: FakeRepository): Record<string, unknown>;
}) {
  const defaultBranch = (repository: FakeRepository) => repository.defaultBranch || "main";

  const branchOf = (repository: FakeRepository, name: string) =>
    branches.find((entry) => entry.repositoryId === repository.id && entry.name === name) ?? null;

  const commitById = (commitId: string | null | undefined) =>
    commitId ? commits.find((entry) => entry.id === commitId) ?? null : null;

  /** The file snapshot of one branch's head commit, or null when it has none. */
  const headFilesOf = (repository: FakeRepository, branchName?: string): FakeFile[] | null => {
    const branch = branchOf(repository, branchName || defaultBranch(repository));
    if (!branch?.headCommitId) return null;
    return commitById(branch.headCommitId)?.files ?? null;
  };

  /** Branch names of one repository in creation order. */
  const branchList = (repository: FakeRepository) =>
    branches
      .filter((entry) => entry.repositoryId === repository.id)
      .map((entry) => ({
        name: entry.name,
        headCommitId: entry.headCommitId ?? null,
        createdAt: entry.createdAt ?? null,
      }));

  /** The commit chain of one branch, head first, followed through its parents. */
  const branchChain = (repository: FakeRepository, branchName: string) => {
    const chain: FakeCommit[] = [];
    const seen = new Set<string>();
    let cursor = commitById(branchOf(repository, branchName)?.headCommitId);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.push(cursor);
      cursor = commitById(cursor.parentCommitId);
    }
    return chain;
  };

  const treeEntries = (files: FakeFile[], path: string) => {
    const prefix = path ? `${path}/` : "";
    const entries = new Map<string, { name: string; path: string; type: "file" | "directory" }>();
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
  };

  /** Commit list of one branch, newest first, optionally per file path. */
  const repositoryCommits = (repository: FakeRepository, path = "", branchName = "") => {
    const contentAt = (commit: FakeCommit | null, filePath: string) =>
      commit?.files.find((file) => file.path === filePath)?.content;
    return branchChain(repository, branchName || defaultBranch(repository))
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => {
        const difference = Date.parse(right.entry.createdAt) - Date.parse(left.entry.createdAt);
        return difference !== 0 ? difference : right.index - left.index;
      })
      .filter(
        ({ entry }) =>
          !path || contentAt(entry, path) !== contentAt(commitById(entry.parentCommitId), path),
      )
      .map(({ entry }) => ({
        id: entry.id,
        message: entry.message,
        authorName: entry.authorName,
        createdAt: entry.createdAt,
        parentCommitId: entry.parentCommitId,
      }));
  };

  const publicCommit = (commit: FakeCommit) => ({
    id: commit.id,
    message: commit.message,
    authorName: commit.authorName,
    createdAt: commit.createdAt,
    parentCommitId: commit.parentCommitId,
  });

  /** Returns null when the request is not one of the read-only code views. */
  function handleCodeRequest(
    repository: FakeRepository,
    segments: string[],
    method: string,
    searchParams: URLSearchParams,
    viewer: FakeViewer | null,
  ): Response | null {
    if (method !== "GET") return null;
    const view = segments[4];
    const isCollectionView = view === "tree" || view === "blob" || view === "commits" || view === "code-search";
    if (!isCollectionView && view !== "commit") return null;
    if (isCollectionView ? segments.length !== 5 : segments.length !== 6) return null;
    if (!canRead(repository, viewer)) return reply(403, { message: "Access denied" });

    if (view === "tree") {
      const branchName = searchParams.get("branch")?.trim() || defaultBranch(repository);
      const files = headFilesOf(repository, branchName);
      if (!files) return reply(404, { error: "Not found" });
      const path = searchParams.get("path")?.trim() ?? "";
      return reply(200, {
        repository: describeRepository(repository),
        branch: branchName,
        defaultBranch: defaultBranch(repository),
        path,
        entries: treeEntries(files, path),
      });
    }

    if (view === "blob") {
      const branchName = searchParams.get("branch")?.trim() || defaultBranch(repository);
      const path = searchParams.get("path")?.trim() ?? "";
      const file = (headFilesOf(repository, branchName) ?? []).find((entry) => entry.path === path);
      if (!file) return reply(404, { error: "Not found" });
      return reply(200, {
        repository: describeRepository(repository),
        file: {
          branch: branchName,
          defaultBranch: defaultBranch(repository),
          path: file.path,
          name: file.path.split("/").at(-1),
          content: file.content,
        },
      });
    }

    if (view === "commits") {
      const branchName = searchParams.get("branch")?.trim() || defaultBranch(repository);
      const path = searchParams.get("path")?.trim() ?? "";
      return reply(200, {
        repository: describeRepository(repository),
        branch: branchName,
        defaultBranch: defaultBranch(repository),
        path,
        commits: repositoryCommits(repository, path, branchName),
      });
    }

    if (view === "commit") {
      const commit = commits.find(
        (entry) => entry.repositoryId === repository.id && entry.id === segments[5],
      );
      if (!commit) return reply(404, { error: "Not found" });
      const base = commit.parentCommitId
        ? commits.find((entry) => entry.id === commit.parentCommitId) ?? null
        : null;
      const difference = diffSnapshots(base?.files ?? null, commit.files);
      return reply(200, {
        repository: describeRepository(repository),
        branch: commit.branch,
        commit: publicCommit(commit),
        base: base ? publicCommit(base) : null,
        changes: difference.files,
        totals: difference.totals,
      });
    }

    const query = searchParams.get("q") ?? "";
    if (view !== "code-search") return null;
    const branchName = searchParams.get("branch")?.trim() || defaultBranch(repository);
    const needle = query.trim().toLowerCase();
    const matches: Array<{ path: string; name: string; lines: Array<{ number: number; text: string }> }> = [];
    for (const file of headFilesOf(repository, branchName) ?? []) {
      if (!needle) break;
      const found: Array<{ number: number; text: string }> = [];
      const lines = String(file.content ?? "").split("\n");
      for (let index = 0; index < lines.length && found.length < 3; index += 1) {
        if (lines[index].toLowerCase().includes(needle)) {
          found.push({ number: index + 1, text: lines[index] });
        }
      }
      if (found.length > 0) {
        matches.push({ path: file.path, name: file.path.split("/").at(-1) ?? file.path, lines: found });
      }
    }
    matches.sort((left, right) => left.path.localeCompare(right.path));
    return reply(200, {
      repository: describeRepository(repository),
      branch: branchName,
      defaultBranch: defaultBranch(repository),
      query,
      matches,
    });
  }

  return { headFiles: headFilesOf, branchList, repositoryCommits, handleCodeRequest };
}
