import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import * as organizationApi from "../lib/organization-api";
import * as sessionApi from "../lib/session-api";
import { SessionProvider } from "../session/session-context";
import { NewRepositoryPage } from "./NewRepositoryPage";
import { RepositoryOverviewPage } from "./RepositoryOverviewPage";
import { UserRepositoryOverviewPage } from "./UserRepositoryOverviewPage";

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
  fetchOrganization: vi.fn(),
  fetchOrganizationRepositories: vi.fn(),
  fetchRepository: vi.fn(),
  fetchUserRepository: vi.fn(),
  createRepository: vi.fn(),
  createFork: vi.fn(),
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

const ACCOUNT = {
  id: "account-repo-owner",
  username: "repo-owner",
  email: "repo-owner@example.test",
  emailVerified: true,
  status: "available",
};

const ORGANIZATION = { name: "acme-demo", displayName: "Acme Demo" };

function publicDetail() {
  return {
    organization: ORGANIZATION,
    viewer: { role: null, repositoryRole: null, canManage: false },
    repository: {
      name: "acme-docs",
      description: "Public documentation for Acme products",
      visibility: "public" as const,
      defaultBranch: "main",
      updatedAt: "2024-03-01T10:00:00.000Z",
      forkedFrom: null,
    },
    readme: { path: "README.md", content: "# acme-docs\n\nPublic documentation for Acme products\n" },
    commits: [
      { id: "commit-2", message: "Document installation", author: "org-owner", createdAt: "2024-01-06T09:00:00.000Z" },
      { id: "commit-1", message: "Initial commit", author: "org-owner", createdAt: "2024-01-05T09:00:00.000Z" },
    ],
  };
}

function renderPage(node: ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

let writeText: ReturnType<typeof vi.fn>;

/**
 * Installs a clipboard spy. It must run after `userEvent.setup()`, because
 * user-event attaches its own clipboard stub on setup.
 */
function stubClipboard() {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(() => {
  window.location.hash = "#/";
  vi.clearAllMocks();
  stubClipboard();
  vi.mocked(organizationApi.fetchMyOrganizations).mockResolvedValue([]);
  vi.mocked(organizationApi.fetchReadableRepositories).mockResolvedValue([]);
  vi.mocked(organizationApi.fetchPublicOrganizations).mockResolvedValue([]);
});

afterEach(cleanup);

describe("REQ-3-2-1 repository creation", () => {
  it("labels every control and defaults to the personal namespace and Public", async () => {
    renderPage(<NewRepositoryPage account={ACCOUNT} />);

    expect(screen.getByRole("heading", { name: "New repository" })).toBeTruthy();
    const owner = await screen.findByLabelText("Owner");
    await waitFor(() => expect((owner as HTMLSelectElement).value).toBe("user:repo-owner"));
    expect(screen.getByLabelText("Repository name")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Public" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Private" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Add a README file" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Create repository" })).toBeTruthy();
  });

  it("submits the chosen options and opens the new personal repository overview", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.createRepository).mockResolvedValue({
      owner: { type: "user", name: "repo-owner", displayName: "repo-owner" },
      repository: { name: "playwright-notes", description: "Repository created by Playwright", visibility: "private", updatedAt: "2024-04-01T00:00:00.000Z" },
    });

    renderPage(<NewRepositoryPage account={ACCOUNT} />);
    await waitFor(() => expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("user:repo-owner"));
    await user.type(screen.getByLabelText("Repository name"), "playwright-notes");
    await user.type(screen.getByLabelText("Description"), "Repository created by Playwright");
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    await waitFor(() =>
      expect(vi.mocked(organizationApi.createRepository).mock.calls[0][0]).toEqual({
        ownerType: "user",
        ownerName: "repo-owner",
        name: "playwright-notes",
        description: "Repository created by Playwright",
        visibility: "private",
        initialize: true,
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/users/repo-owner/repositories/playwright-notes"));
  });

  it("reports an empty name and stays on the form", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.createRepository).mockRejectedValue(
      new ApiError("Unprocessable", 422, { errors: { name: "Repository name is required" } }),
    );

    renderPage(<NewRepositoryPage account={ACCOUNT} />);
    await waitFor(() => expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("user:repo-owner"));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByText("Repository name is required")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New repository" })).toBeTruthy();
    expect(window.location.hash).toBe("#/");
  });

  it("reports a duplicate name without opening the existing repository", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.createRepository).mockRejectedValue(
      new ApiError("Unprocessable", 422, { errors: { name: "Repository name already exists" } }),
    );

    renderPage(<NewRepositoryPage account={ACCOUNT} />);
    await waitFor(() => expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("user:repo-owner"));
    await user.type(screen.getByLabelText("Repository name"), "acme-docs");
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByText("Repository name already exists")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /acme-docs/ })).toBeNull();
    expect(window.location.hash).toBe("#/");
  });
});

describe("REQ-3-2-3 clone value copy", () => {
  it("copies the HTTPS clone value and shows Copied while the heading stays", async () => {
    const user = userEvent.setup();
    stubClipboard();
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(publicDetail());

    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    await screen.findByRole("heading", { name: /acme-docs/ });

    await user.click(screen.getByRole("button", { name: "Code" }));
    expect(await screen.findByRole("tab", { name: "HTTPS" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "HTTPS" }));
    await user.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toContain("acme-demo/acme-docs.git");
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /acme-docs/ })).toBeTruthy();
  });

  it("copies the SSH clone value after selecting the SSH tab", async () => {
    const user = userEvent.setup();
    stubClipboard();
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(publicDetail());

    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    await screen.findByRole("heading", { name: /acme-docs/ });

    await user.click(screen.getByRole("button", { name: "Code" }));
    await user.click(await screen.findByRole("tab", { name: "SSH" }));
    await user.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toMatch(/^git@/);
    expect(String(writeText.mock.calls[0][0])).toContain("acme-demo/acme-docs.git");
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("links the default-branch README to its file view on the same overview", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(publicDetail());

    const view = renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    await screen.findByRole("heading", { name: /acme-docs/ });

    const readmeLink = screen.getByRole("link", { name: "README.md" });
    expect(readmeLink.getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs?file=README.md",
    );
    await user.click(readmeLink);

    await waitFor(() => expect(window.location.hash).toContain("file=README.md"));
    expect(view.container.querySelector(".repository-file__content")?.textContent).toContain("# acme-docs");
    // The commit history is one click away through the repository navigation.
    expect(screen.getByRole("link", { name: "Commits" }).getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs/commits",
    );
  });
});

describe("REQ-3-2-2 fork creation", () => {
  it("offers Fork to a signed-in reader and opens the new fork overview", async () => {
    const user = userEvent.setup();
    vi.mocked(sessionApi.fetchSession).mockResolvedValue({
      ...ACCOUNT,
      id: "account-fork-user",
      username: "fork-user",
      email: "fork-user@example.test",
    });
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(publicDetail());
    vi.mocked(organizationApi.createFork).mockResolvedValue({
      owner: { type: "user", name: "fork-user", displayName: "fork-user" },
      repository: { name: "acme-docs-copy", description: "Public documentation for Acme products", visibility: "public", updatedAt: "2024-04-02T00:00:00.000Z" },
    });

    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Fork" }));

    const dialog = await screen.findByRole("dialog", { name: "Fork repository" });
    await waitFor(() =>
      expect((within(dialog).getByLabelText("Owner") as HTMLSelectElement).value).toBe("user:fork-user"),
    );
    const nameField = within(dialog).getByLabelText("Repository name") as HTMLInputElement;
    expect(nameField.value).toBe("acme-docs");
    await user.clear(nameField);
    await user.type(nameField, "acme-docs-copy");
    await user.click(within(dialog).getByRole("button", { name: "Create fork" }));

    await waitFor(() =>
      expect(vi.mocked(organizationApi.createFork).mock.calls[0]).toEqual([
        "acme-demo",
        "acme-docs",
        { ownerType: "user", ownerName: "fork-user", name: "acme-docs-copy", visibility: "public" },
      ]),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/users/fork-user/repositories/acme-docs-copy"));
  });

  it("keeps the fork form open with the conflict reason", async () => {
    const user = userEvent.setup();
    vi.mocked(sessionApi.fetchSession).mockResolvedValue({
      ...ACCOUNT,
      id: "account-fork-user",
      username: "fork-user",
      email: "fork-user@example.test",
    });
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(publicDetail());
    vi.mocked(organizationApi.createFork).mockRejectedValue(
      new ApiError("Unprocessable", 422, { errors: { name: "Repository name already exists" } }),
    );

    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);
    await user.click(await screen.findByRole("button", { name: "Fork" }));
    const dialog = await screen.findByRole("dialog", { name: "Fork repository" });
    await waitFor(() =>
      expect((within(dialog).getByLabelText("Owner") as HTMLSelectElement).value).toBe("user:fork-user"),
    );
    const nameField = within(dialog).getByLabelText("Repository name");
    await user.clear(nameField);
    await user.type(nameField, "acme-docs-fork");
    await user.click(within(dialog).getByRole("button", { name: "Create fork" }));

    expect(await screen.findByText("Repository name already exists")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Fork repository" })).toBeTruthy();
    expect(window.location.hash).toBe("#/");
  });
});

describe("personal repository overview", () => {
  it("names the fork, shows its source link and the Private marker", async () => {
    vi.mocked(organizationApi.fetchUserRepository).mockResolvedValue({
      owner: { type: "user", name: "fork-user", displayName: "fork-user" },
      viewer: { role: null, repositoryRole: "admin", canManage: true },
      repository: {
        name: "acme-docs-copy",
        description: "Public documentation for Acme products",
        visibility: "private",
        defaultBranch: "main",
        updatedAt: "2024-04-02T00:00:00.000Z",
        forkedFrom: { owner: { type: "organization", name: "acme-demo", displayName: "Acme Demo" }, name: "acme-docs" },
      },
      readme: { path: "README.md", content: "# acme-docs\n" },
      commits: [{ id: "commit-1", message: "Initial commit", author: "org-owner", createdAt: "2024-01-05T09:00:00.000Z" }],
    });

    renderPage(<UserRepositoryOverviewPage username="fork-user" repository="acme-docs-copy" />);

    const heading = await screen.findByRole("heading", { name: /acme-docs-copy/ });
    expect(heading.textContent).toContain("fork-user/acme-docs-copy");
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText(/Forked from/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "acme-docs" }).getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs",
    );
  });
});
