import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub } from "../../test-support/auth-stub";
import { ISSUE_SEED_ORGANIZATION, ISSUES_ADDRESS, OWNER } from "../../test-support/issue-fixtures";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again, like a reload of the same address. */
function reload() {
  cleanup();
  return render(<App />);
}

function rowOf(title: string): HTMLElement {
  const link = screen.getByRole("link", { name: title });
  const row = link.closest("article");
  if (row === null) throw new Error(`no issue row for ${title}`);
  return row as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-5-1-1 list and filter repository issues", () => {
  it("shows every seeded row with its number, title, status, author and labels", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    renderApp(ISSUES_ADDRESS);

    // The state filter entries are links, and the search box is one searchbox.
    expect(await screen.findByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Closed" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search issues" })).toBeTruthy();

    const open = rowOf("Improve onboarding");
    expect(within(open).getByText("#1")).toBeTruthy();
    expect(within(open).getByText("Open")).toBeTruthy();
    expect(within(open).getByText("alice-dev")).toBeTruthy();
    expect(within(open).getByText("documentation")).toBeTruthy();

    const closed = rowOf("Legacy welcome text");
    expect(within(closed).getByText("#2")).toBeTruthy();
    expect(within(closed).getByText("Closed")).toBeTruthy();
    expect(within(closed).getByText("bug")).toBeTruthy();
  });

  it("filters the rows while the user types, without Enter", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp(ISSUES_ADDRESS);

    const search = await screen.findByRole("searchbox", { name: "Search issues" });
    await user.type(search, "onboarding");

    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();
    // The filter context lives in the address, so a reload keeps it.
    expect(window.location.hash).toContain("q=onboarding");

    // The whole seeded title matches as well.
    await user.clear(search);
    await user.type(search, "Improve onboarding");
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();
  });

  it("combines the state, keyword and label filters and switches to Closed", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp(ISSUES_ADDRESS);
    await screen.findByRole("link", { name: "Improve onboarding" });

    await user.click(screen.getByRole("link", { name: "Open" }));
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Legacy welcome text" })).toBeNull();

    await user.type(screen.getByRole("searchbox", { name: "Search issues" }), "onboarding");
    // The open issue does not carry `bug`, so only the label it holds keeps it.
    await user.click(screen.getByRole("checkbox", { name: "bug" }));
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "documentation" }));
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();

    // Only the display changes: switching to Closed shows the closed issue and
    // no longer the open one.
    await user.clear(screen.getByRole("searchbox", { name: "Search issues" }));
    await user.click(screen.getByRole("link", { name: "Closed" }));
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
  });

  it("keeps the chosen status, keyword and label filter and the rows after a reload", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp(ISSUES_ADDRESS);
    await screen.findByRole("link", { name: "Improve onboarding" });

    await user.click(screen.getByRole("link", { name: "Closed" }));
    await user.type(screen.getByRole("searchbox", { name: "Search issues" }), "Legacy");
    expect(window.location.hash).toContain("state=closed");
    expect(window.location.hash).toContain("q=Legacy");
    expect(screen.getByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();

    reload();
    expect(await screen.findByRole("link", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    expect(screen.getByRole("link", { name: "Closed" }).getAttribute("aria-current")).toBe("page");
    expect(
      (screen.getByRole("searchbox", { name: "Search issues" }) as HTMLInputElement).value,
    ).toBe("Legacy");
  });

  it("opens the issue detail from the title and from the number", async () => {
    installAuthStub({ accounts: [OWNER], organizations: [ISSUE_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp(ISSUES_ADDRESS);

    await user.click(await screen.findByRole("link", { name: "Improve onboarding" }));
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Describe the onboarding improvement.")).toBeTruthy();
    expect(window.location.hash).toBe("#/repositories/acme-demo/acme-docs/issues/1");

    window.location.hash = ISSUES_ADDRESS;
    await user.click(await screen.findByRole("link", { name: "#2" }));
    expect(await screen.findByRole("heading", { name: "Legacy welcome text" })).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
  });
});
