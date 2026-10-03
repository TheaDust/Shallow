import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startServer(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallow-search-")));
  const handler = await createRequestHandler({ dataDir: dir, staticRoot: dir });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    dataDir: dir,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function request(baseUrl, method, path, { body, cookies = "" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookies ? { cookie: cookies } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    payload: text ? JSON.parse(text) : null,
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  };
}

async function signIn(baseUrl, identifier) {
  const response = await request(baseUrl, "POST", "/api/signin", {
    body: { identifier, password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200, `sign-in failed for ${identifier}`);
  return response.cookie;
}

function search(baseUrl, query, cookies) {
  return request(baseUrl, "GET", `/api/search/repositories?q=${encodeURIComponent(query)}`, { cookies });
}

test("a visitor only searches repositories they may read", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const public_ = await search(app.baseUrl, "acme-docs");
  assert.equal(public_.status, 200);
  assert.deepEqual(public_.payload.query, "acme-docs");
  assert.deepEqual(
    public_.payload.results.map((result) => [result.owner.displayName, result.owner.name, result.name, result.visibility]),
    [["Acme Demo", "acme-demo", "acme-docs", "public"]],
  );
  assert.ok(public_.payload.results[0].description);

  // The private repository exposes no result link to a visitor, whether the
  // query matches its own name or its qualified owner/name form.
  assert.deepEqual((await search(app.baseUrl, "secret-research")).payload.results, []);
  assert.deepEqual((await search(app.baseUrl, "acme-demo/secret-research")).payload.results, []);
  assert.deepEqual((await search(app.baseUrl, "no-such-repository")).payload.results, []);
  assert.deepEqual((await search(app.baseUrl, "visilibity-demo")).payload.results, []);

  // The name match is case-insensitive and the qualified form finds the same entry.
  assert.equal((await search(app.baseUrl, "ACME-DOCS")).payload.results.length, 1);
  assert.equal((await search(app.baseUrl, "acme-demo/acme-docs")).payload.results.length, 1);

  const readable = await request(app.baseUrl, "GET", "/api/repositories");
  assert.equal(readable.status, 200);
  assert.deepEqual(
    readable.payload.repositories.map((repository) => repository.name),
    ["acme-docs", "branch-switch-demo", "default-branch-demo", "file-management-demo"],
  );
});

test("signed-in accounts search exactly the repositories their role allows", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const owner = await signIn(app.baseUrl, "org-owner");
  // An organization Owner is an Admin on every repository of the organization.
  assert.deepEqual(
    (await search(app.baseUrl, "secret-research", owner)).payload.results.map((result) => result.name),
    ["secret-research"],
  );
  assert.deepEqual(
    (await search(app.baseUrl, "visibility-demo", owner)).payload.results.map((result) => result.name),
    ["visibility-demo"],
  );

  // A plain organization member gains nothing from the membership alone.
  const member = await signIn(app.baseUrl, "bob-reviewer");
  assert.deepEqual((await search(app.baseUrl, "secret-research", member)).payload.results, []);
  assert.deepEqual(
    (await search(app.baseUrl, "visibility-demo", member)).payload.results,
    [],
  );
  const memberList = await request(app.baseUrl, "GET", "/api/repositories", { cookies: member });
  assert.deepEqual(
    memberList.payload.repositories.map((repository) => repository.name),
    ["acme-docs", "branch-switch-demo", "default-branch-demo", "file-management-demo"],
  );

  // A direct non-admin grant is enough to read the private repository, so its
  // owner/name metadata is searchable for that collaborator.
  const collaborator = await signIn(app.baseUrl, "collaborator");
  assert.deepEqual(
    (await search(app.baseUrl, "visibility-demo", collaborator)).payload.results.map((result) => [
      result.owner.displayName,
      result.name,
    ]),
    [["Acme Demo", "visibility-demo"]],
  );
  assert.deepEqual((await search(app.baseUrl, "secret-research", collaborator)).payload.results, []);
});

test("only a repository Admin changes the visibility and the change persists", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const collaborator = await signIn(app.baseUrl, "collaborator");
  const opened = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/visibility-demo", {
    cookies: collaborator,
  });
  assert.equal(opened.status, 200, "the collaborator can open the repository");
  assert.equal(opened.payload.repository.visibility, "private");
  assert.equal(opened.payload.viewer.canManage, false);

  const refused = await request(app.baseUrl, "PUT", "/api/organizations/acme-demo/repositories/visibility-demo/visibility", {
    cookies: collaborator,
    body: { visibility: "public" },
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.payload.error, "Access denied");

  // A plain organization member cannot even read the private repository.
  const member = await signIn(app.baseUrl, "org-member");
  assert.equal(
    (await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/visibility-demo", { cookies: member })).status,
    403,
  );
  assert.equal(
    (
      await request(app.baseUrl, "PUT", "/api/organizations/acme-demo/repositories/visibility-demo/visibility", {
        cookies: member,
        body: { visibility: "public" },
      })
    ).status,
    403,
  );

  // The refused attempts changed nothing: the repository is still private.
  assert.equal(
    (await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/visibility-demo")).status,
    403,
  );

  const admin = await signIn(app.baseUrl, "visibility-admin");
  const invalid = await request(app.baseUrl, "PUT", "/api/organizations/acme-demo/repositories/visibility-demo/visibility", {
    cookies: admin,
    body: { visibility: "internal" },
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.payload.error, "Visibility is invalid");

  const changed = await request(app.baseUrl, "PUT", "/api/organizations/acme-demo/repositories/visibility-demo/visibility", {
    cookies: admin,
    body: { visibility: "public" },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.payload.repository.visibility, "public");
  assert.equal(changed.payload.viewer.canManage, true);

  // The unauthenticated visitor can now open the repository and find it.
  const visitor = await request(app.baseUrl, "GET", "/api/organizations/acme-demo/repositories/visibility-demo");
  assert.equal(visitor.status, 200);
  assert.equal(visitor.payload.repository.name, "visibility-demo");
  assert.deepEqual(
    (await search(app.baseUrl, "visibility-demo")).payload.results.map((result) => result.name),
    ["visibility-demo"],
  );

  // The persisted change survives a restart of the same data directory.
  const restarted = await startServer(app.dataDir);
  t.after(() => restarted.close());
  const persisted = await request(restarted.baseUrl, "GET", "/api/organizations/acme-demo/repositories/visibility-demo");
  assert.equal(persisted.status, 200);
  assert.equal(persisted.payload.repository.visibility, "public");
});
