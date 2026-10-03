import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-org-")));
  const app = await createApp({ dataDir });
  const server = createServer((request, response) => {
    void app.handle(request, response);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    dataDir,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((done) => server.close(done));
    },
  };
}

async function call(base, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
    sessionCookie: (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; "),
  };
}

async function signIn(base, identifier) {
  return call(base, "/api/session", { method: "POST", body: { identifier, password: "Valid-password-123!" } });
}

test("visitors discover public repositories and never see the private one", async () => {
  const app = await startApp();
  try {
    const organizations = await call(app.base, "/api/public/organizations");
    assert.equal(organizations.status, 200);
    assert.deepEqual(organizations.body.organizations.map((organization) => organization.slug), ["acme-demo"]);
    assert.equal(organizations.body.organizations[0].displayName, "Acme Demo");
    assert.equal(organizations.body.organizations[0].role, null);

    const repositories = await call(app.base, "/api/organizations/acme-demo/repositories");
    assert.equal(repositories.status, 200);
    assert.deepEqual(
      repositories.body.repositories.map((repository) => repository.name),
      ["acme-docs", "branch-switch-demo", "default-branch-demo", "file-management-demo"],
    );
    assert.equal(repositories.body.repositories[0].visibility, "public");
    assert.equal(typeof repositories.body.repositories[0].updatedAt, "string");

    const publicRepository = await call(app.base, "/api/repositories/acme-demo/acme-docs");
    assert.equal(publicRepository.status, 200);
    assert.equal(publicRepository.body.repository.name, "acme-docs");
    assert.deepEqual(publicRepository.body.repository.owner, {
      type: "organization",
      id: publicRepository.body.repository.owner.id,
      login: "acme-demo",
      displayName: "Acme Demo",
    });

    const privateRepository = await call(app.base, "/api/repositories/acme-demo/secret-research");
    assert.equal(privateRepository.status, 403);
    assert.equal(privateRepository.body.error, "Access denied");
  } finally {
    await app.close();
  }
});

test("organization membership alone does not expose a private repository", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "bob-reviewer");
    assert.equal(signedIn.status, 200);

    const repositories = await call(app.base, "/api/organizations/acme-demo/repositories", { cookie: signedIn.sessionCookie });
    assert.equal(repositories.status, 200);
    assert.deepEqual(
      repositories.body.repositories.map((repository) => repository.name),
      ["acme-docs", "branch-switch-demo", "default-branch-demo", "file-management-demo"],
    );

    const privateRepository = await call(app.base, "/api/repositories/acme-demo/secret-research", { cookie: signedIn.sessionCookie });
    assert.equal(privateRepository.status, 403);
  } finally {
    await app.close();
  }
});

test("an owner creates an organization that persists across restart", async () => {
  const first = await startApp();
  const dataDir = first.dataDir;
  let orgId;
  try {
    const signedIn = await signIn(first.base, "org-owner");
    assert.equal(signedIn.status, 200);

    const created = await call(first.base, "/api/organizations", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: { organizationName: "mobile-guild", displayName: "Mobile Guild" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.organization.slug, "mobile-guild");
    assert.equal(created.body.organization.displayName, "Mobile Guild");
    assert.equal(created.body.organization.role, "owner");
    orgId = created.body.organization.id;

    const overview = await call(first.base, "/api/organizations/mobile-guild", { cookie: signedIn.sessionCookie });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.organization.slug, "mobile-guild");
  } finally {
    await first.close();
  }

  const second = await startApp(dataDir);
  try {
    const signedIn = await signIn(second.base, "org-owner");
    const organizations = await call(second.base, "/api/organizations", { cookie: signedIn.sessionCookie });
    const slugs = organizations.body.organizations.map((organization) => organization.slug);
    assert.ok(slugs.includes("mobile-guild"));
    assert.ok(slugs.includes("acme-demo"));
    assert.equal(organizations.body.organizations.find((organization) => organization.slug === "mobile-guild").id, orgId);
  } finally {
    await second.close();
  }
});

test("rejects duplicate and invalid organization submissions without creating one", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "org-owner");

    const duplicate = await call(app.base, "/api/organizations", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: { organizationName: "Acme Demo", displayName: "" },
    });
    assert.equal(duplicate.status, 400);
    assert.deepEqual(Object.keys(duplicate.body.fields), ["organizationName"]);
    assert.equal(duplicate.body.fields.organizationName, "Organization name already exists");

    const invalid = await call(app.base, "/api/organizations", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: { organizationName: "-invalid-organization", displayName: "   " },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fields.organizationName, "Organization name format is invalid");
    assert.equal(invalid.body.fields.displayName, "Display name is required");

    const organizations = await call(app.base, "/api/organizations", { cookie: signedIn.sessionCookie });
    assert.deepEqual(organizations.body.organizations.map((organization) => organization.slug), ["acme-demo"]);
  } finally {
    await app.close();
  }
});

test("creates a team and rejects a malformed name", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "org-owner");

    const created = await call(app.base, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: { teamName: "mobile-team" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.team.slug, "mobile-team");

    const invalid = await call(app.base, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: { teamName: "-invalid-team" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fields.teamName, "Team name is invalid");

    const teams = await call(app.base, "/api/organizations/acme-demo/teams", { cookie: signedIn.sessionCookie });
    const slugs = teams.body.teams.map((team) => team.slug);
    assert.ok(slugs.includes("mobile-team"));
    assert.ok(!slugs.includes("-invalid-team"));
  } finally {
    await app.close();
  }
});

test("adds and removes a team member with an immediate persisted result", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "team-maintainer");

    const added = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.members.map((member) => member.username), ["bob-reviewer"]);

    const afterAdd = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team", { cookie: signedIn.sessionCookie });
    assert.deepEqual(afterAdd.body.members.map((member) => member.username), ["bob-reviewer"]);

    const removed = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer", {
      method: "DELETE",
      cookie: signedIn.sessionCookie,
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.members, []);

    const afterRemove = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team", { cookie: signedIn.sessionCookie });
    assert.deepEqual(afterRemove.body.members, []);
  } finally {
    await app.close();
  }
});

test("rejects a cyclic parent and keeps the saved parent", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "team-maintainer");

    const team = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team", { cookie: signedIn.sessionCookie });
    assert.equal(team.body.team.parent, "platform-team");
    // Every other team of the organization is a candidate parent, including the
    // seeded access-role-team.
    assert.deepEqual(team.body.parentOptions, ["access-role-team", "frontend-child", "platform-team"]);

    const cyclic = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team/parent", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: { parentTeam: "frontend-child" },
    });
    assert.equal(cyclic.status, 400);
    assert.equal(cyclic.body.fields.parentTeam, "Cyclic team hierarchy is not allowed");

    const after = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team", { cookie: signedIn.sessionCookie });
    assert.equal(after.body.team.parent, "platform-team");

    const reparented = await call(app.base, "/api/organizations/acme-demo/teams/frontend-child/parent", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: { parentTeam: "platform-team" },
    });
    assert.equal(reparented.status, 200);
    assert.equal(reparented.body.team.parent, "platform-team");
  } finally {
    await app.close();
  }
});

test("only an organization owner may create teams or change hierarchy", async () => {
  const app = await startApp();
  try {
    const member = await signIn(app.base, "bob-reviewer");

    const createTeam = await call(app.base, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: member.sessionCookie,
      body: { teamName: "sneaky-team" },
    });
    assert.equal(createTeam.status, 403);

    const reparent = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team/parent", {
      method: "POST",
      cookie: member.sessionCookie,
      body: { parentTeam: "platform-team" },
    });
    assert.equal(reparent.status, 403);

    const anonymous = await call(app.base, "/api/organizations/acme-demo/teams");
    assert.equal(anonymous.status, 401);
  } finally {
    await app.close();
  }
});

test("lists organization people with their roles for members only", async () => {
  const app = await startApp();
  try {
    const anonymous = await call(app.base, "/api/organizations/acme-demo/people");
    assert.equal(anonymous.status, 403);

    const signedIn = await signIn(app.base, "org-owner");
    const people = await call(app.base, "/api/organizations/acme-demo/people", { cookie: signedIn.sessionCookie });
    assert.equal(people.status, 200);
    const byName = Object.fromEntries(people.body.people.map((person) => [person.username, person.role]));
    assert.equal(byName["org-owner"], "Owner");
    assert.equal(byName["team-maintainer"], "Owner");
    assert.equal(byName["bob-reviewer"], "Member");
  } finally {
    await app.close();
  }
});
