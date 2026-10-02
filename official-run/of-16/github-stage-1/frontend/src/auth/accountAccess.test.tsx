import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi } from "../test-utils/fake-api";

function goto(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

async function renderAt(hash: string) {
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("main");
  return user;
}

const valueOf = (element: HTMLElement) => (element as HTMLInputElement).value;
const disabledOf = (element: HTMLElement) => (element as HTMLButtonElement).disabled;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("home page account access", () => {
  it("exposes exactly one Sign in link next to Sign up and Forgot password", async () => {
    createFakeApi().install();
    await renderAt("#/");

    const signInLinks = await screen.findAllByRole("link", { name: "Sign in" });
    expect(signInLinks).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Sign up" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot password" })).toBeTruthy();
  });
});

describe("REQ-1-1-2 sign in", () => {
  it("shows the labelled sign-in form with the forgot-password and registration entries", async () => {
    createFakeApi().install();
    await renderAt("#/login");

    expect(screen.getByLabelText("Username or email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(disabledOf(screen.getByRole("button", { name: "Sign in" }))).toBe(false);
    expect(screen.getByRole("link", { name: "Forgot password" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create an account" })).toBeTruthy();
  });

  it("displays the generic failure message for a wrong password and for an unknown account", async () => {
    createFakeApi().install();
    const user = await renderAt("#/login");

    await user.type(screen.getByLabelText("Username or email"), "alice.dev@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!-incorrect");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid credentials")).toBeTruthy();

    await user.clear(screen.getByLabelText("Username or email"));
    await user.type(screen.getByLabelText("Username or email"), "unknown@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findAllByText("Invalid credentials")).toHaveLength(1);
    expect(window.location.hash).toBe("#/login");
  });

  it("enters the workspace with the username visible and keeps it after a reload", async () => {
    createFakeApi().install();
    const user = await renderAt("#/login");

    await user.type(screen.getByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("alice-dev")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Account menu" })).toBeTruthy();
    expect(window.location.hash).toBe("#/");

    // Reload: a fresh mount restores the account from the stored session.
    cleanup();
    render(<App />);
    expect(await screen.findByText("alice-dev")).toBeTruthy();
  });
});

describe("REQ-1-1-1 registration", () => {
  it("renders the labelled registration form", async () => {
    createFakeApi().install();
    await renderAt("#/signup");

    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Username" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    const terms = screen.getByRole("checkbox", { name: "Agree to the terms" });
    expect((terms as HTMLInputElement).checked).toBe(false);
    expect(disabledOf(screen.getByRole("button", { name: "Create account" }))).toBe(false);
  });

  it("shows every failing field message of one submission beside its field", async () => {
    createFakeApi({
      register: () => ({
        status: 400,
        body: {
          errors: {
            username: "Username format is invalid",
            email: "Email format is invalid",
            password: "Password requirements are not satisfied",
            agreeToTerms: "Agree to terms is required",
          },
        },
      }),
    }).install();
    const user = await renderAt("#/signup");

    await user.type(screen.getByRole("textbox", { name: "Username" }), "-invalid-demo");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username format is invalid")).toBeTruthy();
    expect(screen.getByText("Email format is invalid")).toBeTruthy();
    expect(screen.getByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.getByText("Agree to terms is required")).toBeTruthy();

    expect(valueOf(screen.getByRole("textbox", { name: "Username" }))).toBe("-invalid-demo");
    expect(valueOf(screen.getByRole("textbox", { name: "Email" }))).toBe("not-an-email");
    expect(valueOf(screen.getByLabelText("Password"))).toBe("");
    expect(valueOf(screen.getByLabelText("Confirm password"))).toBe("");
    expect(disabledOf(screen.getByRole("button", { name: "Create account" }))).toBe(false);
    expect(window.location.hash).toBe("#/signup");
  });

  it("reports a duplicate username and keeps both attempted values", async () => {
    createFakeApi().install();
    const user = await renderAt("#/signup");

    await user.type(screen.getByRole("textbox", { name: "Username" }), "alice-dev");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "alice.other@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username already exists")).toBeTruthy();
    expect(valueOf(screen.getByRole("textbox", { name: "Username" }))).toBe("alice-dev");
    expect(valueOf(screen.getByRole("textbox", { name: "Email" }))).toBe("alice.other@example.test");
    expect(window.location.hash).toBe("#/signup");
  });

  it("registers an account, opens the sign-in page and signs the new account in", async () => {
    createFakeApi().install();
    const user = await renderAt("#/signup");

    await user.type(screen.getByRole("textbox", { name: "Username" }), "nora-demo");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "nora.demo@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeTruthy();
    expect(window.location.hash).toBe("#/login");

    const signInForm = screen.getByRole("form", { name: "Sign in" });
    await user.type(within(signInForm).getByLabelText("Username or email"), "nora.demo@example.test");
    await user.type(within(signInForm).getByLabelText("Password"), "Valid-password-123!");
    await user.click(within(signInForm).getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("nora-demo")).toBeTruthy();
  });
});

describe("REQ-1-1-3 recovery", () => {
  it("shows the fixed verification code and the reset fields for any email", async () => {
    createFakeApi().install();
    const user = await renderAt("#/login");

    await user.click(screen.getByRole("link", { name: "Forgot password" }));
    await waitFor(() => expect(window.location.hash).toBe("#/forgot-password"));

    await user.type(screen.getByLabelText("Email"), "recovery-visibility@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("123456")).toBeTruthy();
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
  });

  it("rejects a wrong code and keeps the original password usable", async () => {
    createFakeApi({
      accounts: [
        {
          username: "recovery-invalid-code",
          email: "recovery-invalid-code@example.test",
          password: "Valid-password-123!",
        },
      ],
    }).install();
    const user = await renderAt("#/forgot-password");

    await user.type(screen.getByLabelText("Email"), "recovery-invalid-code@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await user.type(await screen.findByLabelText("Verification code"), "000000");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Verification code is invalid")).toBeTruthy();
    expect(valueOf(screen.getByLabelText("New password"))).toBe("");
    expect(valueOf(screen.getByLabelText("Confirm password"))).toBe("");
  });

  it("updates the password with the correct code and reports Password updated", async () => {
    const api = createFakeApi({
      accounts: [
        { username: "recovery-success", email: "recovery-success@example.test", password: "Valid-password-123!" },
      ],
    });
    api.install();
    const user = await renderAt("#/forgot-password");

    await user.type(screen.getByLabelText("Email"), "recovery-success@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await user.type(await screen.findByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(api.accounts[0].password).toBe("Replacement-password-456!");
  });
});
