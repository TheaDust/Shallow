import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordChangeForm } from "./PasswordChangeForm";

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
}));

vi.mock("./api", () => ({
  changePassword: mocks.changePassword,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

function inputValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

describe("PasswordChangeForm", () => {
  it("renders the uniquely labeled password fields and the Update password button", () => {
    render(<PasswordChangeForm />);
    expect(screen.getByLabelText("Current password").getAttribute("type")).toBe("password");
    expect(screen.getByLabelText("New password").getAttribute("type")).toBe("password");
    expect(screen.getByLabelText("Confirm password").getAttribute("type")).toBe("password");
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();
  });

  it("displays Password updated, clears the fields and keeps the form after success", async () => {
    const user = userEvent.setup();
    mocks.changePassword.mockResolvedValue({ ok: true });
    render(<PasswordChangeForm />);
    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(mocks.changePassword).toHaveBeenCalledWith({
      currentPassword: "Valid-password-123!",
      newPassword: "New-password-456!",
      confirmPassword: "New-password-456!",
    });
    expect(inputValue("Current password")).toBe("");
    expect(inputValue("New password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
  });

  it("shows the current-password error beside the field and clears password inputs after failure", async () => {
    const user = userEvent.setup();
    mocks.changePassword.mockResolvedValue({
      ok: false,
      errors: { currentPassword: "Current password is required" },
    });
    render(<PasswordChangeForm />);
    await user.type(screen.getByLabelText("New password"), "Required-password-789!");
    await user.type(screen.getByLabelText("Confirm password"), "Required-password-789!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is required")).toBeTruthy();
    expect(inputValue("Current password")).toBe("");
    expect(inputValue("New password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("shows current-password and confirmation errors together on failure", async () => {
    const user = userEvent.setup();
    mocks.changePassword.mockResolvedValue({
      ok: false,
      errors: {
        currentPassword: "Current password is incorrect",
        confirmPassword: "Password confirmation does not match",
      },
    });
    render(<PasswordChangeForm />);
    await user.type(screen.getByLabelText("Current password"), "Wrong-password-1!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
    expect(screen.getByText("Password confirmation does not match")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
  });
});
