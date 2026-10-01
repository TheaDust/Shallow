import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";
import {
  PULLS_ADDRESS,
  PULLS_SEED_ORGANIZATION,
  PULL_OWNER,
  PULL_REVIEWER,
} from "../../test-support/pull-fixtures";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again, like a reload of the same address. */
function reload() {
  cleanup();
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** The meta paragraph of one detail element, whose number it also carries. */
function metaParagraph(text: string): HTMLElement {
  const paragraph = screen.getByText(text).closest("p");
  if (paragraph === null) throw new Error(`no meta paragraph for ${text}`);
  return paragraph as HTMLElement;
}

/** The native button of one accessible name, for its `disabled` state. */
function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

/** Opens one comparison entry with the branches of the address preselected. */
async function openComparison(options: { base?: string; compare?: string } = {}) {
  const query =
    options.base || options.compare ? `?base=${options.base ?? ""}&compare=${options.compare ?? ""}` : "";
  window.location.hash = `${PULLS_ADDRESS}/new${query}`;
  await screen.findByLabelText("base");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-6-2-2 compare branches before opening a pull request", () => {
  it("compares the selected branches and offers both creation entries", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    await openComparison();

    // The page opens on the default branch pair, so there is nothing to merge.
    expect(screen.getByText("No changes")).toBeTruthy();
    expect(button("Create pull request").disabled).toBe(true);
    expect(button("Create draft pull request").disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText("base"), "main");
    await user.selectOptions(screen.getByLabelText("compare"), "feature-search");

    // The known changed file path, the comparable commit summary and the
    // enabled creation entries appear without clicking `Compare changes`.
    expect(await screen.findByText("src/search.ts")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
    expect(button("Create pull request").disabled).toBe(false);
    expect(button("Create draft pull request").disabled).toBe(false);

    // Clicking the dedicated comparison button retains the same result.
    await user.click(screen.getByRole("button", { name: "Compare changes" }));
    expect(await screen.findByText("src/search.ts")).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
  });

  it("selecting the same branch in both fields explains No changes and disables creation", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    await openComparison({ base: "main", compare: "feature-search" });
    expect(await screen.findByText("src/search.ts")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("compare"), "main");
    expect(await screen.findByText("No changes")).toBeTruthy();
    expect(button("Create pull request").disabled).toBe(true);
    expect(button("Create draft pull request").disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Compare changes" }));
    expect(screen.getByText("No changes")).toBeTruthy();
    expect(button("Create pull request").disabled).toBe(true);
  });

  it("a Read collaborator never reaches the comparison flow", async () => {
    const organization: StubOrganization = {
      ...PULLS_SEED_ORGANIZATION,
      repositories: (PULLS_SEED_ORGANIZATION.repositories ?? []).map((repository) => ({
        ...repository,
        grants: [{ subjectType: "account", subjectName: "bob-reviewer", role: "read" }],
      })),
    };
    installAuthStub({ accounts: [PULL_OWNER, PULL_REVIEWER], organizations: [organization] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "bob-reviewer");
    window.location.hash = `${PULLS_ADDRESS}/compare?base=main&compare=feature-search`;

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByText("src/search.ts")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create pull request" })).toBeNull();
  });
});

describe("REQ-6-2-3 create a pull request from comparison results", () => {
  it("creates the Open pull request from the comparison form and keeps it after a reload", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    await openComparison({ base: "main", compare: "feature-search" });
    expect(await screen.findByText("src/search.ts")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.type(await screen.findByLabelText("Title"), "Add search docs");
    await user.type(screen.getByLabelText("Description"), "Document the search flow.");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    // The new detail page shows title, status, branches, author and number.
    expect(await screen.findByRole("heading", { name: "Add search docs" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("#8")).toBeTruthy();
    expect(screen.getByText("feature-search → main")).toBeTruthy();
    expect(within(metaParagraph("#8")).getByText("alice-dev")).toBeTruthy();
    expect(screen.getByText("Document the search flow.")).toBeTruthy();

    const address = window.location.hash;
    reload();
    expect(await screen.findByRole("heading", { name: "Add search docs" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(window.location.hash).toBe(address);

    // The list also shows the persisted pull request.
    window.location.hash = PULLS_ADDRESS;
    expect(await screen.findByRole("link", { name: "Add search docs" })).toBeTruthy();
  });

  it("rejects a title of spaces with Title is required and creates nothing", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    await openComparison({ base: "main", compare: "feature-search" });
    expect(await screen.findByText("src/search.ts")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.type(await screen.findByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(window.location.hash).toContain("/pulls/new");
    expect(screen.getByLabelText("Title")).toBeTruthy();

    // Nothing was stored: the list still holds only the seeded records.
    window.location.hash = PULLS_ADDRESS;
    await screen.findByRole("link", { name: "Improve onboarding" });
    expect(screen.queryByRole("link", { name: "Add search docs" })).toBeNull();
  });

  it("rejects a second Open pull request of the same branch pair", async () => {
    installAuthStub({ accounts: [PULL_OWNER], organizations: [PULLS_SEED_ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/");
    await signIn(user, "alice-dev");
    await openComparison({ base: "main", compare: "feature-search" });
    expect(await screen.findByText("src/search.ts")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.type(await screen.findByLabelText("Title"), "Add search docs");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await screen.findByRole("heading", { name: "Add search docs" });

    // A second creation of the very same comparison is refused, so the stored
    // record stays the only one of its branch pair.
    await openComparison({ base: "main", compare: "feature-search" });
    expect(await screen.findByText("src/search.ts")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    await user.type(await screen.findByLabelText("Title"), "Add search docs again");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    window.location.hash = PULLS_ADDRESS;
    await screen.findByRole("link", { name: "Add search docs" });
    expect(screen.queryByRole("link", { name: "Add search docs again" })).toBeNull();
  });
});
