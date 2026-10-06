import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Sign in to GitHub" });
  await user.type(screen.getByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

async function openPullRequests(user: ReturnType<typeof userEvent.setup>, repository: string) {
  await user.click(await screen.findByRole("link", { name: repository }));
  await screen.findByRole("heading", { name: new RegExp(repository) });
  await user.click(screen.getByRole("link", { name: "Pull requests" }));
  await screen.findByRole("heading", { name: "Pull requests" });
}

async function openComparison(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("link", { name: "New pull request" }));
  await screen.findByRole("heading", { name: "New pull request" });
}

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-6-2-1 list and filter repository pull requests", () => {
  it("opens the seeded Open pull request link into its exact detail heading", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPullRequests(user, "acme-docs");

    await user.click(screen.getByRole("link", { name: "Open" }));
    const link = await screen.findByRole("link", { name: "Improve onboarding" });
    expect(link.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/pulls/1");

    await user.click(link);
    expect((await screen.findByRole("heading", { name: "Improve onboarding" })).textContent).toBe(
      "Improve onboarding",
    );
    expect(screen.getByText("Open")).not.toBeNull();

    reload();
    expect((await screen.findByRole("heading", { name: "Improve onboarding" })).textContent).toBe(
      "Improve onboarding",
    );
  });

  it("keeps the exact pull request link after a reload and after returning from the home page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPullRequests(user, "acme-docs");
    await user.click(screen.getByRole("link", { name: "Open" }));
    const link = await screen.findByRole("link", { name: "Improve onboarding" });
    expect(link.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/pulls/1");

    reload();
    const afterReload = await screen.findByRole("link", { name: "Improve onboarding" });
    expect(afterReload.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/pulls/1");

    await user.click(screen.getByRole("link", { name: "Home" }));
    await screen.findByRole("heading", { name: "GitHub" });
    await openPullRequests(user, "acme-docs");
    await user.click(screen.getByRole("link", { name: "Open" }));

    expect(await screen.findByRole("link", { name: "Improve onboarding" })).not.toBeNull();
  });
});

describe("REQ-6-2-2 compare branches before opening a pull request", () => {
  it("compares feature-search into main and shows the changed file and commits", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-contributor");
    await openPullRequests(user, "acme-docs");
    await openComparison(user);

    await user.selectOptions(screen.getByLabelText("Base"), "main");
    await user.selectOptions(screen.getByLabelText("Compare"), "feature-search");
    await user.click(screen.getByRole("button", { name: "Compare changes" }));

    const files = await screen.findByRole("region", { name: "Changed files" });
    expect(within(files).getByText("src/search.ts")).not.toBeNull();
    const commits = screen.getByRole("region", { name: "Commits" });
    expect(within(commits).getByText("Refine the search result")).not.toBeNull();
  });

  it("reports no differences for main against main and disables creation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-contributor");
    await openPullRequests(user, "acme-docs");
    await openComparison(user);

    await user.selectOptions(screen.getByLabelText("Base"), "main");
    await user.selectOptions(screen.getByLabelText("Compare"), "main");

    expect(await screen.findByText(/there are no differences/)).not.toBeNull();
    const create = screen.getByRole("button", { name: "Create pull request" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });
});

describe("REQ-6-2-3 create a pull request from comparison results", () => {
  async function openCreationForm(user: ReturnType<typeof userEvent.setup>, repository: string) {
    await openPullRequests(user, repository);
    await openComparison(user);
    await user.selectOptions(screen.getByLabelText("Base"), "main");
    await user.selectOptions(screen.getByLabelText("Compare"), "feature-search");
    await user.click(screen.getByRole("button", { name: "Compare changes" }));
    await screen.findByRole("region", { name: "Changed files" });
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await screen.findByLabelText("Title");
  }

  it("creates an Open pull request whose exact title heading survives reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-contributor");
    await openCreationForm(user, "acme-docs");

    await user.type(screen.getByLabelText("Title"), "Refine repository search");
    await user.type(screen.getByLabelText("Description"), "Sharpens the stored helper.");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect((await screen.findByRole("heading", { name: "Refine repository search" })).textContent).toBe(
      "Refine repository search",
    );
    expect(screen.getByText("Open")).not.toBeNull();

    reload();
    expect((await screen.findByRole("heading", { name: "Refine repository search" })).textContent).toBe(
      "Refine repository search",
    );
    expect(screen.getByText("Sharpens the stored helper.")).not.toBeNull();
  });

  it("rejects a whitespace-only title and creates no pull request", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-contributor");
    await openCreationForm(user, "acme-docs");

    await user.type(screen.getByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(await screen.findByText("Title is required")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "New pull request" })).not.toBeNull();

    // The list still holds only the seeded proposals (#1-#13); the rejected
    // whitespace title created nothing.
    act(() => navigate("/repositories/acme-demo/acme-docs/pulls"));
    await screen.findByRole("heading", { name: "Pull requests" });
    expect(screen.getAllByRole("link", { name: /^#\d+$/ })).toHaveLength(13);
  });
});

describe("REQ-6-1 protect branches with review and status-check requirements", () => {
  it("lets the Admin create a rule that the Branches page keeps after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "protection-admin");
    await user.click(await screen.findByRole("link", { name: "branch-protection-demo" }));
    await screen.findByRole("heading", { name: /branch-protection-demo/ });
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    await user.click(screen.getByRole("link", { name: "Branches" }));
    await screen.findByRole("heading", { name: "Branches" });

    await user.click(screen.getByRole("button", { name: "Add branch protection rule" }));
    await user.type(await screen.findByLabelText("Branch name pattern"), "main");
    await user.click(screen.getByLabelText("Require 1 approval"));
    await user.click(screen.getByLabelText("Require status check test"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    const protection = await screen.findByRole("region", { name: "Branch protection" });
    expect(within(protection).getByRole("heading", { name: "main" })).not.toBeNull();
    expect(within(protection).getByText("1 approval")).not.toBeNull();
    expect(within(protection).getByText("Require status check test")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Branches" });
    const persisted = await screen.findByRole("region", { name: "Branch protection" });
    expect(within(persisted).getByRole("heading", { name: "main" })).not.toBeNull();
    expect(within(persisted).getByText("1 approval")).not.toBeNull();
    expect(within(persisted).getByText("Require status check test")).not.toBeNull();
  });

  it("offers no rule-creation control to a non-Administrator", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "protection-viewer");
    await user.click(await screen.findByRole("link", { name: "branch-protection-demo" }));
    await screen.findByRole("heading", { name: /branch-protection-demo/ });
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

    act(() => navigate("/repositories/acme-demo/branch-protection-demo/settings/branches"));
    await screen.findByRole("heading", { name: "Branches" });
    await screen.findByRole("region", { name: "Branch protection" });
    expect(screen.queryByRole("button", { name: "Add branch protection rule" })).toBeNull();
  });

  it("lets the Admin set the test check to success and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "protection-admin");
    await openPullRequests(user, "branch-protection-demo");

    await user.click(await screen.findByRole("link", { name: "Protection status onboarding PR" }));
    await screen.findByRole("heading", { name: "Protection status onboarding PR" });
    await user.click(screen.getByRole("link", { name: "Checks" }));

    const checks = await screen.findByRole("region", { name: "Checks" });
    expect(within(checks).getByText("test")).not.toBeNull();
    expect(within(checks).getByText("pending")).not.toBeNull();

    await user.selectOptions(within(checks).getByLabelText("test"), "success");
    await user.click(within(checks).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("success")).not.toBeNull();
    const saved = screen.getByRole("region", { name: "Checks" });
    expect(within(saved).getByText("success")).not.toBeNull();
    expect(within(saved).getByText("protection-admin")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Protection status onboarding PR" });
    await user.click(screen.getByRole("link", { name: "Checks" }));
    const again = await screen.findByRole("region", { name: "Checks" });
    expect(within(again).getByText("success")).not.toBeNull();
    expect(within(again).getByText("protection-admin")).not.toBeNull();
  });
});

describe("REQ-6-2-4 create a draft pull request", () => {
  async function openDraftComparison(user: ReturnType<typeof userEvent.setup>) {
    await openPullRequests(user, "acme-docs");
    await openComparison(user);
    await user.selectOptions(screen.getByLabelText("Base"), "main");
    await user.selectOptions(screen.getByLabelText("Compare"), "feature-search");
    await user.click(screen.getByRole("button", { name: "Compare changes" }));
    await screen.findByRole("region", { name: "Changed files" });
  }

  it("creates a Draft pull request whose Merge pull request control stays disabled", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-contributor");
    await openDraftComparison(user);

    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));
    await screen.findByLabelText("Title");
    await user.type(screen.getByLabelText("Title"), "Draft the repository search");
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));

    expect(
      (await screen.findByRole("heading", { name: "Draft the repository search" })).textContent,
    ).toBe("Draft the repository search");
    expect(screen.getByText("Draft")).not.toBeNull();
    const merge = screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
  });

  it("marks the seeded draft ready for review and keeps Open after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "draft-author");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Draft onboarding update" }));
    await screen.findByRole("heading", { name: "Draft onboarding update" });
    expect(screen.getByText("Draft")).not.toBeNull();
    expect(screen.getByText(/draft-feature → main/)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Ready for review" }));
    await screen.findByText("Open");
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getByText(/draft-feature → main/)).not.toBeNull();
    expect(screen.getByText(/ready for review/)).not.toBeNull();

    reload();
    expect(
      (await screen.findByRole("heading", { name: "Draft onboarding update" })).textContent,
    ).toBe("Draft onboarding update");
    expect(screen.getByText("Open")).not.toBeNull();
    expect(screen.queryByText("Draft")).toBeNull();
  });
});

describe("REQ-6-3-1 and REQ-6-3-2 read a public pull request", () => {
  it("keeps the exact title, commit information and changed files for a visitor", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Overview onboarding PR" }));
    expect(
      (await screen.findByRole("heading", { name: "Overview onboarding PR" })).textContent,
    ).toBe("Overview onboarding PR");

    await user.click(screen.getByRole("link", { name: "Commits" }));
    const commits = await screen.findByRole("region", { name: "Commits" });
    expect(within(commits).getByText("Add the overview notes")).not.toBeNull();

    reload();
    expect(
      (await screen.findByRole("heading", { name: "Overview onboarding PR" })).textContent,
    ).toBe("Overview onboarding PR");
    const reloadedCommits = await screen.findByRole("region", { name: "Commits" });
    expect(within(reloadedCommits).getByText("Add the overview notes")).not.toBeNull();
  });

  it("reopens the same pull request from the home page and shows its changed files", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Overview onboarding PR" }));
    await screen.findByRole("heading", { name: "Overview onboarding PR" });

    await user.click(screen.getByRole("link", { name: "Home" }));
    await screen.findByRole("heading", { name: "GitHub" });
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Overview onboarding PR" }));
    await screen.findByRole("heading", { name: "Overview onboarding PR" });
    await user.click(screen.getByRole("link", { name: "Files changed" }));

    const files = await screen.findByRole("region", { name: "Files changed" });
    expect(within(files).getByText("docs/overview.md")).not.toBeNull();
  });

  it("shows src/search.ts with an aggregate additions/deletions summary", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Public onboarding PR" }));
    await screen.findByRole("heading", { name: "Public onboarding PR" });
    await user.click(screen.getByRole("link", { name: "Files changed" }));

    const files = await screen.findByRole("region", { name: "Files changed" });
    expect(within(files).getByText("src/search.ts")).not.toBeNull();
    expect(within(files).getByText(/additions and/)).not.toBeNull();
  });
});

describe("REQ-6-3-3 add review comments to changed code lines", () => {
  async function openFirstComment(
    user: ReturnType<typeof userEvent.setup>,
    title: string,
  ) {
    await signIn(user, "pr-reviewer");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: title }));
    await screen.findByRole("heading", { name: title });
    await user.click(screen.getByRole("link", { name: "Files changed" }));
    await screen.findByRole("region", { name: "Files changed" });
    await user.click(screen.getAllByRole("button", { name: "Add comment" })[0]);
    await screen.findByLabelText("Comment");
  }

  it("publishes a line comment that stays visible after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openFirstComment(user, "Reviewable onboarding PR");

    await user.type(screen.getByLabelText("Comment"), "Please clarify this reviewed line.");
    await user.click(screen.getByRole("button", { name: "Add single comment" }));
    expect(await screen.findByText("Please clarify this reviewed line.")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Reviewable onboarding PR" });
    await screen.findByRole("region", { name: "Files changed" });
    expect(await screen.findByText("Please clarify this reviewed line.")).not.toBeNull();
  });

  it("stores a pending review comment with the Pending review text after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openFirstComment(user, "Pending review onboarding PR");

    await user.type(screen.getByLabelText("Comment"), "Hold this until the checks pass.");
    await user.click(screen.getByRole("button", { name: "Start a review" }));
    expect(await screen.findByText("Hold this until the checks pass.")).not.toBeNull();
    expect(screen.getByText("Pending review")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Pending review onboarding PR" });
    await screen.findByRole("region", { name: "Files changed" });
    expect(await screen.findByText("Hold this until the checks pass.")).not.toBeNull();
    expect(screen.getByText("Pending review")).not.toBeNull();
  });
});

describe("REQ-6-3-4 submit a pull request review", () => {
  async function openReviewForm(user: ReturnType<typeof userEvent.setup>, title: string) {
    await signIn(user, "pr-reviewer");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: title }));
    await screen.findByRole("heading", { name: title });
    await user.click(screen.getByRole("link", { name: "Files changed" }));
    await screen.findByRole("region", { name: "Files changed" });
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByRole("heading", { name: "Review changes" });
  }

  it("approves a pull request and shows the Approved status", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openReviewForm(user, "Reviewable onboarding PR");

    await user.click(screen.getByRole("radio", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    const reviews = await screen.findByRole("region", { name: "Reviews" });
    expect(within(reviews).getByText("Approved")).not.toBeNull();
    expect(within(reviews).getByText("pr-reviewer")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Reviewable onboarding PR" });
    await screen.findByRole("region", { name: "Files changed" });
    const persisted = await screen.findByRole("region", { name: "Reviews" });
    expect(within(persisted).getByText("Approved")).not.toBeNull();
  });

  it("requests changes and keeps the exact summary after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openReviewForm(user, "Change request onboarding PR");

    await user.type(screen.getByLabelText("Summary"), "Please tighten the onboarding wording.");
    await user.click(screen.getByRole("radio", { name: "Request changes" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    const reviews = await screen.findByRole("region", { name: "Reviews" });
    expect(within(reviews).getByText("Changes requested")).not.toBeNull();
    expect(within(reviews).getByText("Please tighten the onboarding wording.")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Change request onboarding PR" });
    await screen.findByRole("region", { name: "Files changed" });
    const persisted = await screen.findByRole("region", { name: "Reviews" });
    expect(within(persisted).getByText("Changes requested")).not.toBeNull();
    expect(within(persisted).getByText("Please tighten the onboarding wording.")).not.toBeNull();
  });
});

describe("REQ-6-4 request or remove pull request reviewers", () => {
  it("requests bob-reviewer, keeps it after reload and removes it again", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-author");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Reviewer request onboarding PR" }));
    await screen.findByRole("heading", { name: "Reviewer request onboarding PR" });

    await user.click(screen.getByRole("button", { name: "Reviewers" }));
    await screen.findByRole("heading", { name: "Reviewers" });
    await user.type(screen.getByRole("textbox", { name: "Search" }), "bob-reviewer");
    await user.click(await screen.findByRole("option", { name: "bob-reviewer" }));

    const reviewers = await screen.findByRole("region", { name: "Reviewers" });
    expect(within(reviewers).getByText("bob-reviewer")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Reviewer request onboarding PR" });
    const persisted = await screen.findByRole("region", { name: "Reviewers" });
    expect(within(persisted).getByText("bob-reviewer")).not.toBeNull();

    await user.click(within(persisted).getByRole("button", { name: "Remove bob-reviewer" }));
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Reviewers" })).queryByText("bob-reviewer")).toBeNull(),
    );

    reload();
    await screen.findByRole("heading", { name: "Reviewer request onboarding PR" });
    const afterRemoval = await screen.findByRole("region", { name: "Reviewers" });
    expect(within(afterRemoval).queryByText("bob-reviewer")).toBeNull();
  });
});

describe("REQ-6-5 merge an eligible pull request", () => {
  it("merges the eligible proposal with the only method and keeps Merged after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-maintainer");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Mergeable onboarding PR" }));
    await screen.findByRole("heading", { name: "Mergeable onboarding PR" });

    const methods = screen.getAllByRole("radio");
    expect(methods).toHaveLength(1);
    expect(methods[0].getAttribute("value")).toBe("merge");

    await user.click(screen.getByRole("button", { name: "Merge pull request" }));
    await screen.findByRole("heading", { name: "Merge pull request" });
    await user.click(screen.getByRole("button", { name: "Confirm merge" }));

    expect(await screen.findByText("Merged")).not.toBeNull();
    const merge = await screen.findByRole("region", { name: "Merge" });
    expect(within(merge).getByText("Merged by pr-maintainer")).not.toBeNull();
    expect(within(merge).getByText(/Merge commit/)).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Mergeable onboarding PR" });
    expect(await screen.findByText("Merged")).not.toBeNull();
    const persisted = await screen.findByRole("region", { name: "Merge" });
    expect(within(persisted).getByText("Merged by pr-maintainer")).not.toBeNull();
  });

  it("keeps the blocked proposal disabled with the protection explanation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-maintainer");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Blocked onboarding PR" }));
    await screen.findByRole("heading", { name: "Blocked onboarding PR" });

    const merge = await screen.findByRole("button", { name: "Merge pull request" }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    expect(await screen.findByText("Review required by branch protection")).not.toBeNull();
  });
});

describe("REQ-6-6 close or reopen a pull request without merging", () => {
  it("closes and reopens the authored proposal and keeps Close available after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-author");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Closable onboarding PR" }));
    await screen.findByRole("heading", { name: "Closable onboarding PR" });

    await user.click(screen.getByRole("button", { name: "Close pull request" }));
    expect(await screen.findByText("Closed")).not.toBeNull();

    await user.click(await screen.findByRole("button", { name: "Reopen pull request" }));
    expect(await screen.findByText("Open")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Closable onboarding PR" });
    expect(await screen.findByRole("button", { name: "Close pull request" })).not.toBeNull();
  });

  it("never offers close or reopen to a viewer without permission", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-viewer");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Protected onboarding PR" }));
    await screen.findByRole("heading", { name: "Protected onboarding PR" });

    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();
  });
});

describe("REQ-5-3-3 assign a pull request to a repository milestone", () => {
  it("sets the exact v1.0 milestone on the pull request and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-editor");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Improve onboarding" }));
    await screen.findByRole("heading", { name: "Improve onboarding" });

    expect(screen.getByText("No milestone")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Milestone" }));
    await user.click(await screen.findByRole("option", { name: "v1.0" }));

    expect(await screen.findByText("v1.0")).not.toBeNull();
    // The milestone shows up once: in the metadata it belongs to.
    expect(screen.getAllByText("v1.0")).toHaveLength(1);

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(await screen.findByText("v1.0")).not.toBeNull();
    expect(screen.getAllByText("v1.0")).toHaveLength(1);
  });

  it("keeps the saved milestone readable but offers no selector to a Read account", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "pr-viewer");
    await openPullRequests(user, "acme-docs");
    await user.click(await screen.findByRole("link", { name: "Overview onboarding PR" }));
    await screen.findByRole("heading", { name: "Overview onboarding PR" });

    expect(screen.getByText("No milestone")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
  });
});
