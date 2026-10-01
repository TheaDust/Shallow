import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import {
  ISSUE_ADDRESS,
  ISSUE_SEED_ORGANIZATION,
  MEMBER,
  OWNER,
} from "../../test-support/issue-fixtures";

const SEEDED_COMMENT = "Start with the first-run checklist.";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function reload() {
  cleanup();
  return render(<App />);
}

function sectionOf(heading: string): HTMLElement {
  const section = screen.getByRole("heading", { name: heading }).closest("section");
  if (section === null) throw new Error(`no section for ${heading}`);
  return section as HTMLElement;
}

/** The article of one discussion comment, found by its body. */
function commentArticle(body: string): HTMLElement {
  const article = screen.getByText(body).closest("article");
  if (article === null) throw new Error(`no comment article for ${body}`);
  return article as HTMLElement;
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-5-2-3 comment on an issue discussion", () => {
  it("appends the comment with its author and its timeline record", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");

    window.location.hash = ISSUE_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const comments = sectionOf("Comments");
    expect(within(comments).getByText(SEEDED_COMMENT)).toBeTruthy();

    await user.type(screen.getByLabelText("Comment"), "Please add the first-run checklist.");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    // The complete comment body and its author are visible in the discussion.
    const added = await within(sectionOf("Comments")).findByText(
      "Please add the first-run checklist.",
    );
    const article = added.closest("article") as HTMLElement;
    expect(within(article).getByText("alice-dev")).toBeTruthy();
    // The comment editor is emptied after a successful submission.
    expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe("");

    // The activity timeline gained its own record for the comment.
    const activity = sectionOf("Activity");
    const records = within(activity)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(records.filter((record) => record.includes("commented")).length).toBe(2);

    // The stored comment is read again after a reload.
    reload();
    expect(await screen.findByText("Please add the first-run checklist.")).toBeTruthy();
    expect(within(sectionOf("Comments")).getByText(SEEDED_COMMENT)).toBeTruthy();
  });

  it("creates no entry for a comment of whitespace only", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");

    window.location.hash = ISSUE_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const before = screen.getAllByRole("article").length;

    await user.type(screen.getByLabelText("Comment"), "   ");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    // The reason is shown and neither a comment nor a timeline record is added.
    expect(await screen.findByText("Comment is required")).toBeTruthy();
    expect(screen.getAllByRole("article").length).toBe(before);
    expect(within(sectionOf("Comments")).getAllByRole("listitem").length).toBe(1);

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getAllByRole("article").length).toBe(before);
  });

  it("adds a reaction to an existing comment and removes it on a second selection", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");

    window.location.hash = ISSUE_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const comment = commentArticle(SEEDED_COMMENT);

    // The reaction menu of the existing comment offers the reaction types.
    await user.click(within(comment).getByRole("button", { name: "Add reaction" }));
    await user.click(await screen.findByRole("menuitem", { name: /Thumbs up/ }));

    // The target comment shows the reaction with its count.
    const chip = await within(commentArticle(SEEDED_COMMENT)).findByRole("button", {
      name: "Thumbs up reaction",
    });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.textContent).toContain("1");

    // The stored association is read again after a reload.
    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    const persisted = within(commentArticle(SEEDED_COMMENT)).getByRole("button", {
      name: "Thumbs up reaction",
    });
    expect(persisted.getAttribute("aria-pressed")).toBe("true");
    expect(persisted.textContent).toContain("1");

    // Selecting the same reaction again removes it instead of duplicating it.
    await user.click(persisted);
    await within(commentArticle(SEEDED_COMMENT)).findByRole("button", { name: "Add reaction" });
    expect(
      within(commentArticle(SEEDED_COMMENT)).queryByRole("button", {
        name: "Thumbs up reaction",
      }),
    ).toBeNull();
  });

  it("lets a signed-in reader react but offers no comment editor without Write permission", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");

    window.location.hash = ISSUE_ADDRESS;
    await screen.findByRole("heading", { name: "Improve onboarding" });
    // The member without a repository role reads the whole discussion.
    expect(within(sectionOf("Comments")).getByText(SEEDED_COMMENT)).toBeTruthy();
    expect(screen.queryByLabelText("Comment")).toBeNull();

    // A reaction only needs repository-view permission.
    const comment = commentArticle(SEEDED_COMMENT);
    await user.click(within(comment).getByRole("button", { name: "Add reaction" }));
    await user.click(await screen.findByRole("menuitem", { name: /Rocket/ }));
    const chip = await within(commentArticle(SEEDED_COMMENT)).findByRole("button", {
      name: "Rocket reaction",
    });
    expect(chip.getAttribute("aria-pressed")).toBe("true");

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(
      within(commentArticle(SEEDED_COMMENT)).getByRole("button", { name: "Rocket reaction" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
