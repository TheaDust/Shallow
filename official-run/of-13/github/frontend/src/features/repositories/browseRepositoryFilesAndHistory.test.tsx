import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";

const OWNER = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

const README_SEARCH =
  "# Acme Docs\n\nDocumentation for the Acme Demo platform.\n\nThe search flow starts in the search box at the top of every page.\n";
const GETTING_STARTED_INITIAL =
  "# Getting started\n\nInstall the Acme Demo CLI and sign in.\n\nOpen the docs from the repository list.\n";
const GETTING_STARTED =
  "# Getting started\n\nInstall the Acme Demo CLI and sign in.\n\nOpen the docs from the Code page.\n";
const SEARCH_GUIDE = "# Searching\n\nType a repository name in the top search box and press Enter.\n";
const SEARCH_SOURCE =
  "// Repository code search: the search flow of the Acme Docs site.\nexport function searchFlow(query: string): string[] {\n  return [query];\n}\n";

const MAIN_FILES = [
  { path: "README.md", content: README_SEARCH },
  { path: "docs/getting-started.md", content: GETTING_STARTED },
  { path: "docs/search.md", content: SEARCH_GUIDE },
  { path: "src/search.ts", content: SEARCH_SOURCE },
];

const COMMITS = [
  {
    sha: "a1b2c3d",
    message: "Initial commit",
    author: "alice-dev",
    createdAt: "2024-01-02T00:00:00.000Z",
    parentSha: null,
    files: [{ path: "docs/getting-started.md", content: GETTING_STARTED_INITIAL }],
  },
  {
    sha: "d4e5f6a",
    message: "Document search flow",
    author: "alice-dev",
    createdAt: "2024-01-03T00:00:00.000Z",
    parentSha: "a1b2c3d",
    files: MAIN_FILES,
  },
  {
    sha: "f7a8b9c",
    message: "Draft search prototype",
    author: "alice-dev",
    createdAt: "2024-01-04T00:00:00.000Z",
    parentSha: "d4e5f6a",
    files: [
      { path: "README.md", content: README_SEARCH },
      { path: "prototype/search.ts", content: "export const searchPrototype = true;\n" },
    ],
  },
];

const ORGANIZATION: StubOrganization = {
  name: "acme-demo",
  displayName: "Acme Demo",
  members: [{ username: "alice-dev", role: "owner" }],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation for the Acme Demo platform.",
      visibility: "public",
      defaultBranch: "main",
      branches: ["main", "feature-search"],
      files: MAIN_FILES,
      commits: COMMITS,
      branchHeads: { main: "d4e5f6a", "feature-search": "f7a8b9c" },
    },
  ],
};

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again, like a reload of the same address. */
function reload() {
  cleanup();
  return render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-4-1 browse repository files and directories", () => {
  it("opens the nested directory and its text file, and keeps the content after a reload", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs");

    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });
    const branchSelector = await screen.findByRole("button", { name: "Branch main" });
    await user.click(branchSelector);
    expect(await screen.findByRole("option", { name: "main" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();
    await user.keyboard("{Escape}");

    await user.click(await screen.findByRole("link", { name: "docs" }));

    const directory = await screen.findByRole("link", { name: "search.md" });
    expect(directory).toBeTruthy();

    await user.click(directory);

    expect(await screen.findByText(/Type a repository name/, { exact: false })).toBeTruthy();
    expect(screen.getByText("Branch: main")).toBeTruthy();
    expect(screen.getByText("Path: docs/search.md")).toBeTruthy();

    const address = window.location.hash;
    reload();
    expect(await screen.findByText(/Type a repository name/, { exact: false })).toBeTruthy();
    expect(screen.getByText("Path: docs/search.md")).toBeTruthy();
    expect(window.location.hash).toBe(address);
  });

  it("stops displaying a file after switching to a branch without it", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs/blob/main/docs/search.md");

    expect(await screen.findByText(/Type a repository name/, { exact: false })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    await user.click(await screen.findByRole("option", { name: "feature-search" }));

    // The file only exists on `main`, so the other branch shows no content.
    expect(await screen.findByText(/does not exist on branch feature-search/)).toBeTruthy();
    expect(screen.queryByText(/Type a repository name/, { exact: false })).toBeNull();
    expect(window.location.hash).toContain("feature-search");
  });
});

describe("REQ-4-2-1 view repository commit history", () => {
  it("opens the branch history from the repository page, newest first", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs");

    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });
    const historyLink = screen.getByRole("link", { name: "Commits" });
    await user.click(historyLink);

    expect(await screen.findByRole("heading", { name: "Commit history" })).toBeTruthy();
    const items = screen.getAllByRole("article");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Document search flow")).toBeTruthy();
    expect(within(items[1]).getByText("Initial commit")).toBeTruthy();

    // Short hash, author and a relative timestamp containing "ago".
    expect(within(items[0]).getByRole("link", { name: "d4e5f6a" })).toBeTruthy();
    expect(within(items[0]).getByText("alice-dev")).toBeTruthy();
    expect(within(items[0]).getByText(/ago$/)).toBeTruthy();

    // The message is an accessible commit entry link and the timestamp is a
    // `time` element whose accessible name is the relative timestamp.
    expect(within(items[0]).getByRole("link", { name: "Document search flow" })).toBeTruthy();
    expect(within(items[0]).getByRole("time", { name: /ago$/ })).toBeTruthy();
    expect(within(items[0]).getByRole("heading", { name: "Document search flow" })).toBeTruthy();

    // Refreshing the history page keeps the order and the content.
    const address = window.location.hash;
    reload();
    const afterReload = await screen.findAllByRole("article");
    expect(within(afterReload[0]).getByText("Document search flow")).toBeTruthy();
    expect(window.location.hash).toBe(address);
  });

  it("scopes the history to the commits that changed one file", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    renderApp("#/repositories/acme-demo/acme-docs/commits?path=README.md");

    const items = await screen.findAllByRole("article");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText("Document search flow")).toBeTruthy();
    // The initial commit did not change `README.md`, so it is not listed even
    // though the branch itself has two commits.
    expect(screen.queryByText("Initial commit")).toBeNull();
    expect(screen.getByText("File: README.md")).toBeTruthy();

    cleanup();
    renderApp("#/repositories/acme-demo/acme-docs/commits?path=docs%2Fsearch.md");
    expect(await screen.findAllByRole("article")).toHaveLength(1);
  });

  it("opens a commit entry with its parent revision and changed files", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs/commits");

    await user.click(await screen.findByRole("link", { name: "d4e5f6a" }));

    expect(await screen.findByRole("heading", { name: "Document search flow" })).toBeTruthy();
    expect(screen.getByText("Parent revision")).toBeTruthy();
    expect(screen.getByRole("link", { name: "a1b2c3d" })).toBeTruthy();
    expect(screen.getByText("Changed files")).toBeTruthy();

    // Every changed file of the commit is linked, added and modified alike.
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "docs/search.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "docs/getting-started.md" })).toBeTruthy();

    // Opening one changed file keeps the commit and shows only that file diff.
    await user.click(screen.getByRole("link", { name: "src/search.ts" }));
    expect(await screen.findByText(/the search flow of the Acme Docs site/)).toBeTruthy();
    expect(window.location.hash).toContain("path=src");
    expect(await screen.findAllByRole("heading", { level: 3 })).toHaveLength(1);
  });
});

describe("REQ-4-2-2 inspect commit and revision differences", () => {
  it("compares the parent revision with the commit and shows the added lines", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs/commit/d4e5f6a");

    expect(await screen.findByText("Base: a1b2c3d")).toBeTruthy();
    expect(screen.getByText("Compare: d4e5f6a")).toBeTruthy();
    expect(screen.getByText("Changed files")).toBeTruthy();
    expect(screen.getByText("+13")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    // The added file is an exact text value on the page.
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByText("// Repository code search: the search flow of the Acme Docs site.")).toBeTruthy();

    // A read-only page: reloading it keeps the same comparison.
    reload();
    expect(await screen.findByText("Base: a1b2c3d")).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
  });

  it("compares two picked revisions from the comparison page reachable from the history", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs/commits");

    await user.click(await screen.findByRole("link", { name: "Compare revisions" }));

    await screen.findByRole("heading", { name: "Compare revisions" });
    const baseSelect = screen.getByLabelText("Base revision");
    const compareSelect = screen.getByLabelText("Compare revision");
    await user.selectOptions(baseSelect, "a1b2c3d");
    await user.selectOptions(compareSelect, "d4e5f6a");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    expect(await screen.findByText("Base: a1b2c3d")).toBeTruthy();
    expect(screen.getByText("Compare: d4e5f6a")).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(window.location.hash).toContain("base=a1b2c3d");
  });
});
