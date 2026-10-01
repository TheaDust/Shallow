import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";

const CREATOR = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

const SEED_ORGANIZATION: StubOrganization = {
  name: "acme-demo",
  displayName: "Acme Demo",
  members: [{ username: "alice-dev", role: "owner" }],
  teams: [{ name: "frontend-team" }],
  repositories: [
    { name: "acme-docs", description: "Documentation.", visibility: "public" },
  ],
};

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  renderApp("#/login");
  await user.type(await screen.findByLabelText("Username or email"), CREATOR.username);
  await user.type(screen.getByLabelText("Password"), CREATOR.password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

async function openNewOrganization(user: ReturnType<typeof userEvent.setup>) {
  await signIn(user);
  window.location.hash = "#/organizations";
  await user.click(await screen.findByRole("link", { name: "New organization" }));
  await screen.findByRole("heading", { name: "New organization" });
}

function valueOf(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-2-1-2 create an organization after authentication", () => {
  it("offers the account-menu entry and creates a scoped organization", async () => {
    installAuthStub({ accounts: [CREATOR], organizations: [SEED_ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user);

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    const entry = screen.getByRole("link", { name: "Your organizations" });
    expect(entry.getAttribute("href")).toBe("#/organizations");
    await user.click(entry);

    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "acme-demo" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "mobile-guild");
    await user.type(screen.getByLabelText("Display name"), "Mobile Guild");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByRole("heading", { name: "mobile-guild" })).toBeTruthy();
    expect(screen.getByText("Your role: Owner")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "People" }));
    const people = await screen.findByRole("table");
    expect(people.textContent).toContain("alice-dev");
    expect(people.textContent).toContain("Owner");

    window.location.hash = "#/organizations";
    expect(await screen.findByRole("link", { name: "mobile-guild" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "acme-demo" })).toBeTruthy();
  });

  it("reports a duplicate identifier before the missing display name", async () => {
    installAuthStub({ accounts: [CREATOR], organizations: [SEED_ORGANIZATION] });
    const user = userEvent.setup();
    await openNewOrganization(user);

    await user.type(screen.getByLabelText("Organization name"), "acme-demo");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).toBeTruthy();
    expect(screen.queryByText("Display name is required")).toBeNull();
    expect(screen.getByRole("heading", { name: "New organization" })).toBeTruthy();
    expect(valueOf("Organization name")).toBe("acme-demo");
  });

  it("rejects a malformed identifier and a whitespace-only display name", async () => {
    installAuthStub({ accounts: [CREATOR], organizations: [SEED_ORGANIZATION] });
    const user = userEvent.setup();
    await openNewOrganization(user);

    await user.type(screen.getByLabelText("Organization name"), "-invalid-organization");
    await user.type(screen.getByLabelText("Display name"), "Invalid Organization");
    await user.click(screen.getByRole("button", { name: "Create organization" }));
    expect(await screen.findByText("Organization name format is invalid")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New organization" })).toBeTruthy();

    await user.clear(screen.getByLabelText("Organization name"));
    await user.type(screen.getByLabelText("Organization name"), "mobile-guild");
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "   ");
    await user.click(screen.getByRole("button", { name: "Create organization" }));
    expect(await screen.findByText("Display name is required")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "mobile-guild" })).toBeNull();

    window.location.hash = "#/organizations";
    expect(await screen.findByRole("link", { name: "acme-demo" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "mobile-guild" })).toBeNull();
  });

  it("keeps the organization list behind a session", async () => {
    installAuthStub({ accounts: [CREATOR], organizations: [SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/organizations");

    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New organization" })).toBeNull();

    window.location.hash = "#/organizations/new";
    expect(await screen.findByRole("heading", { name: "New organization" })).toBeTruthy();
    expect(screen.queryByLabelText("Organization name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create organization" })).toBeNull();
  });
});
