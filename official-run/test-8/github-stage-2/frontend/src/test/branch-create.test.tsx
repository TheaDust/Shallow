import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { DEFAULT_ACCOUNTS, DEFAULT_ORGANIZATIONS, installFakeApi } from "./fake-api";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function installRepositories() {
  return installFakeApi(DEFAULT_ACCOUNTS, { organizations: DEFAULT_ORGANIZATIONS });
}

/**
 * Signs in from the application home page through the “Sign in” link, the
 * “Username or email”/“Password” fields and the “Sign in” button.
 */
async function signInFromHome(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  renderApp("#/");
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(await screen.findByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findAllByText("branch-contributor")).length).toBeGreaterThan(0);
}

async function openBranchSelector(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "branch-switch-demo" }));
  await screen.findByRole("heading", { name: /branch-switch-demo/ });
  await user.click(await screen.findByRole("button", { name: "Branch main" }));
  return screen.findByRole("textbox", { name: "Find branch" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("creates a branch from the current head through the Create branch option", async () => {
  const api = installRepositories();
  const user = userEvent.setup();
  await signInFromHome(user, "branch-contributor@example.test");

  const find = await openBranchSelector(user);
  const name = "pw-branch-1234";
  await user.type(find, name);

  // A valid unused name is offered as the exact “Create branch: <name>” option.
  await user.click(await screen.findByRole("option", { name: `Create branch: ${name}` }));

  expect(await screen.findByRole("button", { name: `Branch ${name}` })).toBeTruthy();
  expect(
    api.repositories.find((repository) => repository.name === "branch-switch-demo")?.branches.map((branch) => branch.name),
  ).toContain(name);

  // Reloading the generated branch keeps it selected.
  const hash = window.location.hash;
  cleanup();
  window.location.hash = hash;
  render(<App />);
  expect(await screen.findByRole("button", { name: `Branch ${name}` })).toBeTruthy();
});

it("reports an invalid branch name while typing and creates nothing", async () => {
  const api = installRepositories();
  const user = userEvent.setup();
  await signInFromHome(user, "branch-contributor@example.test");

  const find = await openBranchSelector(user);
  await user.type(find, "invalid..branch");

  expect(await screen.findByText("Invalid branch")).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Create branch: invalid..branch" })).toBeNull();
  expect(
    api.repositories.find((repository) => repository.name === "branch-switch-demo")?.branches.map((branch) => branch.name),
  ).toEqual(["main", "feature-search"]);
  expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
});
