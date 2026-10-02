import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installSyncXhr } from "../../test/sync-xhr";

interface MockAccount {
  id: string;
  username: string;
  email: string;
  password: string;
}

const alice: MockAccount = {
  id: "account-alice-dev",
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

let signedIn: MockAccount | null = null;
let accounts: MockAccount[] = [];
let registrationResponse: { status: number; body: unknown } = { status: 201, body: { account: {} } };
const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  const all: Record<string, string> = { "content-type": "application/json", ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => all[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function publicUser(account: MockAccount | null) {
  if (!account) return null;
  return { username: account.username, email: account.email, organizations: [] };
}

interface SimulatedResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** Single source of truth for the in-memory backend, shared by fetch and XHR. */
function simulate(method: string, path: string, body: Record<string, unknown>): SimulatedResponse {
  requests.push({ method, path, body });

  if (path === "/api/session" && method === "GET") {
    return { status: 200, body: { user: publicUser(signedIn) } };
  }
  if (path === "/api/session" && method === "DELETE") {
    signedIn = null;
    return { status: 200, body: { ok: true }, headers: { "set-cookie": "sid=; Max-Age=0" } };
  }
  if (path === "/api/accounts" && method === "POST") {
    return { status: registrationResponse.status, body: registrationResponse.body };
  }
  if (path === "/api/sessions" && method === "POST") {
    const account = accounts.find(
      (candidate) =>
        (candidate.username === body.identifier || candidate.email === body.identifier)
        && candidate.password === body.password,
    );
    if (!account) return { status: 401, body: { error: "Invalid credentials" } };
    signedIn = account;
    return { status: 200, body: { user: publicUser(account) } };
  }
  return { status: 404, body: { error: "Not found" } };
}

function installFetchMock() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const result = simulate(method, path, body);
    return makeResponse(result.status, result.body, result.headers);
  }) as unknown as typeof fetch;
  // Sign-in uses the blocking transport (postJsonSync).
  installSyncXhr((method, path, body) => simulate(method, path, body));
}

beforeEach(() => {
  signedIn = null;
  accounts = [alice];
  requests.length = 0;
  registrationResponse = {
    status: 201,
    body: { account: { username: "pw-user-1", email: "pw-user-1@example.test" } },
  };
  window.location.hash = "#/";
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function inputValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

function dialogElement(): HTMLDialogElement {
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("sign-out dialog is not rendered");
  return dialog;
}

describe("home page account-access entries (REQ-1)", () => {
  it("offers Sign up, Sign in and Forgot password", async () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "Sign up" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot password" })).toBeTruthy();
    await waitFor(() => expect(requests.some((entry) => entry.path === "/api/session")).toBe(true));
  });
});

describe("REQ-1-1-1 registration form", () => {
  beforeEach(() => {
    window.location.hash = "#/register";
  });

  it("shows itemized field errors together, keeps username/email and clears passwords", async () => {
    registrationResponse = {
      status: 400,
      body: {
        error: "Registration failed",
        fields: {
          username: "Username format is invalid",
          email: "Email format is invalid",
          password: "Password requirements are not satisfied",
          confirmPassword: "Passwords do not match",
          terms: "Agree to terms is required",
        },
      },
    };
    const user = userEvent.setup();
    render(<App />);

    const username = await screen.findByLabelText("Username");
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    const confirmation = screen.getByLabelText("Confirm password");
    const terms = screen.getByLabelText("Agree to the terms") as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement;

    expect(terms.checked).toBe(false);
    expect(submit.disabled).toBe(false);

    await user.type(username, "-bad-name");
    await user.type(email, "not-an-email");
    await user.type(password, "short");
    await user.type(confirmation, "different");
    await user.click(submit);

    expect(await screen.findByText("Username format is invalid")).toBeTruthy();
    expect(screen.getByText("Email format is invalid")).toBeTruthy();
    expect(screen.getByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.getByText("Agree to terms is required")).toBeTruthy();

    expect(inputValue("Username")).toBe("-bad-name");
    expect(inputValue("Email")).toBe("not-an-email");
    expect(inputValue("Password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
    expect(window.location.hash).toBe("#/register");
    expect(submit.disabled).toBe(false);
  });

  it("opens the sign-in page after a successful registration", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Username"), "pw-user-new");
    await user.type(screen.getByLabelText("Email"), "pw-user-1@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByLabelText("Agree to the terms"));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create an account" })).toBeTruthy();
    expect(window.location.hash.startsWith("#/sign-in")).toBe(true);
    // The success status names the account that was just created.
    expect(screen.getByRole("status").textContent).toContain("pw-user-new");
    expect(screen.queryByText("Valid-password-123!")).toBeNull();

    // After a reload of the destination the created account is still named and
    // the sign-in form is immediately usable.
    cleanup();
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });
    expect(screen.getByRole("status").textContent).toContain("pw-user-new");
    const registration = requests.find((entry) => entry.path === "/api/accounts");
    expect(registration?.body).toMatchObject({
      username: "pw-user-new",
      email: "pw-user-1@example.test",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    });
  });

  it("stays on the form when the terms are not accepted", async () => {
    registrationResponse = {
      status: 400,
      body: { error: "Registration failed", fields: { terms: "Agree to terms is required" } },
    };
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Username"), "pw-user-terms");
    await user.type(screen.getByLabelText("Email"), "pw-user-terms@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Agree to terms is required")).toBeTruthy();
    expect(inputValue("Password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
    expect(inputValue("Username")).toBe("pw-user-terms");
    expect(inputValue("Email")).toBe("pw-user-terms@example.test");
    expect(window.location.hash).toBe("#/register");
  });
});

describe("REQ-1-1-2 sign in", () => {
  it("shows Invalid credentials and keeps the visitor unauthenticated", async () => {
    window.location.hash = "#/sign-in";
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "wrong-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid credentials")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(window.location.hash).toBe("#/sign-in");
  });

  it("keeps the account menu on the account-access page for a signed-in user", async () => {
    signedIn = alice;
    window.location.hash = "#/sign-in";
    render(<App />);

    const accountMenu = await screen.findByRole("button", { name: "Account menu" });
    expect(accountMenu.textContent).toContain("alice-dev");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("opens the workspace with the account menu after sign in", async () => {
    window.location.hash = "#/sign-in";
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Username or email"), "alice.dev@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const accountMenu = await screen.findByRole("button", { name: "Account menu" });
    expect(accountMenu.textContent).toContain("alice-dev");
    await waitFor(() => expect(window.location.hash).toBe("#/workspace"));
    expect(screen.getByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
  });
});

describe("REQ-1-2 sign out", () => {
  beforeEach(() => {
    signedIn = alice;
    window.location.hash = "#/workspace";
  });

  it("keeps the session when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));

    const dialog = dialogElement();
    expect(dialog.open).toBe(true);
    const dialogView = within(screen.getByRole("dialog", { name: "Sign out" }));
    const buttons = dialogView.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Confirm sign out"]);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog.open).toBe(false);
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    expect(requests.some((entry) => entry.method === "DELETE")).toBe(false);
  });

  it("ends the session after confirming and shows the Sign in link", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(screen.getByRole("button", { name: "Confirm sign out" }));

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    });
    expect(screen.getByText("You need to sign in to view the workspace.")).toBeTruthy();
    expect(window.location.hash).toBe("#/workspace");
    expect(requests.some((entry) => entry.method === "DELETE" && entry.path === "/api/session")).toBe(true);
  });
});
