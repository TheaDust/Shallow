import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { installFakeApi, type FakeAccount } from "./fake-api";

const ALICE: FakeAccount = {
  id: "account-alice",
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

function renderSignedIn(hash: string) {
  const api = installFakeApi([ALICE]);
  api.signedInId = ALICE.id;
  window.location.hash = hash;
  render(<App />);
  return api;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("offers one account menu with a single sign-out entry", async () => {
  renderSignedIn("#/");
  const user = userEvent.setup();

  const menus = await screen.findAllByRole("button", { name: "Account menu" });
  expect(menus).toHaveLength(1);
  await user.click(menus[0]);

  expect(screen.getAllByRole("link", { name: "Sign out" })).toHaveLength(1);
  expect(screen.getByRole("menu").textContent).toContain(ALICE.username);
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("#/settings");
});

it("keeps the session and the page when the sign-out dialog is cancelled", async () => {
  const api = renderSignedIn("#/settings");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(await screen.findByRole("link", { name: "Sign out" }));

  const dialog = await screen.findByRole("dialog", { name: "Sign out" });
  expect(dialog.textContent).toContain("this browser");
  expect(screen.getByRole("button", { name: "Confirm sign out" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  expect(api.signedInId).toBe(ALICE.id);
  expect(api.signOutCount).toBe(0);
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
});

it("ends the session only after confirming sign out", async () => {
  const api = renderSignedIn("#/settings");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(await screen.findByRole("link", { name: "Sign out" }));
  await user.click(await screen.findByRole("button", { name: "Confirm sign out" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.signOutCount).toBe(1);
  expect(api.signedInId).toBeNull();
  expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();

  cleanup();
  window.location.hash = "#/settings";
  render(<App />);
  expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
});

it("requires authentication again after reopening the protected page", async () => {
  const api = installFakeApi([ALICE]);
  api.signedInId = ALICE.id;
  window.location.hash = "#/settings";
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();

  cleanup();
  api.signedInId = null;
  window.location.hash = "#/settings";
  render(<App />);

  expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
});
