import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedInSession } from "../test/harness";

function installSignedInApp(overrides: Record<string, () => { status: number; body: unknown }> = {}) {
  return installFetch({
    "GET /api/auth/session": () => signedInSession("alice-dev", "alice.dev@example.test"),
    "POST /api/auth/sign-out": () => ({ status: 200, body: { ok: true } }),
    ...overrides,
  });
}

describe("account menu and sign-out (REQ-1-2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers exactly one account menu button whose menu holds the sign-out link", async () => {
    installSignedInApp();
    const user = userEvent.setup();
    renderApp("#/");
    const trigger = await screen.findByRole("button", { name: "Account menu" });
    expect(screen.getAllByRole("button", { name: "Account menu" })).toHaveLength(1);
    // The trigger shows the signed-in account and nothing else, so the account is
    // identifiable from the control's own text (no avatar initial or decoration).
    expect(trigger.textContent).toBe("alice-dev");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("link", { name: "Sign out" })).toHaveLength(1);
  });

  it("keeps the session when the confirmation dialog is cancelled", async () => {
    const fetchMock = installSignedInApp();
    const user = userEvent.setup();
    renderApp("#/settings");
    expect(await screen.findByRole("heading", { name: "Settings" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    expect(dialog.textContent).toContain("current browser session");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Account menu" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("sign-out"))).toBe(false);
  });

  it("invalidates the session only after “Confirm sign out” and restores an unauthenticated state", async () => {
    const fetchMock = installSignedInApp();
    const user = userEvent.setup();
    renderApp("#/settings");
    await screen.findByRole("heading", { name: "Settings" });

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    expect(await screen.findByRole("dialog", { name: "Sign out" })).not.toBeNull();
    expect((screen.getByRole("button", { name: "Confirm sign out" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm sign out" }));

    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.hash).toBe("#/");
    const signOutCall = fetchMock.mock.calls.find(([input]) => String(input).includes("sign-out"));
    expect(signOutCall).toBeDefined();
    expect((signOutCall?.[1] as RequestInit | undefined)?.method).toBe("POST");
  });

  it("requires authentication again on a protected page after signing out", async () => {
    let signedIn = true;
    installFetch({
      "GET /api/auth/session": () =>
        signedIn
          ? signedInSession("alice-dev", "alice.dev@example.test")
          : { status: 200, body: { account: null, session: null } },
      "POST /api/auth/sign-out": () => {
        signedIn = false;
        return { status: 200, body: { ok: true } };
      },
    });
    const user = userEvent.setup();
    renderApp("#/settings");
    await screen.findByRole("heading", { name: "Settings" });
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(await screen.findByRole("button", { name: "Confirm sign out" }));
    await screen.findByRole("link", { name: "Sign in" });

    // Directly reopening the protected page cannot restore the signed-out session.
    window.location.hash = "#/settings";
    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });
});
