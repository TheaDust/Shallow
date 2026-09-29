import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-org-"));
process.env.SHALLOW_DATA_DIR = dataDirectory;
process.env.ARC_EXTRA_PORTS = "0";

const { createRequestHandler } = await import("../src/app.mjs");
const { ensureSeedData } = await import("../src/lib/db.mjs");
await ensureSeedData();

async function startServer() {
  const server = createServer(createRequestHandler());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function client(base) {
  let cookie = null;
  return {
    async request(path, { method = "GET", body } = {}) {
      const headers = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        const [pair] = setCookie.split(";");
        cookie = pair.endsWith("=") ? null : pair;
      }
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async signIn(identifier = "alice-dev", password = "Valid-password-123!") {
      return this.request("/api/auth/sign-in", { method: "POST", body: { identifier, password } });
    },
  };
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function readStore(name) {
  const raw = await readFile(join(dataDirectory, name), "utf8").catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

const ORG = "/api/organizations/Acme%20Demo";

test("the REQ-2 seed data is provisioned before any scenario runs", async () => {
  const server = await startServer();
  try {
    const visitor = client(server.base);
    const directory = await visitor.request("/api/organizations");
    assert.equal(directory.status, 200);
    const acme = directory.body.organizations.find((organization) => organization.name === "Acme Demo");
    assert.ok(acme, "the seed organization is discoverable by visitors");

    const owner = client(server.base);
    await owner.signIn();
    const mine = await owner.request("/api/organizations?scope=mine");
    assert.equal(mine.body.organizations[0].name, "Acme Demo");
    assert.equal(mine.body.organizations[0].role, "owner");

    const people = await owner.request(`${ORG}/people`);
    assert.deepEqual(people.body.members, [
      { username: "alice-dev", role: "owner" },
      { username: "bob-reviewer", role: "member" },
    ]);

    const teams = await owner.request(`${ORG}/teams`);
    assert.deepEqual(
      teams.body.teams.map((team) => [team.name, team.parentName]),
      [
        ["frontend-child", "frontend-team"],
        ["frontend-team", "platform-team"],
        ["platform-team", null],
      ],
    );

    const stored = await readStore("organizations.json");
    assert.equal(stored.organizations.length, 1);
  } finally {
    await server.close();
  }
});

test("a visitor only receives the public repositories of the organization", async () => {
  const server = await startServer();
  try {
    const visitor = client(server.base);
    const repositories = await visitor.request(`${ORG}/repositories`);
    assert.equal(repositories.status, 200);
    assert.deepEqual(
      repositories.body.repositories.map((repository) => repository.name),
      ["acme-docs"],
    );
    assert.equal(repositories.body.repositories[0].visibility, "public");
    assert.ok(repositories.body.repositories[0].updatedAt);

    const privateRepository = await visitor.request("/api/repositories/Acme%20Demo/acme-internal");
    assert.equal(privateRepository.status, 401);

    const people = await visitor.request(`${ORG}/people`);
    assert.equal(people.status, 401);
    const teams = await visitor.request(`${ORG}/teams`);
    assert.equal(teams.status, 401);
  } finally {
    await server.close();
  }
});

test("organization membership alone grants no access to a private repository", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();
    const ownerRepositories = await owner.request(`${ORG}/repositories`);
    assert.deepEqual(
      ownerRepositories.body.repositories.map((repository) => repository.name),
      ["acme-docs", "acme-internal", "secret-research"],
    );
    const ownerPrivate = await owner.request("/api/repositories/Acme%20Demo/acme-internal");
    assert.equal(ownerPrivate.status, 200);
    assert.equal(ownerPrivate.body.repository.fullName, "Acme Demo/acme-internal");

    const member = client(server.base);
    await member.signIn("bob-reviewer", "Valid-password-123!");
    const memberRepositories = await member.request(`${ORG}/repositories`);
    assert.deepEqual(
      memberRepositories.body.repositories.map((repository) => repository.name),
      ["acme-docs"],
    );
    const memberPrivate = await member.request("/api/repositories/Acme%20Demo/acme-internal");
    assert.equal(memberPrivate.status, 403);
    assert.equal(memberPrivate.body.error, "Access denied");
  } finally {
    await server.close();
  }
});

test("creating an organization stores the owner membership and reports field errors", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const duplicate = await owner.request("/api/organizations", {
      method: "POST",
      body: { name: "Acme Demo", displayName: "" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.errors.name, "Organization name already exists");
    assert.equal(duplicate.body.errors.displayName, "Display name is required");

    const malformed = await owner.request("/api/organizations", {
      method: "POST",
      body: { name: "-invalid-organization", displayName: "   " },
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.errors.name, "Organization name format is invalid");
    assert.equal(malformed.body.errors.displayName, "Display name is required");

    const before = await readStore("organizations.json");
    assert.equal(before.organizations.length, 1, "rejected submissions create nothing");

    const name = `mobile-guild-${uniqueSuffix()}`;
    const created = await owner.request("/api/organizations", {
      method: "POST",
      body: { name, displayName: "  Mobile Guild  " },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.organization.name, name);
    assert.equal(created.body.organization.displayName, "Mobile Guild");
    assert.equal(created.body.organization.role, "owner");

    const mine = await owner.request("/api/organizations?scope=mine");
    const entry = mine.body.organizations.find((organization) => organization.name === name);
    assert.ok(entry, "the new organization is listed for its creator");
    assert.equal(entry.role, "owner");

    const memberships = await readStore("organization-members.json");
    const membership = memberships.memberships.find(
      (candidate) => candidate.organizationId === created.body.organization.id,
    );
    assert.equal(membership.accountId, "acc-alice-dev");
    assert.equal(membership.role, "owner");
  } finally {
    await server.close();
  }
});

test("team creation validates the name and keeps the parent inside the organization", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const malformed = await owner.request(`${ORG}/teams`, {
      method: "POST",
      body: { name: "-mobile-team-", description: "", parentTeamId: "" },
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.errors.name, "Team name format is invalid");

    const duplicate = await owner.request(`${ORG}/teams`, {
      method: "POST",
      body: { name: "frontend-team", description: "", parentTeamId: "" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.errors.name, "Team name already exists");

    const teams = await owner.request(`${ORG}/teams`);
    assert.equal(teams.body.teams.length, 3, "no team is generated for a rejected name");

    const foreignParent = await owner.request(`${ORG}/teams`, {
      method: "POST",
      body: { name: "mobile-team", description: "", parentTeamId: "team-does-not-exist" },
    });
    assert.equal(foreignParent.status, 400);
    assert.equal(
      foreignParent.body.errors.parentTeamId,
      "Parent team does not belong to the organization",
    );

    const name = `mobile-team-${uniqueSuffix()}`;
    const created = await owner.request(`${ORG}/teams`, {
      method: "POST",
      body: { name, description: "Mobile engineering", parentTeamId: "team-frontend-team" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.team.organizationName, "Acme Demo");
    assert.equal(created.body.team.parentName, "frontend-team");
    assert.equal(created.body.team.name, name);

    const detail = await owner.request(`${ORG}/teams/${name}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.team.parentName, "frontend-team");
    assert.deepEqual(detail.body.team.members, []);
  } finally {
    await server.close();
  }
});

test("a parent team may be referenced by name and never crosses the organization", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const name = `mobile-team-${uniqueSuffix()}`;
    const created = await owner.request(`${ORG}/teams`, {
      method: "POST",
      body: { name, description: "", parentTeamId: "frontend-team" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.team.parentName, "frontend-team");
    const stored = await readStore("teams.json");
    assert.equal(
      stored.teams.find((team) => team.name === name).parentTeamId,
      "team-frontend-team",
      "a name reference stores the resolved team identifier",
    );

    const cycle = await owner.request(`${ORG}/teams/frontend-team/parent`, {
      method: "PUT",
      body: { parentTeamId: name },
    });
    assert.equal(cycle.status, 400);
    assert.equal(cycle.body.errors.parentTeamId, "Cyclic team hierarchy is not allowed");
    assert.equal(
      (await readStore("teams.json")).teams.find((team) => team.name === "frontend-team")
        .parentTeamId,
      "team-platform-team",
      "the rejected cycle keeps the stored parent",
    );

    const otherOrganization = `other-org-${uniqueSuffix()}`;
    const organization = await owner.request("/api/organizations", {
      method: "POST",
      body: { name: otherOrganization, displayName: "Other Org" },
    });
    assert.equal(organization.status, 201);
    const foreignTeam = `foreign-team-${uniqueSuffix()}`;
    const foreign = await owner.request(`/api/organizations/${otherOrganization}/teams`, {
      method: "POST",
      body: { name: foreignTeam, description: "", parentTeamId: "" },
    });
    assert.equal(foreign.status, 201);

    const rejected = await owner.request(`${ORG}/teams`, {
      method: "POST",
      body: { name: `sibling-${uniqueSuffix()}`, description: "", parentTeamId: foreignTeam },
    });
    assert.equal(rejected.status, 400);
    assert.equal(
      rejected.body.errors.parentTeamId,
      "Parent team does not belong to the organization",
    );
  } finally {
    await server.close();
  }
});

test("team members are direct relationships restricted to organization members", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const outsiderName = `outsider-${uniqueSuffix()}`;
    const registered = await owner.request("/api/auth/register", {
      method: "POST",
      body: {
        username: outsiderName,
        email: `${outsiderName}@example.test`,
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(registered.status, 201);

    const unknown = await owner.request(`${ORG}/teams/frontend-team/members`, {
      method: "POST",
      body: { username: `unknown-${uniqueSuffix()}` },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.errors.username, "Account not found");

    const nonMember = await owner.request(`${ORG}/teams/frontend-team/members`, {
      method: "POST",
      body: { username: outsiderName },
    });
    assert.equal(nonMember.status, 400);
    assert.equal(nonMember.body.errors.username, "Account is not an organization member");

    const added = await owner.request(`${ORG}/teams/frontend-team/members`, {
      method: "POST",
      body: { username: "bob-reviewer" },
    });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.team.members, ["bob-reviewer"]);

    const duplicate = await owner.request(`${ORG}/teams/frontend-team/members`, {
      method: "POST",
      body: { username: "bob-reviewer" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.errors.username, "Account is already a member of this team");

    const stored = await readStore("teams.json");
    const team = stored.teams.find((candidate) => candidate.name === "frontend-team");
    assert.deepEqual(team.memberIds, ["acc-bob-reviewer"]);

    const outsider = client(server.base);
    await outsider.signIn(outsiderName, "Valid-password-123!");
    const forbidden = await outsider.request(`${ORG}/teams/frontend-team/members`, {
      method: "POST",
      body: { username: "bob-reviewer" },
    });
    assert.equal(forbidden.status, 403);

    const removed = await owner.request(`${ORG}/teams/frontend-team/members/bob-reviewer`, {
      method: "DELETE",
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.team.members, []);
    const after = await readStore("teams.json");
    assert.deepEqual(
      after.teams.find((candidate) => candidate.name === "frontend-team").memberIds,
      [],
    );
  } finally {
    await server.close();
  }
});

test("a cyclic parent is rejected and the stored hierarchy is unchanged", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const cycle = await owner.request(`${ORG}/teams/frontend-team/parent`, {
      method: "PUT",
      body: { parentTeamId: "team-frontend-child" },
    });
    assert.equal(cycle.status, 400);
    assert.equal(cycle.body.errors.parentTeamId, "Cyclic team hierarchy is not allowed");

    const after = await readStore("teams.json");
    assert.equal(
      after.teams.find((candidate) => candidate.name === "frontend-team").parentTeamId,
      "team-platform-team",
    );

    const detail = await owner.request(`${ORG}/teams/frontend-team`);
    assert.equal(detail.body.team.parentTeamId, "team-platform-team");
    assert.equal(detail.body.team.parentName, "platform-team");

    const self = await owner.request(`${ORG}/teams/platform-team/parent`, {
      method: "PUT",
      body: { parentTeamId: "team-platform-team" },
    });
    assert.equal(self.status, 400);
    assert.equal(self.body.errors.parentTeamId, "Cyclic team hierarchy is not allowed");

    const saved = await owner.request(`${ORG}/teams/frontend-child/parent`, {
      method: "PUT",
      body: { parentTeamId: "team-platform-team" },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.team.parentName, "platform-team");
    const stored = await readStore("teams.json");
    assert.equal(
      stored.teams.find((candidate) => candidate.name === "frontend-child").parentTeamId,
      "team-platform-team",
    );
  } finally {
    await server.close();
  }
});

test("organization and repository data survives a restart of the application", async () => {
  const server = await startServer();
  const base = server.base;
  const name = `restart-org-${uniqueSuffix()}`;
  try {
    const owner = client(base);
    await owner.signIn();
    await owner.request("/api/organizations", {
      method: "POST",
      body: { name, displayName: "Restart Org" },
    });
    await owner.request(`${ORG}/teams/frontend-team/members`, {
      method: "POST",
      body: { username: "bob-reviewer" },
    });
  } finally {
    await server.close();
  }

  const restarted = await startServer();
  try {
    const owner = client(restarted.base);
    await owner.signIn();
    const repositories = await owner.request(`${ORG}/repositories`);
    assert.deepEqual(
      repositories.body.repositories.map((repository) => repository.name),
      ["acme-docs", "acme-internal", "secret-research"],
    );
    const mine = await owner.request("/api/organizations?scope=mine");
    assert.ok(
      mine.body.organizations.some((organization) => organization.name === name),
      "the organization created before the restart is still listed",
    );
    const detail = await owner.request(`${ORG}/teams/frontend-team`);
    assert.deepEqual(detail.body.team.members, ["bob-reviewer"]);
  } finally {
    await restarted.close();
  }
});
