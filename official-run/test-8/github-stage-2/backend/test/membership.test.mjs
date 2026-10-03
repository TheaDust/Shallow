import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-members-")));
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

async function signIn(base, identifier, password = "Valid-password-123!") {
  return call(base, "/api/session", { method: "POST", body: { identifier, password } });
}

function peopleMap(people) {
  return Object.fromEntries(people.map((person) => [person.username, person.role]));
}

test("directly adds a registered non-member and persists the membership", async () => {
  const first = await startApp();
  const dataDir = first.dataDir;
  try {
    const owner = await signIn(first.base, "org-owner");
    assert.equal(owner.status, 200);

    const before = await call(first.base, "/api/organizations/acme-demo/people", { cookie: owner.sessionCookie });
    assert.equal(before.status, 200);
    assert.ok(!before.body.people.some((person) => person.username === "new-member"));

    const added = await call(first.base, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { username: "new-member", role: "member" },
    });
    assert.equal(added.status, 200);
    assert.equal(peopleMap(added.body.people)["new-member"], "Member");

    // The membership is stored without any pending/invitation state.
    const after = await call(first.base, "/api/organizations/acme-demo/people", { cookie: owner.sessionCookie });
    assert.equal(peopleMap(after.body.people)["new-member"], "Member");
    for (const person of after.body.people) {
      assert.deepEqual(Object.keys(person).sort(), ["email", "role", "username"]);
    }

    // Membership makes the organization visible, but not the ungranted private repository.
    const member = await signIn(first.base, "new-member");
    assert.equal(member.status, 200);
    const organizations = await call(first.base, "/api/organizations", { cookie: member.sessionCookie });
    assert.deepEqual(organizations.body.organizations.map((organization) => organization.slug), ["acme-demo"]);
    const privateRepository = await call(first.base, "/api/repositories/acme-demo/secret-research", {
      cookie: member.sessionCookie,
    });
    assert.equal(privateRepository.status, 403);
    assert.equal(privateRepository.body.error, "Access denied");
  } finally {
    await first.close();
  }

  const second = await startApp(dataDir);
  try {
    const owner = await signIn(second.base, "org-owner");
    const people = await call(second.base, "/api/organizations/acme-demo/people", { cookie: owner.sessionCookie });
    assert.equal(peopleMap(people.body.people)["new-member"], "Member");
  } finally {
    await second.close();
  }
});

test("reports an existing member and an unknown account without duplicating the relationship", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.base, "org-owner");

    const duplicate = await call(app.base, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { username: "existing-member", role: "member" },
    });
    assert.equal(duplicate.status, 400);
    assert.deepEqual(Object.keys(duplicate.body.fields), ["username"]);
    assert.equal(duplicate.body.fields.username, "Account is already a member");

    const unknown = await call(app.base, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { username: "unknown-reviewer", role: "member" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fields.username, "Account not found");

    const people = await call(app.base, "/api/organizations/acme-demo/people", { cookie: owner.sessionCookie });
    const occurrences = people.body.people.filter((person) => person.username === "existing-member");
    assert.equal(occurrences.length, 1);
    assert.ok(!people.body.people.some((person) => person.username === "unknown-reviewer"));
  } finally {
    await app.close();
  }
});

test("removing a member drops their membership, team memberships and direct grants", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.base, "org-owner");
    const admin = await signIn(app.base, "repo-admin");
    const member = await signIn(app.base, "existing-member");

    await call(app.base, "/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { username: "existing-member" },
    });
    // secret-research has no grant for repo-admin: an organization Owner is its
    // repository Admin, which is the boundary that must be respected here.
    const granted = await call(app.base, "/api/repositories/acme-demo/secret-research/access", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { subjectType: "account", name: "existing-member", role: "read" },
    });
    assert.equal(granted.status, 200);
    assert.equal(
      (await call(app.base, "/api/repositories/acme-demo/secret-research/access", {
        method: "POST",
        cookie: admin.sessionCookie,
        body: { subjectType: "account", name: "existing-member", role: "read" },
      })).status,
      403,
    );

    const beforeRemoval = await call(app.base, "/api/repositories/acme-demo/secret-research", {
      cookie: member.sessionCookie,
    });
    assert.equal(beforeRemoval.status, 200);

    const removed = await call(app.base, "/api/organizations/acme-demo/members/existing-member", {
      method: "DELETE",
      cookie: owner.sessionCookie,
    });
    assert.equal(removed.status, 200);
    assert.ok(!removed.body.people.some((person) => person.username === "existing-member"));

    const team = await call(app.base, "/api/organizations/acme-demo/teams/frontend-team", { cookie: owner.sessionCookie });
    assert.deepEqual(team.body.members, []);

    const access = await call(app.base, "/api/repositories/acme-demo/secret-research/access", { cookie: owner.sessionCookie });
    assert.ok(!access.body.access.some((entry) => entry.subjectName === "existing-member"));

    // Team grants belong to the team, so they survive the member removal.
    const docsAccess = await call(app.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    const teamGrant = docsAccess.body.access.filter((entry) => entry.subjectName === "access-role-team");
    assert.equal(teamGrant.length, 1);
    assert.equal(teamGrant[0].role, "write");

    // The account itself, and its access, are gone from this organization.
    assert.equal(
      (await call(app.base, "/api/repositories/acme-demo/secret-research", { cookie: member.sessionCookie })).status,
      403,
    );
    const organizations = await call(app.base, "/api/organizations", { cookie: member.sessionCookie });
    assert.deepEqual(organizations.body.organizations, []);
    assert.equal((await signIn(app.base, "existing-member")).status, 200);
  } finally {
    await app.close();
  }
});

test("refuses to remove the last Owner and keeps every relationship", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.base, "org-owner");

    const removed = await call(app.base, "/api/organizations/acme-demo/members/team-maintainer", {
      method: "DELETE",
      cookie: owner.sessionCookie,
    });
    assert.equal(removed.status, 200);

    const last = await call(app.base, "/api/organizations/acme-demo/members/org-owner", {
      method: "DELETE",
      cookie: owner.sessionCookie,
    });
    assert.equal(last.status, 400);
    assert.equal(last.body.fields.username, "Organization must have at least one Owner");

    const people = await call(app.base, "/api/organizations/acme-demo/people", { cookie: owner.sessionCookie });
    assert.equal(peopleMap(people.body.people)["org-owner"], "Owner");
    const organizations = await call(app.base, "/api/organizations", { cookie: owner.sessionCookie });
    assert.deepEqual(organizations.body.organizations.map((organization) => organization.slug), ["acme-demo"]);
  } finally {
    await app.close();
  }
});

test("stores the chosen organization role and rejects an unknown one", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.base, "org-owner");

    const invalid = await call(app.base, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { username: "new-member", role: "admin" },
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(Object.keys(invalid.body.fields), ["role"]);
    assert.equal(invalid.body.fields.role, "Role is invalid");

    const added = await call(app.base, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { username: "new-member", role: "owner" },
    });
    assert.equal(added.status, 200);
    assert.equal(peopleMap(added.body.people)["new-member"], "Owner");

    const people = await call(app.base, "/api/organizations/acme-demo/people", { cookie: owner.sessionCookie });
    assert.equal(peopleMap(people.body.people)["new-member"], "Owner");
  } finally {
    await app.close();
  }
});

test("only an organization Owner may add or remove members", async () => {
  const app = await startApp();
  try {
    const member = await signIn(app.base, "org-member");

    const add = await call(app.base, "/api/organizations/acme-demo/members", {
      method: "POST",
      cookie: member.sessionCookie,
      body: { username: "new-member", role: "member" },
    });
    assert.equal(add.status, 403);

    const remove = await call(app.base, "/api/organizations/acme-demo/members/protected-member", {
      method: "DELETE",
      cookie: member.sessionCookie,
    });
    assert.equal(remove.status, 403);

    const people = await call(app.base, "/api/organizations/acme-demo/people", { cookie: member.sessionCookie });
    assert.equal(people.status, 200);
    assert.equal(peopleMap(people.body.people)["protected-member"], "Member");
    assert.ok(!people.body.people.some((person) => person.username === "new-member"));

    const anonymous = await call(app.base, "/api/organizations/acme-demo/members", {
      method: "POST",
      body: { username: "new-member", role: "member" },
    });
    assert.equal(anonymous.status, 401);
  } finally {
    await app.close();
  }
});
