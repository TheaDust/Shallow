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
  return mkdtemp(join(tmpdir(), "shallowcode-branches-"));
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

async function signIn(baseUrl, identifier) {
  const response = await jsonRequest(baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier, password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

async function readJson(response) {
  return response.json();
}

/**
 * A signed-in account without any role on the seeded repositories. Every seeded
 * account collaborates on `alice-dev/acme-docs` (`alice-dev` owns it, and
 * `bob-reviewer` and `carol-dev` hold a Write grant, REQ-6), so a case that needs
 * a viewer outside the collaborator scope registers its own account.
 */
let outsiderCount = 0;
async function signInOutsider(baseUrl) {
  outsiderCount += 1;
  const username = `pw-outsider-${outsiderCount}`;
  const registered = await jsonRequest(baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username,
      email: `${username}@example.test`,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(registered.status, 201);
  return { cookie: await signIn(baseUrl, username), username };
}

const ACME = "/api/repositories/alice-dev/acme-docs";

async function overview(baseUrl, query = "", cookie) {
  const response = await jsonRequest(baseUrl, `${ACME}${query}`, { cookie });
  assert.equal(response.status, 200);
  return (await readJson(response)).repository;
}

async function branchNames(baseUrl, cookie) {
  return (await overview(baseUrl, "", cookie)).branches.map((branch) => branch.name);
}

test("creating a branch stores a reference at the base commit and rewrites nothing", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const before = await overview(app.baseUrl);
  const mainHead = before.branches.find((branch) => branch.name === "main").headCommitId;
  const mainCommits = before.commits.map((commit) => commit.id);

  const created = await jsonRequest(app.baseUrl, `${ACME}/branches`, {
    method: "POST",
    cookie: alice,
    body: { name: "feature/api-v2", baseBranch: "main" },
  });
  assert.equal(created.status, 201);
  const payload = await readJson(created);
  assert.equal(payload.repository.branch, "feature/api-v2");
  assert.equal(payload.branch.name, "feature/api-v2");
  assert.equal(payload.branch.headCommitId, mainHead);
  assert.equal(payload.branch.baseRef, "main");
  assert.equal(payload.branch.createdBy, "alice-dev");
  assert.ok(payload.branch.createdAt);

  // The new branch reads the same snapshot as its base branch.
  const onBranch = await overview(app.baseUrl, "?branch=feature/api-v2");
  assert.deepEqual(
    onBranch.entries.map((entry) => entry.path),
    before.entries.map((entry) => entry.path),
  );
  assert.deepEqual(
    onBranch.commits.map((commit) => commit.id),
    mainCommits,
  );

  // The base branch keeps its head, its history and its files.
  const after = await overview(app.baseUrl);
  assert.equal(after.branch, "main");
  assert.equal(
    after.branches.find((branch) => branch.name === "main").headCommitId,
    mainHead,
  );
  assert.deepEqual(
    after.commits.map((commit) => commit.id),
    mainCommits,
  );
});

test("a created branch is readable after a restart and lists with the others", async (t) => {
  const dataDir = await newDataDir();
  const first = await startApp(dataDir);
  const alice = await signIn(first.baseUrl, "alice-dev");
  const created = await jsonRequest(first.baseUrl, `${ACME}/branches`, {
    method: "POST",
    cookie: alice,
    body: { name: "pw-branch-abc123", baseBranch: "main" },
  });
  assert.equal(created.status, 201);
  await first.close();

  const second = await startApp(dataDir);
  t.after(() => second.close());
  assert.deepEqual(await branchNames(second.baseUrl), [
    "main",
    "feature-search",
    "release",
    "draft-feature",
    "pw-branch-abc123",
  ]);
  const onBranch = await overview(second.baseUrl, "?branch=pw-branch-abc123");
  assert.equal(onBranch.branch, "pw-branch-abc123");
});

test("an invalid, duplicated or unauthorised branch name creates no reference", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const before = await branchNames(app.baseUrl);

  const invalidNames = ["invalid..branch", "", "trailing/", "trailing.", "double//slash", "a b"];
  for (const name of invalidNames) {
    const response = await jsonRequest(app.baseUrl, `${ACME}/branches`, {
      method: "POST",
      cookie: alice,
      body: { name, baseBranch: "main" },
    });
    assert.equal(response.status, 400, `expected ${JSON.stringify(name)} to be refused`);
    assert.equal((await readJson(response)).fields.name, "Invalid branch");
  }

  // An existing name is never created a second time.
  const duplicate = await jsonRequest(app.baseUrl, `${ACME}/branches`, {
    method: "POST",
    cookie: alice,
    body: { name: "feature-search", baseBranch: "main" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal((await readJson(duplicate)).fields.name, "Invalid branch");

  // A visitor is not authenticated and a signed-in non-collaborator may only browse.
  const anonymous = await jsonRequest(app.baseUrl, `${ACME}/branches`, {
    method: "POST",
    body: { name: "visitor-branch", baseBranch: "main" },
  });
  assert.equal(anonymous.status, 401);
  const denied = await signInOutsider(app.baseUrl);
  const refused = await jsonRequest(app.baseUrl, `${ACME}/branches`, {
    method: "POST",
    cookie: denied.cookie,
    body: { name: "outsider-branch", baseBranch: "main" },
  });
  assert.equal(refused.status, 403);

  // The same account may still browse the branch selector of the repository.
  assert.equal((await overview(app.baseUrl, "", denied.cookie)).branch, "main");
  assert.deepEqual(await branchNames(app.baseUrl), before);
});

test("a longer than 255 character branch name is refused", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  const long = await jsonRequest(app.baseUrl, `${ACME}/branches`, {
    method: "POST",
    cookie: alice,
    body: { name: "a".repeat(256), baseBranch: "main" },
  });
  assert.equal(long.status, 400);
  assert.equal((await readJson(long)).fields.name, "Invalid branch");

  const allowed = await jsonRequest(app.baseUrl, `${ACME}/branches`, {
    method: "POST",
    cookie: alice,
    body: { name: "release-candidate/1.2.3_x-y", baseBranch: "main" },
  });
  assert.equal(allowed.status, 201);
});

test("only a repository administrator changes the default branch", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const before = await overview(app.baseUrl);
  const mainHead = before.branches.find((branch) => branch.name === "main").headCommitId;

  // The non-Admin collaborator and a visitor are refused and change nothing.
  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const refused = await jsonRequest(app.baseUrl, `${ACME}/default-branch`, {
    method: "POST",
    cookie: bob,
    body: { branch: "release" },
  });
  assert.equal(refused.status, 403);
  assert.equal((await overview(app.baseUrl)).branch, "main");
  const anonymous = await jsonRequest(app.baseUrl, `${ACME}/default-branch`, {
    method: "POST",
    body: { branch: "release" },
  });
  assert.equal(anonymous.status, 401);

  // An unknown branch is never selectable.
  const alice = await signIn(app.baseUrl, "alice-dev");
  const unknown = await jsonRequest(app.baseUrl, `${ACME}/default-branch`, {
    method: "POST",
    cookie: alice,
    body: { branch: "does-not-exist" },
  });
  assert.equal(unknown.status, 400);

  const updated = await jsonRequest(app.baseUrl, `${ACME}/default-branch`, {
    method: "POST",
    cookie: alice,
    body: { branch: "release" },
  });
  assert.equal(updated.status, 200);
  assert.equal((await readJson(updated)).repository.branch, "release");

  // Opening the repository entry without a branch reads the new default.
  const opened = await overview(app.baseUrl);
  assert.equal(opened.branch, "release");
  assert.equal(opened.defaultBranch, "release");
  // Every existing branch and every commit is still there, `main` included.
  assert.deepEqual(
    opened.branches.map((branch) => branch.name),
    ["main", "feature-search", "release", "draft-feature"],
  );
  assert.equal(opened.branches.find((branch) => branch.name === "main").headCommitId, mainHead);
  const main = await overview(app.baseUrl, "?branch=main");
  assert.deepEqual(
    main.commits.map((commit) => commit.message),
    ["Add search loader", "Document search flow", "Initial commit"],
  );

  // The change survives a restart.
  await app.close();
  const second = await startApp(dataDir);
  t.after(() => second.close());
  assert.equal((await overview(second.baseUrl)).branch, "release");
});

test("one submission stores a file change and moves the branch to the new commit", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  // `main` is the protected branch of this seed (REQ-6-1, REQ-6-5), so the file
  // editor flow uses the unprotected `feature-search` branch.
  const before = await overview(app.baseUrl, "?branch=feature-search");
  const headBefore = before.branches.find(
    (branch) => branch.name === "feature-search",
  ).headCommitId;

  const response = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: {
      branch: "feature-search",
      path: "docs/guide.md",
      content: "# Guide\n\nHow to use the Acme platform.\n",
      message: "Add docs/guide.md",
    },
  });
  assert.equal(response.status, 201);
  const payload = await readJson(response);
  assert.equal(payload.file.path, "docs/guide.md");
  assert.equal(payload.file.content, "# Guide\n\nHow to use the Acme platform.\n");
  assert.equal(payload.commit.parentId, headBefore);
  assert.equal(payload.commit.author, "alice-dev");
  assert.equal(payload.commit.message, "Add docs/guide.md");
  assert.ok(payload.commit.createdAt);
  assert.equal(payload.repository.branch, "feature-search");

  // The branch head moved to the new commit and the file is stored on it.
  const after = await overview(app.baseUrl, "?branch=feature-search");
  assert.equal(
    after.branches.find((branch) => branch.name === "feature-search").headCommitId,
    payload.commit.id,
  );
  assert.deepEqual(
    after.commits.map((commit) => commit.message),
    [
      "Add docs/guide.md",
      "Add main-only notes",
      "Add search loader",
      "Document search flow",
      "Initial commit",
    ],
  );
  assert.ok(after.entries.some((entry) => entry.path === "docs"));
  assert.ok((await overview(app.baseUrl, "?branch=feature-search&path=docs")).entries.some(
    (entry) => entry.path === "docs/guide.md",
  ));

  const file = await jsonRequest(
    app.baseUrl,
    `${ACME}/file?branch=feature-search&path=${encodeURIComponent("docs/guide.md")}`,
  );
  assert.equal(file.status, 200);
  assert.equal((await readJson(file)).file.content, payload.file.content);

  // The history of the file holds exactly the submitted message.
  const history = await jsonRequest(
    app.baseUrl,
    `${ACME}/commits?branch=feature-search&path=${encodeURIComponent("docs/guide.md")}`,
  );
  assert.deepEqual(
    (await readJson(history)).commits.map((commit) => commit.message),
    ["Add docs/guide.md"],
  );

  // Editing the same path stores a modification, not a second file.
  const edited = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: {
      branch: "feature-search",
      path: "docs/guide.md",
      previousPath: "docs/guide.md",
      content: "# Guide\n\nUpdated instructions.\n",
      message: "Update docs/guide.md",
    },
  });
  assert.equal(edited.status, 201);
  const editedPayload = await readJson(edited);
  assert.equal(editedPayload.commit.parentId, payload.commit.id);
  assert.equal(editedPayload.file.content, "# Guide\n\nUpdated instructions.\n");

  // A rename removes the previous path and adds the new one.
  const renamed = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: {
      branch: "feature-search",
      path: "docs/handbook.md",
      previousPath: "docs/guide.md",
      content: "# Handbook\n",
      message: "Rename the guide",
    },
  });
  assert.equal(renamed.status, 201);
  const renamedHistory = await jsonRequest(
    app.baseUrl,
    `${ACME}/commits?branch=${encodeURIComponent("feature-search")}`,
  );
  const messages = (await readJson(renamedHistory)).commits.map((commit) => commit.message);
  assert.deepEqual(messages.slice(0, 2), ["Rename the guide", "Update docs/guide.md"]);
  const oldFile = await jsonRequest(
    app.baseUrl,
    `${ACME}/file?branch=feature-search&path=${encodeURIComponent("docs/guide.md")}`,
  );
  assert.equal(oldFile.status, 404);

  // Everything survives a restart.
  await app.close();
  const second = await startApp(dataDir);
  t.after(() => second.close());
  const reopened = await overview(second.baseUrl, `?branch=feature-search&path=docs`);
  assert.ok(reopened.entries.some((entry) => entry.path === "docs/handbook.md"));
});

test("refused file submissions change neither the file, the branch head nor the history", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const before = await overview(app.baseUrl, "?branch=feature-search");
  const headBefore = before.branches.find(
    (branch) => branch.name === "feature-search",
  ).headCommitId;
  const commitsBefore = before.commits.map((commit) => commit.id);

  const attempts = [
    [{ path: "", content: "x", message: "Add file" }, "path", "Invalid file path"],
    [{ path: "../invalid.md", content: "must not be saved", message: "" }, "path", "Invalid file path"],
    [{ path: "/absolute.md", content: "x", message: "Add file" }, "path", "Invalid file path"],
    [{ path: "docs/../escape.md", content: "x", message: "Add file" }, "path", "Invalid file path"],
    [{ path: "README.md", content: "x", message: "Add file" }, "path", "Invalid file path"],
    [{ path: "docs", content: "x", message: "Add file" }, "path", "Invalid file path"],
    [{ path: "README.md/inner.md", content: "x", message: "Add file" }, "path", "Invalid file path"],
    [{ path: "fresh.md", content: "x", message: "   " }, "message", "Commit message is required"],
    [{ path: "fresh.md", content: "x", message: "m".repeat(73) }, "message", null],
  ];
  for (const [body, field, text] of attempts) {
    const response = await jsonRequest(app.baseUrl, `${ACME}/file`, {
      method: "POST",
      cookie: alice,
      body: { branch: "feature-search", ...body },
    });
    assert.equal(response.status, 400, `expected ${JSON.stringify(body)} to be refused`);
    const fields = (await readJson(response)).fields;
    assert.ok(fields[field], `expected an error on ${field}`);
    if (text) assert.equal(fields[field], text);
  }

  // The `../invalid.md` submission reports the path and the missing message.
  const both = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: { branch: "feature-search", path: "../invalid.md", content: "must not be saved", message: "" },
  });
  const bothFields = (await readJson(both)).fields;
  assert.equal(bothFields.path, "Invalid file path");
  assert.equal(bothFields.message, "Commit message is required");

  // A visitor is not authenticated and a non-writer may only browse.
  const anonymous = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    body: { branch: "feature-search", path: "visitor.md", content: "x", message: "Add visitor.md" },
  });
  assert.equal(anonymous.status, 401);
  // A signed-in account without any role on this repository may only browse.
  const denied = await signInOutsider(app.baseUrl);
  const outsider = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: denied.cookie,
    body: { branch: "feature-search", path: "bob.md", content: "x", message: "Add bob.md" },
  });
  assert.equal(outsider.status, 403);

  const after = await overview(app.baseUrl, "?branch=feature-search");
  assert.equal(
    after.branches.find((branch) => branch.name === "feature-search").headCommitId,
    headBefore,
  );
  assert.deepEqual(after.commits.map((commit) => commit.id), commitsBefore);
  assert.equal(await branchNames(app.baseUrl).then((names) => names.length), 4);
  assert.equal(
    (await overview(app.baseUrl, "?branch=feature-search")).entries.some(
      (entry) => entry.name === "fresh.md",
    ),
    false,
  );
});

test("a writer outside the owning organization may add a file to a granted repository", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const response = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/secret-research/file", {
    method: "POST",
    cookie: bob,
    body: {
      branch: "main",
      path: "notes/write-access.md",
      content: "# Write access\n",
      message: "Add write access notes",
    },
  });
  assert.equal(response.status, 201);
  const payload = await readJson(response);
  assert.equal(payload.commit.author, "bob-reviewer");

  // bob-reviewer may not change the default branch of that repository.
  const settings = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/secret-research/default-branch",
    { method: "POST", cookie: bob, body: { branch: "main" } },
  );
  assert.equal(settings.status, 403);
});
