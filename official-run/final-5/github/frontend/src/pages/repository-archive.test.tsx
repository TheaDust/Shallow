import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

/** Re-renders the application from scratch, as a browser reload would. */
function reload() {
  cleanup();
  render(<App />);
}

/** Signs in with one of the REQ-3-5 accounts, which carry their own password. */
async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens one repository from the signed-in workspace list. */
async function openRepository(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("link", { name }));
  await screen.findByRole("heading", { name: new RegExp(name) });
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

describe("REQ-3-5 archive and restore a repository", () => {
  it("lets the Admin archive the active repository and keeps the marker after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    await openRepository(user, "evo-archive-repository-s1");
    expect(screen.queryByText("Archived")).toBeNull();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    const general = await screen.findByRole("region", { name: "General" });
    await user.click(within(general).getByRole("button", { name: "Archive repository" }));

    // The confirmation element carries the dialog role and the exact name, and
    // its confirmation button is the archive action.
    const dialog = await screen.findByRole("dialog", { name: "Archive repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm archive" }));

    await screen.findByRole("heading", { name: /evo-archive-repository-s1/ });
    expect(await screen.findByText("Archived")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: /evo-archive-repository-s1/ });
    expect(await screen.findByText("Archived")).not.toBeNull();
    // The archived repository is still readable.
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
  });

  it("keeps the archived repository readable while its write controls are not actionable", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-viewer");

    await openRepository(user, "evo-archive-repository-s2");
    expect(await screen.findByText("Archived")).not.toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    // File editing stays visible but is non-actionable.
    const addFile = screen.getByRole("button", { name: "Add file" }) as HTMLButtonElement;
    expect(addFile.disabled).toBe(true);

    // Issue creation stays visible but is non-actionable.
    await user.click(screen.getByRole("link", { name: "Issues" }));
    await screen.findByRole("heading", { name: "Issues" });
    const newIssue = await screen.findByRole("link", { name: "New issue" });
    expect(newIssue.getAttribute("aria-disabled")).toBe("true");

    // Pull-request creation stays visible but is non-actionable.
    await user.click(await screen.findByRole("link", { name: "evo-archive-org/evo-archive-repository-s2" }));
    await screen.findByRole("heading", { name: /evo-archive-repository-s2/ });
    await user.click(screen.getByRole("link", { name: "Pull requests" }));
    await screen.findByRole("heading", { name: "Pull requests" });
    const newPull = await screen.findByRole("link", { name: "New pull request" });
    expect(newPull.getAttribute("aria-disabled")).toBe("true");
  });

  it("lets the Admin restore the archived repository and its content stays visible", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    await openRepository(user, "evo-archive-repository-s3");
    expect(await screen.findByText("Archived")).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    const general = await screen.findByRole("region", { name: "General" });
    await user.click(within(general).getByRole("button", { name: "Restore repository" }));

    const dialog = await screen.findByRole("dialog", { name: "Restore repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm restore" }));

    await screen.findByRole("heading", { name: /evo-archive-repository-s3/ });
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: /evo-archive-repository-s3/ });
    expect(screen.queryByText("Archived")).toBeNull();
    // The repository is Active again, so file editing is actionable.
    expect((screen.getByRole("button", { name: "Add file" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
