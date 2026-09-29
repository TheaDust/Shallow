import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationPage } from "./OrganizationPage";

const mocks = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  listRepositories: vi.fn(),
  listPeople: vi.fn(),
  listTeams: vi.fn(),
}));

vi.mock("./api", () => ({
  getOrganization: mocks.getOrganization,
  listRepositories: mocks.listRepositories,
  listPeople: mocks.listPeople,
  listTeams: mocks.listTeams,
}));

const now = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganization.mockResolvedValue({
    id: "acme-demo",
    displayName: "Acme Demo",
    createdAt: now,
    myRole: "owner",
  });
});

afterEach(() => {
  cleanup();
});

describe("OrganizationPage", () => {
  it("uses the organization name as heading and exposes link tabs", async () => {
    mocks.listRepositories.mockResolvedValue([]);
    render(<OrganizationPage orgId="acme-demo" tab="repositories" />);
    const heading = await screen.findByRole("heading", { name: "Acme Demo" });
    expect(heading.textContent).toContain("acme-demo");
    const repositories = screen.getByRole("link", { name: "Repositories" });
    const people = screen.getByRole("link", { name: "People" });
    const teams = screen.getByRole("link", { name: "Teams" });
    expect(repositories.getAttribute("href")).toBe("#/orgs/acme-demo/repositories");
    expect(people.getAttribute("href")).toBe("#/orgs/acme-demo/people");
    expect(teams.getAttribute("href")).toBe("#/orgs/acme-demo/teams");
  });

  it("lists only visible repositories with name, description, visibility and update time", async () => {
    mocks.listRepositories.mockResolvedValue([
      {
        owner: "acme-demo",
        name: "acme-docs",
        description: "Acme documentation",
        visibility: "public",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        owner: "acme-demo",
        name: "acme-private",
        description: "Internal Acme repository",
        visibility: "private",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    render(<OrganizationPage orgId="acme-demo" tab="repositories" />);

    const docs = await screen.findByRole("link", { name: "acme-docs" });
    expect(docs.getAttribute("href")).toBe("#/repos/acme-demo/acme-docs");
    const docsItem = docs.closest("li");
    expect(docsItem).toBeTruthy();
    expect(within(docsItem as HTMLElement).getByText("Acme documentation")).toBeTruthy();
    expect(within(docsItem as HTMLElement).getByText("Public")).toBeTruthy();
    expect(within(docsItem as HTMLElement).getByText(/Updated .*ago/)).toBeTruthy();

    expect(screen.getByRole("link", { name: "acme-private" })).toBeTruthy();
    const privateItem = screen.getByRole("link", { name: "acme-private" }).closest("li");
    expect(within(privateItem as HTMLElement).getByText("Private")).toBeTruthy();
  });

  it("filters repositories as the user types and by visibility", async () => {
    const user = userEvent.setup();
    mocks.listRepositories.mockResolvedValue([
      {
        owner: "acme-demo",
        name: "acme-docs",
        description: "",
        visibility: "public",
        updatedAt: now,
      },
      {
        owner: "acme-demo",
        name: "acme-private",
        description: "",
        visibility: "private",
        updatedAt: now,
      },
    ]);
    render(<OrganizationPage orgId="acme-demo" tab="repositories" />);
    await screen.findByRole("link", { name: "acme-docs" });

    const filter = screen.getByLabelText("Find a repository");
    await user.type(filter, "acme-private");
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
    expect(screen.getByRole("link", { name: "acme-private" })).toBeTruthy();

    await user.clear(filter);
    await user.selectOptions(screen.getByLabelText("Visibility"), "public");
    expect(screen.getByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "acme-private" })).toBeNull();
  });

  it("shows People with Member and Owner roles", async () => {
    mocks.listPeople.mockResolvedValue([
      { username: "alice-dev", role: "owner" },
      { username: "bob-reviewer", role: "member" },
    ]);
    render(<OrganizationPage orgId="acme-demo" tab="people" />);
    const list = await screen.findByRole("list");
    expect(within(list).getByText("alice-dev")).toBeTruthy();
    expect(within(list).getByText("Owner")).toBeTruthy();
    expect(within(list).getByText("bob-reviewer")).toBeTruthy();
    expect(within(list).getByText("Member")).toBeTruthy();
  });

  it("shows the team tree and the New team link only for owners", async () => {
    mocks.listTeams.mockResolvedValue([
      {
        id: "acme-demo:frontend-team",
        orgId: "acme-demo",
        name: "frontend-team",
        description: "",
        parentId: "acme-demo:platform-team",
        parentName: "platform-team",
        createdBy: "alice-dev",
        createdAt: now,
      },
      {
        id: "acme-demo:platform-team",
        orgId: "acme-demo",
        name: "platform-team",
        description: "",
        parentId: null,
        parentName: null,
        createdBy: "alice-dev",
        createdAt: now,
      },
    ]);
    render(<OrganizationPage orgId="acme-demo" tab="teams" />);
    expect(await screen.findByRole("link", { name: "New team" })).toBeTruthy();
    const frontend = screen.getByRole("link", { name: "frontend-team" });
    expect(frontend.getAttribute("href")).toBe("#/orgs/acme-demo/teams/frontend-team");
    expect(screen.getByText("Parent: platform-team")).toBeTruthy();
  });

  it("hides the New team link for non-owners", async () => {
    mocks.getOrganization.mockResolvedValue({
      id: "acme-demo",
      displayName: "Acme Demo",
      createdAt: now,
      myRole: "member",
    });
    mocks.listTeams.mockResolvedValue([]);
    render(<OrganizationPage orgId="acme-demo" tab="teams" />);
    await screen.findByRole("heading", { name: "Acme Demo" });
    expect(screen.queryByRole("link", { name: "New team" })).toBeNull();
  });
});
