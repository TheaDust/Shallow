import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  PULLS_ADDRESS,
  PULLS_SEED_ORGANIZATION,
  PULL_OWNER,
  PULL_REVIEWER,
} from "../../test-support/pull-fixtures";

const DRAFT_PULL_ADDRESS = "#/repositories/acme-demo/acme-docs/pulls/3";

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
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function signOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Sign out" }));
  await user.click(await screen.findByRole("button", { name: "Confirm sign out" }));
  await screen.findByRole("link", { name: "Sign in" });
}

/** The native button of one accessible name, for its `disabled` state. */
function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-6-2-4 create a draft pull request", () => {
  it("creates the draft from the comparison form and keeps its Merge entry disabled", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = `${PULLS_ADDRESS}/compare?base=main&compare=feature-search`;
    expect(await screen.findByText("src/search.ts")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));
    await user.type(await screen.findByLabelText("Title"), "Draft search docs");
    await user.type(screen.getByLabelText("Description"), "Work in progress.");
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));

    // The detail page carries the Draft marker, both branches and a Merge
    // entry that cannot be executed.
    expect(await screen.findByRole("heading", { name: "Draft search docs" })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("feature-search → main")).toBeTruthy();
    expect(screen.getByText("#8")).toBeTruthy();
    expect(button("Merge pull request").disabled).toBe(true);

    reload();
    expect(await screen.findByRole("heading", { name: "Draft search docs" })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(button("Merge pull request").disabled).toBe(true);

    // The list shows the draft status of the stored record as well.
    window.location.hash = PULLS_ADDRESS;
    const row = (await screen.findByRole("link", { name: "Draft search docs" })).closest("article");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Draft")).toBeTruthy();
  });

  it("the author marks the seeded draft ready for review and it stays Open", async () => {
    installAuthStub({
      accounts: [PULL_OWNER, PULL_REVIEWER],
      organizations: [PULLS_SEED_ORGANIZATION],
    });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = DRAFT_PULL_ADDRESS;

    // The dedicated seed: its title, both branches and the Draft marker.
    expect(
      await screen.findByRole("heading", { name: "Draft onboarding update" }),
    ).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("draft-feature → main")).toBeTruthy();
    expect(screen.getByText("No reviews yet", { exact: false })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Ready for review" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    // The same number is Open, the Draft badge is gone and the activity is
    // recorded in the conversation; branches and title stay untouched.
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getByRole("heading", { name: "Draft onboarding update" })).toBeTruthy();
    expect(screen.getByText("draft-feature → main")).toBeTruthy();
    expect(screen.getByText("marked this pull request as ready for review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();

    reload();
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();

    // A reviewer reopens the same address and reads the Open status too.
    await signOut(user);
    await signIn(user, "bob-reviewer");
    window.location.hash = DRAFT_PULL_ADDRESS;
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Draft onboarding update" })).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("needs the author, Maintain, Admin or the organization Owner to mark it ready", async () => {
    installAuthStub({
      accounts: [PULL_OWNER, PULL_REVIEWER],
      organizations: [PULLS_SEED_ORGANIZATION],
    });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = DRAFT_PULL_ADDRESS;

    expect(
      await screen.findByRole("heading", { name: "Draft onboarding update" }),
    ).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    // A reader without the author role gets no ready-for-review entry at all.
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();
    expect(button("Merge pull request").disabled).toBe(true);
  });
});
