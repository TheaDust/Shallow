import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";

const ALICE = {
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
      branches: ["main"],
      files: [
        { path: "README.md", content: "# Acme Docs\n" },
        { path: "docs/search.md", content: "# Searching\n" },
      ],
    },
  ],
};

const FORK_SEED = [
  {
    owner: "alice-dev",
    name: "acme-docs-fork",
    description: "Personal fork of the Acme Demo documentation.",
    visibility: "private" as const,
  },
];

/** Signs in through the real account-access page. */
async function signInAs(user: ReturnType<typeof userEvent.setup>, username: string) {
  window.location.hash = "#/login";
  render(<App />);
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (navigator as { clipboard?: unknown }).clipboard;
  window.location.hash = "#/";
});

describe("REQ-3-2-1 create a repository with owner, visibility and initialization options", () => {
  it("creates an initialized private repository and keeps it after a reload", async () => {
    installAuthStub({
      accounts: [ALICE],
      organizations: [ORGANIZATION],
      repositories: FORK_SEED,
    });
    const user = userEvent.setup();
    await signInAs(user, "alice-dev");

    await user.click(await screen.findByRole("link", { name: "New repository" }));
    expect(await screen.findByRole("heading", { name: "New repository" })).toBeTruthy();

    // The personal namespace is selected by default.
    const owner = screen.getByLabelText("Owner") as HTMLSelectElement;
    expect(owner.value).toBe("alice-dev");
    expect((screen.getByRole("radio", { name: "Public" }) as HTMLInputElement).checked).toBe(true);

    await user.type(screen.getByLabelText("Repository name"), "playwright-repo");
    await user.type(
      screen.getByLabelText("Description"),
      "Repository created by Playwright",
    );
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(
      await screen.findByRole("heading", { name: "alice-dev/playwright-repo" }),
    ).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Repository created by Playwright")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(window.location.hash).toBe("#/repositories/alice-dev/playwright-repo");

    // The new repository also appears in the personal repository list.
    window.location.hash = "#/dashboard";
    expect(await screen.findByRole("link", { name: "playwright-repo" })).toBeTruthy();

    // Refreshing the overview keeps owner, visibility and README.
    window.location.hash = "#/repositories/alice-dev/playwright-repo";
    cleanup();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "alice-dev/playwright-repo" }),
    ).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
  });

  it("keeps the form open and shows the reason for an empty or duplicate name", async () => {
    installAuthStub({
      accounts: [ALICE],
      organizations: [ORGANIZATION],
      repositories: FORK_SEED,
    });
    const user = userEvent.setup();
    await signInAs(user, "alice-dev");
    await user.click(await screen.findByRole("link", { name: "New repository" }));
    await screen.findByRole("heading", { name: "New repository" });

    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByText("Repository name is required")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New repository" })).toBeTruthy();

    await user.type(screen.getByLabelText("Repository name"), "acme-docs-fork");
    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByText("Repository name already exists")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New repository" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "alice-dev/acme-docs-fork" })).toBeNull();
  });
});

describe("REQ-3-2-2 fork a repository into another namespace", () => {
  it("opens the fork overview with the source link, which survives a reload", async () => {
    installAuthStub({ accounts: [ALICE], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signInAs(user, "alice-dev");

    window.location.hash = "#/repositories/acme-demo/acme-docs";
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Fork" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Repository name") as HTMLInputElement;
    expect(name.value).toBe("acme-docs");
    await user.clear(name);
    await user.type(name, "acme-docs-copy");
    await user.click(within(dialog).getByRole("button", { name: "Create fork" }));

    expect(
      await screen.findByRole("heading", { name: "alice-dev/acme-docs-copy" }),
    ).toBeTruthy();
    const sourceLink = screen.getByRole("link", { name: "acme-docs" });
    expect(sourceLink.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs");
    expect(screen.getByText(/Forked from/)).toBeTruthy();
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();

    // The heading and the recorded source relationship survive a reload.
    cleanup();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "alice-dev/acme-docs-copy" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "acme-docs" }).getAttribute("href")).toBe(
      "#/repositories/acme-demo/acme-docs",
    );
  });

  it("offers the Fork button to a visitor and sends them to the account-access page", async () => {
    installAuthStub({ accounts: [ALICE], organizations: [ORGANIZATION] });
    const user = userEvent.setup();

    window.location.hash = "#/repositories/acme-demo/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Fork" }));
    expect(await screen.findByRole("heading", { name: "Sign in to GitHub" })).toBeTruthy();
  });

  it("rejects a conflicting fork name without leaving the source page", async () => {
    installAuthStub({
      accounts: [ALICE],
      organizations: [ORGANIZATION],
      repositories: FORK_SEED,
    });
    const user = userEvent.setup();
    await signInAs(user, "alice-dev");

    window.location.hash = "#/repositories/acme-demo/acme-docs";
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Fork" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Repository name");
    await user.clear(name);
    await user.type(name, "acme-docs-fork");
    await user.click(within(dialog).getByRole("button", { name: "Create fork" }));

    expect(await within(dialog).findByText("Repository name already exists")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
    expect(window.location.hash).toBe("#/repositories/acme-demo/acme-docs");
  });
});

describe("REQ-3-2-3 copy a repository clone value", () => {
  it("copies the selected protocol value and keeps the repository heading", async () => {
    installAuthStub({ accounts: [ALICE], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    window.location.hash = "#/repositories/acme-demo/acme-docs";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Code" }));
    await user.click(await screen.findByRole("tab", { name: "SSH" }));
    await user.click(screen.getByRole("button", { name: "Copy clone value" }));

    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("git@github.com:acme-demo/acme-docs.git");
    expect(screen.getByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();

    // Closing and reopening the popover keeps the selected protocol.
    await user.click(screen.getByRole("button", { name: "Code" }));
    await user.click(screen.getByRole("button", { name: "Code" }));
    const sshTab = await screen.findByRole("tab", { name: "SSH" });
    expect(sshTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
    expect(await screen.findByText(/git@github.com:acme-demo\/acme-docs\.git/)).toBeTruthy();
  });
});
