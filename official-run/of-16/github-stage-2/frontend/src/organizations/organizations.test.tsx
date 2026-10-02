import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeAccount } from "../test-utils/fake-api";

const ORG_OWNER: FakeAccount = {
  username: "org-owner",
  email: "org-owner@example.test",
  password: "Valid-password-123!",
};

const REPO_ADMIN: FakeAccount = {
  username: "repo-admin",
  email: "repo-admin@example.test",
  password: "Valid-password-123!",
};

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function renderAt(hash: string) {
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("main");
  return user;
}

async function renderSignedIn(hash: string, accounts: FakeAccount[] = [ORG_OWNER]) {
  const api = createFakeApi({ accounts });
  api.install();
  api.signInAs(accounts[0].username);
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("link", { name: "Account menu" });
  return { api, user };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("REQ-2-1-1 browse organization repositories", () => {
  it("scenario 1: a visitor opens the public repository and reaches it again through Repositories", async () => {
    createFakeApi().install();
    const user = await renderAt("#/");

    await user.click(await screen.findByRole("link", { name: "Acme Demo" }));
    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo"));

    const repositoriesLink = await screen.findByRole("link", { name: "Repositories" });
    expect(repositoriesLink.getAttribute("role")).toBeNull();
    await user.click(repositoriesLink);
    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/repositories"));

    await user.type(screen.getByLabelText("Find a repository"), "acme-docs");
    await user.click(screen.getByRole("link", { name: "acme-docs" }));

    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs"));
    expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Acme Demo" }));
    await user.click(await screen.findByRole("link", { name: "Repositories" }));

    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
  });

  it("scenario 2: filtering by the exact private repository name never exposes its link", async () => {
    createFakeApi().install();
    const user = await renderAt("#/organizations/acme-demo/repositories");

    const filter = await screen.findByLabelText("Find a repository");
    await user.type(filter, "secret-research");

    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(screen.queryByText("secret-research")).toBeNull();

    await user.clear(filter);
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
  });

  it("lists name, description, visibility and update time and offers no write operation", async () => {
    createFakeApi().install();
    await renderAt("#/organizations/acme-demo/repositories");

    const list = await screen.findByRole("list");
    expect(within(list).getByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(within(list).getByText(/Documentation, guides/)).toBeTruthy();
    expect(within(list).getByText("Public")).toBeTruthy();
    expect(within(list).getByText(/^Updated /)).toBeTruthy();
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("the public/private filter narrows the visible results of a signed-in Owner", async () => {
    const { user } = await renderSignedIn("#/organizations/acme-demo/repositories");

    await screen.findByRole("link", { name: "acme-docs" });
    expect(await screen.findByRole("link", { name: "secret-research" })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Visibility"), "private");
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
    expect(screen.getByRole("link", { name: "secret-research" })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Visibility"), "public");
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
  });

  it("a member without a grant sees only public repositories", async () => {
    const api = createFakeApi({
      accounts: [ORG_OWNER, { username: "plain-member", email: "plain-member@example.test", password: "Valid-password-123!" }],
      organizations: [
        {
          slug: "acme-demo",
          name: "Acme Demo",
          displayName: "Acme Demo",
          owners: ["org-owner"],
          members: ["plain-member"],
          repositories: [
            { name: "acme-docs", description: "Docs", visibility: "public", updatedAt: "2024-05-02T09:30:00.000Z" },
            { name: "secret-research", description: "Secret", visibility: "private", updatedAt: "2024-05-03T11:15:00.000Z" },
          ],
        },
      ],
    });
    api.install();
    api.signInAs("plain-member");
    goto("#/organizations/acme-demo/repositories");
    render(<App />);

    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    // The organization itself stays visible in "Your organizations".
    goto("#/organizations");
    expect(await screen.findByRole("link", { name: "Acme Demo" })).toBeTruthy();
    expect(await screen.findByText("Member")).toBeTruthy();
  });
});

describe("REQ-2-2-1 / REQ-2-3 account-menu entry to the organization and repository pages", () => {
  it("the account menu is a link that opens 'Your organizations'", async () => {
    const { user } = await renderSignedIn("#/");

    const trigger = screen.getByRole("link", { name: "Account menu" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("menu", { name: "Account menu" });
    await user.click(within(menu).getByRole("link", { name: "Your organizations" }));

    await waitFor(() => expect(window.location.hash).toBe("#/organizations"));
    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();
  });

  it("lists the readable repositories of each membership and opens one through Settings", async () => {
    const api = createFakeApi({
      accounts: [REPO_ADMIN],
      organizations: [
        {
          slug: "acme-demo",
          name: "Acme Demo",
          displayName: "Acme Demo",
          owners: ["org-owner"],
          members: ["repo-admin"],
          teams: [{ name: "access-role-team" }],
          repositories: [
            { name: "acme-docs", description: "Docs", visibility: "public", updatedAt: "2024-05-02T09:30:00.000Z" },
            { name: "secret-research", description: "Secret", visibility: "private", updatedAt: "2024-05-03T11:15:00.000Z" },
          ],
        },
      ],
      grants: [{ id: "grant-admin", repositoryName: "acme-docs", username: "repo-admin", role: "admin" }],
    });
    api.install();
    api.signInAs("repo-admin");
    goto("#/organizations");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "Account menu" });

    // Only the readable repository of the organization is offered here.
    await user.click(await screen.findByRole("link", { name: "acme-docs" }));
    await waitFor(() => expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs"));
    expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("link", { name: "Manage access" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs/settings/manage-access");
    });
    expect(await screen.findByRole("button", { name: "Add people or teams" })).toBeTruthy();
  });
});

describe("REQ-2-1-2 create an organization after authentication", () => {
  it("scenario 1: creates the organization and keeps the heading after a reload", async () => {
    const { user } = await renderSignedIn("#/");

    await user.click(screen.getByRole("link", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Your organizations" }));
    await waitFor(() => expect(window.location.hash).toBe("#/organizations"));

    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "New organization" }));
    await waitFor(() => expect(window.location.hash).toBe("#/organizations/new"));

    await user.type(screen.getByLabelText("Organization name"), "mobile-guild");
    await user.type(screen.getByLabelText("Display name"), "Mobile Guild");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => expect(window.location.hash).toBe("#/organizations/mobile-guild"));
    expect(await screen.findByRole("heading", { name: /mobile-guild/ })).toBeTruthy();

    // Reloading the same address restores the organization overview.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: /mobile-guild/ })).toBeTruthy();
  });

  it("scenario 2: a duplicate identifier reports the exact message and opens nothing", async () => {
    const { user } = await renderSignedIn("#/organizations/new");

    await user.type(screen.getByLabelText("Organization name"), "Acme Demo");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).toBeTruthy();
    expect(window.location.hash).toBe("#/organizations/new");
    expect(screen.queryByRole("heading", { name: /Acme Demo/ })).toBeNull();
  });

  it("scenario 3: an invalid identifier and a whitespace-only display name are reported together", async () => {
    const { api, user } = await renderSignedIn("#/organizations/new");

    await user.type(screen.getByLabelText("Organization name"), "-invalid-organization");
    await user.type(screen.getByLabelText("Display name"), "   ");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name format is invalid")).toBeTruthy();
    expect(screen.getByText("Display name is required")).toBeTruthy();
    expect(window.location.hash).toBe("#/organizations/new");
    expect(api.organizations).toHaveLength(1);
  });

  it("requires a session for the organization pages", async () => {
    createFakeApi().install();
    await renderAt("#/organizations");

    expect(await screen.findByRole("heading", { name: "Sign in required" })).toBeTruthy();
    goto("#/organizations/new");
    expect(await screen.findByRole("heading", { name: "Sign in required" })).toBeTruthy();
  });

  it("an unknown organization address shows the not-found view", async () => {
    createFakeApi().install();
    await renderAt("#/organizations/does-not-exist");

    expect(await screen.findByRole("heading", { name: "Organization not found" })).toBeTruthy();
  });

  it("a visitor gets no access to a private repository address", async () => {
    createFakeApi().install();
    await renderAt("#/organizations/acme-demo/repositories/secret-research");

    expect(await screen.findByRole("heading", { name: "Repository not found" })).toBeTruthy();
  });

  it("a signed-in unauthorized account sees Access denied for a private repository", async () => {
    const api = createFakeApi({
      accounts: [
        ORG_OWNER,
        { username: "new-member", email: "new-member@example.test", password: "Valid-password-123!" },
      ],
      organizations: [
        {
          slug: "acme-demo",
          name: "Acme Demo",
          displayName: "Acme Demo",
          owners: ["org-owner"],
          members: ["new-member"],
          repositories: [
            { name: "acme-docs", description: "Docs", visibility: "public", updatedAt: "2024-05-02T09:30:00.000Z" },
            { name: "secret-research", description: "Secret", visibility: "private", updatedAt: "2024-05-03T11:15:00.000Z" },
          ],
        },
      ],
    });
    api.install();
    api.signInAs("new-member");
    goto("#/organizations/acme-demo/repositories/secret-research");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  });

  it("the organization overview exposes Repositories, People and Teams as links", async () => {
    createFakeApi().install();
    const user = await renderAt("#/organizations/acme-demo");

    expect(await screen.findByRole("heading", { name: "Acme Demo" })).toBeTruthy();
    for (const label of ["Repositories", "People", "Teams"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(`#/organizations/acme-demo/${label.toLowerCase()}`);
    }

    await user.click(screen.getByRole("link", { name: "People" }));
    expect(await screen.findByText("org-owner")).toBeTruthy();
    expect(await screen.findByText("Owner")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Teams" }));
    expect(await screen.findByText(/no teams yet/i)).toBeTruthy();
  });
});
