import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(
  user: ReturnType<typeof userEvent.setup>,
  identifier: string,
  password: string,
) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens one repository from the entry list of the current page. */
async function openRepository(user: ReturnType<typeof userEvent.setup>, repository: string) {
  await user.click(await screen.findByRole("link", { name: repository }));
  return screen.findByRole("heading", { name: new RegExp(repository) });
}

/** Opens one issue through the repository's Issues list, not by its address. */
async function openIssue(
  user: ReturnType<typeof userEvent.setup>,
  repository: string,
  title: string,
) {
  await openRepository(user, repository);
  await user.click(await screen.findByRole("link", { name: "Issues" }));
  await screen.findByRole("heading", { name: "Issues" });
  await user.click(await screen.findByRole("link", { name: title }));
  return screen.findByRole("heading", { name: title });
}

/** The displayed count of one reaction name on the open issue. */
function reactionCount(type: string): string {
  return (
    document.querySelector(`[data-reaction="${type}"] .issue-reaction__count`)?.textContent ?? ""
  );
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
  it("adds the +1 reaction through the menu and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo.reaction.author@evolution.test", "Evo-Password-987!");
    await openIssue(user, "evo-reaction-repository-s1", "Evo reaction issue s1");

    expect(reactionCount("+1")).toBe("0");
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    const menu = screen.getByRole("menu", { name: "Add reaction" });
    await user.click(within(menu).getByRole("menuitem", { name: "+1" }));

    await waitFor(() => expect(reactionCount("+1")).toBe("1"));
    expect(await screen.findByRole("button", { name: "Remove +1 reaction" })).not.toBeNull();
    // The menu unmounted with its own selection.
    expect(screen.queryByRole("menu")).toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s1" });
    await waitFor(() => expect(reactionCount("+1")).toBe("1"));
    expect(await screen.findByRole("button", { name: "Remove +1 reaction" })).not.toBeNull();
  });

  it("removes only the own reaction again and leaves the issue content untouched", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo.reaction.user@evolution.test", "Evo-Password-987!");
    await openIssue(user, "evo-reaction-repository-s1", "Evo reaction issue s2");

    expect(reactionCount("+1")).toBe("0");
    expect(screen.getByText("Tracks removing the own reaction again.")).not.toBeNull();
    expect(screen.getByText("No one assigned")).not.toBeNull();
    expect(screen.getByText("None yet")).not.toBeNull();
    expect(screen.getByText("No milestone")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "+1" }));
    await waitFor(() => expect(reactionCount("+1")).toBe("1"));

    await user.click(await screen.findByRole("button", { name: "Remove +1 reaction" }));
    await waitFor(() => expect(reactionCount("+1")).toBe("0"));
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();

    // The reaction changed nothing else: the title, the body and the metadata
    // of the issue still read exactly the stored values.
    expect(
      (await screen.findByRole("heading", { name: "Evo reaction issue s2" })).textContent,
    ).toBe("Evo reaction issue s2");
    expect(screen.getByText("Tracks removing the own reaction again.")).not.toBeNull();
    expect(screen.getByText("No one assigned")).not.toBeNull();
    expect(screen.getByText("None yet")).not.toBeNull();
    expect(screen.getByText("No milestone")).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s2" });
    await waitFor(() => expect(reactionCount("+1")).toBe("0"));
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();
  });

  it("shows the existing count to a visitor without any reaction control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openIssue(user, "evo-reaction-repository-s1", "Evo reaction issue s3");

    expect(reactionCount("+1")).toBe("1");
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();

    reload();
    await screen.findByRole("heading", { name: "Evo reaction issue s3" });
    await waitFor(() => expect(reactionCount("+1")).toBe("1"));
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
  });

  it("keeps the own reaction of one account out of another account's view", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo.reaction.user@evolution.test", "Evo-Password-987!");
    await openIssue(user, "evo-reaction-repository-s1", "Evo reaction issue s1");

    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "+1" }));
    await waitFor(() => expect(reactionCount("+1")).toBe("1"));
    expect(await screen.findByRole("button", { name: "Remove +1 reaction" })).not.toBeNull();

    // The other account sees the same count but no reaction of its own.
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", {
        name: "Confirm sign out",
      }),
    );
    await signInAs(user, "evo-reaction-author", "Evo-Password-987!");
    await openIssue(user, "evo-reaction-repository-s1", "Evo reaction issue s1");

    expect(reactionCount("+1")).toBe("1");
    expect(screen.queryByRole("button", { name: "Remove +1 reaction" })).toBeNull();
  });
});
