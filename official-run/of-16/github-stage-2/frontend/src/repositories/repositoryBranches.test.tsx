import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import {
  createFakeApi,
  type FakeAccessGrant,
  type FakeAccount,
  type FakeOrganization,
} from "../test-utils/fake-api";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const CONTRIBUTOR: FakeAccount = {
  username: "branch-contributor",
  email: "branch-contributor@example.test",
  password: "Valid-password-123!",
};

const ADMIN: FakeAccount = {
  username: "default-branch-admin",
  email: "default-branch-admin@example.test",
  password: "Valid-password-123!",
};

const VIEWER: FakeAccount = {
  username: "default-branch-viewer",
  email: "default-branch-viewer@example.test",
  password: "Valid-password-123!",
};

const BRANCH_DEMO = {
  name: "branch-switch-demo",
  description: "Demonstrates listing and switching repository branches.",
  visibility: "public" as const,
  updatedAt: hoursAgo(2),
  defaultBranch: "main",
  branches: [
    { name: "main", files: ["README.md"] },
    { name: "feature-search", files: ["README.md", "main-only.md"] },
  ],
};

const DEFAULT_DEMO = {
  name: "default-branch-demo",
  description: "Demonstrates changing the repository default branch.",
  visibility: "public" as const,
  updatedAt: hoursAgo(5),
  defaultBranch: "main",
  branches: [
    { name: "main", files: ["README.md"] },
    { name: "release", files: ["README.md", "release-notes.md"] },
  ],
};

const ACME_DEMO: FakeOrganization = {
  slug: "acme-demo",
  name: "Acme Demo",
  displayName: "Acme Demo",
  repositories: [BRANCH_DEMO, DEFAULT_DEMO],
};

const GRANTS: FakeAccessGrant[] = [
  {
    id: "grant-branch-contributor",
    repositoryName: "branch-switch-demo",
    username: "branch-contributor",
    role: "write",
  },
  {
    id: "grant-default-branch-admin",
    repositoryName: "default-branch-demo",
    username: "default-branch-admin",
    role: "admin",
  },
];

function fixture() {
  return createFakeApi({
    accounts: [CONTRIBUTOR, ADMIN, VIEWER],
    organizations: [ACME_DEMO],
    grants: GRANTS,
  });
}

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function renderVisitor(hash: string) {
  const api = fixture();
  api.install();
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("main");
  return { api, user };
}

async function renderSignedIn(hash: string, username: string) {
  const api = fixture();
  api.install();
  api.signInAs(username);
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("link", { name: "Account menu" });
  return { api, user };
}

const BRANCH_DEMO_HASH = "#/organizations/acme-demo/repositories/branch-switch-demo";

async function openBranchSelector(user: ReturnType<typeof userEvent.setup>, branch: string) {
  await user.click(await screen.findByRole("button", { name: `Branch ${branch}` }));
  return screen.getByRole("textbox", { name: "Find branch" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("REQ-4-3-1 list and switch repository branches", () => {
  it("scenario 1: the visitor switches to feature-search and gets the target-only file", async () => {
    const { user } = await renderVisitor("#/");
    await user.click(await screen.findByRole("link", { name: "branch-switch-demo" }));
    expect(await screen.findByRole("heading", { name: "Acme Demo/branch-switch-demo" })).toBeTruthy();

    // The selector starts on the active branch and lists the available ones.
    const find = await openBranchSelector(user, "main");
    expect(screen.getByRole("option", { name: "main" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull();

    // Typing filters without Enter and selecting switches the snapshot.
    await user.type(find, "feature-search");
    await user.click(screen.getByRole("option", { name: "feature-search" }));

    await waitFor(() => {
      expect(window.location.hash).toBe(`${BRANCH_DEMO_HASH}?branch=feature-search`);
    });
    expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    const targetFile = await screen.findByRole("link", { name: "main-only.md" });
    expect(targetFile.getAttribute("href")).toBe(
      "#/organizations/acme-demo/repositories/branch-switch-demo/blob/feature-search/main-only.md",
    );

    // Reloading keeps the switched branch and its file.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "main-only.md" })).toBeTruthy();
  });

  it("scenario 2: an unmatched query keeps the active branch and Escape closes the selector", async () => {
    const { user } = await renderVisitor(BRANCH_DEMO_HASH);
    await screen.findByRole("heading", { name: "Acme Demo/branch-switch-demo" });

    // A fresh visitor session has no write permission, so an unused name has no
    // matching branch and no creation option.
    const find = await openBranchSelector(user, "main");
    await user.type(find, "missing-branch");
    expect(await screen.findByText("No matching branch")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toEqual([]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();

    // Reloading the same address reads the same active branch.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull();
  });
});

describe("REQ-4-3-2 create a branch from an existing revision", () => {
  it("scenario 1: the Write contributor creates a branch and keeps it after a reload", async () => {
    const { user } = await renderSignedIn(BRANCH_DEMO_HASH, "branch-contributor");
    await screen.findByRole("heading", { name: "Acme Demo/branch-switch-demo" });

    const find = await openBranchSelector(user, "main");
    await user.type(find, "pw-branch-1");

    const createOption = await screen.findByRole("option", { name: "Create branch: pw-branch-1" });
    await user.click(createOption);

    await waitFor(() => {
      expect(window.location.hash).toBe(`${BRANCH_DEMO_HASH}?branch=pw-branch-1`);
    });
    expect(await screen.findByRole("button", { name: "Branch pw-branch-1" })).toBeTruthy();
    // The new branch browses the revision it was created from.
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();

    cleanup();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Branch pw-branch-1" })).toBeTruthy();
  });

  it("scenario 2: a malformed name shows the Invalid branch message", async () => {
    const { user } = await renderSignedIn(BRANCH_DEMO_HASH, "branch-contributor");
    await screen.findByRole("heading", { name: "Acme Demo/branch-switch-demo" });

    const find = await openBranchSelector(user, "main");
    await user.type(find, "invalid..branch");

    expect(await screen.findByText("Invalid branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create branch/ })).toBeNull();
  });

  it("keeps browsing visitors without a creation option", async () => {
    const { user } = await renderVisitor(BRANCH_DEMO_HASH);
    await screen.findByRole("heading", { name: "Acme Demo/branch-switch-demo" });

    const find = await openBranchSelector(user, "main");
    await user.type(find, "visitor-branch");
    expect(await screen.findByText("No matching branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create branch/ })).toBeNull();
  });
});

describe("REQ-4-3-3 change the repository default branch", () => {
  it("scenario 1: the administrator confirms release, and main stays selectable", async () => {
    const { user } = await renderSignedIn(
      "#/organizations/acme-demo/repositories/default-branch-demo",
      "default-branch-admin",
    );
    await screen.findByRole("heading", { name: "Acme Demo/default-branch-demo" });
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Branches" }));

    const select = await screen.findByLabelText("Default branch");
    expect((select as HTMLSelectElement).value).toBe("main");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["main", "release"]);

    await user.selectOptions(select, "release");
    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Default branch updated.")).toBeTruthy();

    // Reopening the repository reads the new default branch, and the previous
    // branch is still offered by the selector.
    goto("#/organizations/acme-demo/repositories/default-branch-demo");
    expect(await screen.findByRole("button", { name: "Branch release" })).toBeTruthy();
    await openBranchSelector(user, "release");
    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "release" }).getAttribute("aria-selected")).toBe("true");
  });

  it("scenario 2: a non-administrator gets no actionable default-branch control", async () => {
    await renderSignedIn("#/organizations/acme-demo/repositories/default-branch-demo", "default-branch-viewer");
    await screen.findByRole("heading", { name: "Acme Demo/default-branch-demo" });

    // The Settings entry is administrator-only, and the branches address is
    // readable but offers no control.
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    goto("#/organizations/acme-demo/repositories/default-branch-demo/settings/branches");
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update default branch" })).toBeNull();
    // Repository content stays browsable for the same viewer.
    goto("#/organizations/acme-demo/repositories/default-branch-demo");
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
  });
});
