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
  return mkdtemp(join(tmpdir(), "shallowcode-protection-"));
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

const ACME = "/api/repositories/alice-dev/acme-docs";
const RULES = `${ACME}/branch-protection`;

test("the seeded rule of main is readable without a session", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  // The seed protects `main` of this repository, because the eligible merge seed
  // of REQ-6-5 targets a protected branch.
  const response = await jsonRequest(app.baseUrl, RULES);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.repository.fullName, "alice-dev/acme-docs");
  assert.deepEqual(
    payload.rules.map((rule) => [rule.branchName, rule.requireApproval, rule.requireStatusCheck]),
    [["main", true, true]],
  );

  // A public repository without a stored rule stays unprotected.
  const other = await jsonRequest(
    app.baseUrl,
    "/api/repositories/bob-reviewer/bob-notes/branch-protection",
  );
  assert.equal(other.status, 200);
  assert.deepEqual((await other.json()).rules, []);
});

test("an admin creates one rule per exact branch name and saves its toggles", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  // Saving the seeded rule of `main` returns the stored record instead of
  // creating a second one for the same branch name.
  const created = await jsonRequest(app.baseUrl, RULES, {
    method: "POST",
    cookie: alice,
    body: { branchName: "main", requireApproval: true, requireStatusCheck: true },
  });
  assert.equal(created.status, 200);
  const rule = (await created.json()).rule;
  assert.equal(rule.branchName, "main");
  assert.equal(rule.requireApproval, true);
  assert.equal(rule.requireStatusCheck, true);
  assert.deepEqual(rule.summaries, ["1 approval", "Require status check test"]);
  assert.equal(rule.createdBy, "alice-dev");

  // A branch name without a rule is created with its own record.
  const fresh = await jsonRequest(app.baseUrl, RULES, {
    method: "POST",
    cookie: alice,
    body: { branchName: "draft-feature", requireApproval: true, requireStatusCheck: true },
  });
  assert.equal(fresh.status, 201);
  assert.equal((await fresh.json()).rule.branchName, "draft-feature");

  // Saving the same branch name changes the stored toggles instead of adding a
  // second record for it.
  const updated = await jsonRequest(app.baseUrl, RULES, {
    method: "POST",
    cookie: alice,
    body: { branchName: "main", requireApproval: true, requireStatusCheck: false },
  });
  assert.equal(updated.status, 200);
  const list = await jsonRequest(app.baseUrl, RULES);
  const rules = (await list.json()).rules;
  assert.equal(rules.length, 2);
  assert.deepEqual(
    rules.map((entry) => [entry.branchName, entry.summaries]),
    [
      ["draft-feature", ["1 approval", "Require status check test"]],
      ["main", ["1 approval"]],
    ],
  );

  // A second branch keeps its own exact name.
  await jsonRequest(app.baseUrl, RULES, {
    method: "POST",
    cookie: alice,
    body: { branchName: "feature-search", requireApproval: false, requireStatusCheck: true },
  });
  const both = await jsonRequest(app.baseUrl, RULES);
  assert.deepEqual(
    (await both.json()).rules.map((entry) => [entry.branchName, entry.summaries]),
    [
      ["draft-feature", ["1 approval", "Require status check test"]],
      ["feature-search", ["Require status check test"]],
      ["main", ["1 approval"]],
    ],
  );

  const unnamed = await jsonRequest(app.baseUrl, RULES, {
    method: "POST",
    cookie: alice,
    body: { branchName: "  ", requireApproval: true },
  });
  assert.equal(unnamed.status, 400);
});

test("a non-admin cannot create or change a rule", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const carol = await signIn(app.baseUrl, "carol-dev");
  const bob = await signIn(app.baseUrl, "bob-reviewer");

  for (const cookie of [carol, bob]) {
    const refused = await jsonRequest(app.baseUrl, RULES, {
      method: "POST",
      cookie,
      body: { branchName: "main", requireApproval: true, requireStatusCheck: true },
    });
    assert.equal(refused.status, 403);
  }

  const anonymous = await jsonRequest(app.baseUrl, RULES, {
    method: "POST",
    body: { branchName: "main" },
  });
  assert.equal(anonymous.status, 401);

  // The stored rule is unchanged by the refused attempts, and both non-admins
  // may still read it.
  for (const cookie of [carol, bob]) {
    const list = await jsonRequest(app.baseUrl, RULES, { cookie });
    const rules = (await list.json()).rules;
    assert.deepEqual(rules.map((entry) => [entry.branchName, entry.summaries]), [
      ["main", ["1 approval", "Require status check test"]],
    ]);
  }
});

test("a protected branch rejects direct writes and keeps its content", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const before = await jsonRequest(
    app.baseUrl,
    `${ACME}/file?branch=main&path=README.md`,
  );
  const beforeContent = (await before.json()).file.content;

  const blocked = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: { branch: "main", path: "README.md", content: "bypassed", message: "Bypass" },
  });
  assert.equal(blocked.status, 403);
  assert.equal(
    (await blocked.json()).error,
    "This branch is protected; open a pull request instead.",
  );

  const after = await jsonRequest(app.baseUrl, `${ACME}/file?branch=main&path=README.md`);
  assert.equal((await after.json()).file.content, beforeContent);

  // Another branch of the same repository is not restricted by that rule.
  const other = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: {
      branch: "feature-search",
      path: "notes/protected-branch.md",
      content: "# Notes\n",
      message: "Add branch notes",
    },
  });
  assert.equal(other.status, 201);
});

test("a stored rule survives a restart of the server", async (t) => {
  const dataDir = await newDataDir();
  const first = await startApp(dataDir);
  const alice = await signIn(first.baseUrl, "alice-dev");
  const created = await jsonRequest(first.baseUrl, RULES, {
    method: "POST",
    cookie: alice,
    body: { branchName: "feature-search", requireApproval: true, requireStatusCheck: true },
  });
  assert.equal(created.status, 201);
  await first.close();

  const second = await startApp(dataDir);
  t.after(() => second.close());
  const list = await jsonRequest(second.baseUrl, RULES);
  const rules = (await list.json()).rules;
  assert.deepEqual(rules.map((entry) => [entry.branchName, entry.summaries]), [
    ["feature-search", ["1 approval", "Require status check test"]],
    ["main", ["1 approval", "Require status check test"]],
  ]);
});
