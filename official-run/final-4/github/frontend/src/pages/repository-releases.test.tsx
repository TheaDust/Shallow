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

/** Opens the repository Releases page through the repository tab entry. */
async function openReleases(user: ReturnType<typeof userEvent.setup>, name: string) {
  await openRepository(user, name);
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
  it("publishes one release and keeps its detail after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-release-owner", "Evo-Password-987!");

    await openReleases(user, "evo-release-repository-s1");
    // Nothing is published yet, so the list is empty and the entry is offered.
    expect(screen.queryByRole("link", { name: "evo-v0-1-s1" })).toBeNull();
    await user.click(await screen.findByRole("link", { name: "New release" }));
    await screen.findByRole("heading", { name: "New release" });

    await user.type(screen.getByLabelText("Tag name"), "evo-v0-1-s1");
    await user.type(screen.getByLabelText("Release title"), "Evolution Preview");
    await user.type(screen.getByLabelText("Description"), "Evolution release description");
    await user.selectOptions(screen.getByLabelText("Target branch"), "evo-main-s1");
    await user.click(screen.getByRole("button", { name: "Publish release" }));

    // The release detail displays the stored tag, title, description and branch.
    expect(await screen.findByRole("heading", { name: "Evolution Preview" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s1")).not.toBeNull();
    expect(screen.getByText("Evolution release description")).not.toBeNull();
    expect(screen.getByText("evo-main-s1")).not.toBeNull();
    expect(window.location.hash).toContain("/releases/evo-v0-1-s1");

    reload();
    expect(await screen.findByRole("heading", { name: "Evolution Preview" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s1")).not.toBeNull();
    expect(screen.getByText("Evolution release description")).not.toBeNull();
    expect(screen.getByText("evo-main-s1")).not.toBeNull();
  });

  it("shows the published release to a visitor and offers no publishing control", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openReleases(user, "evo-release-repository-s2");
    expect(screen.queryByRole("link", { name: "New release" })).toBeNull();

    await user.click(await screen.findByRole("link", { name: "evo-v0-1-s2" }));
    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s2")).not.toBeNull();
    expect(screen.getByText("Release description of the existing evolution release.")).not.toBeNull();
    expect(screen.getByText("evo-main-s2")).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-main-s2")).not.toBeNull();
  });

  it("reports an existing tag and creates no second release", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-release-owner", "Evo-Password-987!");

    await openReleases(user, "evo-release-repository-s3");
    await user.click(await screen.findByRole("link", { name: "New release" }));
    await screen.findByRole("heading", { name: "New release" });

    await user.type(screen.getByLabelText("Tag name"), "evo-v0-1-s3");
    await user.type(screen.getByLabelText("Release title"), "A second title");
    await user.type(screen.getByLabelText("Description"), "Must not be stored");
    await user.click(screen.getByRole("button", { name: "Publish release" }));

    expect(await screen.findByText("Tag already exists")).not.toBeNull();
    // The submission did not open a detail view, so the form stays open.
    expect(screen.getByRole("heading", { name: "New release" })).not.toBeNull();

    // The repository still holds exactly one release for that tag.
    await user.click(screen.getByRole("link", { name: "Cancel" }));
    await screen.findByRole("heading", { name: "Releases" });
    expect(screen.getAllByRole("link", { name: "evo-v0-1-s3" })).toHaveLength(1);

    act(() =>
      navigate("/repositories/evo-release-owner/evo-release-repository-s3/releases/evo-v0-1-s3"),
    );
    expect(await screen.findByRole("heading", { name: "Already published evolution release" })).not.toBeNull();
    expect(screen.queryByText("A second title")).toBeNull();
  });

  it("keeps the publishing control unavailable to a readable non-writer", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-viewer", "Evo-Password-987!");

    await openReleases(user, "evo-release-repository-s2");
    expect(screen.queryByRole("link", { name: "New release" })).toBeNull();

    // The publication itself is refused by the server as well.
    act(() => navigate("/repositories/evo-release-owner/evo-release-repository-s2/releases/new"));
    await screen.findByRole("heading", { name: "New release" });
    const publish = await screen.findByRole("button", { name: "Publish release" });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
  });
});
