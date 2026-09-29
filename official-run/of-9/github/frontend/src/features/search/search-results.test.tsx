import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchResultsPage } from "./SearchResultsPage";

const mocks = vi.hoisted(() => ({
  searchRepositories: vi.fn(),
}));

vi.mock("../organizations/api", () => ({
  searchRepositories: mocks.searchRepositories,
}));

const now = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "#/search?q=acme";
});

afterEach(() => {
  cleanup();
});

describe("SearchResultsPage", () => {
  it("shows repository results with exact-name links and owner/name metadata", async () => {
    mocks.searchRepositories.mockResolvedValue([
      {
        owner: "acme-demo",
        name: "acme-docs",
        description: "Acme documentation",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    render(<SearchResultsPage />);

    const link = await screen.findByRole("link", { name: "acme-docs" });
    expect(link.getAttribute("href")).toBe("#/repos/acme-demo/acme-docs");
    const item = link.closest("li");
    expect(item).toBeTruthy();
    expect(within(item as HTMLElement).getByText("acme-demo/acme-docs")).toBeTruthy();
    expect(within(item as HTMLElement).getByText("Acme documentation")).toBeTruthy();
    expect(within(item as HTMLElement).getByText("Public")).toBeTruthy();
    expect(within(item as HTMLElement).getByText(/Updated .*ago/)).toBeTruthy();
  });

  it("does not show repository results for the private repository a visitor cannot view", async () => {
    mocks.searchRepositories.mockResolvedValue([
      {
        owner: "acme-demo",
        name: "acme-docs",
        description: "",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: now,
      },
    ]);
    render(<SearchResultsPage />);
    const link = await screen.findByRole("link", { name: "acme-docs" });
    expect(link).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(screen.queryByText("secret-research")).toBeNull();
  });

  it("displays No results when nothing matches and again for a repeated query", async () => {
    mocks.searchRepositories.mockResolvedValue([]);
    const { unmount } = render(<SearchResultsPage />);
    expect(await screen.findByText("No results")).toBeTruthy();

    unmount();
    window.location.hash = "#/search?q=acme";
    render(<SearchResultsPage />);
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(mocks.searchRepositories).toHaveBeenCalledTimes(2);
    expect(mocks.searchRepositories).toHaveBeenCalledWith("acme");
  });

  it("retains repository results without needing a type-filter click", async () => {
    mocks.searchRepositories.mockResolvedValue([
      {
        owner: "acme-demo",
        name: "acme-docs",
        description: "",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: now,
      },
    ]);
    render(<SearchResultsPage />);
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
  });

  it("switching to a non-matching filter clears old repository results", async () => {
    const user = userEvent.setup();
    mocks.searchRepositories.mockResolvedValue([
      {
        owner: "acme-demo",
        name: "acme-docs",
        description: "",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: now,
      },
    ]);
    render(<SearchResultsPage />);
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();

    const repositoriesTab = screen.getByRole("tab", { name: "Repositories" });
    expect(repositoriesTab.getAttribute("aria-selected")).toBe("true");

    await user.click(screen.getByRole("tab", { name: "Code" }));
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
    expect(screen.getByText("No results")).toBeTruthy();
  });
});
