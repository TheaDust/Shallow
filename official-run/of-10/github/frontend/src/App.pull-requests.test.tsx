import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALICE,
  CAROL,
  FEATURE_MAIN_ONLY,
  initialStub,
  installFetch,
  open,
} from "./testing/pullRequestTestHarness";

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Pull requests list", () => {
  it("shows every stored pull request of the repository to a visitor", async () => {
    const stub = initialStub();
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls");

    expect(await screen.findByRole("heading", { name: "Pull requests" })).toBeTruthy();
    const openRow = (await screen.findByRole("link", { name: "Fix search" })).closest("li");
    expect(openRow).not.toBeNull();
    const row = within(openRow as HTMLElement);
    expect(row.getByText("#2")).toBeTruthy();
    expect(row.getByText("Open")).toBeTruthy();
    expect(row.getByText("alice-dev")).toBeTruthy();
    expect(row.getByText("feature-search")).toBeTruthy();
    expect(row.getByText("main")).toBeTruthy();

    const closedRow = screen.getByRole("link", { name: "Improve onboarding" }).closest("li");
    expect(within(closedRow as HTMLElement).getByText("Closed")).toBeTruthy();

    // A visitor may not enter the creation flow.
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();
  });

  it("filters by the Open and Closed status links without changing the records", async () => {
    const stub = initialStub();
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls");
    await screen.findByRole("link", { name: "Fix search" });

    await user.click(screen.getByRole("link", { name: "Open" }));
    expect(await screen.findByRole("link", { name: "Fix search" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect(window.location.hash).toContain("state=open");

    await user.click(screen.getByRole("link", { name: "Closed" }));
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();

    // Filtering reads the stored records and never writes one.
    expect(stub.writes).toEqual([]);
    expect(stub.pulls.map((pull) => pull.status)).toEqual(["open", "draft", "open", "closed"]);
  });

  it("keeps the filtered Open row after a reload of the address", async () => {
    const stub = initialStub();
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls?state=open");
    expect(await screen.findByRole("link", { name: "Fix search" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();

    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls?state=open");
    expect(await screen.findByRole("link", { name: "Fix search" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
  });

  it("offers New pull request to a writer only", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls");
    const link = await screen.findByRole("link", { name: "New pull request" });
    expect(link.getAttribute("href")).toContain("/pulls/new");
  });

  it("opens one pull request from its title link", async () => {
    const stub = initialStub();
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls");
    await user.click(await screen.findByRole("link", { name: "Fix search" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();
  });
});

describe("the pull request detail page", () => {
  it("shows the title, status, sections and the pending check of the current commit", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/2");

    expect(await screen.findByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("The helper looks right; please add a check for the loader.")).toBeTruthy();
    for (const name of ["Conversation", "Commits", "Files changed", "Checks"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    // The Checks area is available on arrival and reads the pending result.
    expect(screen.getByText("test: pending")).toBeTruthy();
  });

  it("stores the test result with its setter and time for the current compare commit", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByText("test: pending");

    await user.click(screen.getByRole("combobox", { name: "test status" }));
    await user.click(screen.getByRole("option", { name: "success" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("test: success")).toBeTruthy();
    const checks = screen.getByRole("heading", { name: "Checks" }).closest("section");
    expect(within(checks as HTMLElement).getByText("alice-dev")).toBeTruthy();
    expect(within(checks as HTMLElement).getByText("2024-03-05 12:00")).toBeTruthy();

    // The stored record is read again by a reload of the detail page.
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2");
    expect(await screen.findByText("test: success")).toBeTruthy();
  });

  it("offers the test status control to an admin only", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/2");
    expect(await screen.findByText("test: pending")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "test status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows the comparable commits and the changed files of the two branches", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByText("test: pending");

    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("link", { name: "Add main-only notes" })).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByText("Changed files")).toBeTruthy();
  });

  it("marks a pull request without the required approval as unmergeable", async () => {
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

    open("#/repos/alice-dev/acme-docs/pulls/2");
    expect(await screen.findByText("This pull request is unmergeable.")).toBeTruthy();
    // The blocked merge names the unmet protection requirement and keeps the
    // merge entry visible but disabled (REQ-6-5).
    expect(screen.getByText("Review required by branch protection")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("the comparison before creation", () => {
  it("derives the commits, changed files and diff summary from the two branches", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search");

    expect(await screen.findByRole("heading", { name: "New pull request" })).toBeTruthy();
    const base = screen.getByRole("combobox", { name: "base" });
    const compare = screen.getByRole("combobox", { name: "compare" });
    expect(within(base).getByRole("option", { name: "main" })).toBeTruthy();
    expect(within(base).getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(within(base).getByRole("option", { name: "release" })).toBeTruthy();
    expect((base as HTMLSelectElement).value).toBe("main");
    expect((compare as HTMLSelectElement).value).toBe("feature-search");

    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByText(/Base branch:/)).toBeTruthy();

    const create = screen.getByRole("button", { name: "Create pull request" });
    expect((create as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Compare changes" })).toBeTruthy();
  });

  it("shows No changes and disables creation as soon as both branches are the same", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.selectOptions(screen.getByRole("combobox", { name: "compare" }), "main");

    expect(await screen.findByText("No changes")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create pull request" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Create draft pull request" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps the comparison when Compare changes is pressed", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.click(screen.getByRole("button", { name: "Compare changes" }));

    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Create pull request" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(stub.writes).toEqual([]);
  });

  it("does not offer the creation flow to a reader", async () => {
    const stub = initialStub();
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search");

    expect(
      await screen.findByText(
        "You need write permission to compare branches and open a pull request in this repository.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "base" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create pull request" })).toBeNull();
  });

  it("creates the pull request from the form and opens its detail page", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=release&compare=main");
    await screen.findByRole("heading", { name: "Commit summary" });

    // The comparison-page entry opens the creation form and is no longer an
    // active creation button of its own.
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    expect(screen.getAllByRole("button", { name: "Create pull request" }).length).toBe(1);
    await user.type(screen.getByLabelText("Title"), "Add the search loader");
    await user.type(screen.getByLabelText("Description"), "Brings the loader into main.");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Add the search loader" }),
    ).toBeTruthy();
    expect(window.location.hash).toContain("/pulls/5");
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("alice-dev", { selector: ".pull-detail__author" })).toBeTruthy();
    expect(screen.getByText("Brings the loader into main.")).toBeTruthy();
    expect(stub.pulls.length).toBe(5);
    expect(stub.writes[0].body).toEqual({
      base: "release",
      compare: "main",
      title: "Add the search loader",
      description: "Brings the loader into main.",
    });

    // The stored proposal is read back by a reload of its address.
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/5");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Add the search loader" }),
    ).toBeTruthy();
  });

  it("trims the surrounding whitespace of the stored title", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=release&compare=main");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.type(screen.getByLabelText("Title"), "  Search loader follow-up  ");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Search loader follow-up" }),
    ).toBeTruthy();
    expect(stub.pulls[0].title).toBe("Search loader follow-up");
  });

  it("rejects a title of only spaces and creates no pull request", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=release&compare=main");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.type(screen.getByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(stub.writes).toEqual([]);
    expect(stub.pulls.length).toBe(4);
    expect(window.location.hash).toContain("/pulls/new");
  });

  it("rejects an overlong title and creates no pull request", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=release&compare=main");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.click(screen.getByLabelText("Title"));
    await user.paste("t".repeat(257));
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(await screen.findByText("Title is too long (256 characters maximum)")).toBeTruthy();
    expect(stub.writes).toEqual([]);
    expect(stub.pulls.length).toBe(4);
  });

  it("creates a draft when the creation form is opened from the draft entry", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=release&compare=main");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));
    expect(screen.getAllByRole("button", { name: "Create draft pull request" }).length).toBe(1);
    await user.type(screen.getByLabelText("Title"), "Draft search loader");
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Draft search loader" }),
    ).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(stub.pulls[0].status).toBe("draft");
  });

  it("closes the creation form without creating anything", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=release&compare=main");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Title")).toBeNull();
    expect((screen.getByRole("button", { name: "Create pull request" }) as HTMLButtonElement).disabled).toBe(false);
    expect(stub.writes).toEqual([]);
  });

  it("reports the reason of a refused creation and keeps the comparison", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "write";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search");
    await screen.findByRole("heading", { name: "Commit summary" });

    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.type(screen.getByLabelText("Title"), "Duplicate pair");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(
      await screen.findByText("A pull request already exists for these branches"),
    ).toBeTruthy();
    expect(stub.pulls.length).toBe(4);
    expect(screen.getByRole("heading", { name: "Commit summary" })).toBeTruthy();
  });
});

