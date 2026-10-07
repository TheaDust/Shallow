import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const EVO_PASSWORD = "Evo-Password-987!";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-org-evo-"));
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

async function signIn(baseUrl, identifier) {
  return request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password: EVO_PASSWORD });
}

test("an uppercase identifier is stored normalized as the unique organization name", async () => {
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
    // The identifier is normalized to lowercase; the display name keeps its
    // case and only loses the outer whitespace.
    assert.deepEqual(created.body.organization, { id: "evo-lab-01", displayName: "Evo Lab One" });

    const overview = await request(app.baseUrl, "GET", "/api/organizations/evo-lab-01", undefined, owner.cookie);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");
    // A link written in either case resolves to the same organization.
    const upper = await request(app.baseUrl, "GET", "/api/organizations/EVO-LAB-01", undefined, owner.cookie);
    assert.equal(upper.status, 200);
    assert.equal(upper.body.organization.id, "evo-lab-01");

    const mine = await request(app.baseUrl, "GET", "/api/organizations", undefined, owner.cookie);
    assert.deepEqual(
      mine.body.organizations.map((organization) => organization.id).sort(),
      ["evo-lab-01", "evo-lab-02"],
    );

    const restarted = createOrgStore(app.dataDir);
    assert.deepEqual(await restarted.getOrganization("evo-lab-01"), {
      id: "evo-lab-01",
      displayName: "Evo Lab One",
    });
    assert.equal((await restarted.getMembership("evo-lab-01", "account-evo-org-owner"))?.role, "Owner");
    // Identifiers are compared and stored in lowercase, so the mixed-case form
    // resolves to the one stored organization instead of a second one.
    assert.deepEqual(await restarted.getOrganization("Evo-Lab-01"), {
      id: "evo-lab-01",
      displayName: "Evo Lab One",
    });
    assert.equal((await restarted.listAllOrganizations()).filter((entry) => entry.id === "evo-lab-01").length, 1);
  } finally {
    await app.close();
  }
});

test("an identifier that normalizes onto an existing one is a duplicate", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-org-owner");

    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "EVO-LAB-02", displayName: "Evo Lab Duplicate" },
      owner.cookie,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.name, "Organization name already exists");

    const lowerDuplicate = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "evo-lab-02", displayName: "Evo Lab Duplicate" },
      owner.cookie,
    );
    assert.equal(lowerDuplicate.status, 400);
    assert.equal(lowerDuplicate.body.fieldErrors.name, "Organization name already exists");

    // The existing organization keeps its own identifier and display name and
    // the rejected submissions created nothing.
    const mine = await request(app.baseUrl, "GET", "/api/organizations", undefined, owner.cookie);
    assert.deepEqual(mine.body.organizations, [
      { id: "evo-lab-02", displayName: "Evo Lab Two", role: "Owner" },
    ]);
  } finally {
    await app.close();
  }
});

test("an invalid identifier and a whitespace-only display name are reported together", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "evo-org-owner");
    const rejected = await request(
      app.baseUrl,
      "POST",
      "/api/organizations",
      { name: "-invalid-organization", displayName: "   " },
      owner.cookie,
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fieldErrors.name, "Organization name format is invalid");
    assert.equal(rejected.body.fieldErrors.displayName, "Display name is required");

    for (const name of ["Evo Lab One", "Evo/Lab", "Evo-Lab-"]) {
      const malformed = await request(
        app.baseUrl,
        "POST",
        "/api/organizations",
        { name, displayName: "Evo Lab" },
        owner.cookie,
      );
      assert.equal(malformed.status, 400, `${name} should be rejected`);
      assert.equal(malformed.body.fieldErrors.name, "Organization name format is invalid");
    }

    const mine = await request(app.baseUrl, "GET", "/api/organizations", undefined, owner.cookie);
    assert.deepEqual(mine.body.organizations.map((entry) => entry.id), ["evo-lab-02"]);
  } finally {
    await app.close();
  }
});
