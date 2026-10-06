import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

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
  displayName: string,
) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Your organizations" }));
  await user.click(await screen.findByRole("link", { name: displayName }));
  await screen.findByRole("link", { name: "Repositories" });
}

function dataRows(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "");
}

/** Signs in as the audited organization's Owner and opens its audit log. */
async function openAuditLog(user: ReturnType<typeof userEvent.setup>) {
  await signInAs(user, "evo-audit-owner", "Evo-Password-987!");
  await openOrganization(user, "Evo Audit Org");
  await user.click(await screen.findByRole("link", { name: "Audit log" }));
  await screen.findByRole("heading", { name: "Audit log" });
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

describe("REQ-2-4 view organization audit log", () => {
  it("opens the audit log from the organization overview and lists the seeded actions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openAuditLog(user);

    expect(window.location.hash).toBe("#/orgs/evo-audit-org/audit-log");

    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Actor", "Action", "Target", "Timestamp"]);

    const rows = dataRows();
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.includes("evo-audit-owner") && row.includes("Member added") && row.includes("evo-audit-viewer"))).toBe(true);
    expect(rows.some((row) => row.includes("Repository created"))).toBe(true);
    // Every row carries its time.
    expect(rows.every((row) => /\d{4}-\d{2}-\d{2}/.test(row))).toBe(true);
  });

  it("narrows the list with Filter action and keeps the selection after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openAuditLog(user);

    await user.selectOptions(screen.getByLabelText("Filter action"), "Member added");

    const filtered = dataRows();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toContain("Member added");
    expect(filtered.some((row) => row.includes("Repository created"))).toBe(false);

    reload();
    await screen.findByRole("heading", { name: "Audit log" });
    expect((screen.getByLabelText("Filter action") as HTMLSelectElement).value).toBe("Member added");
    expect(dataRows()).toHaveLength(1);
    expect(dataRows()[0]).toContain("Member added");

    // Clearing the filter restores every seeded event.
    await user.selectOptions(screen.getByLabelText("Filter action"), "");
    const restored = dataRows();
    expect(restored).toHaveLength(3);
    expect(restored.some((row) => row.includes("Repository created"))).toBe(true);
  });

  it("does not expose the audit log to an ordinary Member", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-viewer", "Evo-Password-987!");
    await openOrganization(user, "Evo Audit Org");

    expect(screen.queryByRole("link", { name: "Audit log" })).toBeNull();

    act(() => navigate("/orgs/evo-audit-org/audit-log"));
    expect(await screen.findByRole("heading", { name: "Access denied" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Audit log" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("records a new organization action in the log", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-owner", "Evo-Password-987!");
    await openOrganization(user, "Evo Audit Org");

    await user.click(await screen.findByRole("link", { name: "People" }));
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(await screen.findByLabelText("Username or email"), "new-member");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    await screen.findByRole("list", { name: "Members" });

    await user.click(await screen.findByRole("link", { name: "Repositories" }));
    await user.click(await screen.findByRole("link", { name: "Audit log" }));
    await screen.findByRole("heading", { name: "Audit log" });

    expect(dataRows().some((row) => row.includes("Member added") && row.includes("new-member"))).toBe(true);
  });
});
