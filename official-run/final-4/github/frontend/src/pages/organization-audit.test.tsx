import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

const EVO_PASSWORD = "Evo-Password-987!";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password = EVO_PASSWORD,
) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function openYourOrganizations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Your organizations" }));
  await screen.findByRole("heading", { name: "Your organizations" });
}

async function openOrganization(
  user: ReturnType<typeof userEvent.setup>,
  organizationId: string,
) {
  await openYourOrganizations(user);
  await user.click(await screen.findByRole("link", { name: organizationId }));
  await screen.findByRole("link", { name: "Repositories" });
}

async function openAuditLog(user: ReturnType<typeof userEvent.setup>, organizationId: string) {
  await openOrganization(user, organizationId);
  await user.click(await screen.findByRole("link", { name: "Audit log" }));
  await screen.findByRole("heading", { name: "Audit log" });
}

function auditRows(): HTMLElement[] {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1);
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

describe("REQ-2-4 view the organization audit log", () => {
  it("opens the audit log from the organization overview and lists the events", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-owner");
    await openAuditLog(user, "evo-audit-org");

    const table = screen.getByRole("table");
    for (const header of ["Actor", "Action", "Target", "Timestamp"]) {
      expect(within(table).getByRole("columnheader", { name: header })).not.toBeNull();
    }

    const rows = auditRows();
    expect(rows.length).toBe(3);
    const memberRow = rows.find((row) => within(row).queryByText("Member added") !== null);
    expect(memberRow).toBeDefined();
    expect(within(memberRow!).getByText("evo-audit-owner")).not.toBeNull();
    expect(within(memberRow!).getByText("evo-audit-viewer")).not.toBeNull();

    const repositoryRow = rows.find((row) => within(row).queryByText("Repository created") !== null);
    expect(repositoryRow).toBeDefined();
    expect(within(repositoryRow!).getByText("evo-audit-repo")).not.toBeNull();
  });

  it("filters the table by action, keeps the filter after reload and restores every event", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-owner");
    await openAuditLog(user, "evo-audit-org");

    // The native select path: choosing an option fires the change event. The
    // mixed Combobox also opens its visible options on a click, so the page is
    // left with the listbox closed before the table is read.
    await user.selectOptions(screen.getByLabelText("Filter action"), "Member added");
    await user.click(screen.getByRole("heading", { name: "Audit log" }));
    expect(screen.queryByRole("option")).toBeNull();

    await waitFor(() => expect(auditRows().length).toBe(1));
    expect(within(auditRows()[0]).getByText("Member added")).not.toBeNull();
    expect(within(screen.getByRole("table")).queryByText("Repository created")).toBeNull();
    expect(window.location.hash).toContain("action=Member+added");

    // The reload restores both the persisted list and the selected filter.
    reload();
    await screen.findByRole("heading", { name: "Audit log" });
    await waitFor(() => expect(auditRows().length).toBe(1));
    expect((screen.getByLabelText("Filter action") as HTMLSelectElement).value).toBe("Member added");
    expect(within(auditRows()[0]).getByText("Member added")).not.toBeNull();
    expect(within(screen.getByRole("table")).queryByText("Repository created")).toBeNull();

    // The visible-option path of the mixed Combobox clears the filter.
    const combobox = screen.getByLabelText("Filter action");
    await user.click(combobox);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "All actions",
      "Organization created",
      "Member added",
      "Repository created",
    ]);
    await user.click(screen.getByRole("option", { name: "All actions" }));

    await waitFor(() => expect(auditRows().length).toBe(3));
    expect((screen.getByLabelText("Filter action") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("option")).toBeNull();
    expect(window.location.hash).toBe("#/orgs/evo-audit-org/audit-log");

    const repositoryRow = auditRows().find(
      (row) => within(row).queryByText("Repository created") !== null,
    );
    expect(repositoryRow).toBeDefined();
  });

  it("never exposes the audit-log entry to an ordinary organization Member", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-viewer");
    await openOrganization(user, "evo-audit-org");

    expect(await screen.findByRole("heading", { name: "evo-audit-org" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "People" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Audit log" })).toBeNull();

    // Opening the audit-log address directly is refused by the server.
    await act(async () => {
      navigate("/orgs/evo-audit-org/audit-log");
    });
    expect(await screen.findByText("Access denied")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("REQ-2-1-2 create an organization with an uppercase identifier", () => {
  it("normalizes the identifier and keeps the created organization after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-org-owner");
    await openYourOrganizations(user);

    await user.click(await screen.findByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "Evo-Lab-01");
    await user.type(screen.getByLabelText("Display name"), "  Evo Lab One  ");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    const heading = await screen.findByRole("heading", { name: /evo-lab-01/ });
    expect(heading.textContent).toContain("Evo Lab One");
    expect(window.location.hash).toBe("#/orgs/evo-lab-01");

    reload();
    expect(await screen.findByRole("heading", { name: /evo-lab-01/ })).not.toBeNull();
  });

  it("reports the existing identifier for a submission that only differs in case", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-org-owner");
    await openYourOrganizations(user);

    await user.click(await screen.findByRole("link", { name: "New organization" }));
    await user.type(await screen.findByLabelText("Organization name"), "EVO-LAB-02");
    await user.type(screen.getByLabelText("Display name"), "Evo Lab Duplicate");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /evo-lab-02/ })).toBeNull();
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

    await openYourOrganizations(user);
    const organizations = await screen.findByRole("list", { name: "Your organizations" });
    expect(within(organizations).queryByText("invalid-organization")).toBeNull();
  });
});
