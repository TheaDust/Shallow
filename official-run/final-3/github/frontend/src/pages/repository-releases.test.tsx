import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** The visitor entry: opens a public repository from the home page list. */
async function openRepositoryFromHome(
  user: ReturnType<typeof userEvent.setup>,
  repositoryName: string,
) {
  const list = await screen.findByRole("list", { name: "Repositories" });
  await user.click(within(list).getByRole("link", { name: repositoryName }));
  return screen.findByRole("heading", { name: new RegExp(repositoryName) });
}

/** The signed-in entry: opens a readable repository from the workspace list. */
async function openRepositoryFromWorkspace(
  user: ReturnType<typeof userEvent.setup>,
  repositoryName: string,
) {
  const list = await screen.findByRole("list", { name: "Repositories you can read" });
  await user.click(within(list).getByRole("link", { name: repositoryName }));
  return screen.findByRole("heading", { name: new RegExp(repositoryName) });
}

/** Opens the repository `Releases` page from its overview tab. */
async function openReleases(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "Releases" }));
  return screen.findByRole("heading", { name: "Releases" });
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

describe("REQ-4-5 create and view repository releases", () => {
  it("lets a visitor read a published release detail and keeps it after reload", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openRepositoryFromHome(user, "evo-release-repository-s2");
    await openReleases(user);

    // The release list names each release by its exact tag.
    const releaseLink = await screen.findByRole("link", { name: "evo-v0-1-s2" });
    await user.click(releaseLink);

    // The detail displays the exact tag, title, description and target branch.
    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s2")).not.toBeNull();
    expect(screen.getByText("Published release kept for the read-only release scenario.")).not.toBeNull();
    expect(screen.getByText("evo-main-s2")).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-main-s2")).not.toBeNull();
  });

  it("lets a visitor open Releases but not publish", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openRepositoryFromHome(user, "evo-release-repository-s2");
    await openReleases(user);
    expect(screen.queryByRole("link", { name: "New release" })).toBeNull();
  });

  it("publishes a release as its writer and keeps the detail after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-release-owner");

    await openRepositoryFromWorkspace(user, "evo-release-repository-s1");
    await openReleases(user);
    await user.click(await screen.findByRole("link", { name: "New release" }));
    await screen.findByRole("heading", { name: "New release" });

    await user.type(screen.getByLabelText("Tag name"), "evo-v0-1-s1");
    await user.type(screen.getByLabelText("Release title"), "Evolution Preview");
    await user.type(screen.getByLabelText("Description"), "Evolution release description");
    await user.selectOptions(screen.getByLabelText("Target branch"), "evo-main-s1");
    await user.click(screen.getByRole("button", { name: "Publish release" }));

    expect(await screen.findByRole("heading", { name: "Evolution Preview" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s1")).not.toBeNull();
    expect(screen.getByText("Evolution release description")).not.toBeNull();
    expect(screen.getByText("evo-main-s1")).not.toBeNull();
    expect(window.location.hash).toContain("releases/evo-v0-1-s1");

    reload();
    expect(await screen.findByRole("heading", { name: "Evolution Preview" })).not.toBeNull();
    expect(screen.getByText("Evolution release description")).not.toBeNull();
    expect(screen.getByText("evo-main-s1")).not.toBeNull();
  });

  it("reports an existing tag and creates no second release", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-release-owner");

    await openRepositoryFromWorkspace(user, "evo-release-repository-s3");
    await openReleases(user);
    // The predefined release of `-s3` is the one the reuse scenario collides with.
    expect(await screen.findByRole("link", { name: "evo-v0-1-s3" })).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "New release" }));
    await screen.findByRole("heading", { name: "New release" });
    await user.type(screen.getByLabelText("Tag name"), "evo-v0-1-s3");
    await user.type(screen.getByLabelText("Release title"), "Second attempt");
    await user.type(screen.getByLabelText("Description"), "Should not be published");
    await user.click(screen.getByRole("button", { name: "Publish release" }));

    expect(await screen.findByText("Tag already exists")).not.toBeNull();
    // Still on the form with the fields retained.
    expect(screen.getByRole("heading", { name: "New release" })).not.toBeNull();

    act(() => navigate("/repositories/evo-release-owner/evo-release-repository-s3/releases"));
    const rows = await screen.findAllByRole("listitem");
    expect(within(rows[0]).getByRole("link", { name: "evo-v0-1-s3" })).not.toBeNull();
    expect(screen.queryByText("Second attempt")).toBeNull();
  });
});
