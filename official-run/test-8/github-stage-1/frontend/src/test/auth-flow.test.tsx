import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { installFakeApi, type FakeAccount } from "./fake-api";

const ALICE: FakeAccount = {
  id: "account-alice",
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("offers the account-access entries from the home page exactly once", async () => {
  installFakeApi();
  renderApp("#/");

  const signInLinks = await screen.findAllByRole("link", { name: "Sign in" });
  expect(signInLinks).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Sign up" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Forgot password" })).toBeTruthy();
});

it("reaches the registration form through Sign in and Create an account", async () => {
  installFakeApi();
  renderApp("#/");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.click(await screen.findByRole("link", { name: "Create an account" }));

  expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: "Agree to the terms" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getAllByLabelText("Username")).toHaveLength(1);
  expect(screen.getAllByLabelText("Email")).toHaveLength(1);
  expect(screen.getAllByLabelText("Password")).toHaveLength(1);
  expect(screen.getAllByLabelText("Confirm password")).toHaveLength(1);
});

it("shows every invalid registration field together and keeps the typed username and email", async () => {
  installFakeApi();
  renderApp("#/signup");
  const user = userEvent.setup();

  await screen.findByRole("button", { name: "Create account" });
  await user.type(screen.getByLabelText("Username"), "-invalid-demo");
  await user.type(screen.getByLabelText("Email"), "not-an-email");
  await user.type(screen.getByLabelText("Password"), "short");
  await user.type(screen.getByLabelText("Confirm password"), "different");
  await user.click(screen.getByRole("button", { name: "Create account" }));

  for (const message of [
    "Username format is invalid",
    "Email format is invalid",
    "Password requirements are not satisfied",
    "Agree to terms is required",
  ]) {
    expect(await screen.findByText(message)).toBeTruthy();
  }

  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("-invalid-demo");
  expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("not-an-email");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
  expect(document.body.textContent).not.toContain("short");
  expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  expect(window.location.hash).toBe("#/signup");
});

it("registers an account, signs in with it, and keeps the username after a reload", async () => {
  const api = installFakeApi();
  renderApp("#/signup");
  const user = userEvent.setup();

  await screen.findByRole("button", { name: "Create account" });
  await user.type(screen.getByLabelText("Username"), "nora-demo");
  await user.type(screen.getByLabelText("Email"), "nora.demo@example.test");
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
  await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
  await user.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  expect(window.location.hash).toBe("#/signin");
  expect(screen.getByLabelText("Username or email")).toBeTruthy();

  await user.type(screen.getByLabelText("Username or email"), "nora.demo@example.test");
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByText("nora-demo")).toBeTruthy();
  expect(window.location.hash).toBe("#/");
  expect(api.signedInId).toBe(api.accounts[0].id);

  cleanup();
  renderApp("#/");
  expect(await screen.findByText("nora-demo")).toBeTruthy();
});

it("reports invalid credentials without disclosing the submitted password", async () => {
  installFakeApi([ALICE]);
  renderApp("#/signin");
  const user = userEvent.setup();

  const identifier = await screen.findByLabelText("Username or email");
  await user.type(identifier, "alice.dev@example.test");
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!-wrong");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByText("Invalid credentials")).toBeTruthy();
  expect((identifier as HTMLInputElement).value).toBe("alice.dev@example.test");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  expect(document.body.textContent).not.toContain("Valid-password-123!-wrong");
});

it("shows the fixed verification code for a registered and for an unknown address", async () => {
  installFakeApi([ALICE]);
  const user = userEvent.setup();

  renderApp("#/forgot");
  await user.type(await screen.findByLabelText("Email"), "alice.dev@example.test");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByText("123456")).toBeTruthy();
  expect(screen.getByLabelText("Verification code")).toBeTruthy();
  expect(screen.getByLabelText("New password")).toBeTruthy();
  expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("alice.dev@example.test");

  cleanup();
  renderApp("#/forgot/reset?email=unknown@example.test");
  expect(await screen.findByText("123456")).toBeTruthy();
  expect(screen.getByLabelText("Verification code")).toBeTruthy();
  expect(screen.getByLabelText("New password")).toBeTruthy();
});

it("keeps the original password when the verification code is wrong", async () => {
  const api = installFakeApi([ALICE]);
  renderApp("#/forgot/reset?email=alice.dev@example.test");
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText("Verification code"), "000000");
  await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
  await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
  await user.click(screen.getByRole("button", { name: "Reset password" }));

  expect(await screen.findByText("Verification code is invalid")).toBeTruthy();
  expect(api.accounts[0].password).toBe("Valid-password-123!");
  expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
  expect(document.body.textContent).not.toContain("Replacement-password-456!");
});

it("updates the password with a correct code and signs in with it", async () => {
  const api = installFakeApi([ALICE]);
  renderApp("#/forgot/reset?email=alice.dev@example.test");
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText("Verification code"), "123456");
  await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
  await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
  await user.click(screen.getByRole("button", { name: "Reset password" }));

  expect(await screen.findByText("Password updated")).toBeTruthy();
  expect(api.accounts[0].password).toBe("Replacement-password-456!");

  cleanup();
  renderApp("#/signin");
  await user.type(await screen.findByLabelText("Username or email"), "alice.dev@example.test");
  await user.type(screen.getByLabelText("Password"), "Replacement-password-456!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("alice-dev")).toBeTruthy();
});

it("keeps protected pages behind a session", async () => {
  installFakeApi([ALICE]);
  renderApp("#/settings");

  expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
});

it("shows the settings page with the account menu for a signed-in account", async () => {
  const api = installFakeApi([ALICE]);
  api.signedInId = ALICE.id;
  renderApp("#/settings");

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Account menu" })).toHaveLength(1);
});
