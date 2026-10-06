import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

/** Signs in with the evolution password shared by the release Owner account. */
async function signInAsOwner(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), "evo.release.owner@evolution.test");
  await user.type(screen.getByLabelText("Password"), "Evo-Password-987!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens one repository entry and then its `Releases` page. */
async function openReleases(user: ReturnType<typeof userEvent.setup>, repository: string) {
  await user.click(await screen.findByRole("link", { name: repository }));
  await screen.findByRole("heading", { name: new RegExp(repository) });
  await user.click(await screen.findByRole("link", { name: "Releases" }));
  await screen.findByRole("heading", { name: "Releases" });
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
  it("publishes a release from the form and keeps its detail after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAsOwner(user);
    await openReleases(user, "evo-release-repository-s1");

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

    reload();
    expect(await screen.findByRole("heading", { name: "Evolution Preview" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s1")).not.toBeNull();
    expect(screen.getByText("Evolution release description")).not.toBeNull();
    expect(screen.getByText("evo-main-s1")).not.toBeNull();
  });

  it("shows the published release of a public repository to a visitor", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openReleases(user, "evo-release-repository-s2");

    // A visitor reads the releases without being offered publication.
    expect(screen.queryByRole("link", { name: "New release" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "evo-v0-1-s2" }));

    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s2")).not.toBeNull();
    expect(screen.getByText("Seeded notes for the published tag.")).not.toBeNull();
    expect(screen.getByText("evo-main-s2")).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s2")).not.toBeNull();
  });

  it("refuses an already used tag and creates no second release", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAsOwner(user);
    await openReleases(user, "evo-release-repository-s3");
    expect(screen.getAllByRole("link", { name: "evo-v0-1-s3" })).toHaveLength(1);

    await user.click(await screen.findByRole("link", { name: "New release" }));
    await screen.findByRole("heading", { name: "New release" });

    await user.type(screen.getByLabelText("Tag name"), "evo-v0-1-s3");
    await user.type(screen.getByLabelText("Release title"), "Second Evolution Release");
    await user.type(screen.getByLabelText("Description"), "A second release for the same tag");
    await user.click(screen.getByRole("button", { name: "Publish release" }));

    expect(await screen.findByText("Tag already exists")).not.toBeNull();
    // The form stays open and the stored releases are unchanged.
    expect(screen.getByRole("heading", { name: "New release" })).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "Releases" }));
    await screen.findByRole("heading", { name: "Releases" });
    expect(screen.getAllByRole("link", { name: "evo-v0-1-s3" })).toHaveLength(1);
    expect(screen.queryByText("Second Evolution Release")).toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "Releases" })).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "evo-v0-1-s3" })).toHaveLength(1);
  });
});
