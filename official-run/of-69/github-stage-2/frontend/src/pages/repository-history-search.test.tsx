import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as organizationApi from "../lib/organization-api";
import { SessionProvider } from "../session/session-context";
import { RepositoryOverviewPage } from "./RepositoryOverviewPage";
import { RepositoryCommitPage } from "./RepositoryCommitPage";
import { RepositoryCommitsPage } from "./RepositoryCommitsPage";
import { RepositorySearchPage } from "./RepositorySearchPage";

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

const REPOSITORY = {
  name: "acme-docs",
  description: "Public documentation for Acme products",
  visibility: "public" as const,
  defaultBranch: "main",
  updatedAt: "2024-03-05T09:00:00.000Z",
};

const COMMITS_RESPONSE = {
  owner: { type: "organization" as const, name: "acme-demo", displayName: "Acme Demo" },
  viewer: { role: null, repositoryRole: null, canManage: false },
  repository: REPOSITORY,
  branch: "main",
  path: null,
  commits: [
    {
      id: "commit-acme-docs-3",
      message: "Document search flow",
      author: "alice-dev",
      createdAt: "2024-03-05T09:00:00.000Z",
      parentId: "commit-acme-docs-2",
      changedFiles: ["README.md", "src/README.md", "src/search.ts"],
    },
    {
      id: "commit-acme-docs-2",
      message: "Document installation",
      author: "org-owner",
      createdAt: "2024-01-06T09:00:00.000Z",
      parentId: "commit-acme-docs-1",
      changedFiles: ["README.md"],
    },
  ],
};

function renderPage(node: ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

beforeEach(() => {
  window.location.hash = "#/";
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("REQ-4-2-1 view repository commit history", () => {
  it("lists the seeded message, author and a relative timestamp", async () => {
    vi.mocked(organizationApi.fetchRepositoryCommits).mockResolvedValue(COMMITS_RESPONSE);

    renderPage(<RepositoryCommitsPage ownerType="organization" owner="acme-demo" repository="acme-docs" />);

    const link = await screen.findByRole("link", { name: "Document search flow" });
    expect(link.getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs/commit/commit-acme-docs-3",
    );
    expect(screen.getByText("alice-dev")).toBeTruthy();
    expect(screen.getAllByText(/ago/).length).toBeGreaterThan(0);
    expect(screen.getByText("Document installation")).toBeTruthy();
    // The history is read from the branch the repository page shows.
    expect(vi.mocked(organizationApi.fetchRepositoryCommits).mock.calls[0]).toEqual([
      "acme-demo",
      "acme-docs",
      { branch: undefined, path: undefined },
    ]);
  });

  it("shows the empty state instead of inventing records", async () => {
    vi.mocked(organizationApi.fetchRepositoryCommits).mockResolvedValue({
      ...COMMITS_RESPONSE,
      commits: [],
    });

    renderPage(<RepositoryCommitsPage ownerType="organization" owner="acme-demo" repository="acme-docs" />);

    expect(await screen.findByText("No commits yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Code" })).toBeTruthy();
  });
});

describe("REQ-4-2-2 inspect commit and revision differences", () => {
  it("shows the changed file, the Changed files summary and the numbers", async () => {
    vi.mocked(organizationApi.fetchCommitDetail).mockResolvedValue({
      owner: { type: "organization", name: "acme-demo", displayName: "Acme Demo" },
      viewer: { role: null, repositoryRole: null, canManage: false },
      repository: REPOSITORY,
      branch: "main",
      commit: {
        id: "commit-acme-docs-3",
        message: "Document search flow",
        author: "alice-dev",
        createdAt: "2024-03-05T09:00:00.000Z",
        parentId: "commit-acme-docs-2",
        parentMessage: "Document installation",
        parentAuthor: "org-owner",
        changedFiles: ["README.md", "src/search.ts"],
      },
      totals: { files: 2, additions: 15, deletions: 4 },
      files: [
        {
          path: "src/search.ts",
          additions: 12,
          deletions: 0,
          lines: [
            { type: "addition" as const, text: "export function search(text: string, query: string) {" },
            { type: "addition" as const, text: "  return text.includes(query);" },
          ],
        },
        {
          path: "README.md",
          additions: 3,
          deletions: 4,
          lines: [
            { type: "deletion" as const, text: "Documentation is coming soon." },
            { type: "addition" as const, text: "Document search flow" },
          ],
        },
      ],
    });

    renderPage(
      <RepositoryCommitPage
        ownerType="organization"
        owner="acme-demo"
        repository="acme-docs"
        commitId="commit-acme-docs-3"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Document search flow" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Changed files" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "src/search.ts" })).toBeTruthy();
    // The summary states the numbers; each changed file carries its own stats.
    expect(screen.getByText("15 additions")).toBeTruthy();
    expect(screen.getByText("4 deletions")).toBeTruthy();
    expect(screen.getByText("2 files changed")).toBeTruthy();
    expect(screen.getByText("+12")).toBeTruthy();
    expect(screen.getByText("-4")).toBeTruthy();
    expect(screen.getByText("Documentation is coming soon.")).toBeTruthy();
    expect(screen.getByText("Document installation")).toBeTruthy();
    expect(screen.getByText("alice-dev")).toBeTruthy();
    expect(screen.getAllByText(/ago/).length).toBeGreaterThan(0);
  });
});

describe("REQ-4-2-3 search code within a repository", () => {
  it("scopes the Search box of a repository page to that repository's code", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/acme-demo/repositories/acme-docs";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: null, repositoryRole: null, canManage: false },
      repository: REPOSITORY,
      branch: "main",
      branches: [{ name: "main" }],
      files: [{ path: "README.md", content: "Document search flow\n" }],
      readme: { path: "README.md", content: "Document search flow\n" },
      commits: [],
    });

    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    await screen.findByRole("button", { name: "Branch main" });

    const searchbox = screen.getByRole("searchbox", { name: "Search" });
    await user.type(searchbox, "search flow{Enter}");

    await waitFor(() =>
      expect(window.location.hash).toBe(
        "#/organizations/acme-demo/repositories/acme-docs/search?q=search+flow",
      ),
    );
  });

  it("lists a matching file and opens it in its repository context", async () => {
    window.location.hash = "#/organizations/acme-demo/repositories/acme-docs/search?q=search+flow";
    vi.mocked(organizationApi.searchRepositoryCode).mockResolvedValue({
      owner: { type: "organization", name: "acme-demo", displayName: "Acme Demo" },
      viewer: { role: null, repositoryRole: null, canManage: false },
      repository: REPOSITORY,
      branch: "main",
      query: "search flow",
      results: [
        { path: "README.md", lines: ["Document search flow"], matches: 1 },
        { path: "src/README.md", lines: ["Document search flow"], matches: 1 },
      ],
    });

    renderPage(<RepositorySearchPage ownerType="organization" owner="acme-demo" repository="acme-docs" />);

    const result = await screen.findByRole("link", { name: "README.md" });
    expect(result.getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs?file=README.md",
    );
    expect(screen.getAllByText("Document search flow").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "src/README.md" })).toHaveLength(1);
    // The “Code” results view is selected and the query stays in Search.
    expect(screen.getByRole("link", { name: "Code" }).getAttribute("aria-current")).toBe("page");
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("search flow");
    expect(vi.mocked(organizationApi.searchRepositoryCode).mock.calls[0][2]).toBe("search flow");
  });

  it("answers a query without a match with a no-code-results state and keeps the query", async () => {
    window.location.hash = "#/organizations/acme-demo/repositories/acme-docs/search?q=no-such-token";
    vi.mocked(organizationApi.searchRepositoryCode).mockResolvedValue({
      owner: { type: "organization", name: "acme-demo", displayName: "Acme Demo" },
      viewer: { role: null, repositoryRole: null, canManage: false },
      repository: REPOSITORY,
      branch: "main",
      query: "no-such-token",
      results: [],
    });

    const view = renderPage(
      <RepositorySearchPage ownerType="organization" owner="acme-demo" repository="acme-docs" />,
    );

    expect(await screen.findByText("No code results")).toBeTruthy();
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("no-such-token");

    // Returning to the repository and repeating the same search reproduces the
    // same empty state.
    view.unmount();
    window.location.hash = "#/organizations/acme-demo/repositories/acme-docs";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: null, repositoryRole: null, canManage: false },
      repository: REPOSITORY,
      branch: "main",
      branches: [{ name: "main" }],
      files: [{ path: "README.md", content: "Document search flow\n" }],
      readme: { path: "README.md", content: "Document search flow\n" },
      commits: [],
    });
    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    const searchbox = screen.getByRole("searchbox", { name: "Search" });
    await userEvent.setup().type(searchbox, "no-such-token{Enter}");
    await waitFor(() =>
      expect(window.location.hash).toBe(
        "#/organizations/acme-demo/repositories/acme-docs/search?q=no-such-token",
      ),
    );

    cleanup();
    renderPage(
      <RepositorySearchPage ownerType="organization" owner="acme-demo" repository="acme-docs" />,
    );
    expect(await screen.findByText("No code results")).toBeTruthy();
  });
});
