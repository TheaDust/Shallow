import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";

const OWNER = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

const MEMBER = {
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  password: "Valid-password-123!",
};

const ORGANIZATION: StubOrganization = {
  name: "acme-demo",
  displayName: "Acme Demo",
  members: [
    { username: "alice-dev", role: "owner" },
    { username: "bob-reviewer", role: "member" },
  ],
  teams: [
    { name: "platform-team" },
    { name: "design-team" },
    { name: "frontend-team", description: "Frontend maintainers", parent: "platform-team" },
    { name: "frontend-child", parent: "frontend-team" },
  ],
  repositories: [{ name: "acme-docs", description: "Docs.", visibility: "public" }],
};

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  renderApp("#/login");
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-2-2-1 create an organization team", () => {
  it("an Owner creates a team from the Teams tab and lands on its page", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);

    window.location.hash = "#/organizations/acme-demo?tab=teams";
    const newTeamLink = await screen.findByRole("link", { name: "New team" });
    expect(newTeamLink.getAttribute("href")).toBe("#/organizations/acme-demo/teams/new");
    // The existing tree already shows the stored parent relationship.
    expect(screen.getByRole("link", { name: "frontend-team" })).toBeTruthy();
    expect(screen.getAllByText("Parent team: platform-team").length).toBeGreaterThan(0);

    await user.click(newTeamLink);
    await screen.findByRole("heading", { name: "New team" });
    await user.type(screen.getByLabelText("Team name"), "mobile-team");
    await user.type(screen.getByLabelText("Description"), "Mobile clients");
    await user.selectOptions(screen.getByLabelText("Parent team"), "platform-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByRole("heading", { name: "acme-demo/mobile-team" })).toBeTruthy();
    expect(screen.getByText("Organization: acme-demo")).toBeTruthy();
    expect(screen.getByText("Parent team: platform-team")).toBeTruthy();

    window.location.hash = "#/organizations/acme-demo?tab=teams";
    const tree = await screen.findByRole("link", { name: "mobile-team" });
    const item = tree.closest("li") as HTMLElement;
    expect(within(item).getByText("Parent team: platform-team")).toBeTruthy();
    expect(within(item).getByText("Mobile clients")).toBeTruthy();
  });

  it("reports a malformed name and keeps the creation page open", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);

    window.location.hash = "#/organizations/acme-demo/teams/new";
    await user.type(await screen.findByLabelText("Team name"), "-mobile-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByText("Team name format is invalid")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New team" })).toBeTruthy();
    expect((screen.getByLabelText("Team name") as HTMLInputElement).value).toBe("-mobile-team");
  });

  it("never offers New team to a plain member", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);

    window.location.hash = "#/organizations/acme-demo?tab=teams";
    await screen.findByRole("link", { name: "frontend-team" });
    expect(screen.queryByRole("link", { name: "New team" })).toBeNull();

    window.location.hash = "#/organizations/acme-demo/teams/new";
    expect(
      await screen.findByText("Only an organization Owner can create teams."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create team" })).toBeNull();
  });
});

describe("REQ-2-2-2 manage organization team members and hierarchy", () => {
  async function openTeam(user: ReturnType<typeof userEvent.setup>) {
    await signIn(user, OWNER.username);
    window.location.hash = "#/organizations/acme-demo/teams/frontend-team";
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });
  }

  it("adds and removes a direct member and rejects a cyclic parent", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await openTeam(user);

    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add member" }));
    const username = await screen.findByLabelText("Username");
    await user.type(username, "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const removeButton = await screen.findByRole("button", { name: "Remove bob-reviewer" });
    expect(screen.getAllByText("bob-reviewer")).toHaveLength(1);

    // A second removal control only appears for a stored membership.
    expect(screen.getAllByRole("button", { name: "Remove bob-reviewer" })).toHaveLength(1);
    await user.click(removeButton);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull(),
    );

    await user.click(screen.getByRole("link", { name: "Settings" }));
    const parentSelect = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    expect(parentSelect.value).toBe("platform-team");
    await user.selectOptions(parentSelect, "frontend-child");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).toBeTruthy();
    // The stored parent stays selected after the rejected change.
    expect((screen.getByLabelText("Parent team") as HTMLSelectElement).value).toBe(
      "platform-team",
    );
    expect(screen.getByText("Parent team: platform-team")).toBeTruthy();
  });

  it("saves a valid parent change and shows it in the organization tree", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await openTeam(user);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    const parentSelect = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    await user.selectOptions(parentSelect, "design-team");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("Parent team: design-team")).toBeTruthy(),
    );

    window.location.hash = "#/organizations/acme-demo?tab=teams";
    const tree = await screen.findByRole("link", { name: "frontend-team" });
    expect(within(tree.closest("li") as HTMLElement).getByText("Parent team: design-team")).toBeTruthy();
  });

  it("hides add and remove controls from a plain member", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);

    window.location.hash = "#/organizations/acme-demo/teams/frontend-team";
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(
      await screen.findByText("Only an organization Owner can change the team hierarchy."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
