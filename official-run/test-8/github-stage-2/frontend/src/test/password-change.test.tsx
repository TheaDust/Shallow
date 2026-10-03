import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { installFakeApi, type FakeAccount } from "./fake-api";

const SUCCESS: FakeAccount = {
  id: "account-success",
  username: "password-change-success",
  email: "password-change-success@example.test",
  password: "Valid-password-123!",
};

const INVALID: FakeAccount = {
  id: "account-invalid",
  username: "password-change-invalid",
  email: "password-change-invalid@example.test",
  password: "Valid-password-123!",
};

const REQUIRED: FakeAccount = {
  id: "account-required",
  username: "password-change-required",
  email: "password-change-required@example.test",
  password: "Valid-password-123!",
};

function renderSignedIn(hash: string, account: FakeAccount) {
  const api = installFakeApi([account]);
  api.signedInId = account.id;
  window.location.hash = hash;
  render(<App />);
  return api;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("opens Password and authentication from Settings and updates the password", async () => {
  const api = renderSignedIn("#/settings", SUCCESS);
  const user = userEvent.setup();

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Password and authentication" }));

  expect(await screen.findByRole("heading", { name: "Password and authentication" })).toBeTruthy();
  await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
  await user.type(screen.getByLabelText("New password"), "New-password-456!");
  await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
  await user.click(screen.getByRole("button", { name: "Update password" }));

  expect(await screen.findByText("Password updated")).toBeTruthy();
  expect(api.accounts[0].password).toBe("New-password-456!");
  expect(document.body.textContent).not.toContain("New-password-456!");

  cleanup();
  window.location.hash = "#/signin";
  render(<App />);
  await user.type(await screen.findByLabelText("Username or email"), "password-change-success@example.test");
  await user.type(screen.getByLabelText("Password"), "New-password-456!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("password-change-success")).toBeTruthy();
});

it("reports an incorrect current password and keeps the old credentials", async () => {
  const api = renderSignedIn("#/settings/password", INVALID);
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText("Current password"), "Valid-password-123!-wrong");
  await user.type(screen.getByLabelText("New password"), "Another-valid-password-123!");
  await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
  await user.click(screen.getByRole("button", { name: "Update password" }));

  expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
  expect(screen.queryByText("Password confirmation does not match")).toBeNull();
  expect(api.accounts[0].password).toBe("Valid-password-123!");
  expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
});

it("requires the current password before anything else", async () => {
  const api = renderSignedIn("#/settings/password", REQUIRED);
  const user = userEvent.setup();

  await screen.findByLabelText("New password");
  await user.type(screen.getByLabelText("New password"), "Required-password-789!");
  await user.type(screen.getByLabelText("Confirm password"), "Required-password-789!");
  await user.click(screen.getByRole("button", { name: "Update password" }));

  expect(await screen.findByText("Current password is required")).toBeTruthy();
  expect(api.accounts[0].password).toBe("Valid-password-123!");
});

it("keeps the password form behind a session", async () => {
  installFakeApi([SUCCESS]);
  window.location.hash = "#/settings/password";
  render(<App />);

  expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Update password" })).toBeNull();
});
