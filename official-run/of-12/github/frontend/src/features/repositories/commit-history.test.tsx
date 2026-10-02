import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createRepositoryMock, type MockRepositoryServer } from "../../test/repository-server-mock";

let server: MockRepositoryServer;

beforeEach(() => {
  server = createRepositoryMock({ viewer: "visitor" });
  window.location.hash = "#/";
  server.install();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reset(viewer: string | null, hash: string) {
  cleanup();
  server = createRepositoryMock({ viewer });
  window.location.hash = hash;
  server.install();
}

function acmeDocs() {
  return server.state.repositories.find((repository) => repository.name === "acme-docs")!;
}

const SEARCH_BOX = { name: "Search" } as const;

/** Searches from the repository page: the top searchbox scopes to the code. */
async function searchFromRepository(owner: string, name: string, term: string) {
  reset("visitor", `#/${owner}/${name}`);
  render(<App />);
  const box = await screen.findByRole("searchbox", SEARCH_BOX);
  await userEvent.type(box, `${term}{Enter}`);
}

describe("REQ-4-2-1 view repository commit history", () => {
  it("opens the branch history from the Code page and lists every record", async () => {
    window.location.hash = "#/alice-dev/acme-docs";
    render(<App />);

    // The commit count above the file list is the history entry, next to the
    // single navigation link named "Commits".
    const count = await screen.findByRole("link", { name: "2 commits" });
    expect(count.getAttribute("href")).toBe("#/alice-dev/acme-docs/commits");
    expect(screen.getAllByRole("link", { name: "Commits" })).toHaveLength(1);

    await userEvent.click(count);
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/commits");
    expect(await screen.findByText("Commits on main")).toBeTruthy();

    // Newest first, with the stored message, author, time and parent commit.
    const hash = await screen.findByRole("link", { name: "9c3e5b1" });
    expect(hash.getAttribute("href")).toBe("#/alice-dev/acme-docs/commit/9c3e5b1-acme-docs-search");
    expect(screen.getByText("Document search flow")).toBeTruthy();
    expect(screen.getAllByText("alice-dev").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ago/).length).toBeGreaterThan(0);
    expect(screen.getByText("Parent 4a1f7c2")).toBeTruthy();
    expect(screen.getAllByText(/Changed files: README\.md/).length).toBeGreaterThan(0);

    // Reloading keeps the order and the records.
    cleanup();
    server.install();
    render(<App />);
    expect(await screen.findByText("Document search flow")).toBeTruthy();
    expect(screen.getByText("Initial commit")).toBeTruthy();
  });

  it("reads only the commits that modified a selected file", async () => {
    window.location.hash = "#/alice-dev/acme-docs/commits";
    render(<App />);
    await screen.findByRole("link", { name: "9c3e5b1" });

    const scope = screen.getByLabelText("Path");
    await userEvent.selectOptions(scope, "CONTRIBUTING.md");
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/commits?path=CONTRIBUTING.md");
    await waitFor(() => {
      expect(screen.queryByText("Document search flow")).toBeNull();
    });
    expect(screen.getByText("Initial commit")).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("Path"), "README.md");
    expect(await screen.findByText("Document search flow")).toBeTruthy();
    expect(screen.getByText("Initial commit")).toBeTruthy();

    // Reloading the scoped history keeps the file scope.
    cleanup();
    server.install();
    render(<App />);
    expect(await screen.findByText("Commits on main for README.md")).toBeTruthy();
  });

  it("keeps a private repository's history out of reach for a visitor", async () => {
    window.location.hash = "#/alice-dev/secret-research/commits";
    render(<App />);
    expect(await screen.findByText("Access denied")).toBeTruthy();
  });
});

describe("REQ-4-2-2 inspect commit and revision differences", () => {
  async function openCommit() {
    window.location.hash = "#/alice-dev/acme-docs/commits";
    render(<App />);
    await userEvent.click(await screen.findByRole("link", { name: "9c3e5b1" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/commit/9c3e5b1-acme-docs-search");
    await screen.findByText("Changed files");
  }

  it("compares a commit with its parent and marks the changed lines", async () => {
    await openCommit();

    // The base and compare identifiers are readable, next to the parent.
    expect(screen.getByText("Base")).toBeTruthy();
    expect(screen.getAllByText("Compare").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "4a1f7c2 Initial commit" })).toBeTruthy();

    const added = screen.getByRole("region", { name: "Diff of src/search.ts" });
    expect(added.querySelectorAll('[data-line-type="added"]').length).toBeGreaterThan(0);
    expect(added.querySelectorAll('[data-line-type="removed"]').length).toBe(0);
    expect(within(added).getAllByText(/\+\s+return `search flow/).length).toBeGreaterThan(0);

    const modified = screen.getByRole("region", { name: "Diff of README.md" });
    expect(modified.querySelectorAll('[data-line-type="added"]').length).toBeGreaterThan(0);
    expect(modified.querySelectorAll('[data-line-type="removed"]').length).toBeGreaterThan(0);
    expect(within(modified).getAllByText(/^\+/).length).toBeGreaterThan(0);
    expect(within(modified).getAllByText(/^-/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("src/search.ts").length).toBeGreaterThan(0);
    // An unchanged file is not part of the comparison.
    expect(screen.queryByText("CONTRIBUTING.md")).toBeNull();

    // Clicking a changed file opens that file's diff only.
    await userEvent.click(screen.getByRole("link", { name: "README.md" }));
    expect(window.location.hash).toBe(
      "#/alice-dev/acme-docs/commit/9c3e5b1-acme-docs-search?file=README.md",
    );
    expect(await screen.findByRole("region", { name: "Diff of README.md" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Diff of src/search.ts" })).toBeNull();
  });

  it("compares two revisions selected on the comparison page", async () => {
    reset("visitor", "#/alice-dev/acme-docs/compare");
    render(<App />);

    const form = await screen.findByRole("form", { name: "Comparison" });
    const base = within(form).getByLabelText("Base");
    const compare = within(form).getByLabelText("Compare");
    const baseValue = Array.from(base.querySelectorAll("option")).find((option) =>
      option.textContent?.includes("Initial commit"));
    await userEvent.selectOptions(base, baseValue!.value);
    const compareValue = Array.from(compare.querySelectorAll("option")).find((option) =>
      option.textContent?.includes("Document search flow"));
    await userEvent.selectOptions(compare, compareValue!.value);
    await userEvent.click(within(form).getByRole("button", { name: "Compare" }));

    expect(window.location.hash).toContain("#/alice-dev/acme-docs/compare?");
    expect(window.location.hash).toContain(`base=${baseValue!.value}`);
    expect(window.location.hash).toContain(`compare=${compareValue!.value}`);
    expect(await screen.findByText("Changed files")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Diff of src/search.ts" })).toBeTruthy();

    // The read-only comparison leaves the stored branches and commits alone.
    const stored = acmeDocs();
    expect(stored.commits).toHaveLength(5);
    expect(stored.branches.find((branch) => branch.name === "main")!.headId).toBe("9c3e5b1-acme-docs-search");
  });

  it("refuses an unknown revision without a diff", async () => {
    reset("visitor", "#/alice-dev/acme-docs/compare?base=nope&compare=main");
    render(<App />);
    expect(await screen.findByText("Unknown revision. Choose two revisions of this repository.")).toBeTruthy();
    expect(screen.queryByText("Changed files")).toBeNull();
  });
});

describe("REQ-4-2-3 search code within a repository", () => {
  it("searches the code of the repository and narrows the results by path", async () => {
    await searchFromRepository("alice-dev", "acme-docs", "search flow");

    expect(window.location.hash.startsWith("#/search?")).toBe(true);
    expect(window.location.hash).toContain("type=code");
    expect(window.location.hash).toContain("repo=alice-dev%2Facme-docs");
    // The results-type link keeps "Code" the only control named that way.
    expect(await screen.findByRole("link", { name: "Code", current: "page" })).toBeTruthy();

    const readme = await screen.findByRole("link", { name: "README.md" });
    expect(readme.getAttribute("href")).toContain("#/alice-dev/acme-docs/blob/main/README.md");
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getAllByText("on main").length).toBeGreaterThan(0);
    expect(screen.getByText(/The search flow finds documentation/)).toBeTruthy();
    // Nothing of another repository leaks into these results.
    expect(screen.queryByText(/must not leak/)).toBeNull();

    // Filtering by path only keeps the file below `src/`.
    await userEvent.type(screen.getByLabelText("Path"), "src/{Enter}");
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
    });
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(window.location.hash).toContain("path=src%2F");

    // The matching result opens the file with its content visible.
    await userEvent.click(screen.getByRole("link", { name: "src/search.ts" }));
    expect(window.location.hash.startsWith("#/alice-dev/acme-docs/blob/main/src/search.ts")).toBe(true);
    const article = await screen.findByRole("article", { name: "src/search.ts" });
    expect(within(article).getByText(/search flow for/)).toBeTruthy();
  });

  it("opens a matching file and keeps a link named exactly after the file", async () => {
    await searchFromRepository("alice-dev", "acme-docs", "search flow");

    // An unfiltered search offers the result as a link named after the file.
    const result = await screen.findByRole("link", { name: "README.md" });
    await userEvent.click(result);
    expect(window.location.hash.startsWith("#/alice-dev/acme-docs/blob/main/README.md")).toBe(true);

    const article = await screen.findByRole("article", { name: "README.md" });
    expect(within(article).getByText(/The search flow finds documentation across the repository\./)).toBeTruthy();

    // The file page spells the file with a link named exactly after it, which
    // points at this file location.
    const fileLink = screen.getByRole("link", { name: "README.md" });
    expect(fileLink.getAttribute("href")).toBe("#/alice-dev/acme-docs/blob/main/README.md");

    // Reopening the file address keeps the content and that link.
    cleanup();
    server.install();
    render(<App />);
    expect(await screen.findByRole("article", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" }).getAttribute("href")).toBe(
      "#/alice-dev/acme-docs/blob/main/README.md",
    );
    // The read-only search wrote nothing.
    expect(acmeDocs().commits).toHaveLength(5);
  });

  it("keeps the scope and the query for a term without any match", async () => {
    await searchFromRepository("alice-dev", "acme-docs", "search flow");
    await screen.findByRole("link", { name: "README.md" });

    const box = screen.getByRole("searchbox", SEARCH_BOX);
    await userEvent.clear(box);
    await userEvent.type(box, "no-such-token");
    expect(await screen.findByText("No code results")).toBeTruthy();
    expect(box).toHaveProperty("value", "no-such-token");
    expect(window.location.hash).toContain("type=code");
    expect(window.location.hash).toContain("repo=alice-dev%2Facme-docs");
    expect(window.location.hash).toContain("q=no-such-token");
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();

    // Repeating the search after returning to the repository keeps the state.
    await userEvent.click(screen.getByRole("link", { name: "Code" }));
    expect(await screen.findByText("No code results")).toBeTruthy();
  });

  it("hides a private repository's code from a visitor", async () => {
    reset("visitor", "#/search?q=search%20flow&type=code&repo=alice-dev%2Fsecret-research");
    render(<App />);
    expect(await screen.findByText(/Access denied/)).toBeTruthy();
    expect(screen.queryByText(/must not leak/)).toBeNull();

    // The owner searches the same repository successfully.
    reset("alice-dev", "#/search?q=search%20flow&type=code&repo=alice-dev%2Fsecret-research");
    render(<App />);
    expect(await screen.findByRole("link", { name: "research/notes.md" })).toBeTruthy();
  });
});
