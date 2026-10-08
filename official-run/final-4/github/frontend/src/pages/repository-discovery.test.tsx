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
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Types into the top global searchbox and submits it with Enter. */
async function searchFor(user: ReturnType<typeof userEvent.setup>, query: string) {
  const box = await screen.findByRole("searchbox", { name: "Search" });
  await user.clear(box);
  await user.type(box, `${query}{Enter}`);
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

describe("REQ-3-1 search for and locate repositories", () => {
  it("opens the exact result link of a public repository and keeps the overview after reload", async () => {
    const user = userEvent.setup();
    render(<App />);

    await searchFor(user, "acme-docs");

    const result = await screen.findByRole("link", { name: "acme-docs" });
    expect(result.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs");
    await user.click(result);

    const heading = await screen.findByRole("heading", { name: /acme-docs/ });
    expect(heading.textContent).toContain("Acme Demo/acme-docs");

    reload();
    expect(await screen.findByRole("heading", { name: /acme-docs/ })).not.toBeNull();
  });

  it("exposes no result link for a private repository and reports no results for an unknown name", async () => {
    const user = userEvent.setup();
    render(<App />);

    await searchFor(user, "secret-research");
    expect(await screen.findByText("No results")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    // Returning home and repeating the same query is still empty.
    await user.click(screen.getByRole("link", { name: "Home" }));
    await searchFor(user, "secret-research");
    expect(await screen.findByText("No results")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    await searchFor(user, "no-such-repository");
    expect(await screen.findByText("No results")).not.toBeNull();
  });
});

describe("REQ-3-3 view a public repository overview", () => {
  it("opens the visible public repository entry and keeps heading, marker and Code link after reload", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "acme-docs" }));

    const heading = await screen.findByRole("heading", { name: /acme-docs/ });
    expect(heading.textContent).toContain("Acme Demo/acme-docs");
    expect(screen.getByText("Public")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Code" })).not.toBeNull();

    reload();
    const reloaded = await screen.findByRole("heading", { name: /acme-docs/ });
    expect(reloaded.textContent).toContain("Acme Demo/acme-docs");
    expect(screen.getByText("Public")).not.toBeNull();
  });

  it("keeps a private repository out of the visitor entry points", async () => {
    render(<App />);

    await screen.findByRole("link", { name: "acme-docs" });
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(screen.queryByRole("link", { name: "visibility-demo" })).toBeNull();

    act(() => navigate("/repositories/acme-demo/secret-research"));
    expect(await screen.findByRole("heading", { name: "Access denied" })).not.toBeNull();
  });
});

describe("REQ-3-4 change repository visibility with permission checks", () => {
  it("lets the administrator publish the repository and keeps it readable to a visitor", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "visibility-admin");

    await user.click(await screen.findByRole("link", { name: "visibility-demo" }));
    expect((await screen.findByRole("heading", { name: /visibility-demo/ })).textContent).toContain(
      "visibility-demo",
    );
    expect(screen.getByText("Private")).not.toBeNull();

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).not.toBeNull();
    await user.click(await screen.findByRole("link", { name: "General" }));

    const general = await screen.findByRole("region", { name: "General" });
    expect(within(general).getByText("Private")).not.toBeNull();

    await user.click(within(general).getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change visibility" });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    const overview = await screen.findByRole("heading", { name: /visibility-demo/ });
    expect(overview.textContent).toContain("Acme Demo/visibility-demo");
    expect(screen.getByText("Public")).not.toBeNull();

    // A visitor in a fresh session can still open the repository.
    api.setSignedIn("no-longer-signed-in");
    act(() => navigate("/repositories/acme-demo/visibility-demo"));
    reload();
    expect(await screen.findByRole("heading", { name: /visibility-demo/ })).not.toBeNull();
    expect(screen.getByText("Public")).not.toBeNull();
  });

  it("shows a non-admin collaborator no actionable Change visibility button", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signInAs(user, "collaborator");

    await user.click(await screen.findByRole("link", { name: "visibility-demo" }));
    await screen.findByRole("heading", { name: /visibility-demo/ });
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();

    act(() => navigate("/repositories/acme-demo/visibility-demo/settings"));
    await screen.findByRole("heading", { name: "Settings" });
    await screen.findByRole("region", { name: "General" });
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Change visibility" })).toBeNull();
  });
});
