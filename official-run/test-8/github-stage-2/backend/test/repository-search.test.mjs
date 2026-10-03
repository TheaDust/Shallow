import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-search-")));
  const app = await createApp({ dataDir });
  const server = createServer((request, response) => {
    void app.handle(request, response);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    dataDir,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((done) => server.close(done));
    },
  };
}

async function call(base, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
    sessionCookie: (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; "),
  };
}

async function signIn(base, identifier) {
  return call(base, "/api/session", { method: "POST", body: { identifier, password: "Valid-password-123!" } });
}

function names(result) {
  return result.body.repositories.map((repository) => repository.name);
}

test("an unauthenticated search finds the public seed repository and hides the private one", async () => {
  const app = await startApp();
  try {
    const found = await call(app.base, "/api/search/repositories?q=acme-docs");
    assert.equal(found.status, 200);
    assert.deepEqual(names(found), ["acme-docs"]);
    assert.equal(found.body.repositories[0].owner.login, "acme-demo");
    assert.equal(found.body.repositories[0].owner.displayName, "Acme Demo");
    assert.equal(found.body.repositories[0].owner.type, "organization");
    assert.equal(found.body.repositories[0].visibility, "public");

    const hidden = await call(app.base, "/api/search/repositories?q=secret-research");
    assert.equal(hidden.status, 200);
    assert.deepEqual(names(hidden), []);

    const ownerForm = await call(app.base, "/api/search/repositories?q=Acme%20Demo/acme-docs");
    assert.deepEqual(names(ownerForm), ["acme-docs"]);

    const missing = await call(app.base, "/api/search/repositories?q=no-such-repository");
    assert.equal(missing.status, 200);
    assert.deepEqual(names(missing), []);
  } finally {
    await app.close();
  }
});

test("a signed-in account searches the private repositories it may read", async () => {
  const app = await startApp();
  try {
    // `repo-admin` holds an Admin grant on acme-docs only.
    const repoAdmin = await signIn(app.base, "repo-admin");
    const forAdmin = await call(app.base, "/api/search/repositories?q=secret-research", { cookie: repoAdmin.sessionCookie });
    assert.deepEqual(names(forAdmin), []);

    // An organization Owner reads every repository of the organization.
    const owner = await signIn(app.base, "org-owner");
    const forOwner = await call(app.base, "/api/search/repositories?q=secret-research", { cookie: owner.sessionCookie });
    assert.deepEqual(names(forOwner), ["secret-research"]);
  } finally {
    await app.close();
  }
});

test("the public explore list only exposes public repositories", async () => {
  const app = await startApp();
  try {
    const listed = await call(app.base, "/api/public/repositories");
    assert.equal(listed.status, 200);
    assert.deepEqual(
      names(listed),
      ["acme-docs", "branch-switch-demo", "default-branch-demo", "file-management-demo"],
    );
  } finally {
    await app.close();
  }
});
