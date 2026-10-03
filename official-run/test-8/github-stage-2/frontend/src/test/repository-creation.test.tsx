import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("offers the creation form with the personal namespace and the required controls", async () => {
  installRepositories();
  const user = userEvent.setup();
  await signInAs(user, "repo-owner@example.test");

  await user.click(await screen.findByRole("link", { name: "New repository" }));
  expect(window.location.hash).toBe("#/repositories/new");

  const form = await screen.findByRole("form", { name: "New repository" });
  const owner = within(form).getByLabelText("Owner");
  expect((owner as HTMLSelectElement).value).toBe("repo-owner");
  expect(within(form).getByLabelText("Repository name")).toBeTruthy();
  expect(within(form).getByLabelText("Description")).toBeTruthy();
  expect(within(form).getByRole("radio", { name: "Public" })).toBeTruthy();
  expect(within(form).getByRole("radio", { name: "Private" })).toBeTruthy();
  expect(within(form).getByRole("checkbox", { name: "Add a README file" })).toBeTruthy();
  expect(within(form).getByRole("button", { name: "Create repository" })).toBeTruthy();
});

it("reports an empty and a duplicate name on the form without opening the existing repository", async () => {
  installRepositories();
  const user = userEvent.setup();
  await signInAs(user, "repo-owner@example.test");
  await user.click(await screen.findByRole("link", { name: "New repository" }));

  const name = await screen.findByLabelText("Repository name");
  await user.click(screen.getByRole("button", { name: "Create repository" }));
  expect(await screen.findByText("Repository name is required")).toBeTruthy();

  await user.type(name, "acme-docs");
  await user.click(screen.getByRole("button", { name: "Create repository" }));
  expect(await screen.findByText("Repository name already exists")).toBeTruthy();

  // The form stays on the page and the existing repository is never opened.
  expect(window.location.hash).toBe("#/repositories/new");
  expect(screen.queryByRole("heading", { name: /acme-docs/ })).toBeNull();
});

it("creates an initialized private repository and keeps it after reloading", async () => {
  installRepositories();
  const user = userEvent.setup();
  await signInAs(user, "repo-owner@example.test");
  await user.click(await screen.findByRole("link", { name: "New repository" }));

  await user.type(await screen.findByLabelText("Repository name"), "playwright-demo");
  await user.type(screen.getByLabelText("Description"), "Repository created by Playwright");
  await user.click(screen.getByRole("radio", { name: "Private" }));
  await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
  await user.click(screen.getByRole("button", { name: "Create repository" }));

  expect(window.location.hash).toBe("#/repositories/repo-owner/playwright-demo");
  expect(await screen.findByRole("heading", { name: /playwright-demo/ })).toBeTruthy();
  expect(screen.getByText("Private")).toBeTruthy();
  expect(screen.getByText("Repository created by Playwright")).toBeTruthy();

  const readme = screen.getByRole("link", { name: "README.md" });
  expect(readme.getAttribute("href")).toBe("#/repositories/repo-owner/playwright-demo/blob/main/README.md");

  // The overview the link opens is read-only and shows the stored content.
  await user.click(readme);
  expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
  expect(screen.getByText("Path README.md")).toBeTruthy();
  expect(screen.getByText("# playwright-demo")).toBeTruthy();

  // Reloading the overview restores the same repository.
  cleanup();
  window.location.hash = "#/repositories/repo-owner/playwright-demo";
  render(<App />);
  expect(await screen.findByRole("heading", { name: /playwright-demo/ })).toBeTruthy();
  expect(screen.getByText("Private")).toBeTruthy();

  // And the owner’s repository list contains it.
  window.location.hash = "#/";
  cleanup();
  render(<App />);
  expect(await screen.findByRole("link", { name: "playwright-demo" })).toBeTruthy();
});
