import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

async function fillSignIn(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password = "Evo-Password-987!",
) {
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function signInAs(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password = "Evo-Password-987!",
) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await fillSignIn(user, identifier, password);
}

async function openActiveSessions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });
  await user.click(screen.getByRole("link", { name: "Active sessions" }));
  await screen.findByRole("heading", { name: "Active sessions" });
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
  it("lists the current browser session with its device and last-active time", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-session-owner");
    await openActiveSessions(user);

    const list = await screen.findByRole("list", { name: "Active sessions" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Chrome on Linux")).not.toBeNull();
    expect(within(rows[0]).getByText(/^Last active/)).not.toBeNull();
    expect(within(rows[0]).getByText("Current session")).not.toBeNull();
    // The current session is never offered for revocation and no secret is shown.
    expect(within(list).queryByRole("button", { name: "Revoke session" })).toBeNull();
    expect(within(list).queryByText(/fake-session/)).toBeNull();
    expect(within(list).queryByText(/fake-handle/)).toBeNull();
  });

  it("revokes the other browser session and keeps the updated state after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    // Two browsers sign in as the same account, so it has two active sessions.
    await signInAs(user, "evo-session-owner-s2");
    act(() => navigate("/sign-in"));
    await fillSignIn(user, "evo-session-owner-s2");
    await openActiveSessions(user);

    const list = await screen.findByRole("list", { name: "Active sessions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByText("Current session")).toHaveLength(1);

    await user.click(within(list).getByRole("button", { name: "Revoke session" }));

    expect(await screen.findByText("Session revoked")).not.toBeNull();
    expect(within(list).getByText("Inactive")).not.toBeNull();
    expect(within(list).queryByRole("button", { name: "Revoke session" })).toBeNull();
    expect(within(list).getAllByText("Current session")).toHaveLength(1);

    // Reloading the security page reads the same authoritative list.
    cleanup();
    render(<App />);
    await screen.findByRole("heading", { name: "Active sessions" });
    const afterReload = await screen.findByRole("list", { name: "Active sessions" });
    expect(within(afterReload).getByText("Inactive")).not.toBeNull();
    expect(within(afterReload).queryByRole("button", { name: "Revoke session" })).toBeNull();
    expect(within(afterReload).getByText("Current session")).not.toBeNull();
    expect(await screen.findByText("evo-session-owner-s2")).not.toBeNull();
  });

  it("returns a browser whose own session was revoked to the sign-in page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-session-owner-s3");
    await openActiveSessions(user);
    await screen.findByRole("list", { name: "Active sessions" });

    // Another browser revokes this browser's session, then this page reloads.
    api.revokeCurrentSession();
    cleanup();
    render(<App />);

    expect(await screen.findByLabelText("Username or email")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByText("evo-session-owner-s3")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Active sessions" })).toBeNull();
    expect(window.location.hash).toBe("#/sign-in");
  });

  it("keeps the active sessions page behind a session", async () => {
    window.location.hash = "#/settings/sessions";
    render(<App />);
    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Active sessions" })).toBeNull();
  });
});
