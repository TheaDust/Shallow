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

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-audit-"));
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
  return { status: response.status, body: text ? JSON.parse(text) : {}, cookie: collectCookie(response) };
}

async function signIn(baseUrl, identifier, password = EVO_PASSWORD) {
  return request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
}

test("REQ-2-1-2: an uppercase identifier is normalized to lowercase before uniqueness and persistence", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-org-owner");
    assert.equal(owner.status, 200);

    const created = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "Evo-Lab-01", displayName: "Evo Lab One" },
      owner.cookie,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.organization.id, "evo-lab-01");
    assert.equal(created.body.organization.displayName, "Evo Lab One");

    const overview = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-lab-01",
      undefined,
      owner.cookie,
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");

    // A different spelling of the same identifier is the same organization.
    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "EVO-LAB-01", displayName: "Another" },
      owner.cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Organization name already exists");

    // The seeded duplicate identifier is found after normalization as well.
    const seededDuplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "EVO-LAB-02", displayName: "Evo Lab Duplicate" },
      owner.cookie,
    );
    assert.equal(seededDuplicate.status, 400);
    assert.equal(seededDuplicate.body.fieldErrors.name, "Organization name already exists");

    // An invalid identifier and a whitespace-only display name are reported together.
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

    const stored = createOrgStore(app.dataDir);
    assert.equal((await stored.getOrganization("invalid-organization")) ?? null, null);
    assert.equal((await stored.getOrganization("evo-lab-02")).displayName, "Evo Lab Two");
  } finally {
    await app.close();
  }
});

test("REQ-2-4: an existing store keeps its records and receives the evolution seeds once", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-audit-upgrade-"));
  // A store written by the previous build: the baseline organization plus a
  // user change (a personal organization) and no `seedVersion` marker.
  await writeFile(
    join(dataDir, "organizations.json"),
    JSON.stringify({
      organizations: [
        { id: "acme-demo", displayName: "Acme Demo" },
        { id: "mobile-guild", displayName: "Mobile Guild" },
      ],
      memberships: [{ organizationId: "acme-demo", accountId: "account-org-owner", role: "Owner" }],
      teams: [],
      teamMembers: [],
      repositories: [],
      accessGrants: [],
    }),
    "utf8",
  );

  const store = createOrgStore(dataDir);
  // Pre-existing records and user changes are kept.
  assert.deepEqual(await store.getOrganization("mobile-guild"), { id: "mobile-guild", displayName: "Mobile Guild" });
  // The evolution seeds are added.
  assert.deepEqual(await store.getOrganization("evo-lab-02"), { id: "evo-lab-02", displayName: "Evo Lab Two" });
  assert.deepEqual(await store.getOrganization("evo-audit-org"), {
    id: "evo-audit-org",
    displayName: "evo-audit-org",
  });
  assert.equal((await store.getMembership("evo-lab-02", "account-evo-org-owner"))?.role, "Owner");
  assert.equal((await store.getMembership("evo-audit-org", "account-evo-audit-owner"))?.role, "Owner");
  assert.equal((await store.getMembership("evo-audit-org", "account-evo-audit-viewer"))?.role, "Member");

  const events = await store.listOrganizationAuditEvents("evo-audit-org");
  assert.deepEqual(
    events.map((event) => event.action).sort(),
    ["Member added", "Repository created"],
  );
  for (const event of events) {
    assert.equal(typeof event.actor, "string");
    assert.equal(typeof event.target, "string");
    assert.equal(typeof event.createdAt, "string");
  }

  // Restarting against the same directory neither duplicates nor rewrites.
  const restarted = createOrgStore(dataDir);
  const organizations = (await restarted.listAllOrganizations()).map((entry) => entry.id).sort();
  assert.deepEqual(organizations, [
    "acme-demo",
    "evo-archive-org",
    "evo-audit-org",
    "evo-lab-02",
    "mobile-guild",
  ]);
  assert.equal((await restarted.listOrganizationAuditEvents("evo-audit-org")).length, 2);
});

test("REQ-2-4: the audit log is readable by an Owner and refused to a Member", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-audit-owner");
    const log = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      owner.cookie,
    );
    assert.equal(log.status, 200);
    assert.equal(log.body.organization.id, "evo-audit-org");
    const actions = log.body.events.map((event) => event.action);
    assert.ok(actions.includes("Member added"));
    assert.ok(actions.includes("Repository created"));
    const added = log.body.events.find((event) => event.action === "Member added");
    assert.equal(added.actor, "evo-audit-owner");
    assert.equal(added.target, "evo-audit-viewer");
    assert.equal(typeof added.createdAt, "string");

    const member = await signIn(app.baseUrl, "evo-audit-viewer");
    const refused = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      member.cookie,
    );
    assert.equal(refused.status, 403);
    assert.equal(refused.body.message, "Access denied");

    // The Member may still view the organization itself.
    const overview = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org",
      undefined,
      member.cookie,
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Member");

    const visitor = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log");
    assert.equal(visitor.status, 401);
  } finally {
    await app.close();
  }
});

test("REQ-2-4: an Owner action appends a persisted audit event", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-audit-owner");

    const added = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/people",
      { identifier: "new-member", role: "Member" },
      owner.cookie,
    );
    assert.equal(added.status, 201);

    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories",
      { ownerType: "organization", ownerId: "evo-audit-org", name: "audit-notes-live", visibility: "private", initialize: false },
      owner.cookie,
    );
    assert.equal(created.status, 201);

    const log = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      owner.cookie,
    );
    const addedEvents = log.body.events.filter((event) => event.action === "Member added");
    const createdEvents = log.body.events.filter((event) => event.action === "Repository created");
    assert.ok(addedEvents.some((event) => event.target === "new-member"));
    assert.ok(createdEvents.some((event) => event.target === "audit-notes-live"));

    // The records survive a restart.
    const restarted = createOrgStore(app.dataDir);
    const persisted = await restarted.listOrganizationAuditEvents("evo-audit-org");
    assert.ok(persisted.some((event) => event.action === "Member added" && event.target === "new-member"));
    assert.ok(
      persisted.some((event) => event.action === "Repository created" && event.target === "audit-notes-live"),
    );
  } finally {
    await app.close();
  }
});
