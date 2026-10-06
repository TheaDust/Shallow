import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens the repository entry and then its Code page. */
async function openCode(user: ReturnType<typeof userEvent.setup>, repository: string) {
  await user.click(await screen.findByRole("link", { name: repository }));
  await screen.findByRole("heading", { name: new RegExp(repository) });
  await user.click(await screen.findByRole("link", { name: "Code" }));
  await screen.findByRole("heading", { name: "Code" });
}

async function openBranchSelector(user: ReturnType<typeof userEvent.setup>, branch: string) {
  await user.click(await screen.findByRole("button", { name: `Branch ${branch}` }));
  return screen.findByRole("textbox", { name: "Find branch" });
}

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-4-3-1 list and switch repository branches", () => {
  it("switches to the target branch and exposes the target-only file", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCode(user, "branch-switch-demo");

    const box = await openBranchSelector(user, "main");
    await user.type(box, "feature-search");
    await user.click(await screen.findByRole("option", { name: "feature-search" }));

    expect(await screen.findByRole("button", { name: "Branch feature-search" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "main-only.md" })).not.toBeNull();
    // The default branch keeps its own snapshot.
    expect(screen.queryByRole("link", { name: "README.md" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("button", { name: "Branch feature-search" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "main-only.md" })).not.toBeNull();
  });

  it("keeps the active branch on main for an unmatched query and after Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCode(user, "branch-switch-demo");

    const box = await openBranchSelector(user, "main");
    await user.type(box, "missing-branch");
    expect(await screen.findByText("No matching branch")).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull();
    expect(screen.getByRole("button", { name: "Branch main" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull();

    reload();
    expect(await screen.findByRole("button", { name: "Branch main" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull();
  });
});

describe("REQ-4-3-2 create a branch from an existing revision", () => {
  it("creates the generated branch from the selector and keeps it selected after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "branch-contributor");
    await openCode(user, "branch-switch-demo");

    const box = await openBranchSelector(user, "main");
    // The selector lists the exact branch names of the repository.
    expect(screen.getByRole("option", { name: "main" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "feature-search" })).not.toBeNull();

    await user.type(box, "pw-branch-1");
    const createOption = await screen.findByRole("option", { name: "Create branch: pw-branch-1" });
    await user.click(createOption);

    expect(await screen.findByRole("button", { name: "Branch pw-branch-1" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("button", { name: "Branch pw-branch-1" })).not.toBeNull();
  });

  it("reports an invalid branch name instead of offering to create it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "branch-contributor");
    await openCode(user, "branch-switch-demo");

    const box = await openBranchSelector(user, "main");
    await user.type(box, "invalid..branch");

    expect(await screen.findByText("Invalid branch")).not.toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByRole("button", { name: "Branch main" })).not.toBeNull();
  });

  it("does not offer branch creation to a visitor without write permission", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCode(user, "branch-switch-demo");

    const box = await openBranchSelector(user, "main");
    await user.type(box, "visitor-branch");
    expect(await screen.findByText("No matching branch")).not.toBeNull();
    expect(screen.queryByText(/Create branch/)).toBeNull();
  });
});

describe("REQ-4-3-3 change the repository default branch", () => {
  it("lets the administrator move the default branch and keeps both branches", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "default-branch-admin");
    await user.click(await screen.findByRole("link", { name: "default-branch-demo" }));
    await screen.findByRole("heading", { name: /default-branch-demo/ });

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    await user.click(await screen.findByRole("link", { name: "Branches" }));
    await screen.findByRole("heading", { name: "Branches" });

    const select = await screen.findByLabelText("Default branch");
    await user.selectOptions(select, "release");
    await user.click(screen.getByRole("button", { name: "Update" }));
    const dialog = await screen.findByRole("dialog", { name: "Change default branch" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("button", { name: "Branch release" })).not.toBeNull();

    reload();
    await screen.findByRole("button", { name: "Branch release" });
    await user.click(screen.getByRole("button", { name: "Branch release" }));
    expect(await screen.findByRole("option", { name: "main" })).not.toBeNull();

    // The previous default branch still reads its own snapshot.
    await user.click(screen.getByRole("option", { name: "main" }));
    await screen.findByRole("button", { name: "Branch main" });
    expect(screen.queryByRole("link", { name: "release-notes.md" })).toBeNull();
  });

  it("shows a non-administrator no actionable default-branch control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "default-branch-viewer");
    await user.click(await screen.findByRole("link", { name: "default-branch-demo" }));
    await screen.findByRole("heading", { name: /default-branch-demo/ });
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

    act(() => navigate("/repositories/acme-demo/default-branch-demo/settings"));
    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.queryByLabelText("Default branch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();

    act(() => navigate("/repositories/acme-demo/default-branch-demo/settings/branches"));
    await screen.findByRole("heading", { name: "Branches" });
    expect(screen.queryByLabelText("Default branch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update default branch" })).toBeNull();
  });
});

describe("REQ-4-4 manage repository files through the web interface", () => {
  it("adds a file through Add file / Create new file and exposes the commit message", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "file-contributor");
    await user.click(await screen.findByRole("link", { name: "file-management-demo" }));
    await screen.findByRole("heading", { name: /file-management-demo/ });

    await user.click(await screen.findByRole("button", { name: "Add file" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create new file" }));
    await screen.findByRole("heading", { name: "Create new file" });

    await user.type(screen.getByLabelText("File name"), "pw-file-1.md");
    await user.type(screen.getByLabelText("File contents"), "added through the web editor");
    await user.type(screen.getByLabelText("Commit message"), "Add pw-file-1.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByRole("heading", { name: "pw-file-1.md" })).not.toBeNull();
    expect(screen.getByText("added through the web editor")).not.toBeNull();

    await user.click(await screen.findByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("link", { name: "Add pw-file-1.md" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("link", { name: "Add pw-file-1.md" })).not.toBeNull();
  });

  it("reports an invalid path or missing message and keeps the repository unchanged", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "file-contributor");
    await openCode(user, "file-management-demo");

    await user.click(await screen.findByRole("button", { name: "Add file" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create new file" }));
    await screen.findByRole("heading", { name: "Create new file" });

    await user.type(screen.getByLabelText("File name"), "../invalid.md");
    await user.type(screen.getByLabelText("File contents"), "must not be saved");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Invalid file path")).not.toBeNull();
    expect(screen.getByText("Commit message is required")).not.toBeNull();
    // The editor stays open instead of showing a file page.
    expect(screen.getByRole("heading", { name: "Create new file" })).not.toBeNull();

    // A rejected submission leaves the branch head and its history unchanged.
    act(() => navigate("/repositories/acme-demo/file-management-demo/commits"));
    await screen.findByRole("heading", { name: "Commits" });
    expect(screen.queryByText(/invalid\.md/)).toBeNull();
    expect(screen.getByText("Initial commit")).not.toBeNull();
  });

  it("offers the file editor only to an account with write permission", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCode(user, "file-management-demo");
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();
  });
});
