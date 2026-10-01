import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";

const SEED_ACCOUNT = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};
const REPLACEMENT = "Replacement-password-456!";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function inputValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

async function openRecoveryStep(user: ReturnType<typeof userEvent.setup>, email: string) {
  renderApp("#/login");
  await user.click(await screen.findByRole("link", { name: "Forgot password" }));
  await user.type(await screen.findByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-1-1-3 password recovery", () => {
  it("opens the recovery form from the sign-in page and shows the fixed code with the reset fields", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openRecoveryStep(user, SEED_ACCOUNT.email);

    // The fixed code is a distinct visible value, not only part of a sentence.
    expect(screen.getByText("123456", { exact: true })).toBeTruthy();
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
  });

  it("uses the same next step for a registered and an unknown email without asking for email access", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });

    const registered = userEvent.setup();
    await openRecoveryStep(registered, SEED_ACCOUNT.email);
    expect(screen.getByText("123456", { exact: true })).toBeTruthy();
    cleanup();

    const unknown = userEvent.setup();
    await openRecoveryStep(unknown, "nobody@example.test");
    expect(screen.getByText("123456", { exact: true })).toBeTruthy();
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
  });

  it("updates the registered account with the correct code and a compliant password", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openRecoveryStep(user, SEED_ACCOUNT.email);

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), REPLACEMENT);
    await user.type(screen.getByLabelText("Confirm password"), REPLACEMENT);
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(stub.accounts[0].password).toBe(REPLACEMENT);
  });

  it("reports an invalid verification code and keeps the account usable", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openRecoveryStep(user, SEED_ACCOUNT.email);

    await user.type(screen.getByLabelText("Verification code"), "000000");
    await user.type(screen.getByLabelText("New password"), REPLACEMENT);
    await user.type(screen.getByLabelText("Confirm password"), REPLACEMENT);
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Verification code is invalid")).toBeTruthy();
    expect(stub.accounts[0].password).toBe(SEED_ACCOUNT.password);
    // Password inputs never redisplay what was submitted.
    expect(inputValue("New password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
  });

  it("explains the unknown email in the same step and does not modify any account", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openRecoveryStep(user, "nobody@example.test");

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), REPLACEMENT);
    await user.type(screen.getByLabelText("Confirm password"), REPLACEMENT);
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Account not found")).toBeTruthy();
    expect(stub.accounts[0].password).toBe(SEED_ACCOUNT.password);
  });

  it("reports a noncompliant replacement password without touching the account", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openRecoveryStep(user, SEED_ACCOUNT.email);

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "short");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password requirements are not satisfied")).toBeTruthy();
    expect(stub.accounts[0].password).toBe(SEED_ACCOUNT.password);
  });
});
