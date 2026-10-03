import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import * as organizationApi from "../lib/organization-api";
import { SessionProvider } from "../session/session-context";
import { OrganizationPeoplePage } from "./OrganizationPeoplePage";
import { RepositoryAccessPage } from "./RepositoryAccessPage";

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
  REPOSITORY_ROLES: ["read", "triage", "write", "maintain", "admin"],
  REPOSITORY_ROLE_LABELS: {
    read: "Read",
    triage: "Triage",
    write: "Write",
    maintain: "Maintain",
    admin: "Admin",
  },
}));

const ORGANIZATION = { name: "acme-demo", displayName: "Acme Demo" };
const REPOSITORY = {
  name: "acme-docs",
  description: "Public documentation",
  visibility: "public" as const,
  updatedAt: "2024-03-01T10:00:00.000Z",
};

function renderPage(node: ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

function ownerMembers(usernames: string[], canManage = true) {
  return {
    organization: ORGANIZATION,
    viewer: { role: "owner" as const },
    canManage,
    members: usernames.map((username) => ({
      username,
      role: username === "org-owner" ? ("owner" as const) : ("member" as const),
    })),
  };
}

beforeEach(() => {
  window.location.hash = "#/";
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("REQ-2-2-3 add an organization member", () => {
  it("offers the labeled form and adds a registered account immediately", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchOrganizationMembers).mockResolvedValue(
      ownerMembers(["org-owner", "existing-member"]),
    );
    vi.mocked(organizationApi.addOrganizationMember).mockResolvedValue(
      ownerMembers(["new-member", "org-owner", "existing-member"]),
    );

    renderPage(<OrganizationPeoplePage organization="acme-demo" />);
    await user.click(await screen.findByRole("button", { name: "Add member" }));

    expect(screen.getByLabelText("Username or email")).toBeTruthy();
    expect(screen.getByLabelText("Role")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Member/ })).toBeTruthy();

    await user.type(screen.getByLabelText("Username or email"), "new-member");
    await user.selectOptions(screen.getByLabelText("Role"), "member");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("new-member")).toBeTruthy();
    expect(vi.mocked(organizationApi.addOrganizationMember).mock.calls[0]).toEqual([
      "acme-demo",
      "new-member",
      "member",
    ]);
    // No pending/invitation state is introduced anywhere on the page.
    expect(screen.queryByText("Pending invitation")).toBeNull();
  });

  it("reports an existing member without duplicating the relationship", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchOrganizationMembers).mockResolvedValue(
      ownerMembers(["org-owner", "existing-member"]),
    );
    vi.mocked(organizationApi.addOrganizationMember).mockRejectedValue(
      new ApiError("Account is already a member", 422, { error: "Account is already a member" }),
    );

    renderPage(<OrganizationPeoplePage organization="acme-demo" />);
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Username or email"), "existing-member");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("Account is already a member")).toBeTruthy();
    expect(screen.getAllByText("existing-member")).toHaveLength(1);
  });

  it("reports an unknown account", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchOrganizationMembers).mockResolvedValue(ownerMembers(["org-owner"]));
    vi.mocked(organizationApi.addOrganizationMember).mockRejectedValue(
      new ApiError("Account not found", 422, { error: "Account not found" }),
    );

    renderPage(<OrganizationPeoplePage organization="acme-demo" />);
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Username or email"), "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("Account not found")).toBeTruthy();
  });
});

describe("REQ-2-2-4 remove an organization member", () => {
  it("removes the member through the Member menu and the confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchOrganizationMembers).mockResolvedValue(
      ownerMembers(["org-owner", "existing-member"]),
    );
    vi.mocked(organizationApi.removeOrganizationMember).mockResolvedValue(ownerMembers(["org-owner"]));

    renderPage(<OrganizationPeoplePage organization="acme-demo" />);
    await screen.findByText("existing-member");

    await user.click(screen.getByRole("button", { name: "Member menu existing-member" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove from organization" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("existing-member")).toBeNull());
    expect(vi.mocked(organizationApi.removeOrganizationMember).mock.calls[0]).toEqual([
      "acme-demo",
      "existing-member",
    ]);
  });

  it("exposes no Member menu to a non-Owner viewer", async () => {
    vi.mocked(organizationApi.fetchOrganizationMembers).mockResolvedValue({
      organization: ORGANIZATION,
      viewer: { role: "member" },
      canManage: false,
      members: [
        { username: "protected-member", role: "member" },
        { username: "org-owner", role: "owner" },
      ],
    });

    renderPage(<OrganizationPeoplePage organization="acme-demo" />);
    expect(await screen.findByText("protected-member")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Member menu protected-member" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
  });
});

describe("REQ-2-3 repository access", () => {
  function accessResponse(grants: { id: string; name: string; role: organizationApi.RepositoryRole }[]) {
    return {
      organization: ORGANIZATION,
      viewer: { role: "owner" as const },
      repository: REPOSITORY,
      canManage: true,
      grants: grants.map((grant) => ({
        id: grant.id,
        kind: "team" as const,
        name: grant.name,
        role: grant.role,
      })),
      teams: [{ name: "frontend-team" }, { name: "access-role-team" }],
    };
  }

  it("grants a team Write access through the picker", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchRepositoryAccess).mockResolvedValue(
      accessResponse([{ id: "grant-1", name: "access-role-team", role: "write" }]),
    );
    vi.mocked(organizationApi.addRepositoryTeamGrant).mockResolvedValue(
      accessResponse([
        { id: "grant-1", name: "access-role-team", role: "write" },
        { id: "grant-2", name: "frontend-team", role: "write" },
      ]),
    );

    renderPage(<RepositoryAccessPage organization="acme-demo" repository="acme-docs" />);
    await user.click(await screen.findByRole("button", { name: "Add people or teams" }));

    // The picker's own field is scoped to the dialog, because the top bar also
    // carries the global “Search” searchbox.
    const picker = await screen.findByRole("dialog");
    await user.type(within(picker).getByLabelText("Search"), "frontend-team");
    await user.click(screen.getByRole("radio", { name: "frontend-team" }));
    await user.selectOptions(screen.getByLabelText("Role"), "write");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(vi.mocked(organizationApi.addRepositoryTeamGrant).mock.calls[0]).toEqual([
      "acme-demo",
      "acme-docs",
      "frontend-team",
      "write",
    ]);
    // The picker closes on success, so only the saved access row remains.
    const row = (await screen.findByText("frontend-team")).closest("tr")!;
    expect(within(row).getByText("Write")).toBeTruthy();
  });

  it("changes an existing access row role in place", async () => {
    const user = userEvent.setup();
    vi.mocked(organizationApi.fetchRepositoryAccess).mockResolvedValue(
      accessResponse([{ id: "grant-1", name: "access-role-team", role: "write" }]),
    );
    vi.mocked(organizationApi.updateRepositoryGrant).mockResolvedValue(
      accessResponse([{ id: "grant-1", name: "access-role-team", role: "read" }]),
    );

    renderPage(<RepositoryAccessPage organization="acme-demo" repository="acme-docs" />);
    const row = (await screen.findByText("access-role-team")).closest("tr")!;
    expect(within(row).getByText("Write")).toBeTruthy();

    await user.selectOptions(within(row).getByLabelText("Role"), "read");
    await user.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(row).getByText("Read")).toBeTruthy());
    expect(within(row).queryByText("Write")).toBeNull();
    expect(vi.mocked(organizationApi.updateRepositoryGrant).mock.calls[0]).toEqual([
      "acme-demo",
      "acme-docs",
      "grant-1",
      "read",
    ]);
  });
});
