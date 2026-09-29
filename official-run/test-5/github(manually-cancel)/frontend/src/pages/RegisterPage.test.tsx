import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedOutSession } from "../test/harness";

function valueOf(element: Element): string {
  return (element as HTMLInputElement).value;
}

async function openRegistrationForm() {
  const user = userEvent.setup();
  renderApp("#/login");
  await user.click(await screen.findByRole("link", { name: "Create an account" }));
  await screen.findByRole("heading", { name: "Create your account" });
  return user;
}

function newAccount() {
  return {
    id: "acc-pw-user-abc",
    username: "pw-user-abc",
    email: "pw-user-abc@example.test",
    emailVerified: true,
    status: "active",
  };
}

function isDisabled(element: Element): boolean {
  return (element as HTMLInputElement | HTMLButtonElement).disabled;
}

/**
 * Stubs fetch with a session lookup that answers and a registration call that
 * stays pending, so the in-flight state of the form can be observed.
 */
function installPendingRegistration() {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString(), "http://localhost")
      .pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && path === "/api/auth/session") {
      return Promise.resolve(
        new Response(JSON.stringify({ account: null, session: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", mock);
}

async function fillCompliantRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Username"), "pw-user-abc");
  await user.type(screen.getByLabelText("Email"), "pw-user-abc@example.test");
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
  await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
}

describe("registration page (REQ-1-1-1)", () => {
  beforeEach(() => {
    installFetch({ "GET /api/auth/session": () => signedOutSession() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is opened by the unique “Create an account” link from the sign-in page", async () => {
    renderApp("#/login");
    const link = await screen.findByRole("link", { name: "Create an account" });
    expect(link).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Create an account" })).toHaveLength(1);
    expect(screen.getByLabelText("Username or email")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the labelled fields, unchecked terms checkbox and enabled submit button", async () => {
    await openRegistrationForm();
    expect(screen.getByLabelText("Username")).not.toBeNull();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect(screen.getByLabelText("Password")).not.toBeNull();
    expect(screen.getByLabelText("Confirm password")).not.toBeNull();
    const terms = screen.getByRole("checkbox", { name: "Agree to the terms" }) as HTMLInputElement;
    expect(terms.checked).toBe(false);
    expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows username, email, password and terms messages together and keeps the safe input", async () => {
    const user = await openRegistrationForm();
    await user.type(screen.getByLabelText("Username"), "-invalid");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username format is invalid")).not.toBeNull();
    expect(screen.getByText("Email format is invalid")).not.toBeNull();
    expect(screen.getByText("Password requirements are not satisfied")).not.toBeNull();
    expect(screen.getByText("Agree to terms is required")).not.toBeNull();
    // Non-sensitive input is retained, passwords are never redisplayed.
    expect(valueOf(screen.getByLabelText("Username"))).toBe("-invalid");
    expect(valueOf(screen.getByLabelText("Email"))).toBe("not-an-email");
    expect(valueOf(screen.getByLabelText("Password"))).toBe("");
    expect(valueOf(screen.getByLabelText("Confirm password"))).toBe("");
    expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports a duplicate username beside that field and keeps both attempted values", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/register": () => ({
        status: 400,
        body: { error: "Registration failed", errors: { username: "Username already exists" } },
      }),
    });
    const user = await openRegistrationForm();
    await user.type(screen.getByLabelText("Username"), "alice-dev");
    await user.type(screen.getByLabelText("Email"), "fresh-address@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username already exists")).not.toBeNull();
    expect(valueOf(screen.getByLabelText("Username"))).toBe("alice-dev");
    expect(valueOf(screen.getByLabelText("Email"))).toBe("fresh-address@example.test");
    expect(valueOf(screen.getByLabelText("Password"))).toBe("");
  });

  it("opens the sign-in page after a successful registration without echoing the password", async () => {
    const requests: unknown[] = [];
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/register": (request) => {
        requests.push(request.body);
        return {
          status: 201,
          body: {
            account: {
              id: "acc-new",
              username: "pw-user-abc",
              email: "pw-user-abc@example.test",
              emailVerified: true,
              status: "active",
            },
          },
        };
      },
    });
    const user = await openRegistrationForm();
    await user.type(screen.getByLabelText("Username"), "pw-user-abc");
    await user.type(screen.getByLabelText("Email"), "pw-user-abc@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).not.toBeNull();
    expect(screen.getByText("Account created successfully")).not.toBeNull();
    expect(screen.getByLabelText("Username or email")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Valid-password-123!");
    expect(requests).toHaveLength(1);
    await waitFor(() => expect(window.location.hash).toBe("#/login?registered=1"));
  });

  it("keeps the whole form busy while the account is being created", async () => {
    installPendingRegistration();
    const user = await openRegistrationForm();
    await fillCompliantRegistration(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // No field of the hand-off to the sign-in page can be typed into again.
    expect(isDisabled(screen.getByLabelText("Username"))).toBe(true);
    expect(isDisabled(screen.getByLabelText("Email"))).toBe(true);
    expect(isDisabled(screen.getByLabelText("Password"))).toBe(true);
    expect(isDisabled(screen.getByLabelText("Confirm password"))).toBe(true);
    expect(isDisabled(screen.getByRole("checkbox", { name: "Agree to the terms" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Create account" }))).toBe(true);
    expect(screen.getByRole("heading", { name: "Create your account" })).not.toBeNull();
  });

  it("re-enables the form and keeps the safe input when the server rejects the account", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/register": () => ({
        status: 400,
        body: { error: "Registration failed", errors: { username: "Username already exists" } },
      }),
    });
    const user = await openRegistrationForm();
    await fillCompliantRegistration(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username already exists")).not.toBeNull();
    expect(isDisabled(screen.getByLabelText("Username"))).toBe(false);
    expect(isDisabled(screen.getByRole("button", { name: "Create account" }))).toBe(false);
    expect(valueOf(screen.getByLabelText("Username"))).toBe("pw-user-abc");
    expect(valueOf(screen.getByLabelText("Email"))).toBe("pw-user-abc@example.test");
  });

  it("signs the new account in from the sign-in page that follows the registration", async () => {
    const credentials: unknown[] = [];
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/register": () => ({ status: 201, body: { account: newAccount() } }),
      "POST /api/auth/sign-in": (request) => {
        credentials.push(request.body);
        return {
          status: 200,
          body: { account: newAccount(), session: { id: "session-2", active: true } },
        };
      },
    });
    const user = await openRegistrationForm();
    await fillCompliantRegistration(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // The sign-in page carries the account that was just created.
    const identifier = (await screen.findByLabelText("Username or email")) as HTMLInputElement;
    expect(identifier.value).toBe("pw-user-abc");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Workspace" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Account menu" }).textContent).toContain(
      "pw-user-abc",
    );
    expect(credentials).toEqual([{ identifier: "pw-user-abc", password: "Valid-password-123!" }]);
  });

  it("does not echo the password into the sign-in page that follows the registration", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/register": () => ({ status: 201, body: { account: newAccount() } }),
    });
    const user = await openRegistrationForm();
    await fillCompliantRegistration(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).not.toBeNull();
    expect(document.body.textContent).not.toContain("Valid-password-123!");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
  });

  it("keeps the form on the page when the server rejects a duplicate email", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/register": () => ({
        status: 400,
        body: { error: "Registration failed", errors: { email: "Email already exists" } },
      }),
    });
    const user = await openRegistrationForm();
    await user.type(screen.getByLabelText("Username"), "fresh-name");
    await user.type(screen.getByLabelText("Email"), "alice.dev@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Email already exists")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Create your account" })).not.toBeNull();
    expect(window.location.hash).toBe("#/signup");
  });
});
