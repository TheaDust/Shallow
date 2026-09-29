import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewRepositoryPage } from "./NewRepositoryPage";
import { SessionProvider } from "../auth/session";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  listOrganizations: vi.fn(),
  createRepository: vi.fn(),
}));

vi.mock("../auth/api", () => ({
  fetchSession: mocks.fetchSession,
}));

vi.mock("./api", () => ({
  listOrganizations: mocks.listOrganizations,
  createRepository: mocks.createRepository,
}));

const now = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSession.mockResolvedValue({
    authenticated: true,
    account: { username: "alice-dev", email: "alice.dev@example.test" },
  });
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

function renderPage() {
  return render(
    <SessionProvider>
      <NewRepositoryPage />
    </SessionProvider>,
  );
}

describe("NewRepositoryPage", () => {
  it("renders the labeled fields, visibility radios, README checkbox and Create repository button", async () => {
    mocks.listOrganizations.mockResolvedValue([
      { id: "acme-demo", displayName: "Acme Demo", createdAt: now, role: "owner" },
      { id: "other-guild", displayName: "Other Guild", createdAt: now, role: "member" },
    ]);
    renderPage();

    const owner = (await screen.findByLabelText("Owner")) as HTMLSelectElement;
    await waitFor(() =>
      expect([...owner.options].some((option) => option.value === "acme-demo")).toBe(true),
    );
    expect(screen.getByLabelText("Repository name")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Public" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Private" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Add a README file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create repository" })).toBeTruthy();

    // Personal namespace is selected by default and selectable; only
    // organizations where the user is an Owner appear.
    expect(owner.value).toBe("alice-dev");
    const options = [...owner.options].map((option) => option.value);
    expect(options).toEqual(["alice-dev", "acme-demo"]);
  });

  it("submits the private initialized repository and opens the new overview", async () => {
    const user = userEvent.setup();
    mocks.listOrganizations.mockResolvedValue([]);
    mocks.createRepository.mockResolvedValue({
      ok: true,
      repository: {
        owner: "alice-dev",
        name: "playwright-project",
        description: "Repository created by Playwright",
        visibility: "private",
        defaultBranch: "main",
        updatedAt: now,
      },
    });
    renderPage();
    await screen.findByLabelText("Owner");

    await user.type(screen.getByLabelText("Repository name"), "playwright-project");
    await user.type(screen.getByLabelText("Description"), "Repository created by Playwright");
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    await waitFor(() =>
      expect(mocks.createRepository).toHaveBeenCalledWith({
        owner: "alice-dev",
        name: "playwright-project",
        description: "Repository created by Playwright",
        visibility: "private",
        initialize: true,
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/repos/alice-dev/playwright-project"));
  });

  it("stays on the form and shows the duplicate-name error without navigating", async () => {
    const user = userEvent.setup();
    mocks.listOrganizations.mockResolvedValue([]);
    mocks.createRepository.mockResolvedValue({
      ok: false,
      errors: { name: "Repository name already exists" },
    });
    renderPage();
    await screen.findByLabelText("Owner");

    await user.type(screen.getByLabelText("Repository name"), "acme-docs-fork");
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByText("Repository name already exists")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create repository" })).toBeTruthy();
    expect(window.location.hash).toBe("");
  });

  it("shows the empty-name error and retains the typed description", async () => {
    const user = userEvent.setup();
    mocks.listOrganizations.mockResolvedValue([]);
    mocks.createRepository.mockResolvedValue({
      ok: false,
      errors: { name: "Repository name is required" },
    });
    renderPage();
    await screen.findByLabelText("Owner");

    await user.type(screen.getByLabelText("Description"), "Repository created by Playwright");
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByText("Repository name is required")).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe(
      "Repository created by Playwright",
    );
  });

  it("shows the permission reason for an organization the user cannot create in", async () => {
    const user = userEvent.setup();
    mocks.listOrganizations.mockResolvedValue([]);
    mocks.createRepository.mockResolvedValue({
      ok: false,
      errors: { owner: "You do not have permission to create a repository in this namespace" },
    });
    renderPage();
    await screen.findByLabelText("Owner");

    await user.type(screen.getByLabelText("Repository name"), "some-repo");
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(
      await screen.findByText("You do not have permission to create a repository in this namespace"),
    ).toBeTruthy();
    expect(window.location.hash).toBe("");
  });
});
