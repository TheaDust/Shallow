import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

const EVOLUTION_PASSWORD = "Evo-Password-987!";

function reload() {
  cleanup();
  render(<App />);
}

function filterControl(): HTMLSelectElement {
  // The scaffold Combobox keeps the native select as the real control and
  // exposes a visible option list while it is activated, so the control is
  // addressed by its role.
  return screen.getByRole("combobox", { name: "Filter action" }) as HTMLSelectElement;
}

function filterValue(): string {
  return filterControl().value;
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

/** Account menu → Your organizations → the organization overview (REQ-2-1-1). */
async function openOrganization(
  user: ReturnType<typeof userEvent.setup>,
  organizationName: string,
) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Your organizations" }));
  await user.click(await screen.findByRole("link", { name: organizationName }));
  await screen.findByRole("link", { name: "Repositories" });
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
  it("opens the audit log from the organization overview and lists actor, action, target and timestamp", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-owner", EVOLUTION_PASSWORD);
    await openOrganization(user, "evo-audit-org");

    const entry = await screen.findByRole("link", { name: "Audit log" });
    expect(entry.getAttribute("href")).toBe("#/orgs/evo-audit-org/audit-log");
    await user.click(entry);

    expect(await screen.findByRole("heading", { name: "Audit log" })).not.toBeNull();
    const table = await screen.findByRole("table");
    for (const column of ["Actor", "Action", "Target", "Timestamp"]) {
      expect(within(table).getByRole("columnheader", { name: column })).not.toBeNull();
    }

    const memberAdded = within(table).getByText("Member added").closest("tr");
    expect(memberAdded?.textContent).toContain("evo-audit-owner");
    expect(memberAdded?.textContent).toContain("evo-audit-viewer");
    expect(memberAdded?.textContent).toMatch(/\d{4}-\d{2}-\d{2}/);

    const repositoryCreated = within(table).getByText("Repository created").closest("tr");
    expect(repositoryCreated?.textContent).toContain("audit-demo");
  });

  it("keeps the selected action filter across a reload and restores every event when cleared", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-owner", EVOLUTION_PASSWORD);
    await openOrganization(user, "evo-audit-org");
    await user.click(await screen.findByRole("link", { name: "Audit log" }));
    await screen.findByRole("heading", { name: "Audit log" });

    const filter = await screen.findByRole("combobox", { name: "Filter action" });
    await user.selectOptions(filter, "Member added");

    expect(filterValue()).toBe("Member added");
    expect(window.location.hash).toContain("action=Member+added");
    const filtered = screen.getByRole("table");
    expect(within(filtered).getByText("Member added")).not.toBeNull();
    expect(within(filtered).queryByText("Repository created")).toBeNull();
    expect(within(filtered).queryByText("Organization created")).toBeNull();

    reload();

    expect(await screen.findByRole("heading", { name: "Audit log" })).not.toBeNull();
    await screen.findByRole("combobox", { name: "Filter action" });
    expect(filterValue()).toBe("Member added");
    const reloaded = screen.getByRole("table");
    expect(within(reloaded).getByText("Member added")).not.toBeNull();
    expect(within(reloaded).queryByText("Repository created")).toBeNull();

    await user.selectOptions(filterControl(), "");

    expect(filterValue()).toBe("");
    const cleared = screen.getByRole("table");
    expect(within(cleared).getByText("Repository created")).not.toBeNull();
    expect(within(cleared).getByText("Member added")).not.toBeNull();
  });

  it("hides the audit log from an ordinary Member and refuses the direct URL", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-audit-viewer", EVOLUTION_PASSWORD);
    await openOrganization(user, "evo-audit-org");

    expect(screen.queryByRole("link", { name: "Audit log" })).toBeNull();

    act(() => navigate("/orgs/evo-audit-org/audit-log"));
    expect(await screen.findByRole("heading", { name: "Access denied" })).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
