import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeAccount } from "../test-utils/fake-api";

const ALICE: FakeAccount = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

const PASSWORD_CHANGE_ACCOUNTS: FakeAccount[] = [
  {
    username: "password-change-success",
    email: "password-change-success@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "password-change-invalid",
    email: "password-change-invalid@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "password-change-required",
    email: "password-change-required@example.test",
    password: "Valid-password-123!",
  },
];

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function renderSignedIn(hash: string, accounts: FakeAccount[] = [ALICE]) {
  const api = createFakeApi({ accounts });
  api.install();
  api.signInAs(accounts[0].username);
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("link", { name: "Account menu" });
  return { api, user };
}

const valueOf = (element: HTMLElement) => (element as HTMLInputElement).value;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("REQ-1-2 sign out", () => {
  it("exposes one account menu whose menu holds one Sign out link", async () => {
    const { user } = await renderSignedIn("#/");

    const triggers = screen.getAllByRole("link", { name: "Account menu" });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].getAttribute("aria-expanded")).toBe("false");

    await user.click(triggers[0]);

    const menu = screen.getByRole("menu", { name: "Account menu" });
    const signOutLinks = within(menu).getAllByRole("link", { name: "Sign out" });
    expect(signOutLinks).toHaveLength(1);
    expect(within(menu).getByRole("link", { name: "Settings" })).toBeTruthy();
  });

  it("opens the named confirmation dialog and Cancel keeps the session and page", async () => {
    const { api, user } = await renderSignedIn("#/settings/password");
    expect(screen.getByRole("heading", { name: "Password and authentication" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));

    const dialog = screen.getByRole("dialog", { name: "Sign out" });
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Confirm sign out"]);
    expect(within(dialog).getByText(/only/i)).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign out" })).toBeNull());
    expect(window.location.hash).toBe("#/settings/password");
    expect(api.currentUsername()).toBe("alice-dev");
    expect(screen.getByRole("link", { name: "Account menu" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Password and authentication" })).toBeTruthy();
  });

  it("confirming sign out ends the session and protected pages need sign-in again", async () => {
    const { api, user } = await renderSignedIn("#/settings/password");

    await user.click(screen.getByRole("link", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", { name: "Confirm sign out" }),
    );

    await waitFor(() => expect(screen.queryByRole("link", { name: "Account menu" })).toBeNull());
    expect(api.currentUsername()).toBeNull();
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();

    // Reopening the recorded protected page cannot restore the signed-out session.
    goto("#/settings/password");
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update password" })).toBeNull();

    // A reload of the unauthenticated state keeps the signed-out session.
    cleanup();
    render(<App />);
    await screen.findByRole("link", { name: "Sign in" });
    expect(screen.queryByRole("link", { name: "Account menu" })).toBeNull();
  });

  it("reaches Settings and Password and authentication from the account menu", async () => {
    const { user } = await renderSignedIn("#/");

    await user.click(screen.getByRole("link", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Settings" }));

    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Password and authentication" }));
    await waitFor(() => expect(window.location.hash).toBe("#/settings/password"));
    expect(screen.getByRole("heading", { name: "Password and authentication" })).toBeTruthy();
  });
});

describe("REQ-1-3 change password", () => {
  it("shows the labelled password fields and the update button", async () => {
    await renderSignedIn("#/settings/password", PASSWORD_CHANGE_ACCOUNTS);

    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();
  });

  it("reports the missing current password and keeps the credentials unchanged", async () => {
    const { api, user } = await renderSignedIn("#/settings/password", PASSWORD_CHANGE_ACCOUNTS);

    await user.type(screen.getByLabelText("New password"), "Required-password-789!");
    await user.type(screen.getByLabelText("Confirm password"), "Required-password-789!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is required")).toBeTruthy();
    expect(api.accounts[0].password).toBe("Valid-password-123!");
    expect(valueOf(screen.getByLabelText("Current password"))).toBe("");
    expect(valueOf(screen.getByLabelText("New password"))).toBe("");
    expect(valueOf(screen.getByLabelText("Confirm password"))).toBe("");
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("reports an incorrect current password and leaves the old password usable", async () => {
    const { api, user } = await renderSignedIn("#/settings/password", PASSWORD_CHANGE_ACCOUNTS);

    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!-wrong");
    await user.type(screen.getByLabelText("New password"), "Another-valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
    expect(api.accounts[0].password).toBe("Valid-password-123!");
  });

  it("updates the password and the new password signs in afterwards", async () => {
    const { api, user } = await renderSignedIn("#/settings/password", PASSWORD_CHANGE_ACCOUNTS);

    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(api.accounts[0].password).toBe("New-password-456!");

    goto("#/login");
    const form = await screen.findByRole("form", { name: "Sign in" });
    await user.type(within(form).getByLabelText("Username or email"), "password-change-success@example.test");
    await user.type(within(form).getByLabelText("Password"), "New-password-456!");
    await user.click(within(form).getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("password-change-success")).toBeTruthy();
  });
});
