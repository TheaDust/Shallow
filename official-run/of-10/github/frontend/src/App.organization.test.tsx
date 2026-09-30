import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

interface AccountFixture {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

const ALICE: AccountFixture = {
  id: "account-alice-dev",
  username: "alice-dev",
  email: "alice.dev@example.test",
  emailVerified: true,
};

const BOB: AccountFixture = {
  id: "account-bob-reviewer",
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  emailVerified: true,
};

interface FakeRepository {
  name: string;
  owner: string;
  ownerType: "user" | "organization";
  visibility: "public" | "private";
  description: string;
}

interface FakeMember {
  accountId: string;
  username: string;
  role: "owner" | "member";
}

interface FakeTeam {
  id: string;
  name: string;
  description: string;
  parent: string | null;
  members: string[];
}

interface FakeOrganization {
  id: string;
  login: string;
  name: string;
  members: FakeMember[];
  teams: FakeTeam[];
}

function fakeState() {
  return {
    organizations: [
      {
        id: "org-acme-demo",
        login: "acme-demo",
        name: "Acme Demo",
        members: [
          { accountId: ALICE.id, username: ALICE.username, role: "owner" as const },
          { accountId: BOB.id, username: BOB.username, role: "member" as const },
        ],
        teams: [
          {
            id: "team-frontend-team",
            name: "frontend-team",
            description: "Frontend engineers.",
            parent: null,
            members: [],
          },
        ],
      },
    ] as FakeOrganization[],
    repositories: [
      {
        name: "acme-docs",
        owner: "acme-demo",
        ownerType: "organization" as const,
        visibility: "public" as const,
        description: "Documentation and guides for the Acme platform.",
      },
      {
        name: "acme-internal",
        owner: "acme-demo",
        ownerType: "organization" as const,
        visibility: "private" as const,
        description: "Internal planning notes.",
      },
    ] as FakeRepository[],
    knownAccounts: ["alice-dev", "bob-reviewer", "dana-dev"],
  };
}

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function repositorySummary(repository: FakeRepository) {
  return {
    id: `repo-${repository.owner}-${repository.name}`,
    name: repository.name,
    fullName: `${repository.owner}/${repository.name}`,
    ownerDisplayName: repository.ownerType === "organization" ? "Acme Demo" : repository.owner,
    owner: { type: repository.ownerType, login: repository.owner },
    visibility: repository.visibility,
    description: repository.description,
    defaultBranch: "main",
    updatedAt: "2024-02-15T10:20:00.000Z",
    forkedFrom: null,
  };
}

/**
 * Minimal in-memory stand-in for the organization HTTP API: permissions are
 * decided from the session, exactly like the server does.
 */
function installFetch(viewer: AccountFixture | null) {
  const state = fakeState();
  const organization = () => state.organizations[0];
  const viewerMembership = () =>
    viewer ? organization().members.find((member) => member.accountId === viewer.id) ?? null : null;

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (path === "/api/session") return jsonResponse(200, { account: viewer });
    if (path.startsWith("/api/search")) {
      return jsonResponse(200, { query: "", type: "repositories", repositories: [] });
    }

    if (path === "/api/organizations" && method === "GET") {
      if (!viewer) return jsonResponse(401, { error: "Not authenticated" });
      const membership = viewerMembership();
      return jsonResponse(200, {
        organizations: membership
          ? [
              {
                id: organization().id,
                login: organization().login,
                name: organization().name,
                createdAt: "2024-01-03T00:00:00.000Z",
                viewerRole: membership.role,
              },
            ]
          : [],
      });
    }

    if (path === "/api/organizations" && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Not authenticated" });
      const name = String(body.name ?? "");
      const displayName = String(body.displayName ?? "").trim();
      const fields: Record<string, string> = {};
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 39) {
        fields.name = "Organization name format is invalid";
      } else if (state.organizations.some((candidate) => candidate.login === name)) {
        fields.name = "Organization name already exists";
      }
      if (!displayName) fields.displayName = "Display name is required";
      if (Object.keys(fields).length > 0) {
        return jsonResponse(400, { error: "Organization creation failed", fields });
      }
      state.organizations.push({
        id: `org-${name}`,
        login: name,
        name: displayName,
        members: [{ accountId: viewer.id, username: viewer.username, role: "owner" }],
        teams: [],
      });
      return jsonResponse(201, {
        organization: { id: `org-${name}`, login: name, name: displayName, viewerRole: "owner" },
      });
    }

    const organizationMatch = path.match(/^\/api\/organizations\/([^/]+)(?:\/(.+))?$/);
    if (organizationMatch) {
      const login = decodeURIComponent(organizationMatch[1]);
      const rest = organizationMatch[2] ?? "";
      const target = state.organizations.find((candidate) => candidate.login === login);
      if (!target) return jsonResponse(404, { error: "Not found" });
      const membership = viewer
        ? target.members.find((member) => member.accountId === viewer.id) ?? null
        : null;
      const viewerPayload = {
        role: membership ? membership.role : null,
        isMember: Boolean(membership),
        isOwner: membership?.role === "owner",
      };
      const organizationPayload = {
        id: target.id,
        login: target.login,
        name: target.name,
        createdAt: "2024-01-03T00:00:00.000Z",
      };

      if (rest === "" && method === "GET") {
        return jsonResponse(200, { organization: organizationPayload, viewer: viewerPayload });
      }

      if (rest === "repositories" && method === "GET") {
        const repositories = state.repositories
          .filter((repository) => repository.owner === login)
          .filter((repository) => repository.visibility === "public" || viewerPayload.isOwner)
          .map(repositorySummary);
        return jsonResponse(200, { organization: organizationPayload, repositories });
      }

      if (rest === "members") {
        if (!membership) return jsonResponse(403, { error: "You must be an organization member." });
        if (method === "GET") {
          return jsonResponse(200, {
            organization: organizationPayload,
            viewer: viewerPayload,
            members: target.members,
          });
        }
        if (method === "POST") {
          if (!viewerPayload.isOwner) return jsonResponse(403, { error: "Owner only" });
          const identifier = String(body.identifier ?? "");
          const fields: Record<string, string> = {};
          if (target.members.some((member) => member.username === identifier)) {
            fields.identifier = "Account is already a member";
          } else if (!state.knownAccounts.includes(identifier)) {
            fields.identifier = "Account not found";
          }
          if (Object.keys(fields).length > 0) {
            return jsonResponse(400, { error: "Member addition failed", fields });
          }
          const member = {
            accountId: `account-${identifier}`,
            username: identifier,
            role: (body.role === "owner" ? "owner" : "member") as "owner" | "member",
          };
          target.members.push(member);
          return jsonResponse(201, { member, organization: organizationPayload });
        }
      }

      const memberMatch = rest.match(/^members\/(.+)$/);
      if (memberMatch && method === "DELETE") {
        if (!viewerPayload.isOwner) return jsonResponse(403, { error: "Owner only" });
        const username = decodeURIComponent(memberMatch[1]);
        const index = target.members.findIndex((member) => member.username === username);
        if (index < 0) return jsonResponse(404, { error: "Member not found" });
        const member = target.members[index];
        if (member.role === "owner" && target.members.filter((entry) => entry.role === "owner").length <= 1) {
          return jsonResponse(400, { error: "An organization must keep at least one Owner" });
        }
        target.members.splice(index, 1);
        return jsonResponse(200, { ok: true, organization: organizationPayload });
      }

      if (rest === "teams") {
        if (!membership) return jsonResponse(403, { error: "You must be an organization member." });
        if (method === "GET") {
          return jsonResponse(200, {
            organization: organizationPayload,
            viewer: viewerPayload,
            teams: target.teams.map((team) => ({
              id: team.id,
              name: team.name,
              description: team.description,
              parent: team.parent ? { id: `team-${team.parent}`, name: team.parent } : null,
              organization: { id: target.id, login: target.login, name: target.name },
            })),
          });
        }
        if (method === "POST") {
          if (!viewerPayload.isOwner) return jsonResponse(403, { error: "Owner only" });
          const name = String(body.name ?? "");
          const fields: Record<string, string> = {};
          if (!/^[a-z0-9-]+$/.test(name) || name.startsWith("-") || name.endsWith("-") || name.length > 50) {
            fields.name = "Team name format is invalid";
          } else if (target.teams.some((team) => team.name === name)) {
            fields.name = "Team name already exists";
          }
          const parentTeam = String(body.parentTeam ?? "");
          if (parentTeam && !target.teams.some((team) => team.name === parentTeam)) {
            fields.parentTeam = "Parent team does not belong to this organization";
          }
          if (Object.keys(fields).length > 0) {
            return jsonResponse(400, { error: "Team creation failed", fields });
          }
          const team = {
            id: `team-${name}`,
            name,
            description: String(body.description ?? ""),
            parent: parentTeam || null,
            members: [],
          };
          target.teams.push(team);
          return jsonResponse(201, {
            team: {
              id: team.id,
              name: team.name,
              description: team.description,
              parent: team.parent ? { id: `team-${team.parent}`, name: team.parent } : null,
              organization: { id: target.id, login: target.login, name: target.name },
            },
          });
        }
      }

      const teamMatch = rest.match(/^teams\/([^/]+)(?:\/(.*))?$/);
      if (teamMatch) {
        const team = target.teams.find((candidate) => candidate.name === decodeURIComponent(teamMatch[1]));
        if (!team) return jsonResponse(404, { error: "Team not found" });
        if (!membership) return jsonResponse(403, { error: "You must be an organization member." });
        const teamRest = teamMatch[2] ?? "";
        const teamPayload = () => ({
          id: team.id,
          name: team.name,
          description: team.description,
          parent: team.parent ? { id: `team-${team.parent}`, name: team.parent } : null,
          organization: { id: target.id, login: target.login, name: target.name },
        });
        if (!teamRest && method === "GET") {
          return jsonResponse(200, {
            organization: organizationPayload,
            viewer: viewerPayload,
            team: teamPayload(),
            members: team.members.map((username) => ({ accountId: `account-${username}`, username })),
            parentOptions: target.teams
              .filter((candidate) => candidate.id !== team.id)
              .map((candidate) => ({ id: candidate.id, name: candidate.name })),
          });
        }
        if (teamRest === "parent" && method === "POST") {
          if (!viewerPayload.isOwner) return jsonResponse(403, { error: "Owner only" });
          const parent = String(body.parentTeam ?? "");
          const descendant = (name: string) => {
            const seen = new Set<string>();
            let current = target.teams.find((candidate) => candidate.name === name);
            while (current && !seen.has(current.name)) {
              if (current.parent === team.name) return true;
              seen.add(current.name);
              const parentName = current.parent ?? "";
              current = parentName
                ? target.teams.find((candidate) => candidate.name === parentName)
                : undefined;
            }
            return false;
          };
          if (parent && (parent === team.name || descendant(parent))) {
            return jsonResponse(400, {
              error: "Team update failed",
              fields: { parentTeam: "Cyclic team hierarchy is not allowed" },
            });
          }
          team.parent = parent || null;
          return jsonResponse(200, { team: teamPayload() });
        }
        if (teamRest === "members" && method === "POST") {
          if (!viewerPayload.isOwner) return jsonResponse(403, { error: "Owner only" });
          const username = String(body.username ?? "");
          const fields: Record<string, string> = {};
          if (!state.knownAccounts.includes(username)) {
            fields.username = "Account not found";
          } else if (!target.members.some((member) => member.username === username)) {
            fields.username = "Account is not an organization member";
          } else if (team.members.includes(username)) {
            fields.username = "Account is already a team member";
          }
          if (Object.keys(fields).length > 0) {
            return jsonResponse(400, { error: "Team member addition failed", fields });
          }
          team.members.push(username);
          return jsonResponse(201, {
            member: { accountId: `account-${username}`, username },
            team: teamPayload(),
          });
        }
        const teamMemberMatch = teamRest.match(/^members\/(.+)$/);
        if (teamMemberMatch && method === "DELETE") {
          if (!viewerPayload.isOwner) return jsonResponse(403, { error: "Owner only" });
          const username = decodeURIComponent(teamMemberMatch[1]);
          const index = team.members.indexOf(username);
          if (index < 0) return jsonResponse(404, { error: "Team member not found" });
          team.members.splice(index, 1);
          return jsonResponse(200, { ok: true, team: teamPayload() });
        }
      }

      return jsonResponse(404, { error: "Not found" });
    }

    const repositoryMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)$/);
    if (repositoryMatch) {
      const owner = decodeURIComponent(repositoryMatch[1]);
      const name = decodeURIComponent(repositoryMatch[2]);
      const repository = state.repositories.find(
        (candidate) => candidate.owner === owner && candidate.name === name,
      );
      if (!repository) return jsonResponse(404, { error: "Not found" });
      const readable = repository.visibility === "public" || viewerMembership()?.role === "owner";
      if (!readable) {
        return viewer
          ? jsonResponse(403, { error: "Access denied" })
          : jsonResponse(404, { error: "Not found" });
      }
      return jsonResponse(200, {
        repository: {
          ...repositorySummary(repository),
          branch: "main",
          entries: [{ type: "file", name: "README.md", path: "README.md" }],
          commits: [],
          permissions: { role: viewerMembership()?.role === "owner" ? "admin" : null, canAdminister: false },
        },
      });
    }

    return jsonResponse(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { state, organization };
}

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("browsing organization repositories", () => {
  it("shows the public repository to a visitor and never the private one", async () => {
    installFetch(null);
    const user = userEvent.setup();
    renderAt("#/organizations/acme-demo");

    expect(await screen.findByRole("heading", { level: 1, name: "acme-demo" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Acme Demo" })).toBeTruthy();
    for (const tab of ["Repositories", "People", "Teams"]) {
      expect(screen.getByRole("link", { name: tab })).toBeTruthy();
    }

    const link = await screen.findByRole("link", { name: "acme-docs" });
    const list = screen.getByRole("heading", { name: "Repositories" }).closest("section")!;
    expect(within(list).queryByText("acme-internal")).toBeNull();
    expect(screen.queryByRole("link", { name: "acme-internal" })).toBeNull();

    // Typing the exact private name filters everything out.
    const filter = screen.getByRole("textbox", { name: "Find a repository" });
    await user.type(filter, "acme-internal");
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
    });

    // The public filter keeps the public repository and opens its overview.
    await user.clear(filter);
    await user.type(filter, "acme-docs");
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "public");
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "acme-docs" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme Demo/acme-docs" }),
    ).toBeTruthy();
    expect(link).toBeTruthy();
  });
});

describe("creating an organization", () => {
  it("keeps the form on every rejection and enters the new overview on success", async () => {
    installFetch(ALICE);
    const user = userEvent.setup();
    renderAt("#/organizations");

    expect(await screen.findByRole("heading", { level: 1, name: "Your organizations" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "acme-demo" })).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "New organization" }));
    const name = await screen.findByRole("textbox", { name: "Organization name" });
    const displayName = screen.getByRole("textbox", { name: "Display name" });
    const submit = screen.getByRole("button", { name: "Create organization" });

    await user.type(name, "acme-demo");
    await user.click(submit);
    expect(await screen.findByText("Organization name already exists")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Organization name" })).toBeTruthy();

    await user.clear(name);
    await user.type(name, "-invalid-organization");
    await user.type(displayName, "Invalid");
    await user.click(submit);
    expect(await screen.findByText("Organization name format is invalid")).toBeTruthy();

    await user.clear(name);
    await user.type(name, "mobile-guild");
    await user.clear(displayName);
    await user.type(displayName, "   ");
    await user.click(submit);
    expect(await screen.findByText("Display name is required")).toBeTruthy();

    await user.clear(displayName);
    await user.type(displayName, "Mobile Guild");
    await user.click(submit);
    expect(await screen.findByRole("heading", { level: 1, name: "mobile-guild" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mobile Guild" })).toBeTruthy();
  });
});

describe("organization teams", () => {
  it("lets an Owner create a team with a parent and shows the hierarchy", async () => {
    installFetch(ALICE);
    const user = userEvent.setup();
    renderAt("#/organizations/acme-demo/teams");

    expect(await screen.findByRole("heading", { level: 2, name: "Teams" })).toBeTruthy();
    await user.click(await screen.findByRole("link", { name: "New team" }));

    const name = await screen.findByRole("textbox", { name: "Team name" });
    const parent = screen.getByRole("combobox", { name: "Parent team" });
    const submit = screen.getByRole("button", { name: "Create team" });

    await user.type(name, "Mobile-Team");
    await user.click(submit);
    expect(await screen.findByText("Team name format is invalid")).toBeTruthy();

    await user.clear(name);
    await user.type(name, "mobile-team");
    await user.selectOptions(parent, "frontend-team");
    await user.click(submit);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme Demo/mobile-team" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "frontend-team" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByText("This team has no members yet.")).toBeTruthy();
  });

  it("hides the team creation entry from a plain member", async () => {
    installFetch(BOB);
    renderAt("#/organizations/acme-demo/teams");
    expect(await screen.findByRole("heading", { level: 2, name: "Teams" })).toBeTruthy();
    await screen.findByRole("link", { name: "frontend-team" });
    expect(screen.queryByRole("link", { name: "New team" })).toBeNull();
  });
});

describe("organization members", () => {
  it("removes a member through the member menu and the confirmation dialog", async () => {
    installFetch(ALICE);
    const user = userEvent.setup();
    renderAt("#/organizations/acme-demo/people");

    expect(await screen.findByText("bob-reviewer")).toBeTruthy();
    const memberList = screen.getByText("bob-reviewer").closest("ul") as HTMLElement;
    expect(within(memberList).getByText("Member")).toBeTruthy();
    expect(within(memberList).getByText("Owner")).toBeTruthy();
    // The only Owner is not removable, so her row has no member menu.
    expect(screen.queryByRole("button", { name: "Member menu alice-dev" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Member menu bob-reviewer" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove from organization" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.queryByText("bob-reviewer")).toBeNull();
    });
    expect(screen.getByText("Member removed.")).toBeTruthy();
  });

  it("shows no member menu to a plain member", async () => {
    installFetch(BOB);
    renderAt("#/organizations/acme-demo/people");

    expect(await screen.findByText("alice-dev")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Member menu alice-dev" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
  });

  it("adds an existing account and reports an unknown one", async () => {
    installFetch(ALICE);
    const user = userEvent.setup();
    renderAt("#/organizations/acme-demo/people");

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    const identifier = screen.getByRole("textbox", { name: "Username or email" });
    const role = screen.getByRole("combobox", { name: "Role" });
    expect(role.textContent).toBe("Member");
    expect(role.getAttribute("aria-expanded")).toBe("false");

    await user.type(identifier, "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account not found")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Username or email" })).toBeTruthy();

    await user.clear(identifier);
    await user.type(identifier, "dana-dev");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("dana-dev")).toBeTruthy();
  });

  it("opens the Role combobox and adds the account as an Owner", async () => {
    installFetch(ALICE);
    const user = userEvent.setup();
    renderAt("#/organizations/acme-demo/people");

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    // The options appear as page content once the combobox is opened, and the
    // selected one is marked for assistive technology.
    const role = screen.getByRole("combobox", { name: "Role" });
    expect(screen.queryByRole("option", { name: "Owner" })).toBeNull();
    await user.click(role);
    expect(role.getAttribute("aria-expanded")).toBe("true");
    const ownerOption = screen.getByRole("option", { name: "Owner" });
    expect(ownerOption.getAttribute("aria-selected")).toBe("false");
    await user.click(ownerOption);
    expect(role.textContent).toBe("Owner");
    expect(role.getAttribute("aria-expanded")).toBe("false");

    await user.type(screen.getByRole("textbox", { name: "Username or email" }), "dana-dev");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const row = (await screen.findByText("dana-dev")).closest("article")!;
    expect(within(row).getByText("Owner")).toBeTruthy();
  });
});

describe("team members and hierarchy", () => {
  it("adds and immediately removes a current organization member", async () => {
    const { state } = installFetch(ALICE);
    const user = userEvent.setup();
    renderAt("#/organizations/acme-demo/teams/frontend-team");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme Demo/frontend-team" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("This team has no members yet.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add member" }));
    // Only the submission button of the current step is an actionable match.
    expect(screen.getAllByRole("button", { name: "Add member" })).toHaveLength(1);
    const username = screen.getByRole("textbox", { name: "Username" });

    await user.type(username, "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account not found")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Username" })).toBeTruthy();

    // A registered account that is not an organization member cannot be added.
    await user.clear(username);
    await user.type(username, "dana-dev");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account is not an organization member")).toBeTruthy();

    await user.clear(username);
    await user.type(username, "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const removeButton = await screen.findByRole("button", { name: "Remove bob-reviewer" });
    expect(screen.getAllByText("bob-reviewer")).toHaveLength(1);
    expect(state.organizations[0].teams[0].members).toEqual(["bob-reviewer"]);

    // The removal acts immediately, without a second confirmation step.
    await user.click(removeButton);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();
    });
    expect(screen.queryByText("bob-reviewer")).toBeNull();
    expect(screen.getByText("This team has no members yet.")).toBeTruthy();
    expect(state.organizations[0].teams[0].members).toEqual([]);
  });

  it("keeps the members and hierarchy of a plain member read-only", async () => {
    const { state } = installFetch(BOB);
    state.organizations[0].teams[0].members.push("bob-reviewer");
    renderAt("#/organizations/acme-demo/teams/frontend-team");

    expect(await screen.findByText("bob-reviewer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();
  });

  it("rejects a cyclic parent and keeps the stored parent selected after reload", async () => {
    const { state } = installFetch(ALICE);
    const teams = state.organizations[0].teams;
    teams.push({ id: "team-child-team", name: "child-team", description: "", parent: "frontend-team", members: [] });
    teams.push({
      id: "team-grandchild-team",
      name: "grandchild-team",
      description: "",
      parent: "child-team",
      members: [],
    });
    const user = userEvent.setup();
    renderAt("#/organizations/acme-demo/teams/child-team/settings");

    expect(await screen.findByRole("heading", { level: 1, name: "Acme Demo/child-team" })).toBeTruthy();
    const parent = screen.getByRole("combobox", { name: "Parent team" }) as HTMLSelectElement;
    expect(parent.value).toBe("frontend-team");
    for (const option of ["frontend-team", "grandchild-team"]) {
      expect(screen.getByRole("option", { name: option })).toBeTruthy();
    }

    await user.selectOptions(parent, "grandchild-team");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).toBeTruthy();
    expect(parent.value).toBe("frontend-team");
    expect(state.organizations[0].teams.find((team) => team.name === "child-team")?.parent).toBe(
      "frontend-team",
    );

    // Reload keeps the stored parent.
    cleanup();
    renderAt("#/organizations/acme-demo/teams/child-team/settings");
    const reloaded = (await screen.findByRole("combobox", { name: "Parent team" })) as HTMLSelectElement;
    expect(reloaded.value).toBe("frontend-team");
  });

  it("saves a new parent team and shows the hierarchy in the team tree", async () => {
    const { state } = installFetch(ALICE);
    state.organizations[0].teams.push({
      id: "team-child-team",
      name: "child-team",
      description: "",
      parent: null,
      members: [],
    });
    const user = userEvent.setup();
    renderAt("#/organizations/acme-demo/teams/child-team/settings");

    const parent = (await screen.findByRole("combobox", { name: "Parent team" })) as HTMLSelectElement;
    await user.selectOptions(parent, "frontend-team");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(state.organizations[0].teams.find((team) => team.name === "child-team")?.parent).toBe(
        "frontend-team",
      );
    });

    await user.click(screen.getByRole("link", { name: "Members" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme Demo/child-team" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "acme-demo" }));
    const tree = await screen.findByRole("heading", { level: 2, name: "Teams" });
    const section = tree.closest("section") as HTMLElement;
    const childLink = within(section).getByRole("link", { name: "child-team" });
    // The child entry is nested inside the list item of its parent team.
    const childItem = childLink.closest("li") as HTMLElement;
    const parentItem = childItem.parentElement?.closest("li") as HTMLElement;
    expect(within(parentItem).getByRole("link", { name: "frontend-team" })).toBeTruthy();
  });
});
