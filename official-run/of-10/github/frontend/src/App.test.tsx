import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

type Handler = (url: string, init: RequestInit) => FakeResponse | Promise<FakeResponse>;

function installFetch(handler: Handler) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    return handler(url, init ?? {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ANONYMOUS: Handler = async (url) =>
  url === "/api/session" ? jsonResponse(200, { account: null }) : jsonResponse(404, { error: "Not found" });

function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account access navigation", () => {
  it("home page exposes the guest entries and no account menu", async () => {
    installFetch(ANONYMOUS);
    open("#/");

    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe("#/signin");
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("#/signup");
    expect(screen.getByRole("link", { name: "Forgot password" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();

    await userEvent.setup().click(signIn);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});

describe("registration", () => {
  it("renders one labeled field per documented control", async () => {
    installFetch(ANONYMOUS);
    open("#/signup");

    const username = (await screen.findByLabelText("Username")) as HTMLInputElement;
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    const confirmation = screen.getByLabelText("Confirm password") as HTMLInputElement;
    const terms = screen.getByRole("checkbox", { name: "Agree to the terms" }) as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement;

    expect(username.type).toBe("text");
    expect(email.type).toBe("email");
    expect(password.type).toBe("password");
    expect(confirmation.type).toBe("password");
    expect(terms.checked).toBe(false);
    expect(submit.disabled).toBe(false);
    expect(screen.getAllByRole("textbox", { name: "Username" })).toHaveLength(1);
    expect(screen.getAllByRole("textbox", { name: "Email" })).toHaveLength(1);
  });

  it("shows every field message together and never echoes the submitted passwords", async () => {
    const seen: Array<Record<string, unknown>> = [];
    installFetch(async (url, init) => {
      if (url === "/api/accounts") {
        seen.push(JSON.parse(String(init.body)));
        return jsonResponse(400, {
          error: "Registration failed",
          fields: {
            username: "Username format is invalid",
            email: "Email format is invalid",
            password: "Password requirements are not satisfied",
            confirmPassword: "Passwords do not match",
            terms: "Agree to terms is required",
          },
        });
      }
      return jsonResponse(200, { account: null });
    });
    open("#/signup");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "-bad");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await screen.findByText("Username format is invalid");
    expect(screen.getByText("Email format is invalid")).toBeTruthy();
    expect(screen.getByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    expect(screen.getByText("Agree to terms is required")).toBeTruthy();

    expect(seen).toEqual([
      {
        username: "-bad",
        email: "not-an-email",
        password: "short",
        confirmPassword: "different",
        termsAccepted: false,
      },
    ]);

    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("-bad");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("not-an-email");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent).not.toContain("different");
  });

  it("enters the sign-in page after a successful registration", async () => {
    installFetch(async (url, init) => {
      if (url === "/api/accounts") {
        expect(JSON.parse(String(init.body))).toEqual({
          username: "pw-user-777",
          email: "pw-user-777@example.test",
          password: "Valid-password-123!",
          confirmPassword: "Valid-password-123!",
          termsAccepted: true,
        });
        return jsonResponse(201, {
          account: {
            id: "account-new",
            username: "pw-user-777",
            email: "pw-user-777@example.test",
            emailVerified: true,
          },
        });
      }
      return jsonResponse(200, { account: null });
    });
    open("#/signup");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "pw-user-777");
    await user.type(screen.getByLabelText("Email"), "pw-user-777@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Registration successful");
    expect(document.body.textContent).not.toContain("Valid-password-123!");
  });
});

describe("sign in", () => {
  it("keeps a password typed while a failed sign-in is still in flight", async () => {
    const attempts: string[] = [];
    let releaseFirstAttempt: (() => void) | undefined;
    installFetch(async (url, init) => {
      if (url === "/api/sessions") {
        attempts.push((JSON.parse(String(init.body)) as { password: string }).password);
        if (attempts.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstAttempt = resolve;
          });
          return jsonResponse(401, { error: "Invalid credentials" });
        }
        return jsonResponse(200, {
          account: { id: "account-alice-dev", username: "alice-dev", email: "alice.dev@example.test", emailVerified: true },
        });
      }
      return jsonResponse(200, { account: null });
    });
    open("#/signin");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username or email"), "alice.dev@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(attempts).toHaveLength(1));

    // The visitor retypes the password before the failing answer arrives.
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    releaseFirstAttempt?.();

    await screen.findByRole("alert");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("Valid-password-123!");

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(attempts).toEqual(["wrong-password-123!", "Valid-password-123!"]),
    );
    expect(await screen.findByRole("button", { name: "Account menu" })).toBeTruthy();
  });

  it("shows the generic failure message and keeps the visitor signed out", async () => {
    installFetch(async (url) => {
      if (url === "/api/sessions") return jsonResponse(401, { error: "Invalid credentials" });
      return jsonResponse(200, { account: null });
    });
    open("#/signin");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username or email"), "alice.dev@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Invalid credentials");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("stores the session, shows the account menu and stays signed in after a reload", async () => {
    installFetch(async (url) => {
      if (url === "/api/sessions") {
        return jsonResponse(200, {
          account: {
            id: "account-alice-dev",
            username: "alice-dev",
            email: "alice.dev@example.test",
            emailVerified: true,
          },
        });
      }
      if (url === "/api/session") {
        return jsonResponse(200, {
          account: {
            id: "account-alice-dev",
            username: "alice-dev",
            email: "alice.dev@example.test",
            emailVerified: true,
          },
        });
      }
      return jsonResponse(404, { error: "Not found" });
    });

    open("#/signin");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const accountMenu = await screen.findByRole("button", { name: "Account menu" });
    expect(accountMenu).toBeTruthy();
    // The signed-in account is the only element carrying the username text.
    expect(screen.getByRole("link", { name: "alice-dev" })).toBeTruthy();
    expect(screen.getAllByText("alice-dev")).toHaveLength(1);

    // A fresh mount (page reload) reads the session from the server again.
    cleanup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(await screen.findByRole("link", { name: "Sign out" })).toBeTruthy();
  });

  it("ends the session from the account menu", async () => {
    let signedIn = true;
    installFetch(async (url, init) => {
      if (url === "/api/session") {
        return jsonResponse(200, {
          account: signedIn
            ? { id: "account-alice-dev", username: "alice-dev", email: "alice.dev@example.test", emailVerified: true }
            : null,
        });
      }
      if (url === "/api/sessions/current" && init.method === "DELETE") {
        signedIn = false;
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(404, { error: "Not found" });
    });

    open("#/workspace");
    const user = userEvent.setup();
    // The username link in the account control opens the same menu entries.
    await user.click(await screen.findByRole("link", { name: "alice-dev" }));
    await user.click(await screen.findByRole("link", { name: "Sign out" }));
    await user.click(await screen.findByRole("button", { name: "Confirm sign out" }));

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull());
  });
});
