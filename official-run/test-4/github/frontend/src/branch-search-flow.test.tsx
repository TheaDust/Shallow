import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fileLanguage } from "./lib/repo-api";

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

interface CommitRec {
  id: string;
  parentId: string | null;
  authorName: string;
  message: string;
  createdAt: string;
  files: FileRec[];
}

interface BranchRec {
  name: string;
  commitId: string | null;
  protected: boolean;
}

interface RepoRec {
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
  branches: BranchRec[];
  commits: CommitRec[];
}

const ALICE = { username: "alice-dev", email: "alice.dev@example.test" };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const README_V1 =
  "# Acme Docs\n\nPublic documentation for the Acme Demo platform.\n\nThe search flow is documented in this repository.\n";
const README_V2 =
  "# Acme Docs\n\nPublic documentation for the Acme Demo platform.\n\nThe search flow is documented in this repository.\n\n## Search flow\n\nEnter a keyword in the repository search box and press Enter to see matching files.\n";
const FEATURE_README =
  "# Acme Docs\n\nFeature search documentation.\n\nThe search flow is documented in this repository.\n\n## Feature search\n\nUse the feature-search branch to try search across branches.\n";
const GUIDE = "# Guide\n\nHow to use the Acme Demo platform.\n";
const SEARCH_V1 = "export function search(query: string) {\n  return query.trim();\n}\n";
const SEARCH_V2 =
  "export function search(query: string) {\n  return query.trim().toLowerCase();\n}\n// search flow scan highlights matching lines.\nexport function highlight(text: string): string {\n  return text;\n}\n";
const OVERVIEW = "# Overview\n\nGuides and reference material for the Acme Docs platform.\n";
const MAIN_ONLY = "# Main-only\n\nThis file exists only on the feature-search branch.\n";

function seedAcmeDocs(): RepoRec {
  const commitA: CommitRec = {
    id: "commit_aaaaaaaa",
    parentId: null,
    authorName: "alice-dev",
    message: "Initial commit",
    createdAt: daysAgo(5),
    files: [
      { path: "README.md", content: README_V1 },
      { path: "guide.md", content: GUIDE },
      { path: "src/search.ts", content: SEARCH_V1 },
    ],
  };
  const commitB: CommitRec = {
    id: "commit_bbbbbbbb",
    parentId: commitA.id,
    authorName: "alice-dev",
    message: "Document search flow",
    createdAt: daysAgo(2),
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
    authorName: "alice-dev",
    message: "Add feature search docs",
    createdAt: daysAgo(3),
    files: [
      { path: "README.md", content: FEATURE_README },
      { path: "guide.md", content: GUIDE },
      { path: "src/search.ts", content: SEARCH_V1 },
      { path: "main-only.md", content: MAIN_ONLY },
    ],
  };
  return {
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
  };
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

function snapshot(repo: RepoRec, branchName: string): FileRec[] {
  const branch = repo.branches.find((candidate) => candidate.name === branchName);
  if (!branch || !branch.commitId) return [];
  const commit = repo.commits.find((candidate) => candidate.id === branch.commitId);
  return commit ? commit.files : [];
}

function repoDetail(repo: RepoRec, viewer: { username: string } | null, branch: string | null) {
  const current = branch ?? repo.defaultBranch;
  return {
    ownerType: "account",
    ownerName: "alice-dev",
    name: repo.name,
    description: repo.description,
    visibility: repo.visibility,
    defaultBranch: repo.defaultBranch,
    updatedAt: repo.updatedAt,
    currentRole: viewer?.username === "alice-dev" ? "admin" : null,
    files: snapshot(repo, current),
    branches: repo.branches.map((b) => ({ name: b.name, protected: b.protected })),
    currentBranch: current,
    commitCount: branchIds(repo, current).length,
    source: null,
  };
}

function searchResults(repo: RepoRec, branchName: string, query: string, path: string | null, language: string | null) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const out: { path: string; branch: string; matches: { lineNumber: number; text: string }[] }[] = [];
  for (const file of snapshot(repo, branchName)) {
    if (path && !file.path.startsWith(path)) continue;
    if (language && fileLanguage(file.path) !== language) continue;
    const lines = file.content.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const matches: { lineNumber: number; text: string }[] = [];
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(term)) {
        matches.push({ lineNumber: index + 1, text: line });
      }
    });
    if (matches.length > 0) out.push({ path: file.path, branch: branchName, matches });
  }
  return out;
}

function createBranchInRepo(repo: RepoRec, input: { name: string; baseBranch?: string }) {
  const name = input.name;
  const valid =
    name.length > 0 &&
    name.length <= 255 &&
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.includes("..") &&
    !name.includes("//");
  if (!valid) return { ok: false as const, errors: { name: "Branch name is invalid" } };
  if (repo.branches.some((branch) => branch.name === name)) {
    return { ok: false as const, errors: { name: "Branch already exists" } };
  }
  const base = repo.branches.find((branch) => branch.name === (input.baseBranch ?? repo.defaultBranch));
  if (!base) return { ok: false as const, errors: { branch: "Branch not found" } };
  repo.branches.push({
    name,
    commitId: base.commitId,
    protected: false,
  });
  return { ok: true as const };
}

function fetchHandler(repos: RepoRec[], options: { initialSession?: { username: string; email: string } | null } = {}) {
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
    const found = repos.find((candidate) => candidate.name === "acme-docs");
    if (!found) return jsonResponse(404, { error: "Not found" });
    const repo = found;

    const detailMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs$/);
    if (detailMatch && method === "GET") {
      return jsonResponse(200, { repository: repoDetail(repo, viewer, url.searchParams.get("branch")) });
    }
    const searchMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/search$/);
    if (searchMatch && method === "GET") {
      const branch = url.searchParams.get("branch") ?? repo.defaultBranch;
      return jsonResponse(200, {
        query: url.searchParams.get("q") ?? "",
        branch,
        results: searchResults(
          repo,
          branch,
          url.searchParams.get("q") ?? "",
          url.searchParams.get("path"),
          url.searchParams.get("language"),
        ),
      });
    }
    const branchesMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/branches$/);
    if (branchesMatch && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      if (viewer.username !== "alice-dev") return jsonResponse(403, { error: "Access denied" });
      const body = JSON.parse(String(init.body)) as { name: string; baseBranch?: string };
      const outcome = createBranchInRepo(repo, body);
      if (!outcome.ok) return jsonResponse(400, { errors: outcome.errors });
      return jsonResponse(201, { repository: repoDetail(repo, viewer, body.name) });
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

describe("REQ-4-2-3 search code within a repository", () => {
  it("a visitor searches from the Code page, filters by src/, opens the match, and sees no private content", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(fetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    // Enter the keyword in the Search box at the top of the repository page.
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "search flow");
    await user.keyboard("{Enter}");

    // The results page keeps the repository heading, one Search box, and a
    // unique Code results-type link distinguishable from repo navigation.
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("search flow");
    expect(screen.getAllByRole("link", { name: "Code" }).length).toBe(1);
    await user.click(screen.getByRole("link", { name: "Code" }));

    // Two files on main match; snippets, paths, and branch context are shown.
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "search.ts" })).toBeTruthy();
    expect(screen.getByText("src/search.ts")).toBeTruthy();
    expect(screen.getAllByText(/search flow/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Branch main").length).toBeGreaterThan(0);

    // Path filter to src/ narrows the results to that directory.
    await user.type(screen.getByRole("textbox", { name: "Path" }), "src/");
    expect(await screen.findByRole("link", { name: "search.ts" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();

    // Clicking the matching file opens the file page with its content.
    await user.click(screen.getByRole("link", { name: "search.ts" }));
    expect(await screen.findByRole("heading", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByText(/search flow scan highlights matching lines/)).toBeTruthy();

    // Clearing the path filter shows the other matching file again; the
    // read-only search created no commits and changed nothing.
    window.location.hash = "#/u/alice-dev/repos/acme-docs/search?q=search+flow";
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Path" }), "src/");
    expect(await screen.findByRole("link", { name: "search.ts" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
    await user.clear(screen.getByRole("textbox", { name: "Path" }));
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "search.ts" })).toBeTruthy();

    // No private-repository content leaks into the current-repository search.
    expect(screen.queryByText(/Secret Research/)).toBeNull();
    expect(screen.queryByText("notes.md")).toBeNull();
    expect(repos[0].commits.length).toBe(3);
    expect(repos[0].branches.map((branch) => branch.name)).toEqual(["main", "feature-search"]);
  });

  it("an absent query shows No code results and keeps the query and filters unchanged", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(fetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/search?q=no-such-token";
    render(<App />);

    expect(await screen.findByText("No code results")).toBeTruthy();
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("no-such-token");
    expect(screen.queryByRole("link", { name: /README|search\.ts/ })).toBeNull();

    // Filters are preserved when a new query also has no matches.
    await user.type(screen.getByRole("textbox", { name: "Path" }), "src/");
    expect(await screen.findByText("No code results")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Path" }) as HTMLInputElement).value).toBe("src/");
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "no-such-token");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("No code results")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Path" }) as HTMLInputElement).value).toBe("src/");

    // Returning to the repository and repeating the search keeps the empty state.
    await user.click(screen.getByRole("link", { name: "acme-docs" }));
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "no-such-token");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("No code results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /README|search\.ts/ })).toBeNull();
  });
});

describe("REQ-4-3-1 list and switch repository branches", () => {
  it("a visitor filters the selector, switches to feature-search, and back to main", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(fetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();

    // The selector lists both branches and marks the current one.
    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const findBranch = await screen.findByRole("textbox", { name: "Find branch" });
    const mainOption = screen.getByRole("option", { name: "main" });
    expect(mainOption.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();

    // Typing filters the options live.
    await user.type(findBranch, "feature-search");
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();

    // Selecting the target switches page, selector, and file list.
    await user.click(screen.getByRole("option", { name: "feature-search" }));
    expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "main-only.md" })).toBeTruthy();

    // The known file displays the content from that branch.
    await user.click(screen.getByRole("link", { name: "README.md" }));
    expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText(/Feature search documentation/)).toBeTruthy();

    // Selecting main again restores its file content; nothing is created.
    window.location.hash = "#/u/alice-dev/repos/acme-docs?branch=feature-search";
    expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Branch feature-search" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "main");
    await user.click(screen.getByRole("option", { name: "main" }));
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull();
    expect(screen.getByRole("link", { name: "docs" })).toBeTruthy();
    expect(repos[0].branches.map((branch) => branch.name)).toEqual(["main", "feature-search"]);
  });

  it("an unmatched branch query shows No matching branch and keeps the active branch after close and reload", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(fetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);
    await screen.findByRole("button", { name: "Branch main" });

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "no-such-branch");
    expect(await screen.findByText("No matching branch")).toBeTruthy();

    // Escape closes the selector; the original active branch is retained.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();

    // Reload keeps the same active branch.
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(repos[0].branches.map((branch) => branch.name)).toEqual(["main", "feature-search"]);
  });
});

describe("REQ-4-3-2 create a branch from an existing revision", () => {
  it("a signed-in writer creates feature/api-v2 from the current head and it survives reload", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(fetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();

    // Sign in through the home-page controls.
    render(<App />);
    await screen.findByRole("heading", { name: "GitHub Collaboration Platform" });
    await user.click(screen.getByRole("link", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("link", { name: "alice-dev" })).toBeTruthy();

    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();

    // Typing a valid unused name shows the create option with the base.
    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const findBranch = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(findBranch, "feature/api-v2");
    const createOption = await screen.findByRole("option", { name: "Create branch: feature/api-v2" });
    expect(createOption.textContent).toContain("main");

    // Selecting it creates the branch and switches the browsing context.
    await user.click(createOption);
    expect(await screen.findByRole("button", { name: "Branch feature/api-v2" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull();
    expect(repos[0].branches.some((branch) => branch.name === "feature/api-v2")).toBe(true);

    // The selector lists all branches, including the new one.
    await user.click(screen.getByRole("button", { name: "Branch feature/api-v2" }));
    expect(await screen.findByRole("textbox", { name: "Find branch" })).toBeTruthy();
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["main", "feature-search", "feature/api-v2"]),
    );
    await user.keyboard("{Escape}");

    // Reload keeps the new branch selected.
    cleanup();
    stubFetch(fetchHandler(repos, { initialSession: ALICE }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs?branch=feature/api-v2";
    render(<App />);
    expect(await screen.findByRole("button", { name: "Branch feature/api-v2" })).toBeTruthy();

    // Invalid names show Invalid branch and cannot create a reference.
    await user.click(screen.getByRole("button", { name: "Branch feature/api-v2" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "invalid..branch");
    expect(await screen.findByText("Invalid branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create branch/ })).toBeNull();

    // A duplicate name lists the existing branch and offers no creation.
    await user.clear(screen.getByRole("textbox", { name: "Find branch" }));
    await user.type(screen.getByRole("textbox", { name: "Find branch" }), "main");
    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create branch/ })).toBeNull();
    await user.keyboard("{Escape}");

    expect(repos[0].branches.map((branch) => branch.name)).toEqual([
      "main",
      "feature-search",
      "feature/api-v2",
    ]);
    expect(repos[0].commits.length).toBe(3);
  });

  it("visitors and read-only accounts get no create option and no branch is created", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(fetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);
    await screen.findByRole("button", { name: "Branch main" });

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "visitor-branch");
    expect(await screen.findByText("No matching branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create branch/ })).toBeNull();
    await user.keyboard("{Escape}");

    expect(repos[0].branches.map((branch) => branch.name)).toEqual(["main", "feature-search"]);
    expect(repos[0].commits.length).toBe(3);
  });
});
