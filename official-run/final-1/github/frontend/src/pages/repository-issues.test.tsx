import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function openRepositoryIssues(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "acme-docs" }));
  await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });
  await user.click(screen.getByRole("link", { name: "Issues" }));
  await screen.findByRole("heading", { name: "Issues" });
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Sign in to GitHub" });
  await user.type(screen.getByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

async function openIssue(user: ReturnType<typeof userEvent.setup>, title: string) {
  await openRepositoryIssues(user);
  await user.click(await screen.findByRole("link", { name: title }));
  await screen.findByRole("heading", { name: title });
}

function searchBox() {
  return screen.getByRole("searchbox", { name: "Search issues" });
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

describe("REQ-5-1-1 list and filter repository issues", () => {
  it("shows the open issue after the Open filter and the search, also after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openRepositoryIssues(user);

    expect(screen.getByRole("link", { name: "Open" })).not.toBeNull();
    await user.click(screen.getByRole("link", { name: "Open" }));
    await user.type(searchBox(), "Improve onboarding");

    const link = await screen.findByRole("link", { name: "Improve onboarding" });
    expect(link.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/issues/1");
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();

    reload();
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();
  });

  it("shows only the closed issue for the Closed filter plus the closed keyword", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openRepositoryIssues(user);

    await user.click(screen.getByRole("link", { name: "Closed" }));
    await user.type(searchBox(), "Legacy welcome text");

    const link = await screen.findByRole("link", { name: "Legacy welcome text" });
    expect(link.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/issues/2");
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
  });
});

describe("REQ-5-1-2 view an issue and its discussion", () => {
  it("opens the visible issue entry and keeps title, description and status after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openRepositoryIssues(user);

    await user.click(await screen.findByRole("link", { name: "Improve onboarding" }));
    expect((await screen.findByRole("heading", { name: "Improve onboarding" })).textContent).toBe(
      "Improve onboarding",
    );
    expect(screen.getByText("Describe the onboarding improvement.")).not.toBeNull();
    expect(screen.getByText("Open")).not.toBeNull();
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);

    reload();
    expect((await screen.findByRole("heading", { name: "Improve onboarding" })).textContent).toBe(
      "Improve onboarding",
    );
    expect(screen.getByText("Describe the onboarding improvement.")).not.toBeNull();
    expect(screen.getByText("Open")).not.toBeNull();
  });

  it("reopens the same issue from the home page entry", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openRepositoryIssues(user);
    await user.click(await screen.findByRole("link", { name: "Improve onboarding" }));
    await screen.findByRole("heading", { name: "Improve onboarding" });

    await user.click(screen.getByRole("link", { name: "Home" }));
    await screen.findByRole("heading", { name: "GitHub" });
    await openRepositoryIssues(user);
    await user.click(await screen.findByRole("link", { name: "Improve onboarding" }));

    expect((await screen.findByRole("heading", { name: "Improve onboarding" })).textContent).toBe(
      "Improve onboarding",
    );
    expect(screen.getByText("Open")).not.toBeNull();
  });
});

describe("REQ-5-2-1 create a repository issue", () => {
  it("creates an issue with the exact title and description and lists it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-author");
    await openRepositoryIssues(user);

    await user.click(screen.getByRole("link", { name: "New issue" }));
    await screen.findByRole("heading", { name: "New issue" });
    await user.type(screen.getByLabelText("Title"), "Polish the onboarding tour");
    await user.type(screen.getByLabelText("Description"), "Walk new accounts through the first steps.");
    await user.click(screen.getByRole("button", { name: "Submit new issue" }));

    expect((await screen.findByRole("heading", { name: "Polish the onboarding tour" })).textContent).toBe(
      "Polish the onboarding tour",
    );
    expect(screen.getByText("Walk new accounts through the first steps.")).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "Issues" }));
    await screen.findByRole("heading", { name: "Issues" });
    expect(await screen.findByRole("link", { name: "Polish the onboarding tour" })).not.toBeNull();
  });

  it("rejects a whitespace-only title and creates no issue", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-author");
    await openRepositoryIssues(user);
    const before = screen.getAllByRole("link", { name: /^#\d+$/ }).length;

    await user.click(screen.getByRole("link", { name: "New issue" }));
    await screen.findByRole("heading", { name: "New issue" });
    await user.type(screen.getByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: "Submit new issue" }));

    expect(await screen.findByText("Title is required")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "New issue" })).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "Issues" }));
    await screen.findByRole("heading", { name: "Issues" });
    expect(screen.getAllByRole("link", { name: /^#\d+$/ }).length).toBe(before);
  });
});

describe("REQ-5-2-3 comment on an issue discussion", () => {
  it("appends the exact comment and author to the discussion, also after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-commenter");
    await openRepositoryIssues(user);

    await user.click(await screen.findByRole("link", { name: "Commentable onboarding issue" }));
    await screen.findByRole("heading", { name: "Commentable onboarding issue" });

    await user.type(screen.getByLabelText("Comment"), "Adding the onboarding checklist.");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByText("Adding the onboarding checklist.")).not.toBeNull();
    expect(screen.getAllByText("issue-commenter").length).toBeGreaterThan(0);

    reload();
    expect(await screen.findByText("Adding the onboarding checklist.")).not.toBeNull();
    expect(screen.getAllByText("issue-commenter").length).toBeGreaterThan(0);
  });

  it("rejects a whitespace-only comment without adding a discussion article", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-commenter");
    await openRepositoryIssues(user);

    await user.click(await screen.findByRole("link", { name: "Comment validation issue" }));
    await screen.findByRole("heading", { name: "Comment validation issue" });
    expect(screen.queryAllByRole("article").length).toBe(0);

    await user.type(screen.getByLabelText("Comment"), "   ");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByText("Comment is required")).not.toBeNull();
    expect(screen.queryAllByRole("article").length).toBe(0);

    reload();
    await screen.findByRole("heading", { name: "Comment validation issue" });
    expect(screen.queryAllByRole("article").length).toBe(0);
  });
});

describe("REQ-5-2-2 edit an issue title and description", () => {
  it("saves the title and the description separately and shows both after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-editor");
    await openIssue(user, "Editable onboarding issue");

    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleField = await screen.findByLabelText("Issue title");
    expect((titleField as HTMLInputElement).value).toBe("Editable onboarding issue");
    await user.clear(titleField);
    await user.type(titleField, "Renamed onboarding issue");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));

    expect(
      (await screen.findByRole("heading", { name: "Renamed onboarding issue" })).textContent,
    ).toBe("Renamed onboarding issue");
    // The title save did not touch the description.
    expect(screen.getByText("Tracks editing the onboarding issue title and description.")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit issue description" }));
    const descriptionField = await screen.findByLabelText("Issue description");
    await user.clear(descriptionField);
    await user.type(descriptionField, "The onboarding copy now mentions the checklist.");
    await user.click(screen.getByRole("button", { name: "Save issue description" }));

    expect(await screen.findByText("The onboarding copy now mentions the checklist.")).not.toBeNull();

    reload();
    expect(
      (await screen.findByRole("heading", { name: "Renamed onboarding issue" })).textContent,
    ).toBe("Renamed onboarding issue");
    expect(screen.getByText("The onboarding copy now mentions the checklist.")).not.toBeNull();
  });

  it("rejects a whitespace-only title and keeps the original heading after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-editor");
    await openIssue(user, "Original issue title");

    await user.click(screen.getByRole("button", { name: "Edit issue title" }));
    const titleField = await screen.findByLabelText("Issue title");
    await user.clear(titleField);
    await user.type(titleField, "   ");
    await user.click(screen.getByRole("button", { name: "Save issue title" }));

    expect(await screen.findByText("Title is required")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Original issue title" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "Original issue title" })).not.toBeNull();
  });

  it("hides both edit buttons from a signed-in account without write permission", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "default-branch-viewer");
    await openIssue(user, "Editable onboarding issue");

    expect(screen.queryByRole("button", { name: "Edit issue title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit issue description" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assignees" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
  });

  it("shows the edit buttons but no metadata selectors for a Write-only account", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-author");
    await openIssue(user, "Editable onboarding issue");

    expect(screen.getByRole("button", { name: "Edit issue title" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Edit issue description" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Assignees" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Milestone" })).toBeNull();
  });
});

describe("REQ-5-3-1 assign or unassign issue participants", () => {
  it("assigns and then unassigns the eligible member, keeping the state after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-editor");
    await openIssue(user, "Assignable onboarding issue");

    await user.click(screen.getByRole("button", { name: "Assignees" }));
    const search = await screen.findByLabelText("Search assignees");
    // Filling the textbox filters the eligible member options while typing.
    await user.type(search, "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await user.clear(search);
    await user.type(search, "bob-reviewer");
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "bob-reviewer",
    ]);
    await user.click(await screen.findByRole("option", { name: "bob-reviewer" }));

    expect(await screen.findByText("bob-reviewer")).not.toBeNull();
    // The username shows up exactly once: in the assignee metadata.
    expect(screen.getAllByText("bob-reviewer")).toHaveLength(1);

    reload();
    await screen.findByRole("heading", { name: "Assignable onboarding issue" });
    expect(await screen.findByText("bob-reviewer")).not.toBeNull();
    expect(screen.getAllByText("bob-reviewer")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Assignees" }));
    await user.type(await screen.findByLabelText("Search assignees"), "bob-reviewer");
    await user.click(await screen.findByRole("option", { name: "bob-reviewer" }));

    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
  });
});

describe("REQ-5-3-2 apply labels to an issue", () => {
  it("applies the exact bug label and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-editor");
    await openIssue(user, "Labelable onboarding issue");

    await user.click(screen.getByRole("button", { name: "Labels" }));
    // The options are the labels this repository already defines.
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "bug",
      "documentation",
    ]);
    await user.click(await screen.findByRole("option", { name: "bug" }));

    expect(await screen.findByText("bug")).not.toBeNull();
    expect(screen.getAllByText("bug")).toHaveLength(1);

    reload();
    await screen.findByRole("heading", { name: "Labelable onboarding issue" });
    expect(await screen.findByText("bug")).not.toBeNull();
    expect(screen.getAllByText("bug")).toHaveLength(1);
  });
});

describe("REQ-5-3-3 assign an issue to a milestone", () => {
  it("sets the exact v1.0 milestone and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-editor");
    await openIssue(user, "Milestone onboarding issue");

    expect(screen.getByText("No milestone")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Milestone" }));
    // The options are the milestones this repository already defines.
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "v1.0",
    ]);
    await user.click(await screen.findByRole("option", { name: "v1.0" }));

    expect(await screen.findByText("v1.0")).not.toBeNull();
    expect(screen.getAllByText("v1.0")).toHaveLength(1);

    reload();
    await screen.findByRole("heading", { name: "Milestone onboarding issue" });
    expect(await screen.findByText("v1.0")).not.toBeNull();
    expect(screen.getAllByText("v1.0")).toHaveLength(1);
  });
});

describe("REQ-5-4 close or reopen an issue", () => {
  it("closes and reopens the issue, keeping the state after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-editor");
    await openIssue(user, "Closable onboarding issue");

    expect(screen.getByText("Open")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Close issue" }));

    expect(await screen.findByText("Closed")).not.toBeNull();
    expect(await screen.findByText(/closed this issue/)).not.toBeNull();

    await user.click(await screen.findByRole("button", { name: "Reopen issue" }));
    expect(await screen.findByText("Open")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Closable onboarding issue" });
    expect(screen.getByText("Open")).not.toBeNull();
    expect(await screen.findByRole("button", { name: "Close issue" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
  });

  it("offers no transition control to a read-only viewer", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-viewer");
    await openIssue(user, "Protected onboarding issue");

    expect(screen.getByText("Open")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
  });

  it("offers no transition control to a Write-only account", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "issue-author");
    await openIssue(user, "Protected onboarding issue");

    expect(screen.getByRole("button", { name: "Edit issue title" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Close issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen issue" })).toBeNull();
  });
});
