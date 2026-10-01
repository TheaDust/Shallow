import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore } from "../src/domain/store.mjs";
import { effectiveRepositoryRole } from "../src/domain/repository-access.mjs";

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

async function readDocument() {
  return JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-access-"));
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

async function grant(cookie, owner, repository, body) {
  return app.request(`/api/repositories/${owner}/${repository}/access`, {
    method: "PUT",
    cookie,
    body,
  });
}

describe("REQ-2-3 grant repository access", () => {
  it("opens the Manage-access page of an organization repository for an Owner", async () => {
    const cookie = await aliceCookie();
    const access = await app.request("/api/repositories/acme-demo/acme-web/access", { cookie });
    assert.equal(access.status, 200);
    assert.equal(access.body.repository.fullName, "Acme Demo/acme-web");
    assert.equal(access.body.canManage, true);
    assert.equal(access.body.viewerRole, "Admin");
    assert.deepEqual(access.body.roles, ["Read", "Triage", "Write", "Maintain", "Admin"]);
    assert.deepEqual(access.body.grants, []);

    const names = access.body.candidates.map((candidate) => `${candidate.subjectType}:${candidate.name}`);
    assert.ok(names.includes("account:bob-reviewer"));
    assert.ok(names.includes("team:frontend-team"));
  });

  it("stores exactly one grant per subject and replaces the role on save", async () => {
    const cookie = await aliceCookie();
    const added = await grant(cookie, "acme-demo", "acme-web", {
      subjectType: "team",
      subject: "frontend-team",
      role: "Write",
    });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.grants, [
      {
        subjectType: "team",
        name: "frontend-team",
        role: "Write",
        grantor: "account-alice-dev",
        createdAt: added.body.grants[0].createdAt,
        updatedAt: added.body.grants[0].createdAt,
      },
    ]);
    assert.ok(added.body.grants[0].createdAt);

    // Saving the same role again must not create a second record.
    const repeated = await grant(cookie, "acme-demo", "acme-web", {
      subjectType: "team",
      subject: "frontend-team",
      role: "Write",
    });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.grants.length, 1);

    // Changing the role replaces the stored one.
    const replaced = await grant(cookie, "acme-demo", "acme-web", {
      subjectType: "team",
      subject: "frontend-team",
      role: "Read",
    });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.body.grants.length, 1);
    assert.equal(replaced.body.grants[0].name, "frontend-team");
    assert.equal(replaced.body.grants[0].role, "Read");

    const document = await readDocument();
    const repository = document.repositories.find((candidate) => candidate.name === "acme-web");
    assert.equal(repository.grants.length, 1);
    assert.equal(repository.grants[0].role, "Read");
    assert.equal(repository.grants[0].grantedBy, "account-alice-dev");
    assert.ok(repository.grants[0].createdAt);

    // The page keeps the single updated row after a reload.
    const reopened = await startApp(dataDir);
    try {
      const reloaded = await reopened.request("/api/repositories/acme-demo/acme-web/access", { cookie });
      assert.equal(reloaded.status, 200);
      assert.deepEqual(reloaded.body.grants.map((row) => `${row.name}:${row.role}`), ["frontend-team:Read"]);
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("grants a direct role to an organization member", async () => {
    const cookie = await aliceCookie();
    const added = await grant(cookie, "acme-demo", "acme-internal", {
      subjectType: "account",
      subject: "bob-reviewer",
      role: "Write",
    });
    assert.equal(added.status, 200);
    assert.ok(added.body.grants.some((row) => row.subjectType === "account" && row.name === "bob-reviewer" && row.role === "Write"));

    // The granted member reaches the private repository.
    const bob = await bobCookie();
    assert.equal((await app.request("/api/repositories/acme-demo/acme-internal", { cookie: bob })).status, 200);
  });

  it("shows the seeded team grant and keeps only one record after changing it", async () => {
    const cookie = await aliceCookie();
    const before = await app.request("/api/repositories/acme-demo/acme-internal/access", { cookie });
    const seeded = before.body.grants.find((row) => row.name === "platform-team");
    assert.equal(seeded.role, "Write");

    const changed = await grant(cookie, "acme-demo", "acme-internal", {
      subjectType: "team",
      subject: "platform-team",
      role: "Maintain",
    });
    assert.equal(changed.status, 200);
    const platformRows = changed.body.grants.filter((row) => row.name === "platform-team");
    assert.equal(platformRows.length, 1);
    assert.equal(platformRows[0].role, "Maintain");

    const document = await readDocument();
    const repository = document.repositories.find((candidate) => candidate.name === "acme-internal");
    assert.equal(
      repository.grants.filter((row) => row.subjectId === "team-platform-team").length,
      1,
    );
  });

  it("grants team access that reaches the direct team members only", async () => {
    const cookie = await aliceCookie();
    const dana = await registeredCookie("dana-dev");
    await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie,
      body: { username: "dana-dev", role: "Member" },
    });
    await app.request("/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie,
      body: { username: "dana-dev" },
    });

    const granted = await grant(cookie, "acme-demo", "acme-internal", {
      subjectType: "team",
      subject: "frontend-team",
      role: "Write",
    });
    assert.equal(granted.status, 200);

    // A direct member of the granted team reads the private repository.
    assert.equal((await app.request("/api/repositories/acme-demo/acme-internal", { cookie: dana })).status, 200);

    // An organization member without a grant or team stays excluded.
    const outsider = await registeredCookie("erin-dev");
    await app.request("/api/organizations/acme-demo/members", {
      method: "POST",
      cookie,
      body: { username: "erin-dev", role: "Member" },
    });
    const denied = await app.request("/api/repositories/acme-demo/acme-internal", { cookie: outsider });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "Access denied");

    // Team hierarchy never propagates: a grant on a descendant team does not
    // reach the members of its parent.
    await grant(cookie, "acme-demo", "acme-internal", {
      subjectType: "team",
      subject: "frontend-child",
      role: "Read",
    });
    const data = await readDocument();
    const repository = data.repositories.find((candidate) => candidate.name === "acme-internal");
    const danaAccount = data.accounts.find((account) => account.username === "dana-dev");
    assert.equal(effectiveRepositoryRole(data, repository, danaAccount.id), "Write");
    const childOnly = {
      ...repository,
      grants: repository.grants.filter((row) => row.subjectId === "team-frontend-child"),
    };
    assert.equal(effectiveRepositoryRole(data, childOnly, danaAccount.id), null);
  });

  it("rejects a role or a subject outside the organization", async () => {
    const cookie = await aliceCookie();
    const badRole = await grant(cookie, "acme-demo", "acme-web", {
      subjectType: "team",
      subject: "frontend-team",
      role: "Owner",
    });
    assert.equal(badRole.status, 400);
    assert.equal(badRole.body.fields.role, "Role is not supported");

    const outsider = await grant(cookie, "acme-demo", "acme-web", {
      subjectType: "account",
      subject: "unknown-reviewer",
      role: "Write",
    });
    assert.equal(outsider.status, 400);
    assert.equal(outsider.body.fields.subject, "Account is not a member of this organization");

    // Neither rejected request changed the stored grants.
    const document = await readDocument();
    const docs = document.repositories.find((candidate) => candidate.name === "acme-web");
    assert.deepEqual(docs.grants.map((row) => `${row.subjectType}:${row.subjectId}:${row.role}`), [
      "team:team-frontend-team:Read",
    ]);
  });

  it("refuses a grant to a team of another organization", async () => {
    const cookie = await aliceCookie();
    await app.request("/api/organizations", {
      method: "POST",
      cookie,
      body: { name: "other-org", displayName: "Other Org" },
    });
    const created = await app.request("/api/organizations/other-org/teams", {
      method: "POST",
      cookie,
      body: { name: "other-team" },
    });
    assert.equal(created.status, 201);

    const foreign = await grant(cookie, "acme-demo", "acme-web", {
      subjectType: "team",
      subject: "other-team",
      role: "Write",
    });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.fields.subject, "Team does not belong to this organization");

    const document = await readDocument();
    const docs = document.repositories.find((candidate) => candidate.name === "acme-web");
    assert.equal(docs.grants.some((row) => row.subjectId === created.body.team.id), false);
  });

  it("refuses a member, an anonymous caller and an unknown repository", async () => {
    const bob = await bobCookie();
    const member = await app.request("/api/repositories/acme-demo/acme-web/access", { cookie: bob });
    assert.equal(member.status, 403);
    assert.equal(member.body.error, "Only an organization Owner or repository Admin can manage access");

    const memberWrite = await grant(bob, "acme-demo", "acme-web", {
      subjectType: "team",
      subject: "frontend-team",
      role: "Admin",
    });
    assert.equal(memberWrite.status, 403);

    const anonymous = await app.request("/api/repositories/acme-demo/acme-web/access");
    assert.equal(anonymous.status, 401);

    const missing = await app.request("/api/repositories/acme-demo/unknown-repository/access", { cookie: bob });
    assert.equal(missing.status, 404);
  });
});
