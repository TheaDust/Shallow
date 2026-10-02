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
  dataDir = await mkdtemp(join(tmpdir(), "shallow-org-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

async function aliceCookie() {
  return app.signIn("alice-dev", "Valid-password-123!");
}

async function bobCookie() {
  return app.signIn("bob-reviewer", "Valid-password-123!");
}

describe("REQ-2-1-1 organization repository list", () => {
  it("lists the seeded public organization to any caller", async () => {
    const response = await app.request("/api/organizations");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.organizations, [{ name: "acme-demo", displayName: "Acme Demo" }]);
  });

  it("shows a visitor only the public repository of the organization", async () => {
    const response = await app.request("/api/organizations/acme-demo");
    assert.equal(response.status, 200);
    assert.equal(response.body.organization.displayName, "Acme Demo");
    assert.equal(response.body.viewerRole, null);
    assert.deepEqual(
      response.body.repositories.map((repository) => repository.name),
      ["acme-web"],
    );
    const [repository] = response.body.repositories;
    assert.equal(repository.fullName, "Acme Demo/acme-web");
    assert.equal(repository.ownerDisplayName, "Acme Demo");
    assert.equal(repository.visibility, "public");
    assert.equal(repository.description, "Public website of the Acme Demo platform");
    assert.ok(repository.updatedAt);
    // The private repository is never named to an unauthorized caller.
    assert.equal(JSON.stringify(response.body).includes("acme-internal"), false);
  });

  it("resolves the organization by identifier or display name", async () => {
    for (const identifier of ["acme-demo", "ACME-DEMO", "Acme%20Demo"]) {
      const response = await app.request(`/api/organizations/${identifier}`);
      assert.equal(response.status, 200, `expected ${identifier} to resolve`);
      assert.equal(response.body.organization.name, "acme-demo");
    }
  });

  it("shows an organization Owner every organization repository", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/organizations/acme-demo", { cookie });
    assert.equal(response.body.viewerRole, "Owner");
    assert.deepEqual(
      response.body.repositories.map((repository) => repository.name),
      ["acme-internal", "acme-web"],
    );
    assert.deepEqual(
      response.body.members,
      [
        { username: "alice-dev", role: "Owner" },
        { username: "bob-reviewer", role: "Member" },
      ],
    );
    // The seeded hierarchy: platform-team → frontend-team → frontend-child.
    assert.deepEqual(
      response.body.teams.map((team) => [team.name, team.parentTeamName]),
      [
        ["frontend-child", "frontend-team"],
        ["frontend-team", "platform-team"],
        ["platform-team", null],
      ],
    );
  });

  it("gives an ordinary member organization visibility but no private repository", async () => {
    const cookie = await bobCookie();
    const response = await app.request("/api/organizations/acme-demo", { cookie });
    assert.equal(response.body.viewerRole, "Member");
    assert.deepEqual(
      response.body.repositories.map((repository) => repository.name),
      ["acme-web"],
    );
  });

  it("opens a public repository without a session and rejects a private one", async () => {
    const publicRepository = await app.request("/api/repositories/acme-demo/acme-web");
    assert.equal(publicRepository.status, 200);
    assert.equal(publicRepository.body.repository.fullName, "Acme Demo/acme-web");
    // The identifier stays the address of the owner link.
    assert.equal(publicRepository.body.repository.owner, "acme-demo");

    const privateRepository = await app.request("/api/repositories/acme-demo/acme-internal");
    assert.equal(privateRepository.status, 403);
    assert.equal(privateRepository.body.error, "Access denied");

    const owner = await app.request("/api/repositories/acme-demo/acme-internal", {
      cookie: await aliceCookie(),
    });
    assert.equal(owner.status, 200);
    assert.equal(owner.body.repository.visibility, "private");

    const unknown = await app.request("/api/repositories/acme-demo/acme-missing");
    assert.equal(unknown.status, 404);
  });

  it("carries the caller's organizations and roles in the session payload", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/session", { cookie });
    assert.deepEqual(response.body.user.organizations, [
      { name: "acme-demo", displayName: "Acme Demo", role: "Owner" },
    ]);

    const bob = await bobCookie();
    const bobSession = await app.request("/api/session", { cookie: bob });
    assert.deepEqual(bobSession.body.user.organizations, [
      { name: "acme-demo", displayName: "Acme Demo", role: "Member" },
    ]);
  });
});

describe("REQ-2-1-2 organization creation", () => {
  it("creates the organization with the creator as Owner and member", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/organizations", {
      method: "POST",
      cookie,
      body: { name: "mobile-guild", displayName: "Mobile Guild" },
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.organization.name, "mobile-guild");

    const detail = await app.request("/api/organizations/mobile-guild", { cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.organization.name, "mobile-guild");
    assert.equal(detail.body.organization.displayName, "Mobile Guild");
    assert.ok(detail.body.organization.createdAt);
    assert.equal(detail.body.viewerRole, "Owner");
    assert.deepEqual(detail.body.members, [{ username: "alice-dev", role: "Owner" }]);

    const mine = await app.request("/api/account/organizations", { cookie });
    assert.deepEqual(
      mine.body.organizations.map((organization) => organization.name).sort(),
      ["acme-demo", "mobile-guild"],
    );
  });

  it("keeps the created organization after the store is reopened", async () => {
    const reopened = await startApp(dataDir);
    try {
      const response = await reopened.request("/api/organizations/mobile-guild");
      assert.equal(response.status, 200);
      assert.equal(response.body.organization.displayName, "Mobile Guild");
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("reports a duplicate identifier even when the display name is missing", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/organizations", {
      method: "POST",
      cookie,
      body: { name: "acme-demo", displayName: "" },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.fields.name, "Organization name already exists");
    assert.equal(response.body.fields.displayName, "Display name is required");

    // The seeded organization is also recognized by its display name, so a
    // submission of "Acme Demo" reports the conflict instead of a format error.
    const displayNameConflict = await app.request("/api/organizations", {
      method: "POST",
      cookie,
      body: { name: "Acme Demo", displayName: "Another Guild" },
    });
    assert.equal(displayNameConflict.status, 400);
    assert.equal(displayNameConflict.body.fields.name, "Organization name already exists");

    const untouched = await app.request("/api/organizations/acme-demo-two");
    assert.equal(untouched.status, 404);
  });

  it("rejects a malformed identifier and a whitespace-only display name", async () => {
    const cookie = await aliceCookie();
    const malformed = await app.request("/api/organizations", {
      method: "POST",
      cookie,
      body: { name: "-invalid-organization", displayName: "Invalid Organization" },
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.fields.name, "Organization name format is invalid");
    assert.equal(malformed.body.fields.displayName, undefined);

    const blankDisplay = await app.request("/api/organizations", {
      method: "POST",
      cookie,
      body: { name: "valid-organization", displayName: "   " },
    });
    assert.equal(blankDisplay.status, 400);
    assert.equal(blankDisplay.body.fields.displayName, "Display name is required");

    const empty = await app.request("/api/organizations", {
      method: "POST",
      cookie,
      body: {},
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.fields.name, "Organization name format is invalid");
    assert.equal(empty.body.fields.displayName, "Display name is required");

    for (const name of ["-invalid-organization", "valid-organization"]) {
      const check = await app.request(`/api/organizations/${name}`);
      assert.equal(check.status, 404, `${name} must not exist`);
    }
  });

  it("refuses creation without a session", async () => {
    const response = await app.request("/api/organizations", {
      method: "POST",
      body: { name: "anonymous-guild", displayName: "Anonymous Guild" },
    });
    assert.equal(response.status, 401);
    const check = await app.request("/api/organizations/anonymous-guild");
    assert.equal(check.status, 404);

    const mine = await app.request("/api/account/organizations");
    assert.equal(mine.status, 401);
  });
});
