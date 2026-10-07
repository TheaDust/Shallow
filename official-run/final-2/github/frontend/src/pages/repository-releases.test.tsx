import { act, cleanup, render, screen } from "@testing-library/react";
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
  password = "Evo-Password-987!",
) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens the repository entry of the home page or the signed-in workspace. */
async function openRepository(user: ReturnType<typeof userEvent.setup>, repository: string) {
  await user.click(await screen.findByRole("link", { name: repository }));
  await screen.findByRole("heading", { name: new RegExp(repository) });
}

async function openReleases(user: ReturnType<typeof userEvent.setup>, repository: string) {
  await openRepository(user, repository);
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
  it("publishes a release for an existing branch and keeps the detail after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-release-owner");
    // The signed-in account is visible before the repository entry is opened.
    expect(screen.getByText("evo-release-owner")).not.toBeNull();

    await openReleases(user, "evo-release-repository-s1");
    await user.click(screen.getByRole("link", { name: "New release" }));
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

    // The stored release is what the page reads again after a reload.
    reload();
    expect(await screen.findByRole("heading", { name: "Evolution Preview" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s1")).not.toBeNull();
    expect(screen.getByText("evo-main-s1")).not.toBeNull();

    act(() => navigate("/repositories/acme-demo/evo-release-repository-s1/releases"));
    expect(await screen.findByRole("heading", { name: "Releases" })).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "evo-v0-1-s1" })).toHaveLength(1);
  });

  it("lets a visitor read a published release without a publishing control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openReleases(user, "evo-release-repository-s2");

    expect(screen.queryByRole("link", { name: "New release" })).toBeNull();
    await user.click(await screen.findByRole("link", { name: "evo-v0-1-s2" }));

    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s2")).not.toBeNull();
    expect(screen.getByText("Description of the existing evolution release.")).not.toBeNull();
    expect(screen.getByText("evo-main-s2")).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: "Existing Evolution Release" })).not.toBeNull();
    expect(screen.getByText("evo-v0-1-s2")).not.toBeNull();
  });

  it("reports an existing tag instead of creating a second release", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-release-owner");
    await openReleases(user, "evo-release-repository-s3");

    await user.click(screen.getByRole("link", { name: "New release" }));
    await screen.findByRole("heading", { name: "New release" });
    await user.type(screen.getByLabelText("Tag name"), "evo-v0-1-s3");
    await user.type(screen.getByLabelText("Release title"), "Duplicate release");
    await user.type(screen.getByLabelText("Description"), "Must not be stored");
    await user.selectOptions(screen.getByLabelText("Target branch"), "evo-main-s3");
    await user.click(screen.getByRole("button", { name: "Publish release" }));

    expect(await screen.findByText("Tag already exists")).not.toBeNull();
    // The form stays open and no second release was stored.
    expect(screen.getByRole("heading", { name: "New release" })).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "Releases" }));
    await screen.findByRole("heading", { name: "Releases" });
    expect(screen.getAllByRole("link", { name: "evo-v0-1-s3" })).toHaveLength(1);
    expect(screen.queryByText("Duplicate release")).toBeNull();
  });

  it("offers the release form only to an account that may publish", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openReleases(user, "evo-release-repository-s1");
    expect(screen.queryByRole("link", { name: "New release" })).toBeNull();

    // A signed-in reader without a write grant is refused the form as well.
    act(() => navigate("/"));
    await signInAs(user, "alice-dev", "Valid-password-123!");
    await openReleases(user, "evo-release-repository-s1");
    expect(screen.queryByRole("link", { name: "New release" })).toBeNull();
  });
});
