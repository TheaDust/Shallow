import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createRepositoryMock, type MockRepositoryServer } from "../../test/repository-server-mock";

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

/**
 * Re-opens an address against the same stored state, so a reload, a re-login or
 * another account sees exactly what the previous steps wrote.
 */
function reopen(viewer: string | null, hash: string) {
  cleanup();
  server.state.viewer = viewer;
  window.location.hash = hash;
  server.install();
  render(<App />);
}

/** The stored work items of acme-docs, as the mock server currently holds them. */
function storedIssues() {
  const repository = server.state.repositories.find((candidate) => candidate.name === "acme-docs");
  return JSON.parse(JSON.stringify(repository?.issues ?? [])) as Array<{ number: number; title: string; body: string }>;
}

/** The stored record of one issue number, or undefined. */
function storedIssue(number: number) {
  return storedIssues().find((issue) => issue.number === number);
}

function commentArticles() {
  return within(screen.getByRole("region", { name: "Discussion" })).getAllByRole("article");
}

/** The stored comment article carrying this text, once the page is ready. */
async function commentArticle(text: string): Promise<HTMLElement> {
  const article = (await screen.findByText(text)).closest("article");
  if (!article) throw new Error(`no comment article for ${text}`);
  return article;
}

async function openIssuesAs(viewer: string) {
  reset(viewer, "#/alice-dev/acme-docs/issues");
  render(<App />);
  await screen.findByRole("link", { name: "New issue" });
}

describe("REQ-5-2-1 create a repository issue", () => {
  it("opens the creation form from the Issues page and stores the new issue", async () => {
    const before = storedIssues();
    const highest = Math.max(...before.map((issue) => issue.number));
    await openIssuesAs("alice-dev");

    // “New issue” is a link of the list page, not a button.
    const newIssue = screen.getByRole("link", { name: "New issue" });
    expect((newIssue as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs/issues/new");
    expect(screen.queryByRole("button", { name: "New issue" })).toBeNull();
    await userEvent.click(newIssue);

    const title = await screen.findByLabelText("Title");
    await userEvent.type(title, "Document the release checklist");
    await userEvent.type(screen.getByLabelText("Description"), "Steps before the Q3 launch.");
    await userEvent.click(screen.getByRole("button", { name: "Submit new issue" }));

    // The detail address of the new number is opened with the stored record.
    expect(await screen.findByRole("heading", { level: 1, name: "Document the release checklist" })).toBeTruthy();
    expect(window.location.hash).toBe(`#/alice-dev/acme-docs/issues/${highest + 1}`);
    expect(screen.getByText(`#${highest + 1}`)).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Steps before the Q3 launch.")).toBeTruthy();
    const activity = screen.getByRole("region", { name: "Activity" });
    expect(within(activity).getByText(/opened this issue/)).toBeTruthy();
    expect(within(activity).getAllByText("alice-dev").length).toBeGreaterThan(0);

    // The list can locate the issue by its new number.
    const stored = storedIssue(highest + 1);
    expect(stored?.title).toBe("Document the release checklist");
    await userEvent.click(screen.getByRole("link", { name: "Issues" }));
    const row = await screen.findByRole("link", { name: "Document the release checklist" });
    expect((row as HTMLAnchorElement).getAttribute("href")).toBe(`#/alice-dev/acme-docs/issues/${highest + 1}`);
    expect(within(row.closest("li") as HTMLElement).getByRole("link", { name: `#${highest + 1}` })).toBeTruthy();
    expect(within(row.closest("li") as HTMLElement).getByText("Open")).toBeTruthy();
  });

  it("keeps the persisted issue after the detail page is reopened", async () => {
    await openIssuesAs("alice-dev");
    await userEvent.click(screen.getByRole("link", { name: "New issue" }));
    await userEvent.type(await screen.findByLabelText("Title"), "Reopen the created issue");
    await userEvent.click(screen.getByRole("button", { name: "Submit new issue" }));
    await screen.findByRole("heading", { level: 1, name: "Reopen the created issue" });
    const address = window.location.hash;

    reopen("alice-dev", address);
    expect(await screen.findByRole("heading", { level: 1, name: "Reopen the created issue" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("treats a title of three spaces as blank and creates no issue", async () => {
    const before = storedIssues();
    await openIssuesAs("alice-dev");
    await userEvent.click(screen.getByRole("link", { name: "New issue" }));
    const title = await screen.findByLabelText("Title");
    await userEvent.type(title, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Submit new issue" }));

    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/issues/new");
    expect(storedIssues()).toEqual(before);
  });

  it("rejects a title over 256 characters without allocating a number", async () => {
    const before = storedIssues();
    await openIssuesAs("alice-dev");
    await userEvent.click(screen.getByRole("link", { name: "New issue" }));
    await userEvent.type(await screen.findByLabelText("Title"), "x".repeat(257));
    await userEvent.click(screen.getByRole("button", { name: "Submit new issue" }));

    expect(await screen.findByText("Title must be 256 characters or fewer")).toBeTruthy();
    expect(storedIssues()).toEqual(before);
  });

  it("offers no creation link to a caller without write permission", async () => {
    reset(null, "#/alice-dev/acme-docs/issues");
    render(<App />);
    await screen.findByRole("link", { name: "Improve onboarding" });
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();

    // Direct navigation shows the sign-in hint instead of the form.
    reset(null, "#/alice-dev/acme-docs/issues/new");
    render(<App />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit new issue" })).toBeNull();
  });
});

describe("REQ-5-2-2 edit an issue title and description", () => {
  it("saves the title and the description as separate actions and keeps them after a reload", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });

    await userEvent.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleBox = screen.getByLabelText("Issue title");
    expect((titleBox as HTMLInputElement).value).toBe("Improve onboarding");
    await userEvent.clear(titleBox);
    await userEvent.type(titleBox, "Improve the onboarding flow");
    await userEvent.click(screen.getByRole("button", { name: "Save issue title" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Improve the onboarding flow" })).toBeTruthy();
    // The metadata of the same issue is untouched.
    expect(within(screen.getByRole("region", { name: "Labels" })).getByText("bug")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Assignees" })).getByText("bob-reviewer")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Edit issue description" }));
    const descriptionBox = screen.getByLabelText("Issue description");
    await userEvent.clear(descriptionBox);
    await userEvent.type(descriptionBox, "Describe the improvement in two steps.");
    await userEvent.click(screen.getByRole("button", { name: "Save issue description" }));

    expect(await screen.findByText("Describe the improvement in two steps.")).toBeTruthy();
    expect(storedIssue(1)?.title).toBe("Improve the onboarding flow");

    // Both saves survive a reload of the same issue address.
    reopen("alice-dev", "#/alice-dev/acme-docs/issues/1");
    expect(await screen.findByRole("heading", { level: 1, name: "Improve the onboarding flow" })).toBeTruthy();
    expect(screen.getByText("Describe the improvement in two steps.")).toBeTruthy();
  });

  it("keeps the original title of the invalid-edit seed when a blank title is saved", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/issues/3");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Original issue title" });

    await userEvent.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleBox = screen.getByLabelText("Issue title");
    await userEvent.clear(titleBox);
    await userEvent.type(titleBox, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save issue title" }));

    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(storedIssue(3)?.title).toBe("Original issue title");

    reopen("alice-dev", "#/alice-dev/acme-docs/issues/3");
    expect(await screen.findByRole("heading", { level: 1, name: "Original issue title" })).toBeTruthy();
  });

  it("hides the edit controls from a viewer without write permission", async () => {
    reset(null, "#/alice-dev/acme-docs/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Edit issue title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit issue description" })).toBeNull();
    expect(screen.queryByLabelText("Issue title")).toBeNull();
  });
});

describe("REQ-5-2-3 comment on an issue discussion", () => {
  it("appends the comment with its author and body and keeps it after a reload", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });
    const before = commentArticles().length;

    await userEvent.type(screen.getByLabelText("Comment"), "The welcome screen should link to the guide.");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByText("The welcome screen should link to the guide.")).toBeTruthy();
    expect(commentArticles().length).toBe(before + 1);
    const stored = storedIssues().find((issue) => issue.number === 1) as unknown as {
      comments: Array<{ body: string; author: string }>;
    };
    expect(stored.comments.at(-1)?.body).toBe("The welcome screen should link to the guide.");
    expect(stored.comments.at(-1)?.author).toBe("alice-dev");

    reopen("alice-dev", "#/alice-dev/acme-docs/issues/1");
    expect(await screen.findByText("The welcome screen should link to the guide.")).toBeTruthy();
  });

  it("appends nothing for a whitespace-only comment", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });
    const before = commentArticles().length;
    const activityBefore = within(screen.getByRole("region", { name: "Activity" })).getAllByRole("article").length;

    await userEvent.type(screen.getByLabelText("Comment"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByText("Comment is required")).toBeTruthy();
    expect(commentArticles().length).toBe(before);
    expect(within(screen.getByRole("region", { name: "Activity" })).getAllByRole("article").length).toBe(activityBefore);
  });

  it("offers the comment editor only to writers", async () => {
    reset(null, "#/alice-dev/acme-docs/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });
    expect(screen.queryByLabelText("Comment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    // A visitor may still read the stored discussion.
    expect(screen.getByText("Great idea. Let us start with the welcome screen.")).toBeTruthy();
  });
});

describe("REQ-5-2-3 reactions on an issue comment", () => {
  it("adds one reaction to the existing comment and toggles it off again", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/issues/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });

    const comment = await commentArticle("Great idea. Let us start with the welcome screen.");
    await userEvent.click(within(comment).getByRole("button", { name: "Add reaction" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Thumbs up/ }));

    await waitFor(() => {
      expect(within(comment).getByRole("button", { name: "👍 1" })).toBeTruthy();
    });
    expect(within(comment).getByRole("button", { name: "👍 1" }).getAttribute("aria-pressed")).toBe("true");

    // Selecting the same reaction again removes it — no duplicate is stored.
    await userEvent.click(within(comment).getByRole("button", { name: "👍 1" }));
    await waitFor(() => {
      expect(within(comment).queryByRole("button", { name: "👍 1" })).toBeNull();
    });

    // A stored reaction survives a reload.
    await userEvent.click(within(comment).getByRole("button", { name: "Add reaction" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Hooray/ }));
    await waitFor(() => {
      expect(within(comment).getByRole("button", { name: "🎉 1" })).toBeTruthy();
    });

    reopen("alice-dev", "#/alice-dev/acme-docs/issues/1");
    const reopened = await commentArticle("Great idea. Let us start with the welcome screen.");
    expect(within(reopened).getByRole("button", { name: "🎉 1" })).toBeTruthy();
  });

  it("shows a stored reaction to another signed-in viewer without owning it", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/issues/3");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Original issue title" });
    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Rocket/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "🚀 1" })).toBeTruthy();
    });

    reopen("dana-observer", "#/alice-dev/acme-docs/issues/3");
    await screen.findByRole("heading", { level: 1, name: "Original issue title" });
    const chip = screen.getByRole("button", { name: "🚀 1" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Edit issue title" })).toBeNull();
  });
});
