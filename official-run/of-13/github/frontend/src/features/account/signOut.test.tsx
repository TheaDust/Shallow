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

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  renderApp("#/login");
  await user.type(await screen.findByLabelText("Username or email"), SEED_ACCOUNT.username);
  await user.type(screen.getByLabelText("Password"), SEED_ACCOUNT.password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-1-2 sign out", () => {
  it("opens the account menu with exactly one Sign out link and asks for confirmation", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await signIn(user);

    const menu = screen.getByRole("button", { name: "Account menu" });
    expect(menu.textContent).toContain(SEED_ACCOUNT.username);
    await user.click(menu);

    const signOutLinks = screen.getAllByRole("link", { name: "Sign out" });
    expect(signOutLinks).toHaveLength(1);
    await user.click(signOutLinks[0]);

    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    expect(dialog.textContent).toContain("current browser session");
    expect(within(dialog).getByRole("button", { name: "Confirm sign out" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("keeps the session when the confirmation is canceled", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await signIn(user);

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Sign out" })).toBeNull();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Workspace" })).toBeTruthy();
    expect(stub.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("ends the browser session only after confirmation and restores the unauthenticated entry", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    await signIn(user);
    const protectedHeading = screen.getByRole("heading", { name: "Workspace" });
    expect(protectedHeading).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm sign out" }));

    expect(
      stub.calls.some((call) => call.method === "DELETE" && call.path === "/api/session"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();

    // Reopening the protected page requires signing in again.
    cleanup();
    renderApp("#/dashboard");
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });
});
