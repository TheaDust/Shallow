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

/** Opens the seeded public repository the way a visitor reaches it. */
async function openBranchDemo(user: ReturnType<typeof userEvent.setup>) {
  renderApp("#/");
  await user.click(await screen.findByRole("link", { name: "branch-switch-demo" }));
  await screen.findByRole("heading", { name: /branch-switch-demo/ });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("lists the branches and switches to the one holding the target-only file", async () => {
  installRepositories();
  const user = userEvent.setup();
  await openBranchDemo(user);

  // The selector reflects the active branch of the Code page.
  await user.click(await screen.findByRole("button", { name: "Branch main" }));
  const find = await screen.findByRole("textbox", { name: "Find branch" });

  // `main` does not carry the target-only file.
  expect(await screen.findByRole("option", { name: "main" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull();

  // Typing filters without Enter or a separate search action.
  await user.type(find, "feature-search");
  expect(screen.queryByRole("option", { name: "main" })).toBeNull();
  await user.click(await screen.findByRole("option", { name: "feature-search" }));

  // The selector shows the new branch and the page exposes the exact file.
  expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
  const file = await screen.findByRole("link", { name: "main-only.md" });
  expect(file.getAttribute("href")).toBe(
    "#/repositories/acme-demo/branch-switch-demo/blob/feature-search/main-only.md",
  );
  expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
});

it("keeps the active branch on main when a query matches no branch and Escape closes the selector", async () => {
  installRepositories();
  const user = userEvent.setup();
  await openBranchDemo(user);
  const hash = window.location.hash;

  await user.click(await screen.findByRole("button", { name: "Branch main" }));
  await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "missing-branch");

  expect(await screen.findByText("No matching branch")).toBeTruthy();
  expect(screen.queryByRole("option", { name: "main" })).toBeNull();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull();
  expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
  expect(window.location.hash).toBe(hash);

  // Reloading the repository keeps the active branch button on `main`.
  cleanup();
  render(<App />);
  expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
});
