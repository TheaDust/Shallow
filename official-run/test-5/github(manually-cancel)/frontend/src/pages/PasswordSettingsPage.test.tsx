import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installFetch,
  renderApp,
  signedInSession,
  signedOutSession,
  type MockHandler,
} from "../test/harness";

function valueOf(element: Element): string {
  return (element as HTMLInputElement).value;
}

function installSignedInApp(overrides: Record<string, MockHandler> = {}) {
  return installFetch({
    "GET /api/auth/session": () => signedInSession("alice-dev", "alice.dev@example.test"),
    ...overrides,
  });
}

async function openPasswordSettings() {
  const user = userEvent.setup();
  renderApp("#/settings");
  await user.click(await screen.findByRole("link", { name: "Password and authentication" }));
  await screen.findByRole("heading", { name: "Password and authentication" });
  return user;
}

describe("password settings page (REQ-1-3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is opened from Settings and renders the labelled password form", async () => {
    installSignedInApp();
    await openPasswordSettings();
    expect(screen.getByLabelText("Current password")).not.toBeNull();
    expect((screen.getByLabelText("Current password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText("New password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByRole("button", { name: "Update password" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows the current-password and confirmation reasons beside their fields on failure", async () => {
    installSignedInApp({
      "POST /api/auth/password": () => ({
        status: 400,
        body: {
          error: "Password update failed",
          errors: {
            currentPassword: "Current password is incorrect",
            confirmPassword: "Password confirmation does not match",
          },
        },
      }),
    });
    const user = await openPasswordSettings();
    await user.type(screen.getByLabelText("Current password"), "Wrong-password-000!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).not.toBeNull();
    expect(screen.getByText("Password confirmation does not match")).not.toBeNull();
    expect(screen.queryByText("Password updated")).toBeNull();
    // A failed change keeps the form usable for a retry.
    expect((screen.getByRole("button", { name: "Update password" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("reports the required current password message", async () => {
    installSignedInApp({
      "POST /api/auth/password": () => ({
        status: 400,
        body: {
          error: "Password update failed",
          errors: { currentPassword: "Current password is required" },
        },
      }),
    });
    const user = await openPasswordSettings();
    await user.type(screen.getByLabelText("New password"), "Required-password-789!");
    await user.type(screen.getByLabelText("Confirm password"), "Required-password-789!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is required")).not.toBeNull();
  });

  it("displays “Password updated” after a successful change and clears the fields", async () => {
    const requests: unknown[] = [];
    installSignedInApp({
      "POST /api/auth/password": (request) => {
        requests.push(request.body);
        return { status: 200, body: { ok: true } };
      },
    });
    const user = await openPasswordSettings();
    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Password updated");
    expect(requests).toEqual([
      {
        currentPassword: "Valid-password-123!",
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      },
    ]);
    expect(valueOf(screen.getByLabelText("Current password"))).toBe("");
    expect(valueOf(screen.getByLabelText("New password"))).toBe("");
    expect(document.body.textContent).not.toContain("New-password-456!");
  });

  it("requires a signed-in session to open the page", async () => {
    installFetch({ "GET /api/auth/session": () => signedOutSession() });
    renderApp("#/settings/password");

    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Update password" })).toBeNull();
  });
});
