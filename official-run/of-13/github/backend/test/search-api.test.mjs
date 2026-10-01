import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const OWNER = { username: "alice-dev", password: "Valid-password-123!" };

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

test("search returns readable repositories with openable metadata", async () => {
  await withApp(async (app) => {
    const response = await call(app.baseUrl, "/api/search?q=acme&type=repositories");
    assert.equal(response.status, 200);
    assert.equal(response.body.query, "acme");
    assert.equal(response.body.type, "repositories");
    assert.deepEqual(
      response.body.results.map((result) => `${result.owner}/${result.name}`),
      ["acme-demo/acme-docs"],
    );
    const [result] = response.body.results;
    assert.equal(result.visibility, "public");
    assert.equal(typeof result.description, "string");
    assert.equal(typeof result.updatedAt, "string");

    // Pressing Enter has no type filter click in front of it, so the default
    // search is the repository search.
    const defaulted = await call(app.baseUrl, "/api/search?q=acme");
    assert.deepEqual(defaulted.body.results, response.body.results);
  });
});

test("an unauthorized private repository never appears in the results", async () => {
  await withApp(async (app) => {
    const visitor = await call(app.baseUrl, "/api/search?q=secret-research");
    assert.equal(visitor.status, 200);
    assert.deepEqual(visitor.body.results, []);

    const empty = await call(app.baseUrl, "/api/search?q=no-such-repository");
    assert.deepEqual(empty.body.results, []);

    const cookie = await signIn(app, OWNER);
    const owner = await call(app.baseUrl, "/api/search?q=secret-research", { cookie });
    assert.deepEqual(
      owner.body.results.map((result) => `${result.owner}/${result.name}`),
      ["acme-demo/secret-research"],
    );
  });
});

test("search covers personal repositories and other result types stay empty", async () => {
  await withApp(async (app) => {
    const personal = await call(app.baseUrl, "/api/search?q=bob-notes");
    assert.deepEqual(
      personal.body.results.map((result) => `${result.owner}/${result.name}`),
      ["bob-reviewer/bob-notes"],
    );

    for (const type of ["issues", "pullrequests"]) {
      const response = await call(app.baseUrl, `/api/search?q=acme&type=${type}`);
      assert.equal(response.status, 200);
      assert.equal(response.body.type, type);
      assert.deepEqual(response.body.results, []);
    }

    // An unknown type is not a filter this build offers, so it falls back to
    // the default repository search instead of an invented result set.
    const unknown = await call(app.baseUrl, "/api/search?q=acme&type=not-a-type");
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.type, "repositories");
  });
});
