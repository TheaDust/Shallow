import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import * as sessionApi from "../lib/session-api";
import { SessionProvider } from "../session/session-context";
import { SignInPage } from "./SignInPage";
import { SignUpPage } from "./SignUpPage";

afterEach(cleanup);

vi.mock("../lib/session-api", () => ({
  registerAccount: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  fetchSession: vi.fn().mockResolvedValue(null),
  startRecovery: vi.fn(),
  resetPassword: vi.fn(),
}));

describe("registration form", () => {
  it("shows every field error at once, keeps the username and clears passwords", async () => {
    const user = userEvent.setup();
    vi.mocked(sessionApi.registerAccount).mockRejectedValue(
      new ApiError("Unprocessable", 422, {
        errors: {
          username: "Username format is invalid",
          email: "Email format is invalid",
          password: "Password requirements are not satisfied",
          terms: "Agree to terms is required",
        },
      }),
    );

    render(<SignUpPage />);
    await user.type(screen.getByLabelText("Username"), "-invalid-demo");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username format is invalid")).toBeTruthy();
    expect(screen.getByText("Email format is invalid")).toBeTruthy();
    expect(screen.getByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.getByText("Agree to terms is required")).toBeTruthy();

    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("-invalid-demo");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("not-an-email");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
  });

  it("marks a duplicate username and keeps both attempted values", async () => {
    const user = userEvent.setup();
    vi.mocked(sessionApi.registerAccount).mockRejectedValue(
      new ApiError("Unprocessable", 422, { errors: { username: "Username already exists" } }),
    );

    render(<SignUpPage />);
    await user.type(screen.getByLabelText("Username"), "nora-demo");
    await user.type(screen.getByLabelText("Email"), "nora.demo@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username already exists")).toBeTruthy();
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("nora-demo");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("nora.demo@example.test");
  });
});

describe("sign-in form", () => {
  it("displays the generic failure message", async () => {
    const user = userEvent.setup();
    vi.mocked(sessionApi.signIn).mockRejectedValue(
      new ApiError("Unauthorized", 401, { error: "Invalid credentials" }),
    );

    render(
      <SessionProvider>
        <SignInPage />
      </SessionProvider>,
    );
    await user.type(screen.getByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!-wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });
});
