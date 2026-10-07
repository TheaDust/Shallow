import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

const REPOSITORY = "evo-reaction-repository-s1";

function reload() {
  cleanup();
  render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Sign in to GitHub" });
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** The public entry a visitor uses: the repository list of the home page. */
async function openRepositoryAsVisitor(user: ReturnType<typeof userEvent.setup>) {
  const list = await screen.findByRole("list", { name: "Repositories" });
  await user.click(within(list).getByRole("link", { name: REPOSITORY }));
  return screen.findByRole("heading", { name: `evo-reaction-author/${REPOSITORY}` });
}

/** The signed-in entry: the repositories this identity can read. */
async function openRepositoryFromWorkspace(user: ReturnType<typeof userEvent.setup>) {
  const list = await screen.findByRole("list", { name: "Repositories you can read" });
  await user.click(within(list).getByRole("link", { name: REPOSITORY }));
  return screen.findByRole("heading", { name: `evo-reaction-author/${REPOSITORY}` });
}

async function openIssue(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("link", { name: "Issues" }));
  await screen.findByRole("heading", { name: "Issues" });
  await user.click(await screen.findByRole("link", { name: title }));
  await screen.findByRole("heading", { name: title });
}

function reactionsRegion() {
  return screen.getByRole("region", { name: "Reactions" });
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

describe("REQ-5-5 add and remove issue reactions", () => {
  it("adds `+1` from the Add reaction menu and keeps it highlighted after a reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.author@evolution.test");
    await openRepositoryFromWorkspace(user);
    await openIssue(user, "Evo reaction issue s1");

    // The issue starts without any reaction.
    expect(within(reactionsRegion()).queryByText("+1")).toBeNull();

    await user.click(within(reactionsRegion()).getByRole("button", { name: "Add reaction" }));
    const menu = await screen.findByRole("menu", { name: "Add reaction" });
    await user.click(within(menu).getByRole("menuitem", { name: "+1" }));

    // The reaction is displayed with its count and represented by the removal
    // button of the signed-in account.
    const region = reactionsRegion();
    expect(within(region).getByText("+1")).not.toBeNull();
    expect(within(region).getByText("1")).not.toBeNull();
    const remove = within(region).getByRole("button", { name: "Remove +1 reaction" });
    expect(remove.getAttribute("data-viewer-reacted")).toBe("true");

    // Reloading reads the same persisted reaction and keeps the highlight.
    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s1" });
    const afterReload = reactionsRegion();
    const kept = within(afterReload).getByRole("button", { name: "Remove +1 reaction" });
    expect(kept.getAttribute("data-viewer-reacted")).toBe("true");
    expect(within(afterReload).getByText("+1")).not.toBeNull();
    expect(within(afterReload).getByText("1")).not.toBeNull();
  });

  it("removes the own `+1` again for the second account and returns the count", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.user@evolution.test");
    await openRepositoryFromWorkspace(user);
    await openIssue(user, "Evo reaction issue s2");

    const description = screen
      .getByText("Tracks adding and then removing the same reaction.")
      .textContent;
    expect(within(reactionsRegion()).queryByText("+1")).toBeNull();

    await user.click(within(reactionsRegion()).getByRole("button", { name: "Add reaction" }));
    const menu = await screen.findByRole("menu", { name: "Add reaction" });
    await user.click(within(menu).getByRole("menuitem", { name: "+1" }));
    expect(within(reactionsRegion()).getByText("1")).not.toBeNull();

    await user.click(within(reactionsRegion()).getByRole("button", { name: "Remove +1 reaction" }));

    // The count is back to its original value and no reaction is left; the
    // content of the issue is unchanged.
    const region = reactionsRegion();
    expect(within(region).queryByText("+1")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Evo reaction issue s2" })).not.toBeNull();
    expect(
      screen.getByText("Tracks adding and then removing the same reaction.").textContent,
    ).toBe(description);

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s2" });
    expect(within(reactionsRegion()).queryByText("+1")).toBeNull();
  });

  it("shows the stored count to a visitor without any reaction control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openRepositoryAsVisitor(user);
    await openIssue(user, "Evo reaction issue s3");

    const region = reactionsRegion();
    expect(within(region).getByText("+1")).not.toBeNull();
    expect(within(region).getByText("1")).not.toBeNull();
    // No actionable reaction control is available to the visitor.
    expect(within(region).queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();
  });
});
