import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedInSession } from "../../test/harness";
import type { RepositoryDetail } from "../../repo/types";

const PUBLIC_REPOSITORY: RepositoryDetail = {
  id: "repo-alice-acme-docs",
  name: "acme-docs",
  ownerType: "account",
  ownerName: "alice-dev",
  fullName: "alice-dev/acme-docs",
  description: "Alice's public documentation notes",
  visibility: "public",
  defaultBranch: "main",
  createdAt: "2024-02-05T09:00:00.000Z",
  updatedAt: "2024-03-20T10:15:00.000Z",
  files: [
    { name: "docs", path: "docs", type: "directory" },
    { name: "README.md", path: "README.md", type: "file" },
  ],
  commitCount: 1,
};

const PRIVATE_REPOSITORY: RepositoryDetail = {
  ...PUBLIC_REPOSITORY,
  id: "repo-acme-secret-research",
  name: "secret-research",
  ownerType: "organization",
  ownerName: "Acme Demo",
  fullName: "Acme Demo/secret-research",
  visibility: "private",
  description: "Private research material for the Acme platform",
};

function session(username: string) {
  return signedInSession(username, `${username}@example.test`);
}

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window.navigator as { clipboard?: unknown }).clipboard;
  writeText.mockClear();
});

describe("repository overview (REQ-3-3)", () => {
  it("shows the identity, visibility marker, file list and repository navigation", async () => {
    installFetch({
      "GET /api/auth/session": () => ({ status: 200, body: { account: null, session: null } }),
      "GET /api/repositories/alice-dev/acme-docs": () => ({
        status: 200,
        body: { repository: PUBLIC_REPOSITORY, viewerRole: null, repositoryRole: null },
      }),
    });
    renderApp("#/repositories/alice-dev/acme-docs");

    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).not.toBeNull();
    expect(screen.getByText("Public")).not.toBeNull();
    expect(screen.getByText("Alice's public documentation notes")).not.toBeNull();
    expect(screen.getByText("main")).not.toBeNull();

    const navigation = screen.getByRole("navigation", { name: "Repository" });
    expect(navigation.querySelector('a[href="#/repositories/alice-dev/acme-docs/code"]')).not.toBeNull();
    expect(navigation.querySelector('a[href="#/repositories/alice-dev/acme-docs/issues"]')).not.toBeNull();
    expect(navigation.querySelector('a[href="#/repositories/alice-dev/acme-docs/pulls"]')).not.toBeNull();
    expect(
      navigation.querySelector('a[href="#/repositories/alice-dev/acme-docs/settings"]'),
    ).not.toBeNull();

    expect(
      screen.getByRole("link", { name: "README.md" }).getAttribute("href"),
    ).toBe("#/repositories/alice-dev/acme-docs/blob/main/README.md");
    expect(screen.getByRole("link", { name: "docs" }).getAttribute("href")).toBe(
      "#/repositories/alice-dev/acme-docs/tree/main/docs",
    );
    expect(screen.getByRole("link", { name: "Commits" }).getAttribute("href")).toBe(
      "#/repositories/alice-dev/acme-docs/commits",
    );
    expect(screen.getByText("1 commit")).not.toBeNull();
  });

  it("denies a private repository the viewer may not read", async () => {
    installFetch({
      "GET /api/auth/session": () => session("bob-reviewer"),
      "GET /api/repositories/Acme%20Demo/secret-research": () => ({
        status: 403,
        body: { error: "Access denied" },
      }),
    });
    renderApp("#/repositories/Acme%20Demo/secret-research");
    expect(await screen.findByRole("heading", { name: "Access denied" })).not.toBeNull();
  });

  it("opens the code and file pages from the overview", async () => {
    installFetch({
      "GET /api/auth/session": () => ({ status: 200, body: { account: null, session: null } }),
      "GET /api/repositories/alice-dev/acme-docs": () => ({
        status: 200,
        body: { repository: PUBLIC_REPOSITORY },
      }),
      "GET /api/repositories/alice-dev/acme-docs/contents?branch=main&path=README.md": () => ({
        status: 404,
        body: { error: "Path not found" },
      }),
      "GET /api/repositories/alice-dev/acme-docs/contents?branch=main&path=docs": () => ({
        status: 200,
        body: {
          branch: "main",
          path: "docs",
          entries: [{ name: "overview.md", path: "docs/overview.md", type: "file" }],
        },
      }),
      "GET /api/repositories/alice-dev/acme-docs/file?branch=main&path=README.md": () => ({
        status: 200,
        body: {
          file: {
            name: "README.md",
            path: "README.md",
            branch: "main",
            content: "# acme-docs\n",
            updatedAt: "2024-03-20T10:15:00.000Z",
          },
          commit: { message: "Initial commit", authorName: "alice-dev", createdAt: "2024-02-05T09:00:00.000Z" },
        },
      }),
    });
    const user = userEvent.setup();
    renderApp("#/repositories/alice-dev/acme-docs");

    await user.click(await screen.findByRole("link", { name: "README.md" }));
    expect(await screen.findByText("# acme-docs")).not.toBeNull();
    expect(screen.getByText("Branch main")).not.toBeNull();

    window.location.hash = "#/repositories/alice-dev/acme-docs/tree/main/docs";
    expect(await screen.findByRole("link", { name: "overview.md" })).not.toBeNull();
  });
});

describe("repository clone popover (REQ-3-2-3)", () => {
  function installOverview() {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      "GET /api/repositories/alice-dev/acme-docs": () => ({
        status: 200,
        body: { repository: PUBLIC_REPOSITORY },
      }),
    });
  }

  it("copies the HTTPS and the SSH clone value and reports “Copied”", async () => {
    installOverview();
    const user = userEvent.setup();
    renderApp("#/repositories/alice-dev/acme-docs");

    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    const trigger = screen.getByRole("button", { name: "Code" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("tab", { name: "HTTPS" })).toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("tab", { name: "HTTPS" }).getAttribute("aria-selected")).toBe("true");

    const httpsValue = screen.getByLabelText("Clone value");
    expect(httpsValue).toHaveProperty("value", `https://${window.location.host}/alice-dev/acme-docs.git`);
    await user.click(screen.getByRole("button", { name: "Copy clone value" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(httpsValue.value));
    expect(await screen.findByText("Copied")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: "SSH" }));
    const sshValue = screen.getByLabelText("Clone value");
    expect(sshValue.value).toBe(`git@${window.location.host}:alice-dev/acme-docs.git`);
    await user.click(screen.getByRole("button", { name: "Copy clone value" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(sshValue.value));

    // Closing and reopening keeps the selected protocol.
    await user.click(trigger);
    expect(screen.queryByRole("tab", { name: "SSH" })).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole("tab", { name: "SSH" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Clone value").value).toBe(sshValue.value);
  });

  it("reads the private clone value of a repository the viewer may read", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      "GET /api/repositories/Acme%20Demo/secret-research": () => ({
        status: 200,
        body: { repository: PRIVATE_REPOSITORY, repositoryRole: "admin" },
      }),
    });
    const user = userEvent.setup();
    renderApp("#/repositories/Acme%20Demo/secret-research");

    expect(await screen.findByRole("heading", { name: "Acme Demo/secret-research" })).not.toBeNull();
    expect(screen.getByText("Private")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByLabelText("Clone value")).toHaveProperty(
      "value",
      `https://${window.location.host}/Acme Demo/secret-research.git`,
    );
  });
});
