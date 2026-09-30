import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALICE,
  CAROL,
  DRAFT_FEATURE,
  initialStub,
  installFetch,
  open,
  pullOf,
} from "./testing/pullRequestTestHarness";

/**
 * The Draft pull requests of REQ-6-2-4. A visible draft comparison entry creates
 * a Draft proposal with the same persisted fields as a normal one, the detail
 * page shows the `Draft` marker with a present but disabled `Merge pull request`
 * entry, a draft accepts no review, and the author or a maintainer converts the
 * stored proposal to Open with `Ready for review` — the same number, title and
 * branches, with the transition kept in the activity timeline and on reload.
 */

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("creating a draft pull request (REQ-6-2-4)", () => {
  it("stores a Draft proposal from the draft comparison entry and shows it", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=release&compare=main");
    await screen.findByRole("heading", { name: "Commit summary" });

    // The visible draft entry opens the creation form, which carries the two
    // fields and exactly one submit button named after the creation.
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Create draft pull request" }).length).toBe(1);

    await user.type(screen.getByLabelText("Title"), "Draft onboarding guide");
    await user.type(screen.getByLabelText("Description"), "First pass for the guide.");
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));

    // The detail page of the stored proposal shows Draft, the two branches and
    // the merge entry as present but unusable.
    expect(
      await screen.findByRole("heading", { level: 1, name: "Draft onboarding guide" }),
    ).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("release", { selector: ".pull-detail__base" })).toBeTruthy();
    expect(screen.getByText("main", { selector: ".pull-detail__compare" })).toBeTruthy();
    expect(screen.getByText("First pass for the guide.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // The stored record of the same number keeps the persisted fields.
    const stored = pullOf(stub, 5);
    expect(stored.status).toBe("draft");
    expect(stored.title).toBe("Draft onboarding guide");
    expect(stored.baseBranch).toBe("release");
    expect(stored.compareBranch).toBe("main");
    expect(stub.writes[0].body).toEqual({
      base: "release",
      compare: "main",
      title: "Draft onboarding guide",
      description: "First pass for the guide.",
      draft: true,
    });

    // A reload of the detail page and the list read the same Draft record.
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/5");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Draft onboarding guide" }),
    ).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls");
    const row = (await screen.findByRole("link", { name: "Draft onboarding guide" })).closest("li");
    expect(within(row as HTMLElement).getByText("Draft")).toBeTruthy();
  });

  it("creates no record when the comparison is refused", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    // The pair of the seeded `Fix search` proposal is already taken.
    open("#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));
    await user.type(screen.getByLabelText("Title"), "Draft duplicate");
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));

    expect(
      await screen.findByText("A pull request already exists for these branches"),
    ).toBeTruthy();
    expect(stub.pulls.length).toBe(4);
    expect(screen.queryByRole("heading", { level: 1, name: "Draft duplicate" })).toBeNull();
  });
});

describe("the dedicated ready-for-review seed draft (REQ-6-2-4)", () => {
  it("shows the stored title, branches and no review to its author", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/3");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Draft onboarding update" }),
    ).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getByText("main", { selector: ".pull-detail__base" })).toBeTruthy();
    expect(screen.getByText("draft-feature", { selector: ".pull-detail__compare" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ready for review" })).toBeTruthy();

    // The comparable commit and changed file come from the compare branch, and
    // nothing was submitted for this proposal yet: a Draft accepts no review.
    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByText("Draft the onboarding update")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("link", { name: "README.md" })).toBeTruthy();
    // A Draft accepts no review decision and no inline code comment: the Files
    // changed view offers neither entry to its author.
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add comment" })).toBeNull();
    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(await screen.findByText("No reviews yet.")).toBeTruthy();
  });

  it("converts the same proposal to Open for its author and keeps it on reload", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/3");
    await screen.findByText("Draft");
    await user.click(screen.getByRole("button", { name: "Ready for review" }));

    // The Draft marker disappears, the title and branches stay and the activity
    // timeline records the transition.
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Draft onboarding update" }),
    ).toBeTruthy();
    expect(screen.getByText("main", { selector: ".pull-detail__base" })).toBeTruthy();
    expect(screen.getByText("draft-feature", { selector: ".pull-detail__compare" })).toBeTruthy();
    expect(screen.getByText(/marked this pull request as Ready for review/)).toBeTruthy();

    const stored = pullOf(stub, 3);
    expect(stored.status).toBe("open");
    expect(stored.title).toBe("Draft onboarding update");
    expect(stored.compareBranch).toBe("draft-feature");

    // Open survives the reload, and so does the recorded activity.
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/3");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Draft onboarding update" }),
    ).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getByText(/marked this pull request as Ready for review/)).toBeTruthy();
  });

  it("offers the transition to a maintainer and hides it from a reader", async () => {
    const asMaintainer = initialStub();
    asMaintainer.account = ALICE;
    asMaintainer.role = "maintain";
    installFetch(asMaintainer);

    open("#/repos/alice-dev/acme-docs/pulls/3");
    expect(await screen.findByText("Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ready for review" })).toBeTruthy();

    // A visitor of the public repository reads the draft but changes nothing.
    cleanup();
    vi.unstubAllGlobals();
    const visitor = initialStub();
    installFetch(visitor);
    open("#/repos/alice-dev/acme-docs/pulls/3");
    expect(await screen.findByText("Draft")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Merge pull request" })).toBeNull();
    expect(visitor.writes).toEqual([]);
  });

  it("reads the check of the draft's current compare commit", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/3");
    await screen.findByText("Draft");

    expect(pullOf(stub, 3).compareCommitId).toBe(DRAFT_FEATURE.id);
    expect(screen.getByText("test: pending")).toBeTruthy();
  });
});
