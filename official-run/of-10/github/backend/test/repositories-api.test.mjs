import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(dataDir) {
  const handler = createApp({ dataDir, staticRoot: join(dataDir, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function newDataDir() {
  return mkdtemp(join(tmpdir(), "shallowcode-repositories-"));
}

function jsonRequest(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signInAsAlice(baseUrl) {
  const response = await jsonRequest(baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier: "alice-dev", password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie");
  assert.ok(header, "expected a session cookie");
  return header.split(";")[0];
}

test("anonymous search returns only repositories the visitor may read", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const publicSearch = await jsonRequest(app.baseUrl, "/api/search?q=acme-docs&type=repositories");
  assert.equal(publicSearch.status, 200);
  const publicBody = await publicSearch.json();
  assert.equal(publicBody.query, "acme-docs");
  assert.equal(publicBody.type, "repositories");
  // Two namespaces declare the same repository name: the personal `alice-dev`
  // record of REQ-3 and the organization record of REQ-2. Both are public, so
  // the visitor reads both and still nothing private.
  assert.deepEqual(
    publicBody.repositories.map((repository) => [repository.fullName, repository.ownerDisplayName]),
    [
      ["alice-dev/acme-docs", "alice-dev"],
      ["acme-demo/acme-docs", "Acme Demo"],
    ],
  );
  const organizationOverview = await jsonRequest(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-docs",
  );
  assert.equal(organizationOverview.status, 200);
  // The repository heading of an organization reads
  // "organization name/repository name": the display name, not the identifier.
  assert.equal(
    (await organizationOverview.json()).repository.ownerDisplayName,
    "Acme Demo",
  );
  const [result] = publicBody.repositories;
  assert.equal(result.name, "acme-docs");
  assert.equal(result.fullName, "alice-dev/acme-docs");
  assert.deepEqual(result.owner, { type: "user", login: "alice-dev" });
  assert.equal(result.visibility, "public");
  assert.match(result.description, /Acme/);
  assert.equal(result.defaultBranch, "main");
  assert.ok(result.updatedAt);

  // A partial name and a shared keyword still find the repositories.
  for (const query of ["acme", "docs"]) {
    const partial = await jsonRequest(
      app.baseUrl,
      `/api/search?q=${encodeURIComponent(query)}&type=repositories`,
    );
    assert.deepEqual(
      (await partial.json()).repositories.map((repository) => repository.name),
      ["acme-docs", "acme-docs"],
    );
  }

  // The private repository name yields no result link for a visitor.
  const privateSearch = await jsonRequest(
    app.baseUrl,
    "/api/search?q=secret-research&type=repositories",
  );
  assert.deepEqual((await privateSearch.json()).repositories, []);

  // Searching the keyword the visitor is not authorized to see exposes nothing either.
  const sharedKeyword = await jsonRequest(app.baseUrl, "/api/search?q=research&type=repositories");
  assert.deepEqual((await sharedKeyword.json()).repositories, []);
});

test("search without a query and with another type returns no repositories", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const empty = await jsonRequest(app.baseUrl, "/api/search?type=repositories");
  assert.deepEqual((await empty.json()).repositories, []);

  const otherType = await jsonRequest(app.baseUrl, "/api/search?q=acme-docs&type=code");
  const body = await otherType.json();
  assert.equal(body.type, "code");
  assert.deepEqual(body.repositories, []);
});

test("a public repository overview and its file are readable without sign-in", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const overview = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs");
  assert.equal(overview.status, 200);
  const { repository } = await overview.json();
  assert.equal(repository.fullName, "alice-dev/acme-docs");
  assert.equal(repository.visibility, "public");
  assert.equal(repository.branch, "main");
  assert.match(repository.description, /Acme/);
  // The default branch holds root files, a nested directory and the text file
  // inside it; directories sort before files.
  assert.deepEqual(
    repository.entries.map((entry) => [entry.type, entry.name]),
    [
      ["dir", "docs"],
      ["dir", "src"],
      ["file", "README.md"],
    ],
  );

  const file = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/acme-docs/file?branch=main&path=README.md",
  );
  assert.equal(file.status, 200);
  const payload = await file.json();
  assert.equal(payload.repository.fullName, "alice-dev/acme-docs");
  assert.equal(payload.file.name, "README.md");
  assert.equal(payload.file.branch, "main");
  assert.match(payload.file.content, /acme-docs/);
  assert.equal(payload.file.commit.message, "Document search flow");

  for (const path of [
    "/api/repositories/alice-dev/acme-docs/file?branch=main&path=missing.md",
    "/api/repositories/alice-dev/acme-docs/file?branch=nope&path=README.md",
  ]) {
    const missing = await jsonRequest(app.baseUrl, path);
    assert.equal(missing.status, 404);
  }
});

test("a private repository stays invisible and unreadable for visitors", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const overview = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research");
  assert.equal(overview.status, 404);
  assert.deepEqual(await overview.json(), { error: "Not found" });

  const file = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/secret-research/file?path=README.md",
  );
  assert.equal(file.status, 404);

  // The denial never leaks the private repository name and the process keeps serving.
  const health = await jsonRequest(app.baseUrl, "/health");
  assert.equal(health.status, 200);
});

test("the owner sees the private repository in search and in the overview", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const cookie = await signInAsAlice(app.baseUrl);

  const search = await jsonRequest(app.baseUrl, "/api/search?q=secret-research&type=repositories", {
    cookie,
  });
  const body = await search.json();
  assert.deepEqual(
    body.repositories.map((repository) => [repository.name, repository.visibility]),
    [["secret-research", "private"]],
  );

  const overview = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research", {
    cookie,
  });
  assert.equal(overview.status, 200);
  const { repository } = await overview.json();
  assert.equal(repository.fullName, "alice-dev/secret-research");
  assert.equal(repository.visibility, "private");
  assert.ok(repository.entries.some((entry) => entry.name === "README.md"));

  // A signed-in visitor who is not the owner gets an explicit denial; an
  // anonymous viewer keeps the plain `Not found` answer.
  const otherCookie = await (async () => {
    const registration = await jsonRequest(app.baseUrl, "/api/accounts", {
      method: "POST",
      body: {
        username: "outsider-user",
        email: "outsider-user@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        termsAccepted: true,
      },
    });
    assert.equal(registration.status, 201);
    const signIn = await jsonRequest(app.baseUrl, "/api/sessions", {
      method: "POST",
      body: { identifier: "outsider-user", password: "Valid-password-123!" },
    });
    return signIn.headers.get("set-cookie").split(";")[0];
  })();
  const denied = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research", {
    cookie: otherCookie,
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "Access denied");
});

test("repository access survives a restart on the same data directory", async (t) => {
  const dataDir = await newDataDir();
  const first = await startApp(dataDir);
  await first.close();

  const second = await startApp(dataDir);
  t.after(() => second.close());
  const overview = await jsonRequest(second.baseUrl, "/api/repositories/alice-dev/acme-docs");
  assert.equal(overview.status, 200);
  const { repository } = await overview.json();
  assert.equal(repository.fullName, "alice-dev/acme-docs");

  const search = await jsonRequest(second.baseUrl, "/api/search?q=acme-docs&type=repositories");
  assert.deepEqual(
    (await search.json()).repositories.map((repository) => repository.fullName),
    ["alice-dev/acme-docs", "acme-demo/acme-docs"],
  );
});
