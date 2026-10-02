import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  MERGEABLE_PULL_ADDRESS,
  PULL_OWNER,
  PULL_REVIEWER,
  PULLS_SEED_ORGANIZATION,
} from "../../test-support/pull-fixtures";

const PULL_ADDRESS = "#/repositories/acme-demo/acme-docs/pulls/1";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again, like a reload of the same address. */
function reload() {
  cleanup();
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  window.location.hash = "#/";
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** The visible status text of the detail page. */
function statusText(): HTMLElement {
  return document.querySelector(".pull-request-detail__status") as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

function installSeed() {
  installAuthStub({
    accounts: [PULL_OWNER, PULL_REVIEWER],
    organizations: [PULLS_SEED_ORGANIZATION],
  });
}

describe("REQ-6-6 close or reopen a pull request without merging", () => {
  it("the author closes and reopens the seeded Open pull request", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = PULL_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });

    expect(statusText().textContent).toBe("Open");
    expect(screen.getByRole("button", { name: "Close pull request" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();

    // Closing acts immediately, without a confirmation dialog.
    await user.click(screen.getByRole("button", { name: "Close pull request" }));
    expect(await screen.findByRole("button", { name: "Reopen pull request" })).toBeTruthy();
    expect(statusText().textContent).toBe("Closed");
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    // The discussion, the diff and the branch references stay readable.
    expect(screen.getByText("Document the onboarding improvement.")).toBeTruthy();
    expect(screen.getByLabelText("Comments")).toBeTruthy();

    // The timeline records the transition.
    const activity = screen.getByLabelText("Activity");
    expect(within(activity).getByText("closed this pull request")).toBeTruthy();

    // Reopening restores Open and records the second transition.
    await user.click(screen.getByRole("button", { name: "Reopen pull request" }));
    expect(await screen.findByRole("button", { name: "Close pull request" })).toBeTruthy();
    expect(statusText().textContent).toBe("Open");
    expect(within(screen.getByLabelText("Activity")).getByText("reopened this pull request")).toBeTruthy();

    // The final Open status and the original discussion survive a reload.
    reload();
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(statusText().textContent).toBe("Open");
    expect(screen.getByText("Document the onboarding improvement.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close pull request" })).toBeTruthy();
  });

  it("a viewer who is neither the author nor a maintainer gets neither control", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = PULL_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });

    // `bob-reviewer` holds Write, so he is neither the author nor a Maintain of
    // this pull request: both controls are absent, not merely disabled.
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();
    expect(statusText().textContent).toBe("Open");
    // The pull request really is an Open one: the disabled merge entry stays.
    const merge = screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
  });

  it("a Merged pull request displays no close or reopen operation", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = MERGEABLE_PULL_ADDRESS;
    await screen.findByRole("heading", { name: "Ship the search fixes" });

    // Only the eligible record of the protected `main` may be merged, and the
    // merge is completed in its own confirmation box.
    const merge = screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement;
    expect(merge.disabled).toBe(false);
    await user.click(merge);
    await user.click(await screen.findByRole("button", { name: "Confirm merge" }));
    await waitFor(() => expect(statusText().textContent).toBe("Merged"));
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "Ship the search fixes" })).toBeTruthy();
    expect(statusText().textContent).toBe("Merged");
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
  });
});
