import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

const EVO_PASSWORD = "Evo-Password-987!";

async function signInAs(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password = EVO_PASSWORD,
) {
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

function rows(): HTMLElement[] {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
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

describe("REQ-1-4 active browser sessions", () => {
  it("lists the current session with its device and last-active time and no secret", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo.session.owner@evolution.test");
    await openActiveSessions(user);

    expect(screen.getByRole("heading", { name: "Active sessions" })).not.toBeNull();
    const sessionRows = rows();
    expect(sessionRows).toHaveLength(1);
    expect(within(sessionRows[0]).getByText("Current session")).not.toBeNull();
    expect(within(sessionRows[0]).getByText("Chrome on Linux")).not.toBeNull();
    expect(within(sessionRows[0]).getByText("Last active")).not.toBeNull();
    // The current session is not revocable and no session secret is shown.
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();
    expect(document.body.textContent).not.toContain(api.sessions[0].secret);
  });

  it("revokes the other browser session, keeps the current one and keeps the state after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo.session.owner.s2@evolution.test");
    api.openSession("evo-session-owner-s2", "Firefox on Windows");
    cleanup();
    render(<App />);
    await screen.findByRole("button", { name: "Account menu" });
    await openActiveSessions(user);

    expect(rows()).toHaveLength(2);
    const revokeButtons = screen.getAllByRole("button", { name: "Revoke session" });
    expect(revokeButtons).toHaveLength(1);
    await user.click(revokeButtons[0]);

    expect(await screen.findByText("Session revoked")).not.toBeNull();
    const revokedRow = rows().find((row) => within(row).queryByText("Inactive"));
    expect(revokedRow).toBeDefined();
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();
    expect(screen.getByText("Current session")).not.toBeNull();

    cleanup();
    render(<App />);
    await screen.findByRole("button", { name: "Account menu" });
    await openActiveSessions(user);
    expect(rows()).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByText("Inactive")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();
    expect(screen.getByText("Current session")).not.toBeNull();
  });

  it("sends a revoked browser back to the sign-in page while the other browser stays signed in", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo.session.owner.s3@evolution.test");
    const firstSecret = api.sessions[0].secret;
    const secondSecret = api.openSession("evo-session-owner-s3", "Firefox on Windows");

    // The second browser looks at the session list and revokes the first one.
    api.useSession(secondSecret);
    cleanup();
    render(<App />);
    await screen.findByRole("button", { name: "Account menu" });
    await openActiveSessions(user);
    await user.click(screen.getByRole("button", { name: "Revoke session" }));
    await screen.findByText("Session revoked");

    // The revoked browser can no longer open the protected workspace.
    api.useSession(firstSecret);
    cleanup();
    window.location.hash = "#/";
    render(<App />);
    expect(await screen.findByRole("button", { name: "Sign in" })).not.toBeNull();
    expect(screen.getByLabelText("Username or email")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();

    // The other browser still displays the account.
    api.useSession(secondSecret);
    cleanup();
    window.location.hash = "#/";
    render(<App />);
    expect(await screen.findByText("evo-session-owner-s3")).not.toBeNull();
  });

  it("keeps the sessions page behind the session", async () => {
    window.location.hash = "#/settings/sessions";
    render(<App />);

    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Active sessions" })).toBeNull();
  });
});
