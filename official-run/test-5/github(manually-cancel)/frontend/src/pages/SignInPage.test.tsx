import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedOutSession } from "../test/harness";

function valueOf(element: Element): string {
  return (element as HTMLInputElement).value;
}

describe("sign-in page (REQ-1-1-2)", () => {
  beforeEach(() => {
    installFetch({ "GET /api/auth/session": () => signedOutSession() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the shared account-access form with labelled fields and “Create an account”", async () => {
    renderApp("#/login");
    expect(await screen.findByLabelText("Username or email")).not.toBeNull();
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("#/signup");
  });

  it("shows the generic failure message without creating a session", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/sign-in": () => ({ status: 401, body: { error: "Invalid credentials" } }),
    });
    const user = userEvent.setup();
    renderApp("#/login");
    await user.type(await screen.findByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "wrong-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
    // The identifier is retained, the password is not redisplayed.
    expect(valueOf(screen.getByLabelText("Username or email"))).toBe("alice-dev");
    expect(valueOf(screen.getByLabelText("Password"))).toBe("");
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(window.location.hash).toBe("#/login");
  });

  it("signs in with a valid account and shows the account menu with the username", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/sign-in": () => ({
        status: 200,
        body: {
          account: {
            id: "acc-alice-dev",
            username: "alice-dev",
            email: "alice.dev@example.test",
            emailVerified: true,
            status: "active",
          },
          session: { id: "session-1", active: true },
        },
      }),
    });
    const user = userEvent.setup();
    renderApp("#/login");
    await user.type(await screen.findByLabelText("Username or email"), "alice.dev@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const menu = await screen.findByRole("button", { name: "Account menu" });
    expect(menu.textContent).toContain("alice-dev");
    expect(await screen.findByRole("heading", { name: "Workspace" })).not.toBeNull();
  });
});
