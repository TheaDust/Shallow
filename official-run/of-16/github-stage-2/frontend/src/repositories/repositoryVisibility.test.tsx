import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeAccount, type FakeAccessGrant } from "../test-utils/fake-api";

const REPOSITORY_HASH = "#/users/visibility-admin/repositories/visibility-demo";
const GENERAL_HASH = `${REPOSITORY_HASH}/settings/general`;

const ADMIN: FakeAccount = {
  username: "visibility-admin",
  email: "visibility-admin@example.test",
  password: "Valid-password-123!",
  repositories: [
    {
      name: "visibility-demo",
      description: "Demonstrates changing repository visibility.",
      visibility: "private",
      updatedAt: "2024-05-06T09:00:00.000Z",
    },
  ],
};

const COLLABORATOR: FakeAccount = {
  username: "collaborator",
  email: "collaborator@example.test",
  password: "Valid-password-123!",
};

// The collaborator holds a non-admin Write grant on the repository.
const SEED_GRANTS: FakeAccessGrant[] = [
  { id: "grant-visibility-demo-collaborator", repositoryName: "visibility-demo", username: "collaborator", role: "write" },
];

function fixture() {
  return createFakeApi({
    accounts: [ADMIN, COLLABORATOR],
    organizations: [],
    grants: SEED_GRANTS,
  });
}

function goto(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

function install(username: string | null) {
  const api = fixture();
  api.install();
  api.signInAs(username);
  return api;
}

async function openRepository(username: string | null, hash = REPOSITORY_HASH) {
  const api = install(username);
  goto(hash);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("main");
  return { api, user };
}

/** The stored repository record of the repository under test. */
function storedRepository(api: ReturnType<typeof fixture>) {
  return api.accounts.find((account) => account.username === "visibility-admin")
    ?.repositories?.find((repository) => repository.name === "visibility-demo") ?? null;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("REQ-3-4 change repository visibility with permission checks", () => {
  it("scenario 1: the administrator opens Settings and General, confirms Public and the overview shows it", async () => {
    const api = install("visibility-admin");
    const user = userEvent.setup();
    goto("#/");
    render(<App />);

    // The home page is the signed-in workspace, which lists the personal
    // repository of the administrator.
    const entry = await screen.findByRole("link", { name: "visibility-demo" });
    await user.click(entry);
    await waitFor(() => expect(window.location.hash).toBe(REPOSITORY_HASH));
    expect(await screen.findByRole("heading", { name: "visibility-admin/visibility-demo" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await waitFor(() => expect(window.location.hash).toBe(`${REPOSITORY_HASH}/settings`));
    await user.click(await screen.findByRole("link", { name: "General" }));
    await waitFor(() => expect(window.location.hash).toBe(GENERAL_HASH));

    // The confirmation flow offers the Public radio and the confirm button.
    await user.click(await screen.findByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change visibility" });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Public")).toBeTruthy();
    expect(storedRepository(api)?.visibility).toBe("public");

    // The repository overview displays the Public marker as well.
    await user.click(screen.getByRole("link", { name: "visibility-demo" }));
    await waitFor(() => expect(window.location.hash).toBe(REPOSITORY_HASH));
    expect(await screen.findByRole("heading", { name: "visibility-admin/visibility-demo" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();

    // Reloading the settings section keeps the stored value.
    cleanup();
    render(<App />);
    goto(GENERAL_HASH);
    expect(await screen.findByText("Public")).toBeTruthy();
  });

  it("scenario 1: after the session is cleared a visitor reopens the repository and sees its heading", async () => {
    const api = install("visibility-admin");
    const user = userEvent.setup();
    goto(GENERAL_HASH);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change visibility" });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));
    await waitFor(() => expect(storedRepository(api)?.visibility).toBe("public"));

    // The session cookies are cleared and the app is entered as a visitor.
    api.signInAs(null);
    cleanup();
    goto("#/");
    render(<App />);
    // The public directory of the home page now offers the repository.
    expect(await screen.findByRole("link", { name: "visibility-demo" })).toBeTruthy();

    goto(REPOSITORY_HASH);
    expect(await screen.findByRole("heading", { name: "visibility-admin/visibility-demo" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("a visitor cannot read the private repository before the change", async () => {
    await openRepository(null);
    expect(await screen.findByRole("heading", { name: "Repository not found" })).toBeTruthy();
  });

  it("scenario 2: the non-admin collaborator never sees an actionable Change visibility button", async () => {
    const api = install("collaborator");
    const user = userEvent.setup();
    goto(REPOSITORY_HASH);
    render(<App />);

    // The collaborator reads the repository but is offered no Settings entry and
    // therefore no visibility control.
    expect(await screen.findByRole("heading", { name: "visibility-admin/visibility-demo" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();

    // Even opening the general settings address directly keeps the control away.
    goto(GENERAL_HASH);
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();

    // Once the administrator has made the repository public, the collaborator
    // still holds no administrator permission on it.
    api.signInAs("visibility-admin");
    cleanup();
    goto(GENERAL_HASH);
    render(<App />);
    const admin = userEvent.setup();
    await admin.click(await screen.findByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change visibility" });
    await admin.click(within(dialog).getByRole("radio", { name: "Public" }));
    await admin.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));
    await waitFor(() => expect(storedRepository(api)?.visibility).toBe("public"));

    api.signInAs("collaborator");
    cleanup();
    goto(REPOSITORY_HASH);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "visibility-admin/visibility-demo" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
  });

  it("a rejected change reports the reason and keeps the stored visibility", async () => {
    const api = install("visibility-admin");
    const user = userEvent.setup();
    goto(GENERAL_HASH);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change visibility" });
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    // The session is no longer the repository administrator when the request runs.
    api.signInAs("collaborator");
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    expect(await within(dialog).findByText("Access denied")).toBeTruthy();
    expect(storedRepository(api)?.visibility).toBe("private");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Private")).toBeTruthy();
  });
});
