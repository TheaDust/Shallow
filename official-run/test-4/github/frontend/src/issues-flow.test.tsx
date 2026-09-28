import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface IssueRecord {
  id: string;
  number: number;
  title: string;
  state: "open" | "closed";
  description: string;
  author: string;
  labels: string[];
  milestone: string | null;
  assignees: string[];
  createdAt: string;
  updatedAt: string;
}

interface CommentRecord {
  id: string;
  issueId: string;
  author: string;
  body: string;
  createdAt: string;
}

interface ActivityRecord {
  id: string;
  issueId: string;
  type: string;
  actor: string;
  createdAt: string;
  commentId: string | null;
  assignee?: string;
  label?: string;
  milestone?: string | null;
  field?: "title" | "description";
  value?: string;
}

interface ReactionRecord {
  account: string;
  targetType: "issue" | "comment";
  targetId: string;
  reaction: string;
}

interface IssueWorld {
  issues: IssueRecord[];
  comments: CommentRecord[];
  activities: ActivityRecord[];
  reactions: ReactionRecord[];
}

const LABELS = [
  { name: "bug", color: "#d73a4a" },
  { name: "documentation", color: "#0075ca" },
];
const MILESTONES = [
  { id: "milestone-1", title: "Q3 launch", state: "open" },
  { id: "milestone-2", title: "v1.0", state: "open" },
];
const ASSIGNABLE_MEMBERS = ["alice-dev", "bob-reviewer"];

function seedWorld(): IssueWorld {
  return {
    issues: [
      {
        id: "issue-1",
        number: 1,
        title: "Improve onboarding",
        state: "open",
        description: "Describe the onboarding improvement.",
        author: "alice-dev",
        labels: ["bug", "documentation"],
        milestone: "Q3 launch",
        assignees: ["alice-dev"],
        createdAt: "2026-09-20T10:00:00.000Z",
        updatedAt: "2026-09-24T10:00:00.000Z",
      },
      {
        id: "issue-2",
        number: 2,
        title: "Legacy welcome text",
        state: "closed",
        description: "The welcome text on the home page is outdated.",
        author: "alice-dev",
        labels: ["bug"],
        milestone: null,
        assignees: [],
        createdAt: "2026-09-19T10:00:00.000Z",
        updatedAt: "2026-09-22T10:00:00.000Z",
      },
      {
        id: "issue-3",
        number: 3,
        title: "Original issue title",
        state: "open",
        description: "An issue used to verify title editing validation.",
        author: "alice-dev",
        labels: [],
        milestone: null,
        assignees: [],
        createdAt: "2026-09-25T10:00:00.000Z",
        updatedAt: "2026-09-25T10:00:00.000Z",
      },
    ],
    comments: [
      {
        id: "comment-1",
        issueId: "issue-1",
        author: "alice-dev",
        body: "Let's add a quick-start guide to the README.",
        createdAt: "2026-09-24T10:00:00.000Z",
      },
    ],
    activities: [
      {
        id: "activity-1",
        issueId: "issue-1",
        type: "created",
        actor: "alice-dev",
        createdAt: "2026-09-20T10:00:00.000Z",
        commentId: null,
      },
      {
        id: "activity-2",
        issueId: "issue-1",
        type: "commented",
        actor: "alice-dev",
        createdAt: "2026-09-24T10:00:00.000Z",
        commentId: "comment-1",
      },
      {
        id: "activity-3",
        issueId: "issue-2",
        type: "created",
        actor: "alice-dev",
        createdAt: "2026-09-19T10:00:00.000Z",
        commentId: null,
      },
      {
        id: "activity-4",
        issueId: "issue-2",
        type: "closed",
        actor: "alice-dev",
        createdAt: "2026-09-22T10:00:00.000Z",
        commentId: null,
      },
      {
        id: "activity-5",
        issueId: "issue-3",
        type: "created",
        actor: "alice-dev",
        createdAt: "2026-09-25T10:00:00.000Z",
        commentId: null,
      },
    ],
    reactions: [],
  };
}

function roleOf(viewer: { username: string } | null, roles: Record<string, string>): string | null {
  return viewer ? (roles[viewer.username] ?? null) : null;
}

function summary(world: IssueWorld, issue: IssueRecord) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    description: issue.description,
    author: { username: issue.author },
    labels: LABELS.filter((label) => issue.labels.includes(label.name)),
    milestone: issue.milestone
      ? MILESTONES.find((candidate) => candidate.title === issue.milestone) ?? null
      : null,
    assignees: issue.assignees,
    updatedAt: issue.updatedAt,
    commentsCount: world.comments.filter((comment) => comment.issueId === issue.id).length,
  };
}

function targetReactions(world: IssueWorld, targetType: "issue" | "comment", targetId: string, viewer: { username: string } | null) {
  const grouped = new Map<string, { count: number; viewerReacted: boolean }>();
  for (const record of world.reactions) {
    if (record.targetType !== targetType || record.targetId !== targetId) continue;
    const entry = grouped.get(record.reaction) ?? { count: 0, viewerReacted: false };
    entry.count += 1;
    if (record.account === viewer?.username) entry.viewerReacted = true;
    grouped.set(record.reaction, entry);
  }
  return [...grouped.entries()].map(([reaction, entry]) => ({
    reaction,
    count: entry.count,
    viewerReacted: entry.viewerReacted,
  }));
}

function commentPayload(world: IssueWorld, comment: CommentRecord, viewer: { username: string } | null) {
  return {
    id: comment.id,
    author: { username: comment.author },
    body: comment.body,
    createdAt: comment.createdAt,
    reactions: targetReactions(world, "comment", comment.id, viewer),
  };
}

function issueFetchHandler(
  world: IssueWorld,
  options: { initialSession?: { username: string } | null; roles?: Record<string, string> },
) {
  const roles = options.roles ?? { "alice-dev": "admin" };
  let viewer: { username: string } | null = options.initialSession ?? null;
  return (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    const url = new URL(path, "http://local");
    const p = url.pathname;

    if (p === "/api/sessions/current") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      return jsonResponse(200, { account: viewer });
    }
    if (p === "/api/sessions/current" && method === "DELETE") {
      viewer = null;
      return jsonResponse(200, { ok: true });
    }

    const repoMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)$/);
    if (repoMatch && method === "GET") {
      const name = repoMatch[2];
      if (name === "secret-research") {
        return jsonResponse(403, { error: "Access denied" });
      }
      return jsonResponse(200, {
        repository: {
          ownerType: "account",
          ownerName: "alice-dev",
          name,
          description: "Documentation for Acme Demo",
          visibility: "public",
          defaultBranch: "main",
          updatedAt: "2026-09-24T10:00:00.000Z",
          currentRole: roleOf(viewer, roles),
          files: [],
          branches: [{ name: "main", protected: false }],
          currentBranch: "main",
          commitCount: 1,
          source: null,
        },
      });
    }

    const issuesMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)\/issues$/);
    if (issuesMatch) {
      if (method === "GET") {
        return jsonResponse(200, {
          issues: [...world.issues].sort((a, b) => b.number - a.number).map((issue) => summary(world, issue)),
          labels: LABELS,
          milestones: MILESTONES,
          currentRole: roleOf(viewer, roles),
        });
      }
      if (method === "POST") {
        if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
        const body = JSON.parse(String(init.body)) as { title: string; description: string };
        const trimmed = body.title.trim();
        if (!trimmed) return jsonResponse(400, { errors: { title: "Title is required" } });
        const numbers = world.issues.map((issue) => issue.number);
        const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
        const now = new Date().toISOString();
        const issue: IssueRecord = {
          id: `issue-${next}`,
          number: next,
          title: trimmed,
          description: body.description ?? "",
          author: viewer.username,
          labels: [],
          milestone: null,
          assignees: [],
          createdAt: now,
          updatedAt: now,
          state: "open",
        };
        world.issues.push(issue);
        world.activities.push({
          id: `activity-${world.activities.length + 1}`,
          issueId: issue.id,
          type: "created",
          actor: viewer.username,
          createdAt: now,
          commentId: null,
        });
        return jsonResponse(201, { issue: summary(world, issue) });
      }
    }

    const detailMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)$/);
    if (detailMatch && method === "GET") {
      const number = Number(detailMatch[3]);
      const issue = world.issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found" });
      const issueComments = world.comments
        .filter((comment) => comment.issueId === issue.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const issueActivities = world.activities
        .filter((activity) => activity.issueId === issue.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return jsonResponse(200, {
        issue: {
          ...summary(world, issue),
          id: issue.id,
          createdAt: issue.createdAt,
          reactions: targetReactions(world, "issue", issue.id, viewer),
        },
        comments: issueComments.map((comment) => commentPayload(world, comment, viewer)),
        activities: issueActivities.map((activity) => ({
          id: activity.id,
          type: activity.type,
          actor: { username: activity.actor },
          createdAt: activity.createdAt,
          commentId: activity.commentId,
          body: activity.commentId
            ? world.comments.find((comment) => comment.id === activity.commentId)?.body ?? null
            : undefined,
          assignee: activity.assignee,
          label: activity.label,
          milestone: activity.milestone,
          field: activity.field,
          value: activity.value,
        })),
        labels: LABELS,
        milestones: MILESTONES,
        assignableMembers: ASSIGNABLE_MEMBERS,
        currentRole: roleOf(viewer, roles),
      });
    }
    if (detailMatch && method === "PATCH") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const number = Number(detailMatch[3]);
      const issue = world.issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found" });
      const body = JSON.parse(String(init.body)) as { title?: string; description?: string };
      const now = new Date().toISOString();
      if (body.title !== undefined) {
        const trimmed = body.title.trim();
        if (!trimmed) return jsonResponse(400, { errors: { title: "Title is required" } });
        if (trimmed.length > 256) {
          return jsonResponse(400, { errors: { title: "Title must be at most 256 characters" } });
        }
        issue.title = trimmed;
      } else if (body.description !== undefined) {
        if (body.description.length > 65536) {
          return jsonResponse(400, {
            errors: { description: "Description must be at most 65536 characters" },
          });
        }
        issue.description = body.description;
      } else {
        return jsonResponse(400, { errors: { title: "Title is required" } });
      }
      issue.updatedAt = now;
      const field = body.title !== undefined ? "title" : "description";
      const activity: ActivityRecord & { field?: string; value?: string } = {
        id: `activity-${world.activities.length + 1}`,
        issueId: issue.id,
        type: "edited",
        actor: viewer.username,
        createdAt: now,
        commentId: null,
        field,
        value: field === "title" ? issue.title : issue.description,
      };
      world.activities.push(activity as ActivityRecord);
      return jsonResponse(200, { ok: true, activity });
    }

    const assigneesMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/assignees$/);
    if (assigneesMatch && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const number = Number(assigneesMatch[3]);
      const issue = world.issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found" });
      const body = JSON.parse(String(init.body)) as { username: string; assign: boolean };
      if (!ASSIGNABLE_MEMBERS.includes(body.username)) {
        return jsonResponse(400, { errors: { username: "Account is not assignable" } });
      }
      const index = issue.assignees.indexOf(body.username);
      if (body.assign) {
        if (index === -1) issue.assignees.push(body.username);
      } else if (index !== -1) {
        issue.assignees.splice(index, 1);
      }
      issue.updatedAt = new Date().toISOString();
      const activity: ActivityRecord = {
        id: `activity-${world.activities.length + 1}`,
        issueId: issue.id,
        type: body.assign ? "assigned" : "unassigned",
        actor: viewer.username,
        createdAt: new Date().toISOString(),
        commentId: null,
        assignee: body.username,
      };
      world.activities.push(activity);
      return jsonResponse(200, { ok: true, activity });
    }

    const labelsMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/labels$/);
    if (labelsMatch && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const number = Number(labelsMatch[3]);
      const issue = world.issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found" });
      const body = JSON.parse(String(init.body)) as { name: string };
      if (!LABELS.some((label) => label.name === body.name)) {
        return jsonResponse(400, { errors: { label: "Label not found" } });
      }
      const index = issue.labels.indexOf(body.name);
      const adding = index === -1;
      if (adding) {
        issue.labels.push(body.name);
      } else {
        issue.labels.splice(index, 1);
      }
      issue.updatedAt = new Date().toISOString();
      const activity: ActivityRecord = {
        id: `activity-${world.activities.length + 1}`,
        issueId: issue.id,
        type: adding ? "labeled" : "unlabeled",
        actor: viewer.username,
        createdAt: new Date().toISOString(),
        commentId: null,
        label: body.name,
      };
      world.activities.push(activity);
      return jsonResponse(200, { ok: true, activity });
    }

    const milestoneMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/milestone$/);
    if (milestoneMatch && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const number = Number(milestoneMatch[3]);
      const issue = world.issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found" });
      const body = JSON.parse(String(init.body)) as { milestone: string | null };
      let activity: ActivityRecord;
      issue.updatedAt = new Date().toISOString();
      if (body.milestone === null) {
        const previous = issue.milestone;
        issue.milestone = null;
        activity = {
          id: `activity-${world.activities.length + 1}`,
          issueId: issue.id,
          type: "demilestoned",
          actor: viewer.username,
          createdAt: new Date().toISOString(),
          commentId: null,
          milestone: previous,
        };
      } else {
        if (!MILESTONES.some((milestone) => milestone.title === body.milestone)) {
          return jsonResponse(400, { errors: { milestone: "Milestone not found" } });
        }
        issue.milestone = body.milestone;
        activity = {
          id: `activity-${world.activities.length + 1}`,
          issueId: issue.id,
          type: "milestoned",
          actor: viewer.username,
          createdAt: new Date().toISOString(),
          commentId: null,
          milestone: body.milestone,
        };
      }
      world.activities.push(activity);
      return jsonResponse(200, { ok: true, activity });
    }

    const commentsMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/comments$/);
    if (commentsMatch && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const number = Number(commentsMatch[3]);
      const issue = world.issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found" });
      const body = JSON.parse(String(init.body)) as { body: string };
      const trimmed = body.body.trim();
      if (!trimmed) return jsonResponse(400, { errors: { body: "Comment is required" } });
      const now = new Date().toISOString();
      const comment: CommentRecord = {
        id: `comment-${world.comments.length + 1}`,
        issueId: issue.id,
        author: viewer.username,
        body: trimmed,
        createdAt: now,
      };
      world.comments.push(comment);
      const activity: ActivityRecord = {
        id: `activity-${world.activities.length + 1}`,
        issueId: issue.id,
        type: "commented",
        actor: viewer.username,
        createdAt: now,
        commentId: comment.id,
      };
      world.activities.push(activity);
      issue.updatedAt = now;
      return jsonResponse(201, {
        comment: commentPayload(world, comment, viewer),
        activity: { ...activity, actor: { username: activity.actor }, body: comment.body },
      });
    }

    const stateMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/state$/);
    if (stateMatch && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const role = roleOf(viewer, roles);
      if (!["triage", "maintain", "admin"].includes(role ?? "")) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const number = Number(stateMatch[3]);
      const issue = world.issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found" });
      const body = JSON.parse(String(init.body)) as { state: "open" | "closed" };
      if (body.state !== "open" && body.state !== "closed") {
        return jsonResponse(400, { errors: { state: "State is invalid" } });
      }
      if (issue.state === body.state) return jsonResponse(200, { ok: true, activity: null });
      issue.state = body.state;
      issue.updatedAt = new Date().toISOString();
      const activity: ActivityRecord = {
        id: `activity-${world.activities.length + 1}`,
        issueId: issue.id,
        type: body.state === "closed" ? "closed" : "reopened",
        actor: viewer.username,
        createdAt: new Date().toISOString(),
        commentId: null,
      };
      world.activities.push(activity);
      return jsonResponse(200, { ok: true, activity });
    }

    const reactionsMatch = p.match(/^\/api\/users\/([^/]+)\/repos\/([^/]+)\/issues\/(\d+)\/reactions$/);
    if (reactionsMatch && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const viewerName = viewer.username;
      const number = Number(reactionsMatch[3]);
      const issue = world.issues.find((candidate) => candidate.number === number);
      if (!issue) return jsonResponse(404, { error: "Issue not found" });
      const body = JSON.parse(String(init.body)) as {
        targetType: "issue" | "comment";
        targetId: string;
        reaction: string;
      };
      const index = world.reactions.findIndex(
        (record) =>
          record.account === viewerName &&
          record.targetType === body.targetType &&
          record.targetId === body.targetId &&
          record.reaction === body.reaction,
      );
      if (index !== -1) {
        world.reactions.splice(index, 1);
      } else {
        world.reactions.push({
          account: viewerName,
          targetType: body.targetType,
          targetId: body.targetId,
          reaction: body.reaction,
        });
      }
      return jsonResponse(200, {
        reactions: targetReactions(world, body.targetType, body.targetId, viewer),
      });
    }

    return jsonResponse(404, { error: "Not found" });
  };
}

function stubFetch(handler: (path: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : new URL(String(input)).pathname;
      return handler(path, init ?? {});
    }),
  );
}

beforeEach(() => {
  window.location.hash = "#/";
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("REQ-5-1-1 list and filter repository issues", () => {
  it("an anonymous visitor sees both seeded issues and filters by state, keyword, and label without changing data", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: null }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues";
    render(<App />);

    // Both seeded issues are visible by default.
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();

    // “Open” and “Closed” are links; the searchbox and label filter exist.
    const openLink = screen.getByRole("link", { name: "Open" });
    const closedLink = screen.getByRole("link", { name: "Closed" });
    expect(openLink.getAttribute("href")).toContain("/issues?state=open");
    expect(closedLink.getAttribute("href")).toContain("/issues?state=closed");
    const searchbox = screen.getByRole("searchbox", { name: "Search issues" });
    const labelFilter = screen.getByRole("combobox", { name: "Label" });
    expect(within(labelFilter).getByRole("option", { name: "bug" })).toBeTruthy();

    // The rows display status, author, labels, and update time.
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBe(3);
    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/by alice-dev/).length).toBe(3);
    expect(screen.getAllByText(/Updated .* ago/).length).toBe(3);
    expect(screen.getAllByText("bug").length).toBeGreaterThan(0);

    // Select “Open”, enter the unique word, and select the bug label.
    await user.click(openLink);
    await waitFor(() => expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull());
    await user.type(searchbox, "onboarding");
    await user.selectOptions(labelFilter, "bug");
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();

    // The chosen filter context is retained in the URL (refresh keeps it).
    expect(window.location.hash).toContain("state=open");
    expect(window.location.hash).toContain("q=onboarding");
    expect(window.location.hash).toContain("label=bug");

    // Clicking the title opens the issue detail page.
    await user.click(screen.getByRole("link", { name: "Improve onboarding" }));
    await screen.findByRole("heading", { name: "Improve onboarding" });

    // Switching to “Closed” hides the open issue and shows the closed one
    // (the keyword was cleared when reopening the list without parameters).
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues";
    await screen.findByRole("searchbox", { name: "Search issues" });
    await user.click(screen.getByRole("link", { name: "Closed" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull());
    expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();

    // Filtering never changes the persisted issue data.
    expect(world.issues.length).toBe(3);
  });

  it("refreshing the filtered URL restores the same filter context and results", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues?state=closed&q=welcome";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(await screen.findByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search issues" })).toHaveProperty("value", "welcome");

    // Reload keeps the context.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues?state=closed&q=welcome";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(await screen.findByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
  });
});

describe("REQ-5-1-2 view an issue and its discussion", () => {
  it("the detail page shows number, title heading, status, description, metadata, comments, and chronological activity", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();

    // Right-side metadata in order: Assignees, Labels, Milestone.
    expect(screen.getByRole("heading", { name: "Assignees" })).toBeTruthy();
    expect(screen.getByText("alice-dev", { selector: ".issue-meta__value" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Labels" })).toBeTruthy();
    expect(screen.getByText("bug")).toBeTruthy();
    expect(screen.getByText("documentation")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Milestone" })).toBeTruthy();
    expect(screen.getByText("Q3 launch")).toBeTruthy();

    // Comments and activity sections.
    expect(screen.getByRole("heading", { name: "Comments 1" })).toBeTruthy();
    expect(screen.getAllByText("Let's add a quick-start guide to the README.").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Activity" })).toBeTruthy();

    // Creation and comment activities appear in chronological order.
    const timeline = screen.getByRole("list", { name: undefined });
    const entries = within(timeline).getAllByRole("article");
    expect(entries.length).toBe(2);
    expect(entries[0].textContent).toContain("opened this issue");
    expect(entries[1].textContent).toContain("commented");
    expect(entries[1].textContent).toContain("Let's add a quick-start guide to the README.");

    // Anonymous visitors see no editable controls.
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();

    // Reopening the same number from the list shows the same record.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(screen.getAllByText("Let's add a quick-start guide to the README.").length).toBeGreaterThan(0);
  });

  it("a user without repository access cannot view the detail content", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/secret-research/issues";
    render(<App />);
    await screen.findByText("Access denied");
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
  });
});

describe("REQ-5-2-1 create a repository issue", () => {
  it("a Write/Maintain/Admin user creates an issue and reaches its detail page; blank titles are rejected", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues";
    render(<App />);

    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    const newIssueLink = await screen.findByRole("link", { name: "New issue" });
    expect(newIssueLink.getAttribute("href")).toContain("/issues/new");
    await user.click(newIssueLink);

    await screen.findByRole("heading", { name: "New issue" });
    expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Submit new issue" });

    // A title containing only three spaces is treated as blank.
    await user.type(screen.getByRole("textbox", { name: "Title" }), "   ");
    await user.click(submit);
    expect(screen.getByText("Title is required")).toBeTruthy();
    expect(window.location.hash).toContain("/issues/new");

    // Valid submission opens the new issue's detail page.
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Fix the search box");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Improve the search results.");
    await user.click(submit);

    await screen.findByRole("heading", { name: "Fix the search box" });
    expect(screen.getByText("#4")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Improve the search results.")).toBeTruthy();
    expect(screen.getAllByText(/alice-dev/).length).toBeGreaterThan(0);
    // The activity timeline contains a creation record.
    expect(screen.getAllByText(/opened this issue/).length).toBeGreaterThan(0);
    // Comments section shows zero comments.
    expect(screen.getByRole("heading", { name: "Comments 0" })).toBeTruthy();

    // The list locates the issue by its new number and exact title link.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(screen.getByRole("link", { name: "Fix the search box" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "#4" })).toBeTruthy();
  });
});

describe("REQ-5-2-3 comment on an issue discussion", () => {
  it("whitespace-only comments create no comment or timeline record", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const commentBox = screen.getByRole("textbox", { name: "Comment" });
    const commentButton = screen.getByRole("button", { name: "Comment" });

    // Whitespace-only text creates no comment and the discussion count is stable.
    await user.type(commentBox, "   ");
    await user.click(commentButton);
    expect(screen.getByText("Comment is required")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comments 1" })).toBeTruthy();

    // Reload: no new comment or timeline record, discussion count unchanged.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByRole("heading", { name: "Comments 1" })).toBeTruthy();
    expect(world.comments.length).toBe(1);
    expect(world.activities.filter((activity) => activity.issueId === "issue-1").length).toBe(2);
  });

  it("appends a comment with author/body/time, then toggles a reaction on the existing comment", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const commentBox = screen.getByRole("textbox", { name: "Comment" });
    const commentButton = screen.getByRole("button", { name: "Comment" });

    await user.type(commentBox, "Looks good to me.");
    await user.click(commentButton);
    await waitFor(() =>
      expect(screen.getAllByText("Looks good to me.").length).toBeGreaterThan(0),
    );
    expect(screen.getByRole("heading", { name: "Comments 2" })).toBeTruthy();
    // The activity timeline gains a commented record with the body.
    expect(screen.getAllByText(/commented/).length).toBeGreaterThan(0);

    // Refresh keeps the saved comment.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getAllByText("Looks good to me.").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Comments 2" })).toBeTruthy();

    // React to the seeded comment via the reaction menu.
    const addReactionButtons = screen.getAllByRole("button", { name: "Add reaction" });
    const seededCommentArticle = screen
      .getAllByRole("article")
      .find((article) => article.textContent?.includes("Let's add a quick-start guide to the README."));
    expect(seededCommentArticle).toBeTruthy();
    const seededAddReaction = within(seededCommentArticle as HTMLElement).getByRole("button", {
      name: "Add reaction",
    });
    await user.click(seededAddReaction);
    const menu = await screen.findByRole("menu", { name: "Reactions" });
    const thumbsUp = within(menu).getByRole("menuitem", { name: "👍 0" });
    await user.click(thumbsUp);

    await waitFor(() =>
      expect(screen.getAllByText(/👍 1/).length).toBeGreaterThan(0),
    );

    // Selecting the same reaction again removes it (no duplicate).
    await user.click(screen.getAllByRole("button", { name: "Add reaction" })[1]);
    const menuAgain = await screen.findByRole("menu", { name: "Reactions" });
    await user.click(within(menuAgain).getByRole("menuitem", { name: "👍 1" }));
    await waitFor(() => expect(screen.queryByText(/👍 1/)).toBeNull());

    // The saved comment and reaction survive a reload.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getAllByText("Looks good to me.").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Comments 2" })).toBeTruthy();
  });
});

describe("REQ-5-2-2 edit an issue title and description", () => {
  it("Write/Maintain/Admin edit the title and description separately; the list and timeline show the change", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const editTitleButton = screen.getByRole("button", { name: "Edit issue title" });
    const editDescriptionButton = screen.getByRole("button", { name: "Edit issue description" });

    // Editing the title: the form has a textbox “Issue title” and “Save issue title”.
    await user.click(editTitleButton);
    const titleBox = screen.getByRole("textbox", { name: "Issue title" });
    expect(titleBox).toHaveProperty("value", "Improve onboarding");
    await user.clear(titleBox);
    await user.type(titleBox, "Improved onboarding guide");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));

    await screen.findByRole("heading", { name: "Improved onboarding guide" });
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();

    // Editing the description separately.
    await user.click(screen.getByRole("button", { name: "Edit issue description" }));
    const descriptionBox = screen.getByRole("textbox", { name: "Issue description" });
    expect(descriptionBox).toHaveProperty("value", "Describe the onboarding improvement.");
    await user.clear(descriptionBox);
    await user.type(descriptionBox, "Document the first-run experience.");
    await user.click(screen.getByRole("button", { name: "Save issue description" }));

    await waitFor(() => expect(screen.getByText("Document the first-run experience.")).toBeTruthy());
    // The activity timeline records both edits with editor and new value.
    expect(screen.getAllByText(/edited this issue/).length).toBe(2);
    expect(screen.getAllByText("Title: Improved onboarding guide").length).toBe(1);
    expect(screen.getAllByText("Description: Document the first-run experience.").length).toBe(1);

    // Status, labels, and assignees of the same issue are unchanged.
    const edited = world.issues.find((issue) => issue.number === 1)!;
    expect(edited.state).toBe("open");
    expect(edited.labels).toEqual(["bug", "documentation"]);
    expect(edited.assignees).toEqual(["alice-dev"]);
    expect(edited.milestone).toBe("Q3 launch");
    expect(world.issues.find((issue) => issue.number === 2)!.title).toBe("Legacy welcome text");

    // The issue-list summary displays the new title.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(screen.getByRole("link", { name: "Improved onboarding guide" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();

    // After a reload the new values still exist for the same issue number.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improved onboarding guide" });
    expect(screen.getByText("Document the first-run experience.")).toBeTruthy();
  });

  it("blank and overlong titles are rejected, the original title is retained, and the invalid-edit seed restores after reload", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);

    await screen.findByRole("heading", { name: "Original issue title" });
    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleBox = screen.getByRole("textbox", { name: "Issue title" });

    // Replacing the title with three spaces shows “Title is required”.
    await user.clear(titleBox);
    await user.type(titleBox, "   ");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));
    expect(screen.getByText("Title is required")).toBeTruthy();

    // Overlong input is rejected as well; the original value stays in the store.
    await user.clear(titleBox);
    await user.type(titleBox, "x".repeat(257));
    await user.click(screen.getByRole("button", { name: "Save issue title" }));
    expect(screen.getByText("Title must be at most 256 characters")).toBeTruthy();
    expect(world.issues.find((issue) => issue.number === 3)!.title).toBe("Original issue title");

    // Reloading restores the original title heading.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);
    await screen.findByRole("heading", { name: "Original issue title" });
    expect(screen.queryByRole("textbox", { name: "Issue title" })).toBeNull();
    expect(world.activities.filter((activity) => activity.issueId === "issue-3").length).toBe(1);
  });

  it("Read and Triage users only view: the edit controls are unavailable", async () => {
    const world = seedWorld();
    // bob-reviewer has Triage: metadata pickers yes, edit forms no.
    stubFetch(
      issueFetchHandler(world, {
        initialSession: { username: "bob-reviewer" },
        roles: { "alice-dev": "admin", "bob-reviewer": "triage" },
      }),
    );
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Edit issue title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit issue description" })).toBeNull();
    // Triage may still open the metadata pickers.
    expect(screen.getByRole("button", { name: "Assignees" })).toBeTruthy();

    // A Read user sees no maintenance control at all.
    cleanup();
    stubFetch(
      issueFetchHandler(world, {
        initialSession: { username: "carol-dev" },
        roles: { "alice-dev": "admin", "carol-dev": "read" },
      }),
    );
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Edit issue title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit issue description" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assignees" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
  });
});

describe("REQ-5-3-1 assign or unassign issue participants", () => {
  it("a Triage+ user assigns and unassigns a member via the searchable selector; non-assignable accounts never appear", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);

    await screen.findByRole("heading", { name: "Original issue title" });
    expect(screen.getByText("No one assigned")).toBeTruthy();

    // The settings icon is a button named “Assignees”; the open selector has
    // a search textbox and options named after member usernames.
    const assigneesButton = screen.getByRole("button", { name: "Assignees" });
    await user.click(assigneesButton);
    const search = screen.getByRole("searchbox", { name: "Search assignees" });
    expect(screen.getByRole("option", { name: "alice-dev" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "bob-reviewer" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "carol-dev" })).toBeNull();

    // Options update as the user types; no Enter/Search button needed.
    await user.type(search, "bob");
    expect(screen.queryByRole("option", { name: "alice-dev" })).toBeNull();
    const bobOption = screen.getByRole("option", { name: "bob-reviewer" });
    expect(bobOption.getAttribute("aria-selected")).toBe("false");

    // Clicking the option immediately saves and closes the selector.
    await user.click(bobOption);
    await waitFor(() =>
      expect(screen.getByText("bob-reviewer", { selector: ".issue-meta__value" })).toBeTruthy(),
    );
    expect(screen.queryByRole("searchbox", { name: "Search assignees" })).toBeNull();
    expect(screen.getAllByText(/assigned bob-reviewer/).length).toBe(1);
    expect(world.issues.find((issue) => issue.number === 3)!.assignees).toEqual(["bob-reviewer"]);

    // Reopening shows the selected member without another search.
    await user.click(assigneesButton);
    expect(screen.getByRole("option", { name: "bob-reviewer" }).getAttribute("aria-selected")).toBe("true");
    // An account outside the repository collaborator scope still does not appear.
    await user.type(screen.getByRole("searchbox", { name: "Search assignees" }), "carol");
    expect(screen.queryByRole("option", { name: "carol-dev" })).toBeNull();
    expect(screen.getByText("No matches found.")).toBeTruthy();

    // Clicking the selected member again removes the assignment and closes.
    await user.clear(screen.getByRole("searchbox", { name: "Search assignees" }));
    await user.click(screen.getByRole("option", { name: "bob-reviewer" }));
    await waitFor(() => expect(screen.getByText("No one assigned")).toBeTruthy());
    expect(screen.getAllByText(/unassigned bob-reviewer/).length).toBe(1);
    expect(world.issues.find((issue) => issue.number === 3)!.assignees).toEqual([]);

    // After a refresh only the final selected-assignee set remains.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);
    await screen.findByRole("heading", { name: "Original issue title" });
    expect(screen.getByText("No one assigned")).toBeTruthy();
  });

  it("Write users cannot manage assignees: the control is unavailable", async () => {
    const world = seedWorld();
    stubFetch(
      issueFetchHandler(world, {
        initialSession: { username: "bob-reviewer" },
        roles: { "alice-dev": "admin", "bob-reviewer": "write" },
      }),
    );
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);
    await screen.findByRole("heading", { name: "Original issue title" });
    // Write may edit content but not metadata.
    expect(screen.getByRole("button", { name: "Edit issue title" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assignees" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
  });
});

describe("REQ-5-3-2 apply labels to an issue", () => {
  it("selecting a current-repository label applies it; selecting again removes it; other repositories are never offered", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);

    await screen.findByRole("heading", { name: "Original issue title" });
    const labelsButton = screen.getByRole("button", { name: "Labels" });
    await user.click(labelsButton);

    // Options are exactly the current repository's labels; no external label.
    expect(screen.getByRole("option", { name: "bug" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "documentation" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "priority-high" })).toBeNull();

    // Checking `bug` saves immediately and closes the picker.
    await user.click(screen.getByRole("option", { name: "bug" }));
    await waitFor(() => expect(screen.getByText("bug", { selector: ".issue-label" })).toBeTruthy());
    expect(screen.queryByRole("listbox", { name: "Labels" })).toBeNull();
    expect(screen.getAllByText(/added the bug label/).length).toBe(1);
    expect(world.issues.find((issue) => issue.number === 3)!.labels).toEqual(["bug"]);

    // Reopening and selecting the same option removes the association.
    await user.click(labelsButton);
    await user.click(screen.getByRole("option", { name: "bug" }));
    await waitFor(() => expect(screen.queryByText("bug", { selector: ".issue-label" })).toBeNull());
    expect(screen.getAllByText(/removed the bug label/).length).toBe(1);

    // After a refresh the label set matches the last saved state.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);
    await screen.findByRole("heading", { name: "Original issue title" });
    expect(screen.queryByText("bug", { selector: ".issue-label" })).toBeNull();
  });
});

describe("REQ-5-3-3 assign issues to a milestone", () => {
  it("selecting a repository milestone associates it; None removes it; other repositories are never offered", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);

    await screen.findByRole("heading", { name: "Original issue title" });
    expect(screen.getByText("No milestone")).toBeTruthy();

    const milestoneButton = screen.getByRole("button", { name: "Milestone" });
    await user.click(milestoneButton);
    // Selectable items are “None” and the current repository's milestones;
    // milestones of other repositories are not offered.
    expect(screen.getByRole("option", { name: "None" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Q3 launch" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "v1.0" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Backlog" })).toBeNull();

    // Selecting v1.0 saves immediately and closes the picker.
    await user.click(screen.getByRole("option", { name: "v1.0" }));
    await waitFor(() =>
      expect(screen.getByText("v1.0", { selector: ".issue-meta__value" })).toBeTruthy(),
    );
    expect(screen.queryByRole("listbox", { name: "Milestone" })).toBeNull();
    expect(screen.getAllByText(/added this issue to the v1.0 milestone/).length).toBe(1);

    // Reopening and choosing “None” removes the association.
    await user.click(milestoneButton);
    await user.click(screen.getByRole("option", { name: "None" }));
    await waitFor(() => expect(screen.getByText("No milestone")).toBeTruthy());
    expect(screen.getAllByText(/removed this issue from the v1.0 milestone/).length).toBe(1);

    // After a refresh the milestone state matches the last saved state.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/3";
    render(<App />);
    await screen.findByRole("heading", { name: "Original issue title" });
    expect(screen.getByText("No milestone")).toBeTruthy();
  });
});

describe("REQ-5-4 close or reopen an issue", () => {
  it("a Triage+ user closes then reopens the seeded issue; timeline and reload stay consistent", async () => {
    const world = seedWorld();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    // An Open issue offers “Close issue”, never “Reopen issue”.
    const closeButton = screen.getByRole("button", { name: "Close issue" });
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();

    // Closing saves immediately without an extra confirmation dialog.
    await user.click(closeButton);
    await waitFor(() => expect(screen.getByText("Closed")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reopen issue" })).toBeTruthy();

    // The timeline appends a close event carrying the “Closed issue” activity.
    expect(screen.getAllByText(/Closed issue/).length).toBeGreaterThan(0);

    // Number, title, description, comments, and metadata are untouched by the transition.
    expect(screen.getByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comments 1" })).toBeTruthy();
    expect(screen.getByText("bug")).toBeTruthy();
    expect(screen.getByText("documentation")).toBeTruthy();
    expect(screen.getByText("Q3 launch")).toBeTruthy();
    expect(screen.getByText("alice-dev", { selector: ".issue-meta__value" })).toBeTruthy();

    // Reopening restores Open and flips the control back to “Close issue”.
    await user.click(screen.getByRole("button", { name: "Reopen issue" }));
    await waitFor(() => expect(screen.getByText("Open")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Close issue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
    expect(world.issues.find((issue) => issue.number === 1)!.state).toBe("open");

    // The timeline appends close and reopen events in sequence.
    const timeline = screen.getByRole("list", { name: undefined });
    const entries = within(timeline).getAllByRole("article");
    const closeIndex = entries.findIndex((entry) => entry.textContent?.includes("Closed issue"));
    const reopenIndex = entries.findIndex((entry) =>
      entry.textContent?.includes("reopened this issue"),
    );
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(reopenIndex).toBeGreaterThan(closeIndex);

    // Reloading the detail page keeps the final Open state and “Close issue”.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close issue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();

    // The issue list shows the same final state after a refresh.
    cleanup();
    stubFetch(issueFetchHandler(world, { initialSession: { username: "alice-dev" } }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(world.issues.find((issue) => issue.number === 1)!.state).toBe("open");
    expect(world.activities.filter((activity) => activity.issueId === "issue-1").length).toBe(4);
  });

  it("Read and Write viewers see neither close nor reopen and the status does not change", async () => {
    const world = seedWorld();
    // A Read viewer on the protected issue sees only the status.
    stubFetch(
      issueFetchHandler(world, {
        initialSession: { username: "carol-dev" },
        roles: { "alice-dev": "admin", "carol-dev": "read" },
      }),
    );
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
    expect(world.issues.find((issue) => issue.number === 1)!.state).toBe("open");

    // A Write user may edit content but only views the status: no state controls.
    cleanup();
    stubFetch(
      issueFetchHandler(world, {
        initialSession: { username: "bob-reviewer" },
        roles: { "alice-dev": "admin", "bob-reviewer": "write" },
      }),
    );
    window.location.hash = "#/u/alice-dev/repos/acme-docs/issues/1";
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit issue title" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
    expect(world.issues.find((issue) => issue.number === 1)!.state).toBe("open");
  });
});
