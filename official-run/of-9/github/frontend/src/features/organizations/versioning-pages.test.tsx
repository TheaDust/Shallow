import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommitHistoryPage } from "./CommitHistoryPage";
import { CommitDetailPage } from "./CommitDetailPage";
import { ComparePage } from "./ComparePage";
import { RepoCodeSearchPage } from "./RepoCodeSearchPage";
import { FileEditorPage } from "./FileEditorPage";

const mocks = vi.hoisted(() => ({
  getRepositoryCommits: vi.fn(),
  getCommitDiff: vi.fn(),
  getCompareDiff: vi.fn(),
  getRepositoryBranches: vi.fn(),
  searchRepositoryCode: vi.fn(),
  createRepositoryCommit: vi.fn(),
  getRepositoryContents: vi.fn(),
  fetchSession: vi.fn(),
}));

vi.mock("../auth/api", () => ({
  fetchSession: mocks.fetchSession,
}));

vi.mock("./api", () => ({
  getRepositoryCommits: mocks.getRepositoryCommits,
  getCommitDiff: mocks.getCommitDiff,
  getCompareDiff: mocks.getCompareDiff,
  getRepositoryBranches: mocks.getRepositoryBranches,
  searchRepositoryCode: mocks.searchRepositoryCode,
  createRepositoryCommit: mocks.createRepositoryCommit,
  getRepositoryContents: mocks.getRepositoryContents,
}));

const commit = (id: string, message: string, parentId: string | null) => ({
  id,
  shortId: id,
  message,
  author: "alice-dev",
  createdAt: "2026-09-01T00:00:00.000Z",
  parentId,
  changes: [{ path: "src/search.ts", additions: 3, deletions: 0 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSession.mockResolvedValue({ authenticated: false });
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

describe("CommitHistoryPage", () => {
  it("lists branch commits newest first with short hash, message, author and relative time", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/commits";
    mocks.getRepositoryCommits.mockResolvedValue({
      branch: "main",
      path: "",
      commits: [commit("c2", "Document search flow", "c1"), commit("c1", "Initial commit", null)],
    });
    render(<CommitHistoryPage owner="acme-demo" name="acme-docs" />);

    expect(await screen.findByText("Document search flow")).toBeTruthy();
    expect(screen.getByText("Initial commit")).toBeTruthy();
    expect(screen.getByText("Branch: main")).toBeTruthy();
    expect(screen.getAllByText(/alice-dev committed .*ago/).length).toBeGreaterThan(0);
    const hashLink = screen.getByRole("link", { name: "c2" });
    expect(hashLink.getAttribute("href")).toBe("#/repos/acme-demo/acme-docs/commit/c2");
  });

  it("shows the file-scoped history scope", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/commits?path=src%2Fsearch.ts";
    mocks.getRepositoryCommits.mockResolvedValue({
      branch: "main",
      path: "src/search.ts",
      commits: [commit("c2", "Document search flow", "c1")],
    });
    render(<CommitHistoryPage owner="acme-demo" name="acme-docs" />);
    expect(await screen.findByText(/History for/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
  });
});

describe("CommitDetailPage", () => {
  const diffResponse = {
    repository: { owner: "acme-demo", name: "acme-docs" },
    base: "c1",
    compare: "c2",
    commit: { ...commit("c2", "Document search flow", "c1"), changes: [] },
    parent: commit("c1", "Initial commit", null),
    files: [
      {
        path: "src/search.ts",
        additions: 3,
        deletions: 0,
        lines: [
          { type: "add", line: "export function search(query: string): string[] {" },
          { type: "add", line: "  return [];" },
          { type: "add", line: "}" },
        ],
      },
    ],
    totalAdditions: 3,
    totalDeletions: 0,
  };

  it("shows the changed-file path, Changed files summary and numeric additions/deletions", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/commit/c2";
    mocks.getCommitDiff.mockResolvedValue(diffResponse);
    render(<CommitDetailPage owner="acme-demo" name="acme-docs" commitId="c2" />);

    expect(await screen.findByText("Changed files")).toBeTruthy();
    expect(screen.getAllByText("src/search.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("3 additions, 0 deletions")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "Parent: c1")).toBeTruthy();
    expect(screen.getByText(/export function search/)).toBeTruthy();
  });

  it("navigates to a single file diff via the changed-file link", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/commit/c2";
    mocks.getCommitDiff.mockResolvedValue(diffResponse);
    render(<CommitDetailPage owner="acme-demo" name="acme-docs" commitId="c2" />);

    const link = await screen.findByRole("link", { name: "src/search.ts" });
    expect(link.getAttribute("href")).toBe(
      "#/repos/acme-demo/acme-docs/commit/c2?path=src%2Fsearch.ts",
    );
  });
});

describe("ComparePage", () => {
  it("offers Base and Compare selects and a Compare button", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/compare";
    mocks.getRepositoryBranches.mockResolvedValue(["main", "feature-search"]);
    mocks.getRepositoryCommits.mockResolvedValue({
      branch: "main",
      path: "",
      commits: [commit("c2", "Document search flow", "c1"), commit("c1", "Initial commit", null)],
    });
    render(<ComparePage owner="acme-demo" name="acme-docs" />);

    expect(await screen.findByRole("combobox", { name: "Base" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Compare" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare" })).toBeTruthy();
  });

  it("shows the diff when base and compare are provided", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/compare?base=main&compare=feature-search";
    mocks.getRepositoryBranches.mockResolvedValue(["main", "feature-search"]);
    mocks.getRepositoryCommits.mockResolvedValue({
      branch: "main",
      path: "",
      commits: [commit("c2", "Document search flow", "c1")],
    });
    mocks.getCompareDiff.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      base: "c2",
      compare: "c3",
      files: [
        {
          path: "main-only.md",
          additions: 1,
          deletions: 0,
          lines: [{ type: "add", line: "This file only exists on the feature-search branch." }],
        },
      ],
      totalAdditions: 1,
      totalDeletions: 0,
    });
    render(<ComparePage owner="acme-demo" name="acme-docs" />);

    expect(await screen.findByText("Changed files")).toBeTruthy();
    expect(screen.getAllByText("main-only.md").length).toBeGreaterThan(0);
  });
});

describe("RepoCodeSearchPage", () => {
  it("shows a Search box, a unique Code results link and matching file results", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/search?q=search";
    mocks.searchRepositoryCode.mockResolvedValue({
      branch: "main",
      results: [
        { path: "README.md", branch: "main", line: 3, snippet: "This repository documents the search flow." },
        { path: "src/search.ts", branch: "main", line: 1, snippet: "export function search(query: string): string[] {" },
      ],
    });
    render(<RepoCodeSearchPage owner="acme-demo" name="acme-docs" />);

    expect(await screen.findByRole("searchbox", { name: "Search" })).toBeTruthy();
    const codeLink = screen.getByRole("link", { name: "Code" });
    expect(codeLink.getAttribute("href")).toBe("#/repos/acme-demo/acme-docs/search?q=search");
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "search.ts" })).toBeTruthy();
    expect(screen.getByText(/This repository documents the search flow/)).toBeTruthy();
    expect(screen.getAllByText("Branch: main").length).toBeGreaterThan(0);
  });

  it("shows No code results for an absent query and keeps the query in Search", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/search?q=no-such-token";
    mocks.searchRepositoryCode.mockResolvedValue({ branch: "main", results: [] });
    render(<RepoCodeSearchPage owner="acme-demo" name="acme-docs" />);

    expect(await screen.findByText("No code results")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveProperty("value", "no-such-token");
  });

  it("applies the path filter to src/", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/search?q=search&path=src%2F";
    mocks.searchRepositoryCode.mockResolvedValue({
      branch: "main",
      results: [{ path: "src/search.ts", branch: "main", line: 1, snippet: "export function search" }],
    });
    render(<RepoCodeSearchPage owner="acme-demo" name="acme-docs" />);

    expect(await screen.findByRole("link", { name: "search.ts" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
    expect(mocks.searchRepositoryCode).toHaveBeenCalledWith("acme-demo", "acme-docs", "search", "src/");
  });
});

describe("FileEditorPage", () => {
  it("renders the editor fields and commits a new file", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/new?branch=main";
    mocks.getRepositoryContents.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      branch: "main",
      path: "/",
      type: "dir",
      entries: [],
      myRole: "admin",
      commitCount: 2,
    });
    mocks.createRepositoryCommit.mockResolvedValue({ ok: true, commit: commit("c4", "Add docs/guide.md", "c2") });
    const user = userEvent.setup();
    render(<FileEditorPage owner="acme-demo" name="acme-docs" mode="new" />);

    const nameField = await screen.findByLabelText("File name");
    await user.type(nameField, "docs/guide.md");
    await user.type(screen.getByLabelText("File contents"), "# Guide");
    await user.type(screen.getByLabelText("Commit message"), "Add docs/guide.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    await waitFor(() => {
      expect(mocks.createRepositoryCommit).toHaveBeenCalledWith("acme-demo", "acme-docs", {
        branch: "main",
        path: "docs/guide.md",
        content: "# Guide",
        message: "Add docs/guide.md",
      });
    });
    expect(window.location.hash).toBe("#/repos/acme-demo/acme-docs/blob?branch=main&path=docs%2Fguide.md");
  });

  it("shows Invalid file path and Commit message is required for a rejected submission", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/new?branch=main";
    mocks.getRepositoryContents.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      branch: "main",
      path: "/",
      type: "dir",
      entries: [],
      myRole: "admin",
      commitCount: 2,
    });
    mocks.createRepositoryCommit.mockResolvedValue({
      ok: false,
      errors: { path: "Invalid file path", message: "Commit message is required" },
    });
    const user = userEvent.setup();
    render(<FileEditorPage owner="acme-demo" name="acme-docs" mode="new" />);

    await screen.findByLabelText("File name");
    await user.type(screen.getByLabelText("File name"), "../invalid.md");
    await user.type(screen.getByLabelText("File contents"), "must not be saved");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Invalid file path")).toBeTruthy();
    expect(screen.getByText("Commit message is required")).toBeTruthy();
  });

  it("denies read-only users", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/new?branch=main";
    mocks.getRepositoryContents.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      branch: "main",
      path: "/",
      type: "dir",
      entries: [],
      myRole: "triage",
      commitCount: 2,
    });
    const { SessionProvider } = await import("../auth/session");
    render(
      <SessionProvider>
        <FileEditorPage owner="acme-demo" name="acme-docs" mode="new" />
      </SessionProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  });
});
