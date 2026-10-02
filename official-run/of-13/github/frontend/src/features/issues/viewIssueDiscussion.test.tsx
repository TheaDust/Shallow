import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  ISSUE_ADDRESS,
  ISSUE_SEED_ORGANIZATION,
  MEMBER,
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

/** The section that a metadata heading names. */
function sectionOf(heading: string): HTMLElement {
  const section = screen.getByRole("heading", { name: heading }).closest("section");
  if (section === null) throw new Error(`no section for ${heading}`);
  return section as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-5-1-2 view an issue and its discussion", () => {
  it("shows the number, title, status, description, metadata and discussion of the saved record", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    renderApp(ISSUE_ADDRESS);

    // The heading is the complete title without the number.
    const title = await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(title.textContent).toBe("Improve onboarding");
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();

    // The right side lists Assignees, Labels and Milestone in that order.
    expect(within(sectionOf("Assignees")).getByText("No one assigned")).toBeTruthy();
    expect(within(sectionOf("Labels")).getByText("documentation")).toBeTruthy();
    expect(within(sectionOf("Milestone")).getByText("Q3 launch")).toBeTruthy();
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings.indexOf("Assignees")).toBeLessThan(headings.indexOf("Labels"));
    expect(headings.indexOf("Labels")).toBeLessThan(headings.indexOf("Milestone"));

    // The discussion shows the saved comment with its author and body.
    const comments = sectionOf("Comments");
    expect(within(comments).getByText("Start with the first-run checklist.")).toBeTruthy();
    expect(within(comments).getByText("alice-dev")).toBeTruthy();

    // The activity timeline records creation before the comment.
    const activity = sectionOf("Activity");
    const records = within(activity)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    const created = records.findIndex((record) => record.includes("created this issue"));
    const commented = records.findIndex((record) => record.includes("commented"));
    expect(created).toBeGreaterThan(-1);
    expect(commented).toBeGreaterThan(-1);
    expect(created).toBeLessThan(commented);
    expect(records[created]).toContain("alice-dev");
  });

  it("shows the same title, status, metadata and comment after a refresh", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    renderApp(ISSUE_ADDRESS);
    await screen.findByRole("heading", { name: "Improve onboarding" });

    reload();
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(within(sectionOf("Assignees")).getByText("No one assigned")).toBeTruthy();
    expect(within(sectionOf("Milestone")).getByText("Q3 launch")).toBeTruthy();
    expect(within(sectionOf("Comments")).getByText("Start with the first-run checklist.")).toBeTruthy();
  });

  it("shows the closed issue's status and keeps the discussion readable", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    renderApp("#/repositories/acme-demo/acme-docs/issues/2");

    expect(await screen.findByRole("heading", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("Replace the legacy welcome text on the home page.")).toBeTruthy();
    expect(within(sectionOf("Assignees")).getByText("No one assigned")).toBeTruthy();
    expect(within(sectionOf("Milestone")).getByText("No milestone")).toBeTruthy();
  });

  it("never shows the detail content of an issue the reader may not view", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    renderApp("#/repositories/acme-demo/secret-research/issues/1");

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByText("Protected research issue")).toBeNull();
    expect(screen.queryByText("Private body.")).toBeNull();
  });

  it("an unknown issue number is not found", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    renderApp("#/repositories/acme-demo/acme-docs/issues/99");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
  });

  it("a signed-in reader reaches the same saved issue from the home page", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");

    await user.click(screen.getByRole("link", { name: "Sign in" }));
    await user.type(await screen.findByLabelText("Username or email"), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // The signed-in username is visible in the header.
    const accountMenu = await screen.findByRole("button", { name: "Account menu" });
    expect(accountMenu.textContent).toContain("alice-dev");

    window.location.hash = ISSUE_ADDRESS;
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(within(sectionOf("Comments")).getByText("Start with the first-run checklist.")).toBeTruthy();
    expect(within(sectionOf("Labels")).getByText("documentation")).toBeTruthy();
  });
});
