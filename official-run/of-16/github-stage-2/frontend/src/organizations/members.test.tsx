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

const NEW_MEMBER: FakeAccount = {
  username: "new-member",
  email: "new-member@example.test",
  password: "Valid-password-123!",
};

const EXISTING_MEMBER: FakeAccount = {
  username: "existing-member",
  email: "existing-member@example.test",
  password: "Valid-password-123!",
};

const ORG_MEMBER: FakeAccount = {
  username: "org-member",
  email: "org-member@example.test",
  password: "Valid-password-123!",
};

const PROTECTED_MEMBER: FakeAccount = {
  username: "protected-member",
  email: "protected-member@example.test",
  password: "Valid-password-123!",
};

const ALL_ACCOUNTS = [ORG_OWNER, NEW_MEMBER, EXISTING_MEMBER, ORG_MEMBER, PROTECTED_MEMBER];

/** Mirrors the seeded organization: one Owner, three members and two repositories. */
const ACME_DEMO: FakeOrganization = {
  slug: "acme-demo",
  name: "Acme Demo",
  displayName: "Acme Demo",
  owners: ["org-owner"],
  members: ["existing-member", "org-member", "protected-member"],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation, guides and release notes for Acme Demo.",
      visibility: "public",
      updatedAt: "2024-05-02T09:30:00.000Z",
    },
    {
      name: "secret-research",
      description: "Confidential research notes, visible to authorized members only.",
      visibility: "private",
      updatedAt: "2024-05-03T11:15:00.000Z",
    },
  ],
};

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function renderAsAccount(api: ReturnType<typeof createFakeApi>, username: string, hash: string) {
  api.signInAs(username);
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("link", { name: "Account menu" });
  return user;
}

/** Signs in and opens the organization People page through the account menu. */
async function openPeople(api: ReturnType<typeof createFakeApi>, username: string) {
  const user = await renderAsAccount(api, username, "#/");
  await user.click(screen.getByRole("link", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Your organizations" }));
  await waitFor(() => expect(window.location.hash).toBe("#/organizations"));
  await user.click(await screen.findByRole("link", { name: "Acme Demo" }));
  await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo"));
  await user.click(await screen.findByRole("link", { name: "People" }));
  await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/people"));
  return user;
}

function install() {
  const api = createFakeApi({ accounts: ALL_ACCOUNTS, organizations: [ACME_DEMO] });
  return api.install();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("REQ-2-2-3 directly add a user as an organization member", () => {
  it("scenario 1: an Owner adds new-member, it persists and the member still has no private access", async () => {
    const api = install();
    const user = await openPeople(api, "org-owner");

    const list = await screen.findByRole("list", { name: "Organization members" });
    expect(within(list).queryByText("new-member")).toBeNull();

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(await screen.findByLabelText("Username or email"), "new-member");
    await user.selectOptions(screen.getByLabelText("Role"), "member");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const added = await screen.findByRole("list", { name: "Organization members" });
    const row = within(added).getByText("new-member").closest("li");
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText("Member")).toBeTruthy();
    expect(screen.queryByText("Pending invitation")).toBeNull();

    // Reloading the People page keeps the stored membership.
    cleanup();
    render(<App />);
    const reloaded = await screen.findByRole("list", { name: "Organization members" });
    expect(within(reloaded).getByText("new-member")).toBeTruthy();

    // In a separate session the member sees the organization but not the private repository.
    api.signInAs("new-member");
    goto("#/organizations");
    const organizations = await screen.findByRole("heading", { name: "Your organizations" });
    expect(organizations).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Acme Demo" })).toBeTruthy();

    goto("#/organizations/acme-demo/repositories/secret-research");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  });

  it("scenario 2: a duplicate member and an unknown username report the exact messages", async () => {
    const api = install();
    const user = await openPeople(api, "org-owner");

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(await screen.findByLabelText("Username or email"), "existing-member");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account is already a member")).toBeTruthy();

    await user.clear(screen.getByLabelText("Username or email"));
    await user.type(screen.getByLabelText("Username or email"), "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account not found")).toBeTruthy();

    const list = await screen.findByRole("list", { name: "Organization members" });
    expect(within(list).getAllByText("existing-member")).toHaveLength(1);
    expect(api.organizations[0].members).toEqual(["existing-member", "org-member", "protected-member"]);
  });
});

describe("REQ-2-2-4 remove a member from an organization", () => {
  it("scenario 1: an Owner removes existing-member through its menu and the removal survives a reload", async () => {
    const api = install();
    const user = await openPeople(api, "org-owner");

    const list = await screen.findByRole("list", { name: "Organization members" });
    expect(within(list).getByText("existing-member")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Member menu existing-member" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from organization" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      const current = screen.getByRole("list", { name: "Organization members" });
      expect(within(current).queryByText("existing-member")).toBeNull();
    });

    cleanup();
    render(<App />);
    const reloaded = await screen.findByRole("list", { name: "Organization members" });
    expect(within(reloaded).queryByText("existing-member")).toBeNull();
  });

  it("scenario 2: a non-Owner sees the member but no member menu and no removal entry", async () => {
    const api = install();
    await openPeople(api, "org-member");

    const list = await screen.findByRole("list", { name: "Organization members" });
    expect(within(list).getByText("protected-member")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Member menu protected-member" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
  });
});
