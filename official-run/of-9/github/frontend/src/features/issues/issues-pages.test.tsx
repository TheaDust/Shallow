import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "../auth/session";
import { IssuesPage } from "./IssuesPage";
import { IssueDetailPage } from "./IssueDetailPage";
import { NewIssuePage } from "./NewIssuePage";
import type { IssueDetail } from "./api";
import type { RepoRole } from "../organizations/api";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  listIssues: vi.fn(),
  getIssue: vi.fn(),
  createIssue: vi.fn(),
  updateIssueTitle: vi.fn(),
  updateIssueDescription: vi.fn(),
  addIssueComment: vi.fn(),
  toggleIssueReaction: vi.fn(),
  toggleIssueAssignee: vi.fn(),
  toggleIssueLabel: vi.fn(),
  setIssueMilestone: vi.fn(),
  setIssueStatus: vi.fn(),
  getRepository: vi.fn(),
}));

vi.mock("../auth/api", () => ({
  fetchSession: mocks.fetchSession,
}));

vi.mock("./api", () => ({
  listIssues: mocks.listIssues,
  getIssue: mocks.getIssue,
  createIssue: mocks.createIssue,
  updateIssueTitle: mocks.updateIssueTitle,
  updateIssueDescription: mocks.updateIssueDescription,
  addIssueComment: mocks.addIssueComment,
  toggleIssueReaction: mocks.toggleIssueReaction,
  toggleIssueAssignee: mocks.toggleIssueAssignee,
  toggleIssueLabel: mocks.toggleIssueLabel,
  setIssueMilestone: mocks.setIssueMilestone,
  setIssueStatus: mocks.setIssueStatus,
}));

vi.mock("../organizations/api", () => ({
  getRepository: mocks.getRepository,
}));

const now = new Date().toISOString();

const labelOptions = [
  { name: "bug", color: "#d73a4a" },
  { name: "documentation", color: "#0075ca" },
];

const listData = {
  repository: { owner: "alice-dev", name: "acme-docs" },
  myRole: "admin" as const,
  labels: labelOptions,
  issues: [
    {
      number: 4,
      title: "Improve onboarding flow",
      status: "open" as const,
      author: "alice-dev",
      labels: ["bug"],
      searchText: "Improve onboarding flow\nThe onboarding flow should guide new users through the first steps.",
      updatedAt: now,
    },
    {
      number: 3,
      title: "Original issue title",
      status: "open" as const,
      author: "alice-dev",
      labels: [] as string[],
      searchText: "Original issue title\nThis issue keeps its original title.",
      updatedAt: now,
    },
    {
      number: 2,
      title: "Legacy welcome text",
      status: "closed" as const,
      author: "alice-dev",
      labels: ["bug"],
      searchText:
        "Legacy welcome text\nThe welcome text shown to new users is outdated and should be replaced. New onboarding guidance should become the default as part of the Improve onboarding work.",
      updatedAt: now,
    },
    {
      number: 1,
      title: "Improve onboarding",
      status: "open" as const,
      author: "alice-dev",
      // Seed semantics: exactly one label is applied to the seeded open issue;
      // `bug` starts unapplied so REQ-5-3-2 can apply and remove it.
      labels: ["documentation"],
      searchText: "Improve onboarding\nDescribe the onboarding improvement.",
      updatedAt: now,
    },
  ],
};

function makeIssue(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    number: 1,
    title: "Improve onboarding",
    description: "Describe the onboarding improvement.",
    status: "open" as const,
    author: "alice-dev",
    createdAt: now,
    updatedAt: now,
    assignees: ["bob-reviewer"],
    // Seed semantics: exactly one label is applied; `bug` starts unapplied so
    // REQ-5-3-2 can apply and remove it.
    labels: [{ name: "documentation", color: "#0075ca" }],
    milestone: { id: "m1", title: "Q3 launch" },
    comments: [
      {
        id: "c1",
        author: "bob-reviewer",
        body: "I can draft the new onboarding flow.",
        createdAt: now,
        reactions: {},
      },
    ],
    reactions: {},
    timeline: [
      { id: "t1", type: "created", author: "alice-dev", createdAt: now },
      { id: "t2", type: "comment", author: "bob-reviewer", commentId: "c1", createdAt: now },
    ],
    ...overrides,
  };
}

function makeDetail(overrides: { issue?: Partial<IssueDetail>; myRole?: RepoRole | null } = {}) {
  return {
    issue: makeIssue(overrides.issue),
    myRole: overrides.myRole ?? null,
    labels: labelOptions,
    milestones: [
      { id: "m1", title: "Q3 launch" },
      { id: "m2", title: "v1.0" },
    ],
    assignableMembers: ["alice-dev"],
  };
}

const anonymousSession = { authenticated: false };
const aliceSession = {
  authenticated: true,
  account: { username: "alice-dev", email: "alice.dev@example.test" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSession.mockResolvedValue(anonymousSession);
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

describe("IssuesPage (list and filter)", () => {
  it("renders issue rows with number, title link, status, author, labels and update time", async () => {
    mocks.listIssues.mockResolvedValue(listData);
    render(
      <SessionProvider>
        <IssuesPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Issues" });
    const open = screen.getByRole("link", { name: "Improve onboarding" });
    expect(open.getAttribute("href")).toBe("#/repos/alice-dev/acme-docs/issues/1");
    expect(screen.getByRole("link", { name: "#1" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Original issue title" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Improve onboarding flow" })).toBeTruthy();
    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/opened by/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("bug").length).toBeGreaterThan(0);
    expect(screen.getAllByText("documentation").length).toBeGreaterThan(0);

    // Rows use real table-row semantics so each row is locatable as role=row.
    const rows = screen.getAllByRole("row");
    const bugRow = rows.filter((row) =>
      row.textContent?.includes("Improve onboarding flow"),
    );
    expect(bugRow.length).toBe(1);
    expect(within(bugRow[0]).getByText("bug", { exact: true })).toBeTruthy();
  });

  it("provides Open and Closed links and the Search issues searchbox", async () => {
    mocks.listIssues.mockResolvedValue(listData);
    render(
      <SessionProvider>
        <IssuesPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Issues" });

    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
      "#/repos/alice-dev/acme-docs/issues?state=open",
    );
    expect(screen.getByRole("link", { name: "Closed" }).getAttribute("href")).toBe(
      "#/repos/alice-dev/acme-docs/issues?state=closed",
    );
    expect(screen.getByRole("searchbox", { name: "Search issues" })).toBeTruthy();
    expect(screen.getByLabelText("Label")).toBeTruthy();
  });

  it("filters rows as the user types the whole seeded title without Enter", async () => {
    const user = userEvent.setup();
    mocks.listIssues.mockResolvedValue(listData);
    render(
      <SessionProvider>
        <IssuesPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Issues" });

    const search = screen.getByRole("searchbox", { name: "Search issues" });
    await user.type(search, "Improve onboarding");

    await waitFor(() => {
      // The known seeded title is retained while unrelated rows are filtered out.
      expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Original issue title" })).toBeNull();
    });
    // The chosen filter context is retained in the URL so a reload keeps it.
    expect(window.location.hash).toContain("q=Improve+onboarding");
  });

  it("combines Open state with keyword and label filters and keeps the URL context", async () => {
    const user = userEvent.setup();
    mocks.listIssues.mockResolvedValue(listData);
    render(
      <SessionProvider>
        <IssuesPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Issues" });

    await user.click(screen.getByRole("link", { name: "Open" }));
    const search = screen.getByRole("searchbox", { name: "Search issues" });
    await user.type(search, "onboarding");
    await user.selectOptions(screen.getByLabelText("Label"), "bug");

    await waitFor(() => {
      // The matching Open issue with the bug label is the only remaining row.
      expect(screen.getByRole("link", { name: "Improve onboarding flow" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Original issue title" })).toBeNull();
    });

    // Switch to Closed: the open issue disappears and the matching closed one shows.
    await user.click(screen.getByRole("link", { name: "Closed" }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    });
  });

  it("retains the chosen filter context and matching rows after reload", async () => {
    mocks.listIssues.mockResolvedValue(listData);
    window.location.hash = "#/repos/alice-dev/acme-docs/issues?state=closed&q=Legacy+welcome+text";
    render(
      <SessionProvider>
        <IssuesPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Issues" });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Original issue title" })).toBeNull();
    });
  });

  it("shows the New issue link only to signed-in users with write permission", async () => {
    mocks.listIssues.mockResolvedValue({ ...listData, myRole: null });
    render(
      <SessionProvider>
        <IssuesPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Issues" });
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();

    cleanup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.listIssues.mockResolvedValue(listData);
    render(
      <SessionProvider>
        <IssuesPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    const link = await screen.findByRole("link", { name: "New issue" });
    expect(link.getAttribute("href")).toBe("#/repos/alice-dev/acme-docs/issues/new");
  });
});

describe("IssueDetailPage (view and discussion)", () => {
  it("displays number, exact title heading, status, description, metadata and discussion", async () => {
    mocks.getIssue.mockResolvedValue(makeDetail());
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    const heading = await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(heading.tagName).toBe("H1");
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(screen.getAllByText("bob-reviewer").length).toBeGreaterThan(0);
    expect(screen.getByText("Q3 launch")).toBeTruthy();
    expect(screen.getByText("I can draft the new onboarding flow.")).toBeTruthy();
    expect(screen.getByText("alice-dev created this issue")).toBeTruthy();
    expect(screen.getByText("bob-reviewer commented")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comments" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Activity" })).toBeTruthy();
  });

  it("does not show edit or comment controls to anonymous readers", async () => {
    mocks.getIssue.mockResolvedValue(makeDetail());
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Edit issue title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit issue description" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reactions" })).toBeNull();
  });

  it("lets a Maintain edit the title and description and records the change", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.getIssue.mockResolvedValue(makeDetail({ myRole: "maintain" }));
    const updated = makeIssue({
      title: "Improved onboarding flow",
      description: "Rewrite the welcome screens.",
      timeline: [
        { id: "t1", type: "created", author: "alice-dev", createdAt: now },
        { id: "t3", type: "title-edited", author: "alice-dev", createdAt: now, oldTitle: "Improve onboarding", newTitle: "Improved onboarding flow" },
        { id: "t4", type: "description-edited", author: "alice-dev", createdAt: now, oldDescription: "Describe the onboarding improvement.", newDescription: "Rewrite the welcome screens." },
      ],
    });
    mocks.updateIssueTitle.mockResolvedValue({ ok: true, issue: updated });
    mocks.updateIssueDescription.mockResolvedValue({ ok: true, issue: updated });
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });

    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleBox = screen.getByLabelText("Issue title") as HTMLInputElement;
    expect(titleBox.value).toBe("Improve onboarding");
    await user.clear(titleBox);
    await user.type(titleBox, "Improved onboarding flow");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Improved onboarding flow" })).toBeTruthy();
    });
    expect(screen.queryByLabelText("Issue title")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit issue description" }));
    const descriptionBox = screen.getByLabelText("Issue description") as HTMLTextAreaElement;
    await user.clear(descriptionBox);
    await user.type(descriptionBox, "Rewrite the welcome screens.");
    await user.click(screen.getByRole("button", { name: "Save issue description" }));
    await waitFor(() => {
      expect(screen.getByText("Rewrite the welcome screens.")).toBeTruthy();
    });
  });

  it("keeps the original title and shows Title is required for a blank edit", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.getIssue.mockResolvedValue(makeDetail({ myRole: "admin" }));
    mocks.updateIssueTitle.mockResolvedValue({ ok: false, errors: { title: "Title is required" } });
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });

    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleBox = screen.getByLabelText("Issue title") as HTMLInputElement;
    await user.clear(titleBox);
    await user.type(titleBox, "   ");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));

    await screen.findByText("Title is required");
    expect(screen.getByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
  });

  it("appends a comment with the current user and rejects whitespace-only input", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    let detail = makeDetail({ myRole: "write" });
    mocks.getIssue.mockImplementation(() => Promise.resolve(detail));
    mocks.addIssueComment.mockImplementation(async (owner, repo, number, body) => {
      detail = makeDetail({
        myRole: "write",
        issue: {
          comments: [
            ...makeIssue().comments,
            { id: "c2", author: "alice-dev", body, createdAt: now, reactions: {} },
          ],
          timeline: [
            ...makeIssue().timeline,
            { id: "t3", type: "comment", author: "alice-dev", commentId: "c2", createdAt: now },
          ],
        },
      });
      return { ok: true, comment: { id: "c2", author: "alice-dev", body, createdAt: now, reactions: {} } };
    });
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });

    const box = screen.getByLabelText("Comment") as HTMLTextAreaElement;
    await user.type(box, "I will prepare the copy.");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(screen.getByText("I will prepare the copy.")).toBeTruthy();
    });
    expect(mocks.addIssueComment).toHaveBeenCalledWith(
      "alice-dev",
      "acme-docs",
      1,
      "I will prepare the copy.",
    );

    // Whitespace-only: no API call, error shown, no new article.
    await user.type(box, "   \n  ");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("Comment is required");
    expect(screen.getAllByText("I will prepare the copy.").length).toBe(1);
  });

  it("toggles a reaction on an existing comment without duplicating it", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    let detail = makeDetail({ myRole: "write" });
    mocks.getIssue.mockImplementation(() => Promise.resolve(detail));
    mocks.toggleIssueReaction.mockImplementation(async (
      owner: string,
      repo: string,
      number: number,
      input: { targetType: "issue" | "comment"; targetId: string; reaction: string },
    ) => {
      const comment = makeIssue().comments[0];
      const current = comment.reactions[input.reaction] ?? { count: 0, reacted: false };
      const reacted = !current.reacted;
      const reactions = {
        [input.reaction]: { count: reacted ? 1 : 0, reacted },
      };
      detail = makeDetail({ myRole: "write", issue: { comments: [{ ...comment, reactions }] } });
      return { ok: true, reactions };
    });
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });

    const commentArticle = screen
      .getByText("I can draft the new onboarding flow.")
      .closest("article") as HTMLElement;
    await user.click(within(commentArticle).getByRole("button", { name: "Reactions" }));
    await user.click(await screen.findByRole("menuitem", { name: "👍" }));

    const badge = await screen.findByRole("button", { name: /👍 1/ });
    expect(badge.getAttribute("aria-pressed")).toBe("true");
    expect(mocks.toggleIssueReaction).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, {
      targetType: "comment",
      targetId: "c1",
      reaction: "👍",
    });
  });
});

describe("IssueDetailPage (assignees, labels, milestone and status)", () => {
  it("assigns and unassigns a member through the Search assignees selector", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    let detail = makeDetail({ myRole: "admin" });
    mocks.getIssue.mockImplementation(() => Promise.resolve(detail));
    mocks.toggleIssueAssignee.mockImplementation(async (owner, repo, number, username) => {
      const assignees = detail.issue.assignees.includes(username)
        ? detail.issue.assignees.filter((item) => item !== username)
        : [...detail.issue.assignees, username];
      detail = makeDetail({
        myRole: "admin",
        issue: {
          assignees,
          timeline: [
            ...makeIssue().timeline,
            {
              id: "t3",
              type: detail.issue.assignees.includes(username) ? "unassigned" : "assigned",
              author: "alice-dev",
              createdAt: now,
              targetUsername: username,
            },
          ],
        },
      });
      return { ok: true, issue: detail.issue };
    });
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });

    // The settings icon is a button named after the section.
    const trigger = screen.getByRole("button", { name: "Assignees" });
    await user.click(trigger);

    // The open selector contains the Search assignees textbox and options.
    const search = screen.getByRole("searchbox", { name: "Search assignees" });
    expect(screen.getByRole("option", { name: "alice-dev" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "carol-dev" })).toBeNull();

    // Typing filters the matching options without pressing Enter.
    await user.type(search, "alic");
    expect(screen.getByRole("option", { name: "alice-dev" })).toBeTruthy();
    await user.clear(search);
    await user.type(search, "carol");
    expect(screen.queryByRole("option", { name: "alice-dev" })).toBeNull();
    expect(screen.getByText("No results")).toBeTruthy();

    // Clicking the option saves immediately and closes the selector.
    await user.clear(search);
    await user.click(screen.getByRole("option", { name: "alice-dev" }));
    await waitFor(() => {
      expect(screen.queryByRole("searchbox", { name: "Search assignees" })).toBeNull();
    });
    expect(screen.getAllByText("alice-dev").length).toBeGreaterThan(0);
    // The assignee entry is a listitem whose accessible name is the username.
    const assigneeRegion = screen.getByRole("region", { name: "Assignees" });
    expect(
      within(assigneeRegion).getByRole("listitem", { name: "alice-dev" }),
    ).toBeTruthy();
    expect(screen.getByText("alice-dev assigned alice-dev")).toBeTruthy();
    expect(mocks.toggleIssueAssignee).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, "alice-dev");

    // Reopening shows the selected member without another search; clicking
    // removes the assignment and closes the selector again.
    await user.click(screen.getByRole("button", { name: "Assignees" }));
    const selected = screen.getByRole("option", { name: "alice-dev" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    await user.click(selected);
    await waitFor(() => {
      expect(screen.queryByRole("searchbox", { name: "Search assignees" })).toBeNull();
    });
    expect(screen.queryByText(/^alice-dev$/)).toBeNull();
    expect(screen.getByText("alice-dev unassigned alice-dev")).toBeTruthy();
  });

  it("applies and removes a repository label through the Labels selector", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    let detail = makeDetail({ myRole: "admin" });
    mocks.getIssue.mockImplementation(() => Promise.resolve(detail));
    mocks.toggleIssueLabel.mockImplementation(async (owner, repo, number, name) => {
      const names = detail.issue.labels.map((label) => label.name);
      const applied = names.includes(name)
        ? names.filter((item) => item !== name)
        : [...names, name];
      detail = makeDetail({
        myRole: "admin",
        issue: {
          labels: applied.map((labelName) => ({
            name: labelName,
            color: labelName === "bug" ? "#d73a4a" : "#0075ca",
          })),
        },
      });
      return { ok: true, issue: detail.issue };
    });
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });

    await user.click(screen.getByRole("button", { name: "Labels" }));
    const bugOption = screen.getByRole("option", { name: "bug" });
    expect(bugOption.getAttribute("aria-selected")).toBe("false");
    await user.click(bugOption);

    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: "Labels" })).toBeNull();
    });
    expect(screen.getAllByText("bug").length).toBeGreaterThan(0);
    expect(mocks.toggleIssueLabel).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, "bug");

    // Reopening and selecting the same option removes the association.
    await user.click(screen.getByRole("button", { name: "Labels" }));
    const bugAgain = screen.getByRole("option", { name: "bug" });
    expect(bugAgain.getAttribute("aria-selected")).toBe("true");
    await user.click(bugAgain);
    await waitFor(() => {
      expect(screen.queryByRole("option", { name: "bug" })).toBeNull();
    });
  });

  it("selects a repository milestone and removes it with None", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    let detail = makeDetail({ myRole: "admin" });
    mocks.getIssue.mockImplementation(() => Promise.resolve(detail));
    mocks.setIssueMilestone.mockImplementation(async (owner, repo, number, milestoneId) => {
      const milestone = milestoneId
        ? detail.milestones.find((item) => item.id === milestoneId) ?? null
        : null;
      detail = makeDetail({ myRole: "admin", issue: { milestone } });
      return { ok: true, issue: detail.issue };
    });
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });

    await user.click(screen.getByRole("button", { name: "Milestone" }));
    const v10 = screen.getByRole("option", { name: "v1.0" });
    expect(screen.getByRole("option", { name: "None" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Q3 launch" }).getAttribute("aria-selected")).toBe("true");
    await user.click(v10);

    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: "Milestone" })).toBeNull();
    });
    expect(screen.getByText("v1.0")).toBeTruthy();
    expect(mocks.setIssueMilestone).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, "m2");

    // Reopening and choosing None removes the association.
    await user.click(screen.getByRole("button", { name: "Milestone" }));
    expect(screen.getByRole("option", { name: "v1.0" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("option", { name: "None" }));
    await waitFor(() => {
      expect(screen.queryByRole("option", { name: "None" })).toBeNull();
    });
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(mocks.setIssueMilestone).toHaveBeenLastCalledWith("alice-dev", "acme-docs", 1, null);
  });

  it("closes and reopens an issue and records both activities", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    let detail = makeDetail({ myRole: "admin" });
    mocks.getIssue.mockImplementation(() => Promise.resolve(detail));
    mocks.setIssueStatus.mockImplementation(async (owner, repo, number, status) => {
      detail = makeDetail({
        myRole: "admin",
        issue: {
          status,
          timeline: [
            ...makeIssue().timeline,
            {
              id: "t3",
              type: status === "closed" ? "closed" : "reopened",
              author: "alice-dev",
              createdAt: now,
            },
          ],
        },
      });
      return { ok: true, issue: detail.issue };
    });
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });

    expect(screen.getByRole("button", { name: "Close issue" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close issue" }));
    await waitFor(() => {
      expect(screen.getByText("Closed")).toBeTruthy();
    });
    expect(screen.getByText("Closed issue")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Reopen issue" }));
    await waitFor(() => {
      expect(screen.getByText("Open")).toBeTruthy();
    });
    expect(screen.getByText("Reopened issue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close issue" })).toBeTruthy();
    expect(mocks.setIssueStatus).toHaveBeenNthCalledWith(1, "alice-dev", "acme-docs", 1, "closed");
    expect(mocks.setIssueStatus).toHaveBeenNthCalledWith(2, "alice-dev", "acme-docs", 1, "open");
  });

  it("hides metadata pickers and status controls from Read and Write users", async () => {
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.getIssue.mockResolvedValue(makeDetail({ myRole: "write" }));
    render(
      <SessionProvider>
        <IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Assignees" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
  });
});

describe("NewIssuePage (create)", () => {
  it("creates an issue with a unique number and opens its detail page", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.getRepository.mockResolvedValue({
      owner: "alice-dev",
      name: "acme-docs",
      myRole: "admin",
    });
    mocks.createIssue.mockResolvedValue({
      ok: true,
      issue: { number: 4, title: "Fix the placeholder", status: "open", author: "alice-dev" },
    });
    render(
      <SessionProvider>
        <NewIssuePage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "New issue" });

    await user.type(screen.getByLabelText("Title"), "Fix the placeholder");
    await user.type(screen.getByLabelText("Description"), "The placeholder is confusing.");
    await user.click(screen.getByRole("button", { name: "Submit new issue" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/repos/alice-dev/acme-docs/issues/4");
    });
    expect(mocks.createIssue).toHaveBeenCalledWith("alice-dev", "acme-docs", {
      title: "Fix the placeholder",
      description: "The placeholder is confusing.",
    });
  });

  it("treats a title of three spaces as blank and shows Title is required", async () => {
    const user = userEvent.setup();
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.getRepository.mockResolvedValue({
      owner: "alice-dev",
      name: "acme-docs",
      myRole: "admin",
    });
    mocks.createIssue.mockResolvedValue({ ok: false, errors: { title: "Title is required" } });
    render(
      <SessionProvider>
        <NewIssuePage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "New issue" });

    await user.type(screen.getByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: "Submit new issue" }));

    await screen.findByText("Title is required");
    expect(window.location.hash).toBe("");
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
  });

  it("denies anonymous visitors", async () => {
    mocks.fetchSession.mockResolvedValue(anonymousSession);
    render(
      <SessionProvider>
        <NewIssuePage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Access denied" });
  });
});
