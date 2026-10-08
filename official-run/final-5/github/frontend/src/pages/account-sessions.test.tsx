import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

async function signInAs(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password = "Evo-Password-987!",
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

function bodyRows(): number {
  return screen.getByRole("table").querySelectorAll("tbody tr").length;
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

describe("REQ-1-4 manage active browser sessions", () => {
  it("lists the current session with its device label, last-active time and no secret", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-session-owner");
    await openActiveSessions(user);

    const table = screen.getByRole("table");
    expect(within(table).getByText("Chrome on Linux")).not.toBeNull();
    expect(within(table).getByText(/^Last active /)).not.toBeNull();
    expect(within(table).getByText("Current session")).not.toBeNull();
    // The current session never offers its own revoke control.
    expect(within(table).queryByRole("button", { name: "Revoke session" })).toBeNull();
    // No session secret or token is rendered.
    expect(within(table).queryByText(/token|secret/i)).toBeNull();
  });

  it("revokes another session and shows the updated list after reload", async () => {
    api.addSession("evo-session-owner-s2", "Firefox on Windows");
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-session-owner-s2");
    await openActiveSessions(user);

    expect(bodyRows()).toBe(2);
    const revokeButtons = screen.getAllByRole("button", { name: "Revoke session" });
    expect(revokeButtons).toHaveLength(1);

    await user.click(revokeButtons[0]);
    expect(await screen.findByText("Session revoked")).not.toBeNull();
    expect(bodyRows()).toBe(1);
    expect(screen.getByText("Current session")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();

    // Re-opening the sessions page (a reload) reads the persisted, updated list.
    cleanup();
    render(<App />);
    await screen.findByRole("heading", { name: "Active sessions" });
    expect(bodyRows()).toBe(1);
    expect(screen.getByText("Current session")).not.toBeNull();
  });
});
