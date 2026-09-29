import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryPage } from "./RepositoryPage";
import { SessionProvider } from "../auth/session";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  getRepository: vi.fn(),
  listOrganizations: vi.fn(),
  forkRepository: vi.fn(),
}));

vi.mock("../auth/api", () => ({
  fetchSession: mocks.fetchSession,
}));

vi.mock("./api", () => ({
  getRepository: mocks.getRepository,
  listOrganizations: mocks.listOrganizations,
  forkRepository: mocks.forkRepository,
  searchRepositories: vi.fn(),
  listMyRepositories: vi.fn(),
  getRepositoryContents: vi.fn(),
  setRepositoryVisibility: vi.fn(),
}));

const now = new Date().toISOString();

const publicRepository = {
  owner: "acme-demo",
  name: "acme-docs",
  description: "Acme documentation",
  visibility: "public" as const,
  defaultBranch: "main",
  updatedAt: now,
  myRole: null,
  files: [
    { name: "README.md", path: "README.md", type: "file" as const },
    { name: "docs", path: "docs", type: "dir" as const },
    { name: "src", path: "src", type: "dir" as const },
  ],
  forkSource: null,
};

const forkRepositoryOverview = {
  ...publicRepository,
  owner: "alice-dev",
  name: "acme-docs-personal",
  files: [{ name: "README.md", path: "README.md", type: "file" as const }],
  forkSource: { owner: "acme-demo", name: "acme-docs" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSession.mockResolvedValue({ authenticated: false });
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  // @ts-expect-error restore stub
  delete navigator.clipboard;
});

function renderPage(repository: unknown = publicRepository) {
  mocks.getRepository.mockResolvedValue(repository);
  return render(
    <SessionProvider>
      <RepositoryPage owner="acme-demo" name="acme-docs" />
    </SessionProvider>,
  );
}

describe("RepositoryPage (public overview)", () => {
  it("shows the owner/name heading, Public marker, description, default branch and file list", async () => {
    renderPage();
    const heading = await screen.findByRole("heading", { name: "acme-demo/acme-docs" });
    expect(heading).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Acme documentation")).toBeTruthy();
    expect(screen.getByText("Default branch: main")).toBeTruthy();

    const readme = screen.getByRole("link", { name: "README.md" });
    expect(readme.getAttribute("href")).toBe(
      "#/repos/acme-demo/acme-docs/blob?branch=main&path=README.md",
    );
    expect(screen.getByRole("link", { name: "docs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "src" })).toBeTruthy();
  });

  it("provides Code, Issues and Pull requests navigation links", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });

    const codeLink = screen.getByRole("link", { name: "Code" });
    expect(codeLink.getAttribute("href")).toBe("#/repos/acme-demo/acme-docs/tree");
    expect(screen.getByRole("link", { name: "Issues" }).getAttribute("href")).toBe(
      "#/repos/acme-demo/acme-docs/issues",
    );
    expect(screen.getByRole("link", { name: "Pull requests" }).getAttribute("href")).toBe(
      "#/repos/acme-demo/acme-docs/pulls",
    );
  });

  it("does not show Settings or Fork for anonymous visitors but keeps the clone Code button", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fork" })).toBeNull();
    expect(screen.getByRole("button", { name: "Code" })).toBeTruthy();
  });

  it("copying the clone value writes it and shows Copied while the heading stays visible", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderPage();
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Code" }));
    const dialog = await screen.findByRole("dialog", { name: "Code" });
    expect(dialog).toBeTruthy();

    expect(screen.getByRole("tab", { name: "HTTPS" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Copy clone value" }));
    await screen.findByText("Copied");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://github.com/acme-demo/acme-docs.git"));

    await user.click(screen.getByRole("tab", { name: "SSH" }));
    await user.click(screen.getByRole("button", { name: "Copy clone value" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("git@github.com:acme-demo/acme-docs.git"),
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Code" })).toBeNull();
    expect(screen.getByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
  });

  it("shows the fork source link on a fork overview", async () => {
    mocks.getRepository.mockResolvedValue(forkRepositoryOverview);
    render(
      <SessionProvider>
        <RepositoryPage owner="alice-dev" name="acme-docs-personal" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "alice-dev/acme-docs-personal" });
    expect(screen.getByText("Forked from")).toBeTruthy();
    const source = screen.getByRole("link", { name: "acme-docs" });
    expect(source.getAttribute("href")).toBe("#/repos/acme-demo/acme-docs");
  });
});

describe("RepositoryPage (fork action)", () => {
  it("lets a signed-in user fork into the personal namespace and opens the new overview", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue({
      authenticated: true,
      account: { username: "alice-dev", email: "alice.dev@example.test" },
    });
    mocks.listOrganizations.mockResolvedValue([
      { id: "acme-demo", displayName: "Acme Demo", createdAt: now, role: "owner" },
    ]);
    mocks.forkRepository.mockResolvedValue({
      ok: true,
      repository: { owner: "alice-dev", name: "acme-docs-personal" },
    });
    renderPage();
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Fork" }));
    const dialog = await screen.findByRole("dialog", { name: "Fork repository" });
    expect(within(dialog).getByLabelText(/Repository name/)).toBeTruthy();

    const ownerSelect = within(dialog).getByLabelText("Owner") as HTMLSelectElement;
    expect(ownerSelect.value).toBe("alice-dev");
    const options = [...ownerSelect.options].map((option) => option.value);
    expect(options).toContain("alice-dev");
    expect(options).toContain("acme-demo");

    await user.clear(within(dialog).getByLabelText(/Repository name/));
    await user.type(within(dialog).getByLabelText(/Repository name/), "acme-docs-personal");
    await user.click(within(dialog).getByRole("button", { name: "Create fork" }));

    await waitFor(() =>
      expect(mocks.forkRepository).toHaveBeenCalledWith("acme-demo", "acme-docs", {
        targetOwner: "alice-dev",
        name: "acme-docs-personal",
        visibility: "public",
      }),
    );
    expect(window.location.hash).toBe("#/repos/alice-dev/acme-docs-personal");
  });

  it("keeps the fork dialog open and shows the conflict error for an existing name", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue({
      authenticated: true,
      account: { username: "alice-dev", email: "alice.dev@example.test" },
    });
    mocks.listOrganizations.mockResolvedValue([]);
    mocks.forkRepository.mockResolvedValue({
      ok: false,
      errors: { name: "Repository name already exists" },
    });
    renderPage();
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Fork" }));
    const dialog = await screen.findByRole("dialog", { name: "Fork repository" });
    await user.clear(within(dialog).getByLabelText(/Repository name/));
    await user.type(within(dialog).getByLabelText(/Repository name/), "acme-docs-fork");
    await user.click(within(dialog).getByRole("button", { name: "Create fork" }));

    await screen.findByText("Repository name already exists");
    expect(screen.getByRole("dialog", { name: "Fork repository" })).toBeTruthy();
    expect(window.location.hash).toBe("");
  });
});
