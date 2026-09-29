import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepositorySettingsPage } from "./RepositorySettingsPage";
import { SessionProvider } from "../auth/session";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  getRepository: vi.fn(),
  setRepositoryVisibility: vi.fn(),
}));

vi.mock("../auth/api", () => ({
  fetchSession: mocks.fetchSession,
}));

vi.mock("./api", () => ({
  getRepository: mocks.getRepository,
  setRepositoryVisibility: mocks.setRepositoryVisibility,
}));

const now = new Date().toISOString();

const privateRepository = {
  owner: "acme-demo",
  name: "secret-research",
  description: "Research notes and experiments",
  visibility: "private" as const,
  defaultBranch: "main",
  updatedAt: now,
  myRole: "admin",
  files: [{ name: "README.md", path: "README.md", type: "file" as const }],
  forkSource: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSession.mockResolvedValue({ authenticated: true, account: { username: "alice-dev", email: "alice.dev@example.test" } });
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

function renderSettings(repository: unknown = privateRepository) {
  mocks.getRepository.mockResolvedValue(repository);
  return render(
    <SessionProvider>
      <RepositorySettingsPage owner="acme-demo" name="secret-research" />
    </SessionProvider>,
  );
}

describe("RepositorySettingsPage Danger Zone", () => {
  it("shows Danger Zone with Change visibility for an admin", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeTruthy();
    expect(screen.getByText(/currently Private/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change visibility" })).toBeTruthy();
  });

  it("denies non-Admin collaborators the settings page entirely", async () => {
    mocks.getRepository.mockResolvedValue({ ...privateRepository, myRole: "read" });
    render(
      <SessionProvider>
        <RepositorySettingsPage owner="acme-demo" name="secret-research" />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "Access denied" });
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Danger Zone" })).toBeNull();
  });

  it("confirms visibility with the Public radio and the repository name", async () => {
    const user = userEvent.setup();
    mocks.setRepositoryVisibility.mockResolvedValue({ ...privateRepository, visibility: "public" });
    renderSettings();
    await screen.findByRole("heading", { name: "Settings" });

    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change repository visibility" });
    const publicRadio = dialog.querySelector('input[name="visibility"][value="public"]') as HTMLInputElement;
    expect(publicRadio.checked).toBe(false);
    await user.click(screen.getByRole("radio", { name: "Public" }));
    expect(publicRadio.checked).toBe(true);

    await user.type(screen.getByLabelText("Repository name"), "acme-demo/secret-research");
    await user.click(screen.getByRole("button", { name: "Confirm visibility" }));

    await waitFor(() =>
      expect(mocks.setRepositoryVisibility).toHaveBeenCalledWith("acme-demo", "secret-research", "public"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Change repository visibility" })).toBeNull());
    expect(screen.getByText(/currently Public/)).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("keeps visibility Private when the confirmation text does not match", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "Settings" });

    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    await screen.findByRole("dialog", { name: "Change repository visibility" });
    await user.click(screen.getByRole("radio", { name: "Public" }));
    await user.type(screen.getByLabelText("Repository name"), "wrong-name");
    await user.click(screen.getByRole("button", { name: "Confirm visibility" }));

    expect(await screen.findByText("Repository name does not match")).toBeTruthy();
    expect(mocks.setRepositoryVisibility).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Change repository visibility" })).toBeTruthy();
    expect(screen.getByText(/currently Private/)).toBeTruthy();
  });
});
