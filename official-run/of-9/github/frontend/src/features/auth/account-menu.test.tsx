import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "./AccountMenu";
import { SessionProvider } from "./session";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  fetchSession: vi.fn(),
}));

vi.mock("./api", () => ({
  signOut: mocks.signOut,
  fetchSession: mocks.fetchSession,
}));

const account = { username: "alice-dev", email: "alice.dev@example.test" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSession.mockResolvedValue({ authenticated: false });
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

function renderMenu() {
  return render(
    <SessionProvider>
      <AccountMenu account={account} />
    </SessionProvider>,
  );
}

describe("AccountMenu", () => {
  it("opens a menu that shows the account, Settings and the Sign out link", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Account menu" }) as HTMLButtonElement;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(screen.getByRole("menu", { name: "Account menu" })).toBeTruthy();
    expect(screen.getByText("alice-dev")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign out" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("navigates to Settings from the account menu", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(window.location.hash).toBe("#/settings");
    expect(screen.queryByRole("menu", { name: "Account menu" })).toBeNull();
  });

  it("opens the Sign out dialog and Cancel retains the session", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));

    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    expect(dialog).toBeTruthy();
    expect(screen.getByText("Signing out affects only the current browser session.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Sign out" })).toBeNull(),
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("confirm sign out invalidates the session and returns to the home page", async () => {
    const user = userEvent.setup();
    mocks.signOut.mockResolvedValue(undefined);
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(await screen.findByRole("button", { name: "Confirm sign out" }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(window.location.hash).toBe("#/");
  });
});
