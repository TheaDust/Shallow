import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";

type Role = "Owner" | "Member";

interface RepositorySummary {
  name: string;
  owner: string;
  ownerType?: "organization" | "account";
  ownerDisplayName?: string;
  fullName: string;
  description: string;
  visibility: "public" | "private";
  updatedAt: string;
}

const PUBLIC_REPOSITORY: RepositorySummary = {
  name: "acme-docs",
  owner: "acme-demo",
  ownerType: "organization",
  ownerDisplayName: "Acme Demo",
  fullName: "Acme Demo/acme-docs",
  description: "Documentation for the Acme Demo platform",
  visibility: "public",
  updatedAt: "2024-06-01T00:00:00.000Z",
};

const PRIVATE_REPOSITORY: RepositorySummary = {
  name: "acme-internal",
  owner: "acme-demo",
  ownerType: "organization",
  ownerDisplayName: "Acme Demo",
  fullName: "Acme Demo/acme-internal",
  description: "Private internal notes for the Acme Demo organization",
  visibility: "private",
  updatedAt: "2024-05-01T00:00:00.000Z",
};

interface SimulatedResponse {
  status: number;
  body: unknown;
}

let signedIn: { username: string; role: Role } | null = null;
let organizations: Array<{ name: string; displayName: string; role?: Role }> = [];
let createResponse: SimulatedResponse = { status: 201, body: { organization: {} } };
const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

function organizationDetail(viewerRole: Role | null) {
  const repositories = viewerRole === "Owner"
    ? [PUBLIC_REPOSITORY, PRIVATE_REPOSITORY]
    : [PUBLIC_REPOSITORY];
  return {
    organization: { name: "acme-demo", displayName: "Acme Demo", createdAt: "2024-01-01T00:00:00.000Z" },
    viewerRole,
    members: viewerRole
      ? [
          { username: "alice-dev", role: "Owner" },
          { username: "bob-reviewer", role: "Member" },
        ]
      : [],
    teams: viewerRole ? [{ name: "frontend-team", description: "", parentTeamName: null }] : [],
    repositories,
  };
}

function simulate(method: string, path: string, body: Record<string, unknown>): SimulatedResponse {
  requests.push({ method, path, body });

  if (path === "/api/session" && method === "GET") {
    return {
      status: 200,
      body: {
        user: signedIn
          ? {
              username: signedIn.username,
              email: `${signedIn.username}@example.test`,
              organizations: organizations.map((organization) => ({
                name: organization.name,
                displayName: organization.displayName,
                role: organization.role ?? "Owner",
              })),
            }
          : null,
      },
    };
  }
  if (path === "/api/organizations" && method === "GET") {
    return { status: 200, body: { organizations: organizations.map(({ name, displayName }) => ({ name, displayName })) } };
  }
  if (path === "/api/account/organizations" && method === "GET") {
    if (!signedIn) return { status: 401, body: { error: "Sign in is required to list your organizations" } };
    return { status: 200, body: { organizations } };
  }
  if (path === "/api/organizations" && method === "POST") {
    if (createResponse.status < 300) {
      const organization = {
        name: String(body.name),
        displayName: String(body.displayName),
        role: "Owner" as Role,
      };
      organizations = [...organizations, organization];
      return { status: 201, body: { organization: { name: organization.name, displayName: organization.displayName } } };
    }
    return createResponse;
  }
  if (path === "/api/organizations/acme-demo" && method === "GET") {
    return { status: 200, body: organizationDetail(signedIn?.role ?? null) };
  }
  if (path.startsWith("/api/organizations/") && method === "GET") {
    const name = decodeURIComponent(path.slice("/api/organizations/".length));
    const organization = organizations.find((candidate) => candidate.name === name);
    if (!organization) return { status: 404, body: { error: "Organization not found" } };
    return {
      status: 200,
      body: {
        organization: { name: organization.name, displayName: organization.displayName, createdAt: "2026-09-30T00:00:00.000Z" },
        viewerRole: "Owner",
        members: [{ username: signedIn?.username ?? "", role: "Owner" }],
        teams: [],
        repositories: [],
      },
    };
  }
  if (path === "/api/repositories/acme-demo/acme-docs" && method === "GET") {
    return { status: 200, body: { repository: PUBLIC_REPOSITORY } };
  }
  if (path === "/api/repositories/acme-demo/acme-internal" && method === "GET") {
    if (signedIn?.role === "Owner") return { status: 200, body: { repository: PRIVATE_REPOSITORY } };
    return { status: 403, body: { error: "Access denied" } };
  }
  return { status: 404, body: { error: "Not found" } };
}

function installFetchMock() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const result = simulate(method, path, body);
    const all: Record<string, string> = { "content-type": "application/json" };
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: { get: (name: string) => all[name.toLowerCase()] ?? null },
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  signedIn = null;
  organizations = [{ name: "acme-demo", displayName: "Acme Demo", role: "Owner" }];
  createResponse = { status: 201, body: { organization: {} } };
  requests.length = 0;
  window.location.hash = "#/";
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function searchBox(): HTMLElement {
  return screen.getByRole("textbox", { name: "Find a repository" });
}

describe("REQ-2-1-1 organization repositories", () => {
  it("offers the Repositories, People and Teams links and filters the visible repositories", async () => {
    window.location.hash = "#/organizations/acme-demo";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "acme-demo" })).toBeTruthy();
    for (const label of ["Repositories", "People", "Teams"]) {
      const link = screen.getByRole("link", { name: label });
      expect((link as HTMLAnchorElement).getAttribute("href")).toContain("acme-demo");
    }
    expect(searchBox()).toBeTruthy();

    await userEvent.type(searchBox(), "acme-docs");
    expect(screen.getByRole("link", { name: "acme-docs" })).toBeTruthy();

    await userEvent.clear(searchBox());
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Type" }), "public");
    expect(screen.getByRole("link", { name: "acme-docs" })).toBeTruthy();
  });

  it("never exposes an unauthorized repository name to a visitor", async () => {
    window.location.hash = "#/organizations/acme-demo";
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });

    expect(screen.queryByRole("link", { name: "acme-internal" })).toBeNull();
    await userEvent.type(searchBox(), "acme-internal");
    expect(screen.queryByRole("link", { name: "acme-internal" })).toBeNull();
    expect(screen.queryByText(/internal/i)).toBeNull();
  });

  it("opens the repository overview named organization name/repository name", async () => {
    window.location.hash = "#/organizations/acme-demo";
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });

    await userEvent.click(screen.getByRole("link", { name: "acme-docs" }));
    expect(await screen.findByRole("heading", { name: "Acme Demo/acme-docs" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    // The owner is named the way the organization is known, while its link
    // still addresses the organization by identifier.
    expect(screen.getByRole("link", { name: "Acme Demo" }).getAttribute("href")).toBe(
      "#/organizations/acme-demo",
    );

    // Returning to the organization page (browser Back) keeps the public
    // repository available and still hides unauthorized repositories.
    window.location.hash = "#/organizations/acme-demo";
    window.dispatchEvent(new Event("hashchange"));
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "acme-internal" })).toBeNull();
  });

  it("shows an organization Owner the private repository of the organization", async () => {
    signedIn = { username: "alice-dev", role: "Owner" };
    window.location.hash = "#/organizations/acme-demo/repositories";
    render(<App />);

    expect(await screen.findByRole("link", { name: "acme-internal" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.getByText(/with the Owner role/)).toBeTruthy();
  });

  it("denies a visitor the private repository overview", async () => {
    window.location.hash = "#/acme-demo/acme-internal";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });
});

describe("REQ-2-1-2 create an organization", () => {
  it("names the organization entry by its display name and by its identifier", async () => {
    signedIn = { username: "alice-dev", role: "Owner" };
    window.location.hash = "#/organizations";
    render(<App />);

    await screen.findByRole("heading", { name: "Your organizations" });
    expect(screen.getByRole("link", { name: /^Acme Demo$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^acme-demo$/ })).toBeTruthy();
  });

  it("shows the signed-in account as a link of its own in the header", async () => {
    signedIn = { username: "alice-dev", role: "Owner" };
    window.location.hash = "#/organizations/new";
    render(<App />);

    const account = await screen.findByRole("link", { name: "alice-dev" });
    expect((account as HTMLAnchorElement).getAttribute("href")).toBe("#/workspace");
  });

  it("reaches the creation form from Your organizations and opens the new overview", async () => {
    signedIn = { username: "alice-dev", role: "Owner" };
    organizations = [{ name: "acme-demo", displayName: "Acme Demo", role: "Owner" }];
    window.location.hash = "#/organizations";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "New organization" }));

    expect(await screen.findByLabelText("Organization name")).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Organization name"), "mobile-guild");
    await userEvent.type(screen.getByLabelText("Display name"), "Mobile Guild");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByRole("heading", { name: "mobile-guild" })).toBeTruthy();
    expect(await screen.findByText(/with the Owner role/)).toBeTruthy();
    expect(
      requests.some(
        (request) =>
          request.method === "POST"
          && request.path === "/api/organizations"
          && request.body.name === "mobile-guild"
          && request.body.displayName === "Mobile Guild",
      ),
    ).toBe(true);

    // The new organization is part of the account's organization list.
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("link", { name: "Your organizations" }));
    await screen.findByRole("heading", { name: "Your organizations" });
    const list = screen.getByRole("list");
    expect(within(list).getByRole("link", { name: /mobile-guild/ })).toBeTruthy();
  });

  it("keeps the form open with the field reason when the identifier already exists", async () => {
    signedIn = { username: "alice-dev", role: "Owner" };
    createResponse = {
      status: 400,
      body: {
        error: "Organization creation failed",
        fields: { name: "Organization name already exists", displayName: "Display name is required" },
      },
    };
    window.location.hash = "#/organizations/new";
    render(<App />);

    await screen.findByLabelText("Organization name");
    await userEvent.type(screen.getByLabelText("Organization name"), "acme-demo");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).toBeTruthy();
    expect(screen.getByText("Display name is required")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New organization" })).toBeTruthy();
    expect((screen.getByLabelText("Organization name") as HTMLInputElement).value).toBe("acme-demo");
  });

  it("reports a malformed identifier and a whitespace-only display name", async () => {
    signedIn = { username: "alice-dev", role: "Owner" };
    createResponse = {
      status: 400,
      body: {
        error: "Organization creation failed",
        fields: { name: "Organization name format is invalid" },
      },
    };
    window.location.hash = "#/organizations/new";
    render(<App />);
    await screen.findByLabelText("Organization name");

    await userEvent.type(screen.getByLabelText("Organization name"), "-invalid-organization");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(await screen.findByText("Organization name format is invalid")).toBeTruthy();

    createResponse = {
      status: 400,
      body: {
        error: "Organization creation failed",
        fields: { displayName: "Display name is required" },
      },
    };
    await userEvent.clear(screen.getByLabelText("Organization name"));
    await userEvent.type(screen.getByLabelText("Organization name"), "mobile-guild");
    await userEvent.type(screen.getByLabelText("Display name"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => expect(screen.getByText("Display name is required")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "New organization" })).toBeTruthy();
  });

  it("lists the public organizations on the home page for visitors", async () => {
    render(<App />);
    const link = await screen.findByRole("link", { name: /Acme Demo/ });
    expect((link as HTMLAnchorElement).getAttribute("href")).toBe("#/organizations/acme-demo");
  });
});
