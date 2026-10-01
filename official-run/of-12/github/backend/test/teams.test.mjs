import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore } from "../src/domain/store.mjs";

let app;
let dataDir;

function startApp(directory) {
  const store = createAppStore(directory);
  const handler = createRequestHandler({ store, staticRoot: join(directory, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        server,
        async request(path, { method = "GET", body, cookie } = {}) {
          const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
              ...(body === undefined ? {} : { "content-type": "application/json" }),
              ...(cookie ? { cookie } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const setCookie = response.headers.get("set-cookie") ?? "";
          const text = await response.text();
          return {
            status: response.status,
            cookie: setCookie.split(";")[0],
            body: text ? JSON.parse(text) : null,
          };
        },
        async signIn(identifier, password) {
          const response = await this.request("/api/sessions", {
            method: "POST",
            body: { identifier, password },
          });
          return response.cookie;
        },
      });
    });
  });
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-teams-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");

async function registeredCookie(username) {
  await app.request("/api/accounts", {
    method: "POST",
    body: {
      username,
      email: `${username}@example.test`,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
  });
  return app.signIn(username, "Valid-password-123!");
}

describe("REQ-2-2-1 create an organization team", () => {
  it("creates a team without a description or parent team", async () => {
    const cookie = await aliceCookie();
    const created = await app.request("/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie,
      body: { name: "mobile-team" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.team.name, "mobile-team");
    assert.equal(created.body.team.parentTeamName, null);
    assert.equal(created.body.team.description, "");

    const detail = await app.request("/api/organizations/acme-demo/teams/mobile-team", { cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.team.name, "mobile-team");
    assert.equal(detail.body.organization.name, "acme-demo");
    assert.equal(detail.body.viewerRole, "Owner");
    assert.deepEqual(detail.body.members, []);
    assert.ok(detail.body.teams.some((team) => team.name === "mobile-team"));

    // The team is part of the organization the overview lists.
    const overview = await app.request("/api/organizations/acme-demo", { cookie });
    assert.ok(overview.body.teams.some((team) => team.name === "mobile-team"));
  });

  it("keeps the created team and its parent relationship after a reload", async () => {
    const cookie = await aliceCookie();
    const created = await app.request("/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie,
      body: { name: "mobile-ui", description: "Mobile UI", parentTeam: "platform-team" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.team.parentTeamName, "platform-team");

    const reopened = await startApp(dataDir);
    try {
      const reloaded = await reopened.request("/api/organizations/acme-demo/teams/mobile-ui");
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.team.parentTeamName, "platform-team");
      assert.equal(reloaded.body.team.description, "Mobile UI");
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("rejects malformed, duplicated and foreign names", async () => {
    const cookie = await aliceCookie();

    for (const name of ["-mobile-team", "mobile-team-", "Mobile-Team", "mobile_team", ""]) {
      const malformed = await app.request("/api/organizations/acme-demo/teams", {
        method: "POST",
        cookie,
        body: { name },
      });
      assert.equal(malformed.status, 400, `expected ${JSON.stringify(name)} to be rejected`);
      assert.equal(malformed.body.fields.name, "Team name format is invalid");
    }

    const long = "a".repeat(51);
    const tooLong = await app.request("/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie,
      body: { name: long },
    });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.fields.name, "Team name format is invalid");

    const duplicate = await app.request("/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie,
      body: { name: "frontend-team" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fields.name, "Team name already exists");

    const foreignParent = await app.request("/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie,
      body: { name: "mobile-web", parentTeam: "not-a-team" },
    });
    assert.equal(foreignParent.status, 400);
    assert.equal(foreignParent.body.fields.parentTeam, "Parent team does not belong to this organization");

    const missing = await app.request("/api/organizations/acme-demo/teams/mobile-web");
    assert.equal(missing.status, 404);
  });

  it("only lets an organization Owner create a team", async () => {
    const anonymous = await app.request("/api/organizations/acme-demo/teams", {
      method: "POST",
      body: { name: "anonymous-team" },
    });
    assert.equal(anonymous.status, 401);

    const member = await app.request("/api/organizations/acme-demo/teams", {
      method: "POST",
      cookie: await bobCookie(),
      body: { name: "bob-team" },
    });
    assert.equal(member.status, 403);
    assert.equal((await app.request("/api/organizations/acme-demo/teams/bob-team")).status, 404);
  });
});

describe("REQ-2-2-2 team members and hierarchy", () => {
  it("adds and removes an organization member on a team", async () => {
    const cookie = await aliceCookie();
    const added = await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(added.status, 201);
    assert.deepEqual(added.body.members, ["bob-reviewer"]);

    const detail = await app.request("/api/organizations/acme-demo/teams/frontend-team", { cookie });
    assert.deepEqual(detail.body.members, ["bob-reviewer"]);

    const removed = await app.request(
      "/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer",
      { method: "DELETE", cookie },
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.members, []);

    const reloaded = await app.request("/api/organizations/acme-demo/teams/frontend-team", { cookie });
    assert.deepEqual(reloaded.body.members, []);
    // The organization membership is untouched by the team removal.
    assert.ok(reloaded.body.viewerRole === "Owner");
    const overview = await app.request("/api/organizations/acme-demo", { cookie });
    assert.ok(overview.body.members.some((member) => member.username === "bob-reviewer"));
  });

  it("refuses a non-organization member and a duplicated team membership", async () => {
    const cookie = await aliceCookie();
    await registeredCookie("dana-outsider");

    const outsider = await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie,
      body: { username: "dana-outsider" },
    });
    assert.equal(outsider.status, 400);
    assert.equal(outsider.body.fields.username, "Account is not a member of this organization");

    const unknown = await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie,
      body: { username: "unknown-reviewer" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fields.username, "Account not found");

    await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer" },
    });
    const duplicate = await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie,
      body: { username: "bob.reviewer@example.test" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fields.username, "Account is already a member of this team");

    const detail = await app.request("/api/organizations/acme-demo/teams/frontend-team", { cookie });
    assert.deepEqual(detail.body.members, ["bob-reviewer"]);
  });

  it("keeps the parent team when a cyclic change is rejected", async () => {
    const cookie = await aliceCookie();
    const before = await app.request("/api/organizations/acme-demo/teams/frontend-team", { cookie });
    assert.equal(before.body.team.parentTeamName, "platform-team");

    for (const parentTeam of ["frontend-child", "frontend-team"]) {
      const cyclic = await app.request("/api/organizations/acme-demo/teams/frontend-team", {
        method: "PATCH",
        cookie,
        body: { parentTeam },
      });
      assert.equal(cyclic.status, 400, `expected ${parentTeam} to be rejected`);
      assert.equal(cyclic.body.fields.parentTeam, "Cyclic team hierarchy is not allowed");
    }

    const after = await app.request("/api/organizations/acme-demo/teams/frontend-team", { cookie });
    assert.equal(after.body.team.parentTeamName, "platform-team");
  });

  it("saves a valid parent team and reflects it in the organization tree", async () => {
    const cookie = await aliceCookie();
    const moved = await app.request("/api/organizations/acme-demo/teams/frontend-team", {
      method: "PATCH",
      cookie,
      body: { parentTeam: "mobile-team" },
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.team.parentTeamName, "mobile-team");
    assert.deepEqual(
      moved.body.teams.find((team) => team.name === "frontend-team").parentTeamName,
      "mobile-team",
    );

    // Putting it back keeps the seeded hierarchy intact for later scenarios.
    const restored = await app.request("/api/organizations/acme-demo/teams/frontend-team", {
      method: "PATCH",
      cookie,
      body: { parentTeam: "platform-team" },
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.team.parentTeamName, "platform-team");

    const foreign = await app.request("/api/organizations/acme-demo/teams/frontend-team", {
      method: "PATCH",
      cookie,
      body: { parentTeam: "no-such-team" },
    });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.fields.parentTeam, "Parent team does not belong to this organization");
  });

  it("only lets an organization Owner maintain members and hierarchy", async () => {
    const bob = await bobCookie();
    const addMember = await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie: bob,
      body: { username: "bob-reviewer" },
    });
    assert.equal(addMember.status, 403);

    const changeParent = await app.request("/api/organizations/acme-demo/teams/frontend-team", {
      method: "PATCH",
      cookie: bob,
      body: { parentTeam: "platform-team" },
    });
    assert.equal(changeParent.status, 403);
  });

  it("never grants repository access through team membership", async () => {
    const owner = await aliceCookie();
    await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie: owner,
      body: { username: "bob-reviewer" },
    });
    const bob = await bobCookie();
    const denied = await app.request("/api/repositories/acme-demo/acme-internal", { cookie: bob });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "Access denied");

    // Hierarchy never adds members either: `frontend-child` stays empty.
    const detail = await app.request("/api/organizations/acme-demo/teams/frontend-child", { cookie: owner });
    assert.deepEqual(detail.body.members, []);
  });
});

describe("REQ-2-2-3 directly add an organization member", () => {
  it("adds a registered non-member and shows the organization to that account", async () => {
    const cookie = await aliceCookie();
    const dana = await registeredCookie("dana-dev");

    const added = await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie,
      body: { username: "dana-dev", role: "Member" },
    });
    assert.equal(added.status, 201);
    assert.deepEqual(added.body.member, { username: "dana-dev", role: "Member" });
    assert.ok(added.body.members.some((member) => member.username === "dana-dev"));

    const session = await app.request("/api/session", { cookie: dana });
    assert.deepEqual(session.body.user.organizations, [
      { name: "acme-demo", displayName: "Acme Demo", role: "Member" },
    ]);

    // Organization membership alone never grants private-repository access.
    const denied = await app.request("/api/repositories/acme-demo/acme-internal", { cookie: dana });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "Access denied");
  });

  it("reports an existing member, an unknown account and an unsupported role", async () => {
    const cookie = await aliceCookie();
    const duplicate = await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer", role: "Member" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fields.username, "Account is already a member");

    const unknown = await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie,
      body: { username: "unknown-reviewer", role: "Member" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fields.username, "Account not found");

    const unsupported = await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie,
      body: { username: "dana-dev", role: "Maintainer" },
    });
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.body.fields.role, "Role is not supported");

    const overview = await app.request("/api/organizations/acme-demo", { cookie });
    const names = overview.body.members.map((member) => member.username);
    assert.equal(names.filter((name) => name === "bob-reviewer").length, 1);
  });

  it("refuses a non-Owner and an anonymous caller", async () => {
    const member = await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: await bobCookie(),
      body: { username: "dana-dev", role: "Member" },
    });
    assert.equal(member.status, 403);

    const anonymous = await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      body: { username: "dana-dev", role: "Member" },
    });
    assert.equal(anonymous.status, 401);
  });

  it("grants an Owner role with Admin repository access", async () => {
    const cookie = await aliceCookie();
    const dana = await app.signIn("dana-dev", "Valid-password-123!");
    assert.equal((await app.request("/api/repositories/acme-demo/acme-internal", { cookie: dana })).status, 403);

    // Re-adding an existing member is refused, so the role is changed by
    // removing the relationship first and storing it again.
    await app.request("/api/organizations/acme-demo/members/dana-dev", { method: "DELETE", cookie });
    const promoted = await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie,
      body: { username: "dana-dev", role: "Owner" },
    });
    assert.equal(promoted.status, 201);
    assert.deepEqual(promoted.body.member, { username: "dana-dev", role: "Owner" });

    // Owner status means Admin over the repositories of the organization.
    assert.equal((await app.request("/api/repositories/acme-demo/acme-internal", { cookie: dana })).status, 200);

    // Put the account back to the ordinary Member role for the later checks.
    await app.request("/api/organizations/acme-demo/members/dana-dev", { method: "DELETE", cookie });
    const readded = await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie,
      body: { username: "dana-dev@example.test", role: "Member" },
    });
    assert.equal(readded.status, 201);
    assert.equal(readded.body.member.role, "Member");
    const names = readded.body.members.map((member) => member.username);
    assert.equal(names.filter((name) => name === "dana-dev").length, 1);
    assert.equal((await app.request("/api/repositories/acme-demo/acme-internal", { cookie: dana })).status, 403);
  });
});

describe("REQ-2-2-4 remove an organization member", () => {
  it("removes the membership, the team memberships and the direct repository grants", async () => {
    const cookie = await aliceCookie();
    const dataPath = join(dataDir, "data.json");
    const { readFile, writeFile } = await import("node:fs/promises");
    const before = JSON.parse(await readFile(dataPath, "utf8"));

    // Give bob-reviewer a team membership plus a direct account grant and a
    // team grant on the private repository of the organization.
    await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer" },
    });
    const granted = JSON.parse(await readFile(dataPath, "utf8"));
    granted.repositories = granted.repositories.map((repository) => repository.name === "acme-internal"
      ? {
          ...repository,
          grants: [
            {
              id: "grant-bob-internal",
              subjectType: "account",
              subjectId: "account-bob-reviewer",
              role: "Read",
              grantedBy: "account-alice-dev",
              createdAt: "2024-01-01T00:00:00.000Z",
            },
            {
              id: "grant-frontend-internal",
              subjectType: "team",
              subjectId: "team-frontend-team",
              role: "Write",
              grantedBy: "account-alice-dev",
              createdAt: "2024-01-01T00:00:00.000Z",
            },
          ],
        }
      : repository);
    await writeFile(dataPath, `${JSON.stringify(granted, null, 2)}\n`, "utf8");

    const bob = await bobCookie();
    assert.equal((await app.request("/api/repositories/acme-demo/acme-internal", { cookie: bob })).status, 200);

    const removed = await app.request("/api/organizations/acme-demo/members/bob-reviewer", {
      method: "DELETE",
      cookie,
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.members.some((member) => member.username === "bob-reviewer"), false);

    const after = JSON.parse(await readFile(dataPath, "utf8"));
    // The account itself and its relationships outside this organization stay.
    assert.ok(after.accounts.some((account) => account.username === "bob-reviewer"));
    assert.equal(
      after.memberships.some((membership) => membership.accountId === "account-bob-reviewer"),
      false,
    );
    assert.equal(
      after.teamMembers.some((member) => member.accountId === "account-bob-reviewer"),
      false,
    );
    const internal = after.repositories.find((repository) => repository.name === "acme-internal");
    assert.deepEqual(
      internal.grants.map((grant) => `${grant.subjectType}:${grant.subjectId}`),
      ["team:team-frontend-team"],
    );
    // Teams themselves are never deleted.
    assert.ok(after.teams.some((team) => team.name === "frontend-team"));
    assert.equal(before.organizations.length, after.organizations.length);

    // The removed account loses its access and its organization visibility.
    const session = await app.request("/api/session", { cookie: bob });
    assert.deepEqual(session.body.user.organizations, []);
    assert.equal((await app.request("/api/repositories/acme-demo/acme-internal", { cookie: bob })).status, 403);

    const overview = await app.request("/api/organizations/acme-demo", { cookie });
    assert.equal(overview.body.members.some((member) => member.username === "bob-reviewer"), false);
  });

  it("refuses to remove the last Owner", async () => {
    const cookie = await aliceCookie();
    const removed = await app.request("/api/organizations/acme-demo/members/alice-dev", {
      method: "DELETE",
      cookie,
    });
    assert.equal(removed.status, 400);
    assert.equal(removed.body.fields.username, "The last Owner cannot be removed");

    const overview = await app.request("/api/organizations/acme-demo", { cookie });
    assert.ok(overview.body.members.some((member) => member.username === "alice-dev" && member.role === "Owner"));
  });

  it("refuses a non-Owner and an unknown member", async () => {
    const nonOwner = await app.request("/api/organizations/acme-demo/members/dana-dev", {
      method: "DELETE",
      cookie: await registeredCookie("dana-member"),
    });
    assert.equal(nonOwner.status, 403);

    const cookie = await aliceCookie();
    const unknown = await app.request("/api/organizations/acme-demo/members/unknown-reviewer", {
      method: "DELETE",
      cookie,
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fields.username, "Account is not a member of this organization");
  });
});
