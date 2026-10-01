import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
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

/** The `Reviewers` area on the right of the detail page. */
function reviewersArea(): HTMLElement {
  return screen.getByRole("region", { name: "Reviewers" });
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

describe("REQ-6-4 request or remove pull request reviewers", () => {
  it("the author requests a reviewer in the picker and removes the request again", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = PULL_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });

    // The seeded pull request starts without a reviewer request, so no remove
    // entry exists yet.
    expect(within(reviewersArea()).queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();

    // The `Reviewers` button opens the picker with its `Search` textbox.
    await user.click(within(reviewersArea()).getByRole("button", { name: "Reviewers" }));
    const search = screen.getByRole("textbox", { name: "Search" });

    // Typing the eligible username reveals its option without any submit.
    await user.type(search, "bob-reviewer");
    const option = screen.getByRole("option", { name: "bob-reviewer" });
    expect(option).toBeTruthy();

    await user.click(option);

    // Selecting stores the request at once, closes the picker and shows the
    // username in the reviewer area; no approval is generated.
    expect(await within(reviewersArea()).findByText("bob-reviewer")).toBeTruthy();
    expect(within(reviewersArea()).getByRole("button", { name: "Remove bob-reviewer" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Search" })).toBeNull();
    expect(within(screen.getByLabelText("Review summary")).getByText("Review required")).toBeTruthy();

    // The request survives a reload of the detail page.
    reload();
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(within(reviewersArea()).getByText("bob-reviewer")).toBeTruthy();

    // Removing the request acts at once, without a confirmation step.
    await user.click(within(reviewersArea()).getByRole("button", { name: "Remove bob-reviewer" }));
    expect(within(reviewersArea()).queryByText("bob-reviewer")).toBeNull();
    expect(within(reviewersArea()).queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();

    // The removal persists across a reload.
    reload();
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(within(reviewersArea()).queryByText("bob-reviewer")).toBeNull();

    // Neither action published a review or a comment.
    expect(within(screen.getByLabelText("Review summary")).getByText("No reviews yet")).toBeTruthy();
    expect(within(screen.getByLabelText("Comments")).getAllByRole("listitem")).toHaveLength(1);
  });

  it("the picker filters the candidates while the user types", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = PULL_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });

    await user.click(within(reviewersArea()).getByRole("button", { name: "Reviewers" }));
    const search = screen.getByRole("textbox", { name: "Search" });

    // A term that matches no candidate offers no option.
    await user.type(search, "no-such-reviewer");
    expect(screen.queryByRole("option")).toBeNull();

    await user.clear(search);
    await user.type(search, "bob");
    expect(screen.getByRole("option", { name: "bob-reviewer" })).toBeTruthy();
  });

  it("a viewer who is neither the author nor a maintainer cannot modify requests", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = PULL_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });

    // `bob-reviewer` holds Write, so he is a candidate reviewer but neither the
    // author nor a Maintain of this pull request: no picker and no remove
    // entry is rendered for him.
    const area = reviewersArea();
    expect(within(area).queryByRole("button", { name: "Reviewers" })).toBeNull();
    expect(within(area).queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();
  });
});
