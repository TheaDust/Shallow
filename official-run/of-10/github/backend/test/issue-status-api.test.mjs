import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

/**
 * Closing and reopening an issue (REQ-5-4). The status, its operator, its time and
 * one history record are stored in a single atomic update, only Triage, Maintain
 * and Admin may ask for the transition, and nothing else of the issue changes.
 */

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
  return mkdtemp(join(tmpdir(), "shallowcode-issue-status-"));
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

const ACME_DOCS = "/api/repositories/alice-dev/acme-docs/issues";
const INTERNAL = "/api/repositories/acme-demo/acme-internal/issues";

/** The fields a status transition must leave exactly as they were. */
function identityOf(issue) {
  return {
    number: issue.number,
    title: issue.title,
    description: issue.description,
    labels: issue.labels.map((label) => label.name),
    assignees: issue.assignees,
    milestone: issue.milestone,
    comments: issue.comments.map((comment) => [comment.author, comment.body]),
  };
}

test("a manager closes and reopens the seeded Open issue and keeps its content", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  const before = (await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json()).issue;
  assert.equal(before.status, "open");
  const identity = identityOf(before);

  const closed = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "closed" },
  });
  assert.equal(closed.status, 200);
  const closedIssue = (await closed.json()).issue;
  assert.equal(closedIssue.status, "closed");
  assert.deepEqual(identityOf(closedIssue), identity);
  const closeActivity = closedIssue.activities.at(-1);
  assert.equal(closeActivity.type, "closed");
  assert.equal(closeActivity.actor, "alice-dev");
  assert.equal(typeof closeActivity.createdAt, "string");
  assert.equal(closedIssue.activities.length, before.activities.length + 1);

  const reopened = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "open" },
  });
  assert.equal(reopened.status, 200);
  const reopenedIssue = (await reopened.json()).issue;
  assert.equal(reopenedIssue.status, "open");
  assert.deepEqual(identityOf(reopenedIssue), identity);
  assert.deepEqual(
    reopenedIssue.activities.slice(-2).map((activity) => activity.type),
    ["closed", "reopened"],
  );
  assert.equal(reopenedIssue.activities.at(-1).actor, "alice-dev");

  // Asking for the status the issue already holds appends nothing.
  const repeated = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "open" },
  });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).issue.activities.length, reopenedIssue.activities.length);

  // The list and the detail page read the same persisted status.
  const list = await (await jsonRequest(app.baseUrl, ACME_DOCS)).json();
  assert.equal(list.issues.find((issue) => issue.number === 1).status, "open");

  // The transitions and their final state survive a restart.
  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const reloaded = (await (await jsonRequest(restarted.baseUrl, `${ACME_DOCS}/1`)).json()).issue;
  assert.equal(reloaded.status, "open");
  assert.deepEqual(identityOf(reloaded), identity);
  assert.deepEqual(
    reloaded.activities.slice(-2).map((activity) => activity.type),
    ["closed", "reopened"],
  );
});

test("a Write collaborator may not change the status", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  // `carol-dev` holds Write on `alice-dev/acme-docs`: she may create, edit and
  // comment, but not close or reopen.
  const carol = await signIn(app.baseUrl, "carol-dev");
  const refused = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/status`, {
    method: "POST",
    cookie: carol,
    body: { status: "closed" },
  });
  assert.equal(refused.status, 403);

  const after = (await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json()).issue;
  assert.equal(after.status, "open");
  assert.equal(after.activities.some((activity) => activity.type === "closed"), false);

  // The same holds for a signed-out visitor, who is refused before any role is
  // considered, and for an unknown status value of an authorized manager.
  const anonymous = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/status`, {
    method: "POST",
    body: { status: "closed" },
  });
  assert.equal(anonymous.status, 401);

  const alice = await signIn(app.baseUrl, "alice-dev");
  const unknown = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "archived" },
  });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).fields.status, "Unknown status");
  const stillOpen = (await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json()).issue;
  assert.equal(stillOpen.status, "open");
  assert.equal(stillOpen.activities.length, after.activities.length);
});

test("the Read viewer of the protected issue is refused and the status stays", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const detail = await jsonRequest(app.baseUrl, `${INTERNAL}/1`, { cookie: bob });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).issue.status, "open");

  for (const status of ["closed", "open"]) {
    const refused = await jsonRequest(app.baseUrl, `${INTERNAL}/1/status`, {
      method: "POST",
      cookie: bob,
      body: { status },
    });
    assert.equal(refused.status, 403);
  }

  // An anonymous visitor may not even read the private issue, let alone write it.
  const anonymous = await jsonRequest(app.baseUrl, `${INTERNAL}/1/status`, {
    method: "POST",
    body: { status: "closed" },
  });
  assert.equal(anonymous.status, 404);
  assert.equal(anonymous.status === 403, false);

  // The owner of the repository is its Admin and may still close it.
  const alice = await signIn(app.baseUrl, "alice-dev");
  const closed = await jsonRequest(app.baseUrl, `${INTERNAL}/1/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "closed" },
  });
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).issue.status, "closed");

  // An unknown issue number of a readable repository is not found.
  const missing = await jsonRequest(app.baseUrl, `${INTERNAL}/99/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "closed" },
  });
  assert.equal(missing.status, 404);
});

test("a Triage collaborator may close an issue of the repository", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  // The scenario's preparable state: `bob-reviewer` receives Triage on the
  // repository through the access API, and may then close its issue. The seeded
  // Write grant of that account is replaced by Triage, so the save answers with
  // the replaced record instead of creating a new one.
  const granted = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs/access", {
    method: "POST",
    cookie: alice,
    body: { subjectType: "account", subjectId: "account-bob-reviewer", role: "triage" },
  });
  assert.equal(granted.status, 200);
  assert.equal((await granted.json()).grant.role, "triage");

  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const closed = await jsonRequest(app.baseUrl, `${ACME_DOCS}/3/status`, {
    method: "POST",
    cookie: bob,
    body: { status: "closed" },
  });
  assert.equal(closed.status, 200);
  const issue = (await closed.json()).issue;
  assert.equal(issue.status, "closed");
  assert.equal(issue.activities.at(-1).actor, "bob-reviewer");
});
