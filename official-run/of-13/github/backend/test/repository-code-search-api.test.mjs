import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

test("a visitor searches the readable file content of the seeded repository", async () => {
  await withApp(async (app) => {
    const results = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/search?q=search%20flow",
    );
    assert.equal(results.status, 200);
    assert.equal(results.body.repository.name, "acme-docs");
    assert.equal(results.body.branch, "main");
    assert.equal(results.body.query, "search flow");
    assert.deepEqual(
      results.body.results.map((result) => result.path),
      ["README.md", "src/search.ts"],
    );

    const [readme] = results.body.results;
    assert.equal(readme.name, "README.md");
    assert.equal(readme.branch, "main");
    assert.match(readme.snippet, /search flow/);
    assert.equal(readme.line, 5);
  });
});

test("the path filter narrows the results to the matching files", async () => {
  await withApp(async (app) => {
    const scoped = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/search?q=search%20flow&path=src%2F",
    );
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.path, "src");
    assert.deepEqual(
      scoped.body.results.map((result) => result.path),
      ["src/search.ts"],
    );

    const nothing = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/search?q=search%20flow&path=docs%2F",
    );
    assert.equal(nothing.status, 200);
    assert.deepEqual(nothing.body.results, []);

    const language = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/search?q=search%20flow&language=TypeScript",
    );
    assert.equal(language.status, 200);
    assert.deepEqual(
      language.body.results.map((result) => result.path),
      ["src/search.ts"],
    );
  });
});

test("an absent term answers with an empty result set and keeps the query", async () => {
  await withApp(async (app) => {
    const empty = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/search?q=no-such-token",
    );
    assert.equal(empty.status, 200);
    assert.equal(empty.body.query, "no-such-token");
    assert.deepEqual(empty.body.results, []);

    // Repeating the same search stays empty: nothing stale is remembered.
    const repeated = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/search?q=no-such-token",
    );
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body.results, []);

    const blank = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/search");
    assert.equal(blank.status, 200);
    assert.deepEqual(blank.body.results, []);
  });
});

test("code search never leaks an unreadable repository and follows the branch snapshot", async () => {
  await withApp(async (app) => {
    // The private repository contains the same phrase for an authorized
    // reader, but a visitor cannot search it at all.
    const denied = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/search?q=search%20flow",
    );
    assert.equal(denied.status, 403);

    const missing = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/not-there/search?q=search%20flow",
    );
    assert.equal(missing.status, 404);

    const signedIn = await call(app.baseUrl, "/api/session", {
      method: "POST",
      body: { identifier: ALICE.username, password: ALICE.password },
    });
    const cookie = signedIn.setCookie?.split(";")[0] ?? null;
    const owner = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/search?q=search%20flow",
      { cookie },
    );
    assert.equal(owner.status, 200);
    assert.deepEqual(
      owner.body.results.map((result) => result.path),
      ["research/notes.md"],
    );

    // The other branch has its own snapshot: `docs/` and `src/` are absent.
    const otherBranch = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/search?q=search%20flow&branch=feature-search",
    );
    assert.equal(otherBranch.status, 200);
    assert.equal(otherBranch.body.branch, "feature-search");
    assert.deepEqual(
      otherBranch.body.results.map((result) => result.path),
      ["README.md"],
    );

    const unknownBranch = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/acme-docs/search?q=search%20flow&branch=not-a-branch",
    );
    assert.equal(unknownBranch.status, 404);
  });
});
