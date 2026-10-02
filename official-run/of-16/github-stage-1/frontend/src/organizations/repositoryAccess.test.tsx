import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import {
  createFakeApi,
  type FakeAccessGrant,
  type FakeAccount,
  type FakeOrganization,
} from "../test-utils/fake-api";

const REPO_ADMIN: FakeAccount = {
  username: "repo-admin",
  email: "repo-admin@example.test",
  password: "Valid-password-123!",
};

const ORG_OWNER: FakeAccount = {
  username: "org-owner",
  email: "org-owner@example.test",
  password: "Valid-password-123!",
};

const ORG_MEMBER: FakeAccount = {
  username: "bob-reviewer",
  email: "bob-reviewer@example.test",
  password: "Valid-password-123!",
};

/**
 * Mirrors the seeded state: `acme-docs` with repo-admin holding Admin and
 * `access-role-team` holding exactly one direct Write grant. `frontend-team`
 * deliberately starts without a grant.
 */
const ACME_DEMO: FakeOrganization = {
  slug: "acme-demo",
  name: "Acme Demo",
  displayName: "Acme Demo",
  owners: ["org-owner"],
  members: ["bob-reviewer"],
  teams: [
    { name: "platform-team" },
    { name: "frontend-team", parent: "platform-team" },
    { name: "access-role-team" },
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

const SEED_GRANTS: FakeAccessGrant[] = [
  { id: "grant-admin", repositoryName: "acme-docs", username: "repo-admin", role: "admin" },
  { id: "grant-write", repositoryName: "acme-docs", teamName: "access-role-team", role: "write" },
];

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

function installAs(username: string) {
  const api = createFakeApi({
    accounts: [REPO_ADMIN, ORG_OWNER, ORG_MEMBER],
    organizations: [ACME_DEMO],
    grants: SEED_GRANTS,
  });
  api.install();
  api.signInAs(username);
  return api;
}

async function openRepository(username: string) {
  installAs(username);
  goto("#/organizations/acme-demo/repositories/acme-docs");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("link", { name: "Account menu" });
  return user;
}

async function openManageAccess(username: string) {
  const user = await openRepository(username);
  await user.click(await screen.findByRole("link", { name: "Settings" }));
  await waitFor(() => {
    expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs/settings");
  });
  await user.click(await screen.findByRole("link", { name: "Manage access" }));
  await waitFor(() => {
    expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs/settings/manage-access");
  });
  return user;
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name, { selector: ".access-table__name" });
  const row = cell.closest("tr");
  if (!row) throw new Error(`no access row for ${name}`);
  return row;
}

function roleValueOf(row: HTMLElement): string {
  return (within(row).getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("REQ-2-3 grant repository access to people and teams", () => {
  it("scenario 1: adding frontend-team with Write shows the name and role and survives a reload", async () => {
    const api = installAs("repo-admin");
    const user = userEvent.setup();
    goto("#/organizations/acme-demo/repositories/acme-docs");
    render(<App />);
    await screen.findByRole("link", { name: "Account menu" });

    // A repository Admin reaches Settings and Manage access.
    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("link", { name: "Manage access" }));

    // There is no frontend-team grant yet.
    expect(screen.queryByText("frontend-team")).toBeNull();

    await user.click(await screen.findByRole("button", { name: "Add people or teams" }));
    const picker = await screen.findByRole("dialog");
    await user.type(within(picker).getByLabelText("Search"), "frontend-team");
    await user.click(within(picker).getByRole("option", { name: "frontend-team" }));
    await user.selectOptions(within(picker).getByLabelText("Role"), "Write");
    await user.click(within(picker).getByRole("button", { name: "Add" }));

    const addedRow = await waitFor(() => rowFor("frontend-team"));
    // The "Role" combobox exposes the exact requirement wording "Write".
    expect(roleValueOf(addedRow)).toBe("Write");
    expect(within(addedRow).getByText("Write")).toBeTruthy();
    expect(api.grants.filter((grant) => grant.teamName === "frontend-team")).toHaveLength(1);

    // Reloading the Manage access page reads the stored grant back.
    cleanup();
    render(<App />);
    const reloadedRow = await waitFor(() => rowFor("frontend-team"));
    expect(roleValueOf(reloadedRow)).toBe("Write");
  });

  it("scenario 2: saving Read updates the single existing Write row for access-role-team", async () => {
    const user = await openManageAccess("repo-admin");
    void user;

    const initialRow = await waitFor(() => rowFor("access-role-team"));
    expect(roleValueOf(initialRow)).toBe("Write");

    await user.selectOptions(within(initialRow).getByRole("combobox", { name: "Role" }), "Read");
    await user.click(within(initialRow).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(roleValueOf(rowFor("access-role-team"))).toBe("Read");
    });

    // Reloading keeps exactly one row for access-role-team with the Read role.
    cleanup();
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByText("access-role-team", { selector: ".access-table__name" })).toHaveLength(1);
    });
    const reloadedRow = rowFor("access-role-team");
    expect(roleValueOf(reloadedRow)).toBe("Read");
  });

  it("hides repository Settings from an account that holds neither Owner nor Admin", async () => {
    await openRepository("bob-reviewer");
    expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
