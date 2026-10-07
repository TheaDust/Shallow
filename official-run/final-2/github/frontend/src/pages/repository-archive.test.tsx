import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { navigate } from "../lib/hash-route";
import { createFakeApi, type FakeApi } from "../test/fake-api";
import { reply } from "../test/fake-response";

const EVOLUTION_PASSWORD = "Evo-Password-987!";

let api: FakeApi;

function reload() {
  cleanup();
  render(<App />);
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  await user.click(await screen.findByRole("link", { name: "Sign in" }));
  await user.type(screen.getByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), EVOLUTION_PASSWORD);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens one readable repository from the signed-in workspace entry. */
async function openRepository(user: ReturnType<typeof userEvent.setup>, name: string) {
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

describe("REQ-3-5 archive and restore a repository", () => {
  it("lets the repository admin archive the repository and keeps the marker after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    const heading = await openRepository(user, "evo-archive-repository-s1");
    expect(heading.textContent).toContain("Acme Demo/evo-archive-repository-s1");
    expect(screen.queryByText("Archived")).toBeNull();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    const general = await screen.findByRole("region", { name: "General" });

    await user.click(within(general).getByRole("button", { name: "Archive repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm archive" }));

    // The overview is the view that carries the marker.
    const overview = await screen.findByRole("heading", { name: /evo-archive-repository-s1/ });
    expect(overview.textContent).toContain("Acme Demo/evo-archive-repository-s1");
    expect(screen.getByText("Archived")).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: /evo-archive-repository-s1/ })).not.toBeNull();
    expect(screen.getByText("Archived")).not.toBeNull();
  });

  it("keeps the archived repository readable while no write control is offered", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-viewer");

    const heading = await openRepository(user, "evo-archive-repository-s2");
    expect(heading.textContent).toContain("Acme Demo/evo-archive-repository-s2");
    expect(screen.getByText("Archived")).not.toBeNull();
    // The reader never administers the repository, so Settings is absent.
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();

    // The stored content still reads on the archived repository.
    await user.click(await screen.findByRole("link", { name: "README.md" }));
    expect(await screen.findByRole("heading", { name: "README.md" })).not.toBeNull();
    expect(screen.getByText(/Content kept after archiving/)).not.toBeNull();

    // Issue creation is not offered on the archived repository.
    act(() => navigate("/repositories/acme-demo/evo-archive-repository-s2/issues"));
    await screen.findByRole("heading", { name: "Issues" });
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();

    // Pull-request creation is not offered either.
    act(() => navigate("/repositories/acme-demo/evo-archive-repository-s2/pulls"));
    await screen.findByRole("heading", { name: "Pull requests" });
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();

    // The web editor reports the missing write permission instead of a form.
    act(() => navigate("/repositories/acme-demo/evo-archive-repository-s2/new"));
    await screen.findByRole("heading", { name: "Create new file" });
    expect(await screen.findByText(/write permission/i)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Commit changes" })).toBeNull();
  });

  it("restores an archived repository and keeps its existing content", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    await openRepository(user, "evo-archive-repository-s3");
    expect(screen.getByText("Archived")).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    const general = await screen.findByRole("region", { name: "General" });
    expect(within(general).getByText("Archived")).not.toBeNull();

    await user.click(within(general).getByRole("button", { name: "Restore repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm restore" }));

    const overview = await screen.findByRole("heading", { name: /evo-archive-repository-s3/ });
    expect(overview.textContent).toContain("Acme Demo/evo-archive-repository-s3");
    expect(screen.queryByText("Archived")).toBeNull();
    // The existing content stays visible after the restore.
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    reload();
    expect(await screen.findByRole("heading", { name: /evo-archive-repository-s3/ })).not.toBeNull();
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
  });

  it("leaves for the overview address as soon as the restore is confirmed, so a reload keeps the content", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    await openRepository(user, "evo-archive-repository-s3");
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    const general = await screen.findByRole("region", { name: "General" });

    await user.click(within(general).getByRole("button", { name: "Restore repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm restore" }));

    // The confirmation returns to the repository overview before the request
    // settles, so a reload of the repository overview reads that view.
    expect(window.location.hash).toBe("#/repositories/acme-demo/evo-archive-repository-s3");

    reload();
    expect(await screen.findByRole("heading", { name: /evo-archive-repository-s3/ })).not.toBeNull();
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
  });

  it("reports a refused confirmation on the overview and keeps the stored status", async () => {
    const user = userEvent.setup();
    // The trusted boundary still refuses a caller the UI let through, so the
    // confirmation leaves the stored status untouched and says why.
    const realFetch = api.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.endsWith("/archive")) {
        return Promise.resolve(reply(403, { message: "You do not have access to this repository" }));
      }
      return realFetch(input, init);
    });

    render(<App />);
    await signInAs(user, "evo-archive-admin");
    await openRepository(user, "evo-archive-repository-s3");

    await user.click(screen.getByRole("link", { name: "Settings" }));
    const general = await screen.findByRole("region", { name: "General" });
    await user.click(within(general).getByRole("button", { name: "Restore repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm restore" }));

    // The overview reports the failure and still shows the stored status.
    expect((await screen.findByRole("alert")).textContent).toContain("access");
    expect(await screen.findByRole("heading", { name: /evo-archive-repository-s3/ })).not.toBeNull();
    expect(screen.getByText("Archived")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "README.md" })).not.toBeNull();
  });

  it("offers a non-administrator no archive control on the settings page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-viewer");

    await openRepository(user, "evo-archive-repository-s1");
    act(() => navigate("/repositories/acme-demo/evo-archive-repository-s1/settings"));
    await screen.findByRole("heading", { name: "Settings" });
    await screen.findByRole("region", { name: "General" });

    expect(screen.queryByRole("button", { name: "Archive repository" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore repository" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Archive repository" })).toBeNull();
  });
});
