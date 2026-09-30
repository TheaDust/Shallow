import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ApiError } from "./lib/api";
import { mergePullRequest } from "./lib/pull-requests-api";
import {
  ALICE,
  CAROL,
  FEATURE_MAIN_ONLY,
  initialStub,
  installFetch,
  pullOf,
  type Stub,
} from "./testing/pullRequestTestHarness";

/**
 * The merge area of one pull request (REQ-6-5). `Create a merge commit` is the
 * only selectable method; `Merge pull request` opens the confirmation of the same
 * page and `Confirm merge` merges. A blocked proposal keeps the same entry
 * visible but disabled and names the unmet protection requirement before any
 * click, and a merged proposal shows the stored merger, time and merge commit.
 */

function protectedMain(stub: Stub) {
  stub.rules.push({
    id: "rule-main",
    branchName: "main",
    requireApproval: true,
    requireStatusCheck: true,
    createdBy: "alice-dev",
    createdAt: "2024-02-20T16:00:00.000Z",
  });
}

/** The eligible merge seed: approval of the current compare commit and success. */
function eligible(stub: Stub) {
  protectedMain(stub);
  pullOf(stub, 2).reviews.push({
    id: "review-carol",
    reviewer: "carol-dev",
    decision: "approve",
    commitId: FEATURE_MAIN_ONLY.id,
    createdAt: "2024-02-28T09:05:00.000Z",
  });
  stub.checks.push({
    number: 2,
    commitId: FEATURE_MAIN_ONLY.id,
    status: "success",
    setBy: "alice-dev",
    setAt: "2024-02-28T09:30:00.000Z",
  });
}

function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("merging an eligible pull request (REQ-6-5)", () => {
  it("offers `Create a merge commit` as the only method and merges after the confirmation", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    eligible(stub);
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByText("test: success");

    const area = (await screen.findByRole("heading", { name: "Merge" })).closest(
      "section",
    ) as HTMLElement;
    const merge = within(area);
    expect(merge.getAllByRole("radio")).toHaveLength(1);
    const method = merge.getByRole("radio", { name: "Create a merge commit" }) as HTMLInputElement;
    expect(method.checked).toBe(true);
    expect(screen.getByText("This pull request is mergeable.")).toBeTruthy();

    // The area states every satisfied condition before the confirmation, and a
    // confirmation step is required before anything is written.
    for (const label of ["1 approval", "Require status check test", "No requested changes", "No merge conflicts"]) {
      const condition = merge.getByText(label).closest("li") as HTMLElement;
      expect(condition.textContent).toContain("satisfied");
    }
    expect(screen.queryByRole("button", { name: "Confirm merge" })).toBeNull();

    await user.click(merge.getByRole("button", { name: "Merge pull request" }));
    const confirmation = screen.getByRole("group", { name: "Merge confirmation" });
    await user.click(within(confirmation).getByRole("button", { name: "Confirm merge" }));

    // The page shows the merged record: status, merger and merge commit.
    expect(await screen.findByText("Merged")).toBeTruthy();
    const stored = pullOf(stub, 2);
    expect(stored.status).toBe("merged");
    expect(stored.mergedBy).toBe("alice-dev");
    const result = (await screen.findByRole("heading", { name: "Merge" })).closest(
      "section",
    ) as HTMLElement;
    expect(result.textContent).toContain("Merged by");
    expect(result.textContent).toContain("alice-dev");
    expect(result.textContent).toContain(stored.mergeCommitId as string);
    // Merged is terminal: no method, conditions or merge entry remain.
    expect(screen.queryByRole("button", { name: "Merge pull request" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();

    // A reload reads the same persisted result.
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2");
    expect(await screen.findByText("Merged")).toBeTruthy();
    expect(
      (
        (await screen.findByRole("heading", { name: "Merge" })).closest("section") as HTMLElement
      ).textContent,
    ).toContain(stored.mergeCommitId as string);
  });

  it("keeps a blocked merge visible, disabled and explained before any click", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    // The refusal seed: the same protected `main`, but the Open proposal of the
    // same comparison carries no valid non-author approval.
    protectedMain(stub);
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/4");
    await screen.findByText("test: pending");

    const mergeButton = screen.getByRole("button", { name: "Merge pull request" });
    expect((mergeButton as HTMLButtonElement).disabled).toBe(true);
    const area = (await screen.findByRole("heading", { name: "Merge" })).closest(
      "section",
    ) as HTMLElement;
    const merge = within(area);
    // The unmet protection requirement is stated once, without a click.
    expect(screen.getAllByText("Review required by branch protection")).toHaveLength(1);
    const approval = merge.getByText("1 approval").closest("li") as HTMLElement;
    expect(approval.textContent).toContain("unsatisfied");
    const check = merge.getByText("Require status check test").closest("li") as HTMLElement;
    expect(check.textContent).toContain("unsatisfied");
    expect(merge.getByText("No merge conflicts").closest("li")?.textContent).toContain(
      "satisfied",
    );

    // The check may be set, yet the missing approval still refuses the merge:
    // the disabled entry is backed by the server.
    await expect(mergePullRequest("alice-dev", "acme-docs", 4)).rejects.toBeInstanceOf(ApiError);
    expect(pullOf(stub, 4).status).toBe("open");
    void user;
  });

  it("hides the merge entry from a viewer without the merge permission", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    eligible(stub);
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByText("test: success");

    // Write may review but never merge (REQ-6-5); close/reopen stays available
    // for the author and maintainers only, so neither entry appears here.
    expect(screen.queryByRole("button", { name: "Merge pull request" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Create a merge commit" })).toBeNull();
    await expect(mergePullRequest("alice-dev", "acme-docs", 2)).rejects.toBeInstanceOf(ApiError);
    expect(pullOf(stub, 2).status).toBe("open");
  });

  it("keeps the merge entry of a draft present but disabled for a writer", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    protectedMain(stub);
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/3");
    await screen.findByRole("heading", { name: "Draft onboarding update" });

    expect(
      (screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const merge = within(
      (await screen.findByRole("heading", { name: "Merge" })).closest("section") as HTMLElement,
    );
    expect(merge.getByText("Proposal eligible").closest("li")?.textContent).toContain("unsatisfied");
  });
});
