import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

// REQ-5-5: adding and removing issue reactions. The three scenarios are the
// signed-in add of one `+1` reaction that survives a reload, the add followed by
// activating the same reaction again, and the unauthenticated visitor who reads
// the stored count without any reaction control.

let api: FakeApi;

const REACTION_PASSWORD = "Evo-Password-987!";
const REPOSITORY = "evo-reaction-repository-s1";

function reload() {
  cleanup();
  render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Sign in to GitHub" });
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), REACTION_PASSWORD);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

/** Opens one issue of the scenario repository through the repository list. */
async function openIssue(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole("link", { name: REPOSITORY }));
  await screen.findByRole("heading", { name: `Acme Demo/${REPOSITORY}` });
  await user.click(screen.getByRole("link", { name: "Issues" }));
  await screen.findByRole("heading", { name: "Issues" });
  await user.click(await screen.findByRole("link", { name: title }));
  await screen.findByRole("heading", { name: title });
}

function reactions() {
  return screen.getByRole("region", { name: "Reactions" });
}

/** Chooses `+1` from the reaction menu the `Add reaction` button opens. */
async function addPlusOne(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add reaction" }));
  const menu = await screen.findByRole("menu", { name: "Add reaction" });
  expect(within(menu).getByRole("menuitem", { name: "+1" })).not.toBeNull();
  await user.click(within(menu).getByRole("menuitem", { name: "+1" }));
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

describe("REQ-5-5 scenario 1: add a reaction and keep it after reload", () => {
  it("adds the +1 reaction, shows its count and keeps the own reaction after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.author@evolution.test");
    await openIssue(user, "Evo reaction issue s1");

    expect(within(reactions()).getByText("No reactions yet.")).not.toBeNull();
    await addPlusOne(user);

    const own = await screen.findByRole("button", { name: "Remove +1 reaction" });
    expect(within(reactions()).getByText("+1")).not.toBeNull();
    expect(within(reactions()).getByText("1")).not.toBeNull();
    // The reaction did not change the issue title, body, discussion, labels,
    // assignees or milestone.
    expect(screen.getByRole("heading", { name: "Evo reaction issue s1" })).not.toBeNull();
    expect(screen.getByText("Tracks adding a reaction to the evolution issue.")).not.toBeNull();
    expect(within(reactions()).queryByText("No reactions yet.")).toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s1" });
    expect(await screen.findByRole("button", { name: "Remove +1 reaction" })).not.toBeNull();
    expect(within(reactions()).getByText("+1")).not.toBeNull();
    expect(within(reactions()).getByText("1")).not.toBeNull();
    expect(screen.getByText("Tracks adding a reaction to the evolution issue.")).not.toBeNull();
  });

  it("offers the +1 choice as a menu item of the Add reaction menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.author@evolution.test");
    await openIssue(user, "Evo reaction issue s1");

    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    const menu = await screen.findByRole("menu");
    expect(menu.getAttribute("aria-label")).toBe("Add reaction");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toContain("+1");
  });
});

describe("REQ-5-5 scenario 2: activating the own reaction again removes it", () => {
  it("adds the +1 reaction and removes it again, restoring the original count", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.user@evolution.test");
    await openIssue(user, "Evo reaction issue s2");

    // The account has not reacted and no other `+1` reaction exists.
    expect(within(reactions()).getByText("No reactions yet.")).not.toBeNull();
    await addPlusOne(user);
    expect(within(reactions()).getByText("1")).not.toBeNull();

    await user.click(await screen.findByRole("button", { name: "Remove +1 reaction" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull(),
    );
    expect(within(reactions()).queryByText("+1")).toBeNull();
    expect(within(reactions()).getByText("No reactions yet.")).not.toBeNull();
    // The count went back to its original value without changing the content.
    expect(screen.getByRole("heading", { name: "Evo reaction issue s2" })).not.toBeNull();
    expect(
      screen.getByText("Tracks adding and removing a reaction on the evolution issue."),
    ).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s2" });
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();
    expect(within(reactions()).getByText("No reactions yet.")).not.toBeNull();
  });
});

describe("REQ-5-5 scenario 3: a visitor reads the count without a control", () => {
  it("shows the existing +1 count and no actionable reaction control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openIssue(user, "Evo reaction issue s3");

    expect(within(reactions()).getByText("+1")).not.toBeNull();
    expect(within(reactions()).getByText("2")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s3" });
    expect(within(reactions()).getByText("+1")).not.toBeNull();
    expect(within(reactions()).getByText("2")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
  });
});
