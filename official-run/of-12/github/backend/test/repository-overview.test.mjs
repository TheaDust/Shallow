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
  dataDir = await mkdtemp(join(tmpdir(), "shallow-overview-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");

describe("REQ-3-3 repository overview read model", () => {
  it("serves the seeded public repository to a visitor without a session", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(response.status, 200);
    const repository = response.body.repository;
    assert.equal(repository.owner, "alice-dev");
    assert.equal(repository.ownerDisplayName, "alice-dev");
    assert.equal(repository.fullName, "alice-dev/acme-docs");
    assert.equal(repository.visibility, "public");
    assert.equal(repository.description, "Documentation for the Acme Demo platform");
    assert.equal(repository.defaultBranch, "main");
    assert.deepEqual(
      repository.files.map((file) => file.path).sort(),
      ["CONTRIBUTING.md", "README.md", "docs/intro.md", "src/search.ts"],
    );
    assert.deepEqual(
      repository.entries.map((entry) => `${entry.type}:${entry.path}`),
      ["directory:docs", "directory:src", "file:CONTRIBUTING.md", "file:README.md"],
    );
    assert.equal(repository.cloneUrls.https, "https://github.local/alice-dev/acme-docs.git");
    assert.equal(repository.cloneUrls.ssh, "git@github.local:alice-dev/acme-docs.git");
  });

  it("keeps the same repository state after reopening the stored document", async () => {
    const reopened = await startApp(dataDir);
    try {
      const response = await reopened.request("/api/repositories/alice-dev/acme-docs");
      assert.equal(response.status, 200);
      assert.equal(response.body.repository.fullName, "alice-dev/acme-docs");
      assert.equal(response.body.repository.visibility, "public");
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("never shows a private personal repository to an unauthorized caller", async () => {
    const visitor = await app.request("/api/repositories/alice-dev/secret-research");
    assert.equal(visitor.status, 403);
    assert.equal(visitor.body.error, "Access denied");

    // Its owner and an explicitly authorized subject do reach it.
    assert.equal((await app.request("/api/repositories/alice-dev/secret-research", { cookie: await aliceCookie() })).status, 200);
    const bob = await bobCookie();
    const authorized = await app.request("/api/repositories/alice-dev/secret-research", { cookie: bob });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.body.repository.visibility, "private");

    // An unknown namespace or repository is not found, whichever the owner.
    assert.equal((await app.request("/api/repositories/alice-dev/unknown")).status, 404);
    assert.equal((await app.request("/api/repositories/nobody/acme-docs")).status, 404);
  });

  it("serves the stored default-branch content and directory entries", async () => {
    const file = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=README.md");
    assert.equal(file.status, 200);
    assert.equal(file.body.file.path, "README.md");
    assert.match(file.body.file.content, /Acme Docs/);
    assert.equal(file.body.branch, "main");

    const root = await app.request("/api/repositories/alice-dev/acme-docs/contents");
    assert.equal(root.status, 200);
    assert.deepEqual(
      root.body.entries.map((entry) => `${entry.type}:${entry.path}`),
      ["directory:docs", "directory:src", "file:CONTRIBUTING.md", "file:README.md"],
    );

    const directory = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=docs");
    assert.equal(directory.status, 200);
    assert.deepEqual(directory.body.entries.map((entry) => entry.path), ["docs/intro.md"]);

    const missing = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=missing.md");
    assert.equal(missing.status, 404);

    const denied = await app.request("/api/repositories/alice-dev/secret-research/contents?path=README.md");
    assert.equal(denied.status, 403);
  });
});

describe("REQ-3-1 repository search and namespace lists", () => {
  it("returns matching repositories and hides the private one from a visitor", async () => {
    const response = await app.request("/api/search/repositories?q=acme-docs");
    assert.equal(response.status, 200);
    assert.equal(response.body.query, "acme-docs");
    assert.deepEqual(response.body.repositories.map((repository) => repository.fullName), ["alice-dev/acme-docs"]);

    const privateQuery = await app.request("/api/search/repositories?q=secret-research");
    assert.deepEqual(privateQuery.body.repositories, []);

    const noResults = await app.request("/api/search/repositories?q=does-not-exist");
    assert.deepEqual(noResults.body.repositories, []);

    const cleared = await app.request("/api/search/repositories?q=");
    assert.deepEqual(cleared.body.repositories, []);
  });

  it("lets the owner search the repositories the visitor cannot see", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/search/repositories?q=secret-research", { cookie });
    assert.deepEqual(response.body.repositories.map((repository) => repository.name), ["secret-research"]);
  });

  it("lists the repositories of an organization or an account namespace", async () => {
    const organization = await app.request("/api/namespaces/acme-demo");
    assert.equal(organization.status, 200);
    assert.equal(organization.body.namespace.type, "organization");
    assert.deepEqual(organization.body.repositories.map((repository) => repository.name), ["acme-web"]);

    const account = await app.request("/api/namespaces/alice-dev");
    assert.equal(account.status, 200);
    assert.equal(account.body.namespace.type, "account");
    assert.deepEqual(account.body.repositories.map((repository) => repository.name), ["acme-docs", "merge-lab"]);

    const owner = await app.request("/api/namespaces/alice-dev", { cookie: await aliceCookie() });
    // The private fork conflict seed (REQ-3-2-2) belongs to the same namespace
    // and is only listed to its owner.
    assert.deepEqual(
      owner.body.repositories.map((repository) => repository.name),
      ["acme-docs", "acme-docs-fork", "merge-lab", "secret-research"],
    );


    assert.equal((await app.request("/api/namespaces/unknown-namespace")).status, 404);
  });
});

describe("REQ-3 repository list read model", () => {
  it("lists only the repositories the caller may read", async () => {
    const visitor = await app.request("/api/repositories");
    assert.equal(visitor.status, 200);
    assert.deepEqual(
      visitor.body.repositories.map((repository) => repository.fullName),
      ["Acme Demo/acme-web", "alice-dev/acme-docs", "alice-dev/merge-lab"],
    );

    const alice = await app.request("/api/repositories", { cookie: await aliceCookie() });
    const aliceNames = alice.body.repositories.map((repository) => repository.fullName);
    assert.ok(aliceNames.includes("alice-dev/secret-research"));
    assert.ok(aliceNames.includes("alice-dev/acme-docs-fork"));

    // The non-Admin collaborator sees the repository of the Write grant but
    // not the owner's private fork.
    const bob = await app.request("/api/repositories", { cookie: await bobCookie() });
    const bobNames = bob.body.repositories.map((repository) => repository.fullName);
    assert.ok(bobNames.includes("alice-dev/secret-research"));
    assert.ok(bobNames.includes("Acme Demo/acme-web"));
    assert.ok(!bobNames.includes("alice-dev/acme-docs-fork"));

    const listed = bob.body.repositories.find((repository) => repository.fullName === "alice-dev/acme-docs");
    assert.equal(listed.owner, "alice-dev");
    assert.equal(listed.visibility, "public");
    assert.equal(listed.defaultBranch, "main");
  });

  it("reflects a visibility change in the list of every caller", async () => {
    const cookie = await aliceCookie();
    const changed = await app.request("/api/repositories/alice-dev/secret-research/visibility", {
      method: "POST",
      cookie,
      body: { visibility: "public" },
    });
    assert.equal(changed.status, 200);

    const visitor = await app.request("/api/repositories");
    assert.ok(
      visitor.body.repositories.some((repository) => repository.fullName === "alice-dev/secret-research"),
    );

    const restored = await app.request("/api/repositories/alice-dev/secret-research/visibility", {
      method: "POST",
      cookie,
      body: { visibility: "private" },
    });
    assert.equal(restored.status, 200);
    const hidden = await app.request("/api/repositories");
    assert.ok(!hidden.body.repositories.some((repository) => repository.fullName === "alice-dev/secret-research"));
  });
});
