import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

/**
 * In-memory stand-in for the repository code API (REQ-4). The data mirrors the
 * seeded shape: `main` holds a nested directory with the text file
 * `docs/README.md` inside it, the second branch `feature-search` has a different
 * snapshot, the newest commit of `main` changed only `src/`, and `search flow`
 * occurs in the root README and in `src/search.ts`.
 */
const README_INITIAL = "# acme-docs\n\nDocumentation and guides for the Acme platform.\n";
const README_CURRENT =
  "# acme-docs\n\nDocumentation and guides for the Acme platform.\n\n## Search flow\n\nThe repository code search follows the search flow described below.\n";
const README_FEATURE = "# acme-docs\n\nOnboarding notes for new contributors.\n";
const DOCS_README =
  "# Getting started\n\nInstall the Acme CLI, then run the setup command to create your first workspace.\n";
const SEARCH_TS =
  "// Search flow helpers used by the repository code search page.\nexport function searchFlow(query: string, lines: string[]): string[] {\n  return lines.filter((line) => line.includes(query));\n}\n";
const SEARCH_TS_PLUS =
  "// Search flow helpers used by the repository code search page.\nexport function searchFlow(query: string, lines: string[]): string[] {\n  return lines.filter((line) => line.includes(query));\n}\n\nexport function countSearchFlow(lines: string[]): number {\n  return lines.filter((line) => line.includes(\"search flow\")).length;\n}\n";
const SEARCH_LOADER_TS =
  '// Loads the helpers used by the repository code search page.\nimport { searchFlow } from "./search";\n\nexport function loadSearch(query: string, lines: string[]): string[] {\n  return searchFlow(query, lines);\n}\n';
const DOCS_PATH = "docs/README.md";

interface StubCommit {
  id: string;
  shortId: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  changedFiles: string[];
}

const INITIAL_COMMIT: StubCommit = {
  id: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  shortId: "1a2b3c4",
  message: "Initial commit",
  author: "alice-dev",
  createdAt: "2024-01-05T09:00:00.000Z",
  parentId: null,
  changedFiles: ["README.md"],
};
const DOCUMENT_SEARCH_COMMIT: StubCommit = {
  id: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
  shortId: "9f8e7d6",
  message: "Document search flow",
  author: "alice-dev",
  createdAt: "2024-02-12T09:30:00.000Z",
  parentId: INITIAL_COMMIT.id,
  changedFiles: ["README.md", DOCS_PATH, "src/search.ts"],
};
const SEARCH_LOADER_COMMIT: StubCommit = {
  id: "3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09",
  shortId: "3c2b1a0",
  message: "Add search loader",
  author: "alice-dev",
  createdAt: "2024-02-20T15:45:00.000Z",
  parentId: DOCUMENT_SEARCH_COMMIT.id,
  changedFiles: ["src/loader.ts", "src/search.ts"],
};
const FEATURE_COMMIT: StubCommit = {
  id: "5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c4b3a29",
  shortId: "5d4c3b2",
  message: "Draft onboarding notes",
  author: "alice-dev",
  createdAt: "2024-02-18T11:00:00.000Z",
  parentId: INITIAL_COMMIT.id,
  changedFiles: ["README.md"],
};

const BRANCHES: Record<string, {
  files: Record<string, string>;
  entries: Record<string, Array<{ type: "file" | "dir"; name: string; path: string }>>;
  commits: StubCommit[];
}> = {
  main: {
    files: {
      "README.md": README_CURRENT,
      [DOCS_PATH]: DOCS_README,
      "src/search.ts": SEARCH_TS_PLUS,
      "src/loader.ts": SEARCH_LOADER_TS,
    },
    entries: {
      "": [
        { type: "dir", name: "docs", path: "docs" },
        { type: "dir", name: "src", path: "src" },
        { type: "file", name: "README.md", path: "README.md" },
      ],
      docs: [{ type: "file", name: "README.md", path: DOCS_PATH }],
      src: [
        { type: "file", name: "loader.ts", path: "src/loader.ts" },
        { type: "file", name: "search.ts", path: "src/search.ts" },
      ],
    },
    commits: [SEARCH_LOADER_COMMIT, DOCUMENT_SEARCH_COMMIT, INITIAL_COMMIT],
  },
  "feature-search": {
    files: { "README.md": README_FEATURE },
    entries: { "": [{ type: "file", name: "README.md", path: "README.md" }] },
    commits: [FEATURE_COMMIT, INITIAL_COMMIT],
  },
};

const SUMMARIES = [
  {
    id: "repo-alice-dev-acme-docs",
    name: "acme-docs",
    fullName: "alice-dev/acme-docs",
    owner: { type: "user", login: "alice-dev" },
    visibility: "public",
    description: "Documentation and guides for the Acme platform.",
    defaultBranch: "main",
    updatedAt: "2024-03-02T10:00:00.000Z",
  },
];

function context(branch: string) {
  return {
    ...SUMMARIES[0],
    branch,
    branches: [
      { name: "main", headCommitId: SEARCH_LOADER_COMMIT.id },
      { name: "feature-search", headCommitId: FEATURE_COMMIT.id },
    ],
    permissions: { role: null, canAdminister: false },
  };
}

function commitReference(commit: StubCommit | null) {
  if (!commit) return null;
  return {
    id: commit.id,
    shortId: commit.shortId,
    message: commit.message,
    author: commit.author,
    createdAt: commit.createdAt,
  };
}

function changedFilesOf(paths: string[]) {
  return paths.map((path) => {
    const before = path === "README.md" ? README_INITIAL : path === "src/search.ts" ? SEARCH_TS : "";
    const after = BRANCHES.main.files[path] ?? "";
    const diff = [
      ...before
        .split("\n")
        .filter(Boolean)
        .map((text, index) => ({ kind: "context", text, oldLine: index + 1, newLine: index + 1 })),
      ...after
        .split("\n")
        .filter(Boolean)
        .slice(before ? 3 : 0)
        .map((text, index) => ({ kind: "add", text, oldLine: null, newLine: index + 1 })),
    ];
    return {
      path,
      name: path.split("/").pop(),
      changeType: before ? "modified" : "added",
      additions: diff.filter((row) => row.kind === "add").length,
      deletions: 0,
      diff,
    };
  });
}

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
  };
}

function installFetch() {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const branch = url.searchParams.get("branch") || "main";
    const requestedPath = url.searchParams.get("path") ?? "";

    if (path === "/api/session") return jsonResponse(200, { account: null });

    if (path === "/api/search") {
      const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const type = url.searchParams.get("type") ?? "repositories";
      const repositoryScope = url.searchParams.get("repo") ?? "";
      if (type === "code") {
        const found = Object.entries(BRANCHES.main.files)
          .filter(([, content]) => content.toLowerCase().includes(query))
          .map(([filePath, content]) => ({
            path: filePath,
            name: filePath.split("/").pop(),
            branch: "main",
            line: 1,
            snippet:
              content
                .split("\n")
                .find((line) => line.toLowerCase().includes(query))
                ?.trim() ?? "",
            matches: 1,
            repository: { owner: "alice-dev", name: "acme-docs", fullName: "alice-dev/acme-docs" },
          }));
        return jsonResponse(200, {
          query,
          type,
          repository: repositoryScope ? { ...SUMMARIES[0], branch: "main" } : null,
          results: query ? found : [],
        });
      }
      const repositories = SUMMARIES.filter((repository) =>
        repository.name.toLowerCase().includes(query),
      ).map((repository) => ({ ...repository }));
      return jsonResponse(200, { query, type, repositories: query ? repositories : [] });
    }

    const fileMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/file$/);
    if (fileMatch) {
      const files = BRANCHES[branch]?.files ?? {};
      const content = files[requestedPath];
      if (content === undefined) {
        return jsonResponse(404, { error: "File not found", repository: context(branch) });
      }
      const commit = BRANCHES[branch].commits.find((candidate) =>
        candidate.changedFiles.includes(requestedPath),
      );
      return jsonResponse(200, {
        repository: context(branch),
        file: {
          path: requestedPath,
          name: requestedPath.split("/").pop(),
          branch,
          content,
          commit: commitReference(commit ?? null),
        },
      });
    }

    const commitMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/commits\/(.+)$/);
    if (commitMatch) {
      const commitId = decodeURIComponent(commitMatch[3]);
      const commit = BRANCHES.main.commits.find(
        (candidate) => candidate.id === commitId || candidate.shortId === commitId,
      );
      if (!commit) return jsonResponse(404, { error: "Not found" });
      const parent =
        BRANCHES.main.commits.find((candidate) => candidate.id === commit.parentId) ?? null;
      const requestedFile = url.searchParams.get("path") ?? "";
      const changed = changedFilesOf(
        requestedFile
          ? commit.changedFiles.filter((file) => file === requestedFile)
          : commit.changedFiles,
      );
      return jsonResponse(200, {
        repository: context("main"),
        commit: {
          ...commitReference(commit),
          parentId: commit.parentId,
          parent: commitReference(parent),
          base: parent
            ? { id: parent.id, shortId: parent.shortId, ref: parent.id, kind: "commit" }
            : { id: null, shortId: null, ref: "root", kind: "root" },
          compare: { id: commit.id, shortId: commit.shortId, ref: commit.id, kind: "commit" },
          changedFiles: changed,
          filesChanged: changed.length,
          additions: changed.reduce((total, file) => total + file.additions, 0),
          deletions: 0,
        },
      });
    }

    const commitsMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/commits$/);
    if (commitsMatch) {
      const scoped = requestedPath
        ? BRANCHES[branch].commits.filter((commit) => commit.changedFiles.includes(requestedPath))
        : BRANCHES[branch].commits;
      return jsonResponse(200, {
        repository: context(branch),
        branch,
        path: requestedPath,
        files: Object.keys(BRANCHES[branch].files),
        commits: scoped.map((commit) => ({ ...commit })),
      });
    }

    const compareMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/compare$/);
    if (compareMatch) {
      const base = url.searchParams.get("base") ?? "";
      const compare = url.searchParams.get("compare") ?? "";
      const baseCommit = BRANCHES.main.commits.find((commit) => commit.id === base) ?? null;
      const compareCommit = BRANCHES.main.commits.find((commit) => commit.id === compare) ?? null;
      if (!baseCommit || !compareCommit) return jsonResponse(404, { error: "Not found" });
      const changed = changedFilesOf(compareCommit.changedFiles);
      return jsonResponse(200, {
        repository: context("main"),
        base: { id: baseCommit.id, shortId: baseCommit.shortId, ref: baseCommit.id, kind: "commit" },
        compare: {
          id: compareCommit.id,
          shortId: compareCommit.shortId,
          ref: compareCommit.id,
          kind: "commit",
        },
        changedFiles: changed,
        filesChanged: changed.length,
        additions: changed.reduce((total, file) => total + file.additions, 0),
        deletions: 0,
      });
    }

    const overviewMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)$/);
    if (overviewMatch) {
      const files = BRANCHES[branch];
      if (!files) return jsonResponse(404, { error: "Not found" });
      const entries = files.entries[requestedPath];
      if (!entries) return jsonResponse(404, { error: "Not found" });
      return jsonResponse(200, {
        repository: {
          ...context(branch),
          path: requestedPath,
          entries,
          commits: files.commits.map((commit) => ({ ...commit })),
        },
      });
    }

    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browsing repository files and directories (REQ-4-1)", () => {
  it("opens a nested directory and the text file inside it, and returns to the parent", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs");

    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    // The branch selector, the history link and the root entries are on the Code page.
    const selector = screen.getByRole("button", { name: "Branch main" });
    expect(selector).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Commits" })).toHaveLength(1);
    expect(screen.getByText("Default branch:")).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "docs" }));

    // The directory page shows the branch, the breadcrumbs and its own entries.
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(within(breadcrumb).getByRole("link", { name: "docs" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "README.md" }));

    // The file page reads the stored content as one complete text value.
    expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
    const code = screen.getByText((_, element) => element?.tagName === "CODE");
    expect(code.textContent).toBe(DOCS_README);
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Commits" })).toBeTruthy();

    // The breadcrumbs return to the parent directory.
    await user.click(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", {
        name: "docs",
      }),
    );
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
  });

  it("shows the file as absent after switching to a branch without it", async () => {
    installFetch();
    open(`#/repos/alice-dev/acme-docs/blob/main/${DOCS_PATH}`);
    await screen.findByRole("heading", { name: "README.md" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Branch main" }));

    const find = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(find, "feature");

    expect(screen.queryByRole("option", { name: "main" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "feature-search" }));

    expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    expect(screen.queryByText(DOCS_README)).toBeNull();
    expect(screen.getByText(/does not exist on the/)).toBeTruthy();
    // The missing path is not offered as a link of the branch that lacks it.
    expect(screen.queryByRole("link", { name: DOCS_PATH })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", {
      name: "docs",
    })).toBeTruthy();
  });

  it("keeps an unmatched branch search on the current branch and offers No matching branch", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs/tree/main/docs");
    await screen.findByRole("link", { name: "README.md" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "no-such-branch");

    expect(screen.getByText("No matching branch")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
  });
});

describe("commit history and search (REQ-4-2)", () => {
  it("shows branch history newest first and scopes it to one file", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Commits" }));

    const items = await screen.findAllByRole("listitem");
    const messages = items
      .map((item) => item.querySelector(".commit-list__message")?.textContent ?? "")
      .filter(Boolean);
    expect(messages).toEqual(["Add search loader", "Document search flow", "Initial commit"]);
    expect(screen.getAllByText("alice-dev").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ago$/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "9f8e7d6" })).toHaveLength(1);

    // Selecting the file scope drops the commit that did not modify that file.
    await user.click(screen.getByRole("link", { name: "README.md" }));
    expect(await screen.findByText(/Commits that changed/)).toBeTruthy();
    const scopedMessages = screen
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".commit-list__message")?.textContent ?? "")
      .filter(Boolean);
    expect(scopedMessages).toEqual(["Document search flow", "Initial commit"]);
    expect(screen.queryByRole("link", { name: "Add search loader" })).toBeNull();
  });

  it("opens a commit entry with its parent, changed files and line diff", async () => {
    installFetch();
    open(`#/repos/alice-dev/acme-docs/commit/${DOCUMENT_SEARCH_COMMIT.shortId}`);

    expect(await screen.findByRole("heading", { name: "Document search flow" })).toBeTruthy();
    expect(screen.getByText("Changed files")).toBeTruthy();
    expect(screen.getByText(/Base:/)).toBeTruthy();
    expect(screen.getByText(/Compare:/)).toBeTruthy();
    const changed = screen.getByRole("link", { name: "src/search.ts" });
    expect(changed).toBeTruthy();
    expect(screen.getAllByText(/search flow/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: INITIAL_COMMIT.shortId })).toBeTruthy();

    const user = userEvent.setup();
    await user.click(changed);
    expect(await screen.findByText(/Diff for/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
  });

  it("compares a parent revision with the commit that follows it", async () => {
    installFetch();
    open(
      `#/repos/alice-dev/acme-docs/compare?base=${INITIAL_COMMIT.id}&compare=${DOCUMENT_SEARCH_COMMIT.id}`,
    );

    expect(await screen.findByText("Changed files")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Base" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Compare" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
  });

  it("reaches the comparison form from the history page", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs/commits/main");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Compare" }));

    expect(await screen.findByRole("heading", { name: "Compare changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Base" })).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox", { name: "Base" }), INITIAL_COMMIT.id);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Compare" }),
      DOCUMENT_SEARCH_COMMIT.id,
    );
    await user.click(screen.getByRole("button", { name: "Compare" }));

    expect(await screen.findByText("Changed files")).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
  });

  it("searches code inside the current repository and keeps the empty state", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs");
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    const user = userEvent.setup();
    // Typing in the repository searchbox keeps the repository scope.
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "search flow{Enter}");

    expect(await screen.findByRole("link", { name: "Code" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Code" }));

    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "search.ts" })).toBeTruthy();
    expect(screen.getByText("src/search.ts")).toBeTruthy();
    expect(screen.getAllByText(/alice-dev\/acme-docs/).length).toBeGreaterThan(0);

    // The path filter narrows the results to the src/ file.
    await user.type(screen.getByRole("textbox", { name: "Path" }), "src/");
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
    expect(screen.getByRole("link", { name: "search.ts" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "search.ts" }));
    expect(await screen.findByRole("heading", { name: "search.ts" })).toBeTruthy();
    const code = screen.getByText((_, element) => element?.tagName === "CODE");
    expect(code.textContent).toBe(SEARCH_TS_PLUS);

    // An absent query keeps the scope, the query and the empty state.
    cleanup();
    open("#/search?q=no-such-token&type=code&repo=alice-dev%2Facme-docs");
    expect(await screen.findByRole("heading", { name: "No code results" })).toBeTruthy();
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe(
      "no-such-token",
    );
    expect(screen.getAllByText(/alice-dev\/acme-docs/).length).toBeGreaterThan(0);
  });

  it("searches code without a repository scope only in readable repositories", async () => {
    installFetch();
    open("#/search?q=search%20flow&type=code");

    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText("src/search.ts")).toBeTruthy();
    expect(screen.getAllByText(/alice-dev\/acme-docs/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Code" })).toHaveLength(1);

    cleanup();
    open("#/search?q=no-such-token&type=code");
    expect(await screen.findByRole("heading", { name: "No code results" })).toBeTruthy();
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe(
      "no-such-token",
    );
  });
});
