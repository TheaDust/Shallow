import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
        async register(username) {
          await this.request("/api/accounts", {
            method: "POST",
            body: {
              username,
              email: `${username}@example.test`,
              password: "Valid-password-123!",
              confirmPassword: "Valid-password-123!",
              agreeToTerms: true,
            },
          });
          return this.signIn(username, "Valid-password-123!");
        },
      });
    });
  });
}

/** The stored document, read from disk so a rejected write is visible as such. */
async function storedDocument() {
  return JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-creation-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");

describe("REQ-3-2-1 create a repository with owner, visibility and initialization", () => {
  it("requires a session", async () => {
    const response = await app.request("/api/repositories", {
      method: "POST",
      body: { name: "anonymous-repository" },
    });
    assert.equal(response.status, 401);
  });

  it("creates an initialized private repository in the default personal namespace", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/repositories", {
      method: "POST",
      cookie,
      body: {
        owner: "",
        name: "playwright-notes",
        description: "Repository created by Playwright",
        visibility: "private",
        initialize: true,
      },
    });
    assert.equal(response.status, 201);
    const repository = response.body.repository;
    assert.equal(repository.name, "playwright-notes");
    assert.equal(repository.owner, "alice-dev");
    assert.equal(repository.ownerType, "account");
    assert.equal(repository.fullName, "alice-dev/playwright-notes");
    assert.equal(repository.visibility, "private");
    assert.equal(repository.defaultBranch, "main");
    assert.equal(repository.description, "Repository created by Playwright");
    assert.equal(repository.viewerRole, "Admin");
    assert.deepEqual(repository.entries.map((entry) => entry.path), ["README.md"]);

    // The default branch holds the README file and the initial commit, and the
    // repository appears in the owner's repository list.
    const readme = await app.request("/api/repositories/alice-dev/playwright-notes/contents?path=README.md", { cookie });
    assert.equal(readme.status, 200);
    assert.match(readme.body.file.content, /playwright-notes/);

    const commits = await app.request("/api/repositories/alice-dev/playwright-notes/commits", { cookie });
    assert.equal(commits.status, 200);
    assert.equal(commits.body.branch, "main");
    assert.equal(commits.body.commits.length, 1);
    assert.equal(commits.body.commits[0].message, "Initial commit");
    assert.equal(commits.body.commits[0].author, "alice-dev");

    const namespace = await app.request("/api/namespaces/alice-dev", { cookie });
    assert.ok(namespace.body.repositories.some((entry) => entry.name === "playwright-notes"));

    // A visitor cannot read the private repository.
    assert.equal((await app.request("/api/repositories/alice-dev/playwright-notes")).status, 403);
  });

  it("keeps the created repository after the store is reopened", async () => {
    const reopened = await startApp(dataDir);
    try {
      const response = await reopened.request("/api/repositories/alice-dev/playwright-notes", {
        cookie: await reopened.signIn("alice-dev", "Valid-password-123!"),
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.repository.visibility, "private");
      assert.equal(response.body.repository.description, "Repository created by Playwright");
      assert.deepEqual(response.body.repository.entries.map((entry) => entry.path), ["README.md"]);
      assert.equal(
        (await reopened.request("/api/repositories/alice-dev/playwright-notes/commits")).status,
        403,
      );
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("creates an empty repository when initialization is not selected", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/repositories", {
      method: "POST",
      cookie,
      body: { owner: "alice-dev", name: "empty-repository", visibility: "public", initialize: false },
    });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.repository.entries, []);
    const commits = await app.request("/api/repositories/alice-dev/empty-repository/commits");
    assert.equal(commits.status, 200);
    assert.deepEqual(commits.body.commits, []);
  });

  it("rejects an empty and a duplicated name without creating a repository", async () => {
    const cookie = await aliceCookie();
    const before = await storedDocument();

    const empty = await app.request("/api/repositories", {
      method: "POST",
      cookie,
      body: { owner: "alice-dev", name: "   ", visibility: "public", initialize: false },
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.fields.name, "Repository name is required");

    const duplicate = await app.request("/api/repositories", {
      method: "POST",
      cookie,
      body: { owner: "alice-dev", name: "acme-docs", visibility: "private", initialize: true },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fields.name, "Repository name already exists");

    const afterFailure = await storedDocument();
    assert.equal(afterFailure.repositories.length, before.repositories.length);
    // The existing repository keeps its own state (including the `src/search.ts`
    // file the REQ-4-2 seed stores on the default branch).
    const existing = await app.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(existing.body.repository.description, "Documentation for the Acme Demo platform");
    assert.deepEqual(
      existing.body.repository.files.map((file) => file.path).sort(),
      ["CONTRIBUTING.md", "README.md", "docs/intro.md", "src/search.ts"],
    );
  });

  it("creates an organization repository only for an organization Owner", async () => {
    const member = await bobCookie();
    const before = await storedDocument();
    const denied = await app.request("/api/repositories", {
      method: "POST",
      cookie: member,
      body: { owner: "acme-demo", name: "member-repository", visibility: "public", initialize: false },
    });
    assert.equal(denied.status, 400);
    assert.match(denied.body.fields.owner, /permission/);
    assert.equal((await storedDocument()).repositories.length, before.repositories.length);

    const owner = await aliceCookie();
    const created = await app.request("/api/repositories", {
      method: "POST",
      cookie: owner,
      body: { owner: "acme-demo", name: "org-repository", visibility: "public", initialize: true },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.repository.owner, "acme-demo");
    assert.equal(created.body.repository.ownerType, "organization");
    assert.equal(created.body.repository.fullName, "Acme Demo/org-repository");

    const visitor = await app.request("/api/organizations/acme-demo");
    assert.ok(visitor.body.repositories.some((entry) => entry.name === "org-repository"));
  });
});

describe("REQ-3-2-2 fork a repository into another namespace", () => {
  it("copies a readable public source into the personal namespace", async () => {
    const before = await storedDocument();
    const source = before.repositories.find((repository) => repository.name === "acme-docs");

    const cookie = await bobCookie();
    const response = await app.request("/api/repositories/alice-dev/acme-docs/forks", {
      method: "POST",
      cookie,
      body: { owner: "bob-reviewer", name: "", visibility: "public" },
    });
    assert.equal(response.status, 201);
    const fork = response.body.repository;
    assert.equal(fork.fullName, "bob-reviewer/acme-docs");
    assert.equal(fork.visibility, "public");
    assert.equal(fork.defaultBranch, "main");
    assert.deepEqual(fork.forkedFrom, { owner: "alice-dev", name: "acme-docs", fullName: "alice-dev/acme-docs" });
    assert.deepEqual(
      fork.entries.map((entry) => `${entry.type}:${entry.path}`),
      ["directory:docs", "directory:src", "file:CONTRIBUTING.md", "file:README.md"],
    );

    const copied = await app.request("/api/repositories/bob-reviewer/acme-docs/contents?path=README.md");
    assert.equal(copied.status, 200);
    assert.match(copied.body.file.content, /Acme Docs/);

    // The source repository is untouched by the fork.
    const afterFork = await storedDocument();
    const sourceAfter = afterFork.repositories.find((repository) => repository.name === "acme-docs");
    assert.deepEqual(sourceAfter.files, source.files);
    assert.deepEqual(sourceAfter.grants, source.grants);
    assert.equal(sourceAfter.visibility, "public");
  });

  it("keeps the fork and its source link after reopening the store", async () => {
    const reopened = await startApp(dataDir);
    try {
      const response = await reopened.request("/api/repositories/bob-reviewer/acme-docs");
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.repository.forkedFrom, {
        owner: "alice-dev",
        name: "acme-docs",
        fullName: "alice-dev/acme-docs",
      });
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("rejects an existing fork name in the target namespace without creating a repository", async () => {
    const cookie = await aliceCookie();
    const before = await storedDocument();
    const response = await app.request("/api/repositories/alice-dev/acme-docs/forks", {
      method: "POST",
      cookie,
      body: { owner: "alice-dev", name: "acme-docs-fork", visibility: "private" },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.fields.name, "Repository name already exists");
    assert.equal((await storedDocument()).repositories.length, before.repositories.length);
  });

  it("forks a private source only as a private repository", async () => {
    const cookie = await bobCookie();
    const response = await app.request("/api/repositories/alice-dev/secret-research/forks", {
      method: "POST",
      cookie,
      body: { owner: "bob-reviewer", name: "secret-research", visibility: "public" },
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.repository.visibility, "private");
    assert.equal((await app.request("/api/repositories/bob-reviewer/secret-research")).status, 403);
  });

  it("refuses a source the account cannot read and a namespace it cannot create in", async () => {
    const outsider = await app.register("fork-outsider");
    assert.ok(outsider, "the outsider account could sign in");
    const before = await storedDocument();

    const unreadable = await app.request("/api/repositories/alice-dev/secret-research/forks", {
      method: "POST",
      cookie: outsider,
      body: { owner: "fork-outsider", name: "secret-research-fork", visibility: "private" },
    });
    assert.equal(unreadable.status, 403);
    assert.equal((await storedDocument()).repositories.length, before.repositories.length);

    const member = await bobCookie();
    const forbidden = await app.request("/api/repositories/alice-dev/acme-docs/forks", {
      method: "POST",
      cookie: member,
      body: { owner: "acme-demo", name: "org-fork", visibility: "public" },
    });
    assert.equal(forbidden.status, 400);
    assert.match(forbidden.body.fields.owner, /permission/);

    const anonymous = await app.request("/api/repositories/alice-dev/acme-docs/forks", {
      method: "POST",
      body: { owner: "bob-reviewer", name: "anonymous-fork" },
    });
    assert.equal(anonymous.status, 401);
  });
});

describe("REQ-3-4 change repository visibility with permission checks", () => {
  it("lets an Admin publish a private repository for visitors", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/repositories/alice-dev/secret-research/visibility", {
      method: "POST",
      cookie,
      body: { visibility: "public" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.repository.visibility, "public");

    const visitor = await app.request("/api/repositories/alice-dev/secret-research");
    assert.equal(visitor.status, 200);
    assert.equal(visitor.body.repository.visibility, "public");
    const search = await app.request("/api/search/repositories?q=secret-research");
    assert.deepEqual(search.body.repositories.map((entry) => entry.name), ["secret-research"]);
  });

  it("refuses a non-Admin collaborator and leaves the visibility unchanged", async () => {
    const cookie = await bobCookie();
    const response = await app.request("/api/repositories/alice-dev/acme-docs-fork/visibility", {
      method: "POST",
      cookie,
      body: { visibility: "public" },
    });
    assert.equal(response.status, 403);

    const document = await storedDocument();
    const repository = document.repositories.find((entry) => entry.name === "acme-docs-fork");
    assert.equal(repository.visibility, "private");
  });

  it("requires a matching confirmation text when one is typed", async () => {
    const cookie = await aliceCookie();
    const mismatched = await app.request("/api/repositories/alice-dev/acme-docs-fork/visibility", {
      method: "POST",
      cookie,
      body: { visibility: "public", confirmation: "not-the-name" },
    });
    assert.equal(mismatched.status, 400);
    assert.ok(mismatched.body.fields.confirmation);
    assert.equal(
      (await storedDocument()).repositories.find((entry) => entry.name === "acme-docs-fork").visibility,
      "private",
    );

    const confirmed = await app.request("/api/repositories/alice-dev/acme-docs-fork/visibility", {
      method: "POST",
      cookie,
      body: { visibility: "public", confirmation: "alice-dev/acme-docs-fork" },
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.repository.visibility, "public");
  });

  it("keeps the changed visibility after reopening the store", async () => {
    const reopened = await startApp(dataDir);
    try {
      const response = await reopened.request("/api/repositories/alice-dev/acme-docs-fork");
      assert.equal(response.status, 200);
      assert.equal(response.body.repository.visibility, "public");
      const visitor = await reopened.request("/api/repositories/alice-dev/secret-research");
      assert.equal(visitor.status, 200);
      assert.equal(visitor.body.repository.visibility, "public");
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });
});
