// REQ-2-1-2 (evolution) organization creation and REQ-2-4 organization audit
// log: the trusted rules of the identifier normalization, the audit-log access
// rule and the persisted organization actions.

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const EVOLUTION_PASSWORD = "Evo-Password-987!";

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

async function signIn(baseUrl, identifier, password = EVOLUTION_PASSWORD) {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  return result;
}

test("the Owner reads the seeded organization actions of the audit log", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-audit-owner");
    assert.equal(owner.status, 200);

    const overview = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org", undefined, owner.cookie);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");

    const audit = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      owner.cookie,
    );
    assert.equal(audit.status, 200);
    assert.equal(audit.body.organization.id, "evo-audit-org");

    const events = audit.body.events;
    assert.ok(events.length >= 2);
    for (const event of events) {
      assert.equal(typeof event.id, "string");
      for (const field of ["actor", "action", "target", "timestamp"]) {
        assert.equal(typeof event[field], "string");
        assert.notEqual(event[field], "");
      }
    }
    const memberAdded = events.find((event) => event.action === "Member added");
    assert.equal(memberAdded.actor, "evo-audit-owner");
    assert.equal(memberAdded.target, "evo-audit-viewer");
    const repositoryCreated = events.find((event) => event.action === "Repository created");
    assert.equal(repositoryCreated.actor, "evo-audit-owner");
    assert.equal(repositoryCreated.target, "audit-demo");

    // The seeded `Repository created` action refers to a stored repository of
    // this organization, readable by its Owner.
    const repository = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-audit-org/audit-demo",
      undefined,
      owner.cookie,
    );
    assert.equal(repository.status, 200);
    assert.equal(repository.body.repository.name, "audit-demo");

    // Reading the audit log changes no organization state.
    const again = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      owner.cookie,
    );
    assert.deepEqual(again.body.events, events);
  } finally {
    await app.close();
  }
});

test("only the organization Owner reaches the audit log", async () => {
  const app = await startApp();
  try {
    const anonymous = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log");
    assert.equal(anonymous.status, 401);

    // The ordinary Member may view the organization but never its audit log.
    const member = await signIn(app.baseUrl, "evo-audit-viewer");
    assert.equal(member.status, 200);
    const overview = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org",
      undefined,
      member.cookie,
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Member");

    const denied = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      member.cookie,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const missing = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/no-such-organization/audit-log",
      undefined,
      member.cookie,
    );
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test("a later organization action joins the persisted audit log", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-audit-owner");

    const before = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      owner.cookie,
    );
    const added = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/people",
      { identifier: "bob-reviewer", role: "Member" },
      owner.cookie,
    );
    assert.equal(added.status, 201);

    const after = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      owner.cookie,
    );
    assert.equal(after.body.events.length, before.body.events.length + 1);
    const recorded = after.body.events[0];
    assert.equal(recorded.actor, "evo-audit-owner");
    assert.equal(recorded.action, "Member added");
    assert.equal(recorded.target, "bob-reviewer");

    // A rejected action leaves the trail untouched.
    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/people",
      { identifier: "bob-reviewer", role: "Member" },
      owner.cookie,
    );
    assert.equal(duplicate.status, 400);
    const unchanged = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      owner.cookie,
    );
    assert.deepEqual(unchanged.body.events, after.body.events);

    // The audit trail survives a restart of the application.
    const restarted = createOrgStore(app.dataDir);
    const persisted = await restarted.listAuditEvents("evo-audit-org");
    assert.equal(persisted.length, after.body.events.length);
    assert.ok(persisted.some((event) => event.target === "bob-reviewer"));
  } finally {
    await app.close();
  }
});

test("organization identifiers are normalized to lowercase before validation and storage", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-org-owner");
    assert.equal(owner.status, 200);

    const created = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "Evo-Lab-01", displayName: "  Evo Lab One  " },
      owner.cookie,
    );
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.organization, { id: "evo-lab-01", displayName: "Evo Lab One" });

    const overview = await request(app.baseUrl, "GET", "/api/organizations/evo-lab-01", undefined, owner.cookie);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");

    // An identifier that normalizes onto the stored one is a duplicate.
    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "EVO-LAB-02", displayName: "Evo Lab Duplicate" },
      owner.cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Organization name already exists");

    const sameCasing = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "evo-lab-01", displayName: "Evo Lab One Again" },
      owner.cookie,
    );
    assert.equal(sameCasing.status, 400);
    assert.equal(sameCasing.body.fieldErrors.name, "Organization name already exists");

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

    const mine = await request(app.baseUrl, "GET", "/api/organizations", undefined, owner.cookie);
    assert.deepEqual(
      mine.body.organizations.map((organization) => organization.id).sort(),
      ["evo-lab-01", "evo-lab-02"],
    );

    // The stored identifier is the normalized one and survives a restart.
    const restarted = createOrgStore(app.dataDir);
    assert.deepEqual(await restarted.getOrganization("evo-lab-01"), {
      id: "evo-lab-01",
      displayName: "Evo Lab One",
    });
    assert.equal(await restarted.getOrganization("Evo-Lab-01"), null);
    assert.equal((await restarted.getMembership("evo-lab-01", "account-evo-org-owner"))?.role, "Owner");
  } finally {
    await app.close();
  }
});
