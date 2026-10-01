import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";

const OWNER = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

const MEMBER = {
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  password: "Valid-password-123!",
};

const README_MAIN = [
  "# Acme Docs",
  "",
  "The search flow starts in the search box at the top of every page.",
  "",
].join("\n");

const README_FEATURE = [
  "# Acme Docs",
  "",
  "Draft documentation for the search prototype.",
  "",
  "The search flow of this prototype is still being written.",
  "",
].join("\n");

const MAIN_ONLY = ["# Prototype notes", "", "Only feature-search carries this file.", ""].join("\n");

const MAIN_FILES = [
  { path: "README.md", content: README_MAIN },
  { path: "docs/getting-started.md", content: "# Getting started\n" },
];

const FEATURE_FILES = [
  { path: "README.md", content: README_FEATURE },
  { path: "main-only.md", content: MAIN_ONLY },
];

const RELEASE_FILES = [
  ...MAIN_FILES,
  { path: "RELEASE.md", content: "# Release 1.0\n" },
];

const COMMITS = [
  {
    sha: "a1b2c3d",
    message: "Initial commit",
    author: "alice-dev",
    createdAt: "2024-01-02T00:00:00.000Z",
    parentSha: null,
    files: [{ path: "docs/getting-started.md", content: "# Getting started\n" }],
  },
  {
    sha: "d4e5f6a",
    message: "Document search flow",
    author: "alice-dev",
    createdAt: "2024-01-03T00:00:00.000Z",
    parentSha: "a1b2c3d",
    files: MAIN_FILES,
  },
  {
    sha: "f7a8b9c",
    message: "Draft search prototype",
    author: "alice-dev",
    createdAt: "2024-01-04T00:00:00.000Z",
    parentSha: "d4e5f6a",
    files: FEATURE_FILES,
  },
  {
    sha: "b8c9d0e",
    message: "Prepare release",
    author: "alice-dev",
    createdAt: "2024-01-05T00:00:00.000Z",
    parentSha: "d4e5f6a",
    files: RELEASE_FILES,
  },
];

const ORGANIZATION: StubOrganization = {
  name: "acme-demo",
  displayName: "Acme Demo",
  members: [
    { username: "alice-dev", role: "owner" },
    { username: "bob-reviewer", role: "member" },
  ],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation for the Acme Demo platform.",
      visibility: "public",
      defaultBranch: "main",
      branches: ["main", "feature-search", "release"],
      files: MAIN_FILES,
      commits: COMMITS,
      branchHeads: { main: "d4e5f6a", "feature-search": "f7a8b9c", release: "b8c9d0e" },
    },
  ],
};

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again against the same stub state, like a page reload. */
function reload() {
  cleanup();
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  renderApp("#/login");
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

async function openBranchSelector(user: ReturnType<typeof userEvent.setup>, name = "main") {
  await user.click(await screen.findByRole("button", { name: `Branch ${name}` }));
  return screen.findByRole("textbox", { name: "Find branch" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-4-3-1 list and switch repository branches", () => {
  it("switches the Code page to another branch from the branch selector", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs");

    const trigger = await screen.findByRole("button", { name: "Branch main" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    const findBranch = await screen.findByRole("textbox", { name: "Find branch" });
    await user.type(findBranch, "feature-search");

    const option = await screen.findByRole("option", { name: "feature-search" });
    await user.click(option);

    // The selector, the page entry and the file list all switch together.
    expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "main-only.md" })).toBeTruthy();
    expect(window.location.hash).toContain("tree/feature-search");

    // The known file shows the content of the selected branch.
    await user.click(screen.getByRole("link", { name: "README.md" }));
    expect(await screen.findByText(/Draft documentation for the search prototype/)).toBeTruthy();
    expect(screen.getByText("Branch: feature-search")).toBeTruthy();

    // Switching back restores the other revision without creating a commit.
    const back = await openBranchSelector(user, "feature-search");
    await user.clear(back);
    await user.type(back, "main");
    await user.click(await screen.findByRole("option", { name: "main" }));
    expect(await screen.findByText(/The search flow starts in the search box/)).toBeTruthy();
    expect(screen.getByText("Branch: main")).toBeTruthy();
  });

  it("keeps an unmatched search from changing the active branch, even after a reload", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/repositories/acme-demo/acme-docs");

    const findBranch = await openBranchSelector(user);
    await user.type(findBranch, "no-such-branch");

    expect(await screen.findByText("No matching branch")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull();

    const address = window.location.hash;
    reload();
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(window.location.hash).toBe(address);
  });
});

describe("REQ-4-3-2 create a branch from an existing revision", () => {
  it("offers Create branch for a valid unused name and switches to it", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    window.location.hash = "#/repositories/acme-demo/acme-docs";

    const findBranch = await openBranchSelector(user);

    // An invalid name is reported as soon as it is typed.
    await user.type(findBranch, "invalid..branch");
    expect(await screen.findByText("Invalid branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Create branch: invalid..branch" })).toBeNull();

    await user.clear(findBranch);
    await user.type(findBranch, "feature/api-v2");
    const createOption = await screen.findByRole("option", {
      name: "Create branch: feature/api-v2",
    });
    await user.click(createOption);

    // Creating switches the browsing context to the new branch.
    expect(await screen.findByRole("button", { name: "Branch feature/api-v2" })).toBeTruthy();

    reload();
    expect(await screen.findByRole("button", { name: "Branch feature/api-v2" })).toBeTruthy();
  });

  it("does not offer branch creation to a viewer without Write permission", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);
    window.location.hash = "#/repositories/acme-demo/acme-docs";

    const findBranch = await openBranchSelector(user);
    await user.type(findBranch, "feature/api-v2");

    expect(screen.queryByRole("option", { name: "Create branch: feature/api-v2" })).toBeNull();
    expect(await screen.findByText("No matching branch")).toBeTruthy();
  });
});

describe("REQ-4-3-3 change the repository default branch", () => {
  it("an Admin changes the default branch and the repository entry opens it", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    window.location.hash = "#/repositories/acme-demo/acme-docs";

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("link", { name: "Branches" }));

    const dropdown = await screen.findByRole("combobox", { name: "Default branch" });
    await user.selectOptions(dropdown, "release");
    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/Default branch updated to release/)).toBeTruthy();

    // The setting survives a reload of the settings page.
    reload();
    expect(await screen.findByRole("combobox", { name: "Default branch" })).toHaveProperty(
      "value",
      "release",
    );

    // Opening the repository entry without a branch now shows the new default,
    // and the old default branch stays available in the selector.
    window.location.hash = "#/repositories/acme-demo/acme-docs";
    await screen.findByRole("button", { name: "Branch release" });
    await user.click(screen.getByRole("button", { name: "Branch release" }));
    expect(await screen.findByRole("option", { name: "main" })).toBeTruthy();
  });

  it("renders no default-branch update control for a non-Admin", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);

    window.location.hash = "#/repositories/acme-demo/acme-docs/settings/branches";
    expect(await screen.findByRole("heading", { name: "Branches" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(await screen.findByText(/Only a repository administrator/)).toBeTruthy();
  });
});

describe("REQ-4-4 manage repository files through the web interface", () => {
  it("creates a file, shows its content and records the commit message", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    window.location.hash = "#/repositories/acme-demo/acme-docs";

    await user.click(await screen.findByRole("button", { name: "Add file" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create new file" }));

    const fileName = await screen.findByLabelText("File name");
    await user.type(fileName, "docs/guide.md");
    await user.type(screen.getByLabelText("File contents"), "Read the guide.");
    await user.type(screen.getByLabelText("Commit message"), "Add docs/guide.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    // The saved content is displayed as a complete text value.
    expect(await screen.findByText("Read the guide.")).toBeTruthy();
    expect(screen.getByText("Path: docs/guide.md")).toBeTruthy();

    // Its `Commits` link opens the history with the submitted message.
    await user.click(await screen.findByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("heading", { name: "Add docs/guide.md" })).toBeTruthy();
  });

  it("opens the editor from Edit on a file page and commits the change", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    window.location.hash = "#/repositories/acme-demo/acme-docs/blob/main/README.md";

    await user.click(await screen.findByRole("link", { name: "Edit" }));

    const contents = await screen.findByLabelText("File contents");
    expect(contents).toHaveProperty("value", README_MAIN);
    expect(screen.getByLabelText("File name")).toHaveProperty("value", "README.md");
    expect(screen.getByLabelText("Commit message")).toHaveProperty("value", "");

    await user.clear(contents);
    await user.type(contents, "Edited through the editor.");
    await user.type(screen.getByLabelText("Commit message"), "Update README.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Edited through the editor.")).toBeTruthy();
    expect(screen.getByText("Path: README.md")).toBeTruthy();
    await user.click(await screen.findByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("heading", { name: "Update README.md" })).toBeTruthy();
  });

  it("reports an invalid path and a missing message without writing anything", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    window.location.hash = "#/repositories/acme-demo/acme-docs";

    await user.click(await screen.findByRole("button", { name: "Add file" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create new file" }));

    await user.type(await screen.findByLabelText("File name"), "../invalid.md");
    await user.type(screen.getByLabelText("File contents"), "must not be saved");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Invalid file path")).toBeTruthy();
    expect(screen.getByText("Commit message is required")).toBeTruthy();
    // Nothing was saved, so the editor stays in place.
    expect(window.location.hash).toContain("/edit/main");

    // The repository file list is unchanged.
    window.location.hash = "#/repositories/acme-demo/acme-docs";
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    const files = within(screen.getByRole("region", { name: "Files" })).getAllByRole("link");
    expect(files.map((link) => link.textContent)).toEqual([
      "docs",
      "README.md",
    ]);
  });
});
