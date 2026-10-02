import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeAccount, type FakeOrganization } from "../test-utils/fake-api";

const ORG_OWNER: FakeAccount = {
  username: "org-owner",
  email: "org-owner@example.test",
  password: "Valid-password-123!",
};

const REPO_OWNER: FakeAccount = {
  username: "repo-owner",
  email: "repo-owner@example.test",
  password: "Valid-password-123!",
  repositories: [
    {
      name: "acme-docs",
      description: "Personal notes kept next to the Acme Demo documentation.",
      visibility: "private",
      updatedAt: "2024-05-04T08:00:00.000Z",
    },
  ],
};

const ACME_DEMO: FakeOrganization = {
  slug: "acme-demo",
  name: "Acme Demo",
  displayName: "Acme Demo",
  owners: ["org-owner"],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation, guides and release notes for Acme Demo.",
      visibility: "public",
      updatedAt: "2024-05-02T09:30:00.000Z",
    },
    {
      name: "secret-research",
      description: "Confidential research notes.",
      visibility: "private",
      updatedAt: "2024-05-03T11:15:00.000Z",
    },
  ],
};

function fixture() {
  return createFakeApi({ accounts: [ORG_OWNER, REPO_OWNER], organizations: [ACME_DEMO] });
}

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function renderVisitor() {
  const api = fixture();
  api.install();
  goto("#/");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("main");
  return { api, user };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("REQ-3-1 search for and locate repositories", () => {
  it("scenario 1 and 4: a visitor searches, opens the acme-docs result and keeps the heading after a reload", async () => {
    const { user } = await renderVisitor();

    const searchbox = screen.getByRole("searchbox", { name: "Search" });
    await user.type(searchbox, "acme-docs{Enter}");

    // Enter alone shows the repository results; no type filter is needed.
    const result = await screen.findByRole("link", { name: "acme-docs" });
    expect(result.getAttribute("href")).toBe("#/organizations/acme-demo/repositories/acme-docs");
    // The result shows the owner/name metadata in addition to the link.
    expect(screen.getByText("Acme Demo/acme-docs")).toBeTruthy();

    await user.click(result);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/organizations/acme-demo/repositories/acme-docs");
    });
    expect(await screen.findByRole("heading", { name: "Acme Demo/acme-docs" })).toBeTruthy();

    // Reloading the repository overview preserves the heading.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Acme Demo/acme-docs" })).toBeTruthy();
  });

  it("scenario 2: the private repository never appears in the results of a visitor", async () => {
    const { user } = await renderVisitor();

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "secret-research{Enter}");

    await screen.findByText("No results");
    // The empty state also carries the repository-oriented "No repositories" wording.
    expect(screen.getByText("No repositories")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
  });

  it("scenario 3: an unmatched query shows No results, also when repeated from the home page", async () => {
    const { user } = await renderVisitor();

    const searchbox = screen.getByRole("searchbox", { name: "Search" });
    await user.type(searchbox, "no-such-repository{Enter}");
    await screen.findByText("No results");
    expect(screen.getByText("No repositories")).toBeTruthy();

    // Returning home and repeating the very same query shows the same message.
    await user.click(screen.getByRole("link", { name: "ShallowCode" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#/");
    });
    await screen.findByRole("heading", { name: "Collaborate on code" });

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "no-such-repository{Enter}");
    await screen.findByText("No results");
    expect(screen.getByText("No repositories")).toBeTruthy();
  });

  it("lets a signed-in account find a private repository it is authorized to view", async () => {
    const api = fixture();
    api.install();
    api.signInAs("org-owner");
    goto("#/");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "Account menu" });

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "secret-research{Enter}");

    const result = await screen.findByRole("link", { name: "secret-research" });
    expect(result.getAttribute("href")).toBe("#/organizations/acme-demo/repositories/secret-research");
  });
});
