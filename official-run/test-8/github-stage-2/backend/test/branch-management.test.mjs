import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-branches-")));
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

const DEMO = "/api/repositories/acme-demo/branch-switch-demo";

/** REQ-4-3-1: the selector lists and switches the branches of the repository. */
test("a visitor lists branches and switches to the branch that holds the target file", async () => {
  const app = await startApp();
  try {
    const listed = await call(app.base, `${DEMO}/branches`);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.branches.map((branch) => [branch.name, branch.isDefault]), [
      ["feature-search", false],
      ["main", true],
    ]);

    const main = await call(app.base, `${DEMO}/tree/main`);
    assert.deepEqual(main.body.entries.map((entry) => entry.name), ["README.md"]);

    const target = await call(app.base, `${DEMO}/tree/feature-search`);
    assert.equal(target.status, 200);
    assert.equal(target.body.branch, "feature-search");
    assert.deepEqual(target.body.entries.map((entry) => entry.name), ["main-only.md", "README.md"]);
    const file = await call(app.base, `${DEMO}/blob/feature-search/main-only.md`);
    assert.equal(file.status, 200);
    assert.equal(file.body.branch, "feature-search");
    // The target branch reads the base revision it points at plus its own commit.
    const targetHistory = await call(app.base, `${DEMO}/commits/feature-search`);
    assert.deepEqual(
      targetHistory.body.commits.map((commit) => commit.message),
      ["Add main-only file", "Initial commit"],
    );

    // The target-only file is not part of the active branch snapshot.
    const absent = await call(app.base, `${DEMO}/blob/main/main-only.md`);
    assert.equal(absent.status, 404);

    // Switching is read-only: no commit and no branch change is stored.
    const state = await stateOf(app.dataDir);
    const branches = state.branches.filter((branch) => branch.repositoryId === listed.body.repository.id);
    assert.deepEqual(branches.map((branch) => branch.name).sort(), ["feature-search", "main"]);
    assert.equal(state.commits.filter((commit) => commit.repositoryId === listed.body.repository.id).length, 2);
  } finally {
    await app.close();
  }
});

/** REQ-4-3-2: a Write contributor creates a branch from the current head. */
test("a contributor creates a branch from the current head and keeps it after a restart", async () => {
  const app = await startApp();
  try {
    const contributor = await signIn(app.base, "branch-contributor");
    assert.equal(contributor.status, 200);

    const name = "pw-branch-1234";
    const created = await call(app.base, `${DEMO}/branches`, {
      method: "POST",
      cookie: contributor.sessionCookie,
      body: { name, from: "main" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.branch.name, name);
    assert.deepEqual(created.body.branches.map((branch) => branch.name), ["feature-search", "main", name]);

    // The reference points at the head of `main` and copies no commit.
    const state = await stateOf(app.dataDir);
    const base = state.branches.find((branch) => branch.name === "main" && branch.repositoryId === created.body.repository.id);
    const branch = state.branches.find((c) => c.name === name && c.repositoryId === created.body.repository.id);
    assert.equal(branch.headCommitId, base.headCommitId);
    assert.equal(state.commits.filter((commit) => commit.branch === name).length, 0);
    assert.equal(
      state.commits.filter((commit) => commit.repositoryId === created.body.repository.id).length,
      2,
    );

    // Its snapshot is the base revision, so browsing shows the same files and
    // the branch reads the history it points at.
    const tree = await call(app.base, `${DEMO}/tree/${name}`);
    assert.deepEqual(tree.body.entries.map((entry) => entry.name), ["README.md"]);
    const history = await call(app.base, `${DEMO}/commits/${name}`);
    assert.equal(history.body.count, 1);
    assert.equal(history.body.commits[0].message, "Initial commit");

    const restarted = await startApp(app.dataDir);
    try {
      const after = await call(restarted.base, `${DEMO}/branches`);
      assert.ok(after.body.branches.some((candidate) => candidate.name === name));
      const selected = await call(restarted.base, `${DEMO}/tree/${name}`);
      assert.equal(selected.status, 200);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

/** REQ-4-3-2 / folder rule: only valid, unused names by permitted users. */
test("branch creation rejects invalid names, duplicates and unauthorized users", async () => {
  const app = await startApp();
  try {
    const contributor = await signIn(app.base, "branch-contributor");
    for (const name of [
      "invalid..branch",
      "topic/",
      "topic.",
      "a//b",
      "",
      "has space",
      "a".repeat(256),
      "feature-search",
    ]) {
      const rejected = await call(app.base, `${DEMO}/branches`, {
        method: "POST",
        cookie: contributor.sessionCookie,
        body: { name, from: "main" },
      });
      assert.equal(rejected.status, 400, name);
      assert.ok(rejected.body.fields.name, name);
    }

    const anonymous = await call(app.base, `${DEMO}/branches`, {
      method: "POST",
      body: { name: "anon-branch", from: "main" },
    });
    assert.equal(anonymous.status, 401);

    // Grant Read to `org-member`: browsing is allowed, creating is not.
    const owner = await signIn(app.base, "org-owner");
    const granted = await call(app.base, `${DEMO}/access`, {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { subjectType: "account", name: "org-member", role: "read" },
    });
    assert.equal(granted.status, 200);

    const reader = await signIn(app.base, "org-member");
    const readBranches = await call(app.base, `${DEMO}/branches`, { cookie: reader.sessionCookie });
    assert.equal(readBranches.status, 200);
    const refused = await call(app.base, `${DEMO}/branches`, {
      method: "POST",
      cookie: reader.sessionCookie,
      body: { name: "reader-branch", from: "main" },
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "Access denied");

    const state = await stateOf(app.dataDir);
    assert.deepEqual(
      state.branches.filter((branch) => branch.name.includes("branch") || branch.name.startsWith("topic")).map((b) => b.name),
      [],
    );
  } finally {
    await app.close();
  }
});

/** REQ-4-3-3: an Admin changes the default branch; a viewer cannot. */
test("an Admin updates the default branch and the repository then reads it", async () => {
  const app = await startApp();
  const DEMO_DEFAULT = "/api/repositories/acme-demo/default-branch-demo";
  try {
    const before = await call(app.base, `${DEMO_DEFAULT}/tree`);
    assert.equal(before.body.branch, "main");

    const viewer = await signIn(app.base, "default-branch-viewer");
    const refused = await call(app.base, `${DEMO_DEFAULT}/default-branch`, {
      method: "POST",
      cookie: viewer.sessionCookie,
      body: { branch: "release" },
    });
    assert.equal(refused.status, 403);

    const anonymous = await call(app.base, `${DEMO_DEFAULT}/default-branch`, {
      method: "POST",
      body: { branch: "release" },
    });
    assert.equal(anonymous.status, 401);

    const admin = await signIn(app.base, "default-branch-admin");
    const unknown = await call(app.base, `${DEMO_DEFAULT}/default-branch`, {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { branch: "no-such-branch" },
    });
    assert.equal(unknown.status, 400);
    assert.ok(unknown.body.fields.branch);

    const state = await stateOf(app.dataDir);
    const repositoryId = before.body.repository.id;
    const commitsBefore = state.commits.filter((commit) => commit.repositoryId === repositoryId).length;
    const filesBefore = state.files.filter((file) => file.repositoryId === repositoryId).length;

    const changed = await call(app.base, `${DEMO_DEFAULT}/default-branch`, {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { branch: "release" },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.repository.defaultBranch, "release");

    // The previous branch, its commits and its files stay stored.
    const reopened = await call(app.base, `${DEMO_DEFAULT}/tree`);
    assert.equal(reopened.body.branch, "release");
    assert.deepEqual(reopened.body.entries.map((entry) => entry.name), ["README.md", "release.md"]);
    const branches = await call(app.base, `${DEMO_DEFAULT}/branches`);
    assert.deepEqual(branches.body.branches.map((branch) => [branch.name, branch.isDefault]), [
      ["main", false],
      ["release", true],
    ]);
    const main = await call(app.base, `${DEMO_DEFAULT}/tree/main`);
    assert.deepEqual(main.body.entries.map((entry) => entry.name), ["README.md"]);
    const after = await stateOf(app.dataDir);
    assert.equal(after.commits.filter((commit) => commit.repositoryId === repositoryId).length, commitsBefore);
    assert.equal(after.files.filter((file) => file.repositoryId === repositoryId).length, filesBefore);
  } finally {
    await app.close();
  }
});

/** REQ-4-3-3: the saved default branch survives a restart. */
test("the saved default branch stays effective after reopening the application", async () => {
  const app = await startApp();
  try {
    const admin = await signIn(app.base, "default-branch-admin");
    await call(app.base, "/api/repositories/acme-demo/default-branch-demo/default-branch", {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { branch: "release" },
    });

    const restarted = await startApp(app.dataDir);
    try {
      const reopened = await call(restarted.base, "/api/repositories/acme-demo/default-branch-demo/tree");
      assert.equal(reopened.body.branch, "release");
      const branches = await call(restarted.base, "/api/repositories/acme-demo/default-branch-demo/branches");
      assert.deepEqual(branches.body.branches.map((branch) => branch.name), ["main", "release"]);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});
