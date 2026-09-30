import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

interface Call {
  url: string;
  method: string;
  body: unknown;
}

type Handler = (url: string, init: RequestInit) => FakeResponse | Promise<FakeResponse>;

function installFetch(handler: Handler): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const request = init ?? {};
    calls.push({
      url,
      method: request.method ?? "GET",
      body: request.body === undefined ? undefined : JSON.parse(String(request.body)),
    });
    return handler(url, request);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const ALICE = { id: "account-alice-dev", username: "alice-dev", email: "alice.dev@example.test", emailVerified: true };

function anonymous(url: string) {
  return url === "/api/session" ? jsonResponse(200, { account: null }) : jsonResponse(404, { error: "Not found" });
}

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

describe("password recovery", () => {
  const recoveryHandler = (url: string, init: RequestInit) => {
    if (url === "/api/password-recovery/requests") return jsonResponse(200, { code: "123456" });
    if (url === "/api/password-recovery") {
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      if (body.code !== "123456") {
        return jsonResponse(400, { error: "Password reset failed", fields: { verificationCode: "Verification code is invalid" } });
      }
      if (body.email !== "alice.dev@example.test") {
        return jsonResponse(400, { error: "No account is associated with that email address", fields: {} });
      }
      if (body.newPassword !== "Replacement-password-456!") {
        return jsonResponse(400, {
          error: "Password reset failed",
          fields: {
            newPassword: "Password requirements are not satisfied",
            confirmPassword: "Passwords do not match",
          },
        });
      }
      return jsonResponse(200, { ok: true });
    }
    return anonymous(url);
  };

  it("opens the recovery form from the sign-in page and shows the fixed code as its own value", async () => {
    installFetch(recoveryHandler);
    open("#/signin");

    const user = userEvent.setup();
    const forgot = await screen.findByRole("link", { name: "Forgot password" });
    expect(forgot.getAttribute("href")).toBe("#/password-reset");
    await user.click(forgot);

    const email = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
    await user.type(email, "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    const code = await screen.findByText("123456");
    expect(code.textContent).toBe("123456");
    expect(window.location.hash).toContain("step=verify");
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
  });

  it("treats a registered and an unknown address the same until the reset is submitted", async () => {
    installFetch(recoveryHandler);
    open("#/password-reset");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "nobody@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect((await screen.findByText("123456")).textContent).toBe("123456");
    expect(screen.queryByRole("alert")).toBeNull();

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("reports a wrong code beside the field and never echoes the submitted passwords", async () => {
    installFetch(recoveryHandler);
    open("#/password-reset");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("123456");

    await user.type(screen.getByLabelText("Verification code"), "000000");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Verification code is invalid")).toBeTruthy();
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("Replacement-password-456!");
    expect(window.location.hash).toContain("alice.dev%40example.test");
  });

  it("reports noncompliant passwords beside their fields without changing the account", async () => {
    installFetch(recoveryHandler);
    open("#/password-reset");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("123456");

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("displays the success status and keeps it after a reload of the page", async () => {
    installFetch(recoveryHandler);
    open("#/password-reset");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "alice.dev@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("123456");

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();

    const hash = window.location.hash;
    cleanup();
    window.location.hash = hash;
    render(<App />);
    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(screen.getByText("123456")).toBeTruthy();
  });
});

describe("account menu and sign out", () => {
  it("keeps the session when the confirmation dialog is cancelled or closed", async () => {
    const calls = installFetch(async (url) => (url === "/api/session" ? jsonResponse(200, { account: ALICE }) : anonymous(url)));
    open("#/workspace");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Sign out" }));

    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Confirm sign out" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Sign out" }));
    const reopened = await screen.findByRole("dialog", { name: "Sign out" });
    await user.click(within(reopened).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
  });

  it("ends the session only after the confirmation and then requires signing in again", async () => {
    let signedIn = true;
    const calls = installFetch(async (url, init) => {
      if (url === "/api/session") return jsonResponse(200, { account: signedIn ? ALICE : null });
      if (url === "/api/sessions/current" && init.method === "DELETE") {
        signedIn = false;
        return jsonResponse(200, { ok: true });
      }
      return anonymous(url);
    });
    open("#/settings/password");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm sign out" }));

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull());
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);

    // Reopening the recorded protected page requires a new authentication.
    cleanup();
    window.location.hash = "#/settings/password";
    render(<App />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByLabelText("Current password")).toBeNull();
  });

  it("shows the Settings entry that opens Password and authentication", async () => {
    installFetch(async (url) =>
      url === "/api/session" ? jsonResponse(200, { account: ALICE }) : anonymous(url),
    );
    open("#/");
    window.location.hash = "#/workspace";

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Settings" }));

    const section = await screen.findByRole("link", { name: "Password and authentication" });
    expect(section.getAttribute("href")).toBe("#/settings/password");
    await user.click(section);

    expect(await screen.findByRole("heading", { name: "Password and authentication" })).toBeTruthy();
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();
  });
});

describe("password change", () => {
  function settingsHandler(init: RequestInit) {
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    const fields: Record<string, string> = {};
    if (!body.currentPassword) fields.currentPassword = "Current password is required";
    else if (body.currentPassword !== "Valid-password-123!") fields.currentPassword = "Current password is incorrect";
    if (body.newPassword !== "New-password-456!") fields.newPassword = "Password requirements are not satisfied";
    if (body.confirmPassword !== body.newPassword) fields.confirmPassword = "Password confirmation does not match";
    if (Object.keys(fields).length > 0) return jsonResponse(400, { error: "Password update failed", fields });
    return jsonResponse(200, { ok: true });
  }

  function installSettingsFetch() {
    return installFetch(async (url, init) => {
      if (url === "/api/account/password") return settingsHandler(init);
      if (url === "/api/session") return jsonResponse(200, { account: ALICE });
      return anonymous(url);
    });
  }

  it("requires the three fields and reports each failure beside its own field", async () => {
    installSettingsFetch();
    open("#/settings/password");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Current password is required")).toBeTruthy();

    await user.type(screen.getByLabelText("Current password"), "Wrong-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "does-not-match");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
    expect(screen.getByText("Password confirmation does not match")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("does-not-match");
  });

  it("reports a noncompliant new password and updates the credentials on success", async () => {
    const calls = installSettingsFetch();
    open("#/settings/password");

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "short");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Password requirements are not satisfied")).toBeTruthy();
    expect(screen.queryByText("Password updated")).toBeNull();

    await user.type(screen.getByLabelText("Current password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("New password"), "New-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "New-password-456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    const submitted = calls.filter((call) => call.url === "/api/account/password");
    expect(submitted.at(-1)?.body).toEqual({
      currentPassword: "Valid-password-123!",
      newPassword: "New-password-456!",
      confirmPassword: "New-password-456!",
    });
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");

    const hash = window.location.hash;
    cleanup();
    window.location.hash = hash;
    render(<App />);
    expect(await screen.findByText("Password updated")).toBeTruthy();
  });
});
