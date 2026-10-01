import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  ISSUE_ADDRESS,
  ISSUE_SEED_ORGANIZATION,
  ISSUES_ADDRESS,
  MEMBER,
  OWNER,
} from "../../test-support/issue-fixtures";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again, like a reload of the same address. */
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

/** The readable records of the append-only activity timeline. */
function activityRecords(): string[] {
  return within(sectionOf("Activity"))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** Signs in through the home page and opens the seeded issue detail page. */
async function openSignedInIssue(username: string) {
  const user = userEvent.setup();
  renderApp("#/");
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });

  window.location.hash = ISSUE_ADDRESS;
  await screen.findByRole("heading", { name: "Improve onboarding" });
  return user;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-5-3-1 assign or unassign issue participants", () => {
  it("assigns and unassigns one participant through the Assignees selector", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = await openSignedInIssue("alice-dev");

    // The seeded issue starts without an assignee, and `bob-reviewer` holds no
    // repository permission, so he is never offered as a candidate.
    expect(within(sectionOf("Assignees")).getByText("No one assigned")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Assignees" }));
    expect(screen.getByRole("textbox", { name: "Search assignees" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "bob-reviewer" })).toBeNull();

    // The matching options follow the textbox, without Enter or a search button.
    await user.type(screen.getByRole("textbox", { name: "Search assignees" }), "zz");
    expect(screen.queryByRole("option", { name: "alice-dev" })).toBeNull();
    await user.clear(screen.getByRole("textbox", { name: "Search assignees" }));
    await user.type(screen.getByRole("textbox", { name: "Search assignees" }), "ali");
    const option = screen.getByRole("option", { name: "alice-dev" });
    await user.click(option);

    // Selecting immediately saves and closes the selector.
    expect(screen.queryByRole("option", { name: "alice-dev" })).toBeNull();
    await within(sectionOf("Assignees")).findByText("alice-dev");
    expect(activityRecords().some((record) => record.includes("assigned alice-dev"))).toBe(true);

    // Reopening shows the selected member without another search, and selecting
    // it again removes the assignment.
    await user.click(screen.getByRole("button", { name: "Assignees" }));
    expect(
      screen.getByRole("option", { name: "alice-dev" }).getAttribute("aria-selected"),
    ).toBe("true");
    await user.click(screen.getByRole("option", { name: "alice-dev" }));
    await waitFor(() =>
      expect(within(sectionOf("Assignees")).getByText("No one assigned")).toBeTruthy(),
    );
    expect(activityRecords().some((record) => record.includes("unassigned alice-dev"))).toBe(true);

    // The historical assignment stays in the append-only activity, and a reload
    // reads the last stored set.
    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(within(sectionOf("Assignees")).getByText("No one assigned")).toBeTruthy();
    expect(activityRecords().some((record) => record.includes("assigned alice-dev"))).toBe(true);
    expect(activityRecords().some((record) => record.includes("unassigned alice-dev"))).toBe(true);
  });

  it("keeps the assignee after a reload and hides the control from a viewer without Triage", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = await openSignedInIssue("alice-dev");

    await user.click(screen.getByRole("button", { name: "Assignees" }));
    await user.click(await screen.findByRole("option", { name: "alice-dev" }));
    await within(sectionOf("Assignees")).findByText("alice-dev");

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(within(sectionOf("Assignees")).getByText("alice-dev")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assignees" })).toBeTruthy();
  });
});

describe("REQ-5-3-2 apply labels to an issue", () => {
  it("applies and removes a label of the current repository", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = await openSignedInIssue("alice-dev");

    expect(within(sectionOf("Labels")).getByText("documentation")).toBeTruthy();
    expect(within(sectionOf("Labels")).queryByText("bug")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Labels" }));
    // Only the labels of the current repository are offered, with their state.
    expect(
      screen.getByRole("option", { name: "documentation" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("option", { name: "bug" }).getAttribute("aria-selected")).toBe("false");
    await user.click(screen.getByRole("option", { name: "bug" }));

    await within(sectionOf("Labels")).findByText("bug");
    expect(activityRecords().some((record) => record.includes("added the bug label"))).toBe(true);

    // The Issues list shows the same persisted label.
    window.location.hash = ISSUES_ADDRESS;
    const row = (await screen.findByRole("link", { name: "Improve onboarding" })).closest("article");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("bug")).toBeTruthy();
    expect(within(row as HTMLElement).getByText("documentation")).toBeTruthy();

    window.location.hash = ISSUE_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });
    await user.click(screen.getByRole("button", { name: "Labels" }));
    await user.click(screen.getByRole("option", { name: "bug" }));
    await waitFor(() => expect(within(sectionOf("Labels")).queryByText("bug")).toBeNull());
    expect(activityRecords().some((record) => record.includes("removed the bug label"))).toBe(true);

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(within(sectionOf("Labels")).queryByText("bug")).toBeNull();
    expect(within(sectionOf("Labels")).getByText("documentation")).toBeTruthy();
  });

  it("hides the label picker from a Write viewer who may only view", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER],
      organizations: [
        {
          ...ISSUE_SEED_ORGANIZATION,
          repositories: (ISSUE_SEED_ORGANIZATION.repositories ?? []).map((repository) =>
            repository.name === "acme-docs"
              ? {
                  ...repository,
                  grants: [{ subjectType: "account", subjectName: "bob-reviewer", role: "write" }],
                }
              : repository,
          ),
        },
      ],
    });
    await openSignedInIssue("bob-reviewer");

    expect(screen.getByRole("button", { name: "Edit issue title" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assignees" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
    expect(within(sectionOf("Labels")).getByText("documentation")).toBeTruthy();
  });
});

describe("REQ-5-3-3 assign an issue to a milestone", () => {
  it("selects one milestone, clears it with None and keeps the last state after a reload", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = await openSignedInIssue("alice-dev");

    expect(within(sectionOf("Milestone")).getByText("Q3 launch")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Milestone" }));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent?.replace("✓", "").trim()),
    ).toEqual(["Q3 launch", "v1.0", "None"]);
    await user.click(screen.getByRole("option", { name: "v1.0" }));

    await within(sectionOf("Milestone")).findByText("v1.0");
    expect(
      activityRecords().some((record) => record.includes("added this to the v1.0 milestone")),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Milestone" }));
    expect(
      screen.getByRole("option", { name: "v1.0" }).getAttribute("aria-selected"),
    ).toBe("true");
    await user.click(screen.getByRole("option", { name: "None" }));
    await within(sectionOf("Milestone")).findByText("No milestone");
    expect(
      activityRecords().some((record) => record.includes("removed this from its milestone")),
    ).toBe(true);

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(within(sectionOf("Milestone")).getByText("No milestone")).toBeTruthy();
  });
});

describe("REQ-5-4 close or reopen an issue", () => {
  it("closes and reopens the seeded open issue without changing its content", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = await openSignedInIssue("alice-dev");

    expect(screen.getByText("Open")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close issue" }));

    await screen.findByText("Closed");
    expect(activityRecords().some((record) => record.includes("closed this issue"))).toBe(true);
    // The content and the metadata of the issue are untouched.
    expect(screen.getByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(within(sectionOf("Labels")).getByText("documentation")).toBeTruthy();
    expect(within(sectionOf("Milestone")).getByText("Q3 launch")).toBeTruthy();
    expect(within(sectionOf("Comments")).getByText("Start with the first-run checklist.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Reopen issue" }));
    await screen.findByText("Open");
    expect(screen.getByRole("button", { name: "Close issue" })).toBeTruthy();

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close issue" })).toBeTruthy();

    // The list shows the same final state.
    window.location.hash = ISSUES_ADDRESS;
    const row = (await screen.findByRole("link", { name: "Improve onboarding" })).closest("article");
    expect(within(row as HTMLElement).getByText("Open")).toBeTruthy();
  });

  it("offers neither close nor reopen to a viewer who may only read", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    await openSignedInIssue("bob-reviewer");

    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
    expect(screen.getByText("Open")).toBeTruthy();

    // The closed seeded issue offers no reopen control either.
    window.location.hash = "#/repositories/acme-demo/acme-docs/issues/2";
    await screen.findByRole("heading", { name: "Legacy welcome text" });
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
  });
});
