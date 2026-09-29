import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "../auth/session";
import type { RepoRole } from "../organizations/api";
import {
  getComparisonData,
  type CheckStatus,
  type InlineComment,
  type PullRequestDetail,
  type PullRequestDetailData,
  type PullRequestSummary,
} from "./api";
import { PullRequestDetailPage } from "./PullRequestDetailPage";
import { PullRequestNewPage } from "./PullRequestNewPage";
import { PullRequestsPage } from "./PullRequestsPage";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  listPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
  getComparisonData: vi.fn(),
  createPullRequest: vi.fn(),
  requestReviewer: vi.fn(),
  removeReviewer: vi.fn(),
  setPullRequestStatus: vi.fn(),
  updatePullRequestCheck: vi.fn(),
  mergePullRequest: vi.fn(),
  readyForReview: vi.fn(),
  addInlineComment: vi.fn(),
  submitPullRequestReview: vi.fn(),
}));

vi.mock("../auth/api", () => ({
  fetchSession: mocks.fetchSession,
}));

vi.mock("./api", () => ({
  listPullRequests: mocks.listPullRequests,
  getPullRequest: mocks.getPullRequest,
  getComparisonData: mocks.getComparisonData,
  createPullRequest: mocks.createPullRequest,
  requestReviewer: mocks.requestReviewer,
  removeReviewer: mocks.removeReviewer,
  setPullRequestStatus: mocks.setPullRequestStatus,
  updatePullRequestCheck: mocks.updatePullRequestCheck,
  mergePullRequest: mocks.mergePullRequest,
  readyForReview: mocks.readyForReview,
  addInlineComment: mocks.addInlineComment,
  submitPullRequestReview: mocks.submitPullRequestReview,
}));

const now = new Date().toISOString();

const anonymousSession = { authenticated: false };
const aliceSession = {
  authenticated: true,
  account: { username: "alice-dev", email: "alice.dev@example.test" },
};
const bobSession = {
  authenticated: true,
  account: { username: "bob-reviewer", email: "bob.reviewer@example.test" },
};

const summary: PullRequestSummary = {
  number: 1,
  title: "Improve onboarding",
  author: "alice-dev",
  status: "open",
  baseBranch: "main",
  compareBranch: "release",
  createdAt: now,
  updatedAt: now,
  reviews: [],
  reviewRequested: false,
};

function makePull(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    number: 1,
    title: "Improve onboarding",
    description: "Improve the onboarding flow for new users.",
    status: "open",
    author: "alice-dev",
    baseBranch: "main",
    compareBranch: "release",
    baseCommit: "c2",
    compareCommit: "c4",
    currentCompareCommit: "c4",
    createdAt: now,
    updatedAt: now,
    mergedBy: null,
    mergedAt: null,
    mergeCommitId: null,
    comments: [
      {
        id: "c1",
        author: "bob-reviewer",
        body: "I can draft the new onboarding flow.",
        createdAt: now,
      },
    ],
    inlineComments: [],
    requestedReviewers: [],
    checks: { status: "pending", setter: null, setAt: null },
    reviewSummary: [],
    timeline: [
      { id: "t1", type: "created", author: "alice-dev", createdAt: now },
      { id: "t2", type: "comment", author: "bob-reviewer", commentId: "c1", createdAt: now },
    ],
    ...overrides,
  };
}

function publishedComment(overrides: Partial<InlineComment> = {}): InlineComment {
  return {
    id: "inline-1",
    path: "README.md",
    line: 2,
    commitId: "c4",
    author: "bob-reviewer",
    body: "Please adjust this line",
    state: "published",
    createdAt: now,
    outdated: false,
    ...overrides,
  };
}

function pendingComment(overrides: Partial<InlineComment> = {}): InlineComment {
  return {
    ...publishedComment(),
    id: "inline-2",
    body: "Pending draft comment",
    state: "pending",
    ...overrides,
  };
}

function makeDetail(overrides: { pull?: Partial<PullRequestDetail>; myRole?: RepoRole | null } = {}): PullRequestDetailData {
  return {
    pull: makePull(overrides.pull),
    myRole: overrides.myRole ?? null,
    branches: ["main", "feature-search", "release"],
    commits: [
      {
        id: "c4",
        shortId: "c4",
        message: "Prepare release",
        author: "alice-dev",
        createdAt: now,
        changes: [{ path: "src/search.ts", additions: 1, deletions: 1 }],
      },
    ],
    files: {
      files: [
        {
          path: "README.md",
          additions: 1,
          deletions: 1,
          lines: [
            { type: "context", line: "# Acme Documentation" },
            { type: "del", line: "This repository documents the product." },
            { type: "add", line: "This repository documents the release branch." },
          ],
        },
      ],
      totalAdditions: 1,
      totalDeletions: 1,
    },
    eligibleReviewers: ["bob-reviewer"],
    mergeEligibility: { eligible: true, reasons: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSession.mockResolvedValue(anonymousSession);
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

describe("PullRequestsPage", () => {
  const listData = {
    repository: { owner: "alice-dev", name: "acme-docs" },
    myRole: null,
    pulls: [
      { ...summary, number: 2, title: "Fix search", status: "closed", compareBranch: "feature-search" },
      summary,
    ],
  };

  it("renders pull request rows with title links, status and branches", async () => {
    mocks.listPullRequests.mockResolvedValue(listData);

    render(
      <SessionProvider>
        <PullRequestsPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Pull requests" })).toBeTruthy();
    const openLink = screen.getByRole("link", { name: "Improve onboarding" });
    expect(openLink.getAttribute("href")).toBe("#/repos/alice-dev/acme-docs/pulls/1");
    const items = screen.getAllByRole("listitem");
    const openItem = items.find((item) => within(item).queryByRole("link", { name: "Improve onboarding" }));
    expect(within(openItem as HTMLElement).getByText("Open")).toBeTruthy();
    expect(within(openItem as HTMLElement).getByText("release into main")).toBeTruthy();
    const closedItem = items.find((item) => within(item).queryByRole("link", { name: "Fix search" }));
    expect(within(closedItem as HTMLElement).getByText("Closed")).toBeTruthy();
    expect(within(closedItem as HTMLElement).getByText("feature-search into main")).toBeTruthy();
    // A visitor cannot enter the creation flow.
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();
  });

  it("filters by status and author, persists the selection and switches to Closed", async () => {
    mocks.listPullRequests.mockResolvedValue(listData);
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls";

    render(
      <SessionProvider>
        <PullRequestsPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Pull requests" });
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fix search" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Review status" })).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Open" }));
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();
    });
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(window.location.hash).toContain("status=open");

    await user.type(screen.getByLabelText("Author"), "alice");
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "Closed" }));
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    });
    expect(screen.getByRole("link", { name: "Fix search" })).toBeTruthy();
  });

  it("keeps the filtered list after reloading with the selection in the hash", async () => {
    mocks.listPullRequests.mockResolvedValue(listData);
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls?status=open&author=alice";

    render(
      <SessionProvider>
        <PullRequestsPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Pull requests" });
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();
  });

  it("offers New pull request to Write or higher users", async () => {
    mocks.listPullRequests.mockResolvedValue({
      repository: { owner: "alice-dev", name: "acme-docs" },
      myRole: "write",
      pulls: [summary],
    });
    render(
      <SessionProvider>
        <PullRequestsPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Pull requests" });
    const link = screen.getByRole("link", { name: "New pull request" });
    expect(link.getAttribute("href")).toBe("#/repos/alice-dev/acme-docs/pulls/new");
  });
});

describe("PullRequestNewPage", () => {
  const comparisonData = {
    repository: { owner: "alice-dev", name: "acme-docs" },
    myRole: "admin" as const,
    branches: ["main", "feature-search", "release"],
    base: "main",
    compare: "feature-search",
    baseCommit: "c2",
    compareCommit: "c3",
    commitCount: 1,
    files: [
      { path: "main-only.md", additions: 1, deletions: 0, lines: [{ type: "add", line: "This file only exists on the feature-search branch." }] },
      { path: "src/search.ts", additions: 1, deletions: 1, lines: [] },
    ],
    totalAdditions: 2,
    totalDeletions: 1,
    valid: true,
    reason: null,
  };

  it("shows branch selects, changed files, commit summary and both creation entries for a valid pair", async () => {
    mocks.getComparisonData.mockImplementation(async (_owner, _name, base, compare) => ({
      ...comparisonData,
      base,
      compare,
    }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search";

    render(
      <SessionProvider>
        <PullRequestNewPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Compare changes" });
    const base = screen.getByRole("combobox", { name: "base" });
    const compare = screen.getByRole("combobox", { name: "compare" });
    expect(within(base).getByRole("option", { name: "main" })).toBeTruthy();
    expect(within(compare).getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(screen.getByText("src/search.ts")).toBeTruthy();
    expect(screen.getByText("Commit summary")).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create pull request" });
    expect(create.hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Create draft pull request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare changes" })).toBeTruthy();
  });

  it("immediately explains No changes and disables creation when both branches are the same", async () => {
    mocks.getComparisonData.mockImplementation(async (_owner, _name, base, compare) => ({
      ...comparisonData,
      base,
      compare,
      valid: base !== compare,
      reason: base === compare ? "same_branch" : null,
    }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=main";

    render(
      <SessionProvider>
        <PullRequestNewPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );

    await screen.findByText("No changes");
    expect(screen.queryByRole("button", { name: "Create pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create draft pull request" })).toBeNull();
  });

  it("creates a normal pull request from the form and rejects a blank title", async () => {
    mocks.getComparisonData.mockImplementation(async (_owner, _name, base, compare) => ({
      ...comparisonData,
      base,
      compare,
    }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search";

    render(
      <SessionProvider>
        <PullRequestNewPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Compare changes" });
    const user = userEvent.setup();
    mocks.createPullRequest.mockResolvedValue({ ok: false, errors: { title: "Title is required" } });
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.type(await screen.findByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    expect(mocks.createPullRequest).toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Search improvements");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Title is required");
    expect(mocks.createPullRequest).toHaveBeenCalledWith("alice-dev", "acme-docs", {
      base: "main",
      compare: "feature-search",
      title: "Search improvements",
      description: "",
      draft: false,
    });

    mocks.createPullRequest.mockResolvedValue({ ok: true, pull: makePull({ number: 3, title: "Search improvements" }) });
    await user.type(screen.getByLabelText("Description"), "Return results.");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    expect(mocks.createPullRequest).toHaveBeenCalledTimes(3);
    await waitFor(() => {
      expect(window.location.hash).toContain("/pulls/3");
    });
  });

  it("creates a draft pull request with a single draft submit button", async () => {
    mocks.getComparisonData.mockImplementation(async (_owner, _name, base, compare) => ({
      ...comparisonData,
      base,
      compare,
    }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search";

    render(
      <SessionProvider>
        <PullRequestNewPage owner="alice-dev" name="acme-docs" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Compare changes" });
    const user = userEvent.setup();
    mocks.createPullRequest.mockResolvedValue({ ok: true, pull: makePull({ number: 4, status: "draft", title: "Draft improvements" }) });
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));
    await user.type(await screen.findByLabelText("Title"), "Draft improvements");
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));
    expect(mocks.createPullRequest).toHaveBeenCalledWith("alice-dev", "acme-docs", {
      base: "main",
      compare: "feature-search",
      title: "Draft improvements",
      description: "",
      draft: true,
    });
    await waitFor(() => {
      expect(window.location.hash).toContain("/pulls/4");
    });
  });
});

describe("PullRequestDetailPage", () => {
  it("renders the exact title heading, status, tabs and conversation", async () => {
    mocks.getPullRequest.mockResolvedValue(makeDetail());
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    for (const name of ["Conversation", "Commits", "Files changed", "Checks"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    expect(screen.getByText("release into main")).toBeTruthy();
    expect(screen.getByText("I can draft the new onboarding flow.")).toBeTruthy();
  });

  it("shows the Checks area with pending test and lets an Admin save success", async () => {
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "admin" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=checks";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    expect(await screen.findByText("test: pending")).toBeTruthy();
    const user = userEvent.setup();
    const status = screen.getByRole("combobox", { name: "test status" });
    await user.selectOptions(status, "success");

    mocks.updatePullRequestCheck.mockResolvedValue({
      ok: true,
      checks: { status: "success", setter: "alice-dev", setAt: now },
      commitId: "c4",
    });
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({
        myRole: "admin",
        pull: {
          checks: { status: "success", setter: "alice-dev", setAt: now },
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("test: success")).toBeTruthy();
    expect(screen.getByText(/set by alice-dev at/)).toBeTruthy();
  });

  it("does not offer a test-status control to non-admins", async () => {
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "write" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=checks";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    expect(await screen.findByText("test: pending")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "test status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("requests and removes a reviewer from the Reviewers area", async () => {
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "admin" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reviewers" }));
    const search = screen.getByRole("searchbox", { name: "Search" });
    await user.type(search, "bob");

    mocks.requestReviewer.mockResolvedValue({
      ok: true,
      pull: makePull({ requestedReviewers: [{ username: "bob-reviewer", requestedBy: "alice-dev", createdAt: now }] }),
    });
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({
        myRole: "admin",
        pull: { requestedReviewers: [{ username: "bob-reviewer", requestedBy: "alice-dev", createdAt: now }] },
      }),
    );
    await user.click(screen.getByRole("option", { name: "bob-reviewer" }));
    expect(await screen.findByRole("button", { name: "Remove bob-reviewer" })).toBeTruthy();

    mocks.removeReviewer.mockResolvedValue({
      ok: true,
      pull: makePull({ requestedReviewers: [] }),
    });
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "admin", pull: { requestedReviewers: [] } }));
    await user.click(screen.getByRole("button", { name: "Remove bob-reviewer" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();
    });
    expect(mocks.removeReviewer).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, "bob-reviewer");
  });

  it("closes and reopens an authored pull request", async () => {
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "admin" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const user = userEvent.setup();
    mocks.setPullRequestStatus.mockResolvedValue({
      ok: true,
      pull: makePull({ status: "closed" }),
    });
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({ myRole: "admin", pull: { status: "closed" } }),
    );
    await user.click(screen.getByRole("button", { name: "Close pull request" }));
    expect(await screen.findByText("Closed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reopen pull request" })).toBeTruthy();

    mocks.setPullRequestStatus.mockResolvedValue({
      ok: true,
      pull: makePull({ status: "open" }),
    });
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "admin" }));
    await user.click(screen.getByRole("button", { name: "Reopen pull request" }));
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close pull request" })).toBeTruthy();
  });

  it("hides close and reopen controls for a viewer who is neither author nor maintainer", async () => {
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "read" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();
  });

  it("shows a Draft marker, a disabled Merge pull request button and Ready for review for a draft", async () => {
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "admin", pull: { status: "draft" } }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/3";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="3" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Draft")).toBeTruthy();
    const mergeButton = screen.getByRole("button", { name: "Merge pull request" });
    expect(mergeButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Draft pull requests cannot be merged").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Ready for review" })).toBeTruthy();

    const user = userEvent.setup();
    mocks.readyForReview.mockResolvedValue({
      ok: true,
      pull: makePull({
        status: "open",
        timeline: [
          { id: "t1", type: "created", author: "alice-dev", createdAt: now },
          { id: "t2", type: "ready-for-review", author: "alice-dev", createdAt: now },
        ],
      }),
    });
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({
        myRole: "admin",
        pull: {
          status: "open",
          timeline: [
            { id: "t1", type: "created", author: "alice-dev", createdAt: now },
            { id: "t2", type: "ready-for-review", author: "alice-dev", createdAt: now },
          ],
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Ready for review" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();
    expect(screen.getByText("Ready for review")).toBeTruthy();
  });

  it("hides Ready for review from a Read viewer of a draft but keeps the merge entry disabled", async () => {
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "read", pull: { status: "draft" } }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/3";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="3" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();
    const mergeButton = screen.getByRole("button", { name: "Merge pull request" });
    expect(mergeButton.hasAttribute("disabled")).toBe(true);
  });

  it("publishes an inline comment from the first changed line and shows it in the diff", async () => {
    mocks.fetchSession.mockResolvedValue(bobSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "write" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=files";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const addButtons = screen.getAllByRole("button", { name: "Add comment" });
    expect(addButtons.length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(addButtons[0]);
    const commentBox = await screen.findByRole("textbox", { name: "Comment" });
    await user.type(commentBox, "Please adjust this line");
    expect(screen.getByRole("button", { name: "Add single comment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start a review" })).toBeTruthy();

    mocks.addInlineComment.mockResolvedValue({ ok: true, comment: publishedComment() });
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({ myRole: "write", pull: { inlineComments: [publishedComment()] } }),
    );
    await user.click(screen.getByRole("button", { name: "Add single comment" }));
    expect(mocks.addInlineComment).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, {
      path: "README.md",
      line: 2,
      body: "Please adjust this line",
      draft: false,
    });
    expect(await screen.findByText("Please adjust this line")).toBeTruthy();
    expect(screen.getByText("bob-reviewer")).toBeTruthy();
  });

  it("keeps a started review comment pending with a Pending review badge", async () => {
    mocks.fetchSession.mockResolvedValue(bobSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "write" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=files";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Add comment" })[0]);
    await user.type(await screen.findByRole("textbox", { name: "Comment" }), "Pending draft comment");

    mocks.addInlineComment.mockResolvedValue({ ok: true, comment: pendingComment() });
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({ myRole: "write", pull: { inlineComments: [pendingComment()] } }),
    );
    await user.click(screen.getByRole("button", { name: "Start a review" }));
    expect(mocks.addInlineComment).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, {
      path: "README.md",
      line: 2,
      body: "Pending draft comment",
      draft: true,
    });
    expect(await screen.findByText("Pending review")).toBeTruthy();
    expect(screen.getByText("Pending draft comment")).toBeTruthy();
  });

  it("rejects an empty inline comment without publishing a partial comment", async () => {
    mocks.fetchSession.mockResolvedValue(bobSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "write" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=files";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Add comment" })[0]);
    await user.type(await screen.findByRole("textbox", { name: "Comment" }), "   ");
    mocks.addInlineComment.mockResolvedValue({ ok: false, errors: { comment: "Comment is required" } });
    await user.click(screen.getByRole("button", { name: "Add single comment" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Comment is required");
    expect(mocks.addInlineComment).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, {
      path: "README.md",
      line: 2,
      body: "",
      draft: false,
    });
    expect(screen.queryByText("Comment is required", { selector: ".diff-comment__body" })).toBeNull();
  });

  it("does not offer Add comment buttons to the PR author", async () => {
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "admin" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=files";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Add comment" })).toBeNull();
  });

  it("submits an Approve review without a summary from Files changed and shows Approved", async () => {
    mocks.fetchSession.mockResolvedValue(bobSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "write" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=files";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Review changes" });
    expect(trigger).toBeTruthy();
    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "Submit your review" })).toBeTruthy();
    expect(screen.getByLabelText("Summary")).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual([
      "comment",
      "approve",
      "request_changes",
    ]);
    expect(screen.getByRole("radio", { name: "Comment" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Request changes" })).toBeTruthy();

    mocks.submitPullRequestReview.mockResolvedValue({
      ok: true,
      review: {
        reviewer: "bob-reviewer",
        commitId: "c4",
        decision: "approve",
        explanation: "",
        createdAt: now,
      },
      pull: makePull(),
    });
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({
        myRole: "write",
        pull: {
          reviewSummary: [
            { reviewer: "bob-reviewer", decision: "approve", createdAt: now, explanation: "" },
          ],
        },
      }),
    );
    await user.click(screen.getByRole("radio", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(mocks.submitPullRequestReview).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, {
      decision: "approve",
      summary: "",
    });
    expect((await screen.findAllByText("Approved")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("bob-reviewer").length).toBeGreaterThan(0);
    // The sidebar review summary shows the decision too.
    expect(screen.getByRole("region", { name: "Review summary" })).toBeTruthy();
  });

  it("submits Request changes with a summary and displays Changes requested", async () => {
    mocks.fetchSession.mockResolvedValue(bobSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "write" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=files";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.type(screen.getByLabelText("Summary"), "Please adjust the onboarding copy");
    await user.click(screen.getByRole("radio", { name: "Request changes" }));

    mocks.submitPullRequestReview.mockResolvedValue({
      ok: true,
      review: {
        reviewer: "bob-reviewer",
        commitId: "c4",
        decision: "request_changes",
        explanation: "Please adjust the onboarding copy",
        createdAt: now,
      },
      pull: makePull(),
    });
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({
        myRole: "write",
        pull: {
          reviewSummary: [
            {
              reviewer: "bob-reviewer",
              decision: "request_changes",
              createdAt: now,
              explanation: "Please adjust the onboarding copy",
            },
          ],
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(mocks.submitPullRequestReview).toHaveBeenCalledWith("alice-dev", "acme-docs", 1, {
      decision: "request_changes",
      summary: "Please adjust the onboarding copy",
    });
    expect((await screen.findAllByText("Changes requested")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Please adjust the onboarding copy").length).toBeGreaterThan(0);
  });

  it("hides Review changes from the author and on Draft PRs and shows it to Write reviewers", async () => {
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "admin" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=files";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    cleanup();

    mocks.fetchSession.mockResolvedValue(bobSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "write", pull: { status: "draft" } }));
    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="3" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });

  it("keeps a failed review submission unpublished and shows the error", async () => {
    mocks.fetchSession.mockResolvedValue(bobSession);
    mocks.getPullRequest.mockResolvedValue(makeDetail({ myRole: "write" }));
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1?tab=files";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Approve" }));

    mocks.submitPullRequestReview.mockResolvedValue({ ok: false, errors: { review: "The review could not be submitted" } });
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The review could not be submitted");
    expect(mocks.getPullRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Approved")).toBeNull();
  });

  it("shows review summaries and inline comments in Conversation", async () => {
    mocks.fetchSession.mockResolvedValue(bobSession);
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({
        myRole: "write",
        pull: {
          reviewSummary: [
            { reviewer: "bob-reviewer", decision: "approve", createdAt: now, explanation: "Looks good" },
          ],
          inlineComments: [publishedComment()],
        },
      }),
    );
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Looks good").length).toBeGreaterThan(0);
    expect(screen.getByText(/commented on README.md line 2/)).toBeTruthy();
    expect(screen.getByText("Please adjust this line")).toBeTruthy();
  });

  it("hides pending inline comments from other users", async () => {
    mocks.fetchSession.mockResolvedValue(aliceSession);
    mocks.getPullRequest.mockResolvedValue(
      makeDetail({
        myRole: "admin",
        pull: { inlineComments: [pendingComment()] },
      }),
    );
    window.location.hash = "#/repos/alice-dev/acme-docs/pulls/1";

    render(
      <SessionProvider>
        <PullRequestDetailPage owner="alice-dev" name="acme-docs" number="1" />
      </SessionProvider>,
    );

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.queryByText("Pending draft comment")).toBeNull();
    expect(screen.queryByText("Pending review")).toBeNull();
  });
});
