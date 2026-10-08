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
  password = "Valid-password-123!",
) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Types into the top global searchbox and submits it with Enter. */
async function searchFor(user: ReturnType<typeof userEvent.setup>, query: string) {
  const box = await screen.findByRole("searchbox", { name: "Search" });
  await user.clear(box);
  await user.type(box, `${query}{Enter}`);
}

/** Opens one repository from the readable repository list of the workspace. */
async function openFromWorkspace(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("link", { name }));
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

describe("REQ-3-1 search for and locate repositories (evolution)", () => {
  it("finds a repository with an upper-case query and keeps the overview after reload", async () => {
    const user = userEvent.setup();
    render(<App />);

    await searchFor(user, "EVO-SEARCH-CATALOG-S1");

    const result = await screen.findByRole("link", { name: "evo-search-catalog-s1" });
    expect(result.getAttribute("href")).toBe(
      "#/repositories/evo-search-owner/evo-search-catalog-s1",
    );
    await user.click(result);

    const heading = await screen.findByRole("heading", { name: /evo-search-catalog-s1/ });
    expect(heading.textContent).toContain("evo-search-owner/evo-search-catalog-s1");

    reload();
    expect(await screen.findByRole("heading", { name: /evo-search-catalog-s1/ })).not.toBeNull();
  });

  it("matches the persisted description as well as the name", async () => {
    const user = userEvent.setup();
    render(<App />);

    await searchFor(user, "evolution-notebook");

    const result = await screen.findByRole("link", { name: "evo-search-notebook-s2" });
    expect(result.getAttribute("href")).toBe(
      "#/repositories/evo-search-owner/evo-search-notebook-s2",
    );
  });

  it("reports no results for a query no repository matches", async () => {
    const user = userEvent.setup();
    render(<App />);

    await searchFor(user, "evo-search-empty-s3");

    expect(await screen.findByText("No results")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "evo-search-empty-s3" })).toBeNull();
  });
});

describe("REQ-3-5 archive and restore a repository", () => {
  it("lets the repository Admin archive the repository and keeps the marker after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin", "Evo-Password-987!");

    await openFromWorkspace(user, "evo-archive-repository-s1");
    expect(screen.queryByText("Archived")).toBeNull();

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    await user.click(await screen.findByRole("link", { name: "General" }));
    const general = await screen.findByRole("region", { name: "General" });

    await user.click(within(general).getByRole("button", { name: "Archive repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm archive" }));

    const overview = await screen.findByRole("heading", { name: /evo-archive-repository-s1/ });
    expect(overview.textContent).toContain("evo-archive-repository-s1");
    expect(screen.getByText("Archived")).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: /evo-archive-repository-s1/ })).not.toBeNull();
    expect(screen.getByText("Archived")).not.toBeNull();
  });

  it("keeps an archived repository readable without actionable write controls", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-viewer", "Evo-Password-987!");

    await openFromWorkspace(user, "evo-archive-repository-s2");
    expect(screen.getByText("Archived")).not.toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "Issues" }));
    await screen.findByRole("heading", { name: "Issues" });
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();

    act(() => navigate("/repositories/evo-archive-owner/evo-archive-repository-s2/pulls"));
    await screen.findByRole("heading", { name: "Pull requests" });
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();
  });

  it("restores an archived repository and clears the marker", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin", "Evo-Password-987!");

    await openFromWorkspace(user, "evo-archive-repository-s3");
    expect(screen.getByText("Archived")).not.toBeNull();

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("link", { name: "General" }));
    const general = await screen.findByRole("region", { name: "General" });

    await user.click(within(general).getByRole("button", { name: "Restore repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm restore" }));

    await screen.findByRole("heading", { name: /evo-archive-repository-s3/ });
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: /evo-archive-repository-s3/ })).not.toBeNull();
    expect(screen.queryByText("Archived")).toBeNull();
  });
});
