import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as organizationApi from "../lib/organization-api";
import { SessionProvider } from "../session/session-context";
import { HomePage } from "./HomePage";
import { RepositoryOverviewPage } from "./RepositoryOverviewPage";
import { RepositorySettingsPage } from "./RepositorySettingsPage";
import { SearchPage } from "./SearchPage";

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
const PUBLIC_RESULT = {
  name: "acme-docs",
  owner: ORGANIZATION,
  visibility: "public" as const,
  description: "Public documentation for Acme products",
  updatedAt: "2024-03-01T10:00:00.000Z",
};

function renderPage(node: ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

beforeEach(() => {
  window.location.hash = "#/";
  vi.clearAllMocks();
  vi.mocked(organizationApi.fetchPublicOrganizations).mockResolvedValue([ORGANIZATION]);
  vi.mocked(organizationApi.fetchReadableRepositories).mockResolvedValue([PUBLIC_RESULT]);
});

afterEach(cleanup);

describe("REQ-3-1 global repository search", () => {
  it("has a searchbox named Search that submits the query on Enter", async () => {
    const user = userEvent.setup();
    renderPage(<HomePage />);

    const searchbox = screen.getByRole("searchbox", { name: "Search" });
    await user.type(searchbox, "acme-docs{Enter}");

    await waitFor(() => expect(window.location.hash).toBe("#/search?q=acme-docs"));
  });

  it("shows the result link named exactly after the repository with its owner metadata", async () => {
    window.location.hash = "#/search?q=acme-docs";
    vi.mocked(organizationApi.searchRepositories).mockResolvedValue([PUBLIC_RESULT]);

    renderPage(<SearchPage />);

    const link = await screen.findByRole("link", { name: "acme-docs" });
    expect(link.getAttribute("href")).toBe("#/organizations/acme-demo/repositories/acme-docs");
    expect(screen.getByText("Acme Demo/acme-docs")).toBeTruthy();
    // The query that produced the results stays in the top searchbox.
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("acme-docs");
  });

  it("exposes no result link for a private repository and reports No results", async () => {
    window.location.hash = "#/search?q=secret-research";
    vi.mocked(organizationApi.searchRepositories).mockResolvedValue([]);

    const view = renderPage(<SearchPage />);

    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(vi.mocked(organizationApi.searchRepositories).mock.calls[0]).toEqual(["secret-research"]);

    // Returning home and repeating the same query keeps the same empty answer.
    window.location.hash = "#/";
    vi.mocked(organizationApi.searchRepositories).mockClear();
    view.unmount();
    renderPage(<HomePage />);
    const searchbox = screen.getByRole("searchbox", { name: "Search" });
    await userEvent.setup().type(searchbox, "secret-research{Enter}");
    await waitFor(() => expect(window.location.hash).toBe("#/search?q=secret-research"));
  });

  it("reports No results for a query without any matching repository", async () => {
    window.location.hash = "#/search?q=no-such-repository";
    vi.mocked(organizationApi.searchRepositories).mockResolvedValue([]);

    renderPage(<SearchPage />);

    expect(await screen.findByText("No results")).toBeTruthy();
  });

  it("lists readable repositories on the home page so a public repository can be opened", async () => {
    renderPage(<HomePage />);

    const link = await screen.findByRole("link", { name: "acme-docs" });
    expect(link.getAttribute("href")).toBe("#/organizations/acme-demo/repositories/acme-docs");
  });
});

describe("REQ-3-3 public repository overview", () => {
  it("shows the heading, the Public marker and the Code navigation link", async () => {
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: null, repositoryRole: null, canManage: false },
      repository: {
        name: "acme-docs",
        description: "Public documentation for Acme products",
        visibility: "public",
        updatedAt: "2024-03-01T10:00:00.000Z",
      },
    });

    renderPage(<RepositoryOverviewPage organization="acme-demo" repository="acme-docs" />);

    const heading = await screen.findByRole("heading", { name: /acme-docs/ });
    expect(heading.textContent).toContain("Acme Demo/acme-docs");
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Code" }).getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs",
    );
    // A visitor sees no administrable entry.
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});

describe("REQ-3-4 change repository visibility", () => {
  function repositoryDetail(canManage: boolean, visibility: "public" | "private" = "private") {
    return {
      organization: ORGANIZATION,
      viewer: { role: null, repositoryRole: canManage ? ("admin" as const) : ("read" as const), canManage },
      repository: {
        name: "visibility-demo",
        description: "Visibility demonstration repository",
        visibility,
        updatedAt: "2024-03-03T10:00:00.000Z",
      },
    };
  }

  it("lets the administrator confirm the Public radio and opens the overview", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(repositoryDetail(true));
    vi.mocked(organizationApi.updateRepositoryVisibility).mockResolvedValue(repositoryDetail(true, "public"));

    renderPage(<RepositorySettingsPage organization="acme-demo" repository="visibility-demo" />);

    await user.click(await screen.findByRole("link", { name: "General" }));
    await user.click(screen.getByRole("button", { name: "Change visibility" }));

    const dialog = await screen.findByRole("dialog", { name: "Change visibility" });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    await waitFor(() =>
      expect(vi.mocked(organizationApi.updateRepositoryVisibility).mock.calls[0]).toEqual([
        "acme-demo",
        "visibility-demo",
        "public",
      ]),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/visibility-demo"));
  });

  it("keeps a failed change visible instead of pretending it succeeded", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(repositoryDetail(true));
    vi.mocked(organizationApi.updateRepositoryVisibility).mockRejectedValue(new Error("Access denied"));

    renderPage(<RepositorySettingsPage organization="acme-demo" repository="visibility-demo" />);
    await user.click(await screen.findByRole("button", { name: "Change visibility" }));
    await user.click(await screen.findByRole("radio", { name: "Public" }));
    await user.click(screen.getByRole("button", { name: "Confirm visibility" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(window.location.hash).toBe("#/");
  });

  it("offers a non-admin collaborator no actionable Change visibility button", async () => {
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(repositoryDetail(false));

    renderPage(<RepositorySettingsPage organization="acme-demo" repository="visibility-demo" />);

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
