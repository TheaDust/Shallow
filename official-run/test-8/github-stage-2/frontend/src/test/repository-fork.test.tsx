import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_ORGANIZATIONS,
  DEFAULT_PERSONAL_REPOSITORIES,
  installFakeApi,
} from "./fake-api";

function installRepositories() {
  return installFakeApi(DEFAULT_ACCOUNTS, {
    organizations: DEFAULT_ORGANIZATIONS,
    personalRepositories: DEFAULT_PERSONAL_REPOSITORIES,
  });
}

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  renderApp("#/signin");
  await user.type(await screen.findByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function openForkForm(user: ReturnType<typeof userEvent.setup>) {
  await signInAs(user, "fork-user@example.test");
  await user.click(await screen.findByRole("link", { name: "acme-docs" }));
  expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Fork" }));
  return screen.findByLabelText("Repository name");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("reports the conflicting fork name on the fork form", async () => {
  installRepositories();
  const user = userEvent.setup();
  const name = await openForkForm(user);
  expect((name as HTMLInputElement).value).toBe("acme-docs");

  await user.clear(name);
  await user.type(name, "acme-docs-fork");
  await user.click(screen.getByRole("button", { name: "Create fork" }));

  expect(await screen.findByText("Repository name already exists")).toBeTruthy();
  expect(window.location.hash).toBe("#/repositories/acme-demo/acme-docs/fork");
});

it("forks the source into the personal namespace and keeps the source link after reload", async () => {
  installRepositories();
  const user = userEvent.setup();
  const name = await openForkForm(user);

  await user.clear(name);
  await user.type(name, "acme-docs-copy");
  await user.click(screen.getByRole("button", { name: "Create fork" }));

  expect(window.location.hash).toBe("#/repositories/fork-user/acme-docs-copy");
  expect(await screen.findByRole("heading", { name: /acme-docs-copy/ })).toBeTruthy();
  expect(screen.getByText(/Forked from/)).toBeTruthy();
  const source = screen.getByRole("link", { name: "acme-docs" });
  expect(source.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs");

  cleanup();
  window.location.hash = "#/repositories/fork-user/acme-docs-copy";
  render(<App />);
  expect(await screen.findByRole("heading", { name: /acme-docs-copy/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: "acme-docs" }).getAttribute("href")).toBe(
    "#/repositories/acme-demo/acme-docs",
  );
});
