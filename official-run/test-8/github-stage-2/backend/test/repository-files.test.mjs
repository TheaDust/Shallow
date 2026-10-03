import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-files-")));
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

async function stateOf(dataDir) {
  return JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
}

const DEMO = "/api/repositories/acme-demo/file-management-demo";

/** REQ-4-4: one submission creates one commit and advances the branch head. */
test("a Write contributor adds a file through one commit that the file history exposes", async () => {
  const app = await startApp();
  try {
    const before = await call(app.base, `${DEMO}/commits/main`);
    const headId = before.body.commits[0].id;

    const contributor = await signIn(app.base, "file-contributor");
    const path = "pw-file-42.md";
    const message = `Add ${path}`;
    const created = await call(app.base, `${DEMO}/files`, {
      method: "POST",
      cookie: contributor.sessionCookie,
      body: { branch: "main", path, content: "Saved content\n", message },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.path, path);
    assert.equal(created.body.content, "Saved content\n");

    const file = await call(app.base, `${DEMO}/blob/main/${path}`);
    assert.equal(file.status, 200);
    assert.equal(file.body.content, "Saved content\n");

    const history = await call(app.base, `${DEMO}/commits/main/${path}`);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.commits.map((commit) => commit.message), [message]);
    const commit = history.body.commits[0];
    assert.equal(commit.author, "file-contributor");
    assert.equal(commit.parentId, headId);

    // The submission advanced the branch head by exactly one commit.
    const after = await call(app.base, `${DEMO}/commits/main`);
    assert.equal(after.body.count, before.body.count + 1);
    assert.equal(after.body.commits[0].id, commit.id);

    const state = await stateOf(app.dataDir);
    const repositoryId = file.body.repository.id;
    const stored = state.commits.find((candidate) => candidate.id === commit.id);
    assert.equal(stored.repositoryId, repositoryId);
    assert.equal(stored.branch, "main");
    assert.equal(stored.parentCommitId, headId);
    assert.deepEqual(stored.changes, [{ path, content: "Saved content\n" }]);
    const branch = state.branches.find((candidate) => candidate.repositoryId === repositoryId && candidate.name === "main");
    assert.equal(branch.headCommitId, commit.id);
  } finally {
    await app.close();
  }
});

/** REQ-4-4: invalid submissions leave the files, the head and the history alone. */
test("invalid submissions are reported per field and store nothing", async () => {
  const app = await startApp();
  try {
    const contributor = await signIn(app.base, "file-contributor");

    // A nested path is valid and gives the repository a `src` directory.
    const nested = await call(app.base, `${DEMO}/files`, {
      method: "POST",
      cookie: contributor.sessionCookie,
      body: { branch: "main", path: "src/new.md", content: "nested\n", message: "Add src/new.md" },
    });
    assert.equal(nested.status, 201);
    const nestedDirectory = await call(app.base, `${DEMO}/tree/main/src`);
    assert.deepEqual(nestedDirectory.body.entries.map((entry) => entry.name), ["new.md"]);

    const stateBefore = await readFile(join(app.dataDir, "state.json"), "utf8");

    const invalidPath = await call(app.base, `${DEMO}/files`, {
      method: "POST",
      cookie: contributor.sessionCookie,
      body: { branch: "main", path: "../invalid.md", content: "must not be saved", message: "" },
    });
    assert.equal(invalidPath.status, 400);
    assert.equal(invalidPath.body.fields.path, "Invalid file path");
    assert.equal(invalidPath.body.fields.message, "Commit message is required");

    // Empty, absolute, an existing file, an existing directory and a path below
    // an existing file are all invalid.
    for (const path of ["", "/absolute.md", "src", "README.md", "README.md/nested.md"]) {
      const rejected = await call(app.base, `${DEMO}/files`, {
        method: "POST",
        cookie: contributor.sessionCookie,
        body: { branch: "main", path, content: "x", message: `Add ${path}` },
      });
      assert.equal(rejected.status, 400, path);
      assert.equal(rejected.body.fields.path, "Invalid file path", path);
    }

    const longMessage = await call(app.base, `${DEMO}/files`, {
      method: "POST",
      cookie: contributor.sessionCookie,
      body: { branch: "main", path: "another.md", content: "x", message: "m".repeat(73) },
    });
    assert.equal(longMessage.status, 400);
    assert.ok(longMessage.body.fields.message);

    // Nothing was written: files, branch heads and history are byte-identical.
    assert.equal(await readFile(join(app.dataDir, "state.json"), "utf8"), stateBefore);
  } finally {
    await app.close();
  }
});

/** REQ-4-4: only Write and above may submit. */
test("Read and anonymous viewers cannot submit file changes", async () => {
  const app = await startApp();
  try {
    const anonymous = await call(app.base, `${DEMO}/files`, {
      method: "POST",
      body: { branch: "main", path: "anon.md", content: "x", message: "Add anon.md" },
    });
    assert.equal(anonymous.status, 401);

    const owner = await signIn(app.base, "org-owner");
    const granted = await call(app.base, `${DEMO}/access`, {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { subjectType: "account", name: "org-member", role: "read" },
    });
    assert.equal(granted.status, 200);

    const reader = await signIn(app.base, "org-member");
    const readable = await call(app.base, `${DEMO}/tree/main`, { cookie: reader.sessionCookie });
    assert.equal(readable.status, 200);
    const refused = await call(app.base, `${DEMO}/files`, {
      method: "POST",
      cookie: reader.sessionCookie,
      body: { branch: "main", path: "reader.md", content: "x", message: "Add reader.md" },
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "Access denied");

    const missing = await call(app.base, `${DEMO}/blob/main/reader.md`);
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

/** REQ-4-4: the created file and commit stay readable after a restart. */
test("a created file and its commit survive a restart", async () => {
  const app = await startApp();
  try {
    const contributor = await signIn(app.base, "file-contributor");
    await call(app.base, `${DEMO}/files`, {
      method: "POST",
      cookie: contributor.sessionCookie,
      body: { branch: "main", path: "persisted.md", content: "kept\n", message: "Add persisted.md" },
    });

    const restarted = await startApp(app.dataDir);
    try {
      const file = await call(restarted.base, `${DEMO}/blob/main/persisted.md`);
      assert.equal(file.status, 200);
      assert.equal(file.body.content, "kept\n");
      const history = await call(restarted.base, `${DEMO}/commits/main/persisted.md`);
      assert.deepEqual(history.body.commits.map((commit) => commit.message), ["Add persisted.md"]);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});
