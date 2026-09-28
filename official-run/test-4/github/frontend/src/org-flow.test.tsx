import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface RepoRecord {
  name: string;
  description: string;
  visibility: "public" | "private";
  updatedAt: string;
}

interface TeamRecord {
  id: string;
  name: string;
  parentTeamId: string | null;
  members: string[];
}

interface GrantRecord {
  subjectType: "account" | "team";
  subjectName: string;
  role: string;
}

interface OrgDb {
  role: "owner" | "member" | null;
  members: { username: string; role: string }[];
  repos: RepoRecord[];
  teams: TeamRecord[];
  accounts: { username: string; email: string }[];
  grants: GrantRecord[];
}

const ACCOUNT = { username: "alice-dev", email: "alice.dev@example.test" };

const UPDATED = "2026-09-20T10:00:00.000Z";

function seedDb(overrides: Partial<OrgDb> = {}): OrgDb {
  const db: OrgDb = {
    role: "owner",
    members: [
      { username: "alice-dev", role: "owner" },
      { username: "bob-reviewer", role: "member" },
    ],
    repos: [
      { name: "acme-docs", description: "Documentation for Acme Demo", visibility: "public", updatedAt: UPDATED },
      { name: "acme-internal", description: "Internal plans for Acme Demo", visibility: "private", updatedAt: UPDATED },
    ],
    teams: [
      { id: "team_platform", name: "platform-team", parentTeamId: null, members: [] },
      { id: "team_frontend", name: "frontend-team", parentTeamId: "team_platform", members: [] },
      { id: "team_child", name: "frontend-child", parentTeamId: "team_frontend", members: [] },
      { id: "team_docs", name: "docs-team", parentTeamId: null, members: [] },
    ],
    accounts: [
      ACCOUNT,
      { username: "bob-reviewer", email: "bob.reviewer@example.test" },
    ],
    grants: [],
  };
  return { ...db, ...overrides };
}

function teamDetail(db: OrgDb, teamId: string) {
  const team = db.teams.find((candidate) => candidate.id === teamId);
  const parent = team?.parentTeamId ? db.teams.find((candidate) => candidate.id === team?.parentTeamId) : null;
  return {
    id: team?.id,
    name: team?.name,
    description: "",
    parentTeamId: team?.parentTeamId ?? null,
    parentName: parent?.name ?? null,
    createdAt: UPDATED,
    members: team?.members.map((username) => ({ username })) ?? [],
  };
}

/**
 * Stateful fetch stub simulating the server: scoped repository visibility,
 * team membership and hierarchy writes, plus organization creation.
 */
function orgFetchHandler(db: OrgDb, options: { anonymous?: boolean; createdOrgs?: { name: string; displayName: string }[] } = {}) {
  const createdOrgs = options.createdOrgs ?? [];
  return (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    if (path === "/api/sessions/current") {
      if (options.anonymous) return jsonResponse(401, { error: "Unauthenticated" });
      return jsonResponse(200, { account: ACCOUNT });
    }
    if (path === "/api/orgs" && method === "GET") {
      const orgs = [{ name: "acme-demo", displayName: "Acme Demo", role: db.role }];
      for (const created of createdOrgs) orgs.push({ name: created.name, displayName: created.displayName, role: "owner" });
      return jsonResponse(200, { organizations: orgs });
    }
    if (path === "/api/orgs" && method === "POST") {
      const body = JSON.parse(String(init.body)) as { name: string; displayName: string };
      const errors: Record<string, string> = {};
      if (body.name === "acme-demo") errors.name = "Organization name already exists";
      if (body.name === "-invalid-organization") errors.name = "Organization name format is invalid";
      if (!body.displayName.trim()) errors.displayName = "Display name is required";
      if (Object.keys(errors).length > 0) {
        return jsonResponse(400, { errors });
      }
      createdOrgs.push({ name: body.name, displayName: body.displayName.trim() });
      return jsonResponse(201, {
        organization: { name: body.name, displayName: body.displayName.trim(), role: "owner" },
      });
    }
    const orgDetail = path.match(/^\/api\/orgs\/acme-demo$/);
    if (orgDetail && method === "GET") {
      return jsonResponse(200, {
        organization: { name: "acme-demo", displayName: "Acme Demo", role: db.role },
      });
    }
    const reposMatch = path.match(/^\/api\/orgs\/acme-demo\/repos$/);
    if (reposMatch && method === "GET") {
      const visible = db.repos.filter(
        (repo) => repo.visibility === "public" || db.role === "owner",
      );
      return jsonResponse(200, { repositories: visible });
    }
    const grantsMatch = path.match(/^\/api\/orgs\/acme-demo\/repos\/([^/]+)\/grants$/);
    if (grantsMatch && method === "GET") {
      if (db.role !== "owner") return jsonResponse(403, { error: "Access denied" });
      return jsonResponse(200, {
        grants: db.grants,
        effectiveRole: db.role === "owner" ? "admin" : null,
      });
    }
    if (grantsMatch && method === "POST") {
      if (db.role !== "owner") return jsonResponse(403, { error: "Access denied" });
      const body = JSON.parse(String(init.body)) as { subjectType: "account" | "team"; subject: string; role: string };
      if (!["read", "triage", "write", "maintain", "admin"].includes(body.role)) {
        return jsonResponse(400, { errors: { role: "Role is invalid" } });
      }
      const valid =
        body.subjectType === "account"
          ? db.members.some((member) => member.username === body.subject)
          : db.teams.some((team) => team.name === body.subject);
      if (!valid) {
        const message = body.subjectType === "account" ? "Account not found" : "Team not found";
        return jsonResponse(400, { errors: { subject: message } });
      }
      const existing = db.grants.find(
        (grant) => grant.subjectType === body.subjectType && grant.subjectName === body.subject,
      );
      if (existing) existing.role = body.role;
      else db.grants.push({ subjectType: body.subjectType, subjectName: body.subject, role: body.role });
      return jsonResponse(201, { ok: true });
    }
    const grantRoleMatch = path.match(/^\/api\/orgs\/acme-demo\/repos\/([^/]+)\/grants\/(account|team)\/([^/]+)$/);
    if (grantRoleMatch && method === "PATCH") {
      if (db.role !== "owner") return jsonResponse(403, { error: "Access denied" });
      const subjectType = grantRoleMatch[2] as "account" | "team";
      const subject = decodeURIComponent(grantRoleMatch[3]);
      const body = JSON.parse(String(init.body)) as { role: string };
      const existing = db.grants.find(
        (grant) => grant.subjectType === subjectType && grant.subjectName === subject,
      );
      if (!existing) return jsonResponse(404, { error: "Not found" });
      existing.role = body.role;
      return jsonResponse(200, { ok: true });
    }
    const repoMatch = path.match(/^\/api\/orgs\/acme-demo\/repos\/([^/]+)$/);
    if (repoMatch && method === "GET") {
      const repo = db.repos.find((candidate) => candidate.name === repoMatch[1]);
      if (!repo) return jsonResponse(404, { error: "Not found" });
      if (repo.visibility === "private" && db.role !== "owner") {
        return jsonResponse(403, { error: "Access denied" });
      }
      return jsonResponse(200, { repository: repo });
    }
    const membersMatch = path.match(/^\/api\/orgs\/acme-demo\/members$/);
    if (membersMatch && method === "GET") {
      return jsonResponse(200, { members: db.members });
    }
    if (membersMatch && method === "POST") {
      if (db.role !== "owner") return jsonResponse(403, { error: "Forbidden" });
      const body = JSON.parse(String(init.body)) as { identifier: string; role: string };
      const account = db.accounts.find(
        (candidate) => candidate.username === body.identifier || candidate.email === body.identifier,
      );
      const errors: Record<string, string> = {};
      if (!account) errors.identifier = "Account not found";
      else if (db.members.some((member) => member.username === account.username)) {
        errors.identifier = "Account is already a member";
      }
      if (body.role !== "member" && body.role !== "owner") errors.role = "Role is invalid";
      if (Object.keys(errors).length > 0 || !account) return jsonResponse(400, { errors });
      db.members.push({ username: account.username, role: body.role });
      db.members.sort((a, b) => a.username.localeCompare(b.username));
      return jsonResponse(201, { ok: true });
    }
    const memberDeleteMatch = path.match(/^\/api\/orgs\/acme-demo\/members\/([^/]+)$/);
    if (memberDeleteMatch && method === "DELETE") {
      if (db.role !== "owner") return jsonResponse(403, { error: "Forbidden" });
      const username = decodeURIComponent(memberDeleteMatch[1]);
      const member = db.members.find((candidate) => candidate.username === username);
      if (!member) return jsonResponse(200, { ok: true });
      const ownerCount = db.members.filter((candidate) => candidate.role === "owner").length;
      if (member.role === "owner" && ownerCount <= 1) {
        return jsonResponse(400, { errors: { username: "The last Owner cannot be removed" } });
      }
      db.members = db.members.filter((candidate) => candidate.username !== username);
      return jsonResponse(200, { ok: true });
    }
    const teamsMatch = path.match(/^\/api\/orgs\/acme-demo\/teams$/);
    if (teamsMatch && method === "GET") {
      return jsonResponse(200, {
        teams: db.teams.map((team) => {
          const parent = team.parentTeamId
            ? db.teams.find((candidate) => candidate.id === team.parentTeamId)
            : null;
          return {
            id: team.id,
            name: team.name,
            description: "",
            parentTeamId: team.parentTeamId,
            parentName: parent?.name ?? null,
            createdAt: UPDATED,
          };
        }),
      });
    }
    if (teamsMatch && method === "POST") {
      const body = JSON.parse(String(init.body)) as { name: string; parentTeamId?: string | null };
      if (body.name === "-bad-team") {
        return jsonResponse(400, { errors: { name: "Team name format is invalid" } });
      }
      const parent = body.parentTeamId
        ? db.teams.find((candidate) => candidate.id === body.parentTeamId)
        : null;
      db.teams.push({ id: `team_${body.name}`, name: body.name, parentTeamId: body.parentTeamId ?? null, members: [] });
      return jsonResponse(201, {
        team: {
          id: `team_${body.name}`,
          name: body.name,
          description: "",
          parentTeamId: body.parentTeamId ?? null,
          parentName: parent?.name ?? null,
          createdAt: UPDATED,
        },
      });
    }
    const teamMatch = path.match(/^\/api\/orgs\/acme-demo\/teams\/([^/]+)$/);
    if (teamMatch && method === "GET") {
      const team = db.teams.find((candidate) => candidate.name === teamMatch[1]);
      if (!team) return jsonResponse(404, { error: "Not found" });
      return jsonResponse(200, { team: teamDetail(db, team.id) });
    }
    if (teamMatch && method === "PATCH") {
      const team = db.teams.find((candidate) => candidate.name === teamMatch[1]);
      const body = JSON.parse(String(init.body)) as { parentTeamId: string | null };
      if (!team) return jsonResponse(404, { error: "Not found" });
      if (body.parentTeamId) {
        let cursor: TeamRecord | null | undefined = db.teams.find((candidate) => candidate.id === body.parentTeamId);
        while (cursor) {
          if (cursor.id === team.id) {
            return jsonResponse(400, { errors: { parentTeam: "Cyclic team hierarchy is not allowed" } });
          }
          cursor = cursor.parentTeamId
            ? db.teams.find((candidate) => candidate.id === cursor?.parentTeamId) ?? null
            : null;
        }
      }
      team.parentTeamId = body.parentTeamId;
      return jsonResponse(200, { ok: true });
    }
    const teamMembersMatch = path.match(/^\/api\/orgs\/acme-demo\/teams\/([^/]+)\/members$/);
    if (teamMembersMatch && method === "POST") {
      const body = JSON.parse(String(init.body)) as { username: string };
      const team = db.teams.find((candidate) => candidate.name === teamMembersMatch[1]);
      if (!team) return jsonResponse(404, { error: "Not found" });
      if (body.username === "unknown-reviewer") {
        return jsonResponse(400, { errors: { username: "Account not found" } });
      }
      if (!db.members.some((member) => member.username === body.username)) {
        return jsonResponse(400, { errors: { username: "Account is not a member of this organization" } });
      }
      if (team.members.includes(body.username)) {
        return jsonResponse(400, { errors: { username: "Account is already a member" } });
      }
      team.members.push(body.username);
      return jsonResponse(201, { ok: true });
    }
    const teamMemberDelete = path.match(/^\/api\/orgs\/acme-demo\/teams\/([^/]+)\/members\/([^/]+)$/);
    if (teamMemberDelete && method === "DELETE") {
      const team = db.teams.find((candidate) => candidate.name === teamMemberDelete[1]);
      if (!team) return jsonResponse(404, { error: "Not found" });
      team.members = team.members.filter((username) => username !== teamMemberDelete[2]);
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(404, { error: "Not found" });
  };
}

function stubFetch(handler: (path: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : new URL(String(input)).pathname;
      return handler(path, init ?? {});
    }),
  );
}

beforeEach(() => {
  window.location.hash = "#/";
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("REQ-2-1-2 create an organization", () => {
  it("reaches the creation form from the account menu and creates an organization", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Your organizations" }));
    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New organization" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "New organization" }));
    expect(await screen.findByRole("heading", { name: "New organization" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Organization name" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Display name" })).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Organization name" }), "mobile-guild");
    await user.type(screen.getByRole("textbox", { name: "Display name" }), "Mobile Guild");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByRole("heading", { name: "mobile-guild" })).toBeTruthy();
    expect(window.location.hash).toBe("#/o/mobile-guild");

    // The new organization appears in “Your organizations”.
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("link", { name: "Your organizations" }));
    expect(await screen.findByRole("heading", { name: "Your organizations" })).toBeTruthy();
    // The entry is announced by the display name; the identifier stays visible text.
    expect(screen.getByRole("link", { name: "Mobile Guild" })).toBeTruthy();
    expect(screen.getByText("mobile-guild")).toBeTruthy();
  });

  it("shows the duplicate-name error even when the display name is missing and does not navigate", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/orgs/new";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "New organization" });

    await user.type(screen.getByRole("textbox", { name: "Organization name" }), "acme-demo");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).toBeTruthy();
    expect(screen.getByText("Display name is required")).toBeTruthy();
    expect(window.location.hash).toBe("#/orgs/new");
    expect((screen.getByRole("textbox", { name: "Organization name" }) as HTMLInputElement).value).toBe("acme-demo");
  });

  it("rejects a malformed identifier and a whitespace-only display name with field errors", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/orgs/new";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "New organization" });

    await user.type(screen.getByRole("textbox", { name: "Organization name" }), "-invalid-organization");
    await user.type(screen.getByRole("textbox", { name: "Display name" }), "   ");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name format is invalid")).toBeTruthy();
    expect(screen.getByText("Display name is required")).toBeTruthy();
    expect(window.location.hash).toBe("#/orgs/new");
  });
});

describe("REQ-2-1-1 browse organization repositories", () => {
  it("a visitor sees only the public repository, can filter by name and Public, and opens the repo overview", async () => {
    const db = seedDb({ role: null });
    stubFetch(orgFetchHandler(db, { anonymous: true }));
    window.location.hash = "#/o/acme-demo";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });

    expect(screen.getByRole("link", { name: "Repositories" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Teams" })).toBeTruthy();

    const filter = screen.getByRole("textbox", { name: "Find a repository" });
    expect(filter).toBeTruthy();
    const typeSelect = screen.getByRole("combobox", { name: "Type" });
    expect(screen.getByRole("option", { name: "Public" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Private" })).toBeTruthy();

    // Only the public repository is listed.
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "acme-internal" })).toBeNull();
    expect(screen.getByText("Documentation for Acme Demo")).toBeTruthy();
    expect(screen.getAllByText("Public").length).toBeGreaterThan(0);
    expect(screen.getByText(/Updated /)).toBeTruthy();

    // Filtering by the private name never reveals it.
    await user.type(filter, "acme-internal");
    expect(screen.queryByRole("link", { name: "acme-internal" })).toBeNull();
    expect(screen.getByText("No repositories found.")).toBeTruthy();

    // Clear, select Public filter and open the public repository.
    await user.clear(filter);
    await user.type(filter, "acme-docs");
    await user.selectOptions(typeSelect, "public");
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "acme-docs" }));
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
  });

  it("a visitor opening a private repository directly sees access denied", async () => {
    const db = seedDb({ role: null });
    stubFetch(orgFetchHandler(db, { anonymous: true }));
    window.location.hash = "#/o/acme-demo/repos/acme-internal";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-internal" })).toBeTruthy();
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
  });

  it("an organization owner sees the private repository in the Repositories tab", async () => {
    const db = seedDb({ role: "owner" });
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo";
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "acme-internal" })).toBeTruthy();
  });
});

describe("REQ-2-2-1 create an organization team", () => {
  it("an Owner creates a team from the Teams tab and lands on the team page", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/teams";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });
    expect(await screen.findByRole("link", { name: "frontend-team" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "platform-team" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "New team" }));
    expect(await screen.findByRole("heading", { name: "New team" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Team name" })).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Team name" }), "mobile-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByRole("heading", { name: "acme-demo/mobile-team" })).toBeTruthy();
    expect(window.location.hash).toBe("#/o/acme-demo/teams/mobile-team");
  });

  it("a malformed team name displays the format error and creates nothing", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/teams/new";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "New team" });

    await user.type(screen.getByRole("textbox", { name: "Team name" }), "-bad-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByText("Team name format is invalid")).toBeTruthy();
    expect(window.location.hash).toBe("#/o/acme-demo/teams/new");
  });
});

describe("REQ-2-2-2 manage team members and hierarchy", () => {
  it("adds a member, saves a new parent, and removes the member; reload keeps only saved state", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/teams/frontend-team/members";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();

    // Add bob-reviewer through the Add member form.
    await user.click(screen.getByRole("button", { name: "Add member" }));
    const usernameField = screen.getByRole("textbox", { name: "Username" });
    await user.type(usernameField, "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("bob-reviewer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove bob-reviewer" })).toBeTruthy();

    // Settings: select docs-team as the new parent and save.
    await user.click(screen.getByRole("link", { name: "Settings" }));
    const parentSelect = await screen.findByRole("combobox", { name: "Parent team" });
    expect(screen.getByRole("option", { name: "platform-team" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "frontend-child" })).toBeTruthy();
    await user.selectOptions(parentSelect, "team_docs");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The team tree (Teams tab) reflects the saved parent relationship.
    window.location.hash = "#/o/acme-demo/teams";
    expect(await screen.findByRole("heading", { name: "acme-demo" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/parent: docs-team/)).toBeTruthy();
    });

    // Remove the just-added member from the Members page.
    await user.click(screen.getByRole("link", { name: "frontend-team" }));
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });
    const remove = await screen.findByRole("button", { name: "Remove bob-reviewer" });
    await user.click(remove);
    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());

    // Reload: only saved relationships remain.
    cleanup();
    stubFetch(orgFetchHandler(db));
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });
    expect(screen.queryByText("bob-reviewer")).toBeNull();
    await user.click(screen.getByRole("link", { name: "Settings" }));
    const reloadedSelect = await screen.findByRole("combobox", { name: "Parent team" });
    expect((reloadedSelect as HTMLSelectElement).value).toBe("team_docs");
  });

  it("a rejected cyclic parent change keeps the original parent selected", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/teams/frontend-team/settings";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });

    const parentSelect = await screen.findByRole("combobox", { name: "Parent team" });
    // Original parent from the seed is selected.
    expect((parentSelect as HTMLSelectElement).value).toBe("team_platform");

    // Selecting a descendant (frontend-child) creates a cycle and is rejected.
    await user.selectOptions(parentSelect, "team_child");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).toBeTruthy();
    expect((parentSelect as HTMLSelectElement).value).toBe("team_platform");

    // Reload keeps the original parent.
    cleanup();
    stubFetch(orgFetchHandler(db));
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });
    const reloaded = await screen.findByRole("combobox", { name: "Parent team" });
    expect((reloaded as HTMLSelectElement).value).toBe("team_platform");
  });

  it("a non-organization member cannot be added and the error keeps the form open", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/teams/frontend-team/members";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/frontend-team" });

    await user.click(screen.getByRole("button", { name: "Add member" }));
    await user.type(screen.getByRole("textbox", { name: "Username" }), "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("Account not found")).toBeTruthy();
    // The form stays open so the username can be corrected.
    expect(screen.getByRole("textbox", { name: "Username" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Username" }) as HTMLInputElement).value).toBe("unknown-reviewer");
  });
});

describe("REQ-2-2-3 directly add a user as an organization member", () => {
  it("an Owner adds a registered nonmember with the Member role; reload preserves the row", async () => {
    const db = seedDb({
      accounts: [
        ACCOUNT,
        { username: "bob-reviewer", email: "bob.reviewer@example.test" },
        { username: "charlie-dev", email: "charlie.dev@example.test" },
      ],
    });
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/people";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });
    expect(screen.getByRole("link", { name: "People" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add member" }));
    const identifier = screen.getByRole("textbox", { name: "Username or email" });
    await user.type(identifier, "charlie-dev");
    const roleSelect = screen.getByRole("combobox", { name: "Role" });
    expect(screen.getByRole("option", { name: "Member" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Owner" })).toBeTruthy();
    expect((roleSelect as HTMLSelectElement).value).toBe("member");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("charlie-dev")).toBeTruthy();
    expect(screen.getAllByText("Member").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Pending|Awaiting/i)).toBeNull();

    // Reload preserves the row.
    cleanup();
    stubFetch(orgFetchHandler(db));
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });
    expect(await screen.findByText("charlie-dev")).toBeTruthy();
  });

  it("unknown and duplicate accounts keep the form open with field errors and no duplicate rows", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/people";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });

    await user.click(screen.getByRole("button", { name: "Add member" }));
    const identifier = screen.getByRole("textbox", { name: "Username or email" });
    await user.type(identifier, "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("Account not found")).toBeTruthy();
    expect((identifier as HTMLInputElement).value).toBe("unknown-reviewer");

    // Correct the input to an existing member and resubmit.
    await user.clear(identifier);
    await user.type(identifier, "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByText("Account is already a member")).toBeTruthy();
    expect((identifier as HTMLInputElement).value).toBe("bob-reviewer");
    expect(screen.getAllByText("bob-reviewer")).toHaveLength(1);
  });
});

describe("REQ-2-2-4 remove a member from an organization", () => {
  it("an Owner removes a member through the action menu and confirmation dialog; reload keeps the absence", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/people";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });
    await screen.findByText("bob-reviewer");

    await user.click(screen.getByRole("button", { name: "Member menu bob-reviewer" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from organization" }));
    expect(screen.getByRole("dialog", { name: "Remove from organization" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
    expect(screen.queryByText("alice-dev")).toBeTruthy();

    cleanup();
    stubFetch(orgFetchHandler(db));
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });
    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
  });

  it("the last Owner cannot be removed; the error keeps the dialog open and nothing changes", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/people";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });
    await screen.findByText("alice-dev");

    await user.click(screen.getByRole("button", { name: "Member menu alice-dev" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from organization" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("The last Owner cannot be removed")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Remove from organization" })).toBeTruthy();
    expect(screen.getByText("alice-dev")).toBeTruthy();
  });

  it("a non-Owner member sees no member-menu buttons or remove menuitem", async () => {
    const db = seedDb({ role: "member" });
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/people";
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo" });
    await screen.findByText("bob-reviewer");

    expect(screen.queryByRole("button", { name: /Member menu/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
  });
});

describe("REQ-2-3 grant repository access to people and teams", () => {
  it("reaches Manage access through the repository Settings link", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/repos/acme-docs";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });

    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("link", { name: "Manage access" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Manage access" }));
    expect(await screen.findByRole("heading", { name: "Manage access" })).toBeTruthy();
  });

  it("an Owner grants Write to a team; one row persists, re-adding does not duplicate, and changing to Read replaces it", async () => {
    const db = seedDb();
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/repos/acme-docs/settings/access";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });
    await screen.findByRole("heading", { name: "Manage access" });

    await user.click(screen.getByRole("button", { name: "Add people or teams" }));
    // The opening button is hidden while the picker is active.
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();

    const search = screen.getByRole("textbox", { name: "Search" });
    await user.type(search, "frontend");
    await user.click(await screen.findByRole("option", { name: "frontend-team" }));
    const roleSelect = screen.getByRole("combobox", { name: "Role" });
    await user.selectOptions(roleSelect, "write");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("row", { name: "frontend-team" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe("write");

    // Re-adding the same subject with the same role keeps a single record.
    await user.click(screen.getByRole("button", { name: "Add people or teams" }));
    await user.type(screen.getByRole("textbox", { name: "Search" }), "frontend");
    await user.click(await screen.findByRole("option", { name: "frontend-team" }));
    const picker = document.querySelector(".access-picker") as HTMLElement;
    await user.selectOptions(within(picker).getByRole("combobox", { name: "Role" }), "write");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getAllByRole("row", { name: "frontend-team" })).toHaveLength(1));

    // Changing the role to Read and saving replaces Write in the single row.
    const rowSelect = screen.getByRole("combobox", { name: "Role" });
    await user.selectOptions(rowSelect, "read");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe("read"),
    );
    expect(screen.getAllByRole("row", { name: "frontend-team" })).toHaveLength(1);

    // Reload preserves the updated grant.
    cleanup();
    stubFetch(orgFetchHandler(db));
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });
    await waitFor(() => {
      expect(screen.getAllByRole("row", { name: "frontend-team" })).toHaveLength(1);
      expect((screen.getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe("read");
    });
  });

  it("a member without Admin permission sees no management controls", async () => {
    const db = seedDb({ role: "member" });
    stubFetch(orgFetchHandler(db));
    window.location.hash = "#/o/acme-demo/repos/acme-docs/settings/access";
    render(<App />);
    await screen.findByRole("heading", { name: "acme-demo/acme-docs" });
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();
  });
});
