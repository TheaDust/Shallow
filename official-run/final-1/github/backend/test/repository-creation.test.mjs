import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-creation-"));
  return startDataDir(dataDir);
}

/** A second app over the same data directory models a restart. */
async function startDataDir(dataDir) {
  const store = createAuthStore(dataDir);
  const orgStore = createOrgStore(dataDir);
  const handler = createRequestHandler({ store, orgStore, staticRoot: join(dataDir, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function collectCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(baseUrl, method, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, cookie: collectCookie(response) };
}

async function signIn(baseUrl, identifier, password = "Valid-password-123!") {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(result.status, 200);
  return result.cookie;
}

async function readableNames(baseUrl, cookie) {
  const result = await request(baseUrl, "GET", "/api/repositories", undefined, cookie);
  assert.equal(result.status, 200);
  return result.body.repositories.map((repository) => `${repository.owner.id}/${repository.name}`);
}

test("a signed-in user creates an initialized private repository in the personal namespace", async () => {
  const app = await startApp();
  try {
    const anonymous = await request(app.baseUrl, "POST", "/api/repositories", {
      ownerType: "account",
      ownerId: "repo-owner",
      name: "notes-repo",
      visibility: "private",
    });
    assert.equal(anonymous.status, 401);

    const cookie = await signIn(app.baseUrl, "repo-owner");
    const empty = await request(app.baseUrl, "POST", "/api/repositories", {
      ownerType: "account",
      ownerId: "account-repo-owner",
      name: "",
      visibility: "private",
    }, cookie);
    assert.equal(empty.status, 400);
    assert.equal(empty.body.fieldErrors.name, "Repository name is required");

    const conflict = await request(app.baseUrl, "POST", "/api/repositories", {
      ownerType: "account",
      ownerId: "account-repo-owner",
      name: "acme-docs",
      visibility: "private",
    }, cookie);
    assert.equal(conflict.status, 400);
    assert.equal(conflict.body.fieldErrors.name, "Repository name already exists");

    const created = await request(app.baseUrl, "POST", "/api/repositories", {
      ownerType: "account",
      ownerId: "account-repo-owner",
      name: "notes-repo",
      description: "Repository created by Playwright",
      visibility: "private",
      initialize: true,
    }, cookie);
    assert.equal(created.status, 201);
    const repository = created.body.repository;
    assert.equal(repository.name, "notes-repo");
    assert.equal(repository.visibility, "private");
    assert.equal(repository.owner.id, "repo-owner");
    assert.equal(repository.description, "Repository created by Playwright");
    assert.equal(repository.defaultBranch, "main");
    assert.equal(repository.commitCount, 1);
    assert.equal(repository.readmePath, "README.md");
    assert.equal(repository.fork, null);

    // The default branch really contains the README and one initialization commit.
    const base = `/api/repositories/repo-owner/notes-repo`;
    const tree = await request(app.baseUrl, "GET", `${base}/tree`, undefined, cookie);
    assert.equal(tree.status, 200);
    assert.deepEqual(tree.body.entries.map((entry) => [entry.name, entry.type]), [["README.md", "file"]]);
    const blob = await request(app.baseUrl, "GET", `${base}/blob?path=README.md`, undefined, cookie);
    assert.equal(blob.status, 200);
    assert.equal(blob.body.file.name, "README.md");
    const commits = await request(app.baseUrl, "GET", `${base}/commits`, undefined, cookie);
    assert.equal(commits.status, 200);
    assert.equal(commits.body.commits.length, 1);
    assert.equal(commits.body.commits[0].message, "Initial commit");
    assert.equal(commits.body.commits[0].authorName, "repo-owner");

    // It shows up in that owner's repository list and survives a restart.
    assert.ok((await readableNames(app.baseUrl, cookie)).includes("repo-owner/notes-repo"));

    const restarted = await startDataDir(app.dataDir);
    try {
      const restartCookie = await signIn(restarted.baseUrl, "repo-owner");
      const persisted = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/repo-owner/notes-repo",
        undefined,
        restartCookie,
      );
      assert.equal(persisted.status, 200);
      assert.equal(persisted.body.repository.visibility, "private");
      assert.equal(persisted.body.repository.commitCount, 1);
      const reloadedBlob = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/repo-owner/notes-repo/blob?path=README.md",
        undefined,
        restartCookie,
      );
      assert.equal(reloadedBlob.status, 200);
      assert.match(reloadedBlob.body.file.content, /notes-repo/);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("repository creation is namespace-scoped: an organization needs Owner permission", async () => {
  const app = await startApp();
  try {
    const member = await signIn(app.baseUrl, "org-member");
    const denied = await request(app.baseUrl, "POST", "/api/repositories", {
      ownerType: "organization",
      ownerId: "acme-demo",
      name: "member-repo",
      visibility: "public",
      initialize: true,
    }, member);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");
    assert.deepEqual(await readableNames(app.baseUrl, member), [
      "acme-demo/acme-docs",
      "acme-demo/branch-switch-demo",
      "acme-demo/default-branch-demo",
      "acme-demo/branch-protection-demo",
      "acme-demo/file-management-demo",
      "acme-demo/evo-branch-switch-s1",
      "acme-demo/evo-branch-switch-s2",
      "acme-demo/evo-branch-switch-s3",
      "acme-demo/evo-release-repository-s1",
      "acme-demo/evo-release-repository-s2",
      "acme-demo/evo-release-repository-s3",
      "acme-demo/evo-search-catalog-s1",
      "acme-demo/evo-search-notebook-s2",
      "acme-demo/evo-archive-repository-s2",
      "acme-demo/evo-reaction-repository-s1",
    ]);

    const owner = await signIn(app.baseUrl, "org-owner");
    const created = await request(app.baseUrl, "POST", "/api/repositories", {
      ownerType: "organization",
      ownerId: "acme-demo",
      name: "org-notes",
      visibility: "public",
      initialize: true,
    }, owner);
    assert.equal(created.status, 201);
    assert.equal(created.body.repository.owner.displayName, "Acme Demo");
    // Public now, so a visitor can also open it.
    const visitor = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/org-notes");
    assert.equal(visitor.status, 200);

    // An unknown namespace is reported as an invalid owner, with no record written.
    const unknown = await request(app.baseUrl, "POST", "/api/repositories", {
      ownerType: "organization",
      ownerId: "no-such-org",
      name: "ghost",
      visibility: "public",
    }, owner);
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fieldErrors.owner, "Owner is invalid");
    assert.equal((await request(app.baseUrl, "GET", "/api/repositories/no-such-org/ghost")).status, 404);
  } finally {
    await app.close();
  }
});

test("a readable public repository can be forked with its default-branch history", async () => {
  const app = await startApp();
  try {
    const visitor = await request(app.baseUrl, "POST", "/api/repositories/acme-demo/acme-docs/fork", {
      ownerType: "account",
      ownerId: "account-fork-user",
      name: "my-fork",
    });
    assert.equal(visitor.status, 401);

    const cookie = await signIn(app.baseUrl, "fork-user");

    // The private source is not readable, so no fork is created.
    const inaccessible = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/secret-research/fork",
      { ownerType: "account", ownerId: "account-fork-user", name: "secret-fork" },
      cookie,
    );
    assert.equal(inaccessible.status, 403);
    assert.equal(inaccessible.body.message, "Access denied");

    const conflict = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/fork",
      { ownerType: "account", ownerId: "account-fork-user", name: "acme-docs-fork" },
      cookie,
    );
    assert.equal(conflict.status, 400);
    assert.equal(conflict.body.fieldErrors.name, "Repository name already exists");

    const forked = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/fork",
      { ownerType: "account", ownerId: "account-fork-user", name: "my-fork", visibility: "private" },
      cookie,
    );
    assert.equal(forked.status, 201);
    const fork = forked.body.repository;
    assert.equal(fork.name, "my-fork");
    assert.equal(fork.owner.id, "fork-user");
    assert.equal(fork.visibility, "private");
    assert.equal(fork.defaultBranch, "main");
    assert.equal(fork.commitCount, 2);
    assert.equal(fork.fork.name, "acme-docs");
    assert.equal(fork.fork.owner.id, "acme-demo");

    // The fork carries the source's accessible default-branch files.
    const blob = await request(app.baseUrl, "GET", "/api/repositories/fork-user/my-fork/blob?path=src/README.md", undefined, cookie);
    assert.equal(blob.status, 200);
    assert.equal(blob.body.file.content, "Document search flow");
    const tree = await request(app.baseUrl, "GET", "/api/repositories/fork-user/my-fork/tree", undefined, cookie);
    assert.deepEqual(tree.body.entries.map((entry) => entry.name), ["src", "README.md"]);

    // The source is untouched and the fork shows up in the target namespace list.
    const source = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/blob?path=src/README.md");
    assert.equal(source.body.file.content, "Document search flow");
    assert.ok((await readableNames(app.baseUrl, cookie)).includes("fork-user/my-fork"));

    const restarted = await startDataDir(app.dataDir);
    try {
      const restartCookie = await signIn(restarted.baseUrl, "fork-user");
      const reloaded = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/fork-user/my-fork",
        undefined,
        restartCookie,
      );
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.repository.fork.name, "acme-docs");
      assert.equal(reloaded.body.repository.commitCount, 2);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a private source fork can never become public and failed forks write nothing", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.baseUrl, "org-owner");
    const created = await request(app.baseUrl, "POST", "/api/repositories", {
      ownerType: "organization",
      ownerId: "acme-demo",
      name: "internals",
      visibility: "private",
      initialize: true,
    }, owner);
    assert.equal(created.status, 201);

    const before = JSON.parse(await readFile(join(app.dataDir, "organizations.json"), "utf8"));
    const fork = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/internals/fork",
      { ownerType: "account", ownerId: "account-org-owner", name: "internals-fork", visibility: "public" },
      owner,
    );
    assert.equal(fork.status, 201);
    assert.equal(fork.body.repository.visibility, "private");

    // A rejected fork (duplicate name in the target namespace) adds no record.
    const duplicate = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/internals/fork",
      { ownerType: "account", ownerId: "account-org-owner", name: "internals-fork" },
      owner,
    );
    assert.equal(duplicate.status, 400);
    const after = JSON.parse(await readFile(join(app.dataDir, "organizations.json"), "utf8"));
    assert.equal(after.repositories.length, before.repositories.length + 1);
    assert.equal(after.branches.length, before.branches.length + 1);
    assert.equal(after.commits.length, before.commits.length + 1);
  } finally {
    await app.close();
  }
});

test("code views stay behind the shared repository read rule", async () => {
  const app = await startApp();
  try {
    const tree = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/tree");
    assert.equal(tree.status, 200);
    assert.deepEqual(tree.body.entries.map((entry) => entry.name), ["src", "README.md"]);

    const denied = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research/tree");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");

    const missing = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/blob?path=nope.md");
    assert.equal(missing.status, 404);

    const deniedCommit = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research/commit/commit-repo-secret-research-1");
    assert.equal(deniedCommit.status, 403);
    const deniedSearch = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research/code-search?q=notes");
    assert.equal(deniedSearch.status, 403);
  } finally {
    await app.close();
  }
});
