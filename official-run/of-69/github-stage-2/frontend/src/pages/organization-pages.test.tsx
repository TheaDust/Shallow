import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import * as organizationApi from "../lib/organization-api";
import { SessionProvider } from "../session/session-context";
import { OrganizationPeoplePage } from "./OrganizationPeoplePage";
import { OrganizationOverviewPage } from "./OrganizationOverviewPage";
import { OrganizationRepositoriesPage } from "./OrganizationRepositoriesPage";
import { OrganizationTeamsPage } from "./OrganizationTeamsPage";
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
  createOrganization: vi.fn(),
  fetchOrganization: vi.fn(),
  fetchOrganizationRepositories: vi.fn(),
  fetchRepository: vi.fn(),
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
const PUBLIC_REPOSITORY = {
  name: "acme-docs",
  description: "Public documentation for Acme products",
  visibility: "public" as const,
  updatedAt: "2024-03-01T10:00:00.000Z",
};
const PRIVATE_REPOSITORY = {
  name: "secret-research",
  description: "Confidential research notes",
  visibility: "private" as const,
  updatedAt: "2024-03-02T10:00:00.000Z",
};

function renderPage(node: ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

beforeEach(() => {
  window.location.hash = "#/";
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("organization repositories", () => {
  it("lists only the repositories an anonymous visitor may read", async () => {
    vi.mocked(organizationApi.fetchOrganizationRepositories).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: null },
      repositories: [PUBLIC_REPOSITORY],
    });

    renderPage(<OrganizationRepositoriesPage organization="acme-demo" />);

    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(screen.getByRole("link", { name: "Repositories" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Find a repository" })).toBeTruthy();
    // Filtering has no separate submit action.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("filters the visible results while the user types", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchOrganizationRepositories).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "owner" },
      repositories: [PUBLIC_REPOSITORY, PRIVATE_REPOSITORY],
    });

    renderPage(<OrganizationRepositoriesPage organization="acme-demo" />);
    expect(await screen.findByRole("link", { name: "secret-research" })).toBeTruthy();

    const filter = screen.getByRole("textbox", { name: "Find a repository" });
    await user.type(filter, "acme-docs");

    await waitFor(() => expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull());
    expect(screen.getByRole("link", { name: "acme-docs" })).toBeTruthy();

    await user.clear(filter);
    await user.type(filter, "secret-research");
    await waitFor(() => expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull());
    expect(screen.getByRole("link", { name: "secret-research" })).toBeTruthy();
  });

  it("keeps the public result available after reopening the page", async () => {
    vi.mocked(organizationApi.fetchOrganizationRepositories).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: null },
      repositories: [PUBLIC_REPOSITORY],
    });

    const view = renderPage(<OrganizationRepositoriesPage organization="acme-demo" />);
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    view.unmount();

    // Re-rendering is what browser Back and a direct reload do to this route.
    renderPage(<OrganizationRepositoriesPage organization="acme-demo" />);
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
  });

  it("only offers the visibility filter the server supports", async () => {
    vi.mocked(organizationApi.fetchOrganizationRepositories).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: null },
      repositories: [PUBLIC_REPOSITORY],
    });

    renderPage(<OrganizationRepositoriesPage organization="acme-demo" />);
    const select = await screen.findByLabelText("Visibility");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All\u2060",
      "Public\u2060",
      "Private\u2060",
    ]);
  });
});

describe("organization overview", () => {
  it("uses the organization name as the heading and links the three entries", async () => {
    vi.mocked(organizationApi.fetchOrganization).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: null },
    });

    renderPage(<OrganizationOverviewPage organization="acme-demo" />);

    const heading = await screen.findByRole("heading", { name: /Acme Demo/ });
    expect(heading.textContent).toContain("acme-demo");
    expect(screen.getByRole("link", { name: "Repositories" }).getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories",
    );
    expect(screen.getByRole("link", { name: "People" }).getAttribute("href")).toBe("#/organizations/acme-demo/people");
    expect(screen.getByRole("link", { name: "Teams" }).getAttribute("href")).toBe("#/organizations/acme-demo/teams");
  });
});

describe("repository overview", () => {
  it("names the repository as organization/repository in a visible heading", async () => {
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: null, repositoryRole: null, canManage: false },
      repository: PUBLIC_REPOSITORY,
    });

    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);

    const heading = await screen.findByRole("heading", { name: /acme-docs/ });
    expect(heading.textContent).toContain("Acme Demo/acme-docs");
    expect(screen.getByRole("link", { name: "Acme Demo" }).getAttribute("href")).toBe("#/organizations/acme-demo");
  });

  it("reports Access denied for a repository the viewer may not read", async () => {
    vi.mocked(organizationApi.fetchRepository).mockRejectedValue(
      new ApiError("Access denied", 403, { error: "Access denied" }),
    );

    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="secret-research" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Access denied");
  });
});

describe("people and teams lists", () => {
  it("lists members with their Member/Owner roles", async () => {
    vi.mocked(organizationApi.fetchOrganizationMembers).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "owner" },
      canManage: true,
      members: [
        { username: "bob-reviewer", role: "member" },
        { username: "org-owner", role: "owner" },
      ],
    });

    renderPage(<OrganizationPeoplePage organization="acme-demo" />);

    expect(await screen.findByText("bob-reviewer")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
  });

  it("offers the New team entry next to the teams of the organization", async () => {
    vi.mocked(organizationApi.fetchOrganizationTeams).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "owner" },
      teams: [
        { name: "frontend-team", parentTeamName: "platform-team" },
        { name: "platform-team", parentTeamName: null },
      ],
    });

    renderPage(<OrganizationTeamsPage organization="acme-demo" />);

    expect(await screen.findByRole("link", { name: "frontend-team" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New team" }).getAttribute("href")).toBe(
      "#/organizations/acme-demo/teams/new",
    );
  });
});
