import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { DEFAULT_ACCOUNTS, DEFAULT_ORGANIZATIONS, installFakeApi, type FakeAccount } from "./fake-api";

function installRepositories() {
  return installFakeApi(DEFAULT_ACCOUNTS, { organizations: DEFAULT_ORGANIZATIONS });
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

const ADMIN = DEFAULT_ACCOUNTS.find((account) => account.username === "visibility-admin") as FakeAccount;
const COLLABORATOR = DEFAULT_ACCOUNTS.find((account) => account.username === "collaborator") as FakeAccount;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("lets the repository administrator confirm Public and read the marker afterwards", async () => {
  const api = installRepositories();
  const user = userEvent.setup();
  await signInAs(user, ADMIN.email);

  await user.click(await screen.findByRole("link", { name: "visibility-demo" }));
  expect(await screen.findByRole("heading", { name: /visibility-demo/ })).toBeTruthy();

  await user.click(screen.getByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("link", { name: "General" }));
  await user.click(screen.getByRole("button", { name: "Change visibility" }));

  const dialog = await screen.findByRole("dialog", { name: "Change repository visibility" });
  await user.click(within(dialog).getByRole("radio", { name: "Public" }));
  await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

  expect(await screen.findByText("Public")).toBeTruthy();
  expect(window.location.hash).toBe("#/repositories/acme-demo/visibility-demo");

  // A visitor without the session cookie still reaches the now public repository.
  api.signedInId = null;
  cleanup();
  renderApp("#/repositories/acme-demo/visibility-demo");
  expect(await screen.findByRole("heading", { name: /visibility-demo/ })).toBeTruthy();
});

it("shows a non-admin collaborator no actionable Change visibility button", async () => {
  installRepositories();
  const user = userEvent.setup();
  await signInAs(user, COLLABORATOR.email);

  await user.click(await screen.findByRole("link", { name: "visibility-demo" }));
  expect(await screen.findByRole("heading", { name: /visibility-demo/ })).toBeTruthy();

  const settings = screen.queryByRole("link", { name: "Settings" });
  if (settings) await user.click(settings);

  expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
  expect(await screen.findByRole("heading", { name: /visibility-demo/ })).toBeTruthy();
});

it("keeps the visibility confirmation dialog modal until it is confirmed or cancelled", async () => {
  installRepositories();
  const user = userEvent.setup();
  await signInAs(user, ADMIN.email);

  await user.click(await screen.findByRole("link", { name: "visibility-demo" }));
  await user.click(await screen.findByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("link", { name: "General" }));

  const trigger = screen.getByRole("button", { name: "Change visibility" });
  await user.click(trigger);

  const dialog = await screen.findByRole("dialog", { name: "Change repository visibility" });
  expect(within(dialog).getByRole("radio", { name: "Private" })).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog", { name: "Change repository visibility" })).toBeNull();
  expect(await screen.findByRole("button", { name: "Change visibility" })).toBeTruthy();
});
