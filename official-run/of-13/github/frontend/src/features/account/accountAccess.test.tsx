import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";

const SEED_ACCOUNT = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function inputValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-1-1-1 registration", () => {
  it("opens the registration form from the sign-in page with the required controls", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    renderApp("#/login");

    await user.click(await screen.findByRole("link", { name: "Create an account" }));

    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByRole("checkbox", { name: "Agree to the terms" }) as HTMLInputElement).checked).toBe(
      false,
    );
    const submit = screen.getByRole("button", { name: "Create account" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows every invalid-field message at once and keeps username and email", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] }).setRegisterResponse(400, {
      error: "Registration failed",
      fieldErrors: {
        username: "Username format is invalid",
        email: "Email format is invalid",
        password: "Password requirements are not satisfied",
        agreeToTerms: "Agree to terms is required",
      },
    });
    const user = userEvent.setup();
    renderApp("#/signup");

    await user.type(await screen.findByLabelText("Username"), "-lead");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username format is invalid")).toBeTruthy();
    expect(screen.getByText("Email format is invalid")).toBeTruthy();
    expect(screen.getByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.getByText("Agree to terms is required")).toBeTruthy();
    expect(inputValue("Username")).toBe("-lead");
    expect(inputValue("Email")).toBe("not-an-email");
    expect(inputValue("Password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
    expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("reports a duplicate username beside the field and retains both values", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] }).setRegisterResponse(400, {
      error: "Registration failed",
      fieldErrors: { username: "Username already exists" },
    });
    const user = userEvent.setup();
    renderApp("#/signup");

    await user.type(await screen.findByLabelText("Username"), SEED_ACCOUNT.username);
    await user.type(screen.getByLabelText("Email"), "someone-else@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username already exists")).toBeTruthy();
    expect(inputValue("Username")).toBe(SEED_ACCOUNT.username);
    expect(inputValue("Email")).toBe("someone-else@example.test");
  });

  it("creates an account, enters the sign-in page and signs in with the new credentials", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    renderApp("#/signup");

    const password = "Fresh-password-321!";
    await user.type(await screen.findByLabelText("Username"), "pw-user-9");
    await user.type(screen.getByLabelText("Email"), "pw-user-9@example.test");
    await user.type(screen.getByLabelText("Password"), password);
    await user.type(screen.getByLabelText("Confirm password"), password);
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Account created successfully.")).toBeTruthy();
    expect(screen.getByLabelText("Username or email")).toBeTruthy();
    expect(document.body.textContent).not.toContain(password);

    await user.type(screen.getByLabelText("Username or email"), "pw-user-9@example.test");
    await user.type(screen.getByLabelText("Password"), password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
  });
});

describe("REQ-1-1-2 sign in", () => {
  it("offers the account-access entries from the home page", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    renderApp("#/");

    expect(await screen.findByRole("link", { name: "Sign up" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot password" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Sign in" }));

    expect(await screen.findByLabelText("Username or email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("shows one generic failure for a wrong credential and keeps the identifier", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    renderApp("#/login");

    await user.type(await screen.findByLabelText("Username or email"), "nobody-here");
    await user.type(screen.getByLabelText("Password"), "Wrong-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid credentials")).toBeTruthy();
    expect(inputValue("Username or email")).toBe("nobody-here");
    expect(inputValue("Password")).toBe("");
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("signs in and keeps the session, account menu and username after reopening the workspace", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    renderApp("#/login");

    await user.type(await screen.findByLabelText("Username or email"), SEED_ACCOUNT.email);
    await user.type(screen.getByLabelText("Password"), SEED_ACCOUNT.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Workspace" })).toBeTruthy();
    const menu = screen.getByRole("button", { name: "Account menu" });
    expect(menu.textContent).toContain(SEED_ACCOUNT.username);

    cleanup();
    renderApp("#/dashboard");

    const reopenedMenu = await screen.findByRole("button", { name: "Account menu" });
    expect(reopenedMenu.textContent).toContain(SEED_ACCOUNT.username);
    expect(await screen.findByRole("heading", { name: "Workspace" })).toBeTruthy();
  });

  it("keeps protected pages unauthenticated without a session", async () => {
    installAuthStub({ accounts: [SEED_ACCOUNT] });
    renderApp("#/dashboard");

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    // The protected page restores the unauthenticated state with the sign-in entry.
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  it("sends the identifier and password to the session endpoint", async () => {
    const stub = installAuthStub({ accounts: [SEED_ACCOUNT] });
    const user = userEvent.setup();
    renderApp("#/login");

    await user.type(await screen.findByLabelText("Username or email"), SEED_ACCOUNT.username);
    await user.type(screen.getByLabelText("Password"), SEED_ACCOUNT.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Workspace" });

    const signInCall = stub.calls.find((call) => call.method === "POST" && call.path === "/api/session");
    expect(signInCall?.body).toEqual({
      identifier: SEED_ACCOUNT.username,
      password: SEED_ACCOUNT.password,
    });
  });
});
