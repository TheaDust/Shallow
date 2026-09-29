import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedInSession } from "../../test/harness";
import type { RepositoryDetail } from "../../repo/types";

const OWNERS = [
  { id: "acc-alice-dev", type: "account", name: "alice-dev", label: "alice-dev" },
  { id: "org-acme-demo", type: "organization", name: "Acme Demo", label: "Acme Demo" },
];

function session(username: string) {
  return signedInSession(username, `${username}@example.test`);
}

function createdRepository(name: string): RepositoryDetail {
  return {
    id: "repo-created",
    name,
    ownerType: "account",
    ownerName: "alice-dev",
    fullName: `alice-dev/${name}`,
    description: "Repository created by Playwright",
    visibility: "private",
    defaultBranch: "main",
    createdAt: "2024-05-01T09:00:00.000Z",
    updatedAt: "2024-05-01T09:00:00.000Z",
    files: [{ name: "README.md", path: "README.md", type: "file" }],
    commitCount: 1,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("repository creation (REQ-3-2-1)", () => {
  it("is opened from the signed-in workspace and defaults to the personal namespace", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      "GET /api/organizations?scope=mine": () => ({
        status: 200,
        body: { organizations: [{ name: "Acme Demo", displayName: "Acme Demo", role: "owner" }] },
      }),
      "GET /api/repositories?scope=mine": () => ({
        status: 200,
        body: {
          repositories: [
            {
              name: "acme-docs",
              description: "Alice's public documentation notes",
              visibility: "public",
              updatedAt: "2024-03-20T10:15:00.000Z",
            },
          ],
        },
      }),
      "GET /api/repository-owners": () => ({ status: 200, body: { owners: OWNERS } }),
    });
    const user = userEvent.setup();
    renderApp("#/");

    const newRepository = await screen.findByRole("link", { name: "New repository" });
    expect(newRepository.getAttribute("href")).toBe("#/new");
    expect(screen.getByRole("link", { name: "acme-docs" })).not.toBeNull();

    await user.click(newRepository);

    expect(await screen.findByRole("heading", { name: "New repository" })).not.toBeNull();
    const owner = await screen.findByLabelText("Owner");
    expect(owner).toHaveProperty("value", "account:alice-dev");
    expect(within(owner).getByRole("option", { name: "Acme Demo" })).not.toBeNull();
    expect(screen.getByLabelText("Repository name")).not.toBeNull();
    expect(screen.getByLabelText("Description")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Public" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "Private" })).toHaveProperty("checked", false);
    expect(screen.getByRole("checkbox", { name: "Add a README file" })).toHaveProperty(
      "checked",
      false,
    );
    expect(screen.getByRole("button", { name: "Create repository" })).not.toBeNull();
  });

  it("creates an initialized private repository and opens its overview", async () => {
    const name = "pw-repo-1";
    let posted: unknown = null;
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      "GET /api/repository-owners": () => ({ status: 200, body: { owners: OWNERS } }),
      "POST /api/repositories": (request) => {
        posted = request.body;
        return { status: 201, body: { repository: createdRepository(name) } };
      },
      [`GET /api/repositories/alice-dev/${name}`]: () => ({
        status: 200,
        body: { repository: createdRepository(name), viewerRole: null, repositoryRole: "admin" },
      }),
    });
    const user = userEvent.setup();
    renderApp("#/new");

    const nameField = await screen.findByLabelText("Repository name");
    await user.type(nameField, name);
    await user.type(screen.getByLabelText("Description"), "Repository created by Playwright");
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByRole("heading", { name: `alice-dev/${name}` })).not.toBeNull();
    expect(posted).toEqual({
      ownerType: "account",
      ownerName: "alice-dev",
      name,
      description: "Repository created by Playwright",
      visibility: "private",
      initialize: true,
    });
    expect(screen.getByText("Private")).not.toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
    expect(screen.getByText("1 commit")).not.toBeNull();
    expect(window.location.hash).toBe(`#/repositories/alice-dev/${name}`);
  });

  it("stays on the form and reports an empty or duplicate name", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      "GET /api/repository-owners": () => ({ status: 200, body: { owners: OWNERS } }),
      "POST /api/repositories": (request) => {
        const body = request.body as { name: string };
        const message =
          body.name.trim() === ""
            ? "Repository name is required"
            : "Repository name already exists";
        return { status: 400, body: { error: "Repository creation failed", errors: { name: message } } };
      },
    });
    const user = userEvent.setup();
    renderApp("#/new");

    await user.click(await screen.findByRole("button", { name: "Create repository" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Repository name is required",
    );

    await user.type(screen.getByLabelText("Repository name"), "acme-docs");
    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Repository name already exists",
    );
    expect(screen.getByRole("heading", { name: "New repository" })).not.toBeNull();
    expect(window.location.hash).toBe("#/new");
    expect(screen.getByLabelText("Repository name")).toHaveProperty("value", "acme-docs");
  });

  it("requires a session", async () => {
    installFetch({
      "GET /api/auth/session": () => ({ status: 200, body: { account: null, session: null } }),
    });
    renderApp("#/new");
    expect(await screen.findByRole("heading", { name: "Sign in to continue" })).not.toBeNull();
  });
});
