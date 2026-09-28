import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FileRec {
  path: string;
  content: string;
}

interface ChangeRec {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

interface CommitRec {
  id: string;
  parentId: string | null;
  authorAccountId: string | null;
  authorName: string;
  message: string;
  createdAt: string;
  changes: ChangeRec[];
  files: FileRec[];
}

interface BranchRec {
  name: string;
  commitId: string | null;
  protected: boolean;
}

interface RepoRec {
  ownerType: "account" | "organization";
  ownerName: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
  branches: BranchRec[];
  commits: CommitRec[];
  currentRole: string | null;
}

const ALICE = { username: "alice-dev", email: "alice.dev@example.test" };
const BOB = { username: "bob-reviewer", email: "bob.reviewer@example.test" };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const README_V1 = "# Acme Docs\n\nPublic documentation for the Acme Demo platform.\n\nThe search flow is documented in this repository.\n";
const README_V2 =
  "# Acme Docs\n\nPublic documentation for the Acme Demo platform.\n\nThe search flow is documented in this repository.\n\n## Search flow\n\nEnter a keyword in the repository search box and press Enter to see matching files.\n";
const GUIDE = "# Guide\n\nHow to use the Acme Demo platform.\n";
const SEARCH_V1 = "export function search(query: string) {\n  return query.trim();\n}\n";
const SEARCH_V2 =
  "export function search(query: string) {\n  return query.trim().toLowerCase();\n}\n\nexport function highlight(text: string): string {\n  return text;\n}\n";
const OVERVIEW = "# Overview\n\nGuides and reference material for the Acme Docs platform.\n";

const shortId = (id: string) => id.slice("commit_".length);

function seedAcmeDocs(): RepoRec {
  const commitA: CommitRec = {
    id: "commit_aaaaaaaa",
    parentId: null,
    authorAccountId: null,
    authorName: "alice-dev",
    message: "Initial commit",
    createdAt: daysAgo(5),
    changes: [
      { path: "README.md", status: "added", additions: 3, deletions: 0 },
      { path: "guide.md", status: "added", additions: 2, deletions: 0 },
      { path: "src/search.ts", status: "added", additions: 4, deletions: 0 },
    ],
    files: [
      { path: "README.md", content: README_V1 },
      { path: "guide.md", content: GUIDE },
      { path: "src/search.ts", content: SEARCH_V1 },
    ],
  };
  const commitB: CommitRec = {
    id: "commit_bbbbbbbb",
    parentId: commitA.id,
    authorAccountId: null,
    authorName: "alice-dev",
    message: "Document search flow",
    createdAt: daysAgo(2),
    changes: [
      { path: "README.md", status: "modified", additions: 4, deletions: 0 },
      { path: "src/search.ts", status: "modified", additions: 5, deletions: 1 },
      { path: "docs/overview.md", status: "added", additions: 3, deletions: 0 },
    ],
    files: [
      { path: "README.md", content: README_V2 },
      { path: "guide.md", content: GUIDE },
      { path: "src/search.ts", content: SEARCH_V2 },
      { path: "docs/overview.md", content: OVERVIEW },
    ],
  };
  const commitF: CommitRec = {
    id: "commit_ffffffff",
    parentId: commitA.id,
    authorAccountId: null,
    authorName: "alice-dev",
    message: "Add feature search docs",
    createdAt: daysAgo(3),
    changes: [
      { path: "README.md", status: "modified", additions: 2, deletions: 1 },
      { path: "main-only.md", status: "added", additions: 3, deletions: 0 },
    ],
    files: [
      { path: "README.md", content: "# Acme Docs\n\nFeature search documentation.\n" },
      { path: "guide.md", content: GUIDE },
      { path: "src/search.ts", content: SEARCH_V1 },
      { path: "main-only.md", content: "# Main-only\n\nThis file exists only on the feature-search branch.\n" },
    ],
  };
  return {
    ownerType: "account",
    ownerName: "alice-dev",
    name: "acme-docs",
    description: "Documentation for Acme Demo",
    visibility: "public",
    defaultBranch: "main",
    updatedAt: daysAgo(1),
    branches: [
      { name: "main", commitId: commitB.id, protected: false },
      { name: "feature-search", commitId: commitF.id, protected: true },
    ],
    commits: [commitA, commitB, commitF],
    currentRole: null,
  };
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

interface DiffLineRec {
  type: "context" | "add" | "del";
  text: string;
}

function lineDiff(baseLines: string[], compareLines: string[]): { lines: DiffLineRec[]; additions: number; deletions: number } {
  const n = baseLines.length;
  const m = compareLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        baseLines[i] === compareLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: DiffLineRec[] = [];
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

function diffFiles(baseFiles: FileRec[], compareFiles: FileRec[]): (ChangeRec & { lines: DiffLineRec[] })[] {
  const baseMap = new Map(baseFiles.map((file) => [file.path, file]));
  const compareMap = new Map(compareFiles.map((file) => [file.path, file]));
  const paths = new Set([...baseMap.keys(), ...compareMap.keys()]);
  const out: (ChangeRec & { lines: DiffLineRec[] })[] = [];
  for (const path of [...paths].sort()) {
    const base = baseMap.get(path);
    const compare = compareMap.get(path);
    const diff = lineDiff(splitLines(base?.content ?? ""), splitLines(compare?.content ?? ""));
    const status = !base ? "added" : !compare ? "deleted" : "modified";
    if (status === "modified" && diff.additions === 0 && diff.deletions === 0) continue;
    out.push({ path, status, additions: diff.additions, deletions: diff.deletions, lines: diff.lines });
  }
  return out;
}

function snapshot(repo: RepoRec, branchName: string): FileRec[] {
  const branch = repo.branches.find((candidate) => candidate.name === branchName);
  if (!branch || !branch.commitId) return [];
  const commit = repo.commits.find((candidate) => candidate.id === branch.commitId);
  return commit ? commit.files : [];
}

function branchIds(repo: RepoRec, branchName: string): string[] {
  const branch = repo.branches.find((candidate) => candidate.name === branchName);
  if (!branch || !branch.commitId) return [];
  const ids: string[] = [];
  let cursor: string | null = branch.commitId;
  while (cursor) {
    const commit = repo.commits.find((candidate) => candidate.id === cursor);
    if (!commit) break;
    ids.push(commit.id);
    cursor = commit.parentId;
  }
  return ids;
}

function commitPayload(repo: RepoRec, id: string) {
  const commit = repo.commits.find((candidate) => candidate.id === id);
  if (!commit) return null;
  return {
    id: commit.id,
    shortId: shortId(commit.id),
    parentId: commit.parentId,
    authorAccountId: commit.authorAccountId,
    authorName: commit.authorName,
    message: commit.message,
    createdAt: commit.createdAt,
    changes: commit.changes,
  };
}

function history(repo: RepoRec, branch: string | null, path: string | null) {
  const ids = branch ? branchIds(repo, branch) : repo.commits.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((c) => c.id);
  const commits = ids.map((id) => commitPayload(repo, id)).filter(Boolean);
  if (!path) return commits;
  return commits.filter((commit) => commit!.changes.some((change) => change.path === path));
}

function repoDetail(repo: RepoRec, viewer: { username: string } | null, branch: string | null) {
  const effectiveRole =
    viewer?.username === "alice-dev"
      ? "admin"
      : viewer?.username === "bob-reviewer"
        ? null
        : null;
  const currentBranch = branch ?? repo.defaultBranch;
  return {
    ownerType: repo.ownerType,
    ownerName: repo.ownerName,
    name: repo.name,
    description: repo.description,
    visibility: repo.visibility,
    defaultBranch: repo.defaultBranch,
    updatedAt: repo.updatedAt,
    currentRole: effectiveRole,
    files: snapshot(repo, currentBranch),
    branches: repo.branches.map((b) => ({ name: b.name, protected: b.protected })),
    currentBranch,
    commitCount: branchIds(repo, currentBranch).length,
    source: null,
  };
}

function createCommit(repo: RepoRec, input: { branch: string; path: string; content: string; message: string }): { ok: true; commit: CommitRec } | { ok: false; errors: Record<string, string> } {
  const branch = repo.branches.find((candidate) => candidate.name === input.branch);
  if (!branch) return { ok: false, errors: { branch: "Branch not found" } };
  if (branch.protected) return { ok: false, errors: { branch: "Branch is protected" } };
  const errors: Record<string, string> = {};
  const filePath = input.path;
  const message = input.message.trim();
  const pathValid =
    filePath.length > 0 && !filePath.startsWith("/") && !filePath.endsWith("/") &&
    !filePath.split("/").some((segment) => segment === "" || segment === "..");
  if (!pathValid) {
    errors.path = "Invalid file path";
  } else {
    const existing = snapshot(repo, branch.name);
    const conflict =
      existing.some((file) => file.path === filePath) ||
      existing.some((file) => file.path.startsWith(`${filePath}/`)) ||
      filePath.split("/").slice(0, -1).some((_, index) =>
        existing.some((file) => file.path === filePath.split("/").slice(0, index + 1).join("/")),
      );
    if (conflict) errors.path = "File already exists at this path";
  }
  if (message.length === 0) errors.message = "Commit message is required";
  else if (message.length > 72) errors.message = "Commit message must be 1-72 characters";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parent = branch.commitId ? repo.commits.find((candidate) => candidate.id === branch.commitId) ?? null : null;
  const files = [
    ...(parent ? parent.files : []).filter((file) => file.path !== filePath),
    { path: filePath, content: input.content },
  ];
  const changes = diffFiles(parent ? parent.files : [], files).map(({ path, status, additions, deletions }) => ({
    path,
    status,
    additions,
    deletions,
  }));
  const commit: CommitRec = {
    id: `commit_${Math.random().toString(36).slice(2, 10)}`,
    parentId: parent ? parent.id : null,
    authorAccountId: null,
    authorName: "alice-dev",
    message,
    createdAt: new Date().toISOString(),
    changes,
    files,
  };
  repo.commits.push(commit);
  branch.commitId = commit.id;
  repo.updatedAt = commit.createdAt;
  return { ok: true, commit };
}

function vcsFetchHandler(repos: RepoRec[], options: { initialSession?: { username: string; email: string } | null } = {}) {
  let viewer: { username: string; email: string } | null = options.initialSession ?? null;
  return (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    if (path === "/api/sessions/current") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      return jsonResponse(200, { account: viewer });
    }
    if (path === "/api/sessions" && method === "POST") {
      const body = JSON.parse(String(init.body)) as { identifier: string; password: string };
      if (
        (body.identifier === "alice-dev" || body.identifier === ALICE.email) &&
        body.password === "Valid-password-123!"
      ) {
        viewer = ALICE;
        return jsonResponse(201, { account: ALICE });
      }
      return jsonResponse(401, { error: "Invalid credentials" });
    }
    const url = new URL(path, "http://local");
    const route = url.pathname;
    const repo = repos.find((candidate) => candidate.name === "acme-docs" && candidate.ownerType === "account");
    if (!repo) return jsonResponse(404, { error: "Not found" });

    const repoMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs$/);
    if (repoMatch && method === "GET") {
      return jsonResponse(200, { repository: repoDetail(repo, viewer, url.searchParams.get("branch")) });
    }
    const commitsMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/commits$/);
    if (commitsMatch && method === "GET") {
      const branch = url.searchParams.get("branch");
      const pathFilter = url.searchParams.get("path");
      return jsonResponse(200, {
        commits: history(repo, branch, pathFilter),
        branch: branch ?? repo.defaultBranch,
      });
    }
    const commitMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/commits\/([^/]+)$/);
    if (commitMatch && method === "GET") {
      const id = decodeURIComponent(commitMatch[1]);
      const commit = repo.commits.find((candidate) => candidate.id === id);
      if (!commit) return jsonResponse(404, { error: "Not found" });
      const parent = commit.parentId
        ? repo.commits.find((candidate) => candidate.id === commit.parentId) ?? null
        : null;
      return jsonResponse(200, {
        commit: commitPayload(repo, commit.id),
        base: parent ? { id: parent.id, shortId: shortId(parent.id) } : null,
        files: diffFiles(parent ? parent.files : [], commit.files),
      });
    }
    const compareMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/compare$/);
    if (compareMatch && method === "GET") {
      const base = repo.commits.find((candidate) => candidate.id === url.searchParams.get("base"));
      const compare = repo.commits.find((candidate) => candidate.id === url.searchParams.get("compare"));
      if (!base || !compare) return jsonResponse(404, { error: "Not found" });
      const pathFilter = url.searchParams.get("path");
      const files = diffFiles(base.files, compare.files);
      return jsonResponse(200, {
        base: { id: base.id, shortId: shortId(base.id) },
        compare: { id: compare.id, shortId: shortId(compare.id) },
        files: pathFilter ? files.filter((file) => file.path === pathFilter) : files,
      });
    }
    const filesMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/files$/);
    if (filesMatch && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      if (viewer.username !== "alice-dev") return jsonResponse(403, { error: "Access denied" });
      const body = JSON.parse(String(init.body)) as { branch: string; path: string; content: string; message: string };
      const outcome = createCommit(repo, body);
      if (!outcome.ok) return jsonResponse(400, { errors: outcome.errors });
      return jsonResponse(201, { repository: repoDetail(repo, viewer, body.branch) });
    }
    return jsonResponse(404, { error: "Not found" });
  };
}

function stubFetch(handler: (path: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : new URL(String(input)).pathname;
      return handler(path, init ?? {});
    }),
  );
}

beforeEach(() => {
  window.location.hash = "#/";
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("REQ-4-1 browse repository files and directories", () => {
  it("a visitor drills into a nested directory, opens the text file, returns via breadcrumbs, and switches branches", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    // Root file list: files and directories with their exact names.
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "guide.md" })).toBeTruthy();
    const docsLink = screen.getByRole("link", { name: "docs" });
    expect(screen.getByRole("link", { name: "src" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();

    // Clicking the nested-directory name opens its page with breadcrumbs.
    await user.click(docsLink);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "root" })).toBeTruthy();
    expect(screen.getByText("docs", { selector: "[aria-current=page]" })).toBeTruthy();
    const overviewLink = screen.getByRole("link", { name: "overview.md" });
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();

    // Clicking the text-file name opens the saved text as a complete value.
    await user.click(overviewLink);
    expect(await screen.findByRole("heading", { name: "docs/overview.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(screen.getByText(/Guides and reference material for the Acme Docs platform/)).toBeTruthy();

    // The breadcrumbs return to the parent directory.
    await user.click(screen.getByRole("link", { name: "docs" }));
    expect(await screen.findByRole("link", { name: "overview.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "root" })).toBeTruthy();

    // Reloading the file page retains the same branch, path, and content.
    window.location.hash = "#/u/alice-dev/repos/acme-docs/files/docs/overview.md?branch=main";
    expect(await screen.findByRole("heading", { name: "docs/overview.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(screen.getByText(/Guides and reference material for the Acme Docs platform/)).toBeTruthy();

    // Switching to feature-search hides the file that is absent there.
    await user.click(screen.getByRole("button", { name: "Branch main" }));
    await user.click(await screen.findByRole("option", { name: "feature-search" }));
    expect(await screen.findByText("File not found.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    expect(screen.queryByText(/Guides and reference material/)).toBeNull();
  });

  it("the feature-search branch shows its own files and main-only.md is absent from main", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs?branch=feature-search";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(screen.getByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "main-only.md" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "docs" })).toBeNull();
  });
});

describe("REQ-4-2-1 view repository commit history", () => {
  it("branch history shows records newest first with hash, message, author, and an ago timestamp", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    // The commit-count link above the file list opens the branch history.
    const commitsLink = screen.getByRole("link", { name: "Commits" });
    expect(commitsLink.textContent).toContain("2");
    await user.click(commitsLink);

    expect(await screen.findByRole("heading", { name: "Commits on main" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    const messages = items.map((item) => item.textContent ?? "");
    expect(messages[0]).toContain("Document search flow");
    expect(messages[1]).toContain("Initial commit");
    expect(messages[0]).toContain("alice-dev");
    expect(messages[0]).toContain("ago");
    const hashes = screen.getAllByRole("link", { name: /^[a-f0-9]{8}$/ });
    expect(hashes.length).toBe(2);

    // Clicking a short hash opens the detail page with parent and changed files.
    await user.click(hashes[0]);
    expect(await screen.findByRole("heading", { name: "Document search flow" })).toBeTruthy();
    expect(screen.getByText(/Commit bbbbbbbb/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "aaaaaaaa" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Changed files" })).toBeTruthy();
    expect(screen.getAllByText("src/search.ts").length).toBeGreaterThan(0);

    // Refreshing the history page keeps the order and content.
    window.location.hash = "#/u/alice-dev/repos/acme-docs/commits?branch=main";
    expect(await screen.findByRole("heading", { name: "Commits on main" })).toBeTruthy();
    const refreshed = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(refreshed[0]).toContain("Document search flow");
    expect(refreshed[1]).toContain("Initial commit");
  });

  it("file-scoped history shows only commits that modified that file", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/commits?branch=main&path=docs/overview.md";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Commits for docs/overview.md" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain("Document search flow");
    expect(items[0].textContent).not.toContain("Initial commit");
  });
});

describe("REQ-4-2-2 inspect commit and revision differences", () => {
  it("a visitor opens a seeded commit entry and sees the changed-file path, summary, and line diff", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/commit/commit_bbbbbbbb";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Document search flow" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Changed files" })).toBeTruthy();
    const srcLink = screen.getByRole("link", { name: "src/search.ts" });
    expect(srcLink.textContent).toBe("src/search.ts");
    expect(screen.getAllByText("+5 −1").length).toBeGreaterThan(0);
    // Line-by-line additions and deletions are visible.
    expect(screen.getAllByTestId("diff-line").length).toBeGreaterThan(0);
    const addLines = screen
      .getAllByTestId("diff-line")
      .filter((element) => element.className.includes("diff-line--add"));
    expect(
      addLines.some((element) => element.textContent?.includes("return query.trim().toLowerCase()") ?? false),
    ).toBe(true);
  });

  it("the compare page selects base and compare, clicks Compare, and scopes to one file", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/compare";
    render(<App />);
    await screen.findByRole("heading", { name: "Compare revisions" });

    const baseSelect = screen.getByRole("combobox", { name: "Base" });
    const compareSelect = screen.getByRole("combobox", { name: "Compare" });
    await user.selectOptions(baseSelect, "commit_aaaaaaaa");
    await user.selectOptions(compareSelect, "commit_bbbbbbbb");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    expect(await screen.findByRole("heading", { name: "Comparing aaaaaaaa … bbbbbbbb" })).toBeTruthy();
    // Only changed files appear; unchanged files are absent.
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "docs/overview.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "guide.md" })).toBeNull();

    // Clicking a changed file navigates to that file's diff.
    await user.click(screen.getByRole("link", { name: "src/search.ts" }));
    expect(await screen.findByRole("heading", { name: "Comparing aaaaaaaa … bbbbbbbb" })).toBeTruthy();
    const diffSections = screen.getAllByLabelText(/Diff for /);
    expect(diffSections.length).toBe(1);
    expect(diffSections[0].getAttribute("aria-label")).toBe("Diff for src/search.ts");

    // The read-only comparison changes nothing.
    expect(repos[0].commits.length).toBe(3);
    expect(repos[0].branches.find((branch) => branch.name === "main")?.commitId).toBe("commit_bbbbbbbb");
  });
});

describe("REQ-4-4 manage repository files through the web interface", () => {
  it("alice creates docs/guide.md through Add file and the exact content and message persist", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    // The writable Code page exposes the unique Add file button and menu.
    await user.click(screen.getByRole("button", { name: "Add file" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create new file" }));

    expect(await screen.findByRole("heading", { name: "Create new file" })).toBeTruthy();
    await user.type(screen.getByLabelText("File name"), "docs/guide.md");
    await user.type(screen.getByLabelText("File contents"), "Step-by-step usage guide.\nSecond line.\n");
    await user.type(screen.getByLabelText("Commit message"), "Add docs/guide.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    // The new commit opens a view displaying the exact saved content.
    expect(await screen.findByRole("heading", { name: "docs/guide.md" })).toBeTruthy();
    expect(screen.getByText(/Step-by-step usage guide\./)).toBeTruthy();
    expect(screen.getByText(/Second line\./)).toBeTruthy();

    // Its Commits link opens history displaying the exact submitted message.
    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("heading", { name: "Commits for docs/guide.md" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Add docs/guide.md");

    // The branch head moved to the new commit and the file list shows it.
    expect(repos[0].branches.find((branch) => branch.name === "main")?.commitId).not.toBe("commit_bbbbbbbb");
    const head = repos[0].commits.find((commit) => commit.id === repos[0].branches.find((branch) => branch.name === "main")?.commitId);
    expect(head?.parentId).toBe("commit_bbbbbbbb");
    expect(head?.changes.some((change) => change.path === "docs/guide.md")).toBe(true);
  });

  it("an invalid path and missing commit message report the exact reasons and change nothing", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/new?branch=main";
    render(<App />);
    await screen.findByRole("heading", { name: "Create new file" });

    await user.type(screen.getByLabelText("File name"), "../invalid.md");
    await user.type(screen.getByLabelText("File contents"), "must not be saved");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Invalid file path")).toBeTruthy();
    expect(await screen.findByText("Commit message is required")).toBeTruthy();
    expect(window.location.hash).toBe("#/u/alice-dev/repos/acme-docs/new?branch=main");
    expect(repos[0].commits.length).toBe(3);
    expect(repos[0].branches.find((branch) => branch.name === "main")?.commitId).toBe("commit_bbbbbbbb");
  });

  it("a conflicting path and a protected branch are rejected with their reasons", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();

    // Conflict with an existing file.
    window.location.hash = "#/u/alice-dev/repos/acme-docs/new?branch=main";
    render(<App />);
    await screen.findByRole("heading", { name: "Create new file" });
    await user.type(screen.getByLabelText("File name"), "README.md");
    await user.type(screen.getByLabelText("File contents"), "x");
    await user.type(screen.getByLabelText("Commit message"), "Overwrite");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    expect(await screen.findByText("File already exists at this path")).toBeTruthy();
    expect(repos[0].commits.length).toBe(3);

    // Protected branch rejection keeps files, head, and history unchanged.
    cleanup();
    stubFetch(vcsFetchHandler(repos, { initialSession: ALICE }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/new?branch=feature-search";
    render(<App />);
    await screen.findByRole("heading", { name: "Create new file" });
    await user.type(screen.getByLabelText("File name"), "docs/guide.md");
    await user.type(screen.getByLabelText("File contents"), "x");
    await user.type(screen.getByLabelText("Commit message"), "Add file");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    expect(await screen.findByText("Branch is protected")).toBeTruthy();
    expect(repos[0].commits.length).toBe(3);
    expect(repos[0].branches.find((branch) => branch.name === "feature-search")?.commitId).toBe("commit_ffffffff");
  });

  it("visitors and read-only accounts cannot reach the editor or Add file", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(vcsFetchHandler(repos, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();

    cleanup();
    stubFetch(vcsFetchHandler(repos, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/new?branch=main";
    render(<App />);
    expect(await screen.findByText("Sign in to edit files.")).toBeTruthy();

    cleanup();
    stubFetch(vcsFetchHandler(repos, { initialSession: BOB }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/new?branch=main";
    render(<App />);
    expect(await screen.findByText("You need write permission to edit files.")).toBeTruthy();
    await waitFor(() => expect(repos[0].commits.length).toBe(3));
  });
});
