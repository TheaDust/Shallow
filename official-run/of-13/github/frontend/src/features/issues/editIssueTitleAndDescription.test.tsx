import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  INVALID_EDIT_ISSUE_ADDRESS,
  ISSUES_ADDRESS,
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

function sectionOf(heading: string): HTMLElement {
  const section = screen.getByRole("heading", { name: heading }).closest("section");
  if (section === null) throw new Error(`no section for ${heading}`);
  return section as HTMLElement;
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

describe("REQ-5-2-2 edit an issue title and description", () => {
  it("saves the title and the description as two separate actions", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");

    window.location.hash = INVALID_EDIT_ISSUE_ADDRESS;
    await screen.findByRole("heading", { name: "Original issue title" });
    expect(screen.getByText("Describe the original issue.")).toBeTruthy();

    // The title editor is named exactly and starts from the stored value.
    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleBox = await screen.findByLabelText("Issue title");
    expect((titleBox as HTMLInputElement).value).toBe("Original issue title");
    await user.clear(titleBox);
    await user.type(titleBox, "Rewritten issue title");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));

    // The heading names the issue with the new title; the description and the
    // other issues are untouched.
    expect(await screen.findByRole("heading", { name: "Rewritten issue title" })).toBeTruthy();
    expect(screen.getByText("Describe the original issue.")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit issue description" }));
    const descriptionBox = await screen.findByLabelText("Issue description");
    expect((descriptionBox as HTMLTextAreaElement).value).toBe("Describe the original issue.");
    await user.clear(descriptionBox);
    await user.type(descriptionBox, "A rewritten description.");
    await user.click(screen.getByRole("button", { name: "Save issue description" }));

    expect(await screen.findByText("A rewritten description.")).toBeTruthy();
    // Both edits are recorded in the activity timeline.
    const activity = sectionOf("Activity");
    expect(within(activity).getByText(/edited the title/)).toBeTruthy();
    expect(within(activity).getByText(/edited the description/)).toBeTruthy();

    // The issue list summary shows the new title.
    window.location.hash = ISSUES_ADDRESS;
    expect(await screen.findByRole("link", { name: "Rewritten issue title" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();

    // A reload of the detail page reads both new values and the timeline.
    window.location.hash = INVALID_EDIT_ISSUE_ADDRESS;
    await screen.findByRole("heading", { name: "Rewritten issue title" });
    reload();
    expect(await screen.findByRole("heading", { name: "Rewritten issue title" })).toBeTruthy();
    expect(screen.getByText("A rewritten description.")).toBeTruthy();
    expect(screen.getByText("#3")).toBeTruthy();
  });

  it("refuses a blank title and keeps the original heading after a reload", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");

    window.location.hash = INVALID_EDIT_ISSUE_ADDRESS;
    await screen.findByRole("heading", { name: "Original issue title" });

    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleBox = await screen.findByLabelText("Issue title");
    await user.clear(titleBox);
    await user.type(titleBox, "   ");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));

    // The reason is shown and the stored title is still the readable heading.
    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Original issue title" })).toBeTruthy();

    reload();
    expect(await screen.findByRole("heading", { name: "Original issue title" })).toBeTruthy();
    expect(screen.getByText("Describe the original issue.")).toBeTruthy();
  });

  it("offers no edit control to a viewer without Write permission", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    // A visitor of the public issue reads the whole record without editors.
    renderApp(ISSUE_ADDRESS);
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit issue title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit issue description" })).toBeNull();
    expect(screen.queryByLabelText("Comment")).toBeNull();
  });
});
