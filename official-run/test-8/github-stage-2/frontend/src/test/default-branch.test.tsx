import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { DEFAULT_ACCOUNTS, DEFAULT_ORGANIZATIONS, installFakeApi } from "./fake-api";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function installRepositories() {
  return installFakeApi(DEFAULT_ACCOUNTS, { organizations: DEFAULT_ORGANIZATIONS });
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  renderApp("#/signin");
  await user.type(await screen.findByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("lets the repository administrator confirm a new default branch from Settings → Branches", async () => {
  installRepositories();
  const user = userEvent.setup();
  await signInAs(user, "default-branch-admin@example.test");

  await user.click(await screen.findByRole("link", { name: "default-branch-demo" }));
  expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();

  await user.click(screen.getByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("link", { name: "Branches" }));

  const select = await screen.findByRole("combobox", { name: "Default branch" });
  expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual(["main", "release"]);
  await user.selectOptions(select, "release");
  await user.click(screen.getByRole("button", { name: "Update" }));
  await user.click(await screen.findByRole("button", { name: "Confirm" }));

  // Reopening the repository reads the new default branch.
  expect(await screen.findByRole("button", { name: "Branch release" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Branch release" }));
  expect(await screen.findByRole("option", { name: "main" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "release" })).toBeTruthy();

  cleanup();
  window.location.hash = "#/repositories/acme-demo/default-branch-demo";
  render(<App />);
  expect(await screen.findByRole("button", { name: "Branch release" })).toBeTruthy();
});

it("offers a non-administrator neither the Default branch combobox nor an update button", async () => {
  installRepositories();
  const user = userEvent.setup();
  await signInAs(user, "default-branch-viewer@example.test");

  await user.click(await screen.findByRole("link", { name: "default-branch-demo" }));
  expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

  // Even the direct Settings → Branches URL exposes no actionable control.
  cleanup();
  window.location.hash = "#/repositories/acme-demo/default-branch-demo/settings/branches";
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Branches" })).toBeTruthy();
  expect(await screen.findByText(/do not have permission to change the default branch/)).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
});
