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
      branches: ["main", "feature-search"],
      files: [
        { path: "README.md", content: "# Acme Docs\n" },
        {
          path: "docs/getting-started.md",
          content: "# Getting started\n\nInstall the Acme Demo CLI and sign in.\n",
        },
        { path: "docs/search.md", content: "# Searching\n" },
      ],
    },
    {
      name: "secret-research",
      description: "Private research notes for Acme Demo.",
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

/** Unmount and mount again, like a reload of the same address. */
function reload() {
  cleanup();
  return render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-3-3 view a public repository overview", () => {
  it("a visitor sees the identity, Public marker, description, default branch and files", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    renderApp("#/repositories/acme-demo/acme-docs");

    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
    await screen.findByRole("link", { name: "README.md" });
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Documentation for the Acme Demo platform.")).toBeTruthy();
    // The branch selector names the branch the page currently reads.
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();

    // Primary entries for browsing, collaboration and, for a signed-in reader
    // only, settings.
    expect(screen.getByRole("link", { name: "Code" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Issues" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pull requests" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

    // The file list of the default branch, with directory and file entries.
    expect(screen.getByRole("link", { name: "docs" })).toBeTruthy();
  });

  it("a visitor opens a directory and then a file, and the address survives a reload", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs");

    await user.click(await screen.findByRole("link", { name: "docs" }));

    const directory = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(within(directory).getByRole("link", { name: "docs" })).toBeTruthy();
    await user.click(await screen.findByRole("link", { name: "getting-started.md" }));

    const content = await screen.findByText(/Install the Acme Demo CLI/, { exact: false });
    expect(content).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();

    // Reopening the same file address keeps the same repository state.
    const address = window.location.hash;
    cleanup();
    renderApp(address);
    expect(await screen.findByText(/# Getting started/, { exact: false })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
    expect(screen.queryByText("Access denied")).toBeNull();
  });

  it("never shows an unauthorized private repository", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    renderApp("#/repositories/acme-demo/secret-research");

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "acme-demo/secret-research" })).toBeNull();
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
    expect(screen.queryByText("Private research notes for Acme Demo.")).toBeNull();
  });

  it("the direct overview address is readable without a session and after a reload", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ORGANIZATION] });
    renderApp("#/repositories/acme-demo/acme-docs");
    await screen.findByRole("link", { name: "README.md" });

    reload();
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });
});
