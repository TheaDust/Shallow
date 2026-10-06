import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

/** Signs in with one of the two reaction viewer accounts (REQ-5-5). */
async function signIn(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Sign in to GitHub" });
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens one reaction issue from the public repository's visible entry. */
async function openReactionIssue(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole("link", { name: "evo-reaction-repository-s1" }));
  await screen.findByRole("heading", { name: "Acme Demo/evo-reaction-repository-s1" });
  await user.click(await screen.findByRole("link", { name: "Issues" }));
  await screen.findByRole("heading", { name: "Issues" });
  await user.click(await screen.findByRole("link", { name: title }));
  await screen.findByRole("heading", { name: title });
}

/** The displayed count of the stored `+1` reaction, read from the page text. */
function reactionCount(): number | null {
  const node = document.querySelector(".issue-reactions");
  const match = node?.textContent?.match(/\+1\s*(\d+)/);
  return match ? Number(match[1]) : null;
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
  it("adds the +1 reaction through the Add reaction menu and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.author@evolution.test");
    await openReactionIssue(user, "Evo reaction issue s1");

    expect(reactionCount()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    const menu = await screen.findByRole("menu");
    expect(menu).not.toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: "+1" }));

    // The viewer's own reaction is the removal button and the count is 1.
    const own = await screen.findByRole("button", { name: "Remove +1 reaction" });
    expect(reactionCount()).toBe(1);
    expect(own.textContent).toContain("+1");
    const description = screen.getByRole("region", { name: "Description" });
    expect(within(description).getByText("+1")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s1" });
    expect(await screen.findByRole("button", { name: "Remove +1 reaction" })).not.toBeNull();
    expect(reactionCount()).toBe(1);
  });

  it("reactivating the own +1 reaction removes it and restores the original count", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, "evo.reaction.user@evolution.test");
    await openReactionIssue(user, "Evo reaction issue s2");

    expect(reactionCount()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    await user.click(await screen.findByRole("menuitem", { name: "+1" }));
    await screen.findByRole("button", { name: "Remove +1 reaction" });
    expect(reactionCount()).toBe(1);

    await user.click(screen.getByRole("button", { name: "Remove +1 reaction" }));
    await screen.findByRole("heading", { name: "Evo reaction issue s2" });
    expect(await screen.findByRole("button", { name: "Add reaction" })).not.toBeNull();
    expect(reactionCount()).toBeNull();
    // Nothing on the page still spells out the removed reaction type, so the
    // count is observably back to its `+1`-less original state.
    expect(screen.queryByText("+1")).toBeNull();

    // The issue content is untouched by the reaction round trip.
    expect(screen.getByText("Evo reaction issue s2")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s2" });
    expect(reactionCount()).toBeNull();
  });

  it("shows the stored +1 count to an unauthenticated visitor without a reaction control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openReactionIssue(user, "Evo reaction issue s3");

    expect(reactionCount()).toBe(1);
    // The stored type and count belong to the issue body region.
    const description = screen.getByRole("region", { name: "Description" });
    expect(within(description).getByText("+1")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();
  });
});
