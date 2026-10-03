import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startServer(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallow-repo-")));
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
  return { status: response.status, payload: text ? JSON.parse(text) : null };
}

async function cookieFor(baseUrl, identifier) {
  const response = await fetch(`${baseUrl}/api/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password: "Valid-password-123!" }),
  });
  assert.equal(response.status, 200, `sign-in failed for ${identifier}`);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

test("a signed-in owner creates a private initialized repository atomically", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await cookieFor(app.baseUrl, "repo-owner");

  const before = await request(app.baseUrl, "GET", "/api/repositories", { cookies: cookie });
  const namesBefore = before.payload.repositories.map((repository) => repository.name);

  const created = await request(app.baseUrl, "POST", "/api/repositories", {
    cookies: cookie,
    body: {
      ownerType: "user",
      ownerName: "repo-owner",
      name: "playwright-notes",
      description: "Repository created by Playwright",
      visibility: "private",
      initialize: true,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.owner.type, "user");
  assert.equal(created.payload.owner.name, "repo-owner");
  assert.equal(created.payload.repository.name, "playwright-notes");
  assert.equal(created.payload.repository.visibility, "private");
  assert.equal(created.payload.repository.defaultBranch, "main");

  // The default branch holds the README and exactly the initialization commit.
  const detail = await request(app.baseUrl, "GET", "/api/repositories/repo-owner/playwright-notes", {
    cookies: cookie,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.repository.visibility, "private");
  assert.equal(detail.payload.repository.description, "Repository created by Playwright");
  assert.equal(detail.payload.readme.path, "README.md");
  assert.ok(detail.payload.readme.content.includes("playwright-notes"));
  assert.equal(detail.payload.commits.length, 1);
  assert.equal(detail.payload.commits[0].message, "Initial commit");

  // It joins the owner's repository list without disturbing the existing ones.
  const after = await request(app.baseUrl, "GET", "/api/repositories", { cookies: cookie });
  const namesAfter = after.payload.repositories.map((repository) => repository.name);
  assert.equal(namesAfter.length, namesBefore.length + 1);
  assert.ok(namesAfter.includes("playwright-notes"));

  // The overview survives a restart of the same data directory.
  const restarted = await startServer(app.dataDir);
  t.after(() => restarted.close());
  const persisted = await request(restarted.baseUrl, "GET", "/api/repositories/repo-owner/playwright-notes", {
    cookies: cookie,
  });
  assert.equal(persisted.status, 200);
  assert.equal(persisted.payload.repository.visibility, "private");
  assert.equal(persisted.payload.readme.path, "README.md");
  assert.equal(persisted.payload.commits.length, 1);
});

test("creation without initialization stores no branch, file or commit", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await cookieFor(app.baseUrl, "repo-owner");

  const created = await request(app.baseUrl, "POST", "/api/repositories", {
    cookies: cookie,
    body: {
      ownerType: "user",
      ownerName: "repo-owner",
      name: "empty-repo",
      description: "",
      visibility: "public",
      initialize: false,
    },
  });
  assert.equal(created.status, 201);

  const detail = await request(app.baseUrl, "GET", "/api/repositories/repo-owner/empty-repo");
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.readme, null);
  assert.deepEqual(detail.payload.commits, []);

  // A public personal repository is readable without sign-in and searchable.
  const searched = await request(app.baseUrl, "GET", "/api/search/repositories?q=empty-repo");
  assert.deepEqual(searched.payload.results.map((result) => [result.owner.type, result.owner.name, result.name]), [
    ["user", "repo-owner", "empty-repo"],
  ]);
});

test("duplicate and empty names are refused without creating anything", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await cookieFor(app.baseUrl, "repo-owner");

  const listBefore = await request(app.baseUrl, "GET", "/api/repositories", { cookies: cookie });

  const duplicate = await request(app.baseUrl, "POST", "/api/repositories", {
    cookies: cookie,
    body: { ownerType: "user", ownerName: "repo-owner", name: "acme-docs", visibility: "public" },
  });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.payload.errors.name, "Repository name already exists");

  const empty = await request(app.baseUrl, "POST", "/api/repositories", {
    cookies: cookie,
    body: { ownerType: "user", ownerName: "repo-owner", name: "   ", visibility: "public" },
  });
  assert.equal(empty.status, 422);
  assert.equal(empty.payload.errors.name, "Repository name is required");

  const listAfter = await request(app.baseUrl, "GET", "/api/repositories", { cookies: cookie });
  assert.equal(listAfter.payload.repositories.length, listBefore.payload.repositories.length);
});

test("creation is refused for an anonymous caller and for a foreign namespace", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const anonymous = await request(app.baseUrl, "POST", "/api/repositories", {
    body: { ownerType: "user", ownerName: "repo-owner", name: "anon-repo", visibility: "public" },
  });
  assert.equal(anonymous.status, 401);

  const cookie = await cookieFor(app.baseUrl, "repo-owner");
  const foreign = await request(app.baseUrl, "POST", "/api/repositories", {
    cookies: cookie,
    body: { ownerType: "user", ownerName: "fork-user", name: "stolen", visibility: "public" },
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.payload.error, "Access denied");

  // A plain account cannot create inside an organization it does not own.
  const member = await cookieFor(app.baseUrl, "bob-reviewer");
  const organization = await request(app.baseUrl, "POST", "/api/repositories", {
    cookies: member,
    body: { ownerType: "organization", ownerName: "acme-demo", name: "member-repo", visibility: "public" },
  });
  assert.equal(organization.status, 403);
  assert.equal(organization.payload.error, "Access denied");
});

test("a readable source is forked with its history and source link", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await cookieFor(app.baseUrl, "fork-user");

  const forked = await request(app.baseUrl, "POST", "/api/repositories/acme-demo/acme-docs/fork", {
    cookies: cookie,
    body: { ownerType: "user", ownerName: "fork-user", name: "acme-docs-copy", visibility: "public" },
  });
  assert.equal(forked.status, 201);
  assert.equal(forked.payload.owner.name, "fork-user");
  assert.equal(forked.payload.repository.forkedFrom.name, "acme-docs");
  assert.equal(forked.payload.repository.forkedFrom.owner.name, "acme-demo");

  const detail = await request(app.baseUrl, "GET", "/api/repositories/fork-user/acme-docs-copy", { cookies: cookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.repository.forkedFrom.name, "acme-docs");
  assert.equal(detail.payload.repository.forkedFrom.owner.type, "organization");
  assert.equal(detail.payload.repository.defaultBranch, "main");
  // The accessible default-branch history was copied, including the README.
  const source = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs");
  assert.equal(source.status, 200);
  assert.deepEqual(
    detail.payload.commits.map((commit) => commit.message),
    source.payload.commits.map((commit) => commit.message),
  );
  assert.ok(detail.payload.commits.length >= 2);
  assert.equal(detail.payload.readme.path, "README.md");

  // The source repository keeps its own history and gains no source link.
  assert.equal(source.payload.repository.forkedFrom, null);

  // The fork and its source link survive a restart.
  const restarted = await startServer(app.dataDir);
  t.after(() => restarted.close());
  const persisted = await request(restarted.baseUrl, "GET", "/api/repositories/fork-user/acme-docs-copy");
  assert.equal(persisted.status, 200);
  assert.equal(persisted.payload.repository.forkedFrom.name, "acme-docs");
});

test("fork name conflicts and inaccessible sources are refused", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await cookieFor(app.baseUrl, "fork-user");

  const conflict = await request(app.baseUrl, "POST", "/api/repositories/acme-demo/acme-docs/fork", {
    cookies: cookie,
    body: { ownerType: "user", ownerName: "fork-user", name: "acme-docs-fork", visibility: "public" },
  });
  assert.equal(conflict.status, 422);
  assert.equal(conflict.payload.errors.name, "Repository name already exists");

  const anonymous = await request(app.baseUrl, "POST", "/api/repositories/acme-demo/acme-docs/fork", {
    body: { ownerType: "user", ownerName: "fork-user", name: "anon-fork", visibility: "public" },
  });
  assert.equal(anonymous.status, 401);

  // The private source is unreadable to this account, so no fork is created.
  const private_ = await request(app.baseUrl, "POST", "/api/repositories/acme-demo/secret-research/fork", {
    cookies: cookie,
    body: { ownerType: "user", ownerName: "fork-user", name: "secret-copy", visibility: "private" },
  });
  assert.equal(private_.status, 403);
  assert.equal(private_.payload.error, "Access denied");

  const list = await request(app.baseUrl, "GET", "/api/repositories", { cookies: cookie });
  assert.ok(!list.payload.repositories.some((repository) => repository.name === "secret-copy"));
});

test("a private source repository can only be forked as private", async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const cookie = await cookieFor(app.baseUrl, "collaborator");

  const forked = await request(app.baseUrl, "POST", "/api/repositories/acme-demo/visibility-demo/fork", {
    cookies: cookie,
    body: { ownerType: "user", ownerName: "collaborator", name: "visibility-copy", visibility: "public" },
  });
  assert.equal(forked.status, 201);
  assert.equal(forked.payload.repository.visibility, "private");
});

test("the detail endpoint enforces the read rule and exposes the clone surface", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const anonymous = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs");
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.payload.owner.type, "organization");
  assert.equal(anonymous.payload.owner.name, "acme-demo");
  assert.equal(anonymous.payload.repository.defaultBranch, "main");
  assert.equal(anonymous.payload.readme.path, "README.md");
  assert.ok(anonymous.payload.commits.length >= 1);

  const hidden = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research");
  assert.equal(hidden.status, 403);
  assert.equal(hidden.payload.error, "Access denied");

  const missing = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/no-such-repo");
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error, "Repository not found");
});
