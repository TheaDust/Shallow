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

const OUTSIDER = {
  username: "carol-newcomer",
  email: "carol.newcomer@example.test",
  password: "Valid-password-123!",
};

const ORGANIZATION: StubOrganization = {
  name: "acme-demo",
  displayName: "Acme Demo",
  members: [
    { username: "alice-dev", role: "owner" },
    { username: "bob-reviewer", role: "member" },
  ],
  teams: [{ name: "frontend-team" }],
  repositories: [
    { name: "acme-docs", description: "Docs.", visibility: "public" },
    { name: "secret-research", description: "Private.", visibility: "private" },
  ],
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

describe("REQ-2-2-3 directly add a user as an organization member", () => {
  it("adds an existing account straight into the People list", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER, OUTSIDER],
      organizations: [ORGANIZATION],
    });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);

    window.location.hash = "#/organizations/acme-demo?tab=people";
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Add member" }));
    const identifier = await screen.findByLabelText("Username or email");
    const role = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(role.value).toBe("Member");
    expect(
      Array.from(role.options).map((option) => option.textContent),
    ).toEqual(["Member", "Owner"]);

    await user.type(identifier, "carol.newcomer@example.test");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const row = await screen.findByRole("row", { name: /carol-newcomer/ });
    expect(within(row).getByText("Member")).toBeTruthy();
    expect(within(row).queryByText(/Pending|Awaiting/)).toBeNull();
  });

  it("keeps the form open when the account is already a member and then accepts a correction", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER, OUTSIDER],
      organizations: [ORGANIZATION],
    });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);

    window.location.hash = "#/organizations/acme-demo?tab=people";
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const identifier = await screen.findByLabelText("Username or email");
    await user.type(identifier, "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account is already a member")).toBeTruthy();
    expect((screen.getByLabelText("Username or email") as HTMLInputElement).value).toBe(
      "bob-reviewer",
    );
    expect(screen.getAllByRole("row", { name: /bob-reviewer/ })).toHaveLength(1);

    await user.clear(screen.getByLabelText("Username or email"));
    await user.type(screen.getByLabelText("Username or email"), "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account not found")).toBeTruthy();

    await user.clear(screen.getByLabelText("Username or email"));
    await user.type(screen.getByLabelText("Username or email"), "carol-newcomer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByRole("row", { name: /carol-newcomer/ })).toBeTruthy();
  });

  it("hides the add member control from a plain member", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER, OUTSIDER],
      organizations: [ORGANIZATION],
    });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);

    window.location.hash = "#/organizations/acme-demo?tab=people";
    expect(await screen.findByRole("row", { name: /alice-dev/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });
});

describe("REQ-2-2-4 remove a member from an organization", () => {
  it("removes the member through the action menu and keeps it removed after reload", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER, OUTSIDER],
      organizations: [ORGANIZATION],
    });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);

    window.location.hash = "#/organizations/acme-demo?tab=people";
    const row = await screen.findByRole("row", { name: /bob-reviewer/ });

    await user.click(within(row).getByRole("button", { name: "Member menu bob-reviewer" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from organization" }));

    const dialog = await screen.findByRole("dialog", { name: "Remove member" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(screen.queryByRole("row", { name: /bob-reviewer/ })).toBeNull(),
    );

    // Reopening the page reads the persisted membership list again.
    window.location.hash = "#/organizations/acme-demo?tab=repositories";
    await screen.findByRole("link", { name: "acme-docs" });
    window.location.hash = "#/organizations/acme-demo?tab=people";
    await screen.findByRole("row", { name: /alice-dev/ });
    expect(screen.queryByRole("row", { name: /bob-reviewer/ })).toBeNull();
  });

  it("offers no member menu at all to a non-Owner", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER, OUTSIDER],
      organizations: [ORGANIZATION],
    });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);

    window.location.hash = "#/organizations/acme-demo?tab=people";
    expect(await screen.findByRole("row", { name: /alice-dev/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Member menu / })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();

    window.location.hash = "#/organizations/acme-demo?tab=repositories";
    await screen.findByRole("link", { name: "acme-docs" });
    window.location.hash = "#/organizations/acme-demo?tab=people";
    expect(await screen.findByRole("row", { name: /bob-reviewer/ })).toBeTruthy();
  });

  it("refuses to remove the last Owner and keeps the relationship", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER, OUTSIDER],
      organizations: [ORGANIZATION],
    });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);

    window.location.hash = "#/organizations/acme-demo?tab=people";
    const row = await screen.findByRole("row", { name: /alice-dev/ });
    await user.click(within(row).getByRole("button", { name: "Member menu alice-dev" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from organization" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove member" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(
      await screen.findByText("Organization must have at least one Owner"),
    ).toBeTruthy();
    expect(screen.getByRole("row", { name: /alice-dev/ })).toBeTruthy();
  });
});
