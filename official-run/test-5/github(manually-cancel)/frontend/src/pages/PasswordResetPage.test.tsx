import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedOutSession } from "../test/harness";

function valueOf(element: Element): string {
  return (element as HTMLInputElement).value;
}

async function openRecoveryForm() {
  const user = userEvent.setup();
  renderApp("#/login");
  await user.click(await screen.findByRole("link", { name: "Forgot password" }));
  await screen.findByRole("heading", { name: "Reset your password" });
  return user;
}

describe("password recovery page (REQ-1-1-3)", () => {
  beforeEach(() => {
    installFetch({ "GET /api/auth/session": () => signedOutSession() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is opened by the unique “Forgot password” link of the sign-in page", async () => {
    renderApp("#/login");
    const link = await screen.findByRole("link", { name: "Forgot password" });
    expect(link.getAttribute("href")).toBe("#/forgot-password");
    expect(screen.getAllByRole("link", { name: "Forgot password" })).toHaveLength(1);

    const user = userEvent.setup();
    await user.click(link);
    expect(await screen.findByRole("heading", { name: "Reset your password" })).not.toBeNull();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Send reset link" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    // No password-reset form before the email is submitted.
    expect(screen.queryByRole("button", { name: "Reset password" })).toBeNull();
  });

  it("switches to the reset step and shows the fixed code “123456” as a distinct value", async () => {
    const user = await openRecoveryForm();
    await user.type(screen.getByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    const code = await screen.findByText("123456");
    expect(code.textContent).toBe("123456");
    expect(screen.getByLabelText("Verification code")).not.toBeNull();
    expect(valueOf(screen.getByLabelText("New password"))).toBe("");
    expect((screen.getByLabelText("New password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByRole("button", { name: "Reset password" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    // The next step never claims whether the address exists.
    expect(document.body.textContent).not.toContain("not registered");
  });

  it("reports an invalid verification code beside the field and never redisplays passwords", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/password-reset": () => ({
        status: 400,
        body: { error: "Password reset failed", errors: { code: "Verification code is invalid" } },
      }),
    });
    const user = await openRecoveryForm();
    await user.type(screen.getByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("123456");

    await user.type(screen.getByLabelText("Verification code"), "000000");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Verification code is invalid")).not.toBeNull();
    // The non-sensitive email is retained, password fields are cleared.
    expect(valueOf(screen.getByLabelText("Email"))).toBe("alice.dev@example.test");
    expect(valueOf(screen.getByLabelText("New password"))).toBe("");
    expect(valueOf(screen.getByLabelText("Confirm password"))).toBe("");
    expect(document.body.textContent).not.toContain("Replacement-password-456!");
  });

  it("reports an unknown email beside the email field", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/password-reset": () => ({
        status: 400,
        body: { error: "Password reset failed", errors: { email: "Email is not registered" } },
      }),
    });
    const user = await openRecoveryForm();
    await user.type(screen.getByLabelText("Email"), "nobody@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("123456");
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Email is not registered")).not.toBeNull();
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("submits the recovery context and displays “Password updated” on success", async () => {
    const requests: unknown[] = [];
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      "POST /api/auth/password-reset": (request) => {
        requests.push(request.body);
        return { status: 200, body: { ok: true } };
      },
    });
    const user = await openRecoveryForm();
    await user.type(screen.getByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("123456");
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Password updated");
    expect(requests).toEqual([
      {
        email: "alice.dev@example.test",
        code: "123456",
        newPassword: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    ]);
    expect(screen.queryByLabelText("New password")).toBeNull();
    await waitFor(() => expect(window.location.hash).toBe("#/forgot-password"));
  });
});
