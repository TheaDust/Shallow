import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";

const OWNER = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

const MEMBER = {
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  password: "Valid-password-123!",
};

function acmeDemo(
  grants: NonNullable<StubOrganization["repositories"]>[number]["grants"],
): StubOrganization {
  return {
    name: "acme-demo",
    displayName: "Acme Demo",
    members: [
      { username: "alice-dev", role: "owner" },
      { username: "bob-reviewer", role: "member" },
    ],
    teams: [{ name: "platform-team" }],
    repositories: [
      {
        name: "acme-docs",
        description: "Documentation for the Acme Demo platform.",
        visibility: "public",
        files: [{ path: "README.md", content: "# Acme Docs\n" }],
      },
      {
        name: "secret-research",
        description: "Private research notes for Acme Demo.",
        visibility: "private",
        files: [
          { path: "README.md", content: "# Secret research\n" },
          { path: "research/notes.md", content: "# Notes\n" },
        ],
        grants,
      },
    ],
  };
}

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Unmount and mount again against the same stub state, like a page reload. */
function reload() {
  cleanup();
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  renderApp("#/login");
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

async function openGeneral(
  user: ReturnType<typeof userEvent.setup>,
  fromOverview = true,
) {
  if (fromOverview) window.location.hash = "#/repositories/acme-demo/secret-research";
  await user.click(await screen.findByRole("link", { name: "Settings" }));
  const general = await screen.findByRole("link", { name: "General" });
  await user.click(general);
  await screen.findByRole("heading", { name: "Danger Zone" });
}

function visibilityRadio(name: string): HTMLInputElement {
  return screen.getByRole("radio", { name }) as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-3-4 change repository visibility with permission checks", () => {
  it("an Admin picks Public in the Danger Zone, confirms, and the change survives a reload", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [acmeDemo([])] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    await openGeneral(user);

    // The Danger Zone offers the action and the current value.
    expect(visibilityRadio("Public").checked).toBe(false);
    expect(visibilityRadio("Private").checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Change repository visibility",
    });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    // The confirmation never requires retyping the repository name.
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    expect(await screen.findByText("Repository visibility updated.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Refreshing the settings page keeps the stored result.
    reload();
    await screen.findByRole("heading", { name: "Danger Zone" });
    expect(visibilityRadio("Public").checked).toBe(true);
    expect(visibilityRadio("Private").checked).toBe(false);

    // Signing out leaves the change on the server: the visitor now reads the
    // repository from its direct address and sees the Public marker.
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    const signOutDialog = await screen.findByRole("dialog", { name: "Sign out" });
    await user.click(within(signOutDialog).getByRole("button", { name: "Confirm sign out" }));

    window.location.hash = "#/repositories/acme-demo/secret-research";
    expect(
      await screen.findByRole("heading", { name: "acme-demo/secret-research" }),
    ).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("accepts the confirmation in any order of the visible controls", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [acmeDemo([])] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    await openGeneral(user);

    // Opening the confirmation first and selecting afterwards works as well.
    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Change repository visibility",
    });
    await user.click(await screen.findByRole("radio", { name: "Public" }));
    await user.click(screen.getByRole("button", { name: "Confirm visibility" }));

    expect(await screen.findByText("Repository visibility updated.")).toBeTruthy();
    reload();
    await screen.findByRole("heading", { name: "Danger Zone" });
    expect(visibilityRadio("Public").checked).toBe(true);
  });

  it("refuses a confirmation name that does not match and keeps the repository Private", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [acmeDemo([])] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    await openGeneral(user);

    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Change repository visibility",
    });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.type(within(dialog).getByLabelText("Repository name"), "acme-docs");
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    expect(await within(dialog).findByText("Repository name does not match")).toBeTruthy();

    reload();
    await screen.findByRole("heading", { name: "Danger Zone" });
    expect(visibilityRadio("Private").checked).toBe(true);
  });

  it("keeps a mistyped confirmation in the flow and applies the corrected retry", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [acmeDemo([])] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    await openGeneral(user);

    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Change repository visibility",
    });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.type(within(dialog).getByLabelText("Repository name"), "acme-docs");
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));
    await within(dialog).findByText("Repository name does not match");

    await user.clear(within(dialog).getByLabelText("Repository name"));
    await user.type(within(dialog).getByLabelText("Repository name"), "secret-research");
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    expect(await screen.findByText("Repository visibility updated.")).toBeTruthy();
    reload();
    await screen.findByRole("heading", { name: "Danger Zone" });
    expect(visibilityRadio("Public").checked).toBe(true);
  });

  it("leaves the stored visibility in place when the confirmation is cancelled", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [acmeDemo([])] });
    const user = userEvent.setup();
    await signIn(user, OWNER.username);
    await openGeneral(user);

    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Change repository visibility",
    });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(visibilityRadio("Private").checked).toBe(true);
    expect(visibilityRadio("Public").checked).toBe(false);
  });

  it("a non-Admin collaborator with a Settings link never gets the visibility action", async () => {
    installAuthStub({
      accounts: [OWNER, MEMBER],
      organizations: [
        acmeDemo([{ subjectType: "account", subjectName: "bob-reviewer", role: "write" }]),
      ],
    });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);

    window.location.hash = "#/repositories/acme-demo/secret-research";
    // The collaborator may read the private repository and therefore sees the
    // Settings entry.
    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("link", { name: "General" }));
    await screen.findByRole("heading", { name: "Danger Zone" });

    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Public" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Private" })).toBeNull();
  });

  it("never exposes the settings of a private repository to a visitor", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [acmeDemo([])] });
    renderApp("#/repositories/acme-demo/secret-research/settings/general");

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
  });
});
