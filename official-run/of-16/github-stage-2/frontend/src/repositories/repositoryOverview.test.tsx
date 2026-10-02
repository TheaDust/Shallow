import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import {
  createFakeApi,
  type FakeAccount,
  type FakeApiOptions,
  type FakeOrganization,
} from "../test-utils/fake-api";

const ORG_OWNER: FakeAccount = {
  username: "org-owner",
  email: "org-owner@example.test",
  password: "Valid-password-123!",
};

const REPO_OWNER: FakeAccount = {
  username: "repo-owner",
  email: "repo-owner@example.test",
  password: "Valid-password-123!",
  repositories: [
    {
      name: "acme-docs",
      description: "Personal notes kept next to the Acme Demo documentation.",
      visibility: "private",
      updatedAt: "2024-05-04T08:00:00.000Z",
    },
  ],
};

const FORK_USER: FakeAccount = {
  username: "fork-user",
  email: "fork-user@example.test",
  password: "Valid-password-123!",
  repositories: [
    {
      name: "acme-docs-fork",
      description: "Fork of Acme Demo/acme-docs.",
      visibility: "private",
      updatedAt: "2024-05-05T10:00:00.000Z",
      forkedFrom: "organization:acme-demo/acme-docs",
    },
  ],
};

const ACME_DEMO: FakeOrganization = {
  slug: "acme-demo",
  name: "Acme Demo",
  displayName: "Acme Demo",
  owners: ["org-owner"],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation, guides and release notes for Acme Demo.",
      visibility: "public",
      updatedAt: "2024-05-02T09:30:00.000Z",
      files: ["README.md"],
    },
    {
      name: "secret-research",
      description: "Confidential research notes.",
      visibility: "private",
      updatedAt: "2024-05-03T11:15:00.000Z",
    },
  ],
};

function fixture(overrides: Partial<FakeApiOptions> = {}) {
  return createFakeApi({
    accounts: [ORG_OWNER, REPO_OWNER, FORK_USER],
    organizations: [ACME_DEMO],
    ...overrides,
  });
}

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function renderVisitor(hash: string) {
  const api = fixture();
  api.install();
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("main");
  return { api, user };
}

async function renderSignedIn(hash: string, username: string) {
  const api = fixture();
  api.install();
  api.signInAs(username);
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("link", { name: "Account menu" });
  return { api, user };
}

let clipboardValue = "";

beforeEach(() => {
  // The browser grants clipboard read and write permission in these scenarios.
  clipboardValue = "";
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: vi.fn(async (text: string) => {
        clipboardValue = text;
      }),
      readText: vi.fn(async () => clipboardValue),
    },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("REQ-3-3 view a public repository overview", () => {
  it("scenario 1: a visitor opens the acme-docs entry and keeps the heading after a reload", async () => {
    const { user } = await renderVisitor("#/");

    // The home page lists the public repository; the link carries its name.
    const entry = await screen.findByRole("link", { name: "acme-docs" });
    expect(entry.getAttribute("href")).toBe("#/organizations/acme-demo/repositories/acme-docs");
    await user.click(entry);

    await waitFor(() => {
      expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs");
    });
    const overview = await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });
    expect(overview).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText(/Documentation, guides and release notes/)).toBeTruthy();
    expect(screen.getByText(/Default branch main/)).toBeTruthy();

    // The "Code" navigation link is a link and stays distinct from the clone
    // button of the Code area, which is a button with the same name.
    const codeLink = screen.getByRole("link", { name: "Code" });
    expect(codeLink.getAttribute("href")).toBe("#/organizations/acme-demo/repositories/acme-docs");
    expect(screen.getByRole("button", { name: "Code" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Issues" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pull requests" })).toBeTruthy();
    // A visitor never gets the Settings entry of the repository.
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

    // Reloading the page restores the same overview.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Acme Demo/acme-docs" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("lists the public repository in the explore directory only", async () => {
    const api = fixture();
    api.install();
    const user = userEvent.setup();
    goto("#/");
    render(<App />);

    const directory = await screen.findByRole("link", { name: "acme-docs" });
    expect(directory).toBeTruthy();
    // The private personal repository and the private organization repository
    // never appear in the public directory.
    expect(screen.queryByRole("link", { name: "acme-docs-fork" })).toBeNull();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    void user;
  });
});

describe("REQ-3-2-3 copy a repository clone value", () => {
  it("scenario 1: the Code popover copies the HTTPS value and shows Copied", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs");
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Code" }));
    const popover = await screen.findByRole("dialog");
    const httpsTab = within(popover).getByRole("tab", { name: "HTTPS" });
    expect(httpsTab.getAttribute("aria-selected")).toBe("true");
    await user.click(httpsTab);
    await user.click(within(popover).getByRole("button", { name: "Copy" }));

    expect(await within(popover).findByText("Copied")).toBeTruthy();
    // user-event installs its own clipboard stub, so the copied text is read back.
    await expect(navigator.clipboard.readText()).resolves.toContain("acme-demo/acme-docs.git");

    // The repository heading stays visible while the popover is open.
    expect(screen.getByRole("heading", { name: "Acme Demo/acme-docs" })).toBeTruthy();
  });

  it("scenario 2: the SSH tab copies the SSH value and shows Copied", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs");
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Code" }));
    const popover = await screen.findByRole("dialog");
    await user.click(within(popover).getByRole("tab", { name: "SSH" }));
    await user.click(within(popover).getByRole("button", { name: "Copy" }));

    expect(await within(popover).findByText("Copied")).toBeTruthy();
    const copied = await navigator.clipboard.readText();
    expect(copied.startsWith("git@")).toBe(true);
    expect(copied).toContain("acme-demo/acme-docs.git");
    expect(screen.getByRole("heading", { name: "Acme Demo/acme-docs" })).toBeTruthy();
  });
});

describe("REQ-3-2-1 create a repository with owner, visibility and initialization", () => {
  it("scenario 1: creates an initialized private repository and keeps it after a reload", async () => {
    const { api, user } = await renderSignedIn("#/", "repo-owner");

    await user.click(screen.getByRole("link", { name: "New repository" }));
    await waitFor(() => expect(window.location.hash).toBe("#/new"));

    // The personal namespace is selected by default, so only the name is typed.
    const owner = await screen.findByLabelText("Owner");
    expect((owner as HTMLSelectElement).value).toBe("account:repo-owner");
    await user.type(screen.getByLabelText("Repository name"), "release-toolkit");
    await user.type(screen.getByLabelText("Description"), "Repository created by Playwright");
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/users/repo-owner/repositories/release-toolkit");
    });
    expect(await screen.findByRole("heading", { name: "repo-owner/release-toolkit" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Repository created by Playwright")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText("Initial commit")).toBeTruthy();

    // The stored repository carries the chosen owner, visibility and files.
    const stored = api.accounts.find((account) => account.username === "repo-owner")?.repositories
      ?.find((repository) => repository.name === "release-toolkit");
    expect(stored?.visibility).toBe("private");
    expect(stored?.files).toEqual(["README.md"]);
    expect(stored?.description).toBe("Repository created by Playwright");

    // It appears in the owner's repository list and survives a reload.
    goto("#/users/repo-owner");
    expect(await screen.findByRole("link", { name: "release-toolkit" })).toBeTruthy();

    goto("#/users/repo-owner/repositories/release-toolkit");
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "repo-owner/release-toolkit" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
  });

  it("creates an organization repository for an organization Owner", async () => {
    const { user } = await renderSignedIn("#/new", "org-owner");
    await screen.findByRole("heading", { name: "New repository" });

    await user.selectOptions(screen.getByLabelText("Owner"), "organization:acme-demo");
    await user.type(screen.getByLabelText("Repository name"), "org-toolkit");
    await user.click(screen.getByRole("radio", { name: "Public" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/org-toolkit");
    });
    expect(await screen.findByRole("heading", { name: "Acme Demo/org-toolkit" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("scenario 2: an existing name is reported and never opens the existing repository", async () => {
    const { user } = await renderSignedIn("#/new", "repo-owner");
    await screen.findByRole("heading", { name: "New repository" });

    await user.type(screen.getByLabelText("Repository name"), "acme-docs");
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByText("Repository name already exists")).toBeTruthy();
    expect(window.location.hash).toBe("#/new");
    expect(screen.queryByRole("heading", { name: "repo-owner/acme-docs" })).toBeNull();
  });

  it("scenario 3: an empty name reports the required validation message", async () => {
    const { user } = await renderSignedIn("#/new", "repo-owner");
    await screen.findByRole("heading", { name: "New repository" });

    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByText("Repository name is required")).toBeTruthy();
    expect(window.location.hash).toBe("#/new");
  });
});

describe("REQ-3-2-2 fork a repository into another namespace", () => {
  it("scenario 1: creates a fork that shows its source and survives a reload", async () => {
    const { api, user } = await renderSignedIn(
      "#/organizations/acme-demo/repositories/acme-docs",
      "fork-user",
    );
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Fork" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs/fork");
    });

    const owner = await screen.findByLabelText("Owner");
    expect((owner as HTMLSelectElement).value).toBe("account:fork-user");
    const nameField = screen.getByLabelText("Repository name");
    expect((nameField as HTMLInputElement).value).toBe("acme-docs");
    await user.clear(nameField);
    await user.type(nameField, "acme-docs-copy");
    await user.click(screen.getByRole("button", { name: "Create fork" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/users/fork-user/repositories/acme-docs-copy");
    });
    expect(await screen.findByRole("heading", { name: "fork-user/acme-docs-copy" })).toBeTruthy();
    const sourceLine = screen.getByText(/Forked from/);
    const sourceLink = within(sourceLine).getByRole("link", { name: "acme-docs" });
    expect(sourceLink.getAttribute("href")).toBe("#/organizations/acme-demo/repositories/acme-docs");
    // The copied default branch is browsable from the fork.
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();

    // The fork is independent of the source repository.
    const source = api.organizations[0].repositories?.find((repository) => repository.name === "acme-docs");
    const fork = api.accounts.find((account) => account.username === "fork-user")?.repositories
      ?.find((repository) => repository.name === "acme-docs-copy");
    expect(source?.files).toEqual(["README.md"]);
    expect(fork?.forkedFrom).toBe("organization:acme-demo/acme-docs");

    // The fork appears in the target owner's repository list and survives a reload.
    goto("#/users/fork-user");
    expect(await screen.findByRole("link", { name: "acme-docs-copy" })).toBeTruthy();
    cleanup();
    render(<App />);
    goto("#/users/fork-user/repositories/acme-docs-copy");
    expect(await screen.findByRole("heading", { name: "fork-user/acme-docs-copy" })).toBeTruthy();
    expect(screen.getByText(/Forked from/)).toBeTruthy();
  });

  it("scenario 2: a conflicting fork name reports the conflict", async () => {
    const { user } = await renderSignedIn(
      "#/organizations/acme-demo/repositories/acme-docs",
      "fork-user",
    );
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Fork" }));
    const nameField = await screen.findByLabelText("Repository name");
    await user.clear(nameField);
    await user.type(nameField, "acme-docs-fork");
    await user.click(screen.getByRole("button", { name: "Create fork" }));

    expect(await screen.findByText("Repository name already exists")).toBeTruthy();
    expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs/fork");
    expect(screen.queryByRole("heading", { name: "fork-user/acme-docs-fork" })).toBeNull();
  });
});

describe("read-only file page", () => {
  it("opens the stored README content from the overview link", async () => {
    const { user } = await renderVisitor("#/organizations/acme-demo/repositories/acme-docs");
    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });

    await user.click(await screen.findByRole("link", { name: "README.md" }));
    await waitFor(() => {
      expect(window.location.hash).toBe(
        "#/organizations/acme-demo/repositories/acme-docs/blob/main/README.md",
      );
    });
    expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText(/Documentation, guides and release notes/)).toBeTruthy();
    expect(screen.getByText(/Branch main/)).toBeTruthy();
  });
});
