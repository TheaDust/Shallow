import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { DEFAULT_ACCOUNTS, DEFAULT_ORGANIZATIONS, installFakeApi } from "./fake-api";

function signedInAs(username: string) {
  const api = installFakeApi(DEFAULT_ACCOUNTS, { organizations: DEFAULT_ORGANIZATIONS });
  const account = DEFAULT_ACCOUNTS.find((candidate) => candidate.username === username)!;
  api.signedInId = account.id;
  return api;
}

function renderManageAccess() {
  window.location.hash = "#/repositories/acme-demo/acme-docs/settings/access";
  return render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("grants a team Write access from the picker and keeps it after reloading", async () => {
  signedInAs("repo-admin");
  const user = userEvent.setup();
  renderManageAccess();

  await screen.findByRole("row", { name: /access-role-team/ });
  expect(screen.queryByRole("row", { name: /frontend-team/ })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Add people or teams" }));
  const picker = await screen.findByRole("dialog", { name: "Add people or teams" });
  await user.type(within(picker).getByLabelText("Search"), "frontend-team");
  await user.click(within(picker).getByRole("option", { name: "frontend-team" }));

  const roleBox = within(picker).getByRole("combobox", { name: "Role" }) as HTMLInputElement;
  await user.click(roleBox);
  await user.click(await screen.findByRole("option", { name: "Write" }));
  await user.click(within(picker).getByRole("button", { name: "Add" }));

  const row = await screen.findByRole("row", { name: /frontend-team/ });
  expect(within(row).getByText("frontend-team")).toBeTruthy();
  const rowRole = within(row).getByRole("combobox", { name: "Role" }) as HTMLInputElement;
  expect(rowRole.value).toBe("Write");
  expect(row.getAttribute("aria-label")).toBe("frontend-team Write");

  cleanup();
  renderManageAccess();
  const persisted = await screen.findByRole("row", { name: /frontend-team/ });
  expect((within(persisted).getByRole("combobox", { name: "Role" }) as HTMLInputElement).value).toBe("Write");
});

it("changes an existing row from Write to Read without adding a duplicate", async () => {
  signedInAs("repo-admin");
  const user = userEvent.setup();
  renderManageAccess();

  const row = await screen.findByRole("row", { name: /access-role-team/ });
  expect(within(row).getByText("access-role-team")).toBeTruthy();

  const roleBox = within(row).getByRole("combobox", { name: "Role" }) as HTMLInputElement;
  expect(roleBox.value).toBe("Write");
  await user.click(roleBox);
  await user.click(await screen.findByRole("option", { name: "Read" }));
  await user.click(within(row).getByRole("button", { name: "Save" }));

  await waitFor(() => {
    const rows = screen.getAllByRole("row", { name: /access-role-team/ });
    expect(rows.length).toBe(1);
    expect((within(rows[0]).getByRole("combobox", { name: "Role" }) as HTMLInputElement).value).toBe("Read");
  });

  cleanup();
  renderManageAccess();
  await waitFor(() => {
    const rows = screen.getAllByRole("row", { name: /access-role-team/ });
    expect(rows.length).toBe(1);
    expect((within(rows[0]).getByRole("combobox", { name: "Role" }) as HTMLInputElement).value).toBe("Read");
    expect(rows[0].getAttribute("aria-label")).toBe("access-role-team Read");
  });
});

it("reports Access denied when the viewer is not a repository Admin", async () => {
  signedInAs("org-member");
  renderManageAccess();

  expect(await screen.findByText("Access denied")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();
});
