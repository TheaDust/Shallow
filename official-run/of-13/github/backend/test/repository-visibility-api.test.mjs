import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const OWNER = { username: "alice-dev", password: "Valid-password-123!" };
const MEMBER = { username: "bob-reviewer", password: "Valid-password-123!" };

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, { username, password }) {
  const response = await call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier: username, password },
  });
  assert.equal(response.status, 200);
  return response.setCookie?.split(";")[0] ?? null;
}

function visibilityPath(owner, name) {
  return `/api/repositories/${owner}/${name}/visibility`;
}

test("the seeded private repository is invisible until an Admin makes it Public", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    // The private repository starts unreadable for visitors and for the plain
    // organization member, and out of search results.
    const visitorBefore = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research");
    assert.equal(visitorBefore.status, 403);
    const memberCookie = await signIn(app, MEMBER);
    const memberBefore = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: memberCookie,
    });
    assert.equal(memberBefore.status, 403);
    const searchBefore = await call(app.baseUrl, "/api/search?q=secret-research");
    assert.deepEqual(searchBefore.body.results, []);
    const listBefore = await call(app.baseUrl, "/api/organizations/acme-demo/repositories");
    assert.deepEqual(
      listBefore.body.repositories.map((repository) => repository.name),
      ["acme-docs"],
    );

    // The repository Admin confirms the change without retyping the name.
    const changed = await call(app.baseUrl, visibilityPath("acme-demo", "secret-research"), {
      method: "POST",
      cookie: ownerCookie,
      body: { visibility: "Public" },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.repository.visibility, "public");
    assert.equal(changed.body.repository.name, "secret-research");

    // Every later read uses the new visibility: the direct address, the search
    // result and the organization list are readable without a session.
    const visitorAfter = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research");
    assert.equal(visitorAfter.status, 200);
    assert.equal(visitorAfter.body.repository.visibility, "public");
    assert.equal(visitorAfter.body.viewerRole, null);
    assert.equal(visitorAfter.body.canAdminister, false);
    const tree = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/tree?path=research",
    );
    assert.equal(tree.status, 200);
    assert.deepEqual(
      tree.body.entries.map((entry) => entry.name),
      ["notes.md"],
    );
    const searchAfter = await call(app.baseUrl, "/api/search?q=secret-research");
    assert.deepEqual(
      searchAfter.body.results.map((result) => `${result.owner}/${result.name}`),
      ["acme-demo/secret-research"],
    );

    // The stored value survives a restart of the application.
    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, "/api/repositories/acme-demo/secret-research");
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.repository.visibility, "public");
  });
});

test("a non-Admin collaborator can never change the visibility", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);

    // A Write grant makes the member a collaborator on the private repository,
    // but Write is not Admin.
    const granted = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research/access", {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "write" },
    });
    assert.equal(granted.status, 200);

    const memberCookie = await signIn(app, MEMBER);
    const readable = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: memberCookie,
    });
    assert.equal(readable.status, 200);
    assert.equal(readable.body.viewerRole, "write");
    assert.equal(readable.body.canAdminister, false);

    const rejected = await call(app.baseUrl, visibilityPath("acme-demo", "secret-research"), {
      method: "POST",
      cookie: memberCookie,
      body: { visibility: "public" },
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error, "Access denied");

    // The refused write left the repository exactly as it was.
    const unchanged = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: ownerCookie,
    });
    assert.equal(unchanged.body.repository.visibility, "private");
  });
});

test("an Admin grant, a visitor and a missing repository answer distinctly", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const memberCookie = await signIn(app, MEMBER);

    const unauthorized = await call(app.baseUrl, visibilityPath("acme-demo", "secret-research"), {
      method: "POST",
      body: { visibility: "public" },
    });
    assert.equal(unauthorized.status, 401);

    const missing = await call(app.baseUrl, visibilityPath("acme-demo", "not-there"), {
      method: "POST",
      cookie: ownerCookie,
      body: { visibility: "public" },
    });
    assert.equal(missing.status, 404);

    const invalid = await call(app.baseUrl, visibilityPath("acme-demo", "secret-research"), {
      method: "POST",
      cookie: ownerCookie,
      body: { visibility: "internal" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.visibility, "Visibility is invalid");

    // A mistyped confirmation keeps the repository Private.
    const mismatch = await call(app.baseUrl, visibilityPath("acme-demo", "secret-research"), {
      method: "POST",
      cookie: ownerCookie,
      body: { visibility: "public", confirmation: "acme-docs" },
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.fieldErrors.confirmation, "Repository name does not match");
    const stillPrivate = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research", {
      cookie: ownerCookie,
    });
    assert.equal(stillPrivate.body.repository.visibility, "private");

    // A matching confirmation text is accepted, and a granted Admin may act too.
    const confirmed = await call(app.baseUrl, visibilityPath("acme-demo", "secret-research"), {
      method: "POST",
      cookie: ownerCookie,
      body: { visibility: "public", confirmation: "secret-research" },
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.repository.visibility, "public");

    await call(app.baseUrl, "/api/repositories/acme-demo/secret-research/access", {
      method: "PUT",
      cookie: ownerCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "admin" },
    });
    const byGrantee = await call(app.baseUrl, visibilityPath("acme-demo", "secret-research"), {
      method: "POST",
      cookie: memberCookie,
      body: { visibility: "private" },
    });
    assert.equal(byGrantee.status, 200);
    assert.equal(byGrantee.body.repository.visibility, "private");
  });
});

test("a personal repository owner is the Admin of their own repository", async () => {
  await withApp(async (app) => {
    const ownerCookie = await signIn(app, OWNER);
    const memberCookie = await signIn(app, MEMBER);

    const foreign = await call(app.baseUrl, visibilityPath("alice-dev", "acme-docs-fork"), {
      method: "POST",
      cookie: memberCookie,
      body: { visibility: "public" },
    });
    assert.equal(foreign.status, 403);

    const changed = await call(app.baseUrl, visibilityPath("alice-dev", "acme-docs-fork"), {
      method: "POST",
      cookie: ownerCookie,
      body: { visibility: "public" },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.repository.visibility, "public");
    assert.equal(changed.body.repository.owner, "alice-dev");
  });
});
