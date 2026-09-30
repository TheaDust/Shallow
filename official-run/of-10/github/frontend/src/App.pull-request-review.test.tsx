import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALICE,
  BOB,
  CAROL,
  initialStub,
  installFetch,
  open,
  pullOf,
  type Stub,
} from "./testing/pullRequestTestHarness";

/**
 * Inline review comments on changed code lines (REQ-6-3-3), the review form of
 * the Files changed view (REQ-6-3-4) and the Reviewers area of the detail page
 * (REQ-6-4). The seeded Open proposal `Fix search` belongs to `alice-dev`; the
 * non-author Write reviewer is `bob-reviewer`.
 */

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Opens the Files changed view of the seeded Open proposal as `bob-reviewer`. */
async function openChangedFiles(stub: Stub) {
  const user = userEvent.setup();
  open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
  await screen.findByRole("heading", { name: "Changed files" });
  return user;
}

describe("inline comments on changed lines (REQ-6-3-3)", () => {
  it("publishes a single comment under its own line and keeps it after reload", async () => {
    const stub = initialStub();
    stub.account = BOB;
    stub.role = "write";
    installFetch(stub);
    const user = await openChangedFiles(stub);

    // The first `Add comment` button in document order belongs to the first
    // commentable line: the added file `main-only.md`.
    await user.click(screen.getAllByRole("button", { name: "Add comment" })[0]);
    await user.type(screen.getByLabelText("Comment"), "This note needs a link.");
    await user.click(screen.getByRole("button", { name: "Add single comment" }));

    const stored = pullOf(stub, 2).inlineComments.at(-1);
    expect(stored?.path).toBe("main-only.md");
    expect(stored?.line).toBe(0);
    expect(stored?.body).toBe("This note needs a link.");
    expect(stored?.state).toBe("published");
    expect(stored?.commitId).toBe(pullOf(stub, 2).compareCommitId);

    // The diff view and the Conversation show the published comment.
    const diffComment = await screen.findByText("This note needs a link.");
    expect(diffComment).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(await screen.findByRole("heading", { name: "Review comments" })).toBeTruthy();
    expect(screen.getByText("This note needs a link.")).toBeTruthy();

    // A reload reads the same anchored comment.
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
    await screen.findByRole("heading", { name: "Changed files" });
    expect(await screen.findByText("This note needs a link.")).toBeTruthy();
  });

  it("stores nothing for an empty body", async () => {
    const stub = initialStub();
    stub.account = BOB;
    stub.role = "write";
    installFetch(stub);
    const user = await openChangedFiles(stub);

    await user.click(screen.getAllByRole("button", { name: "Add comment" })[0]);
    await user.click(screen.getByRole("button", { name: "Add single comment" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(pullOf(stub, 2).inlineComments).toEqual([]);
    expect(stub.writes.filter((write) => write.path.endsWith("inline-comments"))).toEqual([]);
  });

  it("keeps `Start a review` as a private draft until the review is submitted", async () => {
    const stub = initialStub();
    stub.account = BOB;
    stub.role = "write";
    installFetch(stub);
    const user = await openChangedFiles(stub);

    await user.click(screen.getAllByRole("button", { name: "Add comment" })[1]);
    await user.type(screen.getByLabelText("Comment"), "Please guard this branch.");
    await user.click(screen.getByRole("button", { name: "Start a review" }));

    // The draft shows `Pending review` to its own author at once.
    expect(await screen.findByText("Pending review", { exact: false })).toBeTruthy();
    expect(pullOf(stub, 2).inlineComments.at(-1)?.state).toBe("pending");

    // Another reader does not see the draft anywhere.
    stub.account = ALICE;
    stub.role = "admin";
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
    await screen.findByRole("heading", { name: "Changed files" });
    expect(screen.queryByText("Please guard this branch.")).toBeNull();

    // Submitting the review publishes it, and the author reads it afterwards.
    stub.account = BOB;
    stub.role = "write";
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
    await screen.findByRole("heading", { name: "Changed files" });
    expect(await screen.findByText("Please guard this branch.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Comment" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(pullOf(stub, 2).inlineComments.at(-1)?.state).toBe("published");
    expect(screen.queryByText("Pending review", { exact: false })).toBeNull();
  });

  it("offers the inline editor only to a non-author writer of an Open proposal", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    installFetch(stub);
    await openChangedFiles(stub);
    // The author of the proposal reviews nothing on it.
    expect(screen.queryByRole("button", { name: "Add comment" })).toBeNull();
  });
});

describe("the review form of the changed files (REQ-6-3-4)", () => {
  it("approves without a summary and keeps the decision after reload", async () => {
    const stub = initialStub();
    stub.account = BOB;
    stub.role = "write";
    installFetch(stub);
    const user = await openChangedFiles(stub);

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    const summary = (await screen.findByRole("heading", { name: "Review summary" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(summary).getByText("bob-reviewer")).toBeTruthy();
    expect(within(summary).getByText("Approved")).toBeTruthy();
    expect(pullOf(stub, 2).reviews.at(-1)?.decision).toBe("approve");

    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
    const reloaded = (await screen.findByRole("heading", { name: "Review summary" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(reloaded).getByText("Approved")).toBeTruthy();
  });

  it("shows Changes requested with the exact summary and keeps the author out", async () => {
    const stub = initialStub();
    stub.account = BOB;
    stub.role = "write";
    installFetch(stub);
    const user = await openChangedFiles(stub);

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Request changes" }));
    await user.type(screen.getByLabelText("Summary"), "Split the helper first.");
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    const summary = (await screen.findByRole("heading", { name: "Review summary" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(summary).getByText("Changes requested")).toBeTruthy();
    expect(within(summary).getByText("Split the helper first.")).toBeTruthy();

    // The author of the proposal gets no review form at all.
    stub.account = ALICE;
    stub.role = "admin";
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
    await screen.findByRole("heading", { name: "Changed files" });
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });
});

describe("the reviewers area (REQ-6-4)", () => {
  it("requests and removes one reviewer without a confirmation step", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByRole("heading", { name: "Fix search" });
    const area = screen.getByRole("region", { name: "Reviewers" });
    expect(within(area).getByText("No reviewers requested.")).toBeTruthy();

    await user.click(within(area).getByRole("button", { name: "Reviewers" }));
    await user.type(within(area).getByRole("textbox", { name: "Search" }), "bob");
    await user.click(await screen.findByRole("option", { name: "bob-reviewer" }));

    expect(pullOf(stub, 2).reviewerIds).toEqual(["account-bob-reviewer"]);
    expect(await within(area).findByText("bob-reviewer")).toBeTruthy();
    // The picker closed again and no separate save action was needed.
    expect(within(area).queryByRole("textbox", { name: "Search" })).toBeNull();

    // The request survives a reload; removing it needs no confirmation either.
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByRole("heading", { name: "Fix search" });
    const reloaded = screen.getByRole("region", { name: "Reviewers" });
    await user.click(within(reloaded).getByRole("button", { name: "Remove bob-reviewer" }));
    expect(pullOf(stub, 2).reviewerIds).toEqual([]);
    expect(await within(reloaded).findByText("No reviewers requested.")).toBeTruthy();

    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByRole("heading", { name: "Fix search" });
    expect(
      within(screen.getByRole("region", { name: "Reviewers" })).getByText(
        "No reviewers requested.",
      ),
    ).toBeTruthy();
  });

  it("offers no request or remove entry to a viewer who may not manage them", async () => {
    const stub = initialStub();
    // A signed-in reader of the public repository: not the author, no role.
    stub.account = CAROL;
    stub.role = null;
    pullOf(stub, 2).reviewerIds = [];
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByRole("heading", { name: "Fix search" });
    const area = screen.getByRole("region", { name: "Reviewers" });
    expect(within(area).queryByRole("button", { name: "Reviewers" })).toBeNull();

    // A requested reviewer is still displayed, but a non-manager removes nothing.
    pullOf(stub, 2).reviewerIds = ["account-bob-reviewer"];
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByRole("heading", { name: "Fix search" });
    const readable = screen.getByRole("region", { name: "Reviewers" });
    expect(within(readable).getByText("bob-reviewer")).toBeTruthy();
    expect(within(readable).queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();
  });
});
