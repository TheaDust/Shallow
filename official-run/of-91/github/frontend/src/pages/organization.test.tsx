import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function selectValue(element: HTMLElement): string {
  return (element as HTMLSelectElement).value;
}

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password = "Valid-password-123!",
) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function openOrganization(
  user: ReturnType<typeof userEvent.setup>,
  displayName = "Acme Demo",
) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Your organizations" }));
  await user.click(await screen.findByRole("link", { name: displayName }));
  await screen.findByRole("link", { name: "Repositories" });
}

async function openTeam(
  user: ReturnType<typeof userEvent.setup>,
  organizationId: string,
  teamName: string,
) {
  await user.click(await screen.findByRole("link", { name: "Teams" }));
  await user.click(await screen.findByRole("link", { name: teamName }));
  await screen.findByRole("heading", { name: teamName });
  expect(window.location.hash).toContain(`/orgs/${organizationId}/teams/${teamName}`);
}

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-2-1-1 browse organization repositories", () => {
  it("opens a public repository from the visitor organization page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Acme Demo" }));
    expect(await screen.findByRole("heading", { name: /Acme Demo/ })).not.toBeNull();

    const repositories = await screen.findByRole("link", { name: "Repositories" });
    expect(repositories.getAttribute("href")).toBe("#/orgs/acme-demo/repositories");
    await user.click(repositories);

    const findRepository = await screen.findByLabelText("Find a repository");
    (findRepository as HTMLInputElement).focus();
    await user.type(findRepository, "acme-docs");

    await user.click(screen.getByRole("link", { name: "acme-docs" }));

    const heading = await screen.findByRole("heading", { name: /acme-docs/ });
    expect(heading.textContent).toContain("Acme Demo/acme-docs");

    // Back to the organization and into the list again: the public result stays.
    await user.click(screen.getByRole("link", { name: "Acme Demo" }));
    await user.click(await screen.findByRole("link", { name: "Repositories" }));
    expect(await screen.findByRole("link", { name: "acme-docs" })).not.toBeNull();
  });

  it("never exposes the private repository link to a visitor", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Acme Demo" }));
    await user.click(await screen.findByRole("link", { name: "Repositories" }));
    await screen.findByRole("link", { name: "acme-docs" });
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    await user.type(screen.getByLabelText("Find a repository"), "secret-research");

    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(screen.queryByText("secret-research")).toBeNull();
    expect(screen.getByText("No repositories matched your filter.")).not.toBeNull();
  });

  it("filters the visible repositories by visibility for a signed-in Owner", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");
    await openOrganization(user);

    await screen.findByRole("link", { name: "acme-docs" });
    expect(screen.getByRole("link", { name: "secret-research" })).not.toBeNull();

    await user.selectOptions(screen.getByLabelText("Visibility"), "private");

    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
    expect(screen.getByRole("link", { name: "secret-research" })).not.toBeNull();
  });

  it("lists the organization members with their roles", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");
    await openOrganization(user);

    await user.click(await screen.findByRole("link", { name: "People" }));
    const members = await screen.findByRole("list", { name: "Members" });

    expect(within(members).getByText("org-owner")).not.toBeNull();
    expect(within(members).getByText("bob-reviewer")).not.toBeNull();
    const ownerRow = within(members).getByText("org-owner").closest("li");
    const memberRow = within(members).getByText("bob-reviewer").closest("li");
    expect(ownerRow?.textContent).toContain("Owner");
    expect(memberRow?.textContent).toContain("Member");
  });
});

describe("REQ-2-1-2 create an organization after authentication", () => {
  it("creates an organization from Your organizations and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Your organizations" }));
    expect(await screen.findByRole("heading", { name: "Your organizations" })).not.toBeNull();

    await user.click(await screen.findByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "mobile-guild");
    await user.type(screen.getByLabelText("Display name"), "Mobile Guild");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    const heading = await screen.findByRole("heading", { name: /mobile-guild/ });
    expect(heading.textContent).toContain("Mobile Guild");

    reload();
    expect(await screen.findByRole("heading", { name: /mobile-guild/ })).not.toBeNull();
  });

  it("rejects a duplicate identifier without opening the existing organization", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Your organizations" }));
    await user.click(await screen.findByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "acme-demo");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /acme-demo/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Create organization" })).not.toBeNull();
  });

  it("reports a malformed identifier and a whitespace-only display name together", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Your organizations" }));
    await user.click(await screen.findByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "-invalid-organization");
    await user.type(screen.getByLabelText("Display name"), "   ");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name format is invalid")).not.toBeNull();
    expect(screen.getByText("Display name is required")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create organization" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Your organizations" }));
    const organizations = await screen.findByRole("list", { name: "Your organizations" });
    expect(within(organizations).queryByText("invalid-organization")).toBeNull();
  });
});

describe("REQ-2-2-1 create an organization team", () => {
  it("creates a team from the Teams page and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");
    await openOrganization(user);

    await user.click(await screen.findByRole("link", { name: "Teams" }));
    await user.click(await screen.findByRole("link", { name: "New team" }));
    await user.type(await screen.findByLabelText("Team name"), "mobile-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByRole("heading", { name: "mobile-team" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "mobile-team" })).not.toBeNull();
  });

  it("rejects a malformed team name without creating a team", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");
    await openOrganization(user);

    await user.click(await screen.findByRole("link", { name: "Teams" }));
    await user.click(await screen.findByRole("link", { name: "New team" }));
    await user.type(await screen.findByLabelText("Team name"), "-invalid-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByText("Team name is invalid")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "-invalid-team" })).toBeNull();

    act(() => navigate("/orgs/acme-demo/teams"));
    await screen.findByRole("heading", { name: /Acme Demo/ });
    await screen.findByRole("link", { name: "New team" });
    expect(screen.queryByRole("link", { name: "-invalid-team" })).toBeNull();
  });
});

describe("REQ-2-2-2 manage organization team members and hierarchy", () => {
  it("adds and removes a team member, and the removal survives a reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "team-maintainer");
    await openOrganization(user);
    await openTeam(user, "acme-demo", "frontend-team");

    await user.click(await screen.findByRole("link", { name: "Members" }));
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(await screen.findByLabelText("Username"), "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("bob-reviewer")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove bob-reviewer" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Remove bob-reviewer" }));
    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
    expect(await screen.findByText("This team has no members yet.")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "frontend-team" });
    await user.click(await screen.findByRole("link", { name: "Members" }));
    expect(await screen.findByText("This team has no members yet.")).not.toBeNull();
    expect(screen.queryByText("bob-reviewer")).toBeNull();
  });

  it("rejects a cyclic parent team and keeps the saved parent after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "team-maintainer");
    await openOrganization(user);
    await openTeam(user, "acme-demo", "frontend-team");

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    const parent = await screen.findByLabelText("Parent team");
    await waitFor(() => expect((parent as HTMLSelectElement).disabled).toBe(false));
    await waitFor(() => expect(selectValue(parent)).toBe("platform-team"));

    await user.selectOptions(parent, "frontend-child");
    expect(selectValue(parent)).toBe("frontend-child");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).not.toBeNull();

    reload();
    const reloadedParent = await screen.findByLabelText("Parent team");
    await waitFor(() => expect(selectValue(reloadedParent)).toBe("platform-team"));
  });
});

describe("REQ-2-2-3 directly add an organization member", () => {
  it("adds a registered non-member with the Member role and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");
    await openOrganization(user);
    await user.click(await screen.findByRole("link", { name: "People" }));

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(await screen.findByLabelText("Username or email"), "new-member");
    await user.selectOptions(screen.getByLabelText("Role"), "Member");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const members = await screen.findByRole("list", { name: "Members" });
    const name = await within(members).findByText("new-member");
    expect(name.closest("li")?.textContent).toContain("Member");
    expect(screen.queryByText("Pending invitation")).toBeNull();

    reload();
    const reloaded = await screen.findByRole("list", { name: "Members" });
    expect(within(reloaded).getByText("new-member")).not.toBeNull();
  });

  it("rejects an existing member and reports an unknown account without duplicating", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");
    await openOrganization(user);
    await user.click(await screen.findByRole("link", { name: "People" }));

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    const field = await screen.findByLabelText("Username or email");
    await user.type(field, "existing-member");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account is already a member")).not.toBeNull();

    await user.clear(field);
    await user.type(field, "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account not found")).not.toBeNull();

    const members = await screen.findByRole("list", { name: "Members" });
    expect(within(members).getAllByText("existing-member")).toHaveLength(1);
  });

  it("lets the added member sign in and see the organization without private access", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");
    await openOrganization(user);
    await user.click(await screen.findByRole("link", { name: "People" }));
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(await screen.findByLabelText("Username or email"), "new-member");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    await screen.findByRole("list", { name: "Members" });

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", { name: "Confirm sign out" }),
    );
    await signInAs(user, "new-member");

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Your organizations" }));
    const organizations = await screen.findByRole("list", { name: "Your organizations" });
    expect(within(organizations).getByText("Acme Demo")).not.toBeNull();

    act(() => navigate("/repositories/acme-demo/secret-research"));
    expect(await screen.findByRole("heading", { name: "Access denied" })).not.toBeNull();
  });
});

describe("REQ-2-2-4 remove a member from an organization", () => {
  it("removes a member through the row menu and keeps it removed after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-owner");
    await openOrganization(user);
    await user.click(await screen.findByRole("link", { name: "People" }));

    const members = await screen.findByRole("list", { name: "Members" });
    expect(within(members).getByText("existing-member")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Member menu existing-member" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove from organization" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove from organization" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: "Members" })).queryByText("existing-member")).toBeNull(),
    );

    reload();
    const reloaded = await screen.findByRole("list", { name: "Members" });
    expect(within(reloaded).queryByText("existing-member")).toBeNull();
  });

  it("shows no member menu or removal item to a non-Owner", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "org-member");
    await openOrganization(user);
    await user.click(await screen.findByRole("link", { name: "People" }));

    const members = await screen.findByRole("list", { name: "Members" });
    expect(within(members).getByText("protected-member")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Member menu protected-member" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
  });
});
