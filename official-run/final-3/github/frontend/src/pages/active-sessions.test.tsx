import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

const EVOLUTION_PASSWORD = "Evo-Password-987!";

async function signInAs(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password = EVOLUTION_PASSWORD,
) {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function openActiveSessions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("link", { name: "Active sessions" }));
  await screen.findByRole("heading", { name: "Active sessions" });
}

function sessionRows(): HTMLElement[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .filter((row) => within(row).queryByText(/Current session|Session revoked/) !== null || within(row).queryByRole("button", { name: "Revoke session" }) !== null);
}

function rowWith(text: string | RegExp): HTMLElement {
  const row = sessionRows().find((candidate) => within(candidate).queryByText(text) !== null);
  if (!row) throw new Error(`No session row matches ${String(text)}`);
  return row;
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

describe("REQ-1-4 active sessions", () => {
  it("shows the current browser session with its device and last activity and no secret", async () => {
    const user = userEvent.setup();
    await signInAs(user, "evo-session-owner");
    await openActiveSessions(user);

    const rows = sessionRows();
    expect(rows).toHaveLength(1);
    const current = rows[0];
    expect(within(current).getByText("Current session")).not.toBeNull();
    expect(within(current).getByText("Chrome on Linux")).not.toBeNull();
    expect(within(current).getByText(/^Last active /)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();

    // No session secret or token is rendered: neither a session identifier nor
    // an opaque key of the session list ever reaches the page text.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/session-\d/);
  });

  it("revokes the other browser session, keeps the current one and shows the state after reload", async () => {
    const user = userEvent.setup();
    await signInAs(user, "evo-session-owner-s2");
    api.openSession("evo-session-owner-s2", "Firefox on macOS");
    await openActiveSessions(user);

    expect(sessionRows()).toHaveLength(2);
    const other = rowWith("Firefox on macOS");
    await user.click(within(other).getByRole("button", { name: "Revoke session" }));

    const revoked = rowWith("Session revoked");
    expect(within(revoked).getByText("Firefox on macOS")).not.toBeNull();
    expect(within(rowWith("Current session")).getByText("Chrome on Linux")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();

    cleanup();
    render(<App />);
    await screen.findByRole("heading", { name: "Active sessions" });
    expect(within(rowWith("Session revoked")).getByText("Firefox on macOS")).not.toBeNull();
    expect(within(rowWith("Current session")).getByText("Chrome on Linux")).not.toBeNull();
  });

  it("sends a browser whose session another one revoked back to the sign-in page", async () => {
    const user = userEvent.setup();
    await signInAs(user, "evo-session-owner-s3");
    expect(screen.getByRole("button", { name: "Account menu" })).not.toBeNull();

    // Another browser revokes this session; this browser keeps its cookie.
    api.revokeCurrentSession();

    cleanup();
    window.location.hash = "#/";
    render(<App />);
    expect(await screen.findByLabelText("Username or email")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "GitHub" })).toBeNull();
  });

  it("keeps the signed-out home page for a browser that never signed in", async () => {
    render(<App />);
    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "GitHub" })).not.toBeNull();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });

  it("restores the sessions view from the address and returns to the signed-out entry after sign out", async () => {
    const user = userEvent.setup();
    await signInAs(user, "evo-session-owner-s3");
    await openActiveSessions(user);

    expect(await screen.findByText("Chrome on Linux")).not.toBeNull();

    cleanup();
    window.location.hash = "#/settings/sessions";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Active sessions" })).not.toBeNull();

    // Signing out removes the account menu and the protected view; the visitor
    // entry keeps its "Sign in" link.
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", {
        name: "Confirm sign out",
      }),
    );
    act(() => {
      window.location.hash = "#/settings/sessions";
    });
    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Active sessions" })).toBeNull();
  });
});
