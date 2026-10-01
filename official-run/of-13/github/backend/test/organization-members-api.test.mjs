import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const OWNER = { username: "alice-dev", password: "Valid-password-123!" };
const MEMBER = { username: "bob-reviewer", password: "Valid-password-123!" };
const OUTSIDER = { username: "carol-newcomer", password: "Valid-password-123!" };

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

async function register(app, username, email) {
  const response = await call(app.baseUrl, "/api/register", {
    method: "POST",
    body: {
      username,
      email,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
  });
  assert.equal(response.status, 201);
}

test("an Owner adds an existing account by username or verified email", async () => {
  await withApp(async (app) => {
    await register(app, OUTSIDER.username, "carol.newcomer@example.test");
    const ownerCookie = await signIn(app, OWNER);

    const added = await call(app.baseUrl, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: ownerCookie,
      body: { identifier: "carol.newcomer@example.test", role: "Member" },
    });
    assert.equal(added.status, 201);
    assert.deepEqual(added.body.member, { username: "carol-newcomer", role: "member" });

    const people = await call(app.baseUrl, "/api/organizations/acme-demo/members");
    assert.deepEqual(
      people.body.members.map((member) => `${member.username}:${member.role}`),
      ["alice-dev:owner", "bob-reviewer:member", "carol-newcomer:member"],
    );

    // The new member now sees the organization, but no private repository.
    const memberCookie = await signIn(app, OUTSIDER);
    const mine = await call(app.baseUrl, "/api/organizations", { cookie: memberCookie });
    assert.deepEqual(
      mine.body.organizations.map((organization) => organization.name),
      ["acme-demo"],
    );
    const privateRepository = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research",
      { cookie: memberCookie },
    );
    assert.equal(privateRepository.status, 403);
    assert.equal(privateRepository.body.error, "Access denied");

    await app.restart();
    const afterRestart = await call(app.baseUrl, "/api/organizations/acme-demo/members");
    assert.equal(
      afterRestart.body.members.filter((member) => member.username === "carol-newcomer").length,
      1,
    );
  });
});

test("duplicate, unknown, unsupported and unauthorized adds change nothing", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const memberCookie = await signIn(app, MEMBER);

    const duplicate = await call(app.baseUrl, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: ownerCookie,
      body: { identifier: "bob-reviewer", role: "Member" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.identifier, "Account is already a member");

    const unknown = await call(app.baseUrl, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: ownerCookie,
      body: { identifier: "unknown-reviewer", role: "Member" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fieldErrors.identifier, "Account not found");

    const badRole = await call(app.baseUrl, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: ownerCookie,
      body: { identifier: "bob-reviewer", role: "Maintainer" },
    });
    assert.equal(badRole.status, 400);
    assert.equal(badRole.body.fieldErrors.role, "Role is not supported");

    const notOwner = await call(app.baseUrl, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: memberCookie,
      body: { identifier: "bob-reviewer", role: "Owner" },
    });
    assert.equal(notOwner.status, 403);

    const people = await call(app.baseUrl, "/api/organizations/acme-demo/members");
    assert.deepEqual(
      people.body.members.map((member) => member.username),
      ["alice-dev", "bob-reviewer"],
    );
  });
});

test("removal cascades to team memberships and keeps the account", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    // Join a team before the removal; the membership must disappear with it.
    const teamAdd = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { method: "POST", cookie: ownerCookie, body: { username: "bob-reviewer" } },
    );
    assert.equal(teamAdd.status, 201);
    const memberCookie = await signIn(app, MEMBER);

    const removed = await call(app.baseUrl, "/api/organizations/acme-demo/members/bob-reviewer", {
      method: "DELETE",
      cookie: ownerCookie,
    });
    assert.equal(removed.status, 200);

    const people = await call(app.baseUrl, "/api/organizations/acme-demo/members");
    assert.equal(people.body.members.some((member) => member.username === "bob-reviewer"), false);

    const teamDetail = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
      cookie: ownerCookie,
    });
    assert.deepEqual(teamDetail.body.members, []);

    // The account keeps its session and its personal repository, and loses the
    // private repository access it only held through the organization.
    assert.equal((await call(app.baseUrl, "/api/session", { cookie: memberCookie })).status, 200);
    const personal = await call(app.baseUrl, "/api/repositories/bob-reviewer/bob-notes", {
      cookie: memberCookie,
    });
    assert.equal(personal.status, 200);
    const privateRepository = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research",
      { cookie: memberCookie },
    );
    assert.equal(privateRepository.status, 403);

    await app.restart();
    const afterRestart = await call(app.baseUrl, "/api/organizations/acme-demo/members");
    assert.equal(
      afterRestart.body.members.some((member) => member.username === "bob-reviewer"),
      false,
    );
  });
});

test("the last Owner cannot be removed and a non-Owner cannot remove anyone", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const memberCookie = await signIn(app, MEMBER);

    const lastOwner = await call(app.baseUrl, "/api/organizations/acme-demo/members/alice-dev", {
      method: "DELETE",
      cookie: ownerCookie,
    });
    assert.equal(lastOwner.status, 400);
    assert.equal(lastOwner.body.fieldErrors.username, "Organization must have at least one Owner");

    const notOwner = await call(app.baseUrl, "/api/organizations/acme-demo/members/alice-dev", {
      method: "DELETE",
      cookie: memberCookie,
    });
    assert.equal(notOwner.status, 403);

    const people = await call(app.baseUrl, "/api/organizations/acme-demo/members");
    assert.deepEqual(
      people.body.members.map((member) => member.username),
      ["alice-dev", "bob-reviewer"],
    );
  });
});

test("an organization Owner can be removed while another Owner remains", async () => {
  await withApp(async (app) => {
    await register(app, "dana-owner", "dana.owner@example.test");
    const ownerCookie = await signIn(app, OWNER);
    const promoted = await call(app.baseUrl, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: ownerCookie,
      body: { identifier: "dana-owner", role: "Owner" },
    });
    assert.equal(promoted.status, 201);

    const removed = await call(app.baseUrl, "/api/organizations/acme-demo/members/alice-dev", {
      method: "DELETE",
      cookie: ownerCookie,
    });
    assert.equal(removed.status, 200);
    const people = await call(app.baseUrl, "/api/organizations/acme-demo/members");
    assert.deepEqual(
      people.body.members.map((member) => `${member.username}:${member.role}`),
      ["dana-owner:owner", "bob-reviewer:member"],
    );
  });
});
