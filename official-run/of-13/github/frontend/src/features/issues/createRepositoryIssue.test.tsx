import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  ISSUES_ADDRESS,
  ISSUE_SEED_ORGANIZATION,
  MEMBER,
  NEW_ISSUE_ADDRESS,
  OWNER,
} from "../../test-support/issue-fixtures";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function reload() {
  cleanup();
  return render(<App />);
}

function sectionOf(heading: string): HTMLElement {
  const section = screen.getByRole("heading", { name: heading }).closest("section");
  if (section === null) throw new Error(`no section for ${heading}`);
  return section as HTMLElement;
}

/** The issue numbers the current Issues list shows, newest first. */
async function listedNumbers(): Promise<string[]> {
  const links = await screen.findAllByRole("link");
  return links
    .map((link) => link.textContent ?? "")
    .filter((text) => /^#\d+$/.test(text));
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

describe("REQ-5-2-1 create a repository issue", () => {
  it("creates the issue from the Issues page and opens its own detail page", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");

    window.location.hash = ISSUES_ADDRESS;
    expect(await screen.findByRole("heading", { name: "Issues" })).toBeTruthy();
    expect(await listedNumbers()).toEqual(["#3", "#2", "#1"]);

    // `New issue` is a link of the Issues page.
    await user.click(screen.getByRole("link", { name: "New issue" }));
    const title = await screen.findByLabelText("Title");
    await user.type(title, "Add a troubleshooting guide");
    await user.type(screen.getByLabelText("Description"), "Write the guide.");
    await user.click(screen.getByRole("button", { name: "Submit new issue" }));

    // The accepted issue opens its detail page with its own number, status,
    // title, description and the current user as author.
    expect(await screen.findByRole("heading", { name: "Add a troubleshooting guide" })).toBeTruthy();
    expect(screen.getByText("#4")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Write the guide.")).toBeTruthy();
    expect(within(sectionOf("Description")).getByText("Write the guide.")).toBeTruthy();
    const creationRecord = within(sectionOf("Activity")).getAllByRole("listitem").at(-1);
    expect(creationRecord?.textContent).toContain("created this issue");
    expect(creationRecord?.textContent).toContain("alice-dev");

    // The list can locate the new issue by its number and status.
    window.location.hash = ISSUES_ADDRESS;
    expect(await screen.findByRole("link", { name: "Add a troubleshooting guide" })).toBeTruthy();
    expect(await listedNumbers()).toEqual(["#4", "#3", "#2", "#1"]);

    // The record is persisted: a reload of the detail page reads it again.
    window.location.hash = "#/repositories/acme-demo/acme-docs/issues/4";
    await screen.findByRole("heading", { name: "Add a troubleshooting guide" });
    reload();
    expect(await screen.findByRole("heading", { name: "Add a troubleshooting guide" })).toBeTruthy();
    expect(screen.getByText("Write the guide.")).toBeTruthy();
    expect(screen.getByText("#4")).toBeTruthy();
  });

  it("refuses a title of three spaces and creates no issue", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = NEW_ISSUE_ADDRESS;

    const title = await screen.findByLabelText("Title");
    await user.type(title, "   ");
    await user.click(screen.getByRole("button", { name: "Submit new issue" }));

    // The creation form shows the reason and stays on the form.
    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit new issue" })).toBeTruthy();

    // No number was allocated: the list still holds the seeded three issues.
    window.location.hash = ISSUES_ADDRESS;
    await screen.findByRole("heading", { name: "Issues" });
    expect(await listedNumbers()).toEqual(["#3", "#2", "#1"]);
  });

  it("hides the entry from a visitor who may only read the issues", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    renderApp(ISSUES_ADDRESS);
    expect(await screen.findByRole("heading", { name: "Issues" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();
  });

  it("refuses a signed-in viewer without a repository role", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");

    window.location.hash = ISSUES_ADDRESS;
    await screen.findByRole("heading", { name: "Issues" });
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();

    // Opening the creation address directly shows the reason, not the form.
    window.location.hash = NEW_ISSUE_ADDRESS;
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByLabelText("Title")).toBeNull();
  });
});
