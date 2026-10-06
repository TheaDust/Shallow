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
  it("archives an active repository through the confirmation dialog and keeps the marker after reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    await user.click(await screen.findByRole("link", { name: "evo-archive-repository-s1" }));
    const heading = await screen.findByRole("heading", { name: /evo-archive-repository-s1/ });
    expect(heading.textContent).toContain("Acme Demo/evo-archive-repository-s1");
    expect(screen.queryByText("Archived")).toBeNull();

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    await user.click(await screen.findByRole("link", { name: "General" }));

    const general = await screen.findByRole("region", { name: "General" });
    await user.click(within(general).getByRole("button", { name: "Archive repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm archive" }));

    const overview = await screen.findByRole("heading", { name: /evo-archive-repository-s1/ });
    expect(overview.textContent).toContain("Acme Demo/evo-archive-repository-s1");
    expect(screen.getByText("Archived")).not.toBeNull();

    // The stored status survives reloading the overview.
    reload();
    expect((await screen.findByRole("heading", { name: /evo-archive-repository-s1/ })).textContent).toContain(
      "Acme Demo/evo-archive-repository-s1",
    );
    expect(screen.getByText("Archived")).not.toBeNull();
  });

  it("keeps an archived repository readable without any actionable write control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-viewer");

    await user.click(await screen.findByRole("link", { name: "evo-archive-repository-s2" }));
    const heading = await screen.findByRole("heading", { name: /evo-archive-repository-s2/ });
    expect(heading.textContent).toContain("Acme Demo/evo-archive-repository-s2");
    expect(screen.getByText("Archived")).not.toBeNull();

    // The stored content stays readable.
    await user.click(screen.getByRole("link", { name: "README.md" }));
    expect(await screen.findByRole("heading", { name: "README.md" })).not.toBeNull();

    act(() => navigate("/repositories/acme-demo/evo-archive-repository-s2"));
    await screen.findByRole("heading", { name: /evo-archive-repository-s2/ });
    expect(screen.queryByRole("button", { name: /Add file/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();

    act(() => navigate("/repositories/acme-demo/evo-archive-repository-s2/issues"));
    await screen.findByRole("heading", { name: "Issues" });
    expect(screen.queryByRole("link", { name: "New issue" })).toBeNull();

    act(() => navigate("/repositories/acme-demo/evo-archive-repository-s2/pulls"));
    await screen.findByRole("heading", { name: "Pull requests" });
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();
  });

  it("restores an archived repository and shows its content again", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "evo-archive-admin");

    await user.click(await screen.findByRole("link", { name: "evo-archive-repository-s3" }));
    await screen.findByRole("heading", { name: /evo-archive-repository-s3/ });
    expect(screen.getByText("Archived")).not.toBeNull();

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    await user.click(await screen.findByRole("link", { name: "General" }));

    const general = await screen.findByRole("region", { name: "General" });
    await user.click(within(general).getByRole("button", { name: "Restore repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore repository" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm restore" }));

    const overview = await screen.findByRole("heading", { name: /evo-archive-repository-s3/ });
    expect(overview.textContent).toContain("Acme Demo/evo-archive-repository-s3");
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();

    reload();
    await screen.findByRole("heading", { name: /evo-archive-repository-s3/ });
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.getByRole("link", { name: "README.md" })).not.toBeNull();
  });
});
