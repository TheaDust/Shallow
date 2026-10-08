import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fake-api";

let api: FakeApi;

const EVO_PASSWORD = "Evo-Password-987!";

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string, password: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens a repository entry and then its Releases page. */
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
  it("publishes a release on an existing branch and keeps its detail after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-release-owner", EVO_PASSWORD);
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

  it("shows a visitor the published release detail without offering the publish form", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openReleases(user, "evo-release-repository-s2");

    expect(screen.queryByRole("link", { name: "New release" })).toBeNull();
    await user.click(await screen.findByRole("link", { name: "evo-v0-1-s2" }));

    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s2")).not.toBeNull();
    expect(screen.getByText("evo-main-s2")).not.toBeNull();
    expect(
      screen.getByText("Release published for the evolution release walkthrough."),
    ).not.toBeNull();
  });

  it("refuses a tag the repository already uses and creates no second release", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-release-owner", EVO_PASSWORD);
    await openReleases(user, "evo-release-repository-s3");

    // The published release of the repository is the one using the tag.
    expect(await screen.findByRole("link", { name: "evo-v0-1-s3" })).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "New release" }));
    await screen.findByRole("heading", { name: "New release" });
    await user.type(screen.getByLabelText("Tag name"), "evo-v0-1-s3");
    await user.type(screen.getByLabelText("Release title"), "Duplicate Evolution Release");
    await user.type(screen.getByLabelText("Description"), "Must not be published");
    await user.click(screen.getByRole("button", { name: "Publish release" }));

    expect(await screen.findByText("Tag already exists")).not.toBeNull();
    // The form stays open with the entered values and no second release exists.
    expect(screen.getByRole("heading", { name: "New release" })).not.toBeNull();
    expect((screen.getByLabelText("Tag name") as HTMLInputElement).value).toBe("evo-v0-1-s3");

    await user.click(screen.getByRole("link", { name: "Releases" }));
    await screen.findByRole("heading", { name: "Releases" });
    expect(screen.getAllByRole("link", { name: "evo-v0-1-s3" })).toHaveLength(1);
  });
});
