import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string, password = "Valid-password-123!") {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function openPasswordSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("link", { name: "Password and authentication" }));
  await screen.findByRole("heading", { name: "Password and authentication" });
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

describe("REQ-1-2 sign out", () => {
  it("cancels without ending the session and keeps the original page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "alice-dev");

    expect(screen.getAllByRole("button", { name: "Account menu" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    const menu = screen.getByRole("menu", { name: "Account menu" });
    const signOutLinks = within(menu).getAllByRole("link", { name: "Sign out" });
    expect(signOutLinks).toHaveLength(1);

    await user.click(signOutLinks[0]);
    const dialog = screen.getByRole("dialog", { name: "Sign out" }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Confirm sign out" })).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).not.toBeNull();
    expect(within(dialog).getByText(/current browser session/i)).not.toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog.open).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Sign out" })).toBeNull();
    expect(screen.getByRole("button", { name: "Account menu" })).not.toBeNull();
    expect(api.signedInUsername()).toBe("alice-dev");
  });

  it("keeps no closed dialog nodes in the document", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "alice-dev");

    // Nothing is open yet: the closed sign-out surface must not linger in the DOM.
    expect(document.querySelectorAll("dialog")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(dialog.textContent).toContain("Confirm sign out");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(document.querySelectorAll("dialog")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Confirm sign out");
  });

  it("confirms sign out, drops the account menu and requires re-authentication", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "alice-dev");

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", {
        name: "Confirm sign out",
      }),
    );

    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(api.signedInUsername()).toBeNull();

    act(() => navigate("/settings"));
    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();

    cleanup();
    render(<App />);
    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });
});

describe("REQ-1-3 change account password", () => {
  it("updates the password and signs in with the new credential", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "password-change-success");
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).not.toBeNull();
    expect(api.accounts.find((account) => account.username === "password-change-success")?.password).toBe(
      "New-password-456!",
    );

    act(() => navigate("/sign-in"));
    await user.type(screen.getByLabelText("Username or email"), "password-change-success@example.test");
    await user.type(screen.getByLabelText("Password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("password-change-success")).not.toBeNull();
  });

  it("rejects an incorrect current password and keeps the old credential usable", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "password-change-invalid");
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!-wrong");
    await user.type(screen.getByLabelText("New password"), "Another-valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).not.toBeNull();
    expect(api.accounts.find((account) => account.username === "password-change-invalid")?.password).toBe(
      "Valid-password-123!",
    );

    act(() => navigate("/sign-in"));
    await user.type(screen.getByLabelText("Username or email"), "password-change-invalid@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("password-change-invalid")).not.toBeNull();
  });

  it("requires the current password and keeps the old credential usable", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "password-change-required");
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("New password"), "Required-password-789!");
    await user.type(screen.getByLabelText("Confirm password"), "Required-password-789!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is required")).not.toBeNull();
    expect(api.accounts.find((account) => account.username === "password-change-required")?.password).toBe(
      "Valid-password-123!",
    );
  });
});
