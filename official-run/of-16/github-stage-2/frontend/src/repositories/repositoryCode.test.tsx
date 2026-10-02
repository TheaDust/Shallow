import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeOrganization } from "../test-utils/fake-api";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3_600_000).toISOString();

const ACME_DOCS_HISTORY = [
  {
    message: "Initial commit",
    author: "ShallowCode",
    committedAt: daysAgo(45),
    changes: [
      { path: "README.md", content: "# acme-docs\n\nDocumentation, guides and release notes." },
      { path: "src/README.md", content: "Document search flow" },
      { path: "src/search.ts", content: "export const search = () => [];" },
    ],
  },
  {
    message: "Document search flow",
    author: "alice-dev",
    committedAt: hoursAgo(3),
    changes: [
      {
        path: "src/search.ts",
        content: "export const search = () => [];\nexport const searchFlow = true;",
      },
    ],
  },
];

const ACME_DEMO: FakeOrganization = {
  slug: "acme-demo",
  name: "Acme Demo",
  displayName: "Acme Demo",
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation, guides and release notes for Acme Demo.",
      visibility: "public",
      updatedAt: hoursAgo(3),
      files: ["README.md", "src/README.md", "src/search.ts"],
      commits: ACME_DOCS_HISTORY,
    },
  ],
};

function fixture() {
  return createFakeApi({ organizations: [ACME_DEMO] });
}

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function renderVisitor(hash: string) {
  const api = fixture();
  api.install();
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("main");
  return { api, user };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("REQ-4-1 browse repository files and directories", () => {
  it("scenario 1: opens the src directory and its README.md and keeps the content after a reload", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs");
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    // Directory and file entries are links with their exact accessible names.
    const directoryLink = screen.getByRole("link", { name: "src" });
    expect(directoryLink.getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs/tree/main/src",
    );
    await user.click(directoryLink);

    // The directory page identifies the current path and its branch.
    expect(await screen.findByRole("heading", { name: "src" })).toBeTruthy();
    expect(screen.getByText(/Branch main/)).toBeTruthy();
    const fileLink = screen.getByRole("link", { name: "README.md" });
    expect(fileLink.getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs/blob/main/src/README.md",
    );
    await user.click(fileLink);

    await waitFor(() => {
      expect(window.location.hash).toBe(
        "#/organizations/acme-demo/repositories/acme-docs/blob/main/src/README.md",
      );
    });
    // The file page shows the stored name, path, branch and readable content.
    const title = await screen.findByRole("heading", { name: "README.md" });
    expect(title.textContent).toBe("src/README.md");
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText(/Branch main/)).toBeTruthy();
    expect(screen.getByText("Document search flow")).toBeTruthy();

    // Reloading the file page reads the same read-only content.
    cleanup();
    render(<App />);
    expect(await screen.findByText("Document search flow")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
  });
});

describe("REQ-4-2-1 view repository commit history", () => {
  it("scenario 1: the repository page opens the history with message, author and a relative age", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs");
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    const historyLink = screen.getByRole("link", { name: "Commits" });
    expect(historyLink.getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs/commits/main",
    );
    await user.click(historyLink);

    expect(await screen.findByRole("heading", { name: "Commit history" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Document search flow" })).toBeTruthy();
    expect(screen.getByText("alice-dev")).toBeTruthy();
    expect(screen.getByText(/ago/)).toBeTruthy();
    expect(screen.getByText(/Branch main/)).toBeTruthy();
  });
});

describe("REQ-4-2-2 inspect commit and revision differences", () => {
  it("scenario 1: the commit entry shows the changed file, the summary and the numbers", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs/commits/main");
    await screen.findByRole("heading", { name: "Commit history" });

    await user.click(screen.getByRole("link", { name: "Document search flow" }));

    expect(await screen.findByRole("heading", { name: "Changed files" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    // The comparison is line by line and never writes anything.
    expect(screen.getByText("export const searchFlow = true;")).toBeTruthy();
  });
});

describe("REQ-4-2-3 search code within a repository", () => {
  it("scenario 1 and 3: a matching query opens the README.md result and keeps it after a reload", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs");
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    const search = screen.getByRole("searchbox", { name: "Search" });
    await user.type(search, "search flow");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(window.location.hash).toBe(
        "#/organizations/acme-demo/repositories/acme-docs/search?q=search+flow",
      );
    });
    // The Code results view is selected and the matching file is offered.
    expect(screen.getByRole("link", { name: "Code" })).toBeTruthy();
    const result = await screen.findByRole("link", { name: "README.md" });
    await user.click(result);

    expect(await screen.findByText("Document search flow")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    // Reloading keeps the text and the exact file link.
    cleanup();
    render(<App />);
    expect(await screen.findByText("Document search flow")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
  });

  it("scenario 2 and 4: an absent query shows no results and keeps the query, twice", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs");
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    async function searchFor(query: string) {
      const box = screen.getByRole("searchbox", { name: "Search" });
      await user.clear(box);
      await user.type(box, query);
      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(window.location.hash).toBe(
          `#/organizations/acme-demo/repositories/acme-docs/search?q=${query.replace(/ /g, "+")}`,
        );
      });
    }

    await searchFor("no-such-token");
    expect(await screen.findByText("No results")).toBeTruthy();
    const box = screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement;
    expect(box.value).toBe("no-such-token");
    // Opening the Code results keeps the same empty state.
    await user.click(screen.getByRole("link", { name: "Code" }));
    expect(await screen.findByText("No results")).toBeTruthy();

    // Returning to the repository and repeating the search gives the same state.
    await user.click(screen.getByRole("link", { name: "Acme Demo/acme-docs" }));
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });
    await searchFor("no-such-token");
    expect(await screen.findByText("No results")).toBeTruthy();
  });

  it("keeps the repository search inside the repository context", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs");
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    const search = screen.getByRole("searchbox", { name: "Search" });
    await user.type(search, "search flow");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(window.location.hash).toContain("/organizations/acme-demo/repositories/acme-docs/search");
    });
    expect(within(await screen.findByRole("navigation", { name: "Search results" })).getByRole("link", { name: "Code" }))
      .toBeTruthy();
  });
});
