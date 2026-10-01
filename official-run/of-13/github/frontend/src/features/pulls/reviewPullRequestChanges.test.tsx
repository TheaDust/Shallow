import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  PULL_OWNER,
  PULL_REVIEWER,
  PULLS_SEED_ORGANIZATION,
} from "../../test-support/pull-fixtures";

const PULL_ADDRESS = "#/repositories/acme-demo/acme-docs/pulls/1";
const COMMITS_ADDRESS = `${PULL_ADDRESS}/commits`;
const FILES_ADDRESS = `${PULL_ADDRESS}/files`;

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again, like a reload of the same address. */
function reload() {
  cleanup();
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  if (screen.queryByRole("link", { name: "Sign in" }) === null) {
    window.location.hash = "#/";
    await screen.findByRole("link", { name: "Sign in" });
  }
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

async function signOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("link", { name: "Sign out" }));
  await user.click(await screen.findByRole("button", { name: "Confirm sign out" }));
  await screen.findByRole("link", { name: "Sign in" });
}

/** The expandable diff block of one changed file. */
function fileBlock(path: string): HTMLElement {
  const summary = screen.getByText(path);
  const block = summary.closest("details");
  if (block === null) throw new Error(`no diff block for ${path}`);
  return block as HTMLElement;
}

/** The first `Add comment` button in document order, as the requirement names it. */
function firstAddCommentButton(): HTMLButtonElement {
  return screen.getAllByRole("button", { name: "Add comment" })[0] as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

function installSeed() {
  installAuthStub({
    accounts: [PULL_OWNER, PULL_REVIEWER],
    organizations: [PULLS_SEED_ORGANIZATION],
  });
}

describe("REQ-6-3-1 view the pull request overview and commits", () => {
  it("a visitor reads Conversation, Commits and Files changed of the same pull request", async () => {
    installSeed();
    renderApp(PULL_ADDRESS);

    // The heading is the stored title and the status is visible text.
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("release → main")).toBeTruthy();

    // Conversation holds the description and the seeded discussion comment.
    expect(screen.getByText("Document the onboarding improvement.")).toBeTruthy();
    const discussion = screen
      .getByText("The onboarding steps read well; the search example still needs a second pass.")
      .closest("li") as HTMLElement;
    expect(within(discussion).getByText("bob-reviewer")).toBeTruthy();

    // The three sections are navigation links of the same pull request.
    for (const label of ["Conversation", "Commits", "Files changed", "Checks"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByText("1 commit on release")).toBeTruthy();
    expect(screen.getByText("Prepare release")).toBeTruthy();
    expect(window.location.hash).toBe(COMMITS_ADDRESS);

    await user.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("heading", { name: "Changed files summary" })).toBeTruthy();
    expect(screen.getByText("src/search.ts")).toBeTruthy();

    // A reload of the tab keeps the heading, the links and the values.
    const address = window.location.hash;
    reload();
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conversation" })).toBeTruthy();
    expect(screen.getByText("src/search.ts")).toBeTruthy();
    expect(window.location.hash).toBe(address);
  });

  it("the Commits and Files changed links of the detail page keep the same pull request", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp(PULL_ADDRESS);
    await screen.findByRole("heading", { name: "Improve onboarding" });

    await user.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("heading", { name: "Changed files summary" })).toBeTruthy();
    expect(screen.getByText("release → main")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(await screen.findByText("Document the onboarding improvement.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Changed files summary" })).toBeNull();
  });
});

describe("REQ-6-3-2 inspect the changed files and the aggregate diff", () => {
  it("a visitor adjusts the files, the line counts and defines no comment entry", async () => {
    installSeed();
    renderApp(FILES_ADDRESS);

    expect(await screen.findByRole("heading", { name: "Changed files summary" })).toBeTruthy();
    expect(screen.getByText("2 changed files")).toBeTruthy();
    expect(screen.getByText("3 additions, 1 deletions")).toBeTruthy();

    // Only the changed files are listed, with their added and deleted lines.
    const search = fileBlock("src/search.ts");
    expect(within(search).getByText("modified")).toBeTruthy();
    expect(within(search).getByText("+2 -1")).toBeTruthy();
    expect(within(search).getByText("const trimmed = query.trim();")).toBeTruthy();
    expect(within(search).getByText("return query.trim().length === 0 ? [] : [query.trim()];")).toBeTruthy();

    const release = fileBlock("RELEASE.md");
    expect(within(release).getByText("added")).toBeTruthy();

    // A viewer without Write permission reads the diff but gets no comment
    // affordance and no review entry.
    expect(screen.queryByRole("button", { name: "Add comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });
});

describe("REQ-6-3-3 add review comments to changed code lines", () => {
  it("a Write reviewer publishes an inline comment on a changed line", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = FILES_ADDRESS;

    expect(await screen.findByRole("heading", { name: "Changed files summary" })).toBeTruthy();
    // The first changed line of the diff carries the first button.
    const button = firstAddCommentButton();
    await user.click(button);

    expect(screen.getByLabelText("Comment")).toBeTruthy();
    const addSingle = screen.getByRole("button", { name: "Add single comment" });
    expect(screen.getByRole("button", { name: "Start a review" })).toBeTruthy();

    await user.type(screen.getByLabelText("Comment"), "Please keep the release note short.");
    await user.click(addSingle);

    // The published comment is anchored to the first changed file and line.
    expect(await screen.findByText("Please keep the release note short.")).toBeTruthy();
    const published = screen
      .getByText("Please keep the release note short.")
      .closest("li") as HTMLElement;
    expect(within(published).getByText("bob-reviewer")).toBeTruthy();
    expect(within(fileBlock("RELEASE.md")).getByText("Please keep the release note short.")).toBeTruthy();

    // It survives a reload of the diff and appears in Conversation too.
    reload();
    expect(await screen.findByText("Please keep the release note short.")).toBeTruthy();
    window.location.hash = PULL_ADDRESS;
    const conversation = await screen.findByLabelText("Comments");
    expect(
      within(conversation).getByText("Please keep the release note short."),
    ).toBeTruthy();
  });

  it("an empty comment is refused and publishes nothing", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });

    await user.click(firstAddCommentButton());
    await user.click(screen.getByRole("button", { name: "Add single comment" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    // The editor stays open and no comment was stored.
    expect(screen.getByLabelText("Comment")).toBeTruthy();
    window.location.hash = PULL_ADDRESS;
    const conversation = await screen.findByLabelText("Comments");
    // Only the seeded discussion comment is stored; the empty body was not.
    expect(within(conversation).getAllByRole("listitem")).toHaveLength(1);
  });

  it("Start a review keeps the draft pending until the review is submitted", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });

    await user.click(firstAddCommentButton());
    await user.type(screen.getByLabelText("Comment"), "Filtering needs a test.");
    await user.click(screen.getByRole("button", { name: "Start a review" }));

    // The author of the draft sees it immediately, marked as pending.
    const draft = (await screen.findByText("Filtering needs a test.")).closest("li") as HTMLElement;
    expect(within(draft).getByText("Pending review")).toBeTruthy();

    reload();
    const kept = (await screen.findByText("Filtering needs a test.")).closest("li") as HTMLElement;
    expect(within(kept).getByText("Pending review")).toBeTruthy();

    // The pending draft is not public: neither the author of the pull request
    // nor a visitor sees it in the diff or in Conversation.
    await signOut(user);
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });
    expect(screen.queryByText("Filtering needs a test.")).toBeNull();
    window.location.hash = PULL_ADDRESS;
    const conversation = await screen.findByLabelText("Comments");
    expect(within(conversation).queryByText("Filtering needs a test.")).toBeNull();

    // Submitting the review publishes the draft.
    await signIn(user, "bob-reviewer");
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Comment" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    const publicDraft = (await screen.findByText("Filtering needs a test.")).closest(
      "li",
    ) as HTMLElement;
    expect(within(publicDraft).queryByText("Pending review")).toBeNull();
  });
});

describe("REQ-6-3-4 submit a pull request review", () => {
  it("approving without a summary stores Approved and keeps it after a reload", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByLabelText("Summary")).toBeTruthy();
    for (const label of ["Comment", "Approve", "Request changes"]) {
      expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    }
    await user.click(screen.getByRole("radio", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    // The review summary of the conversation shows reviewer, decision and time.
    window.location.hash = PULL_ADDRESS;
    const summary = await screen.findByLabelText("Review summary");
    expect(within(summary).getAllByText("bob-reviewer").length).toBeGreaterThan(0);
    expect(within(summary).getAllByText("Approved").length).toBeGreaterThan(0);

    reload();
    const reloaded = await screen.findByLabelText("Review summary");
    expect(within(reloaded).getAllByText("bob-reviewer").length).toBeGreaterThan(0);
    expect(within(reloaded).getAllByText("Approved").length).toBeGreaterThan(0);
  });

  it("requesting changes stores the summary and shows Changes requested", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.type(screen.getByLabelText("Summary"), "Reuse the trimmed query.");
    await user.click(screen.getByRole("radio", { name: "Request changes" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    window.location.hash = PULL_ADDRESS;
    const summary = await screen.findByLabelText("Review summary");
    expect(within(summary).getAllByText("Changes requested").length).toBeGreaterThan(0);
    expect(within(summary).getAllByText("Reuse the trimmed query.").length).toBeGreaterThan(0);

    reload();
    const reloaded = await screen.findByLabelText("Review summary");
    expect(within(reloaded).getAllByText("Changes requested").length).toBeGreaterThan(0);
    expect(within(reloaded).getAllByText("Reuse the trimmed query.").length).toBeGreaterThan(0);

    // A refused `Request changes` leaves the recorded decision unchanged.
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Request changes" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));
    window.location.hash = PULL_ADDRESS;
    const afterFailure = await screen.findByLabelText("Review summary");
    expect(within(afterFailure).getAllByText("Reuse the trimmed query.").length).toBeGreaterThan(0);
  });

  it("the Files changed view exposes the submitted decision as one accessible status", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });

    // Before any decision the review summary of the current compare commit
    // carries the initial status under its exact accessible name.
    expect(screen.getByRole("status", { name: "Review required" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    // The decision is readable where it was submitted, under exactly this name
    // and never twice on the same page.
    const approved = await screen.findByRole("status", { name: "Approved" });
    expect(approved.textContent).toBe("Approved");
    expect(screen.getAllByRole("status", { name: "Approved" })).toHaveLength(1);
    const filesSummary = screen
      .getByRole("heading", { name: "Review summary" })
      .closest("section") as HTMLElement;
    expect(within(filesSummary).getByText("bob-reviewer")).toBeTruthy();
    expect(within(filesSummary).getAllByText("Approved").length).toBeGreaterThan(0);

    // The summary container must not shadow the `Summary` field of the review
    // form: a partial label lookup of the reopened form stays unambiguous.
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    const summaryFields = screen.getAllByLabelText("Summary", { exact: false });
    expect(summaryFields).toHaveLength(1);
    expect(summaryFields[0].tagName).toBe("TEXTAREA");

    // The reloaded Files changed view restores the stored decision.
    reload();
    expect(await screen.findByRole("heading", { name: "Changed files summary" })).toBeTruthy();
    expect(await screen.findByRole("status", { name: "Approved" })).toBeTruthy();

    // The Conversation of the same record shows the same single status region
    // inside its named review summary.
    window.location.hash = PULL_ADDRESS;
    expect(await screen.findByRole("status", { name: "Approved" })).toBeTruthy();
    expect(screen.getAllByRole("status", { name: "Approved" })).toHaveLength(1);
    const summary = screen.getByLabelText("Review summary");
    expect(within(summary).getByText("bob-reviewer")).toBeTruthy();
    expect(within(summary).getAllByText("Approved").length).toBeGreaterThan(0);
  });

  it("a requested change is exposed as Changes requested and kept after a reload", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.type(screen.getByLabelText("Summary"), "Reuse the trimmed query.");
    await user.click(screen.getByRole("radio", { name: "Request changes" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByRole("status", { name: "Changes requested" })).toBeTruthy();
    expect(screen.getAllByRole("status", { name: "Changes requested" })).toHaveLength(1);
    expect(screen.getByText("Reuse the trimmed query.")).toBeTruthy();

    reload();
    expect(await screen.findByRole("status", { name: "Changes requested" })).toBeTruthy();
    expect(screen.getByText("Reuse the trimmed query.")).toBeTruthy();
  });

  it("the author of the pull request gets no review entry", async () => {
    installSeed();
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    window.location.hash = FILES_ADDRESS;
    await screen.findByRole("heading", { name: "Changed files summary" });

    // The author holds Write through the organization Owner status, so the
    // inline comment affordance stays, but the review entry never appears.
    expect(screen.getAllByRole("button", { name: "Add comment" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });
});
