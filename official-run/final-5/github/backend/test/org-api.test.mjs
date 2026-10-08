import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-org-"));
  const store = createAuthStore(dataDir);
  const orgStore = createOrgStore(dataDir);
  const handler = createRequestHandler({ store, orgStore, staticRoot: join(dataDir, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function collectCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(baseUrl, method, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    cookie: collectCookie(response),
  };
}

async function signIn(baseUrl, identifier, password = "Valid-password-123!") {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  return { ...result, cookie: result.cookie };
}

test("a visitor only discovers public organization repositories", async () => {
  const app = await startApp();
  try {
    const organizations = await request(app.baseUrl, "GET", "/api/organizations");
    assert.equal(organizations.status, 200);
    assert.deepEqual(organizations.body.organizations, [
      { id: "acme-demo", displayName: "Acme Demo" },
      // REQ-3-5: the organization owning the archive repositories is public
      // because its repositories are, so a visitor discovers it too.
      { id: "evo-archive-org", displayName: "evo-archive-org" },
    ]);

    const overview = await request(app.baseUrl, "GET", "/api/organizations/acme-demo");
    assert.equal(overview.status, 200);
    assert.deepEqual(overview.body.organization, { id: "acme-demo", displayName: "Acme Demo" });
    assert.equal(overview.body.viewerRole, null);

    const repositories = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories");
    assert.equal(repositories.status, 200);
    assert.deepEqual(
      repositories.body.repositories.map((repository) => repository.name),
      [
        "acme-docs",
        "branch-switch-demo",
        "default-branch-demo",
        "branch-protection-demo",
        "file-management-demo",
        "evo-search-catalog-s1",
        "evo-search-notebook-s2",
        // REQ-4-3-1 / REQ-4-5: the branch-switching and release evolution
        // repositories are public as well.
        "evo-branch-switch-s1",
        "evo-branch-switch-s2",
        "evo-branch-switch-s3",
        "evo-release-repository-s1",
        "evo-release-repository-s2",
        "evo-release-repository-s3",
        // REQ-5-5: the public repository of the reaction scenarios.
        "evo-reaction-repository-s1",
      ],
    );
    const [acmeDocs] = repositories.body.repositories;
    assert.equal(acmeDocs.visibility, "public");
    assert.equal(typeof acmeDocs.description, "string");
    assert.equal(typeof acmeDocs.updatedAt, "string");

    const filtered = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/acme-demo/repositories?q=secret-research",
    );
    assert.deepEqual(filtered.body.repositories, []);

    const privateRepository = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research");
    assert.equal(privateRepository.status, 403);
    assert.equal(privateRepository.body.message, "Access denied");

    const publicRepository = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs");
    assert.equal(publicRepository.status, 200);
    assert.equal(publicRepository.body.repository.name, "acme-docs");
    assert.equal(publicRepository.body.repository.owner.displayName, "Acme Demo");
  } finally {
    await app.close();
  }
});

test("organization membership alone never unlocks a private repository", async () => {
  const app = await startApp();
  try {
    const member = await signIn(app.baseUrl, "bob-reviewer");
    assert.equal(member.status, 200);

    const denied = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research", undefined, member.cookie);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const organizationRepositories = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/acme-demo/repositories",
      undefined,
      member.cookie,
    );
    assert.deepEqual(
      organizationRepositories.body.repositories.map((repository) => repository.name),
      [
        "acme-docs",
        "branch-switch-demo",
        "default-branch-demo",
        "branch-protection-demo",
        "file-management-demo",
        "evo-search-catalog-s1",
        "evo-search-notebook-s2",
        // REQ-4-3-1 / REQ-4-5: the branch-switching and release evolution
        // repositories are public as well.
        "evo-branch-switch-s1",
        "evo-branch-switch-s2",
        "evo-branch-switch-s3",
        "evo-release-repository-s1",
        "evo-release-repository-s2",
        "evo-release-repository-s3",
        // REQ-5-5: the public repository of the reaction scenarios.
        "evo-reaction-repository-s1",
      ],
    );

    const owner = await signIn(app.baseUrl, "org-owner");
    const allowed = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research", undefined, owner.cookie);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.repository.visibility, "private");
  } finally {
    await app.close();
  }
});

test("a team grant and a direct account grant both unlock a private repository", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-org-grants-"));
  await writeFile(
    join(dataDir, "organizations.json"),
    JSON.stringify({
      organizations: [{ id: "acme-demo", displayName: "Acme Demo" }],
      memberships: [{ organizationId: "acme-demo", accountId: "account-org-member", role: "Member" }],
      teams: [{ id: "team-team-one", organizationId: "acme-demo", name: "team-one", parentTeamId: null }],
      teamMembers: [
        { teamId: "team-team-one", accountId: "account-bob-reviewer" },
        { teamId: "team-team-one", accountId: "account-protected-member" },
      ],
      repositories: [
        { id: "repo-private", ownerType: "organization", ownerId: "acme-demo", name: "secret-research", visibility: "private" },
      ],
      accessGrants: [
        { id: "grant-team", repositoryId: "repo-private", subjectType: "team", subjectId: "team-team-one", role: "Read" },
        { id: "grant-account", repositoryId: "repo-private", subjectType: "account", subjectId: "account-new-member", role: "Read" },
      ],
    }),
    "utf8",
  );
  const orgStore = createOrgStore(dataDir);
  const repository = await orgStore.getRepository({ organizationId: "acme-demo", name: "secret-research" });

  assert.equal(await orgStore.canReadRepository(repository, null), false);
  assert.equal(await orgStore.canReadRepository(repository, "account-org-member"), false);
  assert.equal(await orgStore.canReadRepository(repository, "account-bob-reviewer"), true);
  assert.equal(await orgStore.canReadRepository(repository, "account-new-member"), true);
});

test("a signed-in account creates an organization, keeps it after restart, and stays Owner", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "org-owner");
    const created = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "mobile-guild", displayName: "  Mobile Guild  " },
      owner.cookie,
    );
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.organization, { id: "mobile-guild", displayName: "Mobile Guild" });

    const overview = await request(app.baseUrl, "GET", "/api/organizations/mobile-guild", undefined, owner.cookie);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");

    const mine = await request(app.baseUrl, "GET", "/api/organizations", undefined, owner.cookie);
    assert.deepEqual(
      mine.body.organizations.map((organization) => organization.id).sort(),
      ["acme-demo", "mobile-guild"],
    );

    // A visitor cannot open an organization without public repositories.
    const visitor = await request(app.baseUrl, "GET", "/api/organizations/mobile-guild");
    assert.equal(visitor.status, 403);

    // The new organization survives a restart against the same data directory.
    const restarted = createOrgStore(app.dataDir);
    assert.deepEqual(await restarted.getOrganization("mobile-guild"), {
      id: "mobile-guild",
      displayName: "Mobile Guild",
    });
    assert.equal((await restarted.getMembership("mobile-guild", "account-org-owner"))?.role, "Owner");

    // The creating account stays Owner even while another Owner also exists.
    const other = await signIn(app.baseUrl, "team-maintainer");
    const otherCreate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "other-guild", displayName: "Other Guild" },
      other.cookie,
    );
    assert.equal(otherCreate.status, 201);
    assert.equal((await restarted.getMembership("other-guild", "account-team-maintainer"))?.role, "Owner");
  } finally {
    await app.close();
  }
});

test("organization creation reports duplicate, malformed and empty display names", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "org-owner");

    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "acme-demo", displayName: "" },
      owner.cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Organization name already exists");
    assert.equal(duplicate.body.fieldErrors.displayName, "Display name is required");

    const malformed = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "-invalid-organization", displayName: "   " },
      owner.cookie,
    );
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.fieldErrors.name, "Organization name format is invalid");
    assert.equal(malformed.body.fieldErrors.displayName, "Display name is required");

    const organizations = await request(app.baseUrl, "GET", "/api/organizations", undefined, owner.cookie);
    assert.deepEqual(
      organizations.body.organizations.map((organization) => organization.id),
      ["acme-demo"],
    );

    const anonymous = await request(app.baseUrl, "POST", "/api/organizations", {
      name: "anon-guild",
      displayName: "Anon Guild",
    });
    assert.equal(anonymous.status, 401);
  } finally {
    await app.close();
  }
});

test("only an organization Owner creates teams and a team name is validated", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "team-maintainer");
    const created = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", { name: "mobile-team" }, owner.cookie);
    assert.equal(created.status, 201);
    assert.equal(created.body.team.name, "mobile-team");
    assert.equal(created.body.team.parentName, null);

    const duplicate = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", { name: "mobile-team" }, owner.cookie);
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.message, "Team name is invalid");

    const malformed = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", { name: "-invalid-team" }, owner.cookie);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.fieldErrors.name, "Team name is invalid");

    const member = await signIn(app.baseUrl, "bob-reviewer");
    const forbidden = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", { name: "member-team" }, member.cookie);
    assert.equal(forbidden.status, 403);

    const visitor = await request(app.baseUrl, "POST", "/api/organizations/acme-demo/teams", { name: "visitor-team" });
    assert.equal(visitor.status, 401);

    const teams = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams", undefined, owner.cookie);
    assert.deepEqual(
      teams.body.teams.map((team) => team.name).sort(),
      ["access-role-team", "frontend-child", "frontend-team", "mobile-team", "platform-team"],
    );

    const restarted = createOrgStore(app.dataDir);
    assert.equal((await restarted.getTeam("acme-demo", "invalid-team"))?.name ?? null, null);
    assert.equal((await restarted.getTeam("acme-demo", "mobile-team")).name, "mobile-team");
  } finally {
    await app.close();
  }
});

test("team members are added and removed through the API", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "team-maintainer");

    const added = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { username: "bob-reviewer" },
      owner.cookie,
    );
    assert.equal(added.status, 201);
    assert.equal(added.body.member.username, "bob-reviewer");

    const listed = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team/members", undefined, owner.cookie);
    assert.deepEqual(listed.body.members, [{ username: "bob-reviewer" }]);

    const removed = await request(
      app.baseUrl,
      "DELETE",
      "/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer",
      undefined,
      owner.cookie,
    );
    assert.equal(removed.status, 200);

    const afterRemoval = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team/members", undefined, owner.cookie);
    assert.deepEqual(afterRemoval.body.members, []);

    const unknown = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { username: "unknown-reviewer" },
      owner.cookie,
    );
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.message, "Account not found");

    const stranger = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { username: "alice-dev" },
      owner.cookie,
    );
    assert.equal(stranger.status, 400);
    assert.equal(stranger.body.message, "Account is not an organization member");

    const byEmail = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { username: "bob-reviewer@example.test" },
      owner.cookie,
    );
    assert.equal(byEmail.status, 201);

    const member = await signIn(app.baseUrl, "bob-reviewer");
    const forbidden = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { username: "org-owner" },
      member.cookie,
    );
    assert.equal(forbidden.status, 403);
  } finally {
    await app.close();
  }
});

test("a cyclic parent-team change is rejected and the saved parent is kept", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "team-maintainer");

    const initial = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team", undefined, owner.cookie);
    assert.equal(initial.body.team.parentName, "platform-team");

    const cyclic = await request(
      app.baseUrl,
      "PATCH",
      "/api/organizations/acme-demo/teams/frontend-team",
      { parentName: "frontend-child" },
      owner.cookie,
    );
    assert.equal(cyclic.status, 400);
    assert.equal(cyclic.body.message, "Cyclic team hierarchy is not allowed");

    const selfCycle = await request(
      app.baseUrl,
      "PATCH",
      "/api/organizations/acme-demo/teams/frontend-team",
      { parentName: "frontend-team" },
      owner.cookie,
    );
    assert.equal(selfCycle.status, 400);

    const afterRejection = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams/frontend-team", undefined, owner.cookie);
    assert.equal(afterRejection.body.team.parentName, "platform-team");

    const saved = await request(
      app.baseUrl,
      "PATCH",
      "/api/organizations/acme-demo/teams/frontend-team",
      { parentName: "access-role-team" },
      owner.cookie,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.team.parentName, "access-role-team");

    const cleared = await request(
      app.baseUrl,
      "PATCH",
      "/api/organizations/acme-demo/teams/frontend-team",
      { parentName: "" },
      owner.cookie,
    );
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.team.parentName, null);

    const restarted = createOrgStore(app.dataDir);
    assert.equal((await restarted.getTeam("acme-demo", "frontend-team")).parentName, null);
  } finally {
    await app.close();
  }
});

test("team pages are hidden from visitors and non-members", async () => {
  const app = await startApp();
  try {
    const visitor = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams");
    assert.equal(visitor.status, 403);
    const visitorPeople = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/people");
    assert.equal(visitorPeople.status, 403);

    const outsider = await signIn(app.baseUrl, "alice-dev");
    const outsiderTeams = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/teams", undefined, outsider.cookie);
    assert.equal(outsiderTeams.status, 403);

    const member = await signIn(app.baseUrl, "org-member");
    const people = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/people", undefined, member.cookie);
    assert.equal(people.status, 200);
    assert.deepEqual(
      people.body.members.map((entry) => entry.username).sort(),
      ["bob-reviewer", "existing-member", "org-member", "org-owner", "protected-member", "team-maintainer"],
    );
    assert.equal(people.body.members.find((entry) => entry.username === "org-owner").role, "Owner");
  } finally {
    await app.close();
  }
});

test("an Owner directly adds an existing account as a member", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "org-owner");
    const added = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/people",
      { identifier: "new-member", role: "Member" },
      owner.cookie,
    );
    assert.equal(added.status, 201);
    assert.deepEqual(added.body.member, { username: "new-member", role: "Member" });

    const people = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/people", undefined, owner.cookie);
    assert.equal(people.body.members.find((entry) => entry.username === "new-member").role, "Member");

    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/people",
      { identifier: "new-member", role: "Member" },
      owner.cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.message, "Account is already a member");

    const unknown = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/people",
      { identifier: "unknown-reviewer", role: "Member" },
      owner.cookie,
    );
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.message, "Account not found");

    // The added Member sees the organization but membership alone unlocks nothing.
    const member = await signIn(app.baseUrl, "new-member");
    const organizations = await request(app.baseUrl, "GET", "/api/organizations", undefined, member.cookie);
    assert.ok(organizations.body.organizations.some((entry) => entry.id === "acme-demo"));
    const denied = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/secret-research",
      undefined,
      member.cookie,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const nonOwner = await signIn(app.baseUrl, "org-member");
    const forbidden = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/people",
      { identifier: "bob-reviewer", role: "Member" },
      nonOwner.cookie,
    );
    assert.equal(forbidden.status, 403);

    const restarted = createOrgStore(app.dataDir);
    assert.equal((await restarted.getMembership("acme-demo", "account-new-member"))?.role, "Member");
  } finally {
    await app.close();
  }
});

test("removing a member cascades team memberships and direct grants but keeps team grants", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "org-owner");

    const teamAdd = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { username: "existing-member" },
      owner.cookie,
    );
    assert.equal(teamAdd.status, 201);

    const directGrant = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/secret-research/access",
      { subjectType: "account", subjectName: "existing-member", role: "Read" },
      owner.cookie,
    );
    assert.equal(directGrant.status, 201);

    const removed = await request(
      app.baseUrl,
      "DELETE",
      "/api/organizations/acme-demo/people/existing-member",
      undefined,
      owner.cookie,
    );
    assert.equal(removed.status, 200);

    const people = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/people", undefined, owner.cookie);
    assert.equal(people.body.members.some((entry) => entry.username === "existing-member"), false);

    const restarted = createOrgStore(app.dataDir);
    assert.equal(await restarted.getMembership("acme-demo", "account-existing-member"), null);
    assert.deepEqual(await restarted.listTeamMemberIds("acme-demo", "frontend-team"), []);
    assert.equal(
      (await restarted.listAccessGrants("repo-secret-research")).some(
        (entry) => entry.subjectType === "account" && entry.subjectId === "account-existing-member",
      ),
      false,
    );
    // Team grants are not deleted with the member.
    assert.equal(
      (await restarted.listAccessGrants("repo-acme-docs")).some(
        (entry) => entry.subjectType === "team" && entry.subjectId === "team-access-role-team",
      ),
      true,
    );
  } finally {
    await app.close();
  }
});

test("removal keeps at least one Owner and is Owner-only", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "org-owner");
    const created = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "solo-org", displayName: "Solo Org" },
      owner.cookie,
    );
    const soloId = created.body.organization.id;

    const rejected = await request(
      app.baseUrl,
      "DELETE",
      `/api/organizations/${soloId}/people/org-owner`,
      undefined,
      owner.cookie,
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.message, "Organization must have at least one owner");

    const nonOwner = await signIn(app.baseUrl, "org-member");
    const forbidden = await request(
      app.baseUrl,
      "DELETE",
      "/api/organizations/acme-demo/people/protected-member",
      undefined,
      nonOwner.cookie,
    );
    assert.equal(forbidden.status, 403);

    const restarted = createOrgStore(app.dataDir);
    assert.equal((await restarted.getMembership(soloId, "account-org-owner"))?.role, "Owner");
    assert.equal((await restarted.getMembership("acme-demo", "account-protected-member"))?.role, "Member");
  } finally {
    await app.close();
  }
});

test("a repository Admin manages team access grants", async () => {
  const app = await startApp();
  try {
    const admin = await signIn(app.baseUrl, "repo-admin");
    const initial = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/access", undefined, admin.cookie);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.access.find((entry) => entry.subjectName === "access-role-team").role, "Write");
    assert.ok(initial.body.candidates.teams.some((team) => team.name === "frontend-team"));

    const added = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/access",
      { subjectType: "team", subjectName: "frontend-team", role: "Write" },
      admin.cookie,
    );
    assert.equal(added.status, 201);
    assert.equal(added.body.access.subjectName, "frontend-team");
    assert.equal(added.body.access.role, "Write");

    const grant = initial.body.access.find((entry) => entry.subjectName === "access-role-team");
    const updated = await request(
      app.baseUrl,
      "PATCH",
      `/api/repositories/acme-demo/acme-docs/access/${grant.id}`,
      { role: "Read" },
      admin.cookie,
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.access.role, "Read");

    const after = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/access", undefined, admin.cookie);
    const rows = after.body.access.filter((entry) => entry.subjectName === "access-role-team");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "Read");
    assert.equal(after.body.access.filter((entry) => entry.subjectName === "frontend-team").length, 1);

    const restarted = createOrgStore(app.dataDir);
    assert.equal(
      (await restarted.listAccessGrants("repo-acme-docs")).filter((entry) => entry.subjectId === "team-access-role-team")
        .length,
      1,
    );

    const member = await signIn(app.baseUrl, "bob-reviewer");
    const denied = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/access", undefined, member.cookie);
    assert.equal(denied.status, 403);

    const visitor = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/access");
    assert.equal(visitor.status, 401);

    const detail = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs", undefined, admin.cookie);
    assert.equal(detail.body.repository.canManage, true);
  } finally {
    await app.close();
  }
});
