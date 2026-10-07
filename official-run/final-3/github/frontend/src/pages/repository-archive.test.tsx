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

/** The signed-in entry point that lists the repositories this identity reads. */
async function openRepositoryFromWorkspace(
  user: ReturnType<typeof userEvent.setup>,
  repositoryName: string,
) {
  const list = await screen.findByRole("list", { name: "Repositories you can read" });
  await user.click(within(list).getByRole("link", { name: repositoryName }));
  return screen.findByRole("heading", { name: new RegExp(repositoryName) });
}

/** Opens the repository overview directly, as the reloaded address does. */
async function openRepository(owner: string, name: string) {
  act(() => navigate(`/repositories/${owner}/${name}`));
  return screen.findByRole("heading", { name: new RegExp(name) });
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

/**
 * The overview carries the repository name in its own element, so a preparation
 * step that looks the name up by its exact text (the repository overview is
 * where a scenario "opens the repository") finds exactly one match.
 */
function expectRepositoryNameElement(name: string) {
  const link = screen.getByText(name, { exact: true });
  expect(link.getAttribute("href")).toBe(`#/repositories/evo-archive-admin/${name}`);
}

describe("REQ-3-5 archive and restore a repository", () => {
  it("lets the administrator archive an active repository and keeps the marker after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    const heading = await openRepositoryFromWorkspace(user, "evo-archive-repository-s1");
    expect(heading.textContent).toContain("evo-archive-admin/evo-archive-repository-s1");
    expectRepositoryNameElement("evo-archive-repository-s1");
    expect(screen.queryByText("Archived")).toBeNull();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    const general = await screen.findByRole("region", { name: "General" });

    await user.click(within(general).getByRole("button", { name: "Archive repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive repository" });
    expect(within(dialog).queryByRole("button", { name: "Confirm archive" })).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Confirm archive" }));

    const overview = await screen.findByRole("heading", { name: /evo-archive-repository-s1/ });
    expect(overview.textContent).toContain("evo-archive-repository-s1");
    expect(screen.getByText("Archived")).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: /evo-archive-repository-s1/ })).not.toBeNull();
    expect(screen.getByText("Archived")).not.toBeNull();
  });

  it("keeps an archived repository readable while its write controls are unavailable", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-viewer");

    await openRepositoryFromWorkspace(user, "evo-archive-repository-s2");
    expectRepositoryNameElement("evo-archive-repository-s2");
    expect(screen.getByText("Archived")).not.toBeNull();

    // The stored README stays readable.
    const readme = screen.getByRole("link", { name: "README.md" });
    await user.click(readme);
    expect(await screen.findByRole("heading", { name: "README.md" })).not.toBeNull();

    // File editing is not offered on the overview or the code page.
    await openRepository("evo-archive-admin", "evo-archive-repository-s2");
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();
    act(() => navigate("/repositories/evo-archive-admin/evo-archive-repository-s2/code"));
    expect(await screen.findByRole("heading", { name: "Code" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();

    // Issue creation is not offered either.
    act(() => navigate("/repositories/evo-archive-admin/evo-archive-repository-s2/issues"));
    expect(await screen.findByRole("heading", { name: "Issues" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();

    // And neither is pull-request creation.
    act(() => navigate("/repositories/evo-archive-admin/evo-archive-repository-s2/pulls"));
    expect(await screen.findByRole("heading", { name: "Pull requests" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();
  });

  it("restores an archived repository and keeps its content", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    await openRepositoryFromWorkspace(user, "evo-archive-repository-s3");
    expectRepositoryNameElement("evo-archive-repository-s3");
    expect(screen.getByText("Archived")).not.toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    const general = await screen.findByRole("region", { name: "General" });

    await user.click(within(general).getByRole("button", { name: "Restore repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm restore" }));

    const overview = await screen.findByRole("heading", { name: /evo-archive-repository-s3/ });
    expect(overview.textContent).toContain("evo-archive-repository-s3");
    // The Archived marker is gone and the existing content stays visible.
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: /evo-archive-repository-s3/ })).not.toBeNull();
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
  });
});
