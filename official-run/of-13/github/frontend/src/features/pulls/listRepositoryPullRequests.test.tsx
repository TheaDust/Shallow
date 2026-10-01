import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import { PULLS_ADDRESS, PULLS_SEED_ORGANIZATION, PULL_OWNER } from "../../test-support/pull-fixtures";

const REPOSITORY_ADDRESS = "#/repositories/acme-demo/acme-docs";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again, like a reload of the same address. */
function reload() {
  cleanup();
  return render(<App />);
}

/** The article of one list row, found by the title link of the row. */
function rowOf(title: string): HTMLElement {
  const link = screen.getByRole("link", { name: title });
  const row = link.closest("article");
  if (row === null) throw new Error(`no pull request row for ${title}`);
  return row as HTMLElement;
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-6-2-1 list and filter repository pull requests", () => {
  it("a visitor reads the stored rows with number, title, author, status and branches", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    renderApp(PULLS_ADDRESS);

    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
    await screen.findByRole("link", { name: "Improve onboarding" });

    // The status filter offers Draft, Open, Closed and Merged as links.
    for (const label of ["Open", "Closed", "Draft", "Merged"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }

    const open = rowOf("Improve onboarding");
    expect(within(open).getByText("#1")).toBeTruthy();
    expect(within(open).getByText("Open")).toBeTruthy();
    expect(within(open).getByText("alice-dev")).toBeTruthy();
    expect(within(open).getByText("release → main")).toBeTruthy();

    const closed = rowOf("Fix search");
    expect(within(closed).getByText("#2")).toBeTruthy();
    expect(within(closed).getByText("Closed")).toBeTruthy();
    expect(within(closed).getByText("feature-search → main")).toBeTruthy();

    const draft = rowOf("Draft onboarding update");
    expect(within(draft).getByText("Draft")).toBeTruthy();
    expect(within(draft).getByText("draft-feature → main")).toBeTruthy();

    // A visitor may read the list but never reaches the creation flow.
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();
  });

  it("selects Open, filters the author and switches to Closed without changing a record", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp(PULLS_ADDRESS);
    await screen.findByRole("link", { name: "Improve onboarding" });

    await user.click(screen.getByRole("link", { name: "Open" }));
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Draft onboarding update" })).toBeNull();

    await user.type(screen.getByLabelText("Author"), "alice");
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();
    expect(window.location.hash).toContain("state=open");
    expect(window.location.hash).toContain("author=alice");

    // Switching to Closed hides the Open pull request and shows the Closed one.
    await user.click(screen.getByRole("link", { name: "Closed" }));
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect(await screen.findByRole("link", { name: "Fix search" })).toBeTruthy();

    // Filtering never changed a stored record: every row is still there.
    await user.click(screen.getByRole("link", { name: "All" }));
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Draft onboarding update" })).toBeTruthy();
    expect(rowOf("Fix search")).toBeTruthy();
  });

  it("keeps the filtered list across a reload and a reopened list page", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp(PULLS_ADDRESS);
    await screen.findByRole("link", { name: "Improve onboarding" });

    await user.click(screen.getByRole("link", { name: "Open" }));
    expect(window.location.hash).toContain("state=open");

    reload();
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();

    // Leaving the page and reopening the filtered address shows the same row.
    window.location.hash = REPOSITORY_ADDRESS;
    await screen.findByRole("link", { name: "Pull requests" });
    window.location.hash = `${PULLS_ADDRESS}?state=open`;
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();

    // Selecting the same filter again keeps showing the Open pull request.
    await user.click(screen.getByRole("link", { name: "Open" }));
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();
  });

  it("opens the detail page of a row from its title and survives a reload", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp(PULLS_ADDRESS);
    await screen.findByRole("link", { name: "Improve onboarding" });

    await user.click(screen.getByRole("link", { name: "Improve onboarding" }));
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("release → main")).toBeTruthy();

    const address = window.location.hash;
    reload();
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(window.location.hash).toBe(address);
  });

  it("filters by review status and by author without changing the stored records", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp(PULLS_ADDRESS);
    await screen.findByRole("link", { name: "Improve onboarding" });

    // Every seeded record still waits for its review.
    await user.selectOptions(screen.getByLabelText("Review status"), "review_required");
    expect(screen.getAllByRole("link", { name: /Improve onboarding|Fix search|Draft onboarding update/ })).toHaveLength(3);
    expect(window.location.hash).toContain("review=review_required");

    await user.selectOptions(screen.getByLabelText("Review status"), "changes_requested");
    expect(await screen.findByText("No pull requests match the current filters")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();

    // The records themselves are untouched by the display filter.
    await user.selectOptions(screen.getByLabelText("Review status"), "");
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fix search" })).toBeTruthy();

    await user.type(screen.getByLabelText("Author"), "bob-reviewer");
    expect(await screen.findByText("No pull requests match the current filters")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
  });

  it("a signed-in contributor sees the same rows and the creation entry", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");

    window.location.hash = PULLS_ADDRESS;
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New pull request" })).toBeTruthy();
    expect(rowOf("Fix search")).toBeTruthy();

    reload();
    expect(await screen.findByRole("link", { name: "New pull request" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
  });
});
