import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

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

async function signIn(baseUrl, identifier, password = "Valid-password-123!") {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200, `sign-in failed for ${identifier}`);
  return result.cookie;
}

test("an organization identifier accepts uppercase input and is stored lowercase", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-org-owner", "Evo-Password-987!");

    const created = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "Evo-Lab-01", displayName: "Evo Lab One" },
      owner,
    );
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.organization, { id: "evo-lab-01", displayName: "Evo Lab One" });

    const overview = await request(app.baseUrl, "GET", "/api/organizations/evo-lab-01", undefined, owner);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");

    // The seeded identifier is taken, whatever the casing of the submission.
    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "EVO-LAB-02", displayName: "Evo Lab Duplicate" },
      owner,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Organization name already exists");

    const malformed = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "-invalid-organization", displayName: "   " },
      owner,
    );
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.fieldErrors.name, "Organization name format is invalid");
    assert.equal(malformed.body.fieldErrors.displayName, "Display name is required");

    // The created organization and its Owner membership survive a restart.
    const restarted = createOrgStore(app.dataDir);
    assert.deepEqual(await restarted.getOrganization("evo-lab-01"), {
      id: "evo-lab-01",
      displayName: "Evo Lab One",
    });
    assert.equal((await restarted.getMembership("evo-lab-01", "account-evo-org-owner"))?.role, "Owner");
    assert.deepEqual(await restarted.getOrganization("evo-lab-02"), {
      id: "evo-lab-02",
      displayName: "Evo Lab Two",
    });
  } finally {
    await app.close();
  }
});

test("the organization audit log lists the persisted actions for an Owner only", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-audit-owner", "Evo-Password-987!");
    const log = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log", undefined, owner);
    assert.equal(log.status, 200);
    assert.deepEqual(log.body.organization, { id: "evo-audit-org", displayName: "Evo Audit Org" });

    const actions = log.body.events.map((event) => event.action);
    assert.ok(actions.includes("Member added"));
    assert.ok(actions.includes("Repository created"));
    const memberAdded = log.body.events.find((event) => event.action === "Member added");
    assert.equal(memberAdded.actor, "evo-audit-owner");
    assert.equal(memberAdded.target, "evo-audit-viewer");
    assert.equal(typeof memberAdded.timestamp, "string");
    assert.ok(log.body.actions.includes("Member added"));
    assert.ok(log.body.actions.includes("Repository created"));

    // An ordinary Member may read the organization but never the audit log.
    const member = await signIn(app.baseUrl, "evo-audit-viewer", "Evo-Password-987!");
    const overview = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org", undefined, member);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Member");
    const denied = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log", undefined, member);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const visitor = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log");
    assert.equal(visitor.status, 401);

    // Filtering is a read: the stored events stay unchanged.
    const again = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log", undefined, owner);
    assert.deepEqual(again.body.events, log.body.events);
  } finally {
    await app.close();
  }
});

test("organization actions performed later are appended to the audit log", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-audit-owner", "Evo-Password-987!");

    const added = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/people",
      { identifier: "new-member", role: "Member" },
      owner,
    );
    assert.equal(added.status, 201);

    const team = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/teams",
      { name: "audit-team" },
      owner,
    );
    assert.equal(team.status, 201);

    const repository = await request(
      app.baseUrl,
      "POST",
      "/api/repositories",
      { ownerType: "organization", ownerId: "evo-audit-org", name: "audit-log-demo", visibility: "private" },
      owner,
    );
    assert.equal(repository.status, 201);

    const log = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log", undefined, owner);
    const events = log.body.events;
    assert.ok(events.some((event) => event.action === "Member added" && event.target === "new-member"));
    assert.ok(events.some((event) => event.action === "Team created" && event.target === "audit-team"));
    assert.ok(events.some((event) => event.action === "Repository created" && event.target === "audit-log-demo"));

    const restarted = createOrgStore(app.dataDir);
    const persisted = await restarted.listAuditEvents("evo-audit-org");
    assert.ok(persisted.some((event) => event.action === "Team created" && event.target === "audit-team"));
  } finally {
    await app.close();
  }
});
