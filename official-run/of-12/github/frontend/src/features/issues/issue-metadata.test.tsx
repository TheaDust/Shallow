import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createRepositoryMock, type MockRepositoryServer } from "../../test/repository-server-mock";

/**
 * The metadata and status actions of an issue (REQ-5-3, REQ-5-4): the settings
 * selectors of the sidebar and the close/reopen control of the detail page.
 * Every case reads the stored record of the mock server — not only what the
 * page displays — so a change the server did not store cannot pass.
 */
let server: MockRepositoryServer;

beforeEach(() => {
  server = createRepositoryMock({ viewer: null });
  window.location.hash = "#/";
  server.install();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reset(viewer: string | null, hash: string) {
  cleanup();
  server = createRepositoryMock({ viewer });
  window.location.hash = hash;
  server.install();
}

/** Re-opens an address against the same stored state, as a reload would. */
function reopen(viewer: string | null, hash: string) {
  cleanup();
  server.state.viewer = viewer;
  window.location.hash = hash;
  server.install();
  render(<App />);
}

interface StoredIssue {
  number: number;
  title: string;
  status: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  timeline: Array<{ type: string; actor: string; text: string }>;
}

function storedIssue(number: number): StoredIssue | undefined {
  const repository = server.state.repositories.find((candidate) => candidate.name === "acme-docs");
  return JSON.parse(JSON.stringify(repository?.issues.find((issue) => issue.number === number))) as
    | StoredIssue
    | undefined;
}

/** Opens the detail page of the isolated metadata work item (#4). */
async function openMetadataTarget(viewer: string) {
  reset(viewer, "#/alice-dev/acme-docs/issues/4");
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Add changelog page" });
}

function region(name: string) {
  return screen.getByRole("region", { name });
}

function activityTexts(): string[] {
  return within(region("Activity"))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("REQ-5-3-1 assign or unassign issue participants", () => {
  it("offers the assignable members, filters while typing and stores the choice", async () => {
    await openMetadataTarget("carol-maintainer");

    // The settings icon is a button named after the area and opens the
    // selector with its own search textbox.
    const settings = screen.getByRole("button", { name: "Assignees" });
    await userEvent.click(settings);
    const search = screen.getByRole("textbox", { name: "Search assignees" });

    // Only the accounts holding at least Triage permission are offered, and
    // each option carries the exact username as its accessible name: the owner,
    // the Maintain grant of carol-maintainer and the Write grant of
    // bob-reviewer (REQ-6-3).
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "alice-dev" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "bob-reviewer" })).toBeTruthy();
    const memberOption = screen.getByRole("option", { name: "carol-maintainer" });
    expect(memberOption.getAttribute("aria-selected")).toBe("false");

    // The options follow the text without Enter and without a search button.
    await userEvent.type(search, "carol");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "carol-maintainer" })).toBeTruthy();
    await userEvent.clear(search);
    await userEvent.type(search, "dana");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matching items")).toBeTruthy();

    // Choosing an unassigned member saves immediately and closes the selector.
    await userEvent.clear(search);
    await userEvent.click(screen.getByRole("option", { name: "carol-maintainer" }));
    await waitFor(() => {
      expect(within(region("Assignees")).getByText("carol-maintainer")).toBeTruthy();
    });
    expect(screen.queryByRole("textbox", { name: "Search assignees" })).toBeNull();
    await waitFor(() => {
      expect(storedIssue(4)?.assignees).toEqual(["carol-maintainer"]);
    });
    expect(activityTexts().some((text) => text.includes("assigned carol-maintainer"))).toBe(true);
  });

  it("shows the selected member without another search and removes it on the second click", async () => {
    await openMetadataTarget("carol-maintainer");
    await userEvent.click(screen.getByRole("button", { name: "Assignees" }));
    await userEvent.click(screen.getByRole("option", { name: "carol-maintainer" }));
    await waitFor(() => {
      expect(within(region("Assignees")).getByText("carol-maintainer")).toBeTruthy();
    });

    // Reopening shows the stored selection without typing anything.
    await userEvent.click(screen.getByRole("button", { name: "Assignees" }));
    const selected = screen.getByRole("option", { name: "carol-maintainer" });
    expect(selected.getAttribute("aria-selected")).toBe("true");

    // Clicking it again removes the association and closes the selector.
    await userEvent.click(selected);
    await waitFor(() => {
      expect(within(region("Assignees")).getByText("No one assigned")).toBeTruthy();
    });
    expect(screen.queryByRole("option")).toBeNull();
    expect(storedIssue(4)?.assignees).toEqual([]);
    // Both historical records stay in the append-only activity history.
    expect(activityTexts().some((text) => text.includes("assigned carol-maintainer"))).toBe(true);
    expect(activityTexts().some((text) => text.includes("unassigned carol-maintainer"))).toBe(true);

    // The member account and its repository grant survive the unassignment.
    const repository = server.state.repositories.find((candidate) => candidate.name === "acme-docs");
    expect(repository?.grants).toEqual([
      { account: "carol-maintainer", role: "Maintain" },
      { account: "bob-reviewer", role: "Write" },
    ]);
  });

  it("keeps the final assignee set after a reload", async () => {
    await openMetadataTarget("carol-maintainer");
    await userEvent.click(screen.getByRole("button", { name: "Assignees" }));
    await userEvent.click(screen.getByRole("option", { name: "carol-maintainer" }));
    await waitFor(() => {
      expect(within(region("Assignees")).getByText("carol-maintainer")).toBeTruthy();
    });

    reopen("carol-maintainer", "#/alice-dev/acme-docs/issues/4");
    expect(await screen.findByRole("heading", { level: 1, name: "Add changelog page" })).toBeTruthy();
    expect(within(region("Assignees")).getByText("carol-maintainer")).toBeTruthy();
    expect(within(region("Assignees")).queryByText("No one assigned")).toBeNull();
  });

  it("hides the metadata controls from a viewer without the role", async () => {
    // bob-reviewer may read the public repository but holds no role on it.
    reset("bob-reviewer", "#/alice-dev/acme-docs/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });

    expect(screen.queryByRole("button", { name: "Assignees" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
    // The values themselves stay readable for everyone who may view the issue.
    expect(within(region("Assignees")).getByText("bob-reviewer")).toBeTruthy();
    expect(within(region("Labels")).getByText("bug")).toBeTruthy();
    expect(within(region("Milestone")).getByText("Q3 launch")).toBeTruthy();
  });
});

describe("REQ-5-3-2 apply labels to an issue", () => {
  it("offers the labels of the current repository and applies and removes one", async () => {
    await openMetadataTarget("carol-maintainer");
    await userEvent.click(screen.getByRole("button", { name: "Labels" }));

    // Only the labels of this repository are offered.
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "bug" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "documentation" })).toBeTruthy();
    // A label of another repository is never offered.
    expect(screen.queryByRole("option", { name: "frontend" })).toBeNull();
    // The label selector needs no search step before choosing.
    expect(screen.queryByRole("textbox", { name: "Search labels" })).toBeNull();

    await userEvent.click(screen.getByRole("option", { name: "bug" }));
    await waitFor(() => {
      expect(within(region("Labels")).getByText("bug")).toBeTruthy();
    });
    expect(storedIssue(4)?.labels).toEqual(["bug"]);
    // The issue list displays the same stored label.
    expect(activityTexts().some((text) => text.includes("added the bug label"))).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Labels" }));
    expect(screen.getByRole("option", { name: "bug" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("option", { name: "bug" }));
    await waitFor(() => {
      expect(within(region("Labels")).getByText("None yet")).toBeTruthy();
    });
    expect(storedIssue(4)?.labels).toEqual([]);
    expect(activityTexts().some((text) => text.includes("removed the bug label"))).toBe(true);
  });

  it("keeps the label set after a reload and shows it in the issue list", async () => {
    await openMetadataTarget("carol-maintainer");
    await userEvent.click(screen.getByRole("button", { name: "Labels" }));
    await userEvent.click(screen.getByRole("option", { name: "documentation" }));
    await waitFor(() => {
      expect(within(region("Labels")).getByText("documentation")).toBeTruthy();
    });

    reopen("carol-maintainer", "#/alice-dev/acme-docs/issues");
    const row = await screen.findByRole("link", { name: "Add changelog page" });
    const item = row.closest("li");
    expect(item).toBeTruthy();
    expect(within(item as HTMLElement).getByText("documentation")).toBeTruthy();

    reopen("carol-maintainer", "#/alice-dev/acme-docs/issues/4");
    expect(await screen.findByRole("heading", { level: 1, name: "Add changelog page" })).toBeTruthy();
    expect(within(region("Labels")).getByText("documentation")).toBeTruthy();
  });
});

describe("REQ-5-3-3 assign an issue to a milestone", () => {
  it("selects a milestone of the current repository and removes it with None", async () => {
    await openMetadataTarget("carol-maintainer");
    await userEvent.click(screen.getByRole("button", { name: "Milestone" }));

    // The selectable items are the milestones of this repository plus None,
    // each named exactly after the item.
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "Q3 launch" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "v1.0" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "None" })).toBeTruthy();
    // A milestone of another repository is never offered.
    expect(screen.queryByRole("option", { name: "Web launch" })).toBeNull();

    await userEvent.click(screen.getByRole("option", { name: "v1.0" }));
    await waitFor(() => {
      expect(within(region("Milestone")).getByText("v1.0")).toBeTruthy();
    });
    expect(screen.queryByRole("option")).toBeNull();
    expect(storedIssue(4)?.milestone).toBe("v1.0");
    expect(activityTexts().some((text) => text.includes("added this issue to the v1.0 milestone"))).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Milestone" }));
    expect(screen.getByRole("option", { name: "v1.0" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("option", { name: "None" }));
    await waitFor(() => {
      expect(within(region("Milestone")).getByText("No milestone")).toBeTruthy();
    });
    expect(storedIssue(4)?.milestone).toBeNull();

    reopen("carol-maintainer", "#/alice-dev/acme-docs/issues/4");
    expect(await screen.findByRole("heading", { level: 1, name: "Add changelog page" })).toBeTruthy();
    expect(within(region("Milestone")).getByText("No milestone")).toBeTruthy();
  });
});

describe("REQ-5-4 close or reopen an issue", () => {
  it("closes and reopens the issue from the detail view", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/issues/4");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Add changelog page" });

    await userEvent.click(screen.getByRole("button", { name: "Close issue" }));
    await waitFor(() => {
      expect(screen.getByText("Closed", { exact: true })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(storedIssue(4)?.status).toBe("closed");
    // The visible status and the recorded activity read as their own texts.
    expect(within(region("Activity")).getByText("Closed issue", { exact: true })).toBeTruthy();
    expect(activityTexts().some((text) => text.includes("Closed issue"))).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Reopen issue" }));
    await waitFor(() => {
      expect(screen.getByText("Open", { exact: true })).toBeTruthy();
    });
    expect(storedIssue(4)?.status).toBe("open");
    expect(within(region("Activity")).getByText("Reopened issue", { exact: true })).toBeTruthy();
    const texts = activityTexts();
    expect(texts.findIndex((text) => text.includes("Closed issue")))
      .toBeLessThan(texts.findIndex((text) => text.includes("Reopened issue")));

    // The transition changed nothing but the status.
    const stored = storedIssue(4);
    expect(stored?.title).toBe("Add changelog page");
    expect(stored?.labels).toEqual([]);
    expect(stored?.assignees).toEqual([]);
    expect(stored?.milestone).toBeNull();

    // After a reload the Open status and the “Close issue” button are back.
    reopen("alice-dev", "#/alice-dev/acme-docs/issues/4");
    expect(await screen.findByRole("heading", { level: 1, name: "Add changelog page" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close issue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
  });

  it("keeps the status unchanged for a viewer without issue-management permission", async () => {
    reset("bob-reviewer", "#/alice-dev/acme-docs/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });

    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(storedIssue(1)?.status).toBe("open");
  });

  it("shows neither control to the reader of the protected issue", async () => {
    // bob-reviewer may read the private repository but may not manage its
    // work items.
    reset("bob-reviewer", "#/alice-dev/secret-research/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Summarize the early findings" });

    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();

    // A visitor cannot read the protected issue at all.
    reset("visitor", "#/alice-dev/secret-research/issues/1");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  });
});
