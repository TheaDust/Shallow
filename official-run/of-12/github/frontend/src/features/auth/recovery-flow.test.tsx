import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockServer, type MockServer } from "../../test/server-mock";

const REGISTERED_EMAIL = "alice.dev@example.test";

let server: MockServer;

function inputValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

beforeEach(() => {
  window.location.hash = "#/";
  server = createMockServer();
  server.install();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openRecoveryStep(user: ReturnType<typeof userEvent.setup>, email: string) {
  window.location.hash = "#/sign-in";
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Forgot password" }));
  await user.type(await screen.findByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  await screen.findByRole("button", { name: "Reset password" });
}

describe("REQ-1-1-3 password recovery through a verified email", () => {
  it("opens from Forgot password and shows the fixed code as its own value", async () => {
    const user = userEvent.setup();
    await openRecoveryStep(user, REGISTERED_EMAIL);

    const code = screen.getByText("123456");
    expect(code.textContent).toBe("123456");
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
    expect(screen.getByLabelText("New password").getAttribute("type")).toBe("password");
    expect(screen.getByLabelText("Confirm password").getAttribute("type")).toBe("password");
    expect(inputValue("Email")).toBe(REGISTERED_EMAIL);
  });

  it("shows the same next step for an unknown email without revealing existence", async () => {
    const user = userEvent.setup();
    await openRecoveryStep(user, "nobody@example.test");

    expect(screen.getByText("123456")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
    const started = server.state.requests.filter((entry) => entry.path === "/api/password-recovery/requests");
    expect(started).toHaveLength(1);
    expect(started[0].body).toEqual({ email: "nobody@example.test" });
  });

  it("submits the value shown in the field even when React never saw the change", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/forgot-password";
    render(<App />);

    const emailInput = (await screen.findByLabelText("Email")) as HTMLInputElement;
    // A programmatic fill that bypasses the component state, as browser
    // automation can do right after navigating to the page.
    emailInput.value = REGISTERED_EMAIL;
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    const started = await waitFor(() => {
      const request = server.state.requests.find((entry) => entry.path === "/api/password-recovery/requests");
      expect(request?.body).toEqual({ email: REGISTERED_EMAIL });
      return request;
    });
    expect(started).toBeTruthy();
    expect(inputValue("Email")).toBe(REGISTERED_EMAIL);
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
  });

  it("reports an invalid verification code and clears the password fields", async () => {
    server.state.recoveryCompletion = {
      status: 400,
      body: {
        error: "Password reset failed",
        fields: { code: "Verification code is invalid", email: "Email is not registered" },
      },
    };
    const user = userEvent.setup();
    await openRecoveryStep(user, REGISTERED_EMAIL);

    await user.type(screen.getByLabelText("Verification code"), "000000");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Verification code is invalid")).toBeTruthy();
    expect(screen.getByText("Email is not registered")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
    expect(inputValue("New password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
    expect(server.state.accounts[0].password).toBe("Valid-password-123!");
  });

  it("updates the password with the correct code and keeps the result after a reload", async () => {
    const user = userEvent.setup();
    await openRecoveryStep(user, REGISTERED_EMAIL);

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    await waitFor(() => {
      expect(window.location.hash).toBe("#/forgot-password?updated=1");
    });
    expect(server.state.accounts[0].password).toBe("Replacement-password-456!");

    cleanup();
    render(<App />);
    expect(await screen.findByText("Password updated")).toBeTruthy();
  });

  it("restarts the flow when the recovery page is opened again", async () => {
    const user = userEvent.setup();
    await openRecoveryStep(user, REGISTERED_EMAIL);
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await screen.findByText("Password updated");

    window.location.hash = "#/forgot-password";
    expect(await screen.findByRole("button", { name: "Send reset link" })).toBeTruthy();
    expect(inputValue("Email")).toBe("");
    expect(screen.queryByText("Password updated")).toBeNull();
  });
});
