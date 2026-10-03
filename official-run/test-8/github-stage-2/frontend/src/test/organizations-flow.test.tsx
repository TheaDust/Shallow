import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { DEFAULT_ORGANIZATIONS, installFakeApi, type FakeAccount } from "./fake-api";

const ORG_OWNER: FakeAccount = { id: "account-org-owner", username: "org-owner", email: "org-owner@example.test", password: "Valid-password-123!" };
const TEAM_MAINTAINER: FakeAccount = { id: "account-team-maintainer", username: "team-maintainer", email: "team-maintainer@example.test", password: "Valid-password-123!" };
const BOB: FakeAccount = { id: "account-bob", username: "bob-reviewer", email: "bob-reviewer@example.test", password: "Valid-password-123!" };

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function installOrganizationApi() {
  return installFakeApi([ORG_OWNER, TEAM_MAINTAINER, BOB], { organizations: DEFAULT_ORGANIZATIONS });
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, account: FakeAccount) {
  renderApp("#/signin");
  await user.type(await screen.findByLabelText("Username or email"), account.username);
  await user.type(screen.getByLabelText("Password"), account.password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("lets a visitor open the public organization and browse its repository", async () => {
  installOrganizationApi();
  const user = userEvent.setup();
  renderApp("#/");

  await user.click(await screen.findByRole("link", { name: "Acme Demo" }));
  expect(window.location.hash).toBe("#/organizations/acme-demo");

  await user.click(await screen.findByRole("link", { name: "Repositories" }));
  const filter = await screen.findByRole("textbox", { name: "Find a repository" });
  await user.type(filter, "acme-docs");

  const repositoryLink = await screen.findByRole("link", { name: "acme-docs" });
  expect(repositoryLink.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs");

  await user.click(repositoryLink);
  expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();

  // Returning to the organization keeps the public result available.
  await user.click(screen.getByRole("link", { name: "Acme Demo" }));
  await user.click(await screen.findByRole("link", { name: "Repositories" }));
  expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
});

it("uses the organization display name as a heading", async () => {
  installOrganizationApi();
  renderApp("#/organizations/acme-demo");

  expect(await screen.findByRole("heading", { name: "Acme Demo" })).toBeTruthy();
});

it("shows the organization name/repository name heading with the repository name", async () => {
  installOrganizationApi();
  renderApp("#/repositories/acme-demo/acme-docs");

  const repositoryHeading = await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(repositoryHeading.textContent).toBe("Acme Demo/acme-docs"));
  expect(screen.getByText("acme-docs", { exact: true })).toBeTruthy();
});

it("lists the account's readable repositories on Your organizations", async () => {
  const repoAdmin: FakeAccount = {
    id: "account-repo-admin",
    username: "repo-admin",
    email: "repo-admin@example.test",
    password: "Valid-password-123!",
  };
  installFakeApi([repoAdmin], { organizations: DEFAULT_ORGANIZATIONS });
  const user = userEvent.setup();
  await signInAs(user, repoAdmin);

  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(await screen.findByRole("link", { name: "Your organizations" }));

  // A repository Admin reaches the repository from the workspace even without
  // an organization membership; the private repository stays hidden.
  const repositoryLink = await screen.findByRole("link", { name: "acme-docs" });
  expect(repositoryLink.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs");
  expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
});

it("never exposes the private repository link to a visitor", async () => {
  installOrganizationApi();
  const user = userEvent.setup();
  renderApp("#/organizations/acme-demo/repositories");

  await screen.findByRole("textbox", { name: "Find a repository" });
  expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

  await user.type(screen.getByRole("textbox", { name: "Find a repository" }), "secret-research");
  expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
  expect(screen.getByText("No repositories found.")).toBeTruthy();
});

it("creates an organization from Your organizations and persists the overview", async () => {
  installOrganizationApi();
  const user = userEvent.setup();
  await signInAs(user, ORG_OWNER);

  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(await screen.findByRole("link", { name: "Your organizations" }));
  expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();

  await user.click(screen.getByRole("link", { name: "New organization" }));
  await user.type(await screen.findByLabelText("Organization name"), "mobile-guild");
  await user.type(screen.getByLabelText("Display name"), "Mobile Guild");
  await user.click(screen.getByRole("button", { name: "Create organization" }));

  expect(await screen.findByRole("heading", { name: "mobile-guild" })).toBeTruthy();
  expect(window.location.hash).toBe("#/organizations/mobile-guild");
});

it("reports a duplicate organization name without opening the existing one", async () => {
  installOrganizationApi();
  const user = userEvent.setup();
  await signInAs(user, ORG_OWNER);
  window.location.hash = "#/organizations/new";

  await user.type(await screen.findByLabelText("Organization name"), "Acme Demo");
  await user.click(screen.getByRole("button", { name: "Create organization" }));

  expect(await screen.findByText("Organization name already exists")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "acme-demo" })).toBeNull();
});

it("reports an invalid organization name together with a missing display name", async () => {
  installOrganizationApi();
  const user = userEvent.setup();
  await signInAs(user, ORG_OWNER);
  window.location.hash = "#/organizations/new";

  await user.type(await screen.findByLabelText("Organization name"), "-invalid-organization");
  await user.type(screen.getByLabelText("Display name"), "   ");
  await user.click(screen.getByRole("button", { name: "Create organization" }));

  expect(await screen.findByText("Organization name format is invalid")).toBeTruthy();
  expect(screen.getByText("Display name is required")).toBeTruthy();
});

it("creates a team from the Teams page and rejects a malformed name", async () => {
  installOrganizationApi();
  const user = userEvent.setup();
  await signInAs(user, ORG_OWNER);
  window.location.hash = "#/organizations/acme-demo/teams";

  await user.click(await screen.findByRole("link", { name: "New team" }));
  await user.type(await screen.findByLabelText("Team name"), "mobile-team");
  await user.click(screen.getByRole("button", { name: "Create team" }));
  expect(await screen.findByRole("heading", { name: "mobile-team" })).toBeTruthy();

  window.location.hash = "#/organizations/acme-demo/teams/new";
  await user.type(await screen.findByLabelText("Team name"), "-invalid-team");
  await user.click(screen.getByRole("button", { name: "Create team" }));
  expect(await screen.findByText("Team name is invalid")).toBeTruthy();
});

it("adds and removes a team member from the Members page", async () => {
  installOrganizationApi();
  const user = userEvent.setup();
  await signInAs(user, TEAM_MAINTAINER);
  window.location.hash = "#/organizations/acme-demo/teams/frontend-team/members";

  await user.click(await screen.findByRole("link", { name: "Add member" }));
  await user.type(await screen.findByLabelText("Username"), "bob-reviewer");
  await user.click(screen.getByRole("button", { name: "Add member" }));

  const removeButton = await screen.findByRole("button", { name: "Remove bob-reviewer" });
  expect(screen.getByText("bob-reviewer")).toBeTruthy();

  await user.click(removeButton);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull());
  expect(screen.queryByText("bob-reviewer")).toBeNull();

  // The removal stays effective after reloading the Members page.
  cleanup();
  window.location.hash = "#/organizations/acme-demo/teams/frontend-team/members";
  render(<App />);
  await screen.findByRole("link", { name: "Add member" });
  expect(screen.queryByText("bob-reviewer")).toBeNull();
});

it("rejects a cyclic parent team and keeps the saved parent selected", async () => {
  installOrganizationApi();
  const user = userEvent.setup();
  await signInAs(user, TEAM_MAINTAINER);
  window.location.hash = "#/organizations/acme-demo/teams/frontend-team/settings";

  const combobox = (await screen.findByRole("combobox", { name: "Parent team" })) as HTMLInputElement;
  await waitFor(() => expect(combobox.value).toBe("platform-team"));

  await user.click(combobox);
  await user.click(await screen.findByRole("option", { name: "frontend-child" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Cyclic team hierarchy is not allowed")).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Parent team" }) as HTMLInputElement).value).toBe("platform-team");
});
