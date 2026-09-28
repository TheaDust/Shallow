import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchHandler = (path: string, init: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: FetchHandler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : new URL(String(input)).pathname;
      return handler(path, init ?? {});
    }),
  );
}

function anonymousSession() {
  return () => jsonResponse(401, { error: "Unauthenticated" });
}

beforeEach(() => {
  window.location.hash = "#/";
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("REQ-1-1-1 registration", () => {
  it("renders the exact registration controls", async () => {
    stubFetch(anonymousSession());
    window.location.hash = "#/signup";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign up" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Username" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Agree to the terms" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Agree to the terms" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  });

  it("shows username, email, password and terms errors together and retains non-sensitive input", async () => {
    stubFetch((path, init) => {
      if (path === "/api/sessions/current") return jsonResponse(401, { error: "Unauthenticated" });
      if (path === "/api/accounts/register") {
        return jsonResponse(400, {
          errors: {
            username: "Username format is invalid",
            email: "Email format is invalid",
            password: "Password requirements are not satisfied",
            confirmPassword: "Password confirmation does not match",
            terms: "Agree to terms is required",
          },
        });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/signup";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sign up" });

    await user.type(screen.getByRole("textbox", { name: "Username" }), "-leading");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username format is invalid")).toBeTruthy();
    expect(screen.getByText("Email format is invalid")).toBeTruthy();
    expect(screen.getByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.getByText("Agree to terms is required")).toBeTruthy();
    expect(screen.getByText("Password confirmation does not match")).toBeTruthy();

    const username = screen.getByRole("textbox", { name: "Username" }) as HTMLInputElement;
    const email = screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement;
    expect(username.value).toBe("-leading");
    expect(email.value).toBe("not-an-email");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
    expect(window.location.hash).toBe("#/signup");
  });

  it("accepts a unique account and makes the sign-in form available immediately", async () => {
    stubFetch((path) => {
      if (path === "/api/sessions/current") return jsonResponse(401, { error: "Unauthenticated" });
      if (path === "/api/accounts/register") return jsonResponse(201, { ok: true });
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/signup";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sign up" });

    await user.type(screen.getByRole("textbox", { name: "Username" }), "pw-user-1");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "pw-user-1@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(await screen.findByText("Registration successful")).toBeTruthy();
  });

  it("retains the duplicate username and shows the conflict message", async () => {
    stubFetch((path) => {
      if (path === "/api/sessions/current") return jsonResponse(401, { error: "Unauthenticated" });
      if (path === "/api/accounts/register") {
        return jsonResponse(400, { errors: { username: "Username already exists" } });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/signup";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sign up" });

    await user.type(screen.getByRole("textbox", { name: "Username" }), "alice-dev");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "fresh@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username already exists")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Username" }) as HTMLInputElement).value).toBe("alice-dev");
    expect((screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement).value).toBe("fresh@example.test");
  });
});

describe("REQ-1-1-2 sign in", () => {
  it("shows the generic Invalid credentials message and stays on the sign-in page", async () => {
    stubFetch((path) => {
      if (path === "/api/sessions/current") return jsonResponse(401, { error: "Unauthenticated" });
      if (path === "/api/sessions") return jsonResponse(401, { error: "Invalid credentials" });
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/signin";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sign in" });

    await user.type(screen.getByRole("textbox", { name: "Username or email" }), "unknown-user");
    await user.type(screen.getByLabelText("Password"), "Wrong-password-1!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid credentials")).toBeTruthy();
    expect(window.location.hash).toBe("#/signin");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("textbox", { name: "Username or email" }) as HTMLInputElement).value).toBe("unknown-user");
  });

  it("enters the workspace, shows the account menu, and stays signed in after reload", async () => {
    stubFetch((path, init) => {
      if (path === "/api/sessions/current") {
        if (!init.method || init.method === "GET") return jsonResponse(401, { error: "Unauthenticated" });
      }
      if (path === "/api/sessions") {
        return jsonResponse(201, { account: { username: "alice-dev", email: "alice.dev@example.test" } });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/signin";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sign in" });

    await user.type(screen.getByRole("textbox", { name: "Username or email" }), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    // The signed-in user is exposed as an avatar button and an identity link,
    // both named with the username.
    expect(screen.getByRole("button", { name: "alice-dev" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "alice-dev" })).toBeTruthy();
    cleanup();

    // Refresh: a fresh mount reads the persisted server session.
    stubFetch((path) => {
      if (path === "/api/sessions/current") {
        return jsonResponse(200, { account: { username: "alice-dev", email: "alice.dev@example.test" } });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Workspace" })).toBeTruthy();
    const menu = screen.getByRole("button", { name: "Account menu" });
    await user.click(menu);
    expect(await screen.findByTestId("account-menu-panel")).toBeTruthy();
    expect(screen.getByTestId("account-menu-account").textContent).toBe("alice-dev");
    expect(screen.getByRole("link", { name: "Sign out" })).toBeTruthy();
  });

  it("the username avatar button opens the same account menu and the identity link opens Your organizations", async () => {
    stubFetch((path, init) => {
      if (path === "/api/sessions/current") {
        if (!init.method || init.method === "GET") return jsonResponse(200, { account: { username: "alice-dev", email: "alice.dev@example.test" } });
      }
      if (path === "/api/orgs") {
        return jsonResponse(200, { organizations: [] });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });

    await user.click(screen.getByRole("button", { name: "alice-dev" }));
    expect(await screen.findByTestId("account-menu-panel")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Your organizations" }));
    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();

    // The identity link on the workspace navigates to Your organizations.
    window.location.hash = "#/";
    await screen.findByRole("heading", { name: "Workspace" });
    await user.click(screen.getByRole("link", { name: "alice-dev" }));
    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();
  });
});

describe("REQ-1-2 sign out", () => {
  async function renderSignedIn(handler: FetchHandler) {
    stubFetch(handler);
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });
    return userEvent.setup();
  }

  it("Cancel keeps the session and the original page; Confirm signs out and shows the Sign in link", async () => {
    const user = await renderSignedIn((path, init) => {
      if (path === "/api/sessions/current") {
        if (init.method === "DELETE") return jsonResponse(200, { ok: true });
        return jsonResponse(200, { account: { username: "alice-dev", email: "alice.dev@example.test" } });
      }
      return jsonResponse(404, { error: "Not found" });
    });

    // Cancel path: session stays valid.
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    expect(dialog.textContent).toContain("Signing out affects only the current browser session.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Sign out" })).toBeNull();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();

    // Confirm path: session invalidated, unauthenticated home shown.
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Sign out" }));
    await screen.findByRole("dialog", { name: "Sign out" });
    await user.click(screen.getByRole("button", { name: "Confirm sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    await waitFor(() => expect(window.location.hash).toBe("#/"));
  });
});

describe("REQ-1-1-3 recovery groundwork", () => {
  it("displays the fixed code 123456 and updates the password on a correct reset", async () => {
    stubFetch((path, init) => {
      if (path === "/api/sessions/current") return jsonResponse(401, { error: "Unauthenticated" });
      if (path === "/api/recovery/request") {
        return jsonResponse(200, { token: "rec_1", code: "123456" });
      }
      if (path === "/api/recovery/reset") return jsonResponse(200, { ok: true });
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/recover";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Forgot password" });

    await user.type(screen.getByRole("textbox", { name: "Email" }), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByTestId("recovery-code")).toBeTruthy();
    expect(screen.getByTestId("recovery-code").textContent).toBe("123456");
    expect(screen.getByRole("textbox", { name: "Verification code" })).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Verification code" }), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
  });

  it("shows the invalid-code reason and keeps the form", async () => {
    stubFetch((path) => {
      if (path === "/api/sessions/current") return jsonResponse(401, { error: "Unauthenticated" });
      if (path === "/api/recovery/request") {
        return jsonResponse(200, { token: "rec_1", code: "123456" });
      }
      if (path === "/api/recovery/reset") {
        return jsonResponse(400, { errors: { code: "Verification code is invalid" } });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/recover";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Forgot password" });
    await user.type(screen.getByRole("textbox", { name: "Email" }), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByTestId("recovery-code");

    await user.type(screen.getByRole("textbox", { name: "Verification code" }), "000000");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Verification code is invalid")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("an unknown email enters the same next step but reset is rejected without modification", async () => {
    stubFetch((path) => {
      if (path === "/api/sessions/current") return jsonResponse(401, { error: "Unauthenticated" });
      if (path === "/api/recovery/request") {
        return jsonResponse(200, { token: "rec_ghost", code: "123456" });
      }
      if (path === "/api/recovery/reset") {
        return jsonResponse(400, { errors: { email: "Email is not registered" } });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/recover";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Forgot password" });

    // Unknown email still reaches the same next step with the fixed code.
    await user.type(screen.getByRole("textbox", { name: "Email" }), "ghost@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByTestId("recovery-code")).toBeTruthy();
    expect(screen.getByTestId("recovery-code").textContent).toBe("123456");

    await user.type(screen.getByRole("textbox", { name: "Verification code" }), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Email is not registered")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
  });
});

describe("REQ-1-3 change account password", () => {
  it("enters Settings from the account menu and renders the Password and authentication form", async () => {
    stubFetch((path) => {
      if (path === "/api/sessions/current") {
        return jsonResponse(200, { account: { username: "alice-dev", email: "alice.dev@example.test" } });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Password and authentication" })).toBeTruthy();
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();
    expect(window.location.hash).toBe("#/settings");
  });

  it("empty current password shows the required message and leaves credentials usable", async () => {
    stubFetch((path, init) => {
      if (path === "/api/sessions/current") {
        return jsonResponse(200, { account: { username: "alice-dev", email: "alice.dev@example.test" } });
      }
      if (path === "/api/accounts/password" && init.method === "POST") {
        return jsonResponse(400, { errors: { currentPassword: "Current password is required" } });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/settings";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Password and authentication" });

    await user.type(screen.getByLabelText("New password"), "Required-password-789!");
    await user.type(screen.getByLabelText("Confirm password"), "Required-password-789!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is required")).toBeTruthy();
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("incorrect current password and mismatched confirmation show both reasons and keep the old password", async () => {
    stubFetch((path, init) => {
      if (path === "/api/sessions/current") {
        return jsonResponse(200, { account: { username: "alice-dev", email: "alice.dev@example.test" } });
      }
      if (path === "/api/accounts/password" && init.method === "POST") {
        return jsonResponse(400, {
          errors: {
            currentPassword: "Current password is incorrect",
            confirmPassword: "Password confirmation does not match",
          },
        });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/settings";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Password and authentication" });

    await user.type(screen.getByLabelText("Current password"), "Wrong-password-1!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
    expect(screen.getByText("Password confirmation does not match")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("successful update displays Password updated", async () => {
    stubFetch((path, init) => {
      if (path === "/api/sessions/current") {
        return jsonResponse(200, { account: { username: "alice-dev", email: "alice.dev@example.test" } });
      }
      if (path === "/api/accounts/password" && init.method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(404, { error: "Not found" });
    });
    window.location.hash = "#/settings";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Password and authentication" });

    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
  });
});
