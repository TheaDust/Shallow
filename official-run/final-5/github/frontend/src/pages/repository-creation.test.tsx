import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
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

describe("REQ-3-2-1 create a repository with owner, visibility and initialization", () => {
  it("creates an initialized private repository and keeps it browsable after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "repo-owner");

    await user.click(await screen.findByRole("link", { name: "New repository" }));
    await screen.findByRole("heading", { name: "New repository" });

    await user.type(screen.getByLabelText("Repository name"), "notes-repo");
    await user.type(screen.getByLabelText("Description"), "Repository created by Playwright");
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    const heading = await screen.findByRole("heading", { name: "repo-owner/notes-repo" });
    expect(heading.textContent).toBe("repo-owner/notes-repo");
    expect(screen.getByText("Private")).not.toBeNull();
    expect(screen.getByText("Repository created by Playwright")).not.toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Commits" })).not.toBeNull();

    // The commit history holds the single initialization commit.
    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("heading", { name: "Commits" })).not.toBeNull();
    expect(screen.getByText("Initial commit")).not.toBeNull();

    // The README link opens the stored file of the default branch.
    await user.click(screen.getByRole("link", { name: "repo-owner/notes-repo" }));
    await screen.findByRole("heading", { name: "repo-owner/notes-repo" });
    await user.click(screen.getByRole("link", { name: "README.md" }));
    expect(await screen.findByRole("heading", { name: "README.md" })).not.toBeNull();
    expect(screen.getByText("# notes-repo")).not.toBeNull();

    // Owner, visibility, README and commit remain after reloading the overview.
    await user.click(screen.getByRole("link", { name: "repo-owner/notes-repo" }));
    await screen.findByRole("heading", { name: "repo-owner/notes-repo" });
    reload();
    expect(await screen.findByRole("heading", { name: "repo-owner/notes-repo" })).not.toBeNull();
    expect(screen.getByText("Private")).not.toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Commits" })).not.toBeNull();

    // And it is listed in that owner's repository list.
    await user.click(screen.getByRole("link", { name: "Home" }));
    await screen.findByRole("link", { name: "New repository" });
    const list = screen.getByRole("list", { name: "Repositories you can read" });
    expect(within(list).getByRole("link", { name: "notes-repo" })).not.toBeNull();
  });

  it("creates a repository in an organization namespace with the owner picker", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");

    await user.click(await screen.findByRole("link", { name: "New repository" }));
    await screen.findByRole("heading", { name: "New repository" });
    expect((screen.getByRole("combobox", { name: "Owner" }) as HTMLSelectElement).value).toBe(
      "account:account-org-owner",
    );

    // Native select path: the same control accepts a browser selectOption.
    await user.selectOptions(screen.getByRole("combobox", { name: "Owner" }), "organization:acme-demo");
    expect((screen.getByRole("combobox", { name: "Owner" }) as HTMLSelectElement).value).toBe(
      "organization:acme-demo",
    );

    await user.type(screen.getByLabelText("Repository name"), "org-notes");
    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByRole("heading", { name: "Acme Demo/org-notes" })).not.toBeNull();
  });

  it("selects the owner by clicking the visible option of the combobox", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");

    await user.click(await screen.findByRole("link", { name: "New repository" }));
    await screen.findByRole("heading", { name: "New repository" });

    await user.click(screen.getByRole("combobox", { name: "Owner" }));
    await user.click(await screen.findByRole("option", { name: "Acme Demo" }));
    expect((screen.getByRole("combobox", { name: "Owner" }) as HTMLSelectElement).value).toBe(
      "organization:acme-demo",
    );

    await user.type(screen.getByLabelText("Repository name"), "org-notes-two");
    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByRole("heading", { name: "Acme Demo/org-notes-two" })).not.toBeNull();
  });

  it("reports an empty name and a duplicate name without opening a repository", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "repo-owner");

    await user.click(await screen.findByRole("link", { name: "New repository" }));
    await screen.findByRole("heading", { name: "New repository" });

    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByText("Repository name is required")).not.toBeNull();

    await user.type(screen.getByLabelText("Repository name"), "acme-docs");
    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByText("Repository name already exists")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "repo-owner/acme-docs" })).toBeNull();
  });
});

describe("REQ-3-2-2 fork a repository into another namespace", () => {
  it("creates an independent fork with the source link and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "fork-user");

    await user.click(await screen.findByRole("link", { name: "acme-docs" }));
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Fork" }));
    await screen.findByRole("heading", { name: "Create a fork" });

    const nameField = screen.getByLabelText("Repository name");
    expect((nameField as HTMLInputElement).value).toBe("acme-docs");
    await user.clear(nameField);
    await user.type(nameField, "acme-docs-clone");
    await user.click(screen.getByRole("button", { name: "Create fork" }));

    expect(await screen.findByRole("heading", { name: "fork-user/acme-docs-clone" })).not.toBeNull();
    expect(screen.getByText(/Forked from/)).not.toBeNull();
    const sourceLink = screen.getByRole("link", { name: "acme-docs" });
    expect(sourceLink.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs");
    // The fork carries the readable default-branch files of the source.
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "fork-user/acme-docs-clone" })).not.toBeNull();
    expect(screen.getByText(/Forked from/)).not.toBeNull();

    // The source repository is untouched: its code page still holds the
    // seeded directory and the stored file content.
    await user.click(screen.getByRole("link", { name: "acme-docs" }));
    expect(await screen.findByRole("heading", { name: "Acme Demo/acme-docs" })).not.toBeNull();
    await user.click(screen.getByRole("link", { name: "Code" }));
    await user.click(await screen.findByRole("link", { name: "src" }));
    await user.click(await screen.findByRole("link", { name: "README.md" }));
    expect(await screen.findByText("Document search flow")).not.toBeNull();
  });

  it("keeps a private source fork private and offers only the allowed visibility", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");

    await user.click(await screen.findByRole("link", { name: "visibility-demo" }));
    await screen.findByRole("heading", { name: "Acme Demo/visibility-demo" });
    await user.click(screen.getByRole("button", { name: "Fork" }));
    await screen.findByRole("heading", { name: "Create a fork" });

    const privateChoice = screen.getByRole("radio", { name: "Private" }) as HTMLInputElement;
    const publicChoice = screen.getByRole("radio", { name: "Public" }) as HTMLInputElement;
    expect(privateChoice.checked).toBe(true);
    expect(publicChoice.disabled).toBe(true);

    await user.clear(screen.getByLabelText("Repository name"));
    await user.type(screen.getByLabelText("Repository name"), "visibility-demo-fork");
    await user.click(screen.getByRole("button", { name: "Create fork" }));

    expect(await screen.findByRole("heading", { name: "org-owner/visibility-demo-fork" })).not.toBeNull();
    expect(screen.getByText("Private")).not.toBeNull();
    expect(screen.getByText(/Forked from/)).not.toBeNull();
  });

  it("reports the fork name conflict and creates nothing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "fork-user");

    await user.click(await screen.findByRole("link", { name: "acme-docs" }));
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Fork" }));
    await screen.findByRole("heading", { name: "Create a fork" });

    const nameField = screen.getByLabelText("Repository name");
    await user.clear(nameField);
    await user.type(nameField, "acme-docs-fork");
    await user.click(screen.getByRole("button", { name: "Create fork" }));

    expect(await screen.findByText("Repository name already exists")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "fork-user/acme-docs-fork" })).toBeNull();
  });
});

describe("REQ-3-2-3 copy a repository clone value", () => {
  it.each([
    ["HTTPS", "https://"],
    ["SSH", "git@"],
  ])("copies the %s clone value with brief Copied feedback", async (protocol, prefix) => {
    // userEvent grants the browser clipboard permission to the visitor.
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "acme-docs" }));
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Code" }));
    await user.click(screen.getByRole("tab", { name: protocol }));
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByText("Copied")).not.toBeNull();
    const copiedValue = await window.navigator.clipboard.readText();
    expect(copiedValue).toContain(prefix);
    expect(copiedValue).toContain("acme-docs");
    expect(screen.getByRole("heading", { name: "Acme Demo/acme-docs" })).not.toBeNull();
    expect(screen.getByText("Public")).not.toBeNull();
  });

  it("still copies and reports Copied when the asynchronous Clipboard API is denied", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() =>
      Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")),
    );
    (window.navigator.clipboard as { writeText: (value: string) => Promise<void> }).writeText = writeText;
    let selectedValue: string | null = null;
    const execCommand = vi.fn(() => {
      const active = document.activeElement as HTMLTextAreaElement | null;
      selectedValue = active && "value" in active ? active.value : null;
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: execCommand });

    render(<App />);
    await user.click(await screen.findByRole("link", { name: "acme-docs" }));
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Code" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByText("Copied")).not.toBeNull();
    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(selectedValue).toContain("https://");
    expect(selectedValue).toContain("acme-docs");
    expect(screen.queryByText("Unable to copy the clone address")).toBeNull();
    expect(screen.getByRole("heading", { name: "Acme Demo/acme-docs" })).not.toBeNull();
  });
});
