import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function openManageAccess(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "acme-docs" }));
  await screen.findByRole("heading", { name: /acme-docs/ });
  await user.click(await screen.findByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("link", { name: "Manage access" }));
  await screen.findByRole("heading", { name: "Manage access" });
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

describe("REQ-2-3 grant repository access to people and teams", () => {
  it("grants a team Write access through the picker and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "repo-admin");
    await openManageAccess(user);

    await user.click(await screen.findByRole("button", { name: "Add people or teams" }));
    const dialog = await screen.findByRole("dialog", { name: "Add people or teams" });
    await user.type(within(dialog).getByLabelText("Search"), "frontend-team");
    await user.click(within(dialog).getByRole("option", { name: "frontend-team" }));
    await user.selectOptions(within(dialog).getByLabelText("Role"), "Write");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    const row = await screen.findByRole("row", { name: /frontend-team/ });
    expect(within(row).getByText("frontend-team")).not.toBeNull();
    expect(within(row).getByText("Write")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Manage access" });
    expect(await screen.findByRole("row", { name: /frontend-team Write/ })).not.toBeNull();
  });

  it("changes an existing team grant from Write to Read without creating a duplicate", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "repo-admin");
    await openManageAccess(user);

    const row = await screen.findByRole("row", { name: /access-role-team/ });
    expect(within(row).getByText("Write")).not.toBeNull();

    await user.selectOptions(within(row).getByLabelText("Role"), "Read");
    await user.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getAllByRole("row", { name: /access-role-team/ })).toHaveLength(1);
    });
    expect(within(screen.getAllByRole("row", { name: /access-role-team/ })[0]).getByText("Read")).not.toBeNull();

    reload();
    const reloaded = await screen.findAllByRole("row", { name: /access-role-team/ });
    expect(reloaded).toHaveLength(1);
    expect(within(reloaded[0]).getByText("Read")).not.toBeNull();
  });
});
