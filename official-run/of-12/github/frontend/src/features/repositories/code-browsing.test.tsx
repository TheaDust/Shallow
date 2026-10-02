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

/** Opens the branch selector of the current Code page and picks a branch. */
async function switchBranch(next: string) {
  await userEvent.click(await screen.findByRole("button", { name: /^Branch / }));
  await userEvent.click(await screen.findByRole("option", { name: next }));
}

function acmeDocs() {
  return server.state.repositories.find((repository) => repository.name === "acme-docs")!;
}

describe("REQ-4-1 browse repository files and directories", () => {
  it("browses a nested directory and opens the text file inside it", async () => {
    window.location.hash = "#/alice-dev/acme-docs";
    render(<App />);

    // The Code page names the current branch and lists the files of its root.
    const selector = await screen.findByRole("button", { name: "Branch main" });
    expect(selector).toBeTruthy();
    const directory = await screen.findByRole("link", { name: "docs" });
    expect(directory.getAttribute("href")).toBe("#/alice-dev/acme-docs/tree/main/docs");

    await userEvent.click(directory);
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/tree/main/docs");

    // The directory page shows the current path and the file inside it.
    const breadcrumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumbs).getByText("docs")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    const file = within(screen.getByRole("region", { name: "Files" })).getByRole("link", { name: "intro.md" });
    expect(file.getAttribute("href")).toBe("#/alice-dev/acme-docs/blob/main/docs/intro.md");

    await userEvent.click(file);
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/blob/main/docs/intro.md");

    // The file page shows the full path, the branch and the stored content.
    expect(await screen.findByRole("heading", { name: "docs/intro.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    const article = screen.getByRole("article", { name: "docs/intro.md" });
    expect(within(article).getByText(/This is the introduction to the Acme Demo documentation/)).toBeTruthy();
    expect(screen.getByText("Document search flow")).toBeTruthy();

    // The breadcrumbs return to the parent directory.
    const parent = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "docs" });
    await userEvent.click(parent);
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/tree/main/docs");
    expect(await screen.findByRole("link", { name: "intro.md" })).toBeTruthy();
  });

  it("keeps the branch, path and content of a file page after a reload", async () => {
    window.location.hash = "#/alice-dev/acme-docs/blob/main/docs/intro.md";
    render(<App />);
    expect(await screen.findByRole("article", { name: "docs/intro.md" })).toBeTruthy();

    cleanup();
    server.install();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "docs/intro.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(
      within(screen.getByRole("article", { name: "docs/intro.md" })).getByText(
        /This is the introduction to the Acme Demo documentation/,
      ),
    ).toBeTruthy();
  });

  it("does not display a file that the switched branch does not contain", async () => {
    window.location.hash = "#/alice-dev/acme-docs/blob/feature-search/main-only.md";
    render(<App />);
    expect(await screen.findByRole("article", { name: "main-only.md" })).toBeTruthy();

    await switchBranch("main");

    // The file page of the other branch reports the missing file instead of
    // showing the content of `feature-search`.
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/blob/main/main-only.md");
    expect(await screen.findByText("This file does not exist on branch main.")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "main-only.md" })).toBeNull();
    expect(screen.queryByText(/This file exists only on the feature-search branch/)).toBeNull();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();

    // Reloading keeps that state and does not modify the file on `main`.
    cleanup();
    window.location.hash = "#/alice-dev/acme-docs/blob/main/docs/intro.md";
    server.install();
    render(<App />);
    expect(await screen.findByRole("article", { name: "docs/intro.md" })).toBeTruthy();
  });

  it("lists the files of the selected branch and only offers its branches", async () => {
    reset("visitor", "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("button", { name: "Branch main" });

    await switchBranch("feature-search");
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/code/feature-search");
    const files = await screen.findByRole("region", { name: "Files" });
    expect(within(files).getByRole("link", { name: "main-only.md" })).toBeTruthy();
    expect(within(files).queryByRole("link", { name: "intro.md" })).toBeNull();

    // Typing narrows the branch options of the selector.
    await userEvent.click(screen.getByRole("button", { name: "Branch feature-search" }));
    const search = await screen.findByRole("textbox", { name: "Find branch" });
    await userEvent.type(search, "no-such-branch");
    expect(screen.getByText("No matching branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull();
    expect(screen.getByRole("button", { name: "Branch feature-search" })).toBeTruthy();
  });
});

describe("REQ-4-4 manage repository files through the web interface", () => {
  it("creates a file through Add file and shows the exact saved content", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    await userEvent.click(await screen.findByRole("button", { name: "Add file" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Create new file" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/new/main");

    const editor = await screen.findByRole("form", { name: "Create new file" });
    expect(within(editor).getByLabelText("File name")).toHaveProperty("value", "");
    expect(within(editor).getByLabelText("File contents")).toHaveProperty("value", "");
    expect(within(editor).getByLabelText("Commit message")).toHaveProperty("value", "");

    await userEvent.type(within(editor).getByLabelText("File name"), "pw-file-abc123.md");
    await userEvent.type(within(editor).getByLabelText("File contents"), "Playwright created this file.\n");
    await userEvent.type(within(editor).getByLabelText("Commit message"), "Add pw-file-abc123.md");
    await userEvent.click(within(editor).getByRole("button", { name: "Commit changes" }));

    // The submit is blocking: the stored file address is already active when
    // the handler returns, so a reload in the next moment reads the file.
    expect(window.location.hash.startsWith("#/alice-dev/acme-docs/blob/main/pw-file-abc123.md")).toBe(true);

    // The view that opens right after shows the exact stored content.
    expect(await screen.findByRole("heading", { name: "pw-file-abc123.md" })).toBeTruthy();
    expect(window.location.hash.startsWith("#/alice-dev/acme-docs/blob/main/pw-file-abc123.md")).toBe(true);
    expect(
      within(screen.getByRole("article", { name: "pw-file-abc123.md" })).getByText(/Playwright created this file\./),
    ).toBeTruthy();

    const created = acmeDocs();
    const head = created.branches.find((branch) => branch.name === "main")!.headId;
    const commit = created.commits.find((candidate) => candidate.id === head)!;
    expect(commit.message).toBe("Add pw-file-abc123.md");
    expect(commit.author).toBe("alice-dev");
    expect(commit.files).toEqual([{ path: "pw-file-abc123.md", change: "added" }]);
    expect(commit.parentId).toBe("9c3e5b1-acme-docs-search");

    // The Commits link opens history holding the exact submitted message.
    await userEvent.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByText("Add pw-file-abc123.md")).toBeTruthy();
    expect(await screen.findByText("Document search flow")).toBeTruthy();

    // The new file and the commit survive a reload.
    cleanup();
    window.location.hash = "#/alice-dev/acme-docs/blob/main/pw-file-abc123.md";
    server.install();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "pw-file-abc123.md" })).toBeTruthy();
  });

  it("reports an invalid path and a missing commit message without changing files or history", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/new/main");
    render(<App />);

    const editor = await screen.findByRole("form", { name: "Create new file" });
    const before = acmeDocs();
    const headBefore = before.branches.find((branch) => branch.name === "main")!.headId;
    const commitsBefore = before.commits.length;

    await userEvent.type(within(editor).getByLabelText("File name"), "../invalid.md");
    await userEvent.type(within(editor).getByLabelText("File contents"), "must not be saved");
    await userEvent.click(within(editor).getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Invalid file path")).toBeTruthy();
    expect(screen.getByText("Commit message is required")).toBeTruthy();
    // The editor stays open and nothing was stored.
    expect(screen.getByRole("form", { name: "Create new file" })).toBeTruthy();
    expect(acmeDocs().commits.length).toBe(commitsBefore);
    expect(acmeDocs().branches.find((branch) => branch.name === "main")!.headId).toBe(headBefore);
    expect(acmeDocs().commits.some((commit) => commit.tree.some((file) => file.path === "../invalid.md"))).toBe(false);
  });

  it("edits an existing file and records the change as a new commit", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/blob/main/docs/intro.md");
    render(<App />);
    await screen.findByRole("article", { name: "docs/intro.md" });

    await userEvent.click(screen.getByRole("link", { name: "Edit" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/edit/main/docs/intro.md");
    const editor = await screen.findByRole("form", { name: "Edit file" });
    await waitFor(() => {
      expect(within(editor).getByLabelText("File name")).toHaveProperty("value", "docs/intro.md");
      expect(within(editor).getByLabelText("File contents")).toHaveProperty(
        "value",
        expect.stringContaining("This is the introduction"),
      );
    });

    await userEvent.clear(within(editor).getByLabelText("File contents"));
    await userEvent.type(within(editor).getByLabelText("File contents"), "# Introduction\n\nRewritten introduction.\n");
    await userEvent.type(within(editor).getByLabelText("Commit message"), "Rewrite the introduction");
    await userEvent.click(within(editor).getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByRole("heading", { name: "docs/intro.md" })).toBeTruthy();
    expect(
      within(screen.getByRole("article", { name: "docs/intro.md" })).getByText(/Rewritten introduction\./),
    ).toBeTruthy();
    // The earlier content of the branch is not rewritten: the old commit keeps
    // its own snapshot.
    const previous = acmeDocs().commits.find((commit) => commit.id === "9c3e5b1-acme-docs-search")!;
    expect(previous.tree.find((file) => file.path === "docs/intro.md")?.content).toContain("This is the introduction");
  });

  it("only offers the editor entries to an account that may write", async () => {
    reset("dana-observer", "#/alice-dev/acme-docs");
    render(<App />);
    await screen.findByRole("button", { name: "Branch main" });

    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();

    // The editor address itself reports the missing permission.
    cleanup();
    window.location.hash = "#/alice-dev/acme-docs/new/main";
    server.install();
    render(<App />);
    expect(
      await screen.findByText("You do not have permission to edit files in this repository."),
    ).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Create new file" })).toBeNull();
  });
});
