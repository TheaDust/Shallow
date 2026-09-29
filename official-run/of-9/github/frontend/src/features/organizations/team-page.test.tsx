import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamPage } from "./TeamPage";

const mocks = vi.hoisted(() => ({
  getTeam: vi.fn(),
  listTeamMembers: vi.fn(),
  listTeams: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  setTeamParent: vi.fn(),
}));

vi.mock("./api", () => ({
  getTeam: mocks.getTeam,
  listTeamMembers: mocks.listTeamMembers,
  listTeams: mocks.listTeams,
  addTeamMember: mocks.addTeamMember,
  removeTeamMember: mocks.removeTeamMember,
  setTeamParent: mocks.setTeamParent,
}));

const now = new Date().toISOString();

const teamOverview = {
  team: {
    id: "acme-demo:frontend-team",
    orgId: "acme-demo",
    name: "frontend-team",
    description: "",
    parentId: "acme-demo:platform-team",
    parentName: "platform-team",
    createdBy: "alice-dev",
    createdAt: now,
  },
  organization: { id: "acme-demo", displayName: "Acme Demo" },
  myRole: "owner",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTeam.mockResolvedValue(teamOverview);
  mocks.listTeamMembers.mockResolvedValue([]);
  mocks.listTeams.mockResolvedValue([
    {
      id: "acme-demo:platform-team",
      orgId: "acme-demo",
      name: "platform-team",
      description: "",
      parentId: null,
      parentName: null,
      createdBy: "alice-dev",
      createdAt: now,
    },
    {
      id: "acme-demo:frontend-child",
      orgId: "acme-demo",
      name: "frontend-child",
      description: "",
      parentId: "acme-demo:frontend-team",
      parentName: "frontend-team",
      createdBy: "alice-dev",
      createdAt: now,
    },
  ]);
});

afterEach(() => {
  cleanup();
});

describe("TeamPage members tab", () => {
  it("shows the team title, Members and Settings links", async () => {
    render(<TeamPage orgId="acme-demo" teamName="frontend-team" tab="members" />);
    expect(await screen.findByRole("heading", { name: "acme-demo/frontend-team" })).toBeTruthy();
    const members = screen.getByRole("link", { name: "Members" });
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(members.getAttribute("href")).toBe("#/orgs/acme-demo/teams/frontend-team/members");
    expect(settings.getAttribute("href")).toBe("#/orgs/acme-demo/teams/frontend-team/settings");
  });

  it("adds a member with the Add member form and removes with Remove <username>", async () => {
    const user = userEvent.setup();
    mocks.addTeamMember.mockResolvedValue({ ok: true });
    mocks.removeTeamMember.mockResolvedValue({ ok: true });
    mocks.listTeamMembers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["bob-reviewer"])
      .mockResolvedValueOnce([]);
    render(<TeamPage orgId="acme-demo" teamName="frontend-team" tab="members" />);

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    // The opening button is hidden while the picker form is active.
    expect(screen.queryAllByRole("button", { name: "Add member" })).toHaveLength(1);
    await user.type(screen.getByLabelText("Username"), "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("bob-reviewer")).toBeTruthy();
    expect(mocks.addTeamMember).toHaveBeenCalledWith("acme-demo", "frontend-team", "bob-reviewer");

    await user.click(screen.getByRole("button", { name: "Remove bob-reviewer" }));
    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
    expect(mocks.removeTeamMember).toHaveBeenCalledWith("acme-demo", "frontend-team", "bob-reviewer");
  });

  it("keeps the form open and shows the reason when adding fails", async () => {
    const user = userEvent.setup();
    mocks.addTeamMember.mockResolvedValue({
      ok: false,
      errors: { username: "Account is not a member of the organization" },
    });
    render(<TeamPage orgId="acme-demo" teamName="frontend-team" tab="members" />);
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Username"), "nobody");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account is not a member of the organization")).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
  });
});

describe("TeamPage settings tab", () => {
  it("renders a native Parent team select and Save button", async () => {
    render(<TeamPage orgId="acme-demo" teamName="frontend-team" tab="settings" />);
    const select = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    // Original parent remains selected.
    expect(select.value).toBe("acme-demo:platform-team");
  });

  it("rejects a cyclic hierarchy, keeps the original parent and shows the cycle error", async () => {
    const user = userEvent.setup();
    mocks.setTeamParent.mockResolvedValue({
      ok: false,
      errors: { parentId: "Cyclic team hierarchy is not allowed" },
    });
    render(<TeamPage orgId="acme-demo" teamName="frontend-team" tab="settings" />);
    const select = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    await user.selectOptions(select, "acme-demo:frontend-child");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).toBeTruthy();
    expect(select.value).toBe("acme-demo:platform-team");
    expect(mocks.setTeamParent).toHaveBeenCalledWith("acme-demo", "frontend-team", "acme-demo:frontend-child");
  });

  it("saves a new parent team and keeps the selection", async () => {
    const user = userEvent.setup();
    mocks.setTeamParent.mockResolvedValue({
      ok: true,
      team: {
        ...teamOverview.team,
        parentId: "acme-demo:platform-team",
        parentName: "platform-team",
      },
    });
    render(<TeamPage orgId="acme-demo" teamName="frontend-team" tab="settings" />);
    const select = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    await user.selectOptions(select, "acme-demo:platform-team");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(select.value).toBe("acme-demo:platform-team"));
  });

  it("hides management controls for non-owners", async () => {
    mocks.getTeam.mockResolvedValue({ ...teamOverview, myRole: "member" });
    render(<TeamPage orgId="acme-demo" teamName="frontend-team" tab="members" />);
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();
  });
});
