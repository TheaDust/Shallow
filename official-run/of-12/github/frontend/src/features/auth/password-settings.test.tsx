import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockServer, type MockServer } from "../../test/server-mock";

let server: MockServer;

function inputValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

beforeEach(() => {
  window.location.hash = "#/";
  server = createMockServer({ session: null });
  server.install();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openPasswordSettings(user: ReturnType<typeof userEvent.setup>) {
  window.location.hash = "#/";
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("link", { name: "Password and authentication" }));
  await screen.findByRole("heading", { level: 1, name: "Password and authentication" });
}

describe("REQ-1-3 password and authentication settings", () => {
  it("is reachable from the account menu with the three labelled fields", async () => {
    server.state.session = server.state.accounts[0];
    const user = userEvent.setup();
    await openPasswordSettings(user);

    expect(screen.getByLabelText("Current password").getAttribute("type")).toBe("password");
    expect(screen.getByLabelText("New password").getAttribute("type")).toBe("password");
    expect(screen.getByLabelText("Confirm password").getAttribute("type")).toBe("password");
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();
    expect(window.location.hash.startsWith("#/settings/password")).toBe(true);
  });

  it("shows Current password is required and keeps the credentials", async () => {
    server.state.session = server.state.accounts[0];
    server.state.passwordChange = {
      status: 400,
      body: {
        error: "Password change failed",
        fields: { currentPassword: "Current password is required" },
      },
    };
    const user = userEvent.setup();
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("New password"), "Required-password-789!");
    await user.type(screen.getByLabelText("Confirm password"), "Required-password-789!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is required")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
    expect(inputValue("New password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
    expect(server.state.accounts[0].password).toBe("Valid-password-123!");
  });

  it("reports an incorrect current password and a mismatching confirmation", async () => {
    server.state.session = server.state.accounts[0];
    server.state.passwordChange = {
      status: 400,
      body: {
        error: "Password change failed",
        fields: {
          currentPassword: "Current password is incorrect",
          confirmPassword: "Password confirmation does not match",
        },
      },
    };
    const user = userEvent.setup();
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("Current password"), "Wrong-password-000!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
    expect(screen.getByText("Password confirmation does not match")).toBeTruthy();
    expect(server.state.accounts[0].password).toBe("Valid-password-123!");
  });

  it("submits the values shown in the fields even when React never saw the changes", async () => {
    server.state.session = server.state.accounts[0];
    server.state.passwordChange = {
      status: 400,
      body: { error: "Password change failed", fields: { currentPassword: "Current password is incorrect" } },
    };
    const user = userEvent.setup();
    await openPasswordSettings(user);

    (screen.getByLabelText("Current password") as HTMLInputElement).value = "Valid-password-123!";
    (screen.getByLabelText("New password") as HTMLInputElement).value = "New-password-456!";
    (screen.getByLabelText("Confirm password") as HTMLInputElement).value = "New-password-456!";
    await user.click(screen.getByRole("button", { name: "Update password" }));

    const attempt = await waitFor(() => {
      const request = server.state.requests.find((entry) => entry.path === "/api/account/password");
      expect(request?.body).toEqual({
        currentPassword: "Valid-password-123!",
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      });
      return request;
    });
    expect(attempt).toBeTruthy();
    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
    expect(inputValue("New password")).toBe("");
  });

  it("applies the new password on success and reports it after a reload", async () => {
    server.state.session = server.state.accounts[0];
    const user = userEvent.setup();
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    await waitFor(() => {
      expect(window.location.hash).toBe("#/settings/password?updated=1");
    });
    expect(server.state.accounts[0].password).toBe("New-password-456!");

    cleanup();
    render(<App />);
    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(screen.getByLabelText("Current password")).toBeTruthy();
  });

  it("keeps the settings form for a signed out visitor without changing credentials", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/settings/password";
    render(<App />);

    expect(await screen.findByText("You need to sign in to change your password.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update password" })).toBeNull();
  });
});
