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

const headOf = (name: string) => acmeDocs().branches.find((branch) => branch.name === name)?.headId;

async function openSelector() {
  await userEvent.click(await screen.findByRole("button", { name: /^Branch / }));
  return screen.findByRole("textbox", { name: "Find branch" });
}

describe("REQ-4-3-1 list and switch repository branches", () => {
  it("lists the branches, marks the current one and switches the files of the page", async () => {
    reset("visitor", "#/alice-dev/acme-docs");
    render(<App />);
    const selector = await screen.findByRole("button", { name: "Branch main" });
    expect(selector.getAttribute("aria-expanded")).toBe("false");

    const search = await openSelector();
    // Every branch is offered by its exact name and the current branch is marked.
    const current = screen.getByRole("option", { name: "main" });
    expect(current.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "feature-search" }).getAttribute("aria-selected")).toBe("false");

    // Typing narrows the matching options without an Enter press.
    await userEvent.type(search, "feat");
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: "feature-search" }));

    // The button, the address and the file list switch to the target branch.
    expect(screen.getByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/code/feature-search");
    const files = await screen.findByRole("region", { name: "Files" });
    expect(within(files).getByRole("link", { name: "main-only.md" })).toBeTruthy();

    // Selecting the active branch again restores its own file list: the file
    // only `feature-search` carries disappears.
    await userEvent.click(screen.getByRole("button", { name: "Branch feature-search" }));
    await userEvent.click(await screen.findByRole("option", { name: "main" }));
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull());

    // Switching branches created no commit and moved no branch head.
    expect(acmeDocs().commits.length).toBe(5);
    expect(headOf("main")).toBe("9c3e5b1-acme-docs-search");
    expect(headOf("feature-search")).toBe("d7b2a08-acme-docs-branch-only");
  });

  it("shows the empty state for an unmatched query and keeps the branch after a reload", async () => {
    reset("visitor", "#/alice-dev/acme-docs/blob/main/README.md");
    render(<App />);
    await screen.findByRole("article", { name: "README.md" });

    const search = await openSelector();
    await userEvent.type(search, "no-such-branch");
    expect(screen.getByText("No matching branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();

    // Escape closes the selector and the active branch stays the same.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();

    cleanup();
    server.install();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/blob/main/README.md");
  });
});

describe("REQ-4-3-2 create a branch from an existing revision", () => {
  it("offers the creation entry while typing and switches to the created branch", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("button", { name: "Branch main" });

    const search = await openSelector();
    await userEvent.type(search, "feature/api-v2");

    // A valid unused name offers its creation entry, addressed at the base the
    // selector displays (the current branch).
    expect(screen.getByText(/Base/)).toBeTruthy();
    const create = await screen.findByRole("option", { name: "Create branch: feature/api-v2" });
    expect(screen.queryByText("Invalid branch")).toBeNull();
    await userEvent.click(create);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Branch feature/api-v2" })).toBeTruthy();
    });
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/code/feature%2Fapi-v2");

    // The new reference points at the head of `main`; nothing was copied or
    // rewritten and the original history is untouched.
    expect(headOf("feature/api-v2")).toBe("9c3e5b1-acme-docs-search");
    expect(headOf("main")).toBe("9c3e5b1-acme-docs-search");
    expect(acmeDocs().commits.length).toBe(5);

    // The file list of the new branch reads the snapshot of its base commit.
    const files = await screen.findByRole("region", { name: "Files" });
    expect(within(files).getByRole("link", { name: "README.md" })).toBeTruthy();

    // The selector lists the new branch next to the existing ones.
    await openSelector();
    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "feature/api-v2" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{Escape}");

    // Reloading the page entry keeps the newly created branch selected.
    cleanup();
    server.install();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Branch feature/api-v2" })).toBeTruthy();
    const reloaded = await screen.findByRole("region", { name: "Files" });
    expect(within(reloaded).getByRole("link", { name: "README.md" })).toBeTruthy();
  });

  it("reports an invalid name immediately and creates nothing", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("button", { name: "Branch main" });

    const search = await openSelector();
    await userEvent.type(search, "invalid..branch");
    expect(await screen.findByText("Invalid branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /^Create branch:/ })).toBeNull();

    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(acmeDocs().branches.map((branch) => branch.name)).toEqual([
      "main",
      "feature-search",
      "release",
      "onboarding-docs",
      "draft-feature",
    ]);
    expect(acmeDocs().commits.length).toBe(5);
  });

  it("keeps a name that already exists a selectable branch instead of a creation entry", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("button", { name: "Branch main" });

    const search = await openSelector();
    await userEvent.type(search, "feature-search");
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Create branch: feature-search" })).toBeNull();
  });

  it("does not offer branch creation to a viewer without Write permission", async () => {
    reset("visitor", "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("button", { name: "Branch main" });

    const search = await openSelector();
    await userEvent.type(search, "brand-new-branch");
    expect(await screen.findByText("No matching branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Create branch: brand-new-branch" })).toBeNull();
  });
});

describe("REQ-4-3-3 change the repository default branch", () => {
  it("changes the default branch through Settings, Branches, Update and Confirm", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/blob/main/README.md");
    render(<App />);
    await screen.findByRole("article", { name: "README.md" });

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/settings");
    await userEvent.click(await screen.findByRole("link", { name: "Branches" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/settings/branches");

    // The native combobox offers exactly the existing branch names.
    const select = (await screen.findByRole("combobox", { name: "Default branch" })) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "main",
      "feature-search",
      "release",
      "onboarding-docs",
      "draft-feature",
    ]);
    expect(select.value).toBe("main");
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();

    await userEvent.selectOptions(select, "release");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(acmeDocs().defaultBranch).toBe("release");
    });
    // The previous default branch and every commit stay available.
    expect(headOf("main")).toBe("9c3e5b1-acme-docs-search");
    expect(acmeDocs().commits.length).toBe(5);

    // Opening the repository entry without a branch reads the new default.
    await userEvent.click(screen.getByRole("link", { name: /alice-dev\/acme-docs$/ }));
    expect(await screen.findByRole("button", { name: "Branch release" })).toBeTruthy();
    const search = await openSelector();
    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
  });

  it("keeps the stored default branch after the settings page is reloaded", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/settings/branches");
    render(<App />);
    const select = (await screen.findByRole("combobox", { name: "Default branch" })) as HTMLSelectElement;
    await userEvent.selectOptions(select, "release");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(acmeDocs().defaultBranch).toBe("release");
    });

    cleanup();
    server.install();
    render(<App />);
    const reloaded = (await screen.findByRole("combobox", { name: "Default branch" })) as HTMLSelectElement;
    await waitFor(() => {
      expect(reloaded.value).toBe("release");
    });
  });

  it("offers no default-branch update to a non-Admin or a visitor", async () => {
    reset("bob-reviewer", "#/alice-dev/acme-docs/settings/branches");
    render(<App />);
    await screen.findByRole("heading", { name: "Branches" });
    expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(acmeDocs().defaultBranch).toBe("main");

    cleanup();
    window.location.hash = "#/alice-dev/acme-docs/settings/branches";
    server = createRepositoryMock({ viewer: null });
    server.install();
    render(<App />);
    await screen.findByRole("heading", { name: "Branches" });
    expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });
});
