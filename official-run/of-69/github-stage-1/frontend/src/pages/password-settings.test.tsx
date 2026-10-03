import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import * as sessionApi from "../lib/session-api";
import { SessionProvider } from "../session/session-context";
import { PasswordSettingsPage } from "./PasswordSettingsPage";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("../lib/session-api", () => ({
  changePassword: vi.fn(),
  registerAccount: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  fetchSession: vi.fn().mockResolvedValue(null),
  startRecovery: vi.fn(),
  resetPassword: vi.fn(),
}));

const ACCOUNT = {
  id: "account-password-change-success",
  username: "password-change-success",
  email: "password-change-success@example.test",
  emailVerified: true,
  status: "available",
};

function renderPage() {
  return render(
    <SessionProvider>
      <PasswordSettingsPage account={ACCOUNT} />
    </SessionProvider>,
  );
}

describe("password and authentication settings", () => {
  it("renders the uniquely labeled security form", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Password and authentication" })).toBeTruthy();
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
  });

  it("shows the server confirmation and stops redisplaying submitted passwords", async () => {
    const user = userEvent.setup();
    vi.mocked(sessionApi.changePassword).mockResolvedValue("Password updated");

    renderPage();
    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(vi.mocked(sessionApi.changePassword).mock.calls[0][0]).toEqual({
      currentPassword: "Valid-password-123!",
      newPassword: "New-password-456!",
      confirmPassword: "New-password-456!",
    });
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
  });

  it("reports an incorrect current password and a mismatched confirmation together", async () => {
    const user = userEvent.setup();
    vi.mocked(sessionApi.changePassword).mockRejectedValue(
      new ApiError("Unprocessable", 422, {
        errors: {
          currentPassword: "Current password is incorrect",
          confirmPassword: "Password confirmation does not match",
        },
      }),
    );

    renderPage();
    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!-wrong");
    await user.type(screen.getByLabelText("New password"), "Another-valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
    expect(screen.getByText("Password confirmation does not match")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
  });

  it("reports an empty current password with the required message", async () => {
    const user = userEvent.setup();
    vi.mocked(sessionApi.changePassword).mockRejectedValue(
      new ApiError("Unprocessable", 422, { errors: { currentPassword: "Current password is required" } }),
    );

    renderPage();
    await user.type(screen.getByLabelText("New password"), "Required-password-789!");
    await user.type(screen.getByLabelText("Confirm password"), "Required-password-789!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is required")).toBeTruthy();
    expect(vi.mocked(sessionApi.changePassword).mock.calls[0][0]).toEqual({
      currentPassword: "",
      newPassword: "Required-password-789!",
      confirmPassword: "Required-password-789!",
    });
  });
});

describe("account settings", () => {
  it("offers the Password and authentication entry", () => {
    render(
      <SessionProvider>
        <SettingsPage account={ACCOUNT} />
      </SessionProvider>,
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    const entry = screen.getByRole("link", { name: "Password and authentication" });
    expect(entry.getAttribute("href")).toBe("#/settings/password");
  });
});
