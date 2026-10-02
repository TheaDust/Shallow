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

function organizationWith(
  grants: NonNullable<StubOrganization["repositories"]>[number]["grants"],
): StubOrganization {
  return {
    name: "acme-demo",
    displayName: "Acme Demo",
    members: [
      { username: "alice-dev", role: "owner" },
      { username: "bob-reviewer", role: "member" },
    ],
    teams: [{ name: "frontend-team" }, { name: "platform-team" }],
    repositories: [
      {
        name: "acme-docs",
        description: "Docs.",
        visibility: "private",
        grants,
      },
    ],
  };
}

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

/** Unmount and mount again against the same stub state, like a page reload. */
function reload() {
  cleanup();
  return render(<App />);
}

/** The repository Settings link leads to the Manage access page. */
async function openManageAccess(user: ReturnType<typeof userEvent.setup>) {
  window.location.hash = "#/repositories/acme-demo/acme-docs";
  const settings = await screen.findByRole("link", { name: "Settings" });
  expect(settings.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/settings");
  await user.click(settings);
  const manageAccess = await screen.findByRole("link", { name: "Manage access" });
  await user.click(manageAccess);
  await screen.findByRole("heading", { name: "Manage access" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-2-3 grant repository access to people and teams", () => {
  it("grants Write to a team, keeps one record and still shows it after a reload", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [organizationWith([])] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    await openManageAccess(user);

    expect(await screen.findByText("No access granted yet.")).toBeTruthy();
    const openPicker = screen.getByRole("button", { name: "Add people or teams" });
    await user.click(openPicker);

    // The opening button leaves the active view while the picker is open, so
    // the picker's own Role control and Add button are the only submit path.
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    const search = screen.getByRole("textbox", { name: "Search" });
    expect(search.getAttribute("type")).toBe("text");
    await user.type(search, "frontend");
    const option = await screen.findByRole("option", { name: /frontend-team/ });
    await user.click(option);
    expect(option.getAttribute("aria-selected")).toBe("true");

    await user.selectOptions(screen.getByLabelText("Role"), "write");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const row = await screen.findByRole("row", { name: "frontend-team" });
    expect(within(row).getByText("frontend-team")).toBeTruthy();
    const roleSelect = within(row).getByLabelText("Role") as HTMLSelectElement;
    expect(roleSelect.value).toBe("write");
    expect(within(row).getByRole("button", { name: "Save" })).toBeTruthy();
    // The picker closed, the opening button is back and the saved grant is
    // visible in the list.
    expect(screen.getByRole("button", { name: "Add people or teams" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();

    reload();
    const reloadedRow = await screen.findByRole("row", { name: "frontend-team" });
    expect((within(reloadedRow).getByLabelText("Role") as HTMLSelectElement).value).toBe("write");
    expect(screen.getAllByRole("row", { name: "frontend-team" })).toHaveLength(1);

    // Saving the same role again never creates a second authorization record.
    await user.click(within(reloadedRow).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getAllByRole("row", { name: "frontend-team" })).toHaveLength(1),
    );
  });

  it("replaces a stored Write grant with Read and keeps exactly one row", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER],
      organizations: [organizationWith([{ subjectType: "team", subjectName: "frontend-team", role: "write" }])],
    });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    await openManageAccess(user);

    const row = await screen.findByRole("row", { name: "frontend-team" });
    const roleSelect = within(row).getByLabelText("Role") as HTMLSelectElement;
    expect(roleSelect.value).toBe("write");

    await user.selectOptions(roleSelect, "read");
    await user.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        (within(screen.getByRole("row", { name: "frontend-team" })).getByLabelText(
          "Role",
        ) as HTMLSelectElement).value,
      ).toBe("read"),
    );

    reload();
    const reloadedRow = await screen.findByRole("row", { name: "frontend-team" });
    expect((within(reloadedRow).getByLabelText("Role") as HTMLSelectElement).value).toBe("read");
    expect(screen.getAllByRole("row", { name: "frontend-team" })).toHaveLength(1);
  });

  it("matches member and team options while the administrator types", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [organizationWith([])] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    await openManageAccess(user);

    await user.click(screen.getByRole("button", { name: "Add people or teams" }));
    await user.type(screen.getByRole("textbox", { name: "Search" }), "bob");
    expect(await screen.findByRole("option", { name: /bob-reviewer/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /frontend-team/ })).toBeNull();

    await user.clear(screen.getByRole("textbox", { name: "Search" }));
    await user.type(screen.getByRole("textbox", { name: "Search" }), "frontend-team");
    expect(await screen.findByRole("option", { name: /frontend-team/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /bob-reviewer/ })).toBeNull();
  });

  it("refuses access management for a plain organization member", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [organizationWith([])] });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);

    window.location.hash = "#/repositories/acme-demo/acme-docs/settings/access";
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("never lets a visitor reach the Manage access list of a private repository", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [organizationWith([])] });
    renderApp("#/repositories/acme-demo/acme-docs/settings/access");
    expect(await screen.findByText("Access denied")).toBeTruthy();
  });
});
