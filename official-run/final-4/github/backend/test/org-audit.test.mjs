import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const EVO_PASSWORD = "Evo-Password-987!";

async function startApp(dataDir) {
  const directory = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-audit-")));
  const store = createAuthStore(directory);
  const orgStore = createOrgStore(directory);
  const handler = createRequestHandler({ store, orgStore, staticRoot: join(directory, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir: directory,
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
  return { status: response.status, body: text ? JSON.parse(text) : {}, cookie: collectCookie(response) };
}

async function signIn(baseUrl, identifier, password = EVO_PASSWORD) {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200, `sign-in of ${identifier} failed: ${JSON.stringify(result.body)}`);
  return result.cookie;
}

test("an organization Owner lists the persisted audit events and a Member cannot open them", async () => {
  const app = await startApp();
  try {
    const ownerCookie = await signIn(app.baseUrl, "evo-audit-owner");
    const organizations = await request(app.baseUrl, "GET", "/api/organizations", undefined, ownerCookie);
    assert.deepEqual(organizations.body.organizations, [
      { id: "evo-audit-org", displayName: "evo-audit-org", role: "Owner" },
    ]);

    const overview = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org", undefined, ownerCookie);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");

    const log = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log", undefined, ownerCookie);
    assert.equal(log.status, 200);
    assert.equal(log.body.organization.id, "evo-audit-org");
    const actions = log.body.events.map((event) => event.action);
    assert.ok(actions.includes("Member added"), `missing Member added in ${JSON.stringify(actions)}`);
    assert.ok(actions.includes("Repository created"), `missing Repository created in ${JSON.stringify(actions)}`);
    for (const event of log.body.events) {
      assert.equal(typeof event.actor, "string");
      assert.ok(event.actor.length > 0);
      assert.equal(typeof event.target, "string");
      assert.ok(Number.isFinite(Date.parse(event.timestamp)));
    }
    const memberAdded = log.body.events.find((event) => event.action === "Member added");
    assert.equal(memberAdded.actor, "evo-audit-owner");
    assert.equal(memberAdded.target, "evo-audit-viewer");

    // The ordinary Member still sees the organization, but not its audit log.
    const memberCookie = await signIn(app.baseUrl, "evo-audit-viewer");
    const memberOverview = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org", undefined, memberCookie);
    assert.equal(memberOverview.status, 200);
    assert.equal(memberOverview.body.viewerRole, "Member");
    const denied = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log", undefined, memberCookie);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const visitor = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log");
    assert.equal(visitor.status, 401);
  } finally {
    await app.close();
  }
});

test("later organization actions are appended to the audit log and survive a restart", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-audit-owner");

    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories",
      {
        ownerType: "organization",
        ownerId: "evo-audit-org",
        name: "audit-created-repo",
        description: "Recorded by the audit log.",
        visibility: "private",
      },
      cookie,
    );
    assert.equal(created.status, 201);

    const member = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/people",
      { identifier: "new-member", role: "Member" },
      cookie,
    );
    assert.equal(member.status, 201);

    const team = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/teams",
      { name: "audit-team" },
      cookie,
    );
    assert.equal(team.status, 201);

    const log = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log", undefined, cookie);
    const actions = log.body.events.map((event) => event.action);
    assert.deepEqual(actions, [
      "Organization created",
      "Member added",
      "Repository created",
      "Repository created",
      "Member added",
      "Team created",
    ]);
    const repositoryEvents = log.body.events.filter((event) => event.action === "Repository created");
    assert.equal(repositoryEvents[repositoryEvents.length - 1].target, "audit-created-repo");

    const removed = await request(
      app.baseUrl,
      "DELETE",
      "/api/organizations/evo-audit-org/people/new-member",
      undefined,
      cookie,
    );
    assert.equal(removed.status, 200);
    const afterRemoval = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log", undefined, cookie);
    const removalEvent = afterRemoval.body.events[afterRemoval.body.events.length - 1];
    assert.equal(removalEvent.action, "Member removed");
    assert.equal(removalEvent.target, "new-member");

    // The stored events are the same after a restart against the same directory.
    const restarted = createOrgStore(app.dataDir);
    const persisted = await restarted.listAuditEvents("evo-audit-org");
    assert.equal(persisted.length, afterRemoval.body.events.length);
    assert.equal(persisted[persisted.length - 1].action, "Member removed");

    // The audit-log filter narrows the same stored list without writing.
    const filtered = await restarted.listAuditEvents("evo-audit-org", { action: "Member added" });
    assert.deepEqual(filtered.map((event) => event.action), ["Member added", "Member added"]);
  } finally {
    await app.close();
  }
});

test("another organization's events never reach the audit log", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "org-owner", "Valid-password-123!");
    const log = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/audit-log", undefined, cookie);
    assert.equal(log.status, 200);
    assert.deepEqual(log.body.events, []);

    const unknown = await request(app.baseUrl, "GET", "/api/organizations/no-such-org/audit-log", undefined, cookie);
    assert.equal(unknown.status, 404);
  } finally {
    await app.close();
  }
});

test("an inherited store keeps its records and gains this round's presets exactly once", async () => {
  // An empty directory is seeded in full.
  const fresh = await mkdtemp(join(tmpdir(), "shallowcode-audit-fresh-"));
  const freshStore = createOrgStore(fresh);
  await freshStore.ensureSeeded();
  const seeded = await freshStore.listAllOrganizations();
  assert.ok(seeded.some((organization) => organization.id === "evo-audit-org"));
  assert.ok(seeded.some((organization) => organization.id === "evo-lab-02"));
  assert.equal((await freshStore.listAuditEvents("evo-audit-org")).length, 3);
  const freshCounts = {
    organizations: seeded.length,
    memberships: (await freshStore.listMembers("evo-audit-org")).length,
  };
  await createOrgStore(fresh).ensureSeeded();
  assert.equal((await createOrgStore(fresh).listAllOrganizations()).length, freshCounts.organizations);
  assert.equal((await createOrgStore(fresh).listMembers("evo-audit-org")).length, freshCounts.memberships);

  // A store written by an earlier version keeps the stored records and the
  // user's own changes; the missing presets are appended.
  const legacy = await mkdtemp(join(tmpdir(), "shallowcode-audit-legacy-"));
  await writeFile(
    join(legacy, "organizations.json"),
    JSON.stringify({
      organizations: [
        { id: "acme-demo", displayName: "Acme Renamed" },
        { id: "user-guild", displayName: "User Guild" },
      ],
      memberships: [
        { organizationId: "acme-demo", accountId: "account-org-owner", role: "Owner" },
        { organizationId: "user-guild", accountId: "account-org-owner", role: "Owner" },
      ],
    }),
  );
  const legacyStore = createOrgStore(legacy);
  await legacyStore.ensureSeeded();
  const upgraded = await legacyStore.listAllOrganizations();
  assert.equal(upgraded.find((organization) => organization.id === "acme-demo").displayName, "Acme Renamed");
  assert.ok(upgraded.some((organization) => organization.id === "user-guild"));
  assert.ok(upgraded.some((organization) => organization.id === "evo-audit-org"));
  assert.equal((await legacyStore.getOrganization("evo-lab-02")).displayName, "Evo Lab Two");
  assert.equal((await legacyStore.getMembership("evo-audit-org", "account-evo-audit-viewer")).role, "Member");
  assert.equal((await legacyStore.listAuditEvents("evo-audit-org")).length, 3);

  // A second startup adds nothing, and a member the Owner removed stays removed.
  await createOrgStore(legacy).ensureSeeded();
  const again = createOrgStore(legacy);
  await again.ensureSeeded();
  assert.equal((await again.listAllOrganizations()).length, upgraded.length);
  await again.removeOrganizationMember({ organizationId: "acme-demo", accountId: "account-bob-reviewer" });
  assert.equal(await again.getMembership("acme-demo", "account-bob-reviewer"), null);
  const restarted = createOrgStore(legacy);
  await restarted.ensureSeeded();
  assert.equal(await restarted.getMembership("acme-demo", "account-bob-reviewer"), null);
});
