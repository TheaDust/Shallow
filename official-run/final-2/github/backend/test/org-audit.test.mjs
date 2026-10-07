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
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-org-audit-"));
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
  assert.equal(result.status, 200, `sign-in of ${identifier} failed`);
  return result.cookie;
}

// REQ-2-1-2 scenarios 1 and 2: the submitted identifier may carry uppercase
// letters, is lowercased before the uniqueness check and is persisted that way.
test("an organization identifier is normalized before it is validated and stored", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-org-owner");

    const created = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "Evo-Lab-01", displayName: "Evo Lab One" },
      cookie,
    );
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.organization, { id: "evo-lab-01", displayName: "Evo Lab One" });

    const overview = await request(app.baseUrl, "GET", "/api/organizations/evo-lab-01", undefined, cookie);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");

    // The creation survives a restart against the same data directory.
    const restarted = createOrgStore(app.dataDir);
    assert.deepEqual(await restarted.getOrganization("evo-lab-01"), {
      id: "evo-lab-01",
      displayName: "Evo Lab One",
    });

    // The seeded identifier is a duplicate however it is typed.
    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "EVO-LAB-02", displayName: "Evo Lab Duplicate" },
      cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.deepEqual(duplicate.body.fieldErrors, { name: "Organization name already exists" });
    assert.equal(duplicate.body.organization, undefined);
    assert.deepEqual(await restarted.getOrganization("evo-lab-02"), {
      id: "evo-lab-02",
      displayName: "Evo Lab Two",
    });

    const mine = await request(app.baseUrl, "GET", "/api/organizations", undefined, cookie);
    assert.deepEqual(
      mine.body.organizations.map((organization) => organization.id).sort(),
      ["evo-lab-01", "evo-lab-02"],
    );
  } finally {
    await app.close();
  }
});

// REQ-2-1-2 scenario 3: both field rules are reported in one response and
// nothing is written.
test("a malformed identifier and a whitespace-only display name are reported together", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-org-owner");
    const rejected = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "-invalid-organization", displayName: "   " },
      cookie,
    );
    assert.equal(rejected.status, 400);
    assert.deepEqual(rejected.body.fieldErrors, {
      name: "Organization name format is invalid",
      displayName: "Display name is required",
    });

    // A display name of only spaces is never trimmed into a stored value.
    const displayOnly = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "Evo-Lab-03", displayName: "   " },
      cookie,
    );
    assert.equal(displayOnly.status, 400);
    assert.deepEqual(displayOnly.body.fieldErrors, { displayName: "Display name is required" });

    const mine = await request(app.baseUrl, "GET", "/api/organizations", undefined, cookie);
    assert.deepEqual(mine.body.organizations.map((organization) => organization.id), ["evo-lab-02"]);
    assert.equal(await createOrgStore(app.dataDir).getOrganization("evo-lab-03"), null);
  } finally {
    await app.close();
  }
});

// REQ-2-4: the persisted audit events are an Owner-only read surface.
test("only an organization Owner reads the audit log", async () => {
  const app = await startApp();
  try {
    const visitor = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org/audit-log");
    assert.equal(visitor.status, 401);

    const ownerCookie = await signIn(app.baseUrl, "evo-audit-owner");
    const ownerOverview = await request(app.baseUrl, "GET", "/api/organizations/evo-audit-org", undefined, ownerCookie);
    assert.equal(ownerOverview.body.viewerRole, "Owner");

    const audit = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      ownerCookie,
    );
    assert.equal(audit.status, 200);
    assert.equal(audit.body.organization.id, "evo-audit-org");
    assert.deepEqual(
      audit.body.events.map((event) => event.action).sort(),
      ["Member added", "Repository created"],
    );
    for (const event of audit.body.events) {
      assert.equal(typeof event.actor, "string");
      assert.equal(event.actor.length > 0, true);
      assert.equal(typeof event.target, "string");
      assert.equal(event.target.length > 0, true);
      assert.equal(Number.isNaN(Date.parse(event.timestamp)), false);
      assert.equal(typeof event.id, "string");
    }

    const memberCookie = await signIn(app.baseUrl, "evo-audit-viewer");
    const memberOverview = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org",
      undefined,
      memberCookie,
    );
    assert.equal(memberOverview.status, 200);
    assert.equal(memberOverview.body.viewerRole, "Member");
    const refused = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      memberCookie,
    );
    assert.equal(refused.status, 403);
    assert.equal(refused.body.events, undefined);
  } finally {
    await app.close();
  }
});

// REQ-2-4: an Owner action of the organization is appended to the same log and
// stays readable after the process restarts.
test("an organization action appends one audit event", async () => {
  const app = await startApp();
  try {
    const ownerCookie = await signIn(app.baseUrl, "evo-audit-owner");
    const added = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/people",
      { identifier: "new-member", role: "Member" },
      ownerCookie,
    );
    assert.equal(added.status, 201);

    const restarted = createOrgStore(app.dataDir);
    const events = await restarted.listOrganizationAuditEvents("evo-audit-org");
    assert.deepEqual(
      events.map((event) => `${event.actor}:${event.action}:${event.target}`).sort(),
      [
        "evo-audit-owner:Member added:evo-audit-viewer",
        "evo-audit-owner:Member added:new-member",
        "evo-audit-owner:Repository created:audit-demo",
      ],
    );

    // A rejected operation never adds one.
    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations/evo-audit-org/people",
      { identifier: "new-member", role: "Member" },
      ownerCookie,
    );
    assert.equal(duplicate.status, 400);
    const after = await createOrgStore(app.dataDir).listOrganizationAuditEvents("evo-audit-org");
    assert.equal(after.length, events.length);
  } finally {
    await app.close();
  }
});
