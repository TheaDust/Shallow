import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore, createSeedData } from "../src/domain/store.mjs";

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
        store,
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
  dataDir = await mkdtemp(join(tmpdir(), "shallow-code-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");
/** The seeded account that holds no role on any repository. */
const outsiderCookie = () => app.signIn("dana-observer", "Valid-password-123!");

async function storedRepository(name = "acme-docs") {
  let document;
  try {
    document = JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
  } catch (error) {
    // The seed is written on the first write, so a read-only run still answers
    // with the seeded document.
    if (error?.code !== "ENOENT") throw error;
    document = createSeedData();
  }
  return document.repositories.find((repository) => repository.name === name);
}

const mainHead = (repository) => repository.branches.find((branch) => branch.name === "main").headId;

describe("REQ-4-1 browse repository files and directories", () => {
  it("serves the seeded branches of the repository with the default branch first", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(response.status, 200);
    assert.equal(response.body.repository.defaultBranch, "main");
    assert.deepEqual(
      response.body.repository.branches.map((branch) => branch.name),
      ["main", "feature-search", "release", "onboarding-docs", "draft-feature"],
    );
  });

  it("reads the nested directory and the text file inside it on the default branch", async () => {
    const directory = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=docs");
    assert.equal(directory.status, 200);
    assert.equal(directory.body.branch, "main");
    assert.equal(directory.body.path, "docs");
    assert.deepEqual(
      directory.body.entries.map((entry) => `${entry.type}:${entry.name}`),
      ["file:intro.md"],
    );

    const file = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=docs/intro.md");
    assert.equal(file.status, 200);
    assert.equal(file.body.branch, "main");
    assert.equal(file.body.file.path, "docs/intro.md");
    assert.match(file.body.file.content, /This is the introduction to the Acme Demo documentation/);
    // The file page reads the most recent commit of that path too.
    assert.equal(file.body.file.lastCommit.message, "Document search flow");
    assert.equal(file.body.file.lastCommit.author, "alice-dev");

    // Reading changes nothing: the branch head is the same afterwards.
    assert.equal(mainHead(await storedRepository()), "9c3e5b1-acme-docs-document-search-flow");
  });

  it("keeps the branch, path and content after the store is reopened", async () => {
    const reopened = await startApp(dataDir);
    try {
      const file = await reopened.request("/api/repositories/alice-dev/acme-docs/contents?path=docs/intro.md");
      assert.equal(file.status, 200);
      assert.equal(file.body.branch, "main");
      assert.equal(file.body.file.path, "docs/intro.md");
      assert.match(file.body.file.content, /This is the introduction/);
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("reads another branch and reports a file that branch does not contain", async () => {
    const other = await app.request("/api/repositories/alice-dev/acme-docs/contents?branch=feature-search");
    assert.equal(other.status, 200);
    assert.equal(other.body.branch, "feature-search");
    assert.deepEqual(
      other.body.entries.map((entry) => entry.name),
      ["docs", "src", "CONTRIBUTING.md", "main-only.md", "README.md"],
    );

    // The file only `feature-search` carries is readable there …
    const onTheBranch = await app.request(
      "/api/repositories/alice-dev/acme-docs/contents?branch=feature-search&path=main-only.md",
    );
    assert.equal(onTheBranch.status, 200);

    // … and absent from the default branch.
    const missing = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=main-only.md");
    assert.equal(missing.status, 404);

    assert.equal(
      (await app.request("/api/repositories/alice-dev/acme-docs/contents?branch=no-such-branch")).status,
      404,
    );
  });

  it("keeps the history of each branch apart", async () => {
    const main = await app.request("/api/repositories/alice-dev/acme-docs/commits");
    assert.equal(main.status, 200);
    assert.equal(main.body.branch, "main");
    assert.deepEqual(main.body.commits.map((commit) => commit.message), ["Document search flow", "Initial commit"]);
    assert.equal(main.body.commits[0].parentId, "4a1f7c2-acme-docs-initial");

    // `feature-search` starts from the `main` head and adds a file of its own,
    // so its history reaches the commits of `main`.
    const branch = await app.request("/api/repositories/alice-dev/acme-docs/commits?branch=feature-search");
    assert.equal(branch.status, 200);
    assert.deepEqual(
      branch.body.commits.map((commit) => commit.message),
      ["Add branch-only notes", "Document search flow", "Initial commit"],
    );
  });
});

describe("REQ-4-4 manage repository files through the web interface", () => {
  it("requires a session and Write permission or higher", async () => {
    const anonymous = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      body: { branch: "main", path: "docs/anonymous.md", content: "no", message: "Add docs/anonymous.md", create: true },
    });
    assert.equal(anonymous.status, 401);

    // `dana-observer` may read this public repository but holds no role on it.
    const reader = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie: await outsiderCookie(),
      body: { branch: "main", path: "docs/reader.md", content: "no", message: "Add docs/reader.md", create: true },
    });
    assert.equal(reader.status, 403);
    assert.equal((await storedRepository()).commits.length, 5);
  });

  it("stores one commit for a new file and moves the branch head to it", async () => {
    const cookie = await aliceCookie();
    const before = await storedRepository();
    const previousHead = mainHead(before);

    const response = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: {
        branch: "main",
        path: "docs/guide.md",
        content: "Guide content.\n",
        message: "Add docs/guide.md",
        create: true,
      },
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.branch, "main");
    assert.equal(response.body.path, "docs/guide.md");
    assert.equal(response.body.file.content, "Guide content.\n");
    assert.equal(response.body.commit.message, "Add docs/guide.md");
    assert.equal(response.body.commit.author, "alice-dev");
    assert.equal(response.body.commit.parentId, previousHead);
    assert.deepEqual(response.body.commit.files, [{ path: "docs/guide.md", change: "added" }]);

    // The commit record stores the change, the author, the parent, the branch
    // and the resulting snapshot as one record.
    const stored = await storedRepository();
    const commit = stored.commits.find((candidate) => candidate.id === response.body.commit.id);
    assert.equal(commit.branch, "main");
    assert.equal(commit.parentId, previousHead);
    assert.equal(commit.authorId, "account-alice-dev");
    assert.deepEqual(commit.files, [{ path: "docs/guide.md", change: "added" }]);
    assert.equal(commit.tree.find((file) => file.path === "docs/guide.md").content, "Guide content.\n");
    assert.equal(mainHead(stored), commit.id);
    // The other branch is untouched.
    assert.equal(
      stored.branches.find((branch) => branch.name === "feature-search").headId,
      "d7b2a08-acme-docs-branch-notes",
    );

    // The file browser lists the new file and reads its exact content.
    const directory = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=docs");
    assert.deepEqual(directory.body.entries.map((entry) => entry.name).sort(), ["guide.md", "intro.md"]);
    const file = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=docs/guide.md");
    assert.equal(file.body.file.content, "Guide content.\n");

    const history = await app.request("/api/repositories/alice-dev/acme-docs/commits");
    assert.equal(history.body.commits[0].message, "Add docs/guide.md");
    assert.equal(history.body.commits.length, 3);
  });

  it("keeps the new file and commit after the store is reopened", async () => {
    const reopened = await startApp(dataDir);
    try {
      const file = await reopened.request("/api/repositories/alice-dev/acme-docs/contents?path=docs/guide.md");
      assert.equal(file.status, 200);
      assert.equal(file.body.file.content, "Guide content.\n");
      const history = await reopened.request("/api/repositories/alice-dev/acme-docs/commits");
      assert.equal(history.body.commits[0].message, "Add docs/guide.md");
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("reports an invalid path and a missing commit message and stores nothing", async () => {
    const cookie = await aliceCookie();
    const before = await storedRepository();

    const response = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: { branch: "main", path: "../invalid.md", content: "must not be saved", message: "   ", create: true },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.fields.path, "Invalid file path");
    assert.equal(response.body.fields.message, "Commit message is required");

    const after = await storedRepository();
    assert.equal(after.commits.length, before.commits.length);
    assert.equal(mainHead(after), mainHead(before));
    assert.ok(!after.commits.some((commit) => commit.files.some((file) => file.path.includes("invalid"))));
  });

  it("reports a conflicting path, a noncompliant message and a protected branch", async () => {
    const cookie = await aliceCookie();
    const conflict = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: { branch: "main", path: "README.md", content: "overwritten", message: "Replace the readme", create: true },
    });
    assert.equal(conflict.status, 400);
    assert.equal(conflict.body.fields.path, "A file or directory already exists at this path");

    const longMessage = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: { branch: "main", path: "docs/long.md", content: "x", message: "m".repeat(73), create: true },
    });
    assert.equal(longMessage.status, 400);
    assert.equal(longMessage.body.fields.message, "Commit message must be 72 characters or fewer");

    // A protected branch refuses the write with its own reason.
    await app.store.update((draft) => {
      const repository = draft.repositories.find((candidate) => candidate.name === "acme-docs");
      repository.branches.find((branch) => branch.name === "main").protected = true;
      return draft;
    });
    const before = await storedRepository();
    const protectedBranch = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: { branch: "main", path: "docs/protected.md", content: "x", message: "Add docs/protected.md", create: true },
    });
    assert.equal(protectedBranch.status, 400);
    assert.equal(protectedBranch.body.fields.branch, "This branch is protected");
    const after = await storedRepository();
    assert.equal(after.commits.length, before.commits.length);
    assert.equal(mainHead(after), mainHead(before));

    await app.store.update((draft) => {
      const repository = draft.repositories.find((candidate) => candidate.name === "acme-docs");
      repository.branches.find((branch) => branch.name === "main").protected = false;
      return draft;
    });
  });

  it("appends a new commit when a file is edited and never rewrites history", async () => {
    const cookie = await aliceCookie();
    const before = await storedRepository();
    const previousHead = mainHead(before);

    const response = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: {
        branch: "main",
        path: "docs/intro.md",
        content: "# Introduction\n\nRewritten introduction.\n",
        message: "Rewrite the introduction",
        create: false,
        originalPath: "docs/intro.md",
      },
    });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.commit.files, [{ path: "docs/intro.md", change: "modified" }]);
    assert.equal(response.body.commit.parentId, previousHead);

    const file = await app.request("/api/repositories/alice-dev/acme-docs/contents?path=docs/intro.md");
    assert.equal(file.body.file.content, "# Introduction\n\nRewritten introduction.\n");
    assert.equal(file.body.file.lastCommit.message, "Rewrite the introduction");

    // The earlier commit keeps its own snapshot.
    const stored = await storedRepository();
    const earlier = stored.commits.find((commit) => commit.id === "9c3e5b1-acme-docs-document-search-flow");
    assert.match(earlier.tree.find((entry) => entry.path === "docs/intro.md").content, /This is the introduction/);
    assert.equal(earlier.parentId, "4a1f7c2-acme-docs-initial");
  });

  it("refuses a branch that does not exist", async () => {
    const cookie = await aliceCookie();
    const response = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: { branch: "no-such-branch", path: "docs/any.md", content: "x", message: "Add docs/any.md", create: true },
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "Branch not found");
  });
});
