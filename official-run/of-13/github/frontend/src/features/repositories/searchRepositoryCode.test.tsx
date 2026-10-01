import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";

const OWNER = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

const README =
  "# Acme Docs\n\nDocumentation for the Acme Demo platform.\n\nThe search flow starts in the search box at the top of every page.\n";
const SEARCH_SOURCE =
  "// Repository code search: the search flow of the Acme Docs site.\nexport function searchFlow(query: string): string[] {\n  return [query];\n}\n";

const FILES = [
  { path: "README.md", content: README },
  { path: "docs/getting-started.md", content: "# Getting started\n\nInstall the Acme Demo CLI.\n" },
  { path: "src/search.ts", content: SEARCH_SOURCE },
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
      branches: ["main"],
      files: FILES,
      commits: [
        {
          sha: "d4e5f6a",
          message: "Document search flow",
          author: "alice-dev",
          createdAt: "2024-01-03T00:00:00.000Z",
          parentSha: null,
          files: FILES,
        },
      ],
      branchHeads: { main: "d4e5f6a" },
    },
    {
      // The unauthorized private repository holds the same phrase.
      name: "secret-research",
      description: "Private research notes.",
      visibility: "private",
      defaultBranch: "main",
      files: [{ path: "research/notes.md", content: "# Notes\n\nResearch the search flow.\n" }],
    },
  ],
};

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

async function search(user: ReturnType<typeof userEvent.setup>, term: string) {
  const box = await screen.findByRole("searchbox", { name: "Search" });
  await user.clear(box);
  if (term.length > 0) await user.type(box, term);
  await user.type(box, "{Enter}");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-4-2-3 search code within a repository", () => {
  it("searches from the repository page and lists only matching files of that repository", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs");

    await screen.findByRole("button", { name: "Branch main" });
    // A repository page exposes exactly one search box named "Search".
    expect(screen.getAllByRole("searchbox", { name: "Search" })).toHaveLength(1);

    await search(user, "search flow");

    expect(window.location.hash).toContain("/repositories/acme-demo/acme-docs/search?q=search");
    const codeType = await screen.findByRole("link", { name: "Code" });
    expect(codeType.getAttribute("aria-current")).toBe("page");
    // The results-type link is the only `Code` link of the search page.
    expect(screen.getAllByRole("link", { name: "Code" })).toHaveLength(1);

    const readme = await screen.findByRole("link", { name: "README.md" });
    expect(screen.getByRole("link", { name: "search.ts" })).toBeTruthy();
    expect(screen.getByText("src/search.ts")).toBeTruthy();
    // The page context and every result state the branch context.
    expect(screen.getAllByText("Branch: main")).toHaveLength(3);
    expect(screen.getByText("The search flow starts in the search box at the top of every page.")).toBeTruthy();
    expect(readme.getAttribute("href")).toContain("README.md");

    // Nothing of the unauthorized private repository leaks into the results.
    expect(screen.queryByText("research/notes.md")).toBeNull();
  });

  it("filters by path and shows the other matches again when the filter is cleared", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs/search?q=search+flow");

    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();

    const pathFilter = screen.getByLabelText("Path");
    await user.type(pathFilter, "src/");

    expect(await screen.findByRole("link", { name: "search.ts" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
    expect(window.location.hash).toContain("path=src");

    await user.clear(pathFilter);

    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "search.ts" })).toBeTruthy();
  });

  it("shows an empty state that keeps the query and never shows a stale match", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs/search?q=search+flow");

    await screen.findByRole("link", { name: "README.md" });

    await search(user, "no-such-token");

    expect(await screen.findByText("No code results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveProperty(
      "value",
      "no-such-token",
    );

    // Repeating the same search from the repository keeps the empty state.
    window.location.hash = "#/repositories/acme-demo/acme-docs";
    await screen.findByRole("button", { name: "Branch main" });
    await search(user, "no-such-token");
    expect(await screen.findByText("No code results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
  });

  it("opens the matching file at the match and keeps it after a reload", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs/search?q=search+flow");

    await user.click(await screen.findByRole("link", { name: "README.md" }));

    expect(await screen.findByText("Match on line 5")).toBeTruthy();
    expect(screen.getByText(/The search flow starts in the search box/)).toBeTruthy();
    // The file page keeps a link named exactly after the file.
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    const address = window.location.hash;
    cleanup();
    render(<App />);
    expect(await screen.findByText(/The search flow starts in the search box/)).toBeTruthy();
    expect(window.location.hash).toBe(address);
  });
});
