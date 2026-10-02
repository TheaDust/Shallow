import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";

type Role = "Owner" | "Member";
type SubjectType = "account" | "team";

interface SimulatedGrant {
  subjectType: SubjectType;
  name: string;
  role: string;
}

interface SimulatedResponse {
  status: number;
  body: unknown;
}

const ROLES = ["Read", "Triage", "Write", "Maintain", "Admin"];

let signedIn: { username: string; role: Role } | null = null;
let grants: SimulatedGrant[] = [];
let organizationMembers: Array<{ username: string; role: Role }> = [];
let teams: string[] = [];
const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

function candidateList(): Array<{ subjectType: SubjectType; name: string }> {
  return [
    ...organizationMembers.map((member) => ({ subjectType: "account" as SubjectType, name: member.username })),
    ...teams.map((name) => ({ subjectType: "team" as SubjectType, name })),
  ];
}

function accessPayload() {
  return {
    repository: {
      name: "acme-docs",
      owner: "acme-demo",
      fullName: "Acme Demo/acme-docs",
      ownerDisplayName: "Acme Demo",
      description: "Documentation for the Acme Demo platform",
      visibility: "public",
      updatedAt: "2024-06-01T00:00:00.000Z",
    },
    viewerRole: signedIn?.role === "Owner" ? "Admin" : null,
    canManage: signedIn?.role === "Owner",
    roles: ROLES,
    candidates: candidateList(),
    grants,
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
              organizations: [{ name: "acme-demo", displayName: "Acme Demo", role: signedIn.role }],
            }
          : null,
      },
    };
  }

  if (path === "/api/repositories/acme-demo/acme-docs" && method === "GET") {
    return { status: 200, body: { repository: accessPayload().repository } };
  }

  if (path === "/api/repositories/acme-demo/acme-docs/access") {
    if (!signedIn) return { status: 401, body: { error: "Sign in is required to manage repository access" } };
    if (signedIn.role !== "Owner") {
      return { status: 403, body: { error: "Only an organization Owner or repository Admin can manage access" } };
    }
    if (method === "GET") return { status: 200, body: accessPayload() };
    if (method === "PUT") {
      const role = String(body.role ?? "");
      if (!ROLES.includes(role)) {
        return { status: 400, body: { error: "Role is not supported", fields: { role: "Role is not supported" } } };
      }
      const candidates = candidateList();
      const candidate = candidates.find((entry) =>
        entry.name === String(body.subject) && entry.subjectType === body.subjectType);
      if (!candidate) {
        return {
          status: 400,
          body: {
            error: "Account is not a member of this organization",
            fields: { subject: "Account is not a member of this organization" },
          },
        };
      }
      const existing = grants.find((grant) =>
        grant.subjectType === candidate.subjectType && grant.name === candidate.name);
      if (existing) existing.role = role;
      else grants = [...grants, { subjectType: candidate.subjectType, name: candidate.name, role }];
      return { status: 200, body: accessPayload() };
    }
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
    const headers: Record<string, string> = { "content-type": "application/json" };
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  signedIn = { username: "alice-dev", role: "Owner" };
  grants = [];
  organizationMembers = [
    { username: "alice-dev", role: "Owner" },
    { username: "bob-reviewer", role: "Member" },
  ];
  teams = ["platform-team", "frontend-team"];
  requests.length = 0;
  window.location.hash = "#/";
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Chooses an option of a Role combobox the way a user does: the options are
 * exposed by opening the combobox and are then clicked (REQ-2-3).
 */
async function pickRole(scope: HTMLElement, option: string) {
  const role = within(scope).getByRole("combobox", { name: "Role" });
  await userEvent.click(role);
  await userEvent.click(within(scope).getByRole("option", { name: new RegExp(`^${option}$`) }));
  expect(role.textContent).toContain(option);
}

async function openManageAccess() {
  window.location.hash = "#/acme-demo/acme-docs/settings/access";
  render(<App />);
  await screen.findByRole("heading", { name: "Manage access" });
  await screen.findByRole("button", { name: "Add people or teams" });
}

describe("REQ-2-3 manage repository access", () => {
  it("reaches Manage access from the repository Settings link", async () => {
    window.location.hash = "#/acme-demo/acme-docs";
    render(<App />);

    await screen.findByRole("heading", { name: "Acme Demo/acme-docs" });
    await userEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();

    await userEvent.click(screen.getByRole("link", { name: "Manage access" }));
    expect(await screen.findByRole("heading", { name: "Manage access" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add people or teams" })).toBeTruthy();
  });

  it("grants a team Write access through the Search picker", async () => {
    await openManageAccess();

    await userEvent.click(screen.getByRole("button", { name: "Add people or teams" }));
    // The opening button is hidden while the picker is active.
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();
    const picker = screen.getByRole("form", { name: "Add people or teams" });

    const search = screen.getByRole("textbox", { name: "Search" });
    await userEvent.type(search, "frontend");
    expect(within(picker).getByRole("option", { name: "frontend-team" })).toBeTruthy();
    expect(within(picker).queryByRole("option", { name: "bob-reviewer" })).toBeNull();

    await userEvent.click(within(picker).getByRole("option", { name: "frontend-team" }));
    await pickRole(picker, "Write");
    await userEvent.click(within(picker).getByRole("button", { name: "Add" }));

    const row = await screen.findByRole("row", { name: /frontend-team/ });
    expect(within(row).getByRole("combobox", { name: "Role" })).toHaveProperty("value", "Write");
    expect(within(row).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add people or teams" })).toBeTruthy();

    // Saving the same role again does not create a second record.
    await userEvent.click(screen.getByRole("button", { name: "Add people or teams" }));
    const reopenedPicker = screen.getByRole("form", { name: "Add people or teams" });
    await userEvent.click(await within(reopenedPicker).findByRole("option", { name: "frontend-team" }));
    await pickRole(reopenedPicker, "Write");
    await userEvent.click(within(reopenedPicker).getByRole("button", { name: "Add" }));
    await screen.findByRole("row", { name: /frontend-team/ });
    expect(screen.getAllByRole("row", { name: /frontend-team/ })).toHaveLength(1);

    // Reopening the page keeps the stored grant.
    cleanup();
    render(<App />);
    const reloaded = await screen.findByRole("row", { name: /frontend-team/ });
    expect(within(reloaded).getByRole("combobox", { name: "Role" })).toHaveProperty("value", "Write");
  });

  it("lets the administrator pick a member without pressing Enter", async () => {
    await openManageAccess();
    await userEvent.click(screen.getByRole("button", { name: "Add people or teams" }));
    const picker = screen.getByRole("form", { name: "Add people or teams" });

    const search = screen.getByRole("textbox", { name: "Search" });
    await userEvent.type(search, "bob");
    const option = await within(picker).findByRole("option", { name: "bob-reviewer" });
    await userEvent.click(option);
    expect(option.getAttribute("aria-selected")).toBe("true");

    await pickRole(picker, "Write");
    await userEvent.click(within(picker).getByRole("button", { name: "Add" }));

    const row = await screen.findByRole("row", { name: /bob-reviewer/ });
    expect(within(row).getByRole("combobox", { name: "Role" })).toHaveProperty("value", "Write");
    expect(within(row).getByText("Member")).toBeTruthy();
  });

  it("replaces a Write grant with Read and keeps exactly one row", async () => {
    grants = [{ subjectType: "team", name: "frontend-team", role: "Write" }];
    await openManageAccess();

    const row = await screen.findByRole("row", { name: /frontend-team/ });
    expect(within(row).getByRole("combobox", { name: "Role" })).toHaveProperty("value", "Write");

    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Role" }), "Read");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getAllByRole("row", { name: /frontend-team/ })).toHaveLength(1);
    });
    cleanup();
    render(<App />);
    const reloaded = await screen.findByRole("row", { name: /frontend-team/ });
    expect(within(reloaded).getByRole("combobox", { name: "Role" })).toHaveProperty("value", "Read");
    expect(screen.getAllByRole("row", { name: /frontend-team/ })).toHaveLength(1);
  });

  it("refuses the Manage-access page to a non-Admin", async () => {
    signedIn = { username: "bob-reviewer", role: "Member" };
    window.location.hash = "#/acme-demo/acme-docs/settings/access";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });
});
