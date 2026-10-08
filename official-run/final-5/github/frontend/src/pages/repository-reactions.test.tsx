import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

const EVO_PASSWORD = "Evo-Password-987!";
const REACTION_REPOSITORY = "evo-reaction-repository-s1";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Sign in to GitHub" });
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), EVO_PASSWORD);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

/**
 * The public entry chain to the issue: the repository entry the current view
 * offers (the visitor home page or the signed-in workspace), the repository
 * page, its Issues list and finally the issue itself.
 */
async function openReactionIssue(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole("link", { name: REACTION_REPOSITORY }));
  await screen.findByRole("heading", { name: `Acme Demo/${REACTION_REPOSITORY}` });
  await user.click(screen.getByRole("link", { name: "Issues" }));
  await screen.findByRole("heading", { name: "Issues" });
  await user.click(await screen.findByRole("link", { name: title }));
  await screen.findByRole("heading", { name: title });
}

function reactions() {
  return screen.getByRole("region", { name: "Reactions" });
}

/** The displayed count of one reaction type, read from its own text node. */
function shownCount(type: string, count: number) {
  expect(within(reactions()).getByText(type)).not.toBeNull();
  return within(reactions()).getByText(String(count)).textContent;
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

describe("REQ-5-5 add a reaction from the issue detail", () => {
  it("adds the +1 reaction through the Add reaction menu and keeps it after a reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.author@evolution.test");
    await openReactionIssue(user, "Evo reaction issue s1");

    // The menu opens on the button and holds the scenario's choice.
    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    const menu = await screen.findByRole("menu", { name: "Add reaction" });
    await user.click(within(menu).getByRole("menuitem", { name: "+1" }));

    // The persisted type, its updated count and the viewer's own reaction.
    const remove = await screen.findByRole("button", { name: "Remove +1 reaction" });
    expect(remove.textContent).toContain("+1");
    expect(shownCount("+1", 1)).toBe("1");
    expect(screen.queryByRole("menu")).toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s1" });
    expect(await screen.findByRole("button", { name: "Remove +1 reaction" })).not.toBeNull();
    expect(shownCount("+1", 1)).toBe("1");
  });
});

describe("REQ-5-5 remove the viewer's own reaction", () => {
  it("returns the +1 count to its original value without changing the issue content", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.user@evolution.test");
    await openReactionIssue(user, "Evo reaction issue s2");

    expect(screen.getByText("Tracks the reaction walkthrough of Evo reaction issue s2.")).not.toBeNull();
    expect(shownCount("+1", 0)).toBe("0");
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    await user.click(await screen.findByRole("menuitem", { name: "+1" }));
    expect(await screen.findByRole("button", { name: "Remove +1 reaction" })).not.toBeNull();
    expect(shownCount("+1", 1)).toBe("1");

    await user.click(screen.getByRole("button", { name: "Remove +1 reaction" }));
    await screen.findByRole("heading", { name: "Evo reaction issue s2" });
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();
    expect(shownCount("+1", 0)).toBe("0");
    // The reaction never changed the issue title or its description.
    expect(screen.getByRole("heading", { name: "Evo reaction issue s2" })).not.toBeNull();
    expect(screen.getByText("Tracks the reaction walkthrough of Evo reaction issue s2.")).not.toBeNull();
  });
});

describe("REQ-5-5 read reactions as an unauthenticated visitor", () => {
  it("shows the existing count but offers no reaction control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openReactionIssue(user, "Evo reaction issue s3");

    expect(shownCount("+1", 1)).toBe("1");
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s3" });
    expect(shownCount("+1", 1)).toBe("1");
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
  });
});
