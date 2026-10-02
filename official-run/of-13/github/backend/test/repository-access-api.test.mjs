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

function accessPath(owner, name) {
  return `/api/repositories/${owner}/${name}/access`;
}

test("the Manage access list requires a repository Admin and starts from the seeded team grant", async () => {
  await withApp(async (app) => {
    const viewer = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"));
    assert.equal(viewer.status, 403);
    assert.equal(viewer.body.error, "Access denied");

    const memberCookie = await signIn(app, MEMBER);
    const member = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"), {
      cookie: memberCookie,
    });
    assert.equal(member.status, 403);

    const ownerCookie = await signIn(app, OWNER);
    const owner = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"), {
      cookie: ownerCookie,
    });
    assert.equal(owner.status, 200);
    assert.equal(owner.body.canManage, true);
    assert.equal(owner.body.repository.ownerType, "organization");
    assert.equal(owner.body.organization.name, "acme-demo");
    assert.deepEqual(
      owner.body.grants.map((grant) => `${grant.subjectType}:${grant.subjectName}:${grant.role}`),
      [
        "account:bob-reviewer:write",
        "account:carol-maintainer:maintain",
        "team:platform-team:write",
      ],
    );

    // The private organization repository starts without any grant.
    const privateAccess = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      cookie: ownerCookie,
    });
    assert.equal(privateAccess.status, 200);
    assert.deepEqual(privateAccess.body.grants, []);

    const missing = await call(app.baseUrl, accessPath("acme-demo", "not-there"), {
      cookie: ownerCookie,
    });
    assert.equal(missing.status, 404);
  });
});

test("a team grant is stored once, survives a restart and can be replaced", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    const created = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "team", subjectName: "frontend-team", role: "Write" },
    });
    assert.equal(created.status, 200);
    assert.deepEqual(
      created.body.grants.map((grant) => `${grant.subjectName}:${grant.role}`),
      ["frontend-team:write"],
    );

    // Saving the same role again replaces the record instead of duplicating it.
    const repeated = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "team", subjectName: "frontend-team", role: "write" },
    });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.grants.length, 1);

    const changed = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "team", subjectName: "frontend-team", role: "read" },
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(
      changed.body.grants.map((grant) => `${grant.subjectName}:${grant.role}`),
      ["frontend-team:read"],
    );

    // The grant is persisted on the server, so it is still there after a reload.
    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, accessPath("acme-demo", "secret-research"), {
      cookie: ownerCookie,
    });
    assert.equal(reloaded.status, 200);
    assert.deepEqual(
      reloaded.body.grants.map((grant) => `${grant.subjectName}:${grant.role}`),
      ["frontend-team:read"],
    );
  });
});

test("a direct account grant grants private-repository access to exactly that account", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const memberCookie = await signIn(app, MEMBER);

    const before = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: memberCookie,
    });
    assert.equal(before.status, 403);

    const granted = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "read" },
    });
    assert.equal(granted.status, 200);
    assert.deepEqual(
      granted.body.grants.map((grant) => `${grant.subjectType}:${grant.subjectName}:${grant.role}`),
      ["account:bob-reviewer:read"],
    );

    const reader = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: memberCookie,
    });
    assert.equal(reader.status, 200);
    assert.equal(reader.body.repository.name, "secret-research");
    assert.equal(reader.body.viewerRole, "read");

    // A visitor still cannot see the private repository.
    const visitor = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research");
    assert.equal(visitor.status, 403);

    // The same role saved again does not create a second record.
    await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "read" },
    });
    const listed = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      cookie: ownerCookie,
    });
    assert.equal(listed.body.grants.length, 1);
  });
});

test("team grants act through direct team membership only", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const memberCookie = await signIn(app, MEMBER);

    // The team grant alone gives bob-reviewer nothing: he is not a team member.
    await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "team", subjectName: "frontend-team", role: "write" },
    });
    const outside = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: memberCookie,
    });
    assert.equal(outside.status, 403);

    // A descendant team never propagates the grant of its parent.
    const descendant = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "team", subjectName: "frontend-child", role: "write" },
    });
    assert.equal(descendant.status, 200);
    const stillDenied = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: memberCookie,
    });
    assert.equal(stillDenied.status, 403);

    // Adding the account to the granted team makes the team grant effective.
    const added = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie: ownerCookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(added.status, 201);
    const inside = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: memberCookie,
    });
    assert.equal(inside.status, 200);
    assert.equal(inside.body.viewerRole, "write");
  });
});

test("only current organization members and teams can be granted a role", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    await call(app.baseUrl, "/api/register", {
      method: "POST",
      body: {
        username: "carol-outsider",
        email: "carol.outsider@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });

    const outsider = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "account", subjectName: "carol-outsider", role: "write" },
    });
    assert.equal(outsider.status, 400);
    assert.equal(
      outsider.body.fieldErrors.subject,
      "Subject is not an organization member or team",
    );

    const foreignTeam = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "team", subjectName: "not-a-team", role: "write" },
    });
    assert.equal(foreignTeam.status, 400);
    assert.equal(
      foreignTeam.body.fieldErrors.subject,
      "Subject is not an organization member or team",
    );

    const badRole = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "team", subjectName: "design-team", role: "owner" },
    });
    assert.equal(badRole.status, 400);
    assert.equal(badRole.body.fieldErrors.role, "Role is not supported");

    // Nothing was written by the rejected requests.
    const listed = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"), {
      cookie: ownerCookie,
    });
    assert.deepEqual(
      listed.body.grants.map((grant) => grant.subjectName).sort(),
      ["bob-reviewer", "carol-maintainer", "platform-team"],
    );
  });
});

test("an account with a direct Admin grant manages access without being an organization Owner", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const memberCookie = await signIn(app, MEMBER);

    const promoted = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "admin" },
    });
    assert.equal(promoted.status, 200);

    const admin = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      cookie: memberCookie,
    });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.canManage, true);

    const teamGrant = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      method: "PUT",
      cookie: memberCookie,
      body: { subjectType: "team", subjectName: "design-team", role: "maintain" },
    });
    assert.equal(teamGrant.status, 200);
    assert.deepEqual(
      teamGrant.body.grants.map((grant) => `${grant.subjectName}:${grant.role}`),
      ["bob-reviewer:admin", "design-team:maintain"],
    );

    // The grantor and the timestamp are stored with each authorization.
    const listed = await call(app.baseUrl, accessPath("acme-demo", "secret-research"), {
      cookie: ownerCookie,
    });
    const teamRecord = listed.body.grants.find((grant) => grant.subjectName === "design-team");
    assert.equal(teamRecord.subjectType, "team");
    assert.equal(teamRecord.createdAt.length > 0, true);
    assert.equal(teamRecord.grantedBy, "account-bob-reviewer");
  });
});

test("a plain organization member cannot change repository access", async () => {
  await withApp(async (app) => {
    const memberCookie = await signIn(app, MEMBER);
    const attempt = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"), {
      method: "PUT",
      cookie: memberCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "admin" },
    });
    assert.equal(attempt.status, 403);
    assert.equal(attempt.body.error, "Access denied");

    const ownerCookie = await signIn(app, OWNER);
    const listed = await call(app.baseUrl, accessPath("acme-demo", "acme-docs"), {
      cookie: ownerCookie,
    });
    assert.deepEqual(
      listed.body.grants.map((grant) => grant.subjectName),
      ["bob-reviewer", "carol-maintainer", "platform-team"],
    );
  });
});
