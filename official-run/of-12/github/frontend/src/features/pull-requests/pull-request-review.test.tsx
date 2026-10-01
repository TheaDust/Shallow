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

/** Renders the application again for the same address, as a reload would. */
function reload() {
  cleanup();
  render(<App />);
}

function pullRequest(number: number) {
  return server.state.repositories
    .find((repository) => repository.name === "acme-docs")!
    .pullRequests.find((pullRequest) => pullRequest.number === number)!;
}

/** The region a section of the detail page owns. */
function region(name: string) {
  return within(screen.getByRole("region", { name }));
}

/** Opens the Files changed view of one pull request with the given viewer. */
async function openFiles(viewer: string | null, number: number) {
  reset(viewer, `#/alice-dev/acme-docs/pulls/${number}?tab=files`);
  render(<App />);
  return screen.findByRole("link", { name: "Conversation" });
}

describe("REQ-6-3-1 view the pull request overview, commits and changed files", () => {
  it("reads the seeded public pull request with its discussion and its three sections", async () => {
    reset("visitor", "#/alice-dev/acme-docs/pulls/1");

    render(<App />);

    // The heading is the persisted title and the status is the stored one.
    const heading = await screen.findByRole("heading", { name: "Improve onboarding", level: 1 });
    expect(heading.textContent).toBe("Improve onboarding");
    const article = screen.getByRole("article", { name: "Pull request 1" });
    expect(within(article).getByText("Open")).toBeTruthy();

    // Conversation spells the description, the branches and the discussion.
    expect(
      region("Pull request conversation").getByText(
        "Rewrite the onboarding notes so a new contributor can start quickly.",
      ),
    ).toBeTruthy();
    expect(within(article).getByText("main")).toBeTruthy();
    expect(within(article).getByText("onboarding-docs")).toBeTruthy();
    expect(
      region("Pull request conversation").getByText(
        "The onboarding steps read much better now. Please add a screenshot of the first run.",
      ),
    ).toBeTruthy();

    // Commits and Files changed are navigation links of the same pull request.
    await userEvent.click(screen.getByRole("link", { name: "Commits" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/pulls/1?tab=commits");
    expect(region("Pull request commits").getByText("Commit summary")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Draft the onboarding notes" })).toBeTruthy();

    await userEvent.click(screen.getByRole("link", { name: "Files changed" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/pulls/1?tab=files");
    expect(await screen.findByRole("heading", { name: "docs/onboarding.md", level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Improve onboarding", level: 1 })).toBeTruthy();

    // Refreshing any tab keeps the title, the branches and the commits.
    reload();
    expect(await screen.findByRole("heading", { name: "Improve onboarding", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "src/search.ts", level: 3 })).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("link", { name: "Draft the onboarding notes" })).toBeTruthy();
    // Reading the three sections writes no comment, review or branch update.
    expect(pullRequest(1).comments).toHaveLength(1);
    expect(pullRequest(1).reviews).toEqual([]);
  });
});

describe("REQ-6-3-2 inspect the changed files and the aggregate diff", () => {
  it("spells the changed paths, their lines and the aggregate statistics", async () => {
    reset("visitor", "#/alice-dev/acme-docs/pulls/1?tab=files");
    render(<App />);

    const files = await screen.findByRole("region", { name: "Pull request files changed" });
    expect(within(files).getByText("2 changed files")).toBeTruthy();
    expect(within(files).getByText("3 additions, 1 deletions")).toBeTruthy();
    // The known changed path of the comparison is spelled verbatim.
    expect(within(files).getByRole("heading", { name: "src/search.ts", level: 3 })).toBeTruthy();
    expect(within(files).getByRole("heading", { name: "docs/onboarding.md", level: 3 })).toBeTruthy();
    // An unchanged file of the same repository never appears in the diff.
    expect(within(files).queryByRole("heading", { name: "README.md", level: 3 })).toBeNull();
    // The deleted line of the modified file is readable as its own text.
    expect(within(files).getByText("-export const SEARCH_FLOW_LABEL = \"Search flow\";")).toBeTruthy();
    expect(within(files).getByText("+# Onboarding")).toBeTruthy();

    // Switching back to Conversation and reloading changes nothing.
    await userEvent.click(screen.getByRole("link", { name: "Conversation" }));
    expect(await screen.findByRole("heading", { name: "Improve onboarding", level: 1 })).toBeTruthy();
    reload();
    await screen.findByRole("heading", { name: "Improve onboarding", level: 1 });
    await userEvent.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByText("3 additions, 1 deletions")).toBeTruthy();
  });
});

describe("REQ-6-3-3 add review comments to changed code lines", () => {
  it("publishes a single comment on the first commentable changed line", async () => {
    await openFiles("bob-reviewer", 4);

    const buttons = await screen.findAllByRole("button", { name: "Add comment" });
    expect(buttons.length).toBeGreaterThan(0);
    await userEvent.click(buttons[0]);

    // One editor labeled Comment with the two publication choices.
    const field = await screen.findByLabelText("Comment");
    await userEvent.type(field, "Please link the first run here.");
    await userEvent.click(screen.getByRole("button", { name: "Add single comment" }));

    // The diff view and Conversation display the stored comment immediately.
    await waitFor(() => expect(screen.queryByLabelText("Comment")).toBeNull());
    expect(screen.getAllByText("Please link the first run here.").length).toBeGreaterThan(0);
    const stored = pullRequest(4).reviewComments.at(-1)!;
    expect(stored).toMatchObject({
      filePath: "docs/onboarding.md",
      line: 1,
      side: "added",
      author: "bob-reviewer",
      body: "Please link the first run here.",
      pending: false,
    });

    await userEvent.click(screen.getByRole("link", { name: "Conversation" }));
    const conversation = await screen.findByRole("region", { name: "Pull request conversation" });
    expect(within(conversation).getByText("Please link the first run here.")).toBeTruthy();
    expect(within(conversation).getByText("docs/onboarding.md:1")).toBeTruthy();

    // The comment stays anchored to that line after a reload.
    reload();
    await screen.findByRole("heading", { name: "Add onboarding notes for the release", level: 1 });
    await userEvent.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByText("Please link the first run here.")).toBeTruthy();
  });

  it("keeps a `Start a review` comment pending and private to its author", async () => {
    await openFiles("bob-reviewer", 5);

    await userEvent.click((await screen.findAllByRole("button", { name: "Add comment" }))[0]);
    await userEvent.type(await screen.findByLabelText("Comment"), "Keep this draft private.");
    await userEvent.click(screen.getByRole("button", { name: "Start a review" }));

    expect(await screen.findByText("Pending review")).toBeTruthy();
    expect(pullRequest(5).reviewComments.at(-1)?.pending).toBe(true);

    // Another viewer — here the author — never reads the pending draft.
    cleanup();
    server.state.viewer = "alice-dev";
    window.location.hash = "#/alice-dev/acme-docs/pulls/5?tab=files";
    render(<App />);
    await screen.findByRole("region", { name: "Pull request files changed" });
    expect(screen.queryByText("Keep this draft private.")).toBeNull();
    expect(pullRequest(5).comments).toEqual([]);
  });

  it("reports an empty body and stores nothing", async () => {
    await openFiles("bob-reviewer", 4);
    await userEvent.click((await screen.findAllByRole("button", { name: "Add comment" }))[0]);
    await userEvent.click(screen.getByRole("button", { name: "Add single comment" }));

    expect(await screen.findByText("Comment is required")).toBeTruthy();
    expect(pullRequest(4).reviewComments).toEqual([]);
  });

  it("offers no comment entry to a viewer without review permission", async () => {
    await openFiles("dana-observer", 4);
    await screen.findByRole("region", { name: "Pull request files changed" });
    expect(screen.queryAllByRole("button", { name: "Add comment" })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });
});

describe("REQ-6-3-4 submit a pull request review", () => {
  it("submits an Approve without a summary and shows it in the review summary", async () => {
    await openFiles("bob-reviewer", 4);

    await userEvent.click(await screen.findByRole("button", { name: "Review changes" }));
    // The review form carries the Summary field, the three decisions and the
    // one submit button.
    await screen.findByLabelText("Summary");
    expect(screen.getByRole("radio", { name: "Comment" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Request changes" })).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => {
      expect(pullRequest(4).reviews.at(-1)).toMatchObject({
        reviewer: "bob-reviewer",
        decision: "approve",
        summary: "",
      });
    });

    await userEvent.click(screen.getByRole("link", { name: "Conversation" }));
    const summary = await screen.findByRole("region", { name: "Review summary" });
    expect(within(summary).getByText("bob-reviewer")).toBeTruthy();
    expect(within(summary).getByText("Approved")).toBeTruthy();

    // The decision still exists after a reload.
    reload();
    await screen.findByRole("heading", { name: "Add onboarding notes for the release", level: 1 });
    const reloaded = await screen.findByRole("region", { name: "Review summary" });
    expect(within(reloaded).getByText("Approved")).toBeTruthy();
  });

  it("stores a Request changes decision with its exact summary", async () => {
    await openFiles("carol-maintainer", 5);

    await userEvent.click(await screen.findByRole("button", { name: "Review changes" }));
    await userEvent.type(await screen.findByLabelText("Summary"), "Please cover the empty search case.");
    await userEvent.click(screen.getByRole("radio", { name: "Request changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await userEvent.click(screen.getByRole("link", { name: "Conversation" }));
    const summary = await screen.findByRole("region", { name: "Review summary" });
    expect(within(summary).getByText("Changes requested")).toBeTruthy();
    expect(within(summary).getByText("Please cover the empty search case.")).toBeTruthy();
    expect(pullRequest(5).reviews.at(-1)).toMatchObject({
      reviewer: "carol-maintainer",
      decision: "request_changes",
      summary: "Please cover the empty search case.",
    });

    reload();
    await screen.findByRole("heading", { name: "Add draft notes for the release", level: 1 });
    const reloaded = await screen.findByRole("region", { name: "Review summary" });
    expect(within(reloaded).getByText("Changes requested")).toBeTruthy();
  });

  it("offers no review form to the author or on a draft pull request", async () => {
    await openFiles("alice-dev", 4);
    await screen.findByRole("region", { name: "Pull request files changed" });
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();

    await openFiles("bob-reviewer", 3);
    await screen.findByRole("region", { name: "Pull request files changed" });
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });
});
