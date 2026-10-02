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

const BRANCHES_ADDRESS = "#/repositories/acme-demo/acme-docs/settings/branches";

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

/** The `Branches` panel of the repository settings. */
async function branchesPanel(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Branch protection rules" });
}

describe("REQ-6-1 protect branches with review and status-check requirements", () => {
  it("an Admin creates a rule from the exact branch name and stores both requirements", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = BRANCHES_ADDRESS;

    // The seeded rule is visible verbatim with its summaries, next to the
    // `Add branch protection rule` entry of an Admin.
    const panel = await branchesPanel();
    expect(within(panel).getByText("main")).toBeTruthy();
    expect(within(panel).getByText("1 approval")).toBeTruthy();
    expect(within(panel).getByText("Require status check test")).toBeTruthy();

    await user.click(
      within(panel).getByRole("button", { name: "Add branch protection rule" }),
    );
    await user.type(
      screen.getByLabelText("Branch name pattern"),
      "feature-search",
    );
    await user.click(screen.getByRole("checkbox", { name: "Require 1 approval" }));
    // A name without a rule uses the `Create` entry.
    await user.click(screen.getByRole("button", { name: "Create" }));

    const saved = await branchesPanel();
    await waitFor(() =>
      expect(within(saved).getByText("feature-search")).toBeTruthy(),
    );
    const rule = within(saved).getByText("feature-search").closest("li") as HTMLElement;
    expect(within(rule).getByText("1 approval")).toBeTruthy();
    expect(
      within(rule).queryByText("Require status check test"),
    ).toBeNull();

    // The stored rule remains after a reload of the same panel.
    reload();
    const reloaded = await branchesPanel();
    expect(within(reloaded).getByText("feature-search")).toBeTruthy();
    expect(within(reloaded).getByText("main")).toBeTruthy();
  });

  it("saving an existing branch name uses Save changes and keeps one rule", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = BRANCHES_ADDRESS;

    const panel = await branchesPanel();
    await user.click(
      within(panel).getByRole("button", { name: "Add branch protection rule" }),
    );
    await user.click(screen.getByLabelText("Branch name pattern"));
    await user.type(screen.getByLabelText("Branch name pattern"), "main");
    await user.click(screen.getByRole("checkbox", { name: "Require 1 approval" }));
    await user.click(screen.getByRole("checkbox", { name: "Require status check test" }));
    // `main` already carries a rule, so the form saves the changes instead of
    // creating a second one.
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const saved = await branchesPanel();
    expect(within(saved).getAllByText("main")).toHaveLength(1);
    const mainRule = within(saved).getByText("main").closest("li") as HTMLElement;
    expect(within(mainRule).getByText("1 approval")).toBeTruthy();
    expect(within(mainRule).getByText("Require status check test")).toBeTruthy();
    expect(within(saved).queryByText("feature-search")).toBeNull();
  });

  it("a non-Admin never receives the Add branch protection rule entry", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = BRANCHES_ADDRESS;

    // `bob-reviewer` holds Write, so the Branches panel stays readable: the
    // stored rule is visible while every rule-editing control is absent.
    const panel = await branchesPanel();
    expect(within(panel).getByText("main")).toBeTruthy();
    expect(
      within(panel).queryByRole("button", { name: "Add branch protection rule" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Branch name pattern")).toBeNull();
  });

  it("the Admin updates the test status in the Checks area of the current compare commit", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = BLOCKED_PULL_ADDRESS;

    await screen.findByRole("heading", { name: "Refresh the docs layout" });
    const checks = await screen.findByRole("region", { name: "Checks" });
    // The check of the current compare commit starts as pending.
    expect(within(checks).getByText("test: pending")).toBeTruthy();

    await user.click(within(checks).getByRole("combobox", { name: "test status" }));
    await user.click(await screen.findByRole("option", { name: "success" }));
    await user.click(within(checks).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(within(checks).getByText("test: success")).toBeTruthy(),
    );
    // The setter and the time of the stored result are visible.
    expect(within(checks).getByText(/Updated by alice-dev/)).toBeTruthy();

    reload();
    await screen.findByRole("heading", { name: "Refresh the docs layout" });
    const reloaded = await screen.findByRole("region", { name: "Checks" });
    expect(within(reloaded).getByText("test: success")).toBeTruthy();
    expect(within(reloaded).getByText(/Updated by alice-dev/)).toBeTruthy();
  });

  it("the Checks area shows the stored result of the mergeable record", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = MERGEABLE_PULL_ADDRESS;

    await screen.findByRole("heading", { name: "Ship the search fixes" });
    const checks = await screen.findByRole("region", { name: "Checks" });
    expect(within(checks).getByText("test: success")).toBeTruthy();
    // Only a repository Admin may change the status from this area.
    expect(within(checks).queryByRole("combobox", { name: "test status" })).toBeNull();
    expect(within(checks).queryByRole("button", { name: "Save" })).toBeNull();
  });
});
