import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BranchSelector } from "./BranchSelector";

const mocks = vi.hoisted(() => ({
  getRepositoryBranches: vi.fn(),
  createRepositoryBranch: vi.fn(),
}));

vi.mock("./api", () => ({
  getRepositoryBranches: mocks.getRepositoryBranches,
  createRepositoryBranch: mocks.createRepositoryBranch,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "#/repos/acme-demo/acme-docs/tree?branch=main";
  mocks.getRepositoryBranches.mockResolvedValue(["main", "feature-search"]);
});

afterEach(() => {
  cleanup();
});

const renderSelector = (props: { currentBranch?: string; canCreate?: boolean } = {}) =>
  render(
    <BranchSelector
      owner="acme-demo"
      name="acme-docs"
      currentBranch={props.currentBranch ?? "main"}
      canCreate={props.canCreate ?? false}
    />,
  );

describe("BranchSelector", () => {
  it("lists branches as options and marks the current branch", async () => {
    const user = userEvent.setup();
    renderSelector();

    const trigger = screen.getByRole("button", { name: "Branch main" });
    await user.click(trigger);

    const listbox = await screen.findByRole("listbox", { name: "Branches" });
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["✓main", "feature-search"]);
    expect(screen.getByRole("option", { name: "main" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "feature-search" }).getAttribute("aria-selected")).toBe("false");
    expect(listbox).toBeTruthy();
  });

  it("filters options while typing and switches the page branch on click", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const input = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(input, "feature");

    expect(screen.queryByRole("option", { name: "main" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "feature-search" }));

    expect(window.location.hash).toBe("#/repos/acme-demo/acme-docs/tree?branch=feature-search");
  });

  it("shows No matching branch for an unmatched query and Escape closes without changes", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const input = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(input, "nosuchbranch");

    expect(await screen.findByText("No matching branch")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull();
    expect(window.location.hash).toBe("#/repos/acme-demo/acme-docs/tree?branch=main");
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
  });

  it("shows Invalid branch for an invalid name and cannot create", async () => {
    const user = userEvent.setup();
    renderSelector({ canCreate: true });

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const input = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(input, "invalid..branch");

    expect(await screen.findByText("Invalid branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Create branch: invalid..branch" })).toBeNull();
  });

  it("offers Create branch for a valid unused name and creates from the current head", async () => {
    const user = userEvent.setup();
    mocks.createRepositoryBranch.mockResolvedValue({
      ok: true,
      branch: { name: "feature/api-v2", commitId: "c2", createdBy: "alice-dev", createdAt: "2026-09-01T00:00:00.000Z" },
    });
    renderSelector({ canCreate: true });

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const input = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(input, "feature/api-v2");

    expect(await screen.findByText("Base: main")).toBeTruthy();
    const option = await screen.findByRole("option", { name: "Create branch: feature/api-v2" });
    await user.click(option);

    expect(mocks.createRepositoryBranch).toHaveBeenCalledWith("acme-demo", "acme-docs", {
      name: "feature/api-v2",
      base: "main",
    });
    await waitFor(() =>
      expect(window.location.hash).toBe("#/repos/acme-demo/acme-docs/tree?branch=feature%2Fapi-v2"),
    );
  });

  it("does not offer branch creation to non-writable users", async () => {
    const user = userEvent.setup();
    renderSelector({ canCreate: false });

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const input = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(input, "newbranch");

    expect(await screen.findByText("No matching branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Create branch: newbranch" })).toBeNull();
  });

  it("does not offer creation for an existing branch name", async () => {
    const user = userEvent.setup();
    renderSelector({ canCreate: true });

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const input = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(input, "main");

    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Create branch: main" })).toBeNull();
  });

  it("displays the creation error and stays on the current branch when creation fails", async () => {
    const user = userEvent.setup();
    mocks.createRepositoryBranch.mockResolvedValue({
      ok: false,
      errors: { general: "You do not have permission to create a branch" },
    });
    renderSelector({ canCreate: true });

    await user.click(screen.getByRole("button", { name: "Branch main" }));
    const input = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(input, "feature/x");
    await user.click(await screen.findByRole("option", { name: "Create branch: feature/x" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "You do not have permission to create a branch",
    );
    expect(window.location.hash).toBe("#/repos/acme-demo/acme-docs/tree?branch=main");
  });
});
