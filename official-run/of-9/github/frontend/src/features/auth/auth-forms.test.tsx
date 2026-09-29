import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "./session";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { SignInForm } from "./SignInForm";
import { SignUpForm } from "./SignUpForm";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  registerAccount: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  fetchSession: vi.fn(),
}));

vi.mock("./api", () => ({
  signIn: mocks.signIn,
  registerAccount: mocks.registerAccount,
  requestPasswordReset: mocks.requestPasswordReset,
  resetPassword: mocks.resetPassword,
  fetchSession: mocks.fetchSession,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSession.mockResolvedValue({ authenticated: false });
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

function inputValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

describe("SignUpForm", () => {
  it("renders the labeled registration fields, checkbox and button", () => {
    render(<SignUpForm />);
    expect(screen.getByLabelText("Username").getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    expect(screen.getByLabelText("Confirm password").getAttribute("type")).toBe("password");
    const terms = screen.getByLabelText("Agree to the terms") as HTMLInputElement;
    expect(terms.type).toBe("checkbox");
    expect(terms.checked).toBe(false);
    const button = screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("shows all field errors together, retains username/email and clears passwords", async () => {
    const user = userEvent.setup();
    mocks.registerAccount.mockResolvedValue({
      ok: false,
      errors: {
        username: "Username format is invalid",
        email: "Email format is invalid",
        password: "Password requirements are not satisfied",
        confirmPassword: "Passwords do not match",
        terms: "Agree to terms is required",
      },
    });
    render(<SignUpForm />);
    await user.type(screen.getByLabelText("Username"), "-hyphen");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username format is invalid")).toBeTruthy();
    expect(screen.getByText("Email format is invalid")).toBeTruthy();
    expect(screen.getByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    expect(screen.getByText("Agree to terms is required")).toBeTruthy();

    expect(inputValue("Username")).toBe("-hyphen");
    expect(inputValue("Email")).toBe("not-an-email");
    expect(inputValue("Password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
    const button = screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("navigates to the sign-in page after a successful registration", async () => {
    const user = userEvent.setup();
    mocks.registerAccount.mockResolvedValue({ ok: true });
    render(<SignUpForm />);
    await user.type(screen.getByLabelText("Username"), "pw-user-abc123");
    await user.type(screen.getByLabelText("Email"), "pw-user-abc123@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByLabelText("Agree to the terms"));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(window.location.hash).toBe("#/signin?registered=1"));
    expect(mocks.registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "pw-user-abc123",
        email: "pw-user-abc123@example.test",
        agreeToTerms: true,
      }),
    );
  });
});

describe("SignInForm", () => {
  it("renders fields, submit button and the sign-in page links", () => {
    window.location.hash = "#/signin";
    render(
      <SessionProvider>
        <SignInForm />
      </SessionProvider>,
    );
    expect(screen.getByLabelText("Username or email")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create an account" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot password" })).toBeTruthy();
  });

  it("shows Invalid credentials and clears the password after a failed sign-in", async () => {
    window.location.hash = "#/signin";
    const user = userEvent.setup();
    mocks.signIn.mockResolvedValue({ ok: false, message: "Invalid credentials" });
    render(
      <SessionProvider>
        <SignInForm />
      </SessionProvider>,
    );
    await user.type(screen.getByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Wrong-password-1!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid credentials")).toBeTruthy();
    expect(inputValue("Username or email")).toBe("alice-dev");
    expect(inputValue("Password")).toBe("");
  });

  it("enters the workspace after a successful sign-in", async () => {
    window.location.hash = "#/signin";
    const user = userEvent.setup();
    mocks.signIn.mockResolvedValue({
      ok: true,
      account: { username: "alice-dev", email: "alice.dev@example.test" },
    });
    mocks.fetchSession.mockResolvedValue({
      authenticated: true,
      account: { username: "alice-dev", email: "alice.dev@example.test" },
    });
    render(
      <SessionProvider>
        <SignInForm />
      </SessionProvider>,
    );
    await user.type(screen.getByLabelText("Username or email"), "alice.dev@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(window.location.hash).toBe("#/"));
  });
});

describe("ForgotPasswordForm", () => {
  it("switches to the reset step and displays the fixed verification code 123456", async () => {
    const user = userEvent.setup();
    mocks.requestPasswordReset.mockResolvedValue(undefined);
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("123456")).toBeTruthy();
    expect(inputValue("Email")).toBe("alice.dev@example.test");
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
    expect(screen.getByLabelText("New password").getAttribute("type")).toBe("password");
    expect(screen.getByLabelText("Confirm password").getAttribute("type")).toBe("password");
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
  });

  it("shows the verification code error and clears passwords", async () => {
    const user = userEvent.setup();
    mocks.requestPasswordReset.mockResolvedValue(undefined);
    mocks.resetPassword.mockResolvedValue({
      ok: false,
      errors: { code: "Verification code is invalid" },
    });
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await user.type(screen.getByLabelText("Verification code"), "000000");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Verification code is invalid")).toBeTruthy();
    expect(inputValue("New password")).toBe("");
    expect(inputValue("Confirm password")).toBe("");
  });

  it("displays Password updated on success", async () => {
    const user = userEvent.setup();
    mocks.requestPasswordReset.mockResolvedValue(undefined);
    mocks.resetPassword.mockResolvedValue({ ok: true });
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
  });
});
