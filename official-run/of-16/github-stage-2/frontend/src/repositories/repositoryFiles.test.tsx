import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeAccount } from "../test-utils/fake-api";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/** The seeded contributor and the public repository it may write to. */
const CONTRIBUTOR: FakeAccount = {
  username: "file-contributor",
  email: "file-contributor@example.test",
  password: "Valid-password-123!",
  repositories: [
    {
      name: "file-management-demo",
      description: "Demonstrates adding files through the web interface.",
      visibility: "public",
      updatedAt: hoursAgo(6),
      files: ["README.md"],
    },
  ],
};

/** An account that may read the public repository without writing to it. */
const BROWSER: FakeAccount = {
  username: "default-branch-viewer",
  email: "default-branch-viewer@example.test",
  password: "Valid-password-123!",
};

const CODE_HASH = "#/users/file-contributor/repositories/file-management-demo";
const EDITOR_HASH = `${CODE_HASH}/new/main`;

function fixture() {
  return createFakeApi({ accounts: [CONTRIBUTOR, BROWSER] });
}

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
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

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Add file" }));
  await user.click(await screen.findByRole("link", { name: "Create new file" }));
  await screen.findByRole("heading", { name: "Create new file" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("REQ-4-4 add a file through the web interface", () => {
  it("scenario 1: the contributor submits a file and its Commits link exposes the message", async () => {
    const { user } = await renderSignedIn("#/", "file-contributor");

    // The signed-in username is visible before the repository entry is opened.
    expect(screen.getByRole("link", { name: "Account menu" }).textContent).toBe("file-contributor");
    await user.click(await screen.findByRole("link", { name: "file-management-demo" }));
    expect(await screen.findByRole("heading", { name: "file-contributor/file-management-demo" })).toBeTruthy();

    await openEditor(user);
    // The editor exposes the repository, the branch and the four controls.
    expect(screen.getByText("Branch main")).toBeTruthy();
    const nameField = screen.getByLabelText("File name");
    expect(screen.getByLabelText("File contents")).toBeTruthy();
    expect(screen.getByLabelText("Commit message")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Commit changes" });

    await user.type(nameField, "pw-file-1.md");
    await user.type(screen.getByLabelText("File contents"), "Added through the web interface");
    await user.type(screen.getByLabelText("Commit message"), "Add pw-file-1.md");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);

    // The read-only file view of the created file shows the exact content.
    await waitFor(() => {
      expect(window.location.hash).toBe(`${CODE_HASH}/blob/main/pw-file-1.md`);
    });
    const content = await screen.findByText("Added through the web interface");
    expect(content.tagName).toBe("PRE");

    // Its "Commits" link opens the history containing the commit message.
    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("link", { name: "Add pw-file-1.md" })).toBeTruthy();

    // Reloading the file view reads the same stored content.
    goto(`${CODE_HASH}/blob/main/pw-file-1.md`);
    expect((await screen.findByText("Added through the web interface")).tagName).toBe("PRE");
  });

  it("scenario 2: an invalid path with a missing message is reported and accepted nowhere", async () => {
    const { api, user } = await renderSignedIn(CODE_HASH, "file-contributor");
    await screen.findByRole("heading", { name: "file-contributor/file-management-demo" });

    await openEditor(user);
    await user.type(screen.getByLabelText("File name"), "../invalid.md");
    await user.type(screen.getByLabelText("File contents"), "must not be saved");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    // Both reasons of the invalid submission are displayed in the page.
    expect(await screen.findByText("Invalid file path")).toBeTruthy();
    expect(screen.getByText("Commit message is required")).toBeTruthy();
    // The form stays where it is and nothing was stored.
    expect(window.location.hash).toBe(EDITOR_HASH);
    const stored = api.accounts[0].repositories?.[0];
    expect(stored?.branches?.flatMap((branch) => branch.files ?? []) ?? ["README.md"]).not.toContain("invalid.md");
    expect(JSON.stringify(api.accounts[0].repositories)).not.toContain("must not be saved");
  });

  it("offers the Add file entry only on a writable Code page and refuses a reader's submission", async () => {
    const { user } = await renderSignedIn(CODE_HASH, "default-branch-viewer");
    await screen.findByRole("heading", { name: "file-contributor/file-management-demo" });
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();

    // The editor address stays openable, but the submission is refused by the
    // server and the page reports the reason.
    goto(EDITOR_HASH);
    await screen.findByRole("heading", { name: "Create new file" });
    await user.type(screen.getByLabelText("File name"), "pw-file-denied.md");
    await user.type(screen.getByLabelText("File contents"), "denied content");
    await user.type(screen.getByLabelText("Commit message"), "Add pw-file-denied.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Access denied")).toBeTruthy();
    expect(window.location.hash).toBe(EDITOR_HASH);
  });
});
