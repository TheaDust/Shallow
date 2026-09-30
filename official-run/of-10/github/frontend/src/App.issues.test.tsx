import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

/**
 * In-memory stand-in for the issue API (REQ-5). The data mirrors the seed: the
 * repository `acme-docs` defines the labels `bug` and `documentation` and the
 * milestone `Q3 launch`, `Improve onboarding` is the Open issue with the `bug`
 * label, one assignee and one comment, `Legacy welcome text` is the Closed issue
 * with the same label and `Original issue title` is the invalid-edit seed.
 */

type Role = "read" | "triage" | "write" | "maintain" | "admin" | null;

interface StubLabel {
  id: string;
  name: string;
  color: string;
}

interface StubActivity {
  id: string;
  type: string;
  actor: string;
  createdAt: string;
  to?: string;
  from?: string;
}

interface StubIssue {
  number: number;
  title: string;
  description: string;
  status: "open" | "closed";
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: StubLabel[];
  assignees: string[];
  milestone: { id: string; title: string } | null;
  comments: Array<{ id: string; author: string; body: string; createdAt: string }>;
  activities: StubActivity[];
}

const BUG: StubLabel = { id: "label-bug", name: "bug", color: "d73a4a" };
const DOCUMENTATION: StubLabel = { id: "label-documentation", name: "documentation", color: "0075ca" };
const MILESTONE = { id: "milestone-q3-launch", title: "Q3 launch" };
const V1 = { id: "milestone-v1-0", title: "v1.0" };
/** Members with at least Triage on the repository; `bob-reviewer` is outside it. */
const ASSIGNABLE = ["alice-dev", "carol-dev"];
/** The reaction types the discussion offers, in their display order. */
const REACTION_TYPES = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"];

interface StubReaction {
  type: string;
  count: number;
  reacted: boolean;
  users: string[];
}

interface StubReactionRow {
  /** The issue itself (`"issue"`) or the identifier of one comment. */
  target: string;
  type: string;
  user: string;
}

function seedIssues(): StubIssue[] {
  return [
    {
      number: 1,
      title: "Improve onboarding",
      description: "Describe the onboarding improvement.",
      status: "open",
      author: "alice-dev",
      createdAt: "2024-02-21T09:00:00.000Z",
      updatedAt: "2024-02-22T10:15:00.000Z",
      labels: [BUG],
      assignees: ["alice-dev"],
      milestone: MILESTONE,
      comments: [
        {
          id: "comment-1",
          author: "alice-dev",
          body: "The first-run wizard should mention the CLI install step.",
          createdAt: "2024-02-22T10:15:00.000Z",
        },
      ],
      activities: [
        { id: "activity-1", type: "created", actor: "alice-dev", createdAt: "2024-02-21T09:00:00.000Z" },
        { id: "activity-2", type: "commented", actor: "alice-dev", createdAt: "2024-02-22T10:15:00.000Z" },
      ],
    },
    {
      number: 2,
      title: "Legacy welcome text",
      description:
        "The legacy welcome text still describes the Improve onboarding flow, so it needs an update.",
      status: "closed",
      author: "alice-dev",
      createdAt: "2024-02-10T08:20:00.000Z",
      updatedAt: "2024-02-19T16:40:00.000Z",
      labels: [BUG],
      assignees: [],
      milestone: null,
      comments: [],
      activities: [
        { id: "activity-3", type: "created", actor: "alice-dev", createdAt: "2024-02-10T08:20:00.000Z" },
        { id: "activity-4", type: "closed", actor: "alice-dev", createdAt: "2024-02-19T16:40:00.000Z" },
      ],
    },
    {
      number: 3,
      title: "Original issue title",
      description: "This description is here for the editing workflow.",
      status: "open",
      author: "alice-dev",
      createdAt: "2024-02-23T13:05:00.000Z",
      updatedAt: "2024-02-23T13:05:00.000Z",
      labels: [],
      assignees: [],
      milestone: null,
      comments: [],
      activities: [
        { id: "activity-5", type: "created", actor: "alice-dev", createdAt: "2024-02-23T13:05:00.000Z" },
      ],
    },
  ];
}

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
  };
}

function repositoryContext(role: Role) {
  return {
    id: "repo-alice-dev-acme-docs",
    name: "acme-docs",
    fullName: "alice-dev/acme-docs",
    owner: { type: "user", login: "alice-dev" },
    visibility: "public",
    description: "Documentation and guides for the Acme platform.",
    defaultBranch: "main",
    updatedAt: "2024-03-02T10:00:00.000Z",
    branch: "main",
    branches: [{ name: "main", headCommitId: "commit-1" }],
    permissions: { role, canAdminister: role === "admin" },
  };
}

function summaryOf(issue: StubIssue) {
  return { ...issue, comments: undefined, activities: undefined, reactions: undefined };
}

function installFetch({ role = "admin" as Role, account = null as null | { username: string } } = {}) {
  const issues = seedIssues();
  let currentAccount = account;
  // One association per user, target and reaction type; a second selection of
  // the same reaction removes the stored association instead of adding one.
  const reactions: StubReactionRow[] = [];

  const viewerName = () => currentAccount?.username ?? null;
  const reactionSummary = (target: string): StubReaction[] => {
    const rows = reactions.filter((row) => row.target === target);
    return REACTION_TYPES.filter((type) => rows.some((row) => row.type === type)).map((type) => {
      const users = rows.filter((row) => row.type === type).map((row) => row.user);
      return { type, count: users.length, reacted: Boolean(viewerName() && users.includes(viewerName() as string)), users };
    });
  };
  const detailOf = (issue: StubIssue) => ({
    ...issue,
    reactions: reactionSummary("issue"),
    comments: issue.comments.map((comment) => ({
      ...comment,
      reactions: reactionSummary(comment.id),
    })),
  });
  const payloadOf = (issue: StubIssue) => ({
    repository: repositoryContext(role),
    issue: detailOf(issue),
    labels: [BUG, DOCUMENTATION],
    milestones: [MILESTONE, V1],
    assignableMembers: ASSIGNABLE,
  });

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const { pathname } = url;
    const method = init?.method ?? "GET";

    if (pathname === "/api/session") {
      return jsonResponse(200, {
        account: currentAccount
          ? {
              id: "account-alice-dev",
              username: currentAccount.username,
              email: "alice.dev@example.test",
              emailVerified: true,
            }
          : null,
      });
    }

    const listMatch = pathname.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/issues$/);
    if (listMatch) {
      if (method === "GET") {
        return jsonResponse(200, {
          repository: repositoryContext(role),
          issues: issues.map(summaryOf),
          labels: [BUG, DOCUMENTATION],
          milestones: [MILESTONE, V1],
        });
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      const title = String(body.title ?? "").trim();
      if (!title) {
        return jsonResponse(400, { error: "Issue creation failed", fields: { title: "Title is required" } });
      }
      const created: StubIssue = {
        number: Math.max(...issues.map((issue) => issue.number)) + 1,
        title,
        description: String(body.description ?? "").trim(),
        status: "open",
        author: "alice-dev",
        createdAt: "2024-03-03T09:00:00.000Z",
        updatedAt: "2024-03-03T09:00:00.000Z",
        labels: [],
        assignees: [],
        milestone: null,
        comments: [],
        activities: [
          { id: `activity-${issues.length + 1}`, type: "created", actor: "alice-dev", createdAt: "2024-03-03T09:00:00.000Z" },
        ],
      };
      issues.push(created);
      return jsonResponse(201, payloadOf(created));
    }

    const issueWriteMatch = pathname.match(
      /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)\/(comments|reactions|assignees|labels|milestone|status)$/,
    );
    if (issueWriteMatch) {
      const issue = issues.find((candidate) => candidate.number === Number(issueWriteMatch[3]));
      if (!issue) return jsonResponse(404, { error: "Issue not found", repository: repositoryContext(role) });
      const body = JSON.parse(String(init?.body ?? "{}"));
      const writer = () => currentAccount?.username ?? "alice-dev";

      if (issueWriteMatch[4] === "comments") {
        if (!currentAccount) return jsonResponse(401, { error: "Not authenticated" });
        if (role !== "write" && role !== "maintain" && role !== "admin") {
          return jsonResponse(403, { error: "You need write permission to change this issue." });
        }
        const text = String(body.body ?? "").trim();
        if (!text) {
          return jsonResponse(400, { error: "Comment failed", fields: { body: "Comment is required" } });
        }
        const commentId = `comment-${issue.comments.length + 1}`;
        issue.comments.push({
          id: commentId,
          author: writer(),
          body: text,
          createdAt: "2024-03-05T10:00:00.000Z",
        });
        issue.activities.push({
          id: `activity-comment-${issue.activities.length}`,
          type: "commented",
          actor: writer(),
          createdAt: "2024-03-05T10:00:00.000Z",
        });
        return jsonResponse(200, payloadOf(issue));
      }

      if (issueWriteMatch[4] === "reactions") {
        if (!currentAccount) return jsonResponse(401, { error: "Not authenticated" });
        const type = String(body.type ?? "");
        if (!REACTION_TYPES.includes(type)) {
          return jsonResponse(400, { error: "Reaction failed", fields: { type: "Unknown reaction" } });
        }
        const target = body.commentId ? String(body.commentId) : "issue";
        if (target !== "issue" && !issue.comments.some((comment) => comment.id === target)) {
          return jsonResponse(404, { error: "Not found" });
        }
        const existing = reactions.findIndex(
          (row) => row.target === target && row.type === type && row.user === writer(),
        );
        if (existing >= 0) reactions.splice(existing, 1);
        else reactions.push({ target, type, user: writer() });
        return jsonResponse(200, payloadOf(issue));
      }

      if (issueWriteMatch[4] === "assignees") {
        if (role !== "triage" && role !== "maintain" && role !== "admin") {
          return jsonResponse(403, { error: "You need triage permission to manage this issue." });
        }
        const username = String(body.username ?? "");
        if (!ASSIGNABLE.includes(username)) {
          return jsonResponse(400, { error: "Assignee update failed", fields: { username: "Not an assignable member" } });
        }
        const assigned = body.assigned !== false;
        issue.assignees = assigned
          ? Array.from(new Set([...issue.assignees, username]))
          : issue.assignees.filter((assignee) => assignee !== username);
        issue.activities.push({
          id: `activity-assignee-${issue.activities.length}`,
          type: assigned ? "assigned" : "unassigned",
          actor: writer(),
          createdAt: "2024-03-05T10:05:00.000Z",
          ...(assigned ? { to: username } : { from: username }),
        });
        return jsonResponse(200, payloadOf(issue));
      }

      if (issueWriteMatch[4] === "labels") {
        if (role !== "triage" && role !== "maintain" && role !== "admin") {
          return jsonResponse(403, { error: "You need triage permission to manage this issue." });
        }
        const label = [BUG, DOCUMENTATION].find((candidate) => candidate.id === String(body.labelId ?? ""));
        if (!label) {
          return jsonResponse(400, { error: "Label update failed", fields: { labelId: "Unknown label" } });
        }
        const applied = body.applied !== false;
        issue.labels = applied
          ? [...issue.labels.filter((current) => current.id !== label.id), label]
          : issue.labels.filter((current) => current.id !== label.id);
        issue.activities.push({
          id: `activity-label-${issue.activities.length}`,
          type: applied ? "labeled" : "unlabeled",
          actor: writer(),
          createdAt: "2024-03-05T10:10:00.000Z",
          ...(applied ? { to: label.name } : { from: label.name }),
        });
        return jsonResponse(200, payloadOf(issue));
      }

      if (issueWriteMatch[4] === "status") {
        if (!currentAccount) return jsonResponse(401, { error: "Not authenticated" });
        if (role !== "triage" && role !== "maintain" && role !== "admin") {
          return jsonResponse(403, { error: "You need triage permission to manage this issue." });
        }
        const status = String(body.status ?? "");
        if (status !== "open" && status !== "closed") {
          return jsonResponse(400, {
            error: "Status update failed",
            fields: { status: "Unknown status" },
          });
        }
        // Only a real transition is stored: asking for the current status again
        // appends neither a record nor a time.
        if (issue.status !== status) {
          issue.status = status;
          issue.updatedAt = "2024-03-06T11:00:00.000Z";
          issue.activities.push({
            id: `activity-status-${issue.activities.length}`,
            type: status === "closed" ? "closed" : "reopened",
            actor: writer(),
            createdAt: "2024-03-06T11:00:00.000Z",
          });
        }
        return jsonResponse(200, payloadOf(issue));
      }

      if (role !== "triage" && role !== "maintain" && role !== "admin") {
        return jsonResponse(403, { error: "You need triage permission to manage this issue." });
      }
      const wanted = body.milestoneId == null ? null : String(body.milestoneId);
      const milestone = wanted
        ? ([MILESTONE, V1].find((candidate) => candidate.id === wanted) ?? null)
        : null;
      if (wanted && !milestone) {
        return jsonResponse(400, { error: "Milestone update failed", fields: { milestoneId: "Unknown milestone" } });
      }
      const previous = issue.milestone;
      issue.milestone = milestone;
      issue.activities.push({
        id: `activity-milestone-${issue.activities.length}`,
        type: milestone ? "milestoned" : "unmilestoned",
        actor: writer(),
        createdAt: "2024-03-05T10:15:00.000Z",
        ...(milestone ? { to: milestone.title } : { from: previous?.title }),
      });
      return jsonResponse(200, payloadOf(issue));
    }

    const issueMatch = pathname.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\/(title|description))?$/);
    if (issueMatch) {
      const number = Number(issueMatch[3]);
      const field = issueMatch[4] ?? "";
      const issue = issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found", repository: repositoryContext(role) });
      if (method === "GET") {
        return jsonResponse(200, payloadOf(issue));
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (field === "title") {
        const title = String(body.title ?? "").trim();
        if (!title) return jsonResponse(400, { error: "Issue update failed", fields: { title: "Title is required" } });
        issue.title = title;
        issue.activities.push({
          id: `activity-title-${issue.activities.length}`,
          type: "title_changed",
          actor: "alice-dev",
          createdAt: "2024-03-04T09:00:00.000Z",
          to: title,
        });
      } else {
        issue.description = String(body.description ?? "").trim();
        issue.activities.push({
          id: `activity-description-${issue.activities.length}`,
          type: "description_changed",
          actor: "alice-dev",
          createdAt: "2024-03-04T09:05:00.000Z",
        });
      }
      issue.updatedAt = "2024-03-04T09:05:00.000Z";
      return jsonResponse(200, payloadOf(issue));
    }

    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

function rowOf(title: string): HTMLElement {
  const link = screen.getByRole("link", { name: title });
  const row = link.closest("li");
  if (!row) throw new Error("The issue title link is not inside a row");
  return row;
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listing and filtering repository issues (REQ-5-1-1)", () => {
  it("shows every issue row with its number, title, status, author and labels", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs/issues");

    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    const openRow = rowOf("Improve onboarding");
    expect(within(openRow).getByRole("link", { name: "#1" })).toBeTruthy();
    expect(within(openRow).getByText("Open")).toBeTruthy();
    expect(within(openRow).getByText("bug")).toBeTruthy();
    expect(within(openRow).getByText("alice-dev")).toBeTruthy();
    expect(within(openRow).getByText("2024-02-22 10:15")).toBeTruthy();

    const closedRow = rowOf("Legacy welcome text");
    expect(within(closedRow).getByText("Closed")).toBeTruthy();
    expect(within(closedRow).getByText("bug")).toBeTruthy();

    // Both statuses are displayed until a status filter is chosen.
    expect(rowOf("Original issue title")).toBeTruthy();
  });

  it("filters as the user types and combines status, keyword and label", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs/issues");
    await screen.findByRole("link", { name: "Improve onboarding" });

    const user = userEvent.setup();
    const search = screen.getByRole("searchbox", { name: "Search issues" });

    // Typing alone filters, without Enter and without a search button.
    await user.type(search, "welcome");
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();

    // Open plus the whole seeded title keeps that issue and excludes the closed one.
    await user.clear(search);
    await user.click(screen.getByRole("link", { name: "Open" }));
    await user.type(search, "Improve onboarding");
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();

    // Adding the `bug` label of this repository keeps the same single row.
    await user.selectOptions(screen.getByRole("combobox", { name: "Labels" }), "bug");
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Original issue title" })).toBeNull();

    // The address carries the whole filter, so reloading the page reads the same
    // status, keyword and label and shows the same rows.
    const addressed = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    expect(addressed.get("state")).toBe("open");
    expect(addressed.get("q")).toBe("Improve onboarding");
    expect(addressed.get("label")).toBe("bug");

    // Switching to Closed excludes the Open issue and shows the closed one.
    await user.click(screen.getByRole("link", { name: "Closed" }));
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();

    // The label filter alone keeps only the rows carrying that label.
    await user.click(screen.getByRole("link", { name: "Open" }));
    await user.clear(screen.getByRole("searchbox", { name: "Search issues" }));
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Original issue title" })).toBeNull();
  });

  it("keeps the chosen filter and its rows after the page is reloaded", async () => {
    installFetch();
    // The address carries the filter context, exactly as the search box and the
    // status links write it.
    open("#/repos/alice-dev/acme-docs/issues?state=closed&q=Legacy+welcome&label=bug");

    expect(await screen.findByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect((screen.getByRole("searchbox", { name: "Search issues" }) as HTMLInputElement).value).toBe(
      "Legacy welcome",
    );
    expect((screen.getByRole("combobox", { name: "Labels" }) as HTMLSelectElement).value).toBe("bug");
    expect(screen.getByRole("link", { name: "Closed" }).getAttribute("aria-current")).toBe("page");
  });

  it("opens the issue detail page from the row title", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs/issues");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("link", { name: "Improve onboarding" }));

    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
  });
});

describe("reading an issue and its discussion (REQ-5-1-2)", () => {
  it("shows the number, status, description, comments, timeline and metadata", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs/issues/1");

    // The heading name is the complete title, without the issue number.
    const heading = await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(heading.textContent).toBe("Improve onboarding");
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();

    const commentSection = screen.getByRole("heading", { name: "Comment" }).closest("section");
    expect(commentSection).toBeTruthy();
    expect(within(commentSection as HTMLElement).getByText("alice-dev")).toBeTruthy();
    expect(
      within(commentSection as HTMLElement).getByText("The first-run wizard should mention the CLI install step."),
    ).toBeTruthy();

    const activitySection = screen.getByRole("heading", { name: "Activity" }).closest("section");
    const entries = within(activitySection as HTMLElement).getAllByRole("listitem");
    expect(entries.map((entry) => entry.textContent)).toEqual([
      "alice-dev created this issue · 2024-02-21 09:00",
      "alice-dev commented · 2024-02-22 10:15",
    ]);

    // Assignees, Labels and Milestone, in that order, on the right side.
    const sidebar = screen.getByRole("complementary", { name: "Issue metadata" });
    const headings = within(sidebar).getAllByRole("heading");
    expect(headings.map((item) => item.textContent)).toEqual(["Assignees", "Labels", "Milestone"]);
    expect(within(sidebar).getByText("alice-dev")).toBeTruthy();
    expect(within(sidebar).getByText("bug")).toBeTruthy();
    expect(within(sidebar).getByText("Q3 launch")).toBeTruthy();
  });

  it("shows the same record again after reopening the detail address", async () => {
    installFetch();
    open("#/repos/alice-dev/acme-docs/issues/2");

    expect(await screen.findByRole("heading", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();

    cleanup();
    open("#/repos/alice-dev/acme-docs/issues/2");
    expect(await screen.findByRole("heading", { name: "Legacy welcome text" })).toBeTruthy();
  });

  it("offers no editing control to a viewer without the role", async () => {
    installFetch({ role: "read", account: { username: "bob-reviewer" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Edit issue title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit issue description" })).toBeNull();
  });
});

describe("creating a repository issue (REQ-5-2-1)", () => {
  it("offers the creation entry to a writer only", async () => {
    installFetch({ role: "read", account: { username: "bob-reviewer" } });
    open("#/repos/alice-dev/acme-docs/issues");

    await screen.findByRole("link", { name: "Improve onboarding" });
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();
  });

  it("opens the form from the Issues page and stores a valid title and description", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "New issue" }));

    const title = await screen.findByLabelText("Title");
    expect(screen.getByLabelText("Description")).toBeTruthy();

    await user.type(title, "   ");
    await user.click(screen.getByRole("button", { name: "Submit new issue" }));

    // A title of three spaces is blank: nothing is created and no number is used.
    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(window.location.hash).toContain("/issues/new");

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Add a search shortcut");
    await user.type(screen.getByLabelText("Description"), "Type `/` to search.");
    await user.click(screen.getByRole("button", { name: "Submit new issue" }));

    expect(await screen.findByRole("heading", { name: "Add a search shortcut" })).toBeTruthy();
    expect(screen.getByText("Type `/` to search.")).toBeTruthy();
    expect(window.location.hash).toContain("/issues/4");

    // The list finds the new issue by its number.
    await user.click(screen.getByRole("link", { name: "Issues" }));
    expect(await screen.findByRole("link", { name: "#4" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add a search shortcut" })).toBeTruthy();
  });
});

describe("editing an issue title and description (REQ-5-2-2)", () => {
  it("saves title and description separately and records both edits", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/3");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Original issue title" });

    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleField = screen.getByLabelText("Issue title");
    await user.clear(titleField);
    await user.type(titleField, "Renamed issue");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));
    expect(await screen.findByRole("heading", { name: "Renamed issue" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit issue description" }));
    const descriptionField = screen.getByLabelText("Issue description");
    await user.clear(descriptionField);
    await user.type(descriptionField, "The description now explains the rename.");
    await user.click(screen.getByRole("button", { name: "Save issue description" }));

    expect(await screen.findByText("The description now explains the rename.")).toBeTruthy();
    expect(screen.getByText(/changed the title to Renamed issue/)).toBeTruthy();
    expect(screen.getByText(/changed the description/)).toBeTruthy();
    // The status and the metadata of the target issue are untouched.
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("rejects a blank title, keeps the original value and still shows it after reload", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/3");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Original issue title" });

    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    await user.clear(screen.getByLabelText("Issue title"));
    await user.type(screen.getByLabelText("Issue title"), "   ");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));

    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Original issue title" })).toBeTruthy();

    cleanup();
    open("#/repos/alice-dev/acme-docs/issues/3");
    expect(await screen.findByRole("heading", { name: "Original issue title" })).toBeTruthy();
  });
});

/** The section of the metadata sidebar that carries one heading. */
function metaSection(name: string): HTMLElement {
  const sidebar = screen.getByRole("complementary", { name: "Issue metadata" });
  const heading = within(sidebar).getByRole("heading", { name });
  const section = heading.closest("section");
  if (!section) throw new Error(`The ${name} area is not a section`);
  return section;
}

/** The reaction bar of one comment, addressed by its body text. */
function commentOf(body: string): HTMLElement {
  const article = screen.getByText(body).closest("article");
  if (!article) throw new Error("The comment body is not inside an article");
  return article;
}

describe("commenting on an issue discussion (REQ-5-2-3)", () => {
  it("appends a comment with its author and reads it again after reopening", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Improve onboarding" });

    const editor = screen.getByRole("textbox", { name: "Comment" });
    await user.type(editor, "  The wizard needs a screenshot.  ");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    // The discussion shows the complete body and the author of the stored comment.
    const commentSection = screen.getByRole("heading", { name: "Comment" }).closest("section")!;
    const appended = await within(commentSection).findByText("The wizard needs a screenshot.");
    expect(appended.closest("article")).toBeTruthy();
    expect(within(appended.closest("article") as HTMLElement).getByText("alice-dev")).toBeTruthy();

    // The append-only timeline records the comment as well.
    const activitySection = screen.getByRole("heading", { name: "Activity" }).closest("section")!;
    expect(within(activitySection).getAllByRole("listitem").at(-1)?.textContent).toContain(
      "alice-dev commented",
    );

    // The stored comment is what a later read of the page returns.
    cleanup();
    open("#/repos/alice-dev/acme-docs/issues/1");
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("The wizard needs a screenshot.")).toBeTruthy();
    expect(
      within(screen.getByText("The wizard needs a screenshot.").closest("article") as HTMLElement).getByText(
        "alice-dev",
      ),
    ).toBeTruthy();
  });

  it("stores no comment and no timeline record for a whitespace-only body", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const articlesBefore = screen.getAllByRole("article").length;

    await user.type(screen.getByRole("textbox", { name: "Comment" }), "   ");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByText("Comment is required")).toBeTruthy();
    expect(screen.getAllByRole("article").length).toBe(articlesBefore);

    cleanup();
    open("#/repos/alice-dev/acme-docs/issues/1");
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getAllByRole("article").length).toBe(articlesBefore);
  });

  it("keeps the comment editor away from a viewer without write permission", async () => {
    installFetch({ role: "read", account: { username: "bob-reviewer" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
  });

  it("adds a reaction to an existing comment and removes it on a second selection", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const comment = commentOf("The first-run wizard should mention the CLI install step.");

    // The reaction menu of the comment offers the reaction types.
    await user.click(within(comment).getByRole("button", { name: "Add reaction" }));
    await user.click(within(comment).getByRole("menuitem", { name: "Thumbs up" }));

    // The target comment then displays the reaction and its count.
    expect(await within(comment).findByRole("button", { name: "Thumbs up 1" })).toBeTruthy();

    // The association is stored, so a later read shows the same reaction.
    cleanup();
    open("#/repos/alice-dev/acme-docs/issues/1");
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const reloaded = commentOf("The first-run wizard should mention the CLI install step.");
    expect(within(reloaded).getByRole("button", { name: "Thumbs up 1" })).toBeTruthy();

    // The same user selecting the same reaction again removes it: no duplicate.
    await user.click(within(reloaded).getByRole("button", { name: "Thumbs up 1" }));
    expect(await within(reloaded).findByRole("button", { name: "Add reaction" })).toBeTruthy();
    expect(within(reloaded).queryByRole("button", { name: "Thumbs up 1" })).toBeNull();
  });

  it("shows stored reactions to a signed-out reader without the reaction menu", async () => {
    installFetch({ role: null, account: null });
    open("#/repos/alice-dev/acme-docs/issues/1");

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const comment = commentOf("The first-run wizard should mention the CLI install step.");
    expect(within(comment).queryByRole("button", { name: "Add reaction" })).toBeNull();
  });
});

describe("assigning participants to an issue (REQ-5-3-1)", () => {
  it("assigns and unassigns an eligible member from the Assignees selector", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const section = metaSection("Assignees");

    // The settings icon of the area opens the selector of this repository.
    await user.click(within(section).getByRole("button", { name: "Assignees" }));
    const search = within(section).getByRole("textbox", { name: "Search assignees" });
    // The member already assigned is offered as a selected option without a search.
    expect(within(section).getByRole("option", { name: "alice-dev" }).getAttribute("aria-selected")).toBe("true");
    // An account outside the repository is not assignable and never appears.
    expect(within(section).queryByRole("option", { name: "bob-reviewer" })).toBeNull();

    // Typing alone filters the options; choosing one saves and closes the selector.
    await user.type(search, "car");
    expect(within(section).getByRole("option", { name: "carol-dev" })).toBeTruthy();
    expect(within(section).queryByRole("option", { name: "alice-dev" })).toBeNull();
    await user.click(within(section).getByRole("option", { name: "carol-dev" }));

    const activitySection = screen.getByRole("heading", { name: "Activity" }).closest("section")!;
    expect(await within(activitySection).findByText(/assigned carol-dev/)).toBeTruthy();
    expect(within(section).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "alice-dev",
      "carol-dev",
    ]);

    // Reopening the selector shows the stored selection; choosing it again removes it.
    await user.click(within(section).getByRole("button", { name: "Assignees" }));
    expect(within(section).getByRole("option", { name: "carol-dev" }).getAttribute("aria-selected")).toBe("true");
    await user.click(within(section).getByRole("option", { name: "carol-dev" }));

    expect(await within(activitySection).findByText(/unassigned carol-dev/)).toBeTruthy();
    expect(within(section).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["alice-dev"]);

    // Only the last saved state is read again after reopening the page.
    cleanup();
    open("#/repos/alice-dev/acme-docs/issues/1");
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const reopened = metaSection("Assignees");
    expect(within(reopened).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["alice-dev"]);
  });

  it("offers no assignee control to a viewer without maintenance permission", async () => {
    installFetch({ role: "write", account: { username: "carol-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Assignees" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Search assignees" })).toBeNull();
  });
});

describe("applying labels to an issue (REQ-5-3-2)", () => {
  it("applies and removes a label of the current repository", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/3");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Original issue title" });
    await user.click(within(metaSection("Labels")).getByRole("button", { name: "Labels" }));

    // The selector offers exactly the labels of this repository.
    let section = metaSection("Labels");
    expect(
      within(section).getAllByRole("option").map((option) => option.textContent?.replace("✓", "").trim()),
    ).toEqual(["bug", "documentation"]);
    await user.click(within(section).getByRole("option", { name: "bug" }));

    section = metaSection("Labels");
    expect(await within(section).findByText("bug")).toBeTruthy();
    const activitySection = screen.getByRole("heading", { name: "Activity" }).closest("section")!;
    expect(within(activitySection).getByText(/added the label bug/)).toBeTruthy();

    // The list page displays the same stored association.
    await user.click(screen.getByRole("link", { name: "Issues" }));
    await screen.findByRole("link", { name: "Original issue title" });
    const row = rowOf("Original issue title");
    expect(within(row).getByText("bug")).toBeTruthy();

    // Selecting the same option again removes the association.
    await user.click(within(row).getByRole("link", { name: "Original issue title" }));
    await screen.findByRole("heading", { name: "Original issue title" });
    await user.click(within(metaSection("Labels")).getByRole("button", { name: "Labels" }));
    await user.click(within(metaSection("Labels")).getByRole("option", { name: "bug" }));

    section = metaSection("Labels");
    expect(await within(section).findByText("None yet")).toBeTruthy();
    expect(screen.getByText(/removed the label bug/)).toBeTruthy();
  });

  it("offers no label control to a Read or Write viewer", async () => {
    installFetch({ role: "write", account: { username: "carol-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
  });
});

describe("assigning an issue to a milestone (REQ-5-3-3)", () => {
  it("sets the milestone of the repository and clears it with None", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/3");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Original issue title" });
    await user.click(within(metaSection("Milestone")).getByRole("button", { name: "Milestone" }));

    // The selectable items are the milestones of this repository plus None.
    let section = metaSection("Milestone");
    expect(
      within(section).getAllByRole("option").map((option) => option.textContent?.replace("✓", "").trim()),
    ).toEqual(["Q3 launch", "v1.0", "None"]);
    await user.click(within(section).getByRole("option", { name: "v1.0" }));

    section = metaSection("Milestone");
    expect(await within(section).findByText("v1.0")).toBeTruthy();
    const activitySection = screen.getByRole("heading", { name: "Activity" }).closest("section")!;
    expect(within(activitySection).getByText(/set the milestone v1.0/)).toBeTruthy();

    // Choosing None deletes the association.
    await user.click(within(section).getByRole("button", { name: "Milestone" }));
    await user.click(within(metaSection("Milestone")).getByRole("option", { name: "None" }));

    section = metaSection("Milestone");
    expect(await within(section).findByText("No milestone")).toBeTruthy();
    expect(within(activitySection).getByText(/removed the milestone v1.0/)).toBeTruthy();
  });

  it("offers no milestone control to a Read or Write viewer", async () => {
    installFetch({ role: "write", account: { username: "carol-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
  });
});

describe("closing and reopening an issue (REQ-5-4)", () => {
  it("closes and reopens the seeded Open issue without touching its content", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Improve onboarding" });

    // An Open issue offers `Close issue` and never `Reopen issue`.
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close issue" }));

    // The transition is stored at once, without a confirmation: the page shows
    // Closed and the single status action is now `Reopen issue`.
    expect(await screen.findByRole("button", { name: "Reopen issue" })).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();

    let activitySection = screen.getByRole("heading", { name: "Activity" }).closest("section")!;
    expect(within(activitySection).getByText("Closed issue")).toBeTruthy();

    // The status change leaves the number, the title, the description, the
    // discussion and the metadata exactly as they were.
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(
      screen.getByText("The first-run wizard should mention the CLI install step."),
    ).toBeTruthy();
    expect(within(metaSection("Assignees")).getByText("alice-dev")).toBeTruthy();
    expect(within(metaSection("Labels")).getByText("bug")).toBeTruthy();
    expect(within(metaSection("Milestone")).getByText("Q3 launch")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Reopen issue" }));
    expect(await screen.findByRole("button", { name: "Close issue" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();

    activitySection = screen.getByRole("heading", { name: "Activity" }).closest("section")!;
    expect(within(activitySection).getByText("Reopened issue")).toBeTruthy();
    // Both transitions are appended to the timeline in sequence.
    const entries = within(activitySection).getAllByRole("listitem");
    expect(
      entries
        .map((entry) => entry.querySelector("article")?.getAttribute("data-activity"))
        .slice(-2),
    ).toEqual(["closed", "reopened"]);

    // Reloading the detail page reads the stored Open status again.
    cleanup();
    open("#/repos/alice-dev/acme-docs/issues/1");
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close issue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();

    // The list reads the same persisted status.
    cleanup();
    open("#/repos/alice-dev/acme-docs/issues");
    await screen.findByRole("link", { name: "Improve onboarding" });
    const row = rowOf("Improve onboarding");
    expect(within(row).getByText("Open")).toBeTruthy();
  });

  it("reopens a Closed issue from its detail page", async () => {
    installFetch({ account: { username: "alice-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/2");

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Legacy welcome text" });
    expect(screen.getByText("Closed")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Reopen issue" }));

    expect(await screen.findByRole("button", { name: "Close issue" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
  });

  it("offers neither close nor reopen to a viewer without management permission", async () => {
    // `carol-dev` holds Write: she may edit and comment but not change the status.
    installFetch({ role: "write", account: { username: "carol-dev" } });
    open("#/repos/alice-dev/acme-docs/issues/1");

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();

    // A Read viewer of the protected issue sees neither control either.
    cleanup();
    installFetch({ role: "read", account: { username: "bob-reviewer" } });
    open("#/repos/acme-demo/acme-internal/issues/1");

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
  });
});
