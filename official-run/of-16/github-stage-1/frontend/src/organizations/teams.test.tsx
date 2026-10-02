import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeAccount, type FakeOrganization } from "../test-utils/fake-api";

const ORG_OWNER: FakeAccount = {
  username: "org-owner",
  email: "org-owner@example.test",
  password: "Valid-password-123!",
};

const TEAM_MAINTAINER: FakeAccount = {
  username: "team-maintainer",
  email: "team-maintainer@example.test",
  password: "Valid-password-123!",
};

const BOB_REVIEWER: FakeAccount = {
  username: "bob-reviewer",
  email: "bob-reviewer@example.test",
  password: "Valid-password-123!",
};

/** Mirrors the seeded organization: two Owners, one member and the team hierarchy. */
const ACME_DEMO: FakeOrganization = {
  slug: "acme-demo",
  name: "Acme Demo",
  displayName: "Acme Demo",
  owners: ["org-owner", "team-maintainer"],
  members: ["bob-reviewer"],
  teams: [
    { name: "platform-team" },
    { name: "frontend-team", parent: "platform-team" },
    { name: "frontend-child", parent: "frontend-team" },
  ],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation, guides and release notes for Acme Demo.",
      visibility: "public",
      updatedAt: "2024-05-02T09:30:00.000Z",
    },
  ],
};

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function renderSignedIn(hash: string, account: FakeAccount) {
  const api = createFakeApi({
    accounts: [ORG_OWNER, TEAM_MAINTAINER, BOB_REVIEWER],
    organizations: [ACME_DEMO],
  });
  api.install();
  api.signInAs(account.username);
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("link", { name: "Account menu" });
  return { api, user };
}

/** Signs in through the account menu entry, the way the scenarios navigate. */
async function openTeamsThroughAccountMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("link", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Your organizations" }));
  await waitFor(() => expect(window.location.hash).toBe("#/organizations"));
  await user.click(await screen.findByRole("link", { name: "Acme Demo" }));
  await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo"));
  await user.click(await screen.findByRole("link", { name: "Teams" }));
  await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/teams"));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("REQ-2-2-1 create an organization team", () => {
  it("scenario 1: creates the team, opens its overview and keeps the heading after a reload", async () => {
    const { user } = await renderSignedIn("#/", ORG_OWNER);
    await openTeamsThroughAccountMenu(user);

    await user.click(await screen.findByRole("link", { name: "New team" }));
    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/teams/new"));

    await user.type(screen.getByLabelText("Team name"), "mobile-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/teams/mobile-team"));
    expect(await screen.findByRole("heading", { name: /mobile-team/ })).toBeTruthy();

    // Reloading the same address restores the team overview.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: /mobile-team/ })).toBeTruthy();
  });

  it("scenario 2: a malformed team name reports the exact message and creates nothing", async () => {
    const { api, user } = await renderSignedIn("#/organizations/acme-demo/teams/new", ORG_OWNER);

    await user.type(screen.getByLabelText("Team name"), "-invalid-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByText("Team name is invalid")).toBeTruthy();
    expect(window.location.hash).toBe("#/organizations/acme-demo/teams/new");
    expect(api.organizations[0].teams.map((team) => team.name)).not.toContain("-invalid-team");
  });

  it("requires a session for the team creation form and lists the team on Teams", async () => {
    const { api, user } = await renderSignedIn("#/organizations/acme-demo", ORG_OWNER);
    await user.click(await screen.findByRole("link", { name: "Teams" }));

    const list = await screen.findByRole("list");
    expect(within(list).getByRole("link", { name: "frontend-team" })).toBeTruthy();
    expect(api.organizations[0].teams).toHaveLength(3);
  });
});

describe("REQ-2-2-2 manage organization team members and hierarchy", () => {
  it("scenario 1: adds and removes bob-reviewer and the removal survives a reload", async () => {
    const { user } = await renderSignedIn("#/organizations/acme-demo/teams/frontend-team/members", TEAM_MAINTAINER);

    // "Add member" opens the form; while it is open only the submit button carries that name.
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(await screen.findByLabelText("Username"), "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const addedList = await screen.findByRole("list", { name: "Team members" });
    expect(within(addedList).getByText("bob-reviewer")).toBeTruthy();
    const removeButton = await screen.findByRole("button", { name: "Remove bob-reviewer" });

    await user.click(removeButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull());
    expect(screen.queryByText("bob-reviewer")).toBeNull();

    // Reloading the Members page keeps the removal.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Add member" })).toBeTruthy();
    expect(screen.queryByText("bob-reviewer")).toBeNull();
  });

  it("scenario 2: a cyclic parent change is rejected and the saved parent stays selected after a reload", async () => {
    const { user } = await renderSignedIn("#/organizations/acme-demo/teams/frontend-team/settings", TEAM_MAINTAINER);

    const parentSelect = await screen.findByLabelText("Parent team") as HTMLSelectElement;
    expect(parentSelect.value).toBe("platform-team");
    expect(within(parentSelect).getByRole("option", { name: "frontend-child" })).toBeTruthy();

    await user.selectOptions(parentSelect, "frontend-child");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).toBeTruthy();
    expect((screen.getByLabelText("Parent team") as HTMLSelectElement).value).toBe("platform-team");

    // Reloading the Settings page restores the stored parent from the server.
    cleanup();
    render(<App />);
    const reloaded = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    expect(reloaded.value).toBe("platform-team");
  });

  it("saves a valid parent change and exposes Members and Settings on the team page", async () => {
    const { api, user } = await renderSignedIn("#/organizations/acme-demo/teams/frontend-team", TEAM_MAINTAINER);

    expect(await screen.findByRole("heading", { name: "frontend-team" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/teams/frontend-team/settings"));

    const parentSelect = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    await user.selectOptions(parentSelect, "");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.organizations[0].teams.find((team) => team.name === "frontend-team")?.parentTeamId).toBeNull());
  });
});
