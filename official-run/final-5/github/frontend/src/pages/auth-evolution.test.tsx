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

describe("REQ-1-1-1 evolution username rule", () => {
  it("registers a username that uses single underscores and signs in with it", async () => {
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
  });

  it("rejects an uppercase username and keeps the form for correction", async () => {
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
    // The rejected submission stays on the registration form.
    expect(screen.getByRole("checkbox", { name: "Agree to the terms" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("reports a duplicate seeded username while retaining the attempted values", async () => {
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
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });
});

describe("REQ-1-1-2 evolution case-insensitive email lookup", () => {
  it("signs in with a differently cased email", async () => {
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

  it("keeps the username lookup exact", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Username or email"), "EVO-LOGIN-CASE");
    await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid credentials")).not.toBeNull();
  });
});
