import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function openActiveSessions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("link", { name: "Active sessions" }));
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
  it("lists the current session with its device and last-active information", async () => {
    const user = userEvent.setup();
    await signInAs(user, "evo-session-owner");
    await openActiveSessions(user);

    expect(screen.getByRole("heading", { name: "Active sessions" })).not.toBeNull();
    expect(screen.getByText("Current session")).not.toBeNull();
    const row = screen.getByText("Chrome on Linux").closest("li") as HTMLElement;
    expect(within(row).getByText("Last active")).not.toBeNull();
    expect(row.textContent).toMatch(/just now|ago/);
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();
    // No session secret or token is rendered anywhere on the page.
    expect(document.body.textContent ?? "").not.toMatch(/session-\d/);
  });

  it("revokes the other browser session and shows the updated list after a reload", async () => {
    const user = userEvent.setup();
    await signInAs(user, "evo-session-owner-s2");
    api.addSession("evo-session-owner-s2", "Firefox on Windows");
    await openActiveSessions(user);

    const otherRow = screen.getByText("Firefox on Windows").closest("li") as HTMLElement;
    await user.click(within(otherRow).getByRole("button", { name: "Revoke session" }));

    // The revoked row carries the single visible outcome of the revocation.
    expect(await screen.findByText("Session revoked")).not.toBeNull();
    expect(within(otherRow).getByText("Session revoked")).not.toBeNull();
    expect(screen.getAllByText("Session revoked")).toHaveLength(1);
    expect(screen.getByText("Current session")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();
    expect(api.sessionsFor("evo-session-owner-s2")).toEqual([
      { device: "Chrome on Linux", active: true },
      { device: "Firefox on Windows", active: false },
    ]);

    cleanup();
    render(<App />);
    await screen.findByRole("heading", { name: "Active sessions" });
    expect(screen.getByText("Chrome on Linux")).not.toBeNull();
    expect(screen.queryByText("Firefox on Windows")).toBeNull();
    expect(screen.queryByText("Session revoked")).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();
  });

  it("returns a revoked browser to the sign-in page instead of the workspace", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Username or email"), "evo-session-owner-s3");
    await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("button", { name: "Account menu" });

    // The other browser revoked this browser's session on the server.
    api.revokeCurrentSession();
    cleanup();
    window.location.hash = "#/settings/sessions";
    render(<App />);

    // The reload lands on the sign-in form, with the address following it.
    expect(await screen.findByLabelText("Username or email")).not.toBeNull();
    expect(screen.getByLabelText("Password")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeNull();
    expect(window.location.hash).toBe("#/sign-in");
    expect(screen.queryByRole("heading", { name: "Active sessions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();

    // The protected workspace stays out of reach for the revoked browser.
    act(() => navigate("/"));
    expect(await screen.findByLabelText("Username or email")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Workspace" })).toBeNull();
  });

  it("keeps the public signed-out entry for a browser that never signed in", async () => {
    window.location.hash = "#/settings/sessions";
    render(<App />);

    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Active sessions" })).toBeNull();
  });
});
