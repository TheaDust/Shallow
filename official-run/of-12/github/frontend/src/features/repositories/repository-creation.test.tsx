import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createRepositoryMock, type MockRepositoryServer } from "../../test/repository-server-mock";

let server: MockRepositoryServer;

beforeEach(() => {
  server = createRepositoryMock({ viewer: "alice-dev" });
  window.location.hash = "#/workspace";
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

function lastRequest(method: string, path: string) {
  return [...server.state.requests].reverse().find(
    (request) => request.method === method && request.path === path,
  );
}

describe("REQ-3-2-1 create a repository with owner, visibility and initialization", () => {
  it("creates an initialized private repository from the workspace entry", async () => {
    render(<App />);
    const entry = await screen.findByRole("link", { name: "New repository" });
    expect(entry.getAttribute("href")).toBe("#/new");
    await userEvent.click(entry);

    // The personal namespace is the default owner, so the form can be
    // submitted without touching the Owner field.
    const owner = await screen.findByLabelText("Owner");
    expect(owner).toHaveProperty("value", "alice-dev");
    expect(screen.getByLabelText("Repository name")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Public" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "Private" })).toHaveProperty("checked", false);
    expect(screen.getByRole("checkbox", { name: "Add a README file" })).toHaveProperty("checked", false);

    await userEvent.type(screen.getByLabelText("Repository name"), "playwright-notes");
    await userEvent.type(screen.getByLabelText("Description"), "Repository created by Playwright");
    await userEvent.click(screen.getByRole("radio", { name: "Private" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await userEvent.click(screen.getByRole("button", { name: "Create repository" }));

    const heading = await screen.findByRole("heading", { name: "alice-dev/playwright-notes" });
    expect(heading.tagName).toBe("H1");
    expect(screen.getByText("Private")).toBeTruthy();
    const readme = screen.getByRole("link", { name: "README.md" });
    expect(readme.getAttribute("href")).toBe("#/alice-dev/playwright-notes/blob/main/README.md");

    const created = lastRequest("POST", "/api/repositories");
    expect(created?.body).toMatchObject({
      owner: "alice-dev",
      name: "playwright-notes",
      description: "Repository created by Playwright",
      visibility: "private",
      initialize: true,
    });

    // The overview keeps its state after a reload, and the repository is listed
    // in the target owner's repository list.
    cleanup();
    window.location.hash = "#/alice-dev/playwright-notes";
    server.install();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/playwright-notes" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    // The repository also appears in the target owner's repository list.
    cleanup();
    window.location.hash = "#/alice-dev";
    server.install();
    render(<App />);
    const list = await screen.findByRole("region", { name: "Repositories" });
    expect(within(list).getByRole("link", { name: "playwright-notes" })).toBeTruthy();

    // The initialized default branch carries the initial commit.
    cleanup();
    window.location.hash = "#/alice-dev/playwright-notes/commits";
    server.install();
    render(<App />);
    expect(await screen.findByText("Initial commit")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "alice-dev/playwright-notes" })).toBeTruthy();
  });

  it("stays on the form for a duplicated and an empty repository name", async () => {
    window.location.hash = "#/new";
    render(<App />);
    await screen.findByLabelText("Repository name");

    await userEvent.type(screen.getByLabelText("Repository name"), "acme-docs");
    await userEvent.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Repository name already exists");
    // The form stays open instead of opening the existing repository.
    expect(screen.getByRole("heading", { name: "Create a new repository" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "alice-dev/acme-docs" })).toBeNull();

    await userEvent.clear(screen.getByLabelText("Repository name"));
    await userEvent.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Repository name is required");
    // The failed attempts stored nothing: the namespace still owns only the
    // seeded `acme-docs`, `acme-docs-fork`, `merge-lab` and `secret-research`.
    expect(server.state.repositories.filter((repository) => repository.owner === "alice-dev")).toHaveLength(4);
  });
});

describe("REQ-3-2-2 fork a repository into another namespace", () => {
  it("creates a fork with its source link from the source overview", async () => {
    reset("bob-reviewer", "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    await userEvent.click(screen.getByRole("button", { name: "Fork" }));
    const name = await screen.findByLabelText("Repository name");
    expect(name).toHaveProperty("value", "acme-docs");
    expect(screen.getByLabelText("Owner")).toHaveProperty("value", "bob-reviewer");

    await userEvent.clear(name);
    await userEvent.type(name, "acme-docs-copy");
    await userEvent.click(screen.getByRole("button", { name: "Create fork" }));

    expect(await screen.findByRole("heading", { name: "bob-reviewer/acme-docs-copy" })).toBeTruthy();
    expect(screen.getByText(/Forked from/)).toBeTruthy();
    const sourceLink = screen.getByRole("link", { name: "acme-docs" });
    expect(sourceLink.getAttribute("href")).toBe("#/alice-dev/acme-docs");

    // The heading and the source relationship survive a reload.
    cleanup();
    server.install();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "bob-reviewer/acme-docs-copy" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "acme-docs" })).toBeTruthy();
  });

  it("rejects an existing fork name in the target personal namespace", async () => {
    window.location.hash = "#/alice-dev/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    await userEvent.click(screen.getByRole("button", { name: "Fork" }));
    const name = await screen.findByLabelText("Repository name");
    await userEvent.clear(name);
    await userEvent.type(name, "acme-docs-fork");
    await userEvent.click(screen.getByRole("button", { name: "Create fork" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Repository name already exists");
    expect(screen.getByRole("heading", { name: "Create a new fork" })).toBeTruthy();
    expect(server.state.repositories.filter((repository) => repository.name === "acme-docs-fork")).toHaveLength(1);
  });

  it("keeps a fork of a private repository private", async () => {
    reset("bob-reviewer", "#/alice-dev/secret-research");
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/secret-research" });

    await userEvent.click(screen.getByRole("button", { name: "Fork" }));
    const publicChoice = await screen.findByRole("radio", { name: "Public" });
    expect(publicChoice).toHaveProperty("disabled", true);
    expect(screen.getByRole("radio", { name: "Private" })).toHaveProperty("checked", true);

    await userEvent.click(screen.getByRole("button", { name: "Create fork" }));
    expect(await screen.findByRole("heading", { name: "bob-reviewer/secret-research" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText(/Forked from/)).toBeTruthy();
  });

  it("asks a visitor to sign in instead of creating a fork", async () => {
    reset(null, "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    await userEvent.click(screen.getByRole("button", { name: "Fork" }));
    expect(await screen.findByText(/You need to sign in to fork this repository/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create fork" })).toBeNull();
  });
});

describe("REQ-3-2-3 copy a repository clone value", () => {
  it("copies the selected protocol value and reports Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    reset(null, "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    await userEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByRole("tab", { name: "HTTPS" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Copy clone value" }));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("https://github.local/alice-dev/acme-docs.git");

    await userEvent.click(screen.getByRole("tab", { name: "SSH" }));
    expect(screen.getByText("git@github.local:alice-dev/acme-docs.git")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Copy clone value" }));
    expect(writeText).toHaveBeenLastCalledWith("git@github.local:alice-dev/acme-docs.git");

    // The repository heading and the selected protocol stay visible.
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(screen.getByText("Copied")).toBeTruthy();
  });
});

describe("REQ-3-4 change repository visibility with permission checks", () => {
  it("reaches the Danger Zone through Settings and General", async () => {
    window.location.hash = "#/alice-dev/secret-research";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/secret-research" });

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "General" }));

    expect(await screen.findByRole("heading", { name: "Danger Zone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change visibility" })).toBeTruthy();
  });

  it("publishes a private repository through the confirmation flow", async () => {
    window.location.hash = "#/alice-dev/secret-research/settings/general";
    render(<App />);
    await screen.findByRole("button", { name: "Change visibility" });
    expect(screen.queryByRole("heading", { name: "alice-dev/secret-research" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change visibility" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Public" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    // The overview of the repository reports the new visibility.
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();

    const changed = lastRequest("POST", "/api/repositories/alice-dev/secret-research/visibility");
    expect(changed?.body).toMatchObject({ visibility: "public" });

    // Refreshing the settings page keeps the new visibility.
    cleanup();
    window.location.hash = "#/alice-dev/secret-research/settings/general";
    server.install();
    render(<App />);
    expect(await screen.findByText(/This repository is Public/)).toBeTruthy();
  });

  it("keeps the visibility when the typed confirmation does not match", async () => {
    window.location.hash = "#/alice-dev/acme-docs-fork/settings/general";
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Change visibility" }));

    const dialog = await screen.findByRole("dialog", { name: "Change visibility" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Public" }));
    await userEvent.type(within(dialog).getByLabelText("Repository name"), "not-the-name");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Confirmation text does not match the repository name",
    );
    expect(server.state.repositories.find((repository) => repository.name === "acme-docs-fork")?.visibility)
      .toBe("private");
  });

  it("does not offer the visibility change to a non-Admin collaborator", async () => {
    reset("bob-reviewer", "#/alice-dev/secret-research/settings/general");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Danger Zone" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
    expect(screen.getByText(/Only a repository Admin can change the visibility/)).toBeTruthy();
  });
});
