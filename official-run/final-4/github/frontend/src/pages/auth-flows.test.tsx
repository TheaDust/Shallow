import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function inputValue(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

async function openRegistration(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.click(await screen.findByRole("link", { name: "Create an account" }));
  await screen.findByRole("button", { name: "Create account" });
}

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("application shell", () => {
  it("keeps the global banner beside the single main content region", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    // The visitor entry lives in the main region, and the header is its own
    // top-level banner rather than a child of the main content.
    const banner = await screen.findByRole("banner");
    const main = screen.getByRole("main");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(banner.contains(main)).toBe(false);
    expect(banner.contains(screen.getByRole("link", { name: "Sign in" }))).toBe(false);
    expect(banner.querySelector("header")).toBeNull();

    await user.click(screen.getByRole("link", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Username or email"), "evo-session-owner");
    await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // After sign-in the banner carries the current account, its menu trigger
    // and the global search, while the view keeps the only main region.
    await screen.findByText("evo-session-owner");
    const signedInBanner = screen.getByRole("banner");
    expect(signedInBanner.contains(screen.getByText("evo-session-owner"))).toBe(true);
    expect(
      signedInBanner.contains(screen.getByRole("button", { name: "Account menu" })),
    ).toBe(true);
    expect(signedInBanner.contains(screen.getByRole("searchbox", { name: "Search" }))).toBe(true);
    expect(screen.getByRole("main").contains(signedInBanner)).toBe(false);
  });
});

describe("REQ-1-1-1 registration", () => {
  it("exposes exactly one Sign in link leading to the account-access page", async () => {
    const user = userEvent.setup();
    render(<App />);

    const links = await screen.findAllByRole("link", { name: "Sign in" });
    expect(links).toHaveLength(1);

    await user.click(links[0]);
    expect(await screen.findByRole("button", { name: "Sign in" })).not.toBeNull();
    expect(screen.getByLabelText("Username or email")).not.toBeNull();
    expect(screen.getByLabelText("Password")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Create an account" })).not.toBeNull();
  });

  it("registers a new account and signs in with it, keeping the session after reload", async () => {
    const user = userEvent.setup();
    await openRegistration(user);

    await user.type(screen.getByRole("textbox", { name: "Username" }), "nora-demo");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "nora.demo@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await user.type(screen.getByLabelText("Username or email"), "nora.demo@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("nora-demo")).not.toBeNull();

    cleanup();
    render(<App />);
    expect(await screen.findByText("nora-demo")).not.toBeNull();
  });

  it("reports every invalid field together and never echoes passwords", async () => {
    const user = userEvent.setup();
    await openRegistration(user);

    await user.type(screen.getByRole("textbox", { name: "Username" }), "-invalid-demo");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username format is invalid")).not.toBeNull();
    expect(screen.getByText("Email format is invalid")).not.toBeNull();
    expect(screen.getByText("Password requirements are not satisfied")).not.toBeNull();
    expect(screen.getByText("Password confirmation does not match")).not.toBeNull();
    expect(screen.getByText("Agree to terms is required")).not.toBeNull();

    expect(inputValue(screen.getByRole("textbox", { name: "Username" }))).toBe("-invalid-demo");
    expect(inputValue(screen.getByLabelText("Password"))).toBe("");
    expect(inputValue(screen.getByLabelText("Confirm password"))).toBe("");
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeNull();
  });

  it("keeps the email field when only the email format is wrong", async () => {
    const user = userEvent.setup();
    await openRegistration(user);

    await user.type(screen.getByRole("textbox", { name: "Username" }), "invalid-email-demo");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Valid-password-123!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Email format is invalid")).not.toBeNull();
    expect(inputValue(screen.getByRole("textbox", { name: "Email" }))).toBe("not-an-email");
    expect(inputValue(screen.getByRole("textbox", { name: "Username" }))).toBe("invalid-email-demo");
  });
});

describe("REQ-1-1-1 registration evolution", () => {
  it("registers an underscore username, signs in with it and keeps it after reload", async () => {
    const user = userEvent.setup();
    await openRegistration(user);

    await user.type(screen.getByRole("textbox", { name: "Username" }), "evo_user_01");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "evo.register.s1@evolution.test");
    await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
    await user.type(screen.getByLabelText("Confirm password"), "Evo-Password-987!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await user.type(await screen.findByLabelText("Username or email"), "evo.register.s1@evolution.test");
    await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("evo_user_01")).not.toBeNull();

    cleanup();
    render(<App />);
    expect(await screen.findByText("evo_user_01")).not.toBeNull();
  });

  it("rejects an uppercase username, keeps every field available and stays on the form", async () => {
    const user = userEvent.setup();
    await openRegistration(user);

    await user.type(screen.getByRole("textbox", { name: "Username" }), "EvoUpper01");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "evo.register.s2@evolution.test");
    await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
    await user.type(screen.getByLabelText("Confirm password"), "Evo-Password-987!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username format is invalid")).not.toBeNull();
    expect(inputValue(screen.getByRole("textbox", { name: "Username" }))).toBe("EvoUpper01");
    expect(inputValue(screen.getByRole("textbox", { name: "Email" }))).toBe("evo.register.s2@evolution.test");
    expect(screen.getByLabelText("Password")).not.toBeNull();
    expect(screen.getByLabelText("Confirm password")).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Agree to the terms" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeNull();
    expect(inputValue(screen.getByLabelText("Password"))).toBe("");
    expect(screen.queryByLabelText("Username or email")).toBeNull();
    expect(api.accounts.some((account) => account.username === "EvoUpper01")).toBe(false);
  });

  it("reports an existing username while retaining the attempted values", async () => {
    const user = userEvent.setup();
    await openRegistration(user);

    await user.type(screen.getByRole("textbox", { name: "Username" }), "evo-register-existing");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "evo.register.s3@evolution.test");
    await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
    await user.type(screen.getByLabelText("Confirm password"), "Evo-Password-987!");
    await user.click(screen.getByRole("checkbox", { name: "Agree to the terms" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username already exists")).not.toBeNull();
    expect(inputValue(screen.getByRole("textbox", { name: "Username" }))).toBe("evo-register-existing");
    expect(inputValue(screen.getByRole("textbox", { name: "Email" }))).toBe("evo.register.s3@evolution.test");
    expect(api.accounts.filter((account) => account.username === "evo-register-existing")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeNull();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });
});

describe("REQ-1-1-2 sign in evolution", () => {
  it("accepts any casing of a registered email", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Username or email"), "EVO.LOGIN.CASE@EVOLUTION.TEST");
    await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("evo-login-case")).not.toBeNull();

    cleanup();
    render(<App />);
    expect(await screen.findByText("evo-login-case")).not.toBeNull();
  });
});

describe("REQ-1-1-2 sign in", () => {
  it("signs in an existing account and keeps the username visible after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("alice-dev")).not.toBeNull();

    cleanup();
    render(<App />);
    expect(await screen.findByText("alice-dev")).not.toBeNull();
  });

  it("shows the same generic failure for an unknown account and a wrong password", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Username or email"), "unknown@example.test");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid credentials")).not.toBeNull();

    cleanup();
    window.location.hash = "#/";
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!-wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid credentials")).not.toBeNull();
  });
});

describe("REQ-1-1-3 recovery", () => {
  async function openResetStep(user: ReturnType<typeof userEvent.setup>, email: string) {
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    await user.click(await screen.findByRole("link", { name: "Forgot password" }));
    await user.type(await screen.findByLabelText("Email"), email);
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
  }

  it("shows the fixed code and reset fields for a registered address", async () => {
    const user = userEvent.setup();
    await openResetStep(user, "recovery-success@example.test");

    expect(await screen.findByText("123456")).not.toBeNull();
    expect(screen.getByLabelText("Verification code")).not.toBeNull();
    expect(screen.getByLabelText("New password")).not.toBeNull();
    expect(screen.getByLabelText("Confirm password")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reset password" })).not.toBeNull();
  });

  it("rejects a wrong code and applies a corrected reset", async () => {
    const user = userEvent.setup();
    await openResetStep(user, "recovery-success@example.test");
    await screen.findByText("123456");

    await user.type(screen.getByLabelText("Verification code"), "000000");
    await user.type(screen.getByLabelText("New password"), "Replacement-password-456!");
    await user.type(screen.getByLabelText("Confirm password"), "Replacement-password-456!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText("Verification code is invalid")).not.toBeNull();
    expect(api.accounts.find((account) => account.username === "recovery-success")?.password).toBe(
      "Valid-password-123!",
    );

    await user.clear(screen.getByLabelText("Verification code"));
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText("Password updated")).not.toBeNull();
    expect(api.accounts.find((account) => account.username === "recovery-success")?.password).toBe(
      "Replacement-password-456!",
    );
  });
});
