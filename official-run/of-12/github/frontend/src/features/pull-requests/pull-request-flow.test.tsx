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

function acmeDocs() {
  return server.state.repositories.find((repository) => repository.name === "acme-docs")!;
}

async function openBranchesSettings() {
  render(<App />);
  return screen.findByRole("button", { name: "Add branch protection rule" });
}

async function createRuleForMain() {
  await userEvent.click(await openBranchesSettings());
  await userEvent.type(screen.getByRole("textbox", { name: "Branch name pattern" }), "main");
  await userEvent.click(screen.getByRole("checkbox", { name: "Require 1 approval" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Require status check test" }));
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Create" })).toBeNull());
}

/** The stored rules of the branch protection area, as the page spells them. */
async function protectionArea() {
  return within(await screen.findByRole("region", { name: "Branch protection" }));
}

describe("REQ-6-1 branch protection rules on the Branches settings page", () => {
  it("lets the Admin create one rule with both requirements and keeps it after a reload", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/settings/branches");
    render(<App />);

    const add = await screen.findByRole("button", { name: "Add branch protection rule" });
    // The rule form opens from the button and is not rendered before.
    expect(screen.queryByRole("textbox", { name: "Branch name pattern" })).toBeNull();
    await userEvent.click(add);
    await userEvent.type(screen.getByRole("textbox", { name: "Branch name pattern" }), "main");
    await userEvent.click(screen.getByRole("checkbox", { name: "Require 1 approval" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Require status check test" }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    // The settings page spells the branch name verbatim with both summaries.
    const area = await protectionArea();
    expect(area.getByText("main")).toBeTruthy();
    expect(area.getByText("1 approval")).toBeTruthy();
    expect(area.getByText("Require status check test")).toBeTruthy();
    expect(acmeDocs().protectionRules).toEqual([
      { id: "rule-1", pattern: "main", requireApproval: true, requireStatusCheck: true },
    ]);

    reload();
    const reloaded = await protectionArea();
    expect(reloaded.getByText("main")).toBeTruthy();
    expect(reloaded.getByText("1 approval")).toBeTruthy();
    expect(reloaded.getByText("Require status check test")).toBeTruthy();
  });

  it("uses Save changes for the branch name that already carries a rule", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/settings/branches");
    await createRuleForMain();

    await userEvent.click(screen.getByRole("button", { name: "Add branch protection rule" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Branch name pattern" }), "main");
    // The stored toggles are shown and the submit updates the existing rule.
    expect((screen.getByRole("checkbox", { name: "Require 1 approval" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();

    await userEvent.click(screen.getByRole("checkbox", { name: "Require status check test" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(acmeDocs().protectionRules.length).toBe(1));
    expect(acmeDocs().protectionRules[0]).toEqual({
      id: "rule-1",
      pattern: "main",
      requireApproval: true,
      requireStatusCheck: false,
    });
  });

  it("offers no rule entry to a signed-in user without repository administration", async () => {
    reset("bob-reviewer", "#/alice-dev/acme-docs/settings/branches");
    render(<App />);

    // The page itself stays readable for the non-Admin.
    expect(await screen.findByRole("heading", { name: "Branches", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add branch protection rule" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Branch name pattern" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Require 1 approval" })).toBeNull();
  });
});

describe("REQ-6-2-1 pull requests list page", () => {
  it("lists the seeded rows of the public repository to a visitor and opens one by its title", async () => {
    reset("visitor", "#/alice-dev/acme-docs/pulls");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Pull requests", level: 2 })).toBeTruthy();
    const titleLink = await screen.findByRole("link", { name: "Improve onboarding" });
    expect(titleLink.getAttribute("href")).toBe("#/alice-dev/acme-docs/pulls/1");
    expect(screen.getByRole("link", { name: "#1" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fix search" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Draft onboarding update" })).toBeTruthy();
    // Every row spells its source and target branch.
    expect(screen.getByText("into main from onboarding-docs")).toBeTruthy();
    expect(screen.getByText("into main from feature-search")).toBeTruthy();
    expect(screen.getByText("into main from draft-feature")).toBeTruthy();
    // The status filter is a set of links; a visitor gets no creation entry.
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Draft" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();

    // Opening the title shows the same title as a heading.
    await userEvent.click(titleLink);
    expect(await screen.findByRole("heading", { name: "Improve onboarding", level: 1 })).toBeTruthy();
  });

  it("filters by status and author, keeps the filter after a reload and writes nothing", async () => {
    reset("visitor", "#/alice-dev/acme-docs/pulls");
    render(<App />);
    await screen.findByRole("link", { name: "Improve onboarding" });
    const before = JSON.stringify(acmeDocs().pullRequests);

    await userEvent.click(screen.getByRole("link", { name: "Open" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Author" }), "alice-dev");
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/pulls?status=open&author=alice-dev");
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Draft onboarding update" })).toBeNull();

    // Reloading the filtered list keeps the same rows.
    reload();
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();

    // Switching to Closed drops the Open pull request.
    await userEvent.click(screen.getByRole("link", { name: "Closed" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull());
    expect(screen.getByRole("link", { name: "Fix search" })).toBeTruthy();

    // Filtering never changes a pull request, a branch or a review.
    expect(JSON.stringify(acmeDocs().pullRequests)).toBe(before);
  });

  it("filters by review status and reopens the same Open pull request from the list", async () => {
    reset("visitor", "#/alice-dev/acme-docs/pulls");
    render(<App />);
    await screen.findByRole("link", { name: "Improve onboarding" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Review status" }), "changes_requested");
    expect(await screen.findByText("No pull requests match your filters.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Review status" }), "");
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();

    // Leaving the page and selecting Open again shows the same pull request.
    await userEvent.click(screen.getByRole("link", { name: "Code" }));
    await userEvent.click(screen.getByRole("link", { name: "Pull requests" }));
    await userEvent.click(await screen.findByRole("link", { name: "Open" }));
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
  });
});

describe("REQ-6-2-2 and REQ-6-2-3 compare branches and create a pull request", () => {
  it("compares two branches, shows no changes for the same branch and creates the pull request", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/pulls");
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "New pull request" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/pulls/new");

    const base = (await screen.findByRole("combobox", { name: "base" })) as HTMLSelectElement;
    const compare = screen.getByRole("combobox", { name: "compare" }) as HTMLSelectElement;
    expect(Array.from(base.options).map((option) => option.textContent)).toContain("main");
    await userEvent.selectOptions(base, "main");
    await userEvent.selectOptions(compare, "feature-search");
    await userEvent.click(screen.getByRole("button", { name: "Compare changes" }));

    // A valid comparison spells the comparable commit, the changed file and an
    // enabled creation entry.
    expect(await screen.findByRole("heading", { name: "src/search.ts", level: 3 })).toBeTruthy();
    expect(screen.getByText("Commit summary")).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
    const create = (await screen.findByRole("button", { name: "Create pull request" })) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    expect(acmeDocs().pullRequests).toHaveLength(5);

    // Selecting the same branch on both sides explains the empty comparison and
    // disables the creation entry without pressing “Compare changes”.
    await userEvent.selectOptions(compare, "main");
    expect(await screen.findByText("No changes")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create pull request" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("heading", { name: "src/search.ts", level: 3 })).toBeNull();

    // Back to a valid comparison and create the pull request.
    await userEvent.selectOptions(compare, "feature-search");
    await userEvent.click(await screen.findByRole("button", { name: "Create pull request" }));
    await userEvent.type(await screen.findByLabelText("Title"), "Document the search flow");
    await userEvent.type(screen.getByLabelText("Description"), "Explain the search flow.");
    await userEvent.click(screen.getByRole("button", { name: "Create pull request" }));

    // The stored pull request is opened by its own detail address.
    expect(await screen.findByRole("heading", { level: 1, name: "Document the search flow" })).toBeTruthy();
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/pulls/6");
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Explain the search flow.")).toBeTruthy();
    expect(acmeDocs().pullRequests).toHaveLength(6);

    reload();
    expect(await screen.findByRole("heading", { level: 1, name: "Document the search flow" })).toBeTruthy();
    expect(screen.getByText("Explain the search flow.")).toBeTruthy();
  });

  it("rejects a blank title without storing a pull request", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Create pull request" }));
    await userEvent.type(await screen.findByLabelText("Title"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(acmeDocs().pullRequests).toHaveLength(5);
  });

  it("keeps the comparison out of the reach of a caller without write permission", async () => {
    reset("dana-observer", "#/alice-dev/acme-docs/pulls/new");
    render(<App />);

    expect(
      await screen.findByText("You do not have permission to create a pull request in this repository."),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "base" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create pull request" })).toBeNull();
  });
});

describe("REQ-6-2-4 draft pull requests", () => {
  it("creates a draft with a disabled merge entry and keeps it after a reload", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/pulls/new?base=main&compare=feature-search");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Create draft pull request" }));
    await userEvent.type(await screen.findByLabelText("Title"), "Draft the search flow");
    await userEvent.click(screen.getByRole("button", { name: "Create draft pull request" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Draft the search flow" })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    const merge = (await screen.findByRole("button", { name: "Merge pull request" })) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    // The list shows the draft status too.
    reload();
    expect(await screen.findByText("Draft")).toBeTruthy();

    cleanup();
    window.location.hash = "#/alice-dev/acme-docs/pulls";
    render(<App />);
    expect(await screen.findByRole("link", { name: "Draft the search flow" })).toBeTruthy();
  });

  it("moves the ready-for-review seed pull request from Draft to Open for its author", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/pulls/3");
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Draft onboarding update" })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    const article = screen.getByRole("article", { name: "Pull request 3" });
    expect(within(article).getByText("main")).toBeTruthy();
    expect(within(article).getByText("draft-feature")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Ready for review" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByText("Open")).toBeTruthy());
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();
    // The transition appends an activity and changes nothing else.
    expect(screen.getByText("marked this pull request as Ready for review")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Draft onboarding update" })).toBeTruthy();
    const stored = acmeDocs().pullRequests.find((pullRequest) => pullRequest.number === 3)!;
    expect(stored.status).toBe("open");
    expect(stored.compareBranch).toBe("draft-feature");

    reload();
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("offers no ready-for-review entry on an Open pull request or to a foreign account", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/pulls/1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Improve onboarding" });
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();

    reset("bob-reviewer", "#/alice-dev/acme-docs/pulls/3");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Draft onboarding update" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();
  });
});

describe("REQ-6-1 checks area of a pull request", () => {
  it("shows test: pending on arrival and stores success with its setter for the Admin", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/pulls/1");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Improve onboarding", level: 1 })).toBeTruthy();
    // The Checks area is available on arrival, before any section is opened.
    expect(await screen.findByText("test: pending")).toBeTruthy();
    // Every navigation name is unique on this page.
    expect(screen.getAllByRole("link", { name: "Commits" }).length).toBe(1);

    const status = screen.getByRole("combobox", { name: "test status" }) as HTMLSelectElement;
    await userEvent.selectOptions(status, "success");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("test: success")).toBeTruthy();
    expect(screen.getByText(/Set by alice-dev at/)).toBeTruthy();

    reload();
    expect(await screen.findByText("test: success")).toBeTruthy();
    expect(screen.getByText(/Set by alice-dev at/)).toBeTruthy();
  });

  it("shows the stored status without a control to a viewer who is not an Admin", async () => {
    reset("bob-reviewer", "#/alice-dev/acme-docs/pulls/1");
    render(<App />);

    expect(await screen.findByText("test: pending")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "test status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows the pull request as unmergeable once the base branch rule applies", async () => {
    reset("alice-dev", "#/alice-dev/acme-docs/pulls/1");
    render(<App />);
    expect(await screen.findByText("This pull request is mergeable.")).toBeTruthy();

    cleanup();
    window.location.hash = "#/alice-dev/acme-docs/settings/branches";
    await createRuleForMain();

    cleanup();
    window.location.hash = "#/alice-dev/acme-docs/pulls/1";
    render(<App />);
    expect(await screen.findByText("This pull request is unmergeable.")).toBeTruthy();
    expect(
      screen.getByText("Review required by branch protection"),
    ).toBeTruthy();
    expect(
      screen.getByText("The required check test is pending."),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the Commits and Files changed sections of the pull request", async () => {
    reset("visitor", "#/alice-dev/acme-docs/pulls/1");
    render(<App />);
    await screen.findByText("test: pending");

    await userEvent.click(screen.getByRole("link", { name: "Commits" }));
    expect(window.location.hash).toBe("#/alice-dev/acme-docs/pulls/1?tab=commits");
    expect(await screen.findByRole("link", { name: "Draft the onboarding notes" })).toBeTruthy();

    await userEvent.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("heading", { name: "docs/onboarding.md", level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "src/search.ts", level: 3 })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Pull request files changed" })).toBeTruthy();
  });
});
