import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const OWNER = { username: "alice-dev", password: "Valid-password-123!" };
const MEMBER = { username: "bob-reviewer", password: "Valid-password-123!" };

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, { username, password }) {
  const response = await call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier: username, password },
  });
  assert.equal(response.status, 200);
  return response.setCookie?.split(";")[0] ?? null;
}

test("the seed organization publishes its identity, members, teams and public repositories", async () => {
  await withApp(async (app) => {
    const detail = await call(app.baseUrl, "/api/organizations/acme-demo");
    assert.equal(detail.status, 200);
    assert.equal(detail.body.organization.name, "acme-demo");
    assert.equal(detail.body.organization.displayName, "Acme Demo");
    assert.equal(detail.body.viewerRole, null);

    const members = await call(app.baseUrl, "/api/organizations/acme-demo/members");
    assert.deepEqual(
      members.body.members.map((member) => `${member.username}:${member.role}`),
      ["alice-dev:owner", "bob-reviewer:member"],
    );

    const teams = await call(app.baseUrl, "/api/organizations/acme-demo/teams");
    assert.deepEqual(
      teams.body.teams.map((team) => `${team.name}:${team.parent ?? "-"}`),
      [
        "design-team:-",
        "frontend-child:frontend-team",
        "frontend-team:platform-team",
        "platform-team:-",
      ],
    );

    const repositories = await call(app.baseUrl, "/api/organizations/acme-demo/repositories");
    assert.deepEqual(
      repositories.body.repositories.map((repository) => repository.name),
      ["acme-docs"],
    );
    const [publicRepository] = repositories.body.repositories;
    assert.equal(publicRepository.visibility, "public");
    assert.equal(typeof publicRepository.description, "string");
    assert.equal(typeof publicRepository.updatedAt, "string");
  });
});

test("a visitor never reaches the private organization repository", async () => {
  await withApp(async (app) => {
    const publicRepository = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs");
    assert.equal(publicRepository.status, 200);
    assert.equal(publicRepository.body.repository.name, "acme-docs");
    assert.equal(publicRepository.body.repository.owner, "acme-demo");

    const privateRepository = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research",
    );
    assert.equal(privateRepository.status, 403);
    assert.equal(privateRepository.body.error, "Access denied");

    const missing = await call(app.baseUrl, "/api/repositories/acme-demo/not-there");
    assert.equal(missing.status, 404);
  });
});

test("organization membership alone grants no private-repository access", async () => {
  await withApp(async (app) => {
    const memberCookie = await signIn(app, MEMBER);
    const ownerCookie = await signIn(app, OWNER);

    const memberRepositories = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/repositories",
      { cookie: memberCookie },
    );
    assert.deepEqual(
      memberRepositories.body.repositories.map((repository) => repository.name),
      ["acme-docs"],
    );
    const memberPrivate = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: memberCookie,
    });
    assert.equal(memberPrivate.status, 403);

    const ownerRepositories = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/repositories",
      { cookie: ownerCookie },
    );
    assert.deepEqual(
      ownerRepositories.body.repositories.map((repository) => repository.name),
      ["acme-docs", "secret-research"],
    );
    const ownerPrivate = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: ownerCookie,
    });
    assert.equal(ownerPrivate.status, 200);
    assert.equal(ownerPrivate.body.repository.visibility, "private");
  });
});

test("creating an organization stores the identifier, display name and Owner membership", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    const created = await call(app.baseUrl, "/api/organizations", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "mobile-guild", displayName: "  Mobile Guild  " },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.organization.name, "mobile-guild");
    assert.equal(created.body.organization.displayName, "Mobile Guild");

    const mine = await call(app.baseUrl, "/api/organizations", { cookie: ownerCookie });
    assert.deepEqual(
      mine.body.organizations.map((organization) => `${organization.name}:${organization.role}`),
      ["acme-demo:owner", "mobile-guild:owner"],
    );

    // The identifier scopes later team/member/repository work, so it must
    // survive a restart and still answer with the creator as Owner.
    await app.restart();
    const restored = await call(app.baseUrl, "/api/organizations/mobile-guild", {
      cookie: ownerCookie,
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.organization.displayName, "Mobile Guild");
    assert.equal(restored.body.viewerRole, "owner");

    const members = await call(app.baseUrl, "/api/organizations/mobile-guild/members");
    assert.deepEqual(
      members.body.members.map((member) => `${member.username}:${member.role}`),
      ["alice-dev:owner"],
    );

    const otherAccount = await signIn(app, MEMBER);
    const otherList = await call(app.baseUrl, "/api/organizations", { cookie: otherAccount });
    assert.deepEqual(
      otherList.body.organizations.map((organization) => organization.name),
      ["acme-demo"],
    );
  });
});

test("duplicate, malformed and blank-display submissions create nothing", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    const duplicate = await call(app.baseUrl, "/api/organizations", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "acme-demo", displayName: "" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Organization name already exists");
    assert.equal(duplicate.body.fieldErrors.displayName, undefined);

    const duplicateWithDisplayName = await call(app.baseUrl, "/api/organizations", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "acme-demo", displayName: "Another Acme" },
    });
    assert.equal(duplicateWithDisplayName.status, 400);
    assert.equal(duplicateWithDisplayName.body.fieldErrors.name, "Organization name already exists");

    const malformed = await call(app.baseUrl, "/api/organizations", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "-invalid-organization", displayName: "Invalid" },
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.fieldErrors.name, "Organization name format is invalid");

    const blankDisplayName = await call(app.baseUrl, "/api/organizations", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "mobile-guild", displayName: "   " },
    });
    assert.equal(blankDisplayName.status, 400);
    assert.equal(blankDisplayName.body.fieldErrors.displayName, "Display name is required");

    const mine = await call(app.baseUrl, "/api/organizations", { cookie: ownerCookie });
    assert.deepEqual(
      mine.body.organizations.map((organization) => organization.name),
      ["acme-demo"],
    );
  });
});

test("organization reads and writes require a session", async () => {
  await withApp(async (app) => {
    const list = await call(app.baseUrl, "/api/organizations");
    assert.equal(list.status, 401);
    assert.equal(list.body.error, "Not authenticated");

    const create = await call(app.baseUrl, "/api/organizations", {
      method: "POST",
      body: { name: "mobile-guild", displayName: "Mobile Guild" },
    });
    assert.equal(create.status, 401);
    assert.equal(create.body.error, "Not authenticated");

    const detail = await call(app.baseUrl, "/api/organizations/acme-demo");
    assert.equal(detail.status, 200);

    const unknown = await call(app.baseUrl, "/api/organizations/not-an-organization");
    assert.equal(unknown.status, 404);
  });
});
