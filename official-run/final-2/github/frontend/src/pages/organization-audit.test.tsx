import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

const EVOLUTION_PASSWORD = "Evo-Password-987!";

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password = EVOLUTION_PASSWORD,
) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Account menu → Your organizations → the named organization entry. */
async function openYourOrganizations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Your organizations" }));
  await screen.findByRole("heading", { name: "Your organizations" });
}

async function openOrganization(
  user: ReturnType<typeof userEvent.setup>,
  organizationName: string,
) {
  await openYourOrganizations(user);
  await user.click(await screen.findByRole("link", { name: organizationName }));
  await screen.findByRole("link", { name: "Repositories" });
}

function auditRows(): HTMLElement[] {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1);
}

/** The native select behind the hybrid combobox (the listbox is a sibling). */
function filterControl(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Filter action" }) as HTMLSelectElement;
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

describe("REQ-2-1-2 create an organization with a normalized identifier", () => {
  it("normalizes an uppercase identifier, opens the overview and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-org-owner");

    await openYourOrganizations(user);
    await user.click(await screen.findByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "Evo-Lab-01");
    await user.type(screen.getByLabelText("Display name"), "Evo Lab One");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    const heading = await screen.findByRole("heading", { name: /evo-lab-01/ });
    expect(heading.textContent).toContain("Evo Lab One");

    reload();
    expect(await screen.findByRole("heading", { name: /evo-lab-01/ })).not.toBeNull();
  });

  it("reports the seeded identifier as a duplicate however it is cased", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-org-owner");

    await openYourOrganizations(user);
    await user.click(await screen.findByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "EVO-LAB-02");
    await user.type(screen.getByLabelText("Display name"), "Evo Lab Duplicate");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /evo-lab-02/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Create organization" })).not.toBeNull();
  });

  it("reports a malformed identifier and a whitespace-only display name together", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-org-owner");

    await openYourOrganizations(user);
    await user.click(await screen.findByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "-invalid-organization");
    await user.type(screen.getByLabelText("Display name"), "   ");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name format is invalid")).not.toBeNull();
    expect(screen.getByText("Display name is required")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create organization" })).not.toBeNull();
  });
});

describe("REQ-2-4 view organization audit log", () => {
  it("shows the persisted events in a named table to an Owner", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-owner");
    await openOrganization(user, "Evo Audit Org");

    await user.click(await screen.findByRole("link", { name: "Audit log" }));

    expect(await screen.findByRole("heading", { name: "Audit log" })).not.toBeNull();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Actor" })).not.toBeNull();
    expect(within(table).getByRole("columnheader", { name: "Action" })).not.toBeNull();
    expect(within(table).getByRole("columnheader", { name: "Target" })).not.toBeNull();
    expect(within(table).getByRole("columnheader", { name: "Timestamp" })).not.toBeNull();
    expect(auditRows()).toHaveLength(2);
    expect(within(table).getByText("Member added")).not.toBeNull();
    expect(within(table).getByText("Repository created")).not.toBeNull();
  });

  it("narrows the list by the selected action and keeps it after a reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-owner");
    await openOrganization(user, "Evo Audit Org");
    await user.click(await screen.findByRole("link", { name: "Audit log" }));
    await screen.findByRole("heading", { name: "Audit log" });

    await user.selectOptions(filterControl(), "Member added");

    await waitFor(() => expect(auditRows()).toHaveLength(1));
    expect(within(screen.getByRole("table")).getByText("Member added")).not.toBeNull();
    expect(window.location.hash).toContain("action=Member+added");

    reload();
    expect(await screen.findByRole("heading", { name: "Audit log" })).not.toBeNull();
    await waitFor(() => expect(auditRows()).toHaveLength(1));
    expect(filterControl().value).toBe("Member added");

    // Clearing the filter restores the other seeded event.
    await user.selectOptions(filterControl(), "");
    await waitFor(() => expect(auditRows()).toHaveLength(2));
    expect(within(screen.getByRole("table")).getByText("Repository created")).not.toBeNull();
  });

  it("narrows the list from the visible options of the combobox", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-owner");
    await openOrganization(user, "Evo Audit Org");
    await user.click(await screen.findByRole("link", { name: "Audit log" }));
    await screen.findByRole("heading", { name: "Audit log" });
    expect(auditRows()).toHaveLength(2);

    // The one expanded control exposes its own visible options only.
    await user.click(filterControl());
    await user.click(await screen.findByRole("option", { name: "Member added" }));

    await waitFor(() => expect(auditRows()).toHaveLength(1));
    expect(filterControl().value).toBe("Member added");
    expect(window.location.hash).toContain("action=Member+added");
  });

  it("does not expose an actionable audit-log entry to an ordinary Member", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-viewer");
    await openOrganization(user, "Evo Audit Org");

    expect(screen.queryByRole("link", { name: "Audit log" })).toBeNull();
    // The organization itself stays readable to the Member.
    expect(await screen.findByRole("heading", { name: /evo-audit-org/ })).not.toBeNull();
  });
});
