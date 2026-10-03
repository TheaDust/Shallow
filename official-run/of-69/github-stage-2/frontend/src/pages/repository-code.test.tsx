import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as organizationApi from "../lib/organization-api";
import { SessionProvider } from "../session/session-context";
import { RepositoryOverviewPage } from "./RepositoryOverviewPage";

vi.mock("../lib/session-api", () => ({
  fetchSession: vi.fn().mockResolvedValue(null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  registerAccount: vi.fn(),
  startRecovery: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock("../lib/organization-api", () => ({
  fetchPublicOrganizations: vi.fn(),
  fetchMyOrganizations: vi.fn(),
  fetchReadableRepositories: vi.fn(),
  searchRepositories: vi.fn(),
  createOrganization: vi.fn(),
  fetchOrganization: vi.fn(),
  fetchOrganizationRepositories: vi.fn(),
  fetchRepository: vi.fn(),
  fetchUserRepository: vi.fn(),
  fetchRepositoryCommits: vi.fn(),
  fetchCommitDetail: vi.fn(),
  searchRepositoryCode: vi.fn(),
  updateRepositoryVisibility: vi.fn(),
  fetchOrganizationMembers: vi.fn(),
  fetchOrganizationTeams: vi.fn(),
  createTeam: vi.fn(),
  fetchTeam: vi.fn(),
  saveTeamParent: vi.fn(),
  fetchTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  addOrganizationMember: vi.fn(),
  removeOrganizationMember: vi.fn(),
  fetchRepositoryAccess: vi.fn(),
  addRepositoryTeamGrant: vi.fn(),
  updateRepositoryGrant: vi.fn(),
}));

const ORGANIZATION = { name: "acme-demo", displayName: "Acme Demo" };

/** The seeded acme-docs repository: the `src` directory with its README. */
function acmeDocsDetail() {
  return {
    organization: ORGANIZATION,
    viewer: { role: null, repositoryRole: null, canManage: false },
    repository: {
      name: "acme-docs",
      description: "Public documentation for Acme products",
      visibility: "public" as const,
      defaultBranch: "main",
      updatedAt: "2024-03-05T09:00:00.000Z",
      forkedFrom: null,
    },
    branch: "main",
    branches: [{ name: "main" }],
    files: [
      { path: "README.md", content: "# acme-docs\n\nDocument search flow\n" },
      { path: "src/README.md", content: "Document search flow\n" },
      { path: "src/search.ts", content: "export const search = 1;\n" },
    ],
    readme: { path: "README.md", content: "# acme-docs\n\nDocument search flow\n" },
    commits: [
      {
        id: "commit-acme-docs-3",
        message: "Document search flow",
        author: "alice-dev",
        createdAt: "2024-03-05T09:00:00.000Z",
      },
    ],
  };
}

function renderPage(node: ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

beforeEach(() => {
  window.location.hash = "#/organizations/acme-demo/repositories/acme-docs";
  vi.clearAllMocks();
  vi.mocked(organizationApi.fetchRepository).mockResolvedValue(acmeDocsDetail());
});

afterEach(cleanup);

describe("REQ-4-1 browse repository files and directories", () => {
  it("lists the branch entries, opens the directory and then the file", async () => {
    const user = userEvent.setup();
    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);

    // The branch selector names the current branch and the root lists `src`
    // and `README.md` as links.
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
    const directory = screen.getByRole("link", { name: "src" });
    expect(directory.getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs?path=src",
    );
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    // Opening the directory identifies the current path and lists its files.
    await user.click(directory);
    await waitFor(() =>
      expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs?path=src"),
    );
    expect(screen.getByText("src", { selector: ".repository-path__value" })).toBeTruthy();
    const file = await screen.findByRole("link", { name: "README.md" });
    expect(screen.getByRole("link", { name: "search.ts" })).toBeTruthy();

    // Opening the file shows its name, path, branch and the seeded content.
    await user.click(file);
    await waitFor(() => expect(window.location.hash).toContain("file=src%2FREADME.md"));
    const content = await waitFor(() => {
      const node = document.querySelector(".repository-file__content");
      expect(node?.textContent).toContain("Document search flow");
      return node;
    });
    expect(content).toBeTruthy();
    expect(screen.getByRole("heading", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText("src/README.md", { selector: ".repository-file__path-value" })).toBeTruthy();
    expect(screen.getByText("main", { selector: ".repository-file__branch-value" })).toBeTruthy();

    // Reloading the same address restores the same read-only content.
    cleanup();
    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    await waitFor(() =>
      expect(document.querySelector(".repository-file__content")?.textContent).toContain("Document search flow"),
    );
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /edit/i })).toBeNull();
  });

  it("keeps the README entry and the commit history entry of the repository page", async () => {
    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    await screen.findByRole("button", { name: "Branch main" });

    // The repository page exposes the history link named “Commits”.
    expect(screen.getByRole("link", { name: "Commits" }).getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs/commits",
    );
    expect(screen.getByRole("link", { name: "README.md" }).getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs?file=README.md",
    );
    // The recorded message is not repeated on the code page; it lives in the
    // history, so the file content stays the only occurrence of its text.
    expect(screen.queryByText("Document search flow")).toBeNull();
  });

  it("switches the branch through the selector without leaving the repository", async () => {
    const user = userEvent.setup();
    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);

    await user.click(await screen.findByRole("button", { name: "Branch main" }));
    const find = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(find, "missing-branch");
    expect(await screen.findByText("No matching branch")).toBeTruthy();

    await user.clear(find);
    expect(await screen.findByRole("option", { name: "main" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull());
    expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs");
  });
});
