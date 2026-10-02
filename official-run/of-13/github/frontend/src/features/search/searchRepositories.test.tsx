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
      files: [{ path: "README.md", content: "# Acme Docs\n" }],
    },
    {
      name: "secret-research",
      description: "Private research notes.",
      visibility: "private",
      defaultBranch: "main",
      files: [{ path: "README.md", content: "# Secret research\n" }],
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

describe("REQ-3-1 search for and locate repositories", () => {
  it("searches from the global box and opens the matching repository", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");

    const box = await screen.findByRole("searchbox", { name: "Search" });
    expect(box).toBeTruthy();
    await user.type(box, "acme");
    await user.type(box, "{Enter}");

    // Repository results appear without selecting a type filter first.
    const result = await screen.findByRole("link", { name: "acme-docs" });
    expect(screen.getByText("acme-demo/acme-docs")).toBeTruthy();
    expect(screen.getByText("Documentation for the Acme Demo platform.")).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText(/Updated/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    // The results page offers the repository type filter explicitly.
    const repositories = screen.getByRole("link", { name: "Repositories" });
    expect(repositories.getAttribute("aria-current")).toBe("page");
    await user.click(repositories);
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();

    await user.click(result);
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();

    // Reopening the overview address keeps the same repository state.
    cleanup();
    renderApp("#/repositories/acme-demo/acme-docs");
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
  });

  it("shows no result link for an unauthorized private repository", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");

    await search(user, "secret-research");

    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    // The same query repeated from the home page again shows no results.
    window.location.hash = "#/";
    await search(user, "secret-research");
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
  });

  it("keeps the results page free of stale results when the query or filter changes", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");

    await search(user, "acme");
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();

    // Switching to a non-matching type filter drops the repository result.
    await user.click(screen.getByRole("link", { name: "Issues" }));
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "Repositories" }));
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();

    // Clearing the search term also drops the previous result.
    await search(user, "");
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
  });

  it("lists the repository visibility and update time in the result", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");

    await search(user, "acme-docs");
    const link = await screen.findByRole("link", { name: "acme-docs" });
    const item = link.closest("article") as HTMLElement;
    expect(within(item).getByText("acme-demo/acme-docs")).toBeTruthy();
    expect(within(item).getByText("Public")).toBeTruthy();
    expect(within(item).getByText(/Updated/)).toBeTruthy();
  });
});
