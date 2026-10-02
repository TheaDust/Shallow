import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { filterIssues, parseIssueFilters } from "./issue-filters";
import { createRepositoryMock, type MockRepositoryServer } from "../../test/repository-server-mock";

let server: MockRepositoryServer;

beforeEach(() => {
  server = createRepositoryMock({ viewer: "visitor" });
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

function issueSearch() {
  return screen.getByRole("searchbox", { name: "Search issues" });
}

function labelFilter() {
  return screen.getByRole("combobox", { name: "Label" });
}

function rowOf(title: string): HTMLElement {
  const link = screen.getByRole("link", { name: title });
  const row = link.closest("li");
  if (!row) throw new Error(`no row for ${title}`);
  return row;
}

/** The stored work items of acme-docs, as the server currently holds them. */
function storedIssues() {
  const repository = server.state.repositories.find((candidate) => candidate.name === "acme-docs");
  return JSON.parse(JSON.stringify(repository?.issues ?? []));
}

describe("REQ-5-1-1 list and filter repository issues", () => {
  it("shows a row with number, title, status, author, labels and update time", async () => {
    window.location.hash = "#/alice-dev/acme-docs/issues";
    render(<App />);

    const open = await screen.findByRole("link", { name: "Improve onboarding" });
    expect((open as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs/issues/1");
    const openRow = rowOf("Improve onboarding");
    expect(within(openRow).getByRole("link", { name: "#1" }).getAttribute("href")).toBe(
      "#/alice-dev/acme-docs/issues/1",
    );
    expect(within(openRow).getByText("Open")).toBeTruthy();
    expect(within(openRow).getByText("alice-dev")).toBeTruthy();
    expect(within(openRow).getByText("bug")).toBeTruthy();
    expect(within(openRow).getByText("documentation")).toBeTruthy();
    expect(within(openRow).getByText(/ago|2024/)).toBeTruthy();

    const closedRow = rowOf("Legacy welcome text");
    expect(within(closedRow).getByText("Closed")).toBeTruthy();
    expect(within(closedRow).getByText("bob-reviewer")).toBeTruthy();
    expect(within(closedRow).getByText("bug")).toBeTruthy();

    // The repository navigation stays on the page and identifies the repository.
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Issues" })).toBeTruthy();
  });

  it("filters by the Open and Closed links, live keywords and the label", async () => {
    window.location.hash = "#/alice-dev/acme-docs/issues";
    render(<App />);
    await screen.findByRole("link", { name: "Improve onboarding" });

    // Open is a link, not a button or a tab.
    const openLink = screen.getByRole("link", { name: "Open" });
    expect(openLink.getAttribute("href")).toBe("#/alice-dev/acme-docs/issues?state=open");
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Open" })).toBeNull();

    await userEvent.click(openLink);
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();
    });
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();

    // Typing narrows the rows without Enter and without a search button.
    await userEvent.type(issueSearch(), "onboarding");
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/issues?state=open&q=onboarding");
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();

    // The label filter combines with the keyword filter.
    await userEvent.selectOptions(labelFilter(), "bug");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();

    // Switching to Closed excludes the open issue and shows the closed one.
    await userEvent.click(screen.getByRole("link", { name: "Closed" }));
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    });
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();
    expect(screen.getByText("No issues match your filters.")).toBeTruthy();

    // The closed issue is found with its own title once the keyword is replaced.
    await userEvent.clear(issueSearch());
    await userEvent.type(issueSearch(), "Legacy welcome text");
    const closed = await screen.findByRole("link", { name: "Legacy welcome text" });
    expect((closed as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs/issues/2");
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
  });

  it("keeps the chosen filter context and rows after a reload", async () => {
    window.location.hash = "#/alice-dev/acme-docs/issues";
    render(<App />);
    await screen.findByRole("link", { name: "Improve onboarding" });

    await userEvent.click(screen.getByRole("link", { name: "Closed" }));
    await userEvent.type(issueSearch(), "Legacy welcome text");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
    });
    const address = window.location.hash;
    expect(address).toContain("#/alice-dev/acme-docs/issues?state=closed&q=Legacy");
    expect(decodeURIComponent(address.replace(/\+/g, " "))).toContain("q=Legacy welcome text");

    // A reload re-reads the same filter context from the address and shows the
    // same matching rows.
    reset("visitor", address);
    render(<App />);
    expect(await screen.findByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect((issueSearch() as HTMLInputElement).value).toBe("Legacy welcome text");
    expect((labelFilter() as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("link", { name: "Closed" }).getAttribute("aria-current")).toBe("page");
  });

  it("filters without creating, changing or deleting any issue", async () => {
    window.location.hash = "#/alice-dev/acme-docs/issues";
    render(<App />);
    await screen.findByRole("link", { name: "Improve onboarding" });
    const before = storedIssues();

    await userEvent.click(screen.getByRole("link", { name: "Open" }));
    await userEvent.type(issueSearch(), "onboarding");
    await userEvent.selectOptions(labelFilter(), "bug");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    });

    expect(storedIssues()).toEqual(before);
  });

  it("offers the repository labels in the label filter and reports an empty list", async () => {
    window.location.hash = "#/acme-demo/acme-web/issues";
    render(<App />);

    await screen.findByText("No issues yet.");
    const options = within(labelFilter()).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["All labels"]);
  });

  it("does not show the issues of a private repository to a caller without access", async () => {
    window.location.hash = "#/alice-dev/secret-research/issues";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Search issues" })).toBeNull();
  });
});

describe("REQ-5-1-2 view an issue and its discussion", () => {
  it("opens the detail page from the row and shows the stored work item", async () => {
    window.location.hash = "#/alice-dev/acme-docs/issues";
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "Improve onboarding" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/issues/1");

    // The heading is the complete title without the issue number; the number
    // and the status are displayed next to it.
    const heading = await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });
    expect(heading.tagName).toBe("H1");
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();

    // The right side lists Assignees, Labels and Milestone in that order.
    const assignees = screen.getByRole("region", { name: "Assignees" });
    expect(within(assignees).getByText("bob-reviewer")).toBeTruthy();
    const labels = screen.getByRole("region", { name: "Labels" });
    expect(within(labels).getByText("bug")).toBeTruthy();
    expect(within(labels).getByText("documentation")).toBeTruthy();
    const milestone = screen.getByRole("region", { name: "Milestone" });
    expect(within(milestone).getByText("Q3 launch")).toBeTruthy();

    // The discussion holds the comment and the chronological activity history.
    const comments = screen.getByRole("region", { name: "Discussion" });
    expect(within(comments).getByText("bob-reviewer")).toBeTruthy();
    expect(
      within(comments).getByText("Great idea. Let us start with the welcome screen."),
    ).toBeTruthy();

    const activity = screen.getByRole("region", { name: "Activity" });
    const events = within(activity).getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toContain("opened this issue");
    expect(events[events.length - 1]).toContain("commented");
    expect(events.some((event) => event.includes("assigned bob-reviewer"))).toBe(true);
  });

  it("reopens the same issue number and keeps the stored data after a reload", async () => {
    window.location.hash = "#/alice-dev/acme-docs/issues/2";
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("The welcome text still names the retired demo environment.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Discussion" })).getByText("No comments yet.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Assignees" })).getByText("No one assigned")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Milestone" })).getByText("No milestone")).toBeTruthy();

    reset("visitor", "#/alice-dev/acme-docs/issues/2");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  it("answers an unknown number and a caller without access without showing content", async () => {
    window.location.hash = "#/alice-dev/acme-docs/issues/99";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Issue not found" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Improve onboarding" })).toBeNull();

    reset("visitor", "#/alice-dev/secret-research/issues/1");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Improve onboarding" })).toBeNull();
    expect(screen.queryByText("Describe the onboarding improvement.")).toBeNull();
  });

  it("signs in from the home page and reads the issue with its discussion", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("link", { name: "Sign in" }));
    await userEvent.type(screen.getByLabelText("Username or email"), "alice-dev");
    await userEvent.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "alice-dev" })).toBeTruthy();
    });

    // The Issues entry of the readable repository opens the seeded work item.
    window.location.hash = "#/alice-dev/acme-docs/issues";
    await userEvent.click(await screen.findByRole("link", { name: "Improve onboarding" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(screen.getByText("Q3 launch")).toBeTruthy();

    // Reopening the same address keeps the signed-in read of the same record.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
  });
});

describe("REQ-5-1-1 issue filters", () => {
  const issues = [
    {
      number: 1,
      title: "Improve onboarding",
      body: "Describe the onboarding improvement.",
      status: "open" as const,
      author: "alice-dev",
      labels: ["bug", "documentation"],
      assignees: [],
      milestone: null,
      createdAt: null,
      updatedAt: null,
      commentCount: 0,
      reactions: [],
    },
    {
      number: 2,
      title: "Legacy welcome text",
      body: "The welcome text still names the retired demo environment.",
      status: "closed" as const,
      author: "bob-reviewer",
      labels: ["bug"],
      assignees: [],
      milestone: null,
      createdAt: null,
      updatedAt: null,
      commentCount: 0,
      reactions: [],
    },
  ];

  it("reads the filter context from the address and writes it back", () => {
    const filters = parseIssueFilters(new URLSearchParams("state=closed&q=Legacy&label=bug"));
    expect(filters).toEqual({ state: "closed", query: "Legacy", label: "bug" });
    expect(parseIssueFilters(new URLSearchParams("state=weird"))).toEqual({
      state: "",
      query: "",
      label: "",
    });
  });

  it("combines the status, keyword and label filters", () => {
    expect(filterIssues(issues, { state: "", query: "", label: "" }).map((issue) => issue.number)).toEqual([1, 2]);
    expect(filterIssues(issues, { state: "open", query: "", label: "" }).map((issue) => issue.number)).toEqual([1]);
    expect(filterIssues(issues, { state: "closed", query: "", label: "" }).map((issue) => issue.number)).toEqual([2]);
    expect(filterIssues(issues, { state: "", query: "onboarding", label: "" }).map((issue) => issue.number)).toEqual([1]);
    expect(filterIssues(issues, { state: "", query: "", label: "bug" }).map((issue) => issue.number)).toEqual([1, 2]);
    expect(
      filterIssues(issues, { state: "closed", query: "Legacy welcome text", label: "bug" }).map((issue) => issue.number),
    ).toEqual([2]);
    // The keyword also matches the stored description of an issue.
    expect(
      filterIssues(issues, { state: "", query: "retired demo environment", label: "" }).map((issue) => issue.number),
    ).toEqual([2]);
    expect(filterIssues(issues, { state: "open", query: "welcome", label: "" })).toEqual([]);
  });
});
