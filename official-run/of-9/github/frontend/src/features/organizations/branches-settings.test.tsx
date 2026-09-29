import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BranchesPage } from "./BranchesPage";
import { SessionProvider } from "../auth/session";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  getRepository: vi.fn(),
  getRepositoryBranches: vi.fn(),
  updateRepositoryDefaultBranch: vi.fn(),
}));

vi.mock("../auth/api", () => ({
  fetchSession: mocks.fetchSession,
}));

vi.mock("./api", () => ({
  getRepository: mocks.getRepository,
  getRepositoryBranches: mocks.getRepositoryBranches,
  updateRepositoryDefaultBranch: mocks.updateRepositoryDefaultBranch,
}));

const repo = (defaultBranch: string, myRole: "admin" | "read") => ({
  owner: "acme-demo",
  name: "acme-docs",
  description: "Acme documentation",
  visibility: "public",
  defaultBranch,
  updatedAt: "2026-09-01T00:00:00.000Z",
  myRole,
  files: [],
  forkSource: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "#/repos/acme-demo/acme-docs/settings/branches";
  mocks.fetchSession.mockResolvedValue({
    authenticated: true,
    account: { username: "alice-dev", email: "alice.dev@example.test" },
  });
  mocks.getRepositoryBranches.mockResolvedValue(["main", "release"]);
});

afterEach(() => {
  cleanup();
});

function renderBranches() {
  return render(
    <SessionProvider>
      <BranchesPage owner="acme-demo" name="acme-docs" />
    </SessionProvider>,
  );
}

describe("BranchesPage", () => {
  it("renders the Default branch native select and updates after confirmation", async () => {
    const user = userEvent.setup();
    mocks.getRepository.mockResolvedValue(repo("main", "admin"));
    mocks.updateRepositoryDefaultBranch.mockResolvedValue(repo("release", "admin"));

    renderBranches();

    const select = await screen.findByRole("combobox", { name: "Default branch" });
    expect(select.tagName).toBe("SELECT");
    expect(Array.from(select.querySelectorAll("option")).map((option) => option.textContent)).toEqual([
      "main",
      "release",
    ]);
    expect((select as HTMLSelectElement).value).toBe("main");
    expect(screen.getByRole("link", { name: "Branches" })).toBeTruthy();

    await user.selectOptions(select, "release");
    await user.click(screen.getByRole("button", { name: "Update" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("release");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(mocks.updateRepositoryDefaultBranch).toHaveBeenCalledWith(
      "acme-demo",
      "acme-docs",
      "release",
    );
    expect(await screen.findByText("Default branch changed to release")).toBeTruthy();
    expect(await screen.findByRole("combobox", { name: "Default branch" })).toBeTruthy();
    expect(
      (screen.getByRole("combobox", { name: "Default branch" }) as HTMLSelectElement).value,
    ).toBe("release");
  });

  it("keeps the saved default branch after a reload", async () => {
    mocks.getRepository.mockResolvedValue(repo("release", "admin"));
    renderBranches();

    const select = await screen.findByRole("combobox", { name: "Default branch" });
    expect((select as HTMLSelectElement).value).toBe("release");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("denies non-admin users without the Default branch combobox or Update button", async () => {
    mocks.getRepository.mockResolvedValue(repo("main", "read"));
    renderBranches();

    await screen.findByRole("heading", { name: "Access denied" });
    expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });
});
