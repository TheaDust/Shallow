import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";

const SEED_ACCOUNT = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};
const SUCCESS_CANDIDATE = "New-password-456!";
const REQUIRED_CANDIDATE = "Required-password-789!";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

async function openPasswordSettings(user: ReturnType<typeof userEvent.setup>) {
  renderApp("#/login");
  await user.type(await screen.findByLabelText("Username or email"), SEED_ACCOUNT.username);
  await user.type(screen.getByLabelText("Password"), SEED_ACCOUNT.password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });

  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });
  await user.click(screen.getByRole("link", { name: "Password and authentication" }));
  await screen.findByRole("heading", { name: "Password and authentication" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-1-3 change account password", () => {
  it("opens the security page from the account menu with the required controls", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openPasswordSettings(user);

    expect((screen.getByLabelText("Current password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText("New password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).type).toBe("password");
    const submit = screen.getByRole("button", { name: "Update password" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires the current password", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("New password"), REQUIRED_CANDIDATE);
    await user.type(screen.getByLabelText("Confirm password"), REQUIRED_CANDIDATE);
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is required")).toBeTruthy();
    expect(stub.accounts[0].password).toBe(SEED_ACCOUNT.password);
  });

  it("reports an incorrect current password and a mismatched confirmation without changing credentials", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("Current password"), "Wrong-password-123!");
    await user.type(screen.getByLabelText("New password"), SUCCESS_CANDIDATE);
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
    expect(screen.getByText("Password confirmation does not match")).toBeTruthy();
    expect(stub.accounts[0].password).toBe(SEED_ACCOUNT.password);
  });

  it("updates the password of the current account only", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await openPasswordSettings(user);

    await user.type(screen.getByLabelText("Current password"), SEED_ACCOUNT.password);
    await user.type(screen.getByLabelText("New password"), SUCCESS_CANDIDATE);
    await user.type(screen.getByLabelText("Confirm password"), SUCCESS_CANDIDATE);
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(stub.accounts[0].password).toBe(SUCCESS_CANDIDATE);
    const changeCall = stub.calls.find(
      (call) => call.method === "POST" && call.path === "/api/password",
    );
    expect(changeCall?.body).toEqual({
      currentPassword: SEED_ACCOUNT.password,
      newPassword: SUCCESS_CANDIDATE,
      confirmPassword: SUCCESS_CANDIDATE,
    });
  });

  it("keeps the security page unauthenticated without a session", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    renderApp("#/settings/password");

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("keeps the settings page unauthenticated without a session", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    renderApp("#/settings");

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Password and authentication" })).toBeNull();
  });

  it("shows the settings entry inside the account menu of the signed-in account", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    renderApp("#/login");

    await user.type(await screen.findByLabelText("Username or email"), SEED_ACCOUNT.email);
    await user.type(screen.getByLabelText("Password"), SEED_ACCOUNT.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Workspace" });

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText(`Signed in as ${SEED_ACCOUNT.username}`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign out" })).toHaveLength(1);
  });
});
