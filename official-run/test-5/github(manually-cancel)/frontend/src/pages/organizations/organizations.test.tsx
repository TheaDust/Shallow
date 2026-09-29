import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedInSession, signedOutSession } from "../../test/harness";
import type { TeamDetail, TeamSummary } from "../../org/types";

const ORG_NAME = "Acme Demo";
const ORG_PATH = "/api/organizations/Acme%20Demo";

const ORGANIZATION_DETAIL = {
  id: "org-acme-demo",
  name: ORG_NAME,
  displayName: ORG_NAME,
  createdAt: "2024-01-05T09:00:00.000Z",
  role: "owner",
  isMember: true,
};

const PUBLIC_REPOSITORY = {
  name: "acme-docs",
  description: "Public documentation for the Acme platform",
  visibility: "public",
  updatedAt: "2024-03-15T09:30:00.000Z",
};

const PRIVATE_REPOSITORY = {
  name: "acme-internal",
  description: "Private planning material",
  visibility: "private",
  updatedAt: "2024-04-02T16:45:00.000Z",
};

const TEAMS: TeamSummary[] = [
  { id: "team-platform-team", name: "platform-team", description: "", parentTeamId: null, parentName: null },
  {
    id: "team-frontend-team",
    name: "frontend-team",
    description: "Frontend engineering",
    parentTeamId: "team-platform-team",
    parentName: "platform-team",
  },
  {
    id: "team-frontend-child",
    name: "frontend-child",
    description: "",
    parentTeamId: "team-frontend-team",
    parentName: "frontend-team",
  },
];

function frontendTeam(members: string[]): TeamDetail {
  return {
    ...TEAMS[1],
    organizationId: "org-acme-demo",
    organizationName: ORG_NAME,
    createdAt: "2024-01-07T09:00:00.000Z",
    members,
    children: ["frontend-child"],
  };
}

function session(username: string) {
  return signedInSession(username, `${username}@example.test`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browse organization repositories (REQ-2-1-1)", () => {
  it("shows a visitor only public repositories and filters as the visitor types", async () => {
    installFetch({
      "GET /api/auth/session": () => signedOutSession(),
      [`GET ${ORG_PATH}`]: () => ({
        status: 200,
        body: { organization: { ...ORGANIZATION_DETAIL, role: null, isMember: false } },
      }),
      [`GET ${ORG_PATH}/repositories`]: () => ({
        status: 200,
        body: { repositories: [PUBLIC_REPOSITORY] },
      }),
      "GET /api/repositories/Acme%20Demo/acme-docs": () => ({
        status: 200,
        body: {
          repository: {
            ...PUBLIC_REPOSITORY,
            ownerName: ORG_NAME,
            fullName: `${ORG_NAME}/acme-docs`,
            createdAt: null,
            defaultBranch: "main",
          },
        },
      }),
      "GET /api/repositories/Acme%20Demo/acme-internal": () => ({
        status: 401,
        body: { error: "Authentication required" },
      }),
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}`);

    expect(await screen.findByRole("heading", { name: ORG_NAME })).not.toBeNull();
    const repositoriesLink = screen.getByRole("link", { name: "Repositories" });
    expect(repositoriesLink.getAttribute("href")).toBe(
      `#/organizations/${encodeURIComponent(ORG_NAME)}/repositories`,
    );
    expect(screen.getByRole("link", { name: "People" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Teams" })).not.toBeNull();

    const filter = await screen.findByLabelText("Find a repository");
    await user.type(filter, "acme-internal");
    expect(screen.queryByRole("link", { name: "acme-internal" })).toBeNull();
    expect(screen.getByText("No repositories match your filters.")).not.toBeNull();

    await user.clear(filter);
    await user.type(filter, "acme-docs");
    await user.selectOptions(screen.getByLabelText("Type"), "public");
    const repositoryLink = screen.getByRole("link", { name: "acme-docs" });
    expect(repositoryLink.getAttribute("href")).toBe(
      `#/repositories/${encodeURIComponent(ORG_NAME)}/acme-docs`,
    );

    await user.click(repositoryLink);
    expect(
      await screen.findByRole("heading", { name: `${ORG_NAME}/acme-docs` }),
    ).not.toBeNull();
  });

  it("lists the update time and visibility for every visible repository", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: ORGANIZATION_DETAIL } }),
      [`GET ${ORG_PATH}/repositories`]: () => ({
        status: 200,
        body: { repositories: [PUBLIC_REPOSITORY, PRIVATE_REPOSITORY] },
      }),
    });
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}`);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByRole("link", { name: "acme-docs" })).not.toBeNull();
    expect(within(rows[1]).getByText("Public")).not.toBeNull();
    expect(within(rows[1]).getByText("Updated 2024-03-15")).not.toBeNull();
    expect(within(rows[2]).getByText("Private")).not.toBeNull();
    expect(within(rows[2]).getByText("Updated 2024-04-02")).not.toBeNull();
  });

  it("denies a private repository that the viewer may not read", async () => {
    installFetch({
      "GET /api/auth/session": () => session("bob-reviewer"),
      "GET /api/repositories/Acme%20Demo/acme-internal": () => ({
        status: 403,
        body: { error: "Access denied" },
      }),
    });
    renderApp(`#/repositories/${encodeURIComponent(ORG_NAME)}/acme-internal`);

    expect(await screen.findByRole("heading", { name: "Access denied" })).not.toBeNull();
  });
});

describe("your organizations and organization creation (REQ-2-1-2)", () => {
  it("lists the organizations of the signed-in account and opens the creation page", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      "GET /api/organizations": () => ({
        status: 200,
        body: { organizations: [{ name: ORG_NAME, displayName: ORG_NAME, role: "owner" }] },
      }),
      "GET /api/organizations/Acme%20Demo": () => ({
        status: 200,
        body: { organization: ORGANIZATION_DETAIL },
      }),
      "GET /api/organizations/Acme%20Demo/repositories": () => ({
        status: 200,
        body: { repositories: [PUBLIC_REPOSITORY] },
      }),
    });
    const user = userEvent.setup();
    renderApp("#/organizations");

    expect(await screen.findByRole("heading", { name: "Your organizations" })).not.toBeNull();
    const organizationLink = screen.getByRole("link", { name: ORG_NAME });
    expect(organizationLink.getAttribute("href")).toBe(
      `#/organizations/${encodeURIComponent(ORG_NAME)}`,
    );
    const newOrganization = screen.getByRole("link", { name: "New organization" });
    expect(newOrganization.getAttribute("href")).toBe("#/organizations/new");

    await user.click(organizationLink);
    expect(await screen.findByRole("heading", { name: ORG_NAME })).not.toBeNull();
  });

  it("creates an organization with a unique name and enters its overview", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      "POST /api/organizations": () => ({
        status: 201,
        body: {
          organization: {
            id: "org-mobile-guild",
            name: "mobile-guild",
            displayName: "Mobile Guild",
            createdAt: "2024-05-01T00:00:00.000Z",
            role: "owner",
            isMember: true,
          },
        },
      }),
      "GET /api/organizations/mobile-guild": () => ({
        status: 200,
        body: {
          organization: {
            id: "org-mobile-guild",
            name: "mobile-guild",
            displayName: "Mobile Guild",
            createdAt: "2024-05-01T00:00:00.000Z",
            role: "owner",
            isMember: true,
          },
        },
      }),
      "GET /api/organizations/mobile-guild/repositories": () => ({
        status: 200,
        body: { repositories: [] },
      }),
    });
    const user = userEvent.setup();
    renderApp("#/organizations/new");

    expect(await screen.findByRole("heading", { name: "New organization" })).not.toBeNull();
    await user.type(screen.getByLabelText("Organization name"), "mobile-guild");
    await user.type(screen.getByLabelText("Display name"), "Mobile Guild");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByRole("heading", { name: "mobile-guild" })).not.toBeNull();
    expect(screen.getByText("You are an Owner of this organization.")).not.toBeNull();
  });

  it("reports an existing identifier and keeps the entered values", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      "POST /api/organizations": () => ({
        status: 400,
        body: {
          error: "Organization creation failed",
          errors: {
            name: "Organization name already exists",
            displayName: "Display name is required",
          },
        },
      }),
    });
    const user = userEvent.setup();
    renderApp("#/organizations/new");

    await screen.findByRole("heading", { name: "New organization" });
    const nameInput = screen.getByLabelText("Organization name") as HTMLInputElement;
    await user.type(nameInput, "Acme Demo");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).not.toBeNull();
    expect(screen.getByText("Display name is required")).not.toBeNull();
    expect(nameInput.value).toBe("Acme Demo");
    expect(screen.getByRole("heading", { name: "New organization" })).not.toBeNull();
  });
});

describe("organization teams (REQ-2-2-1)", () => {
  it("lists the team tree and only offers “New team” to an organization Owner", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: ORGANIZATION_DETAIL } }),
      [`GET ${ORG_PATH}/teams`]: () => ({
        status: 200,
        body: { teams: TEAMS, viewerRole: "owner" },
      }),
    });
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/teams`);

    expect(await screen.findByRole("link", { name: "frontend-team" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "platform-team" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "frontend-child" })).not.toBeNull();
    const newTeam = screen.getByRole("link", { name: "New team" });
    expect(newTeam.getAttribute("href")).toBe(
      `#/organizations/${encodeURIComponent(ORG_NAME)}/teams/new`,
    );
  });

  it("hides “New team” from a plain organization member", async () => {
    installFetch({
      "GET /api/auth/session": () => session("bob-reviewer"),
      [`GET ${ORG_PATH}`]: () => ({
        status: 200,
        body: { organization: { ...ORGANIZATION_DETAIL, role: "member" } },
      }),
      [`GET ${ORG_PATH}/teams`]: () => ({
        status: 200,
        body: { teams: TEAMS, viewerRole: "member" },
      }),
    });
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/teams`);

    expect(await screen.findByRole("link", { name: "frontend-team" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "New team" })).toBeNull();
  });

  it("creates a team from the “New team” form and enters its page", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: ORGANIZATION_DETAIL } }),
      [`GET ${ORG_PATH}/teams`]: () => ({
        status: 200,
        body: { teams: TEAMS, viewerRole: "owner" },
      }),
      [`POST ${ORG_PATH}/teams`]: () => ({
        status: 201,
        body: {
          team: {
            ...frontendTeam([]),
            id: "team-mobile-team",
            name: "mobile-team",
            description: "",
            parentTeamId: "team-networking",
            parentName: "networking",
          },
        },
      }),
      [`GET ${ORG_PATH}/teams/mobile-team`]: () => ({
        status: 200,
        body: { team: frontendTeam([]) },
      }),
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/teams/new`);

    expect(await screen.findByRole("heading", { name: "New team" })).not.toBeNull();
    await user.type(await screen.findByLabelText("Team name"), "mobile-team");
    await user.selectOptions(screen.getByLabelText("Parent team"), "team-platform-team");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(
      await screen.findByRole("heading", { name: `${ORG_NAME}/frontend-team` }),
    ).not.toBeNull();
  });

  it("reports a malformed team name without creating a team", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: ORGANIZATION_DETAIL } }),
      [`GET ${ORG_PATH}/teams`]: () => ({
        status: 200,
        body: { teams: TEAMS, viewerRole: "owner" },
      }),
      [`POST ${ORG_PATH}/teams`]: () => ({
        status: 400,
        body: { error: "Team creation failed", errors: { name: "Team name format is invalid" } },
      }),
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/teams/new`);

    await screen.findByRole("heading", { name: "New team" });
    await user.type(await screen.findByLabelText("Team name"), "-mobile-team-");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    expect(await screen.findByText("Team name format is invalid")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "New team" })).not.toBeNull();
  });
});

describe("team members and hierarchy (REQ-2-2-2)", () => {
  function installTeamPage(team: TeamDetail, teams: TeamSummary[] = TEAMS) {
    return installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}/teams/frontend-team`]: () => ({
        status: 200,
        body: { team, viewerRole: "owner" },
      }),
      [`GET ${ORG_PATH}/teams`]: () => ({ status: 200, body: { teams, viewerRole: "owner" } }),
    });
  }

  it("adds and removes a team member without a second confirmation", async () => {
    let team = frontendTeam([]);
    const fetchMock = installTeamPage(team);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (method === "GET" && path === `${ORG_PATH}/teams/frontend-team`) {
        return json(200, { team, viewerRole: "owner" });
      }
      if (method === "GET" && path === `${ORG_PATH}/teams`) {
        return json(200, { teams: TEAMS, viewerRole: "owner" });
      }
      if (method === "POST" && path === `${ORG_PATH}/teams/frontend-team/members`) {
        const body = JSON.parse(String(init?.body)) as { username: string };
        if (body.username !== "bob-reviewer") {
          return json(400, { error: "Team member not added", errors: { username: "Account not found" } });
        }
        team = frontendTeam(["bob-reviewer"]);
        return json(200, { team });
      }
      if (method === "DELETE" && path === `${ORG_PATH}/teams/frontend-team/members/bob-reviewer`) {
        team = frontendTeam([]);
        return json(200, { team });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/teams/frontend-team/members`);

    expect(
      await screen.findByRole("heading", { name: `${ORG_NAME}/frontend-team` }),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "Members" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Settings" })).not.toBeNull();
    expect(await screen.findByText("This team has no direct members.")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(screen.getAllByRole("button", { name: "Add member" })).toHaveLength(1);
    await user.type(screen.getByLabelText("Username"), "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const removeButton = await screen.findByRole("button", { name: "Remove bob-reviewer" });
    expect(screen.getByText("bob-reviewer")).not.toBeNull();

    await user.click(removeButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull());
    expect(screen.getByText("This team has no direct members.")).not.toBeNull();
  });

  it("keeps the stored parent when a cyclic parent is rejected", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}/teams/frontend-team`]: () => ({
        status: 200,
        body: { team: frontendTeam([]), viewerRole: "owner" },
      }),
      [`GET ${ORG_PATH}/teams`]: () => ({ status: 200, body: { teams: TEAMS, viewerRole: "owner" } }),
      [`PUT ${ORG_PATH}/teams/frontend-team/parent`]: () => ({
        status: 400,
        body: {
          error: "Parent team not saved",
          errors: { parentTeamId: "Cyclic team hierarchy is not allowed" },
        },
      }),
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/teams/frontend-team/settings`);

    expect(
      await screen.findByRole("heading", { name: `${ORG_NAME}/frontend-team` }),
    ).not.toBeNull();
    const select = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "frontend-child",
      "platform-team",
    ]);
    expect(select.value).toBe("team-platform-team");

    await user.selectOptions(select, "team-frontend-child");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Cyclic team hierarchy is not allowed")).not.toBeNull();
    expect(select.value).toBe("team-platform-team");
  });

  it("saves a valid parent team", async () => {
    let team = frontendTeam([]);
    const fetchMock = installTeamPage(team);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (method === "GET" && path === `${ORG_PATH}/teams/frontend-team`) {
        return json(200, { team, viewerRole: "owner" });
      }
      if (method === "GET" && path === `${ORG_PATH}/teams`) {
        return json(200, { teams: TEAMS, viewerRole: "owner" });
      }
      if (method === "PUT" && path === `${ORG_PATH}/teams/frontend-team/parent`) {
        const body = JSON.parse(String(init?.body)) as { parentTeamId: string | null };
        team = {
          ...team,
          parentTeamId: body.parentTeamId,
          parentName: body.parentTeamId === "team-platform-team" ? "platform-team" : null,
        };
        return json(200, { team });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/teams/frontend-team/settings`);
    await screen.findByRole("heading", { name: `${ORG_NAME}/frontend-team` });
    const select = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    expect(select.value).toBe("team-platform-team");
    await user.selectOptions(select, "team-frontend-child");
    // The team is its own ancestor through frontend-child; the API rejects it in
    // the cycle test above, so this request models a permitted hierarchy change.
    await user.selectOptions(select, "team-platform-team");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Parent team saved")).not.toBeNull();
    await waitFor(() =>
      expect((screen.getByLabelText("Parent team") as HTMLSelectElement).value).toBe(
        "team-platform-team",
      ),
    );
  });
  it("hides the team member and hierarchy controls from a non-Owner member", async () => {
    installFetch({
      "GET /api/auth/session": () => session("bob-reviewer"),
      [`GET ${ORG_PATH}/teams/frontend-team`]: () => ({
        status: 200,
        body: { team: frontendTeam(["bob-reviewer"]), viewerRole: "member" },
      }),
      [`GET ${ORG_PATH}/teams`]: () => ({
        status: 200,
        body: { teams: TEAMS, viewerRole: "member" },
      }),
    });
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/teams/frontend-team/members`);

    const members = await screen.findByRole("region", { name: "Team members" });
    expect(await within(members).findByText("bob-reviewer")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();

    window.location.hash = `#/organizations/${encodeURIComponent(ORG_NAME)}/teams/frontend-team/settings`;
    const select = (await screen.findByLabelText("Parent team")) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("organization people (REQ-2-1)", () => {
  it("lists the members with their Member/Owner role", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: ORGANIZATION_DETAIL } }),
      [`GET ${ORG_PATH}/people`]: () => ({
        status: 200,
        body: {
          members: [
            { username: "alice-dev", role: "owner" },
            { username: "bob-reviewer", role: "member" },
          ],
        },
      }),
    });
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/people`);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("alice-dev")).not.toBeNull();
    expect(within(rows[1]).getByText("Owner")).not.toBeNull();
    expect(within(rows[2]).getByText("bob-reviewer")).not.toBeNull();
    expect(within(rows[2]).getByText("Member")).not.toBeNull();
  });
});
