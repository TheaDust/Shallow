import { cleanup, screen, within } from "@testing-library/react";import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALICE,
  BOB,
  CAROL,
  FEATURE_MAIN_ONLY,
  initialStub,
  installFetch,
  open,
  pullOf,
} from "./testing/pullRequestTestHarness";

/**
 * The Conversation and status actions of one pull request (REQ-6): Write,
 * Maintain and Admin comment and review, the author or a maintainer changes the
 * status, and merging is offered only while the base branch's protection rule is
 * satisfied. Every write is answered with the stored record, so the page shows
 * what a reload would read.
 */

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the conversation of a pull request", () => {
  it("stores a review decision that blocks merging", async () => {
    const stub = initialStub();
    stub.account = BOB;
    stub.role = "write";
    stub.rules.push({
      id: "rule-main",
      branchName: "main",
      requireApproval: true,
      requireStatusCheck: true,
      createdBy: "alice-dev",
      createdAt: "2024-03-01T09:00:00.000Z",
    });
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
    await screen.findByText("test: pending");

    // The review form is the one `Review changes` entry under the changed files:
    // an optional `Summary` and the three radio controls (REQ-6-3-4).
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Request changes" }));
    await user.type(screen.getByLabelText("Summary"), "The loader needs a guard.");
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    const summary = (await screen.findByRole("heading", { name: "Review summary" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(summary).getByText("bob-reviewer")).toBeTruthy();
    expect(within(summary).getByText("Changes requested")).toBeTruthy();
    expect(within(summary).getByText("The loader needs a guard.")).toBeTruthy();
    expect(screen.getByText("A reviewer requested changes.")).toBeTruthy();
    expect(screen.getByText("This pull request is unmergeable.")).toBeTruthy();
    expect(pullOf(stub, 2).reviews.at(-1)?.decision).toBe("request_changes");
    expect(pullOf(stub, 2).reviews.at(-1)?.body).toBe("The loader needs a guard.");
  });

  it("stores an ordinary comment and shows it after the next read", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByLabelText("Comment");

    await user.type(screen.getByLabelText("Comment"), "Looks good to me.");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByText("Looks good to me.")).toBeTruthy();
    expect(pullOf(stub, 2).comments.at(-1)?.body).toBe("Looks good to me.");

    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2");
    expect(await screen.findByText("Looks good to me.")).toBeTruthy();
  });

  it("offers no comment or review editor to a reader", async () => {
    const stub = initialStub();
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByText("test: pending");

    expect(screen.queryByLabelText("Comment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit review" })).toBeNull();

    await userEvent.setup().click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("heading", { name: "Changed files" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add comment" })).toBeNull();
  });
});

describe("the status of a pull request", () => {
  it("marks a draft ready for review, closes and reopens it", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    pullOf(stub, 2).status = "draft";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByText("test: pending");

    await user.click(screen.getByRole("button", { name: "Ready for review" }));
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(pullOf(stub, 2).status).toBe("open");

    await user.click(screen.getByRole("button", { name: "Close pull request" }));
    expect(await screen.findByText("Closed")).toBeTruthy();
    expect(pullOf(stub, 2).status).toBe("closed");

    await user.click(screen.getByRole("button", { name: "Reopen pull request" }));
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(pullOf(stub, 2).status).toBe("open");
  });

  it("enables merging only once the protected branch requirements are satisfied", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    stub.rules.push({
      id: "rule-main",
      branchName: "main",
      requireApproval: true,
      requireStatusCheck: true,
      createdBy: "alice-dev",
      createdAt: "2024-03-01T09:00:00.000Z",
    });
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByText("test: pending");

    // The check is still pending, so the merge entry stays disabled while the
    // pull request is still open.
    expect(
      (screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Close pull request" })).toBeTruthy();

    stub.checks.push({
      number: 2,
      commitId: FEATURE_MAIN_ONLY.id,
      status: "success",
      setBy: "alice-dev",
      setAt: "2024-03-07T09:00:00.000Z",
    });
    pullOf(stub, 2).reviews.push({
      id: "review-bob",
      reviewer: "bob-reviewer",
      decision: "approve",
      commitId: FEATURE_MAIN_ONLY.id,
      createdAt: "2024-03-07T09:30:00.000Z",
    });

    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByText("test: success");
    expect(screen.getByText("This pull request is mergeable.")).toBeTruthy();

    // The merge area offers `Create a merge commit` as the only method and
    // states the conditions the merge satisfies (REQ-6-5).
    const mergeArea = (await screen.findByRole("heading", { name: "Merge" })).closest(
      "section",
    ) as HTMLElement;
    const merge = within(mergeArea);
    expect((merge.getByRole("radio", { name: "Create a merge commit" }) as HTMLInputElement).checked).toBe(true);
    expect(merge.getAllByRole("radio")).toHaveLength(1);
    const approvalCondition = merge.getByText("1 approval").closest("li") as HTMLElement;
    expect(approvalCondition.textContent).toContain("satisfied");

    await user.click(merge.getByRole("button", { name: "Merge pull request" }));
    await user.click(merge.getByRole("button", { name: "Confirm merge" }));
    expect(await screen.findByText("Merged")).toBeTruthy();
    expect(pullOf(stub, 2).status).toBe("merged");
    // The stored result names the merger and the resulting merge commit.
    const result = (await screen.findByRole("heading", { name: "Merge" })).closest(
      "section",
    ) as HTMLElement;
    expect(result.textContent).toContain("alice-dev");
    expect(result.textContent).toContain(pullOf(stub, 2).mergeCommitId as string);
    // Merged is terminal: no status action or merge entry is offered any more.
    expect(screen.queryByRole("button", { name: "Merge pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
  });
});
