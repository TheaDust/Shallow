import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";

type Role = "Owner" | "Member";

interface SimulatedTeam {
  name: string;
  description: string;
  parentTeamName: string | null;
}

interface SimulatedResponse {
  status: number;
  body: unknown;
}

let signedIn: string | null = null;
let viewerRole: Role | null = null;
let teams: SimulatedTeam[] = [];
let organizationMembers: Array<{ username: string; role: Role }> = [];
let teamMemberships: Record<string, string[]> = {};
let createTeamResponse: SimulatedResponse | null = null;
const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

function isDescendant(candidate: string, ofTeam: string): boolean {
  let current: string | null = candidate;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === ofTeam) return true;
    seen.add(current);
    current = teams.find((team) => team.name === current)?.parentTeamName ?? null;
  }
  return false;
}

function teamDetail(name: string): SimulatedResponse {
  const team = teams.find((candidate) => candidate.name === name);
  if (!team) return { status: 404, body: { error: "Team not found" } };
  return {
    status: 200,
    body: {
      organization: { name: "acme-demo", displayName: "Acme Demo" },
      team,
      viewerRole,
      members: viewerRole ? (teamMemberships[name] ?? []) : [],
      teams,
    },
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
              username: signedIn,
              email: `${signedIn}@example.test`,
              organizations: [{ name: "acme-demo", displayName: "Acme Demo", role: viewerRole ?? "Member" }],
            }
          : null,
      },
    };
  }

  if (path === "/api/organizations/acme-demo" && method === "GET") {
    return {
      status: 200,
      body: {
        organization: { name: "acme-demo", displayName: "Acme Demo", createdAt: "2024-01-01T00:00:00.000Z" },
        viewerRole,
        members: viewerRole ? organizationMembers : [],
        teams: viewerRole ? teams : [],
        repositories: [],
      },
    };
  }

  if (path === "/api/organizations/acme-demo/teams" && method === "POST") {
    if (createTeamResponse) return createTeamResponse;
    const name = String(body.name ?? "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 50) {
      return {
        status: 400,
        body: { error: "Team creation failed", fields: { name: "Team name format is invalid" } },
      };
    }
    const parentTeamName = body.parentTeam ? String(body.parentTeam) : null;
    const team: SimulatedTeam = { name, description: String(body.description ?? ""), parentTeamName };
    teams = [...teams, team];
    return { status: 201, body: { team } };
  }

  const teamMembersMatch = /^\/api\/organizations\/acme-demo\/teams\/([^/]+)\/members$/.exec(path);
  if (teamMembersMatch) {
    const name = decodeURIComponent(teamMembersMatch[1]);
    const username = String(body.username ?? "");
    const current = teamMemberships[name] ?? [];
    if (method === "POST") {
      if (!organizationMembers.some((member) => member.username === username)) {
        return {
          status: 400,
          body: { error: "Member not added", fields: { username: "Account is not a member of this organization" } },
        };
      }
      if (current.includes(username)) {
        return {
          status: 400,
          body: { error: "Member not added", fields: { username: "Account is already a member of this team" } },
        };
      }
      teamMemberships = { ...teamMemberships, [name]: [...current, username] };
      return { status: 201, body: { member: username, members: teamMemberships[name] } };
    }
  }

  const teamMemberMatch = /^\/api\/organizations\/acme-demo\/teams\/([^/]+)\/members\/([^/]+)$/.exec(path);
  if (teamMemberMatch && method === "DELETE") {
    const name = decodeURIComponent(teamMemberMatch[1]);
    const username = decodeURIComponent(teamMemberMatch[2]);
    teamMemberships = {
      ...teamMemberships,
      [name]: (teamMemberships[name] ?? []).filter((member) => member !== username),
    };
    return { status: 200, body: { member: username, members: teamMemberships[name] } };
  }

  const teamMatch = /^\/api\/organizations\/acme-demo\/teams\/([^/]+)$/.exec(path);
  if (teamMatch) {
    const name = decodeURIComponent(teamMatch[1]);
    const team = teams.find((candidate) => candidate.name === name);
    if (!team) return { status: 404, body: { error: "Team not found" } };
    if (method === "GET") return teamDetail(name);
    if (method === "PATCH") {
      const parentTeamName = String(body.parentTeam ?? "");
      if (parentTeamName && isDescendant(parentTeamName, name)) {
        return {
          status: 400,
          body: {
            error: "Team could not be saved",
            fields: { parentTeam: "Cyclic team hierarchy is not allowed" },
          },
        };
      }
      team.parentTeamName = parentTeamName || null;
      return {
        status: 200,
        body: { team, teams, members: teamMemberships[name] ?? [], viewerRole },
      };
    }
  }

  if (path === "/api/organizations/acme-demo/members" && method === "POST") {
    const username = String(body.username ?? "");
    const knownAccounts = ["alice-dev", "bob-reviewer", "dana-dev"];
    if (!knownAccounts.includes(username)) {
      return { status: 400, body: { error: "Account not found", fields: { username: "Account not found" } } };
    }
    if (organizationMembers.some((member) => member.username === username)) {
      return {
        status: 400,
        body: { error: "Account is already a member", fields: { username: "Account is already a member" } },
      };
    }
    const role = body.role === "Owner" ? "Owner" : "Member";
    organizationMembers = [...organizationMembers, { username, role }];
    return { status: 201, body: { member: { username, role }, members: organizationMembers } };
  }

  const organizationMemberMatch = /^\/api\/organizations\/acme-demo\/members\/([^/]+)$/.exec(path);
  if (organizationMemberMatch && method === "DELETE") {
    const username = decodeURIComponent(organizationMemberMatch[1]);
    organizationMembers = organizationMembers.filter((member) => member.username !== username);
    return { status: 200, body: { member: { username }, members: organizationMembers } };
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
  signedIn = "alice-dev";
  viewerRole = "Owner";
  teams = [
    { name: "platform-team", description: "Platform owners", parentTeamName: null },
    { name: "frontend-team", description: "Frontend reviewers", parentTeamName: "platform-team" },
    { name: "frontend-child", description: "Child of frontend-team", parentTeamName: "frontend-team" },
  ];
  organizationMembers = [
    { username: "alice-dev", role: "Owner" },
    { username: "bob-reviewer", role: "Member" },
  ];
  teamMemberships = { "frontend-team": [], "frontend-child": [] };
  createTeamResponse = null;
  requests.length = 0;
  window.location.hash = "#/";
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("REQ-2-2-1 create an organization team", () => {
  it("reaches the team tree from the Teams link and creates a team with a parent", async () => {
    window.location.hash = "#/organizations/acme-demo/teams";
    render(<App />);

    expect(await screen.findByRole("link", { name: "New team" })).toBeTruthy();
    const tree = await screen.findByRole("navigation", { name: "Team tree" });
    expect(within(tree).getByRole("link", { name: "acme-demo" })).toBeTruthy();
    for (const teamName of ["platform-team", "frontend-team", "frontend-child"]) {
      expect(within(tree).getByRole("link", { name: teamName })).toBeTruthy();
    }

    await userEvent.click(screen.getByRole("link", { name: "New team" }));
    expect(await screen.findByRole("heading", { name: "New team" })).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Team name"), "mobile-team");
    await userEvent.type(screen.getByLabelText("Description"), "Mobile reviewers");
    await userEvent.selectOptions(screen.getByLabelText("Parent team"), "frontend-team");
    await userEvent.click(screen.getByRole("button", { name: "Create team" }));

    // The new team page is titled "organization name/team name" and shows the
    // new relation in the team tree.
    expect(await screen.findByRole("heading", { name: "acme-demo/mobile-team" })).toBeTruthy();
    const newTree = await screen.findByRole("navigation", { name: "Team tree" });
    expect(within(newTree).getByRole("link", { name: "mobile-team" })).toBeTruthy();
    expect(within(newTree).getByRole("link", { name: "frontend-team" })).toBeTruthy();
    expect(
      requests.some(
        (request) =>
          request.method === "POST"
          && request.path === "/api/organizations/acme-demo/teams"
          && request.body.name === "mobile-team"
          && request.body.parentTeam === "frontend-team",
      ),
    ).toBe(true);

    // Reopening the team keeps the heading and the hierarchy.
    window.location.hash = "#/organizations/acme-demo/teams/mobile-team";
    window.dispatchEvent(new Event("hashchange"));
    expect(await screen.findByRole("heading", { name: "acme-demo/mobile-team" })).toBeTruthy();
  });

  it("keeps the form open with the field reason for a malformed name", async () => {
    window.location.hash = "#/organizations/acme-demo/teams/new";
    render(<App />);

    await screen.findByLabelText("Team name");
    await userEvent.type(screen.getByLabelText("Team name"), "-mobile-team");
    await userEvent.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByText("Team name format is invalid")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New team" })).toBeTruthy();
    expect((screen.getByLabelText("Team name") as HTMLInputElement).value).toBe("-mobile-team");
  });

  it("offers the New team link only to an organization Owner", async () => {
    signedIn = "bob-reviewer";
    viewerRole = "Member";
    window.location.hash = "#/organizations/acme-demo/teams";
    render(<App />);

    expect(await screen.findByRole("navigation", { name: "Team tree" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New team" })).toBeNull();
  });
});

describe("REQ-2-2-2 team members and hierarchy", () => {
  it("adds a precise organization member and removes it again", async () => {
    window.location.hash = "#/organizations/acme-demo/teams/frontend-team/members";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "acme-demo/frontend-team" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));

    const username = screen.getByLabelText("Username");
    expect(username).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add member" })).toHaveLength(1);
    await userEvent.type(username, "bob-reviewer");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));

    await waitFor(() => expect(screen.getAllByText("bob-reviewer")).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Remove bob-reviewer" }));

    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
    expect(
      requests.some(
        (request) =>
          request.method === "DELETE"
          && request.path === "/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer",
      ),
    ).toBe(true);
  });

  it("rejects a cyclic parent team and keeps the stored parent", async () => {
    window.location.hash = "#/organizations/acme-demo/teams/frontend-team/settings";
    render(<App />);

    const select = await screen.findByLabelText("Parent team");
    expect((select as HTMLSelectElement).value).toBe("platform-team");
    await userEvent.selectOptions(select, "frontend-child");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).toBeTruthy();
    expect((screen.getByLabelText("Parent team") as HTMLSelectElement).value).toBe("platform-team");
  });

  it("saves a valid parent team and shows the relation in the team tree", async () => {
    window.location.hash = "#/organizations/acme-demo/teams/frontend-child/settings";
    render(<App />);

    const select = await screen.findByLabelText("Parent team");
    expect((select as HTMLSelectElement).value).toBe("frontend-team");
    await userEvent.selectOptions(select, "platform-team");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect((screen.getByLabelText("Parent team") as HTMLSelectElement).value).toBe("platform-team"));
    expect(
      requests.some(
        (request) =>
          request.method === "PATCH"
          && request.path === "/api/organizations/acme-demo/teams/frontend-child"
          && request.body.parentTeam === "platform-team",
      ),
    ).toBe(true);
  });

  it("hides the management controls from an ordinary member", async () => {
    signedIn = "bob-reviewer";
    viewerRole = "Member";
    window.location.hash = "#/organizations/acme-demo/teams/frontend-team/members";
    render(<App />);

    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
  });
});

describe("REQ-2-2-3 directly add an organization member", () => {
  it("adds a member through the Add member form on the People page", async () => {
    window.location.hash = "#/organizations/acme-demo/people";
    render(<App />);

    await screen.findByRole("link", { name: "People" });
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));

    expect(screen.getByLabelText("Username or email")).toBeTruthy();
    const role = screen.getByRole("combobox", { name: "Role" });
    expect(role.textContent).toContain("Member");
    // Opening the combobox exposes the clickable options of the field.
    await userEvent.click(role);
    expect(screen.getByRole("option", { name: /^Member$/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^Owner$/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("option", { name: /^Owner$/ }));
    expect(role.textContent).toContain("Owner");
    await userEvent.click(role);
    await userEvent.click(screen.getByRole("option", { name: /^Member$/ }));
    expect(screen.queryByRole("option", { name: /^Owner$/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Add member" })).toHaveLength(1);

    await userEvent.type(screen.getByLabelText("Username or email"), "dana-dev");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));

    await screen.findByText("dana-dev");
    const people = screen.getByRole("region", { name: "People" });
    const row = within(people).getByText("dana-dev").closest("li") as HTMLElement;
    expect(within(row).getByText("Member")).toBeTruthy();
    expect(
      requests.some(
        (request) =>
          request.method === "POST"
          && request.path === "/api/organizations/acme-demo/members"
          && request.body.username === "dana-dev"
          && request.body.role === "Member",
      ),
    ).toBe(true);
  });

  it("keeps the form open when the account is unknown", async () => {
    window.location.hash = "#/organizations/acme-demo/people";
    render(<App />);

    await screen.findByRole("button", { name: "Add member" });
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));
    await userEvent.type(screen.getByLabelText("Username or email"), "unknown-reviewer");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("Account not found")).toBeTruthy();
    expect((screen.getByLabelText("Username or email") as HTMLInputElement).value).toBe("unknown-reviewer");
    expect(screen.queryByText("unknown-reviewer")).toBeNull();
  });

  it("reports an existing member without duplicating the row", async () => {
    window.location.hash = "#/organizations/acme-demo/people";
    render(<App />);

    await screen.findByRole("button", { name: "Add member" });
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));
    await userEvent.type(screen.getByLabelText("Username or email"), "dana-dev");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));
    await screen.findByText("dana-dev");

    await userEvent.click(screen.getByRole("button", { name: "Add member" }));
    await userEvent.type(screen.getByLabelText("Username or email"), "bob-reviewer");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("Account is already a member")).toBeTruthy();
    const people = screen.getByRole("region", { name: "People" });
    expect(within(people).getAllByText("bob-reviewer")).toHaveLength(1);
  });
});

describe("REQ-2-2-4 remove an organization member", () => {
  it("removes a member through the member menu and the confirmation button", async () => {
    window.location.hash = "#/organizations/acme-demo/people";
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Member menu bob-reviewer" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from organization" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
    expect(within(screen.getByRole("region", { name: "People" })).getByText("alice-dev")).toBeTruthy();
    expect(
      requests.some(
        (request) =>
          request.method === "DELETE" && request.path === "/api/organizations/acme-demo/members/bob-reviewer",
      ),
    ).toBe(true);
  });

  it("offers no member menu to a non-Owner", async () => {
    signedIn = "bob-reviewer";
    viewerRole = "Member";
    window.location.hash = "#/organizations/acme-demo/people";
    render(<App />);

    expect(await screen.findByText("alice-dev")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Member menu alice-dev" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Member menu bob-reviewer" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
  });
});
