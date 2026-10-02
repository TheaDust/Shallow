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

function teamNames(payload) {
  return payload.body.teams.map((team) => team.name);
}

test("an Owner creates teams and their parent stays consistent after a restart", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    const created = await call(app.baseUrl, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "mobile-team", description: "Mobile clients", parent: "platform-team" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.team.name, "mobile-team");
    assert.equal(created.body.team.parent, "platform-team");
    assert.equal(typeof created.body.team.id, "string");
    assert.equal(typeof created.body.team.createdAt, "string");

    // A compliant name needs neither description nor parent team.
    const bare = await call(app.baseUrl, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "docs-team" },
    });
    assert.equal(bare.status, 201);
    assert.equal(bare.body.team.parent, null);
    assert.equal(bare.body.team.description, null);

    await app.restart();
    const list = await call(app.baseUrl, "/api/organizations/acme-demo/teams");
    assert.equal(list.status, 200);
    const mobile = list.body.teams.find((team) => team.name === "mobile-team");
    assert.equal(mobile.parent, "platform-team");
    assert.ok(teamNames(list).includes("docs-team"));
  });
});

test("missing, malformed, duplicated and foreign-parent team names create nothing", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const created = await call(app.baseUrl, "/api/organizations", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "other-org", displayName: "Other Org" },
    });
    assert.equal(created.status, 201);
    const foreign = await call(app.baseUrl, "/api/organizations/other-org/teams", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "foreign-team" },
    });
    assert.equal(foreign.status, 201);
    const foreignParentId = foreign.body.team.id;

    for (const body of [
      { name: "" },
      { name: "-mobile-team" },
      { name: "Mobile Team" },
      { name: "a".repeat(51) },
    ]) {
      const rejected = await call(app.baseUrl, "/api/organizations/acme-demo/teams", {
        method: "POST",
        cookie: ownerCookie,
        body,
      });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.fieldErrors.name, "Team name format is invalid");
    }

    const duplicate = await call(app.baseUrl, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "frontend-team" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Team name already exists");

    const foreignParent = await call(app.baseUrl, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: ownerCookie,
      body: { name: "cross-org-team", parentTeamId: foreignParentId },
    });
    assert.equal(foreignParent.status, 400);
    assert.equal(foreignParent.body.fieldErrors.parent, "Parent team is invalid");

    const list = await call(app.baseUrl, "/api/organizations/acme-demo/teams");
    assert.deepEqual(teamNames(list), [
      "design-team",
      "frontend-child",
      "frontend-team",
      "platform-team",
    ]);
  });
});

test("a non-Owner cannot create teams", async () => {
  await withApp(async (app) => {
    const memberCookie = await signIn(app, MEMBER);
    const rejected = await call(app.baseUrl, "/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: memberCookie,
      body: { name: "mobile-team" },
    });
    assert.equal(rejected.status, 403);
    const anonymous = await call(app.baseUrl, "/api/organizations/acme-demo/teams", {
      method: "POST",
      body: { name: "mobile-team" },
    });
    assert.equal(anonymous.status, 401);
    const list = await call(app.baseUrl, "/api/organizations/acme-demo/teams");
    assert.equal(teamNames(list).includes("mobile-team"), false);
  });
});

test("team membership is direct and only current organization members can join", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    const added = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { method: "POST", cookie: ownerCookie, body: { username: "bob-reviewer" } },
    );
    assert.equal(added.status, 201);

    const detail = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
      cookie: ownerCookie,
    });
    assert.equal(detail.body.team.parent, "platform-team");
    assert.equal(detail.body.canManage, true);
    assert.deepEqual(detail.body.members, [{ username: "bob-reviewer" }]);

    // Hierarchy adds no member: the child team stays empty.
    const child = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-child", {
      cookie: ownerCookie,
    });
    assert.deepEqual(child.body.members, []);

    const duplicate = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { method: "POST", cookie: ownerCookie, body: { username: "bob-reviewer" } },
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.username, "Account is already a team member");

    const unknown = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { method: "POST", cookie: ownerCookie, body: { username: "unknown-reviewer" } },
    );
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fieldErrors.username, "Account not found");

    const removed = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer",
      { method: "DELETE", cookie: ownerCookie },
    );
    assert.equal(removed.status, 200);
    const after = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
      cookie: ownerCookie,
    });
    assert.deepEqual(after.body.members, []);
  });
});

test("a cyclic parent is rejected and the stored parent survives a restart", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    const cycle = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
      method: "PATCH",
      cookie: ownerCookie,
      body: { parent: "frontend-child" },
    });
    assert.equal(cycle.status, 400);
    assert.equal(cycle.body.fieldErrors.parent, "Cyclic team hierarchy is not allowed");

    const selfParent = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
      method: "PATCH",
      cookie: ownerCookie,
      body: { parent: "frontend-team" },
    });
    assert.equal(selfParent.status, 400);
    assert.equal(selfParent.body.fieldErrors.parent, "Cyclic team hierarchy is not allowed");

    await app.restart();
    const detail = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
      cookie: ownerCookie,
    });
    assert.equal(detail.body.team.parent, "platform-team");
  });
});

test("a valid parent change is stored and can be cleared", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const changed = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
      method: "PATCH",
      cookie: ownerCookie,
      body: { parent: "design-team" },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.team.parent, "design-team");

    const cleared = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-child", {
      method: "PATCH",
      cookie: ownerCookie,
      body: { parent: "" },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.team.parent, null);
  });
});

test("a non-Owner cannot maintain team membership or hierarchy", async () => {
  await withApp(async (app) => {
    const memberCookie = await signIn(app, MEMBER);
    const addMember = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/teams/frontend-team/members",
      { method: "POST", cookie: memberCookie, body: { username: "bob-reviewer" } },
    );
    assert.equal(addMember.status, 403);
    const changeParent = await call(
      app.baseUrl,
      "/api/organizations/acme-demo/teams/frontend-team",
      { method: "PATCH", cookie: memberCookie, body: { parent: "design-team" } },
    );
    assert.equal(changeParent.status, 403);

    const detail = await call(app.baseUrl, "/api/organizations/acme-demo/teams/frontend-team", {
      cookie: memberCookie,
    });
    assert.equal(detail.body.canManage, false);
    assert.deepEqual(detail.body.members, []);
    assert.equal(detail.body.team.parent, "platform-team");
  });
});
