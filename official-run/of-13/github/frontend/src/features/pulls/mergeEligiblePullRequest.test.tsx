import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  BLOCKED_PULL_ADDRESS,
  MERGEABLE_PULL_ADDRESS,
  PULL_OWNER,
  PULL_REVIEWER,
  PULLS_SEED_ORGANIZATION,
} from "../../test-support/pull-fixtures";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again, like a reload of the same address. */
function reload() {
  cleanup();
  return render(<App />);
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

describe("REQ-6-5 merge an eligible pull request", () => {
  it("the maintainer merges the eligible record with the only supported method", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = MERGEABLE_PULL_ADDRESS;

    await screen.findByRole("heading", { name: "Ship the search fixes" });
    expect(statusText().textContent).toBe("Open");

    // The only selectable method on the page is the merge commit.
    const method = screen.getByRole("radio", { name: "Create a merge commit" });
    expect((method as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    // Every condition of the protected target is satisfied.
    const mergeArea = screen.getByRole("region", { name: "Merge" });
    expect(
      within(mergeArea).getByText("Review required by branch protection"),
    ).toBeTruthy();
    expect(within(mergeArea).getByText("Required status check test must succeed")).toBeTruthy();

    const confirm = await screen.findByRole("button", { name: "Merge pull request" });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);
    await user.click(await screen.findByRole("button", { name: "Confirm merge" }));

    await waitFor(() => expect(statusText().textContent).toBe("Merged"));
    // The merger, the time and the resulting commit identifier are displayed.
    const result = document.querySelector(".pull-request-merge__result") as HTMLElement;
    expect(result.textContent).toContain("alice-dev");
    expect(within(result).getByText("Merge commit")).toBeTruthy();
    expect(within(result).getByText("Merger")).toBeTruthy();

    reload();
    await screen.findByRole("heading", { name: "Ship the search fixes" });
    expect(statusText().textContent).toBe("Merged");
    const persisted = document.querySelector(".pull-request-merge__result") as HTMLElement;
    expect(persisted.textContent).toContain("alice-dev");
  });

  it("a blocked record keeps a disabled merge entry and explains the unmet condition", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = BLOCKED_PULL_ADDRESS;

    await screen.findByRole("heading", { name: "Refresh the docs layout" });
    const merge = screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    // The reason is visible before any click.
    expect(screen.getByText("Review required by branch protection")).toBeTruthy();
    expect(screen.getAllByText("Not satisfied").length).toBeGreaterThan(0);

    // Clicking the disabled entry opens no confirmation box.
    await user.click(merge);
    expect(screen.queryByRole("button", { name: "Confirm merge" })).toBeNull();
    expect(statusText().textContent).toBe("Open");
  });

  it("a Write collaborator never receives an executable merge entry", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = MERGEABLE_PULL_ADDRESS;

    await screen.findByRole("heading", { name: "Ship the search fixes" });
    const merge = screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
  });
});
