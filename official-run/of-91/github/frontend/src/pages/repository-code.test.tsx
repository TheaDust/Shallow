import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

/** Opens the seeded public repository from the home page entry. */
async function openSeededRepository(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "acme-docs" }));
  await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });
}

async function submitSearch(user: ReturnType<typeof userEvent.setup>, query: string) {
  const box = screen.getByRole("searchbox", { name: "Search" });
  await user.clear(box);
  await user.type(box, `${query}{Enter}`);
}

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-4-1 browse repository files and directories", () => {
  it("opens the src directory and the README file and keeps the content after reload", async () => {
    const user = userEvent.setup();
    await openSeededRepository(user);

    await user.click(screen.getByRole("link", { name: "Code" }));
    const directory = await screen.findByRole("link", { name: "src" });
    expect(directory.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/code/src");

    await user.click(directory);
    expect(await screen.findByRole("heading", { name: "src" })).not.toBeNull();
    const file = await screen.findByRole("link", { name: "README.md" });
    expect(file.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/blob/src%2FREADME.md");

    await user.click(file);
    expect((await screen.findByRole("heading", { name: "README.md" })).textContent).toBe("README.md");
    expect(screen.getByText("Document search flow")).not.toBeNull();
    expect(screen.getByText("src/README.md")).not.toBeNull();
    expect(screen.getByText("main")).not.toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    reload();
    expect(await screen.findByText("Document search flow")).not.toBeNull();
    expect((await screen.findByRole("heading", { name: "README.md" })).textContent).toBe("README.md");
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
  });

  it("keeps a private repository's files out of the visitor code view", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "acme-docs" });
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
  });
});

describe("REQ-4-2-1 view repository commit history", () => {
  it("lists the seeded commit with its author and a relative timestamp", async () => {
    const user = userEvent.setup();
    await openSeededRepository(user);

    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("heading", { name: "Commits" })).not.toBeNull();

    expect(screen.getByText("Document search flow")).not.toBeNull();
    expect(screen.getByText(/alice-dev/)).not.toBeNull();
    const relative = screen.getByText(/ago/);
    expect(relative.textContent).toMatch(/\d+ (day|hour|minute|month|year)s? ago/);
    expect(screen.getByText(/commit-repo-acme-docs-2/)).not.toBeNull();

    reload();
    expect(await screen.findByText(/alice-dev/)).not.toBeNull();
    expect(screen.getByText(/ago/)).not.toBeNull();
  });
});

describe("REQ-4-2-2 inspect commit and revision differences", () => {
  it("opens the seeded commit entry and shows the changed file with numbers", async () => {
    const user = userEvent.setup();
    await openSeededRepository(user);
    await user.click(screen.getByRole("link", { name: "Commits" }));
    await user.click(await screen.findByRole("link", { name: "Document search flow" }));

    expect(await screen.findByRole("heading", { name: "Changed files" })).not.toBeNull();
    const path = screen.getByRole("link", { name: "src/search.ts" });
    expect(path.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/blob/src%2Fsearch.ts");
    expect(screen.getByText("+2")).not.toBeNull();
    expect(screen.getByText("-2")).not.toBeNull();
    expect(screen.getByText("1 file changed with 2 additions and 2 deletions")).not.toBeNull();
    expect(screen.getByText("commit-repo-acme-docs-1")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Document search flow" })).not.toBeNull();

    // The diff is read-only: the file content is unchanged.
    reload();
    expect(await screen.findByRole("heading", { name: "Changed files" })).not.toBeNull();
  });
});

describe("REQ-4-2-3 search code within a repository", () => {
  it("searches readable file content, opens the matching file and keeps it after reload", async () => {
    const user = userEvent.setup();
    await openSeededRepository(user);

    await submitSearch(user, "search flow");
    await user.click(await screen.findByRole("link", { name: "Code" }));

    const result = await screen.findByRole("link", { name: "README.md" });
    expect(result.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/blob/src%2FREADME.md");
    await user.click(result);

    expect(await screen.findByText("Document search flow")).not.toBeNull();

    reload();
    expect(await screen.findByText("Document search flow")).not.toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
  });

  it("keeps an absent query in the Search box and repeats the empty state", async () => {
    const user = userEvent.setup();
    await openSeededRepository(user);

    await submitSearch(user, "no-such-token");
    await user.click(await screen.findByRole("link", { name: "Code" }));

    expect(await screen.findByText("No code results")).not.toBeNull();
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe(
      "no-such-token",
    );

    await user.click(screen.getByRole("link", { name: "Acme Demo/acme-docs" }));
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await submitSearch(user, "no-such-token");
    await user.click(await screen.findByRole("link", { name: "Code" }));
    expect(await screen.findByText("No code results")).not.toBeNull();
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe(
      "no-such-token",
    );
  });

  it("keeps the repository scope: the same query outside a repository searches repositories", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "acme-docs" });

    await submitSearch(user, "search flow");
    expect(await screen.findByText("No results")).not.toBeNull();
    expect(screen.queryByText("No code results")).toBeNull();
  });
});
