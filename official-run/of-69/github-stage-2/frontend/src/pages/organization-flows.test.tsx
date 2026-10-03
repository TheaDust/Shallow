import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import * as organizationApi from "../lib/organization-api";
import { SessionProvider } from "../session/session-context";
import { NewOrganizationPage } from "./NewOrganizationPage";
import { NewTeamPage } from "./NewTeamPage";
import { TeamMembersPage } from "./TeamMembersPage";
import { TeamSettingsPage } from "./TeamSettingsPage";

vi.mock("../lib/session-api", () => ({
  fetchSession: vi.fn().mockResolvedValue({
    id: "account-org-owner",
    username: "org-owner",
    email: "org-owner@example.test",
    emailVerified: true,
    status: "available",
  }),
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

const ACCOUNT = {
  id: "account-org-owner",
  username: "org-owner",
  email: "org-owner@example.test",
  emailVerified: true,
  status: "available",
};

const ORGANIZATION = { name: "acme-demo", displayName: "Acme Demo" };

function renderPage(node: ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

beforeEach(() => {
  window.location.hash = "#/";
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("organization creation", () => {
  it("renders the labeled fields and the creation button", () => {
    renderPage(<NewOrganizationPage account={ACCOUNT} />);

    expect(screen.getByRole("heading", { name: "New organization" })).toBeTruthy();
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create organization" })).toBeTruthy();
  });

  it("reports an existing identifier without opening an organization", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.createOrganization).mockRejectedValue(
      new ApiError("Unprocessable", 422, { errors: { name: "Organization name already exists" } }),
    );

    renderPage(<NewOrganizationPage account={ACCOUNT} />);
    await user.type(screen.getByLabelText("Organization name"), "Acme Demo");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New organization" })).toBeTruthy();
    expect(window.location.hash).toBe("#/");
  });

  it("reports both an invalid identifier and a whitespace-only display name", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.createOrganization).mockRejectedValue(
      new ApiError("Unprocessable", 422, {
        errors: { name: "Organization name format is invalid", displayName: "Display name is required" },
      }),
    );

    renderPage(<NewOrganizationPage account={ACCOUNT} />);
    await user.type(screen.getByLabelText("Organization name"), "-invalid-organization");
    await user.type(screen.getByLabelText("Display name"), "   ");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name format is invalid")).toBeTruthy();
    expect(screen.getByText("Display name is required")).toBeTruthy();
    expect(vi.mocked(organizationApi.createOrganization).mock.calls[0][0]).toEqual({
      name: "-invalid-organization",
      displayName: "   ",
    });
  });

  it("opens the new organization overview after a successful submission", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.createOrganization).mockResolvedValue({ name: "mobile-guild", displayName: "Mobile Guild" });

    renderPage(<NewOrganizationPage account={ACCOUNT} />);
    await user.type(screen.getByLabelText("Organization name"), "mobile-guild");
    await user.type(screen.getByLabelText("Display name"), "Mobile Guild");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => expect(window.location.hash).toBe("#/organizations/mobile-guild"));
  });
});

describe("team creation", () => {
  it("reports an invalid team name", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.createTeam).mockRejectedValue(
      new ApiError("Unprocessable", 422, { errors: { name: "Team name is invalid" } }),
    );

    renderPage(<NewTeamPage organization="acme-demo" />);
    await user.type(screen.getByLabelText("Team name"), "-invalid-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByText("Team name is invalid")).toBeTruthy();
  });

  it("opens the new team overview after a successful submission", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.createTeam).mockResolvedValue({ name: "mobile-team", parentTeamName: null });

    renderPage(<NewTeamPage organization="acme-demo" />);
    await user.type(screen.getByLabelText("Team name"), "mobile-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/teams/mobile-team"));
  });
});

describe("team members", () => {
  it("adds and removes an organization member", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchTeamMembers).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "owner" },
      canManage: true,
      team: { name: "frontend-team" },
      members: [],
    });
    vi.mocked(organizationApi.addTeamMember).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "owner" },
      canManage: true,
      team: { name: "frontend-team" },
      members: [{ username: "bob-reviewer" }],
    });
    vi.mocked(organizationApi.removeTeamMember).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "owner" },
      canManage: true,
      team: { name: "frontend-team" },
      members: [],
    });

    renderPage(<TeamMembersPage organization="acme-demo" team="frontend-team" />);
    expect(await screen.findByText("This team has no members.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add member" }));
    // Once the form is open, one “Add member” button (the submit) remains.
    expect(screen.getAllByRole("button", { name: "Add member" })).toHaveLength(1);
    await user.type(screen.getByRole("textbox", { name: "Username" }), "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("bob-reviewer")).toBeTruthy();
    expect(vi.mocked(organizationApi.addTeamMember).mock.calls[0]).toEqual([
      "acme-demo",
      "frontend-team",
      "bob-reviewer",
    ]);

    await user.click(screen.getByRole("button", { name: "Remove bob-reviewer" }));
    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
  });

  it("hides the management controls from a non-Owner viewer", async () => {
    vi.mocked(organizationApi.fetchTeamMembers).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "member" },
      canManage: false,
      team: { name: "frontend-team" },
      members: [{ username: "bob-reviewer" }],
    });

    renderPage(<TeamMembersPage organization="acme-demo" team="frontend-team" />);

    expect(await screen.findByText("bob-reviewer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();
  });
});

describe("team settings", () => {
  it("rejects a cyclic parent team and keeps the saved parent selected", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchTeam).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "owner" },
      canManage: true,
      team: { name: "frontend-team", parentTeamName: "platform-team" },
      teams: [{ name: "frontend-child" }, { name: "platform-team" }],
    });
    vi.mocked(organizationApi.saveTeamParent).mockRejectedValue(
      new ApiError("Cyclic team hierarchy is not allowed", 422, { error: "Cyclic team hierarchy is not allowed" }),
    );

    renderPage(<TeamSettingsPage organization="acme-demo" team="frontend-team" />);

    const parent = await screen.findByLabelText("Parent team");
    await waitFor(() => expect((parent as HTMLSelectElement).value).toBe("platform-team"));

    await user.selectOptions(parent, "frontend-child");
    expect((parent as HTMLSelectElement).value).toBe("frontend-child");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).toBeTruthy();
    expect(vi.mocked(organizationApi.saveTeamParent).mock.calls[0]).toEqual([
      "acme-demo",
      "frontend-team",
      "frontend-child",
    ]);
    // The rejected change is not applied: the saved parent stays selected.
    expect((screen.getByLabelText("Parent team") as HTMLSelectElement).value).toBe("platform-team");
  });

  it("saves a valid parent team change", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchTeam).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "owner" },
      canManage: true,
      team: { name: "frontend-team", parentTeamName: null },
      teams: [{ name: "frontend-child" }, { name: "platform-team" }],
    });
    vi.mocked(organizationApi.saveTeamParent).mockResolvedValue({
      name: "frontend-team",
      parentTeamName: "platform-team",
    });

    renderPage(<TeamSettingsPage organization="acme-demo" team="frontend-team" />);
    const parent = await screen.findByLabelText("Parent team");
    await user.selectOptions(parent, "platform-team");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Parent team saved")).toBeTruthy();
    expect((screen.getByLabelText("Parent team") as HTMLSelectElement).value).toBe("platform-team");
  });
});
