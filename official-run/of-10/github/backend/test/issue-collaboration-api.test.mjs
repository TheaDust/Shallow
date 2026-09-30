import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

/**
 * The discussion and metadata writes of an issue (REQ-5-2-3, REQ-5-3): comments,
 * reactions, assignees, labels and the milestone. Every operation is asked for
 * around one repository-scoped number, is checked against the current session
 * and the viewer's role, and answers with the persisted issue.
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
  return mkdtemp(join(tmpdir(), "shallowcode-issue-collaboration-"));
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
const ORGANIZATION_DOCS = "/api/repositories/acme-demo/acme-docs/issues";
const INTERNAL = "/api/repositories/acme-demo/acme-internal/issues";
const ACME_DOCS_LABELS = { bug: "label-repo-alice-dev-acme-docs-bug" };
const OTHER_LABEL = "label-repo-alice-dev-secret-research-bug";
const V1 = "milestone-repo-alice-dev-acme-docs-v1-0";
const Q3 = "milestone-repo-alice-dev-acme-docs-q3-launch";
const OTHER_MILESTONE = "milestone-repo-acme-demo-acme-internal-internal-beta";

test("a writer comments on an issue and the comment survives a restart", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const before = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json();
  const commentsBefore = before.issue.comments.length;

  // The comment needs a session and the write role of this operation.
  const anonymous = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/comments`, {
    method: "POST",
    body: { body: "Anonymous comment" },
  });
  assert.equal(anonymous.status, 401);

  // An account without any role on this public repository may not comment.
  const denied = await signInOutsider(app.baseUrl);
  const refused = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/comments`, {
    method: "POST",
    cookie: denied.cookie,
    body: { body: "Not allowed" },
  });
  assert.equal(refused.status, 403);

  const alice = await signIn(app.baseUrl, "alice-dev");
  for (const invalid of ["   ", "b".repeat(65537)]) {
    const refusedBody = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/comments`, {
      method: "POST",
      cookie: alice,
      body: { body: invalid },
    });
    assert.equal(refusedBody.status, 400);
    assert.equal(typeof (await refusedBody.json()).fields.body, "string");
  }

  const afterFailure = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json();
  assert.equal(afterFailure.issue.comments.length, commentsBefore);

  const commented = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/comments`, {
    method: "POST",
    cookie: alice,
    body: { body: "  The wizard needs a screenshot.  " },
  });
  assert.equal(commented.status, 200);
  const payload = await commented.json();
  const stored = payload.issue.comments.at(-1);
  assert.equal(stored.body, "The wizard needs a screenshot.");
  assert.equal(stored.author, "alice-dev");
  assert.equal(typeof stored.createdAt, "string");
  assert.equal(payload.issue.activities.at(-1).type, "commented");

  // The comment of another issue and the number of the target issue are untouched.
  const other = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/2`)).json();
  assert.deepEqual(other.issue.comments, []);

  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const reread = await (await jsonRequest(restarted.baseUrl, `${ACME_DOCS}/1`)).json();
  assert.equal(reread.issue.comments.at(-1).body, "The wizard needs a screenshot.");
  assert.equal(reread.issue.comments.at(-1).author, "alice-dev");
});

test("a comment of a readable repository is appended by every writer", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  // `carol-dev` holds Write on the repository, so she may comment but not manage.
  const carol = await signIn(app.baseUrl, "carol-dev");
  const commented = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/comments`, {
    method: "POST",
    cookie: carol,
    body: { body: "Confirming the wizard step." },
  });
  assert.equal(commented.status, 200);
  assert.equal((await commented.json()).issue.comments.at(-1).author, "carol-dev");

  const manageRefused = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/assignees`, {
    method: "POST",
    cookie: carol,
    body: { username: "carol-dev", assigned: true },
  });
  assert.equal(manageRefused.status, 403);
});

test("reactions are one association per user, target and type", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const detail = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json();
  const commentId = detail.issue.comments[0].id;

  const anonymous = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/reactions`, {
    method: "POST",
    body: { type: "+1", commentId },
  });
  assert.equal(anonymous.status, 401);

  const alice = await signIn(app.baseUrl, "alice-dev");
  const unknown = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/reactions`, {
    method: "POST",
    cookie: alice,
    body: { type: "sparkle", commentId },
  });
  assert.equal(unknown.status, 400);

  const added = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/reactions`, {
    method: "POST",
    cookie: alice,
    body: { type: "+1", commentId },
  });
  assert.equal(added.status, 200);
  const addedPayload = await added.json();
  const reacting = addedPayload.issue.comments.find((comment) => comment.id === commentId);
  assert.deepEqual(reacting.reactions, [{ type: "+1", count: 1, reacted: true, users: ["alice-dev"] }]);
  // The issue itself carries its own associations, not the comment's.
  assert.deepEqual(addedPayload.issue.reactions, []);

  // The same user selecting the same reaction again removes it instead of
  // storing a second association.
  const removed = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/reactions`, {
    method: "POST",
    cookie: alice,
    body: { type: "+1", commentId },
  });
  assert.equal(removed.status, 200);
  const cleared = (await removed.json()).issue.comments.find((comment) => comment.id === commentId);
  assert.deepEqual(cleared.reactions, []);

  // Two accounts may share one reaction type; each association is their own.
  await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/reactions`, {
    method: "POST",
    cookie: alice,
    body: { type: "heart", commentId },
  });
  const carol = await signIn(app.baseUrl, "carol-dev");
  const shared = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/reactions`, {
    method: "POST",
    cookie: carol,
    body: { type: "heart", commentId },
  });
  const sharedSummary = (await shared.json()).issue.comments.find(
    (comment) => comment.id === commentId,
  );
  assert.deepEqual(sharedSummary.reactions, [
    { type: "heart", count: 2, reacted: true, users: ["alice-dev", "carol-dev"] },
  ]);

  // A signed-in reader who may only read the issue may still react.
  const stored = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json();
  assert.equal(stored.issue.comments[0].reactions[0].count, 2);

  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const replayed = await (await jsonRequest(restarted.baseUrl, `${ACME_DOCS}/1`)).json();
  assert.equal(replayed.issue.comments[0].reactions[0].type, "heart");
  assert.equal(replayed.issue.comments[0].reactions[0].count, 2);
});

test("assignees are the members with at least triage permission", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const before = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`, { cookie: alice })).json();
  // The seed offers one eligible member who is not assigned to the issue yet,
  // and the account outside the repository never appears. `bob-reviewer` and
  // `carol-dev` hold the seeded Write grants of this repository (REQ-6).
  assert.deepEqual(before.assignableMembers, ["alice-dev", "bob-reviewer", "carol-dev"]);

  const assigned = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/assignees`, {
    method: "POST",
    cookie: alice,
    body: { username: "carol-dev", assigned: true },
  });
  assert.equal(assigned.status, 200);
  const assignedIssue = (await assigned.json()).issue;
  assert.deepEqual(assignedIssue.assignees, ["alice-dev", "carol-dev"]);
  assert.equal(assignedIssue.activities.at(-1).type, "assigned");
  assert.equal(assignedIssue.activities.at(-1).to, "carol-dev");

  // An account outside the collaborator scope is refused, and the account and
  // its grants survive an unassignment.
  const outsider = await signInOutsider(app.baseUrl);
  const notAssignable = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/assignees`, {
    method: "POST",
    cookie: alice,
    body: { username: outsider.username, assigned: true },
  });
  assert.equal(notAssignable.status, 400);
  assert.equal(typeof (await notAssignable.json()).fields.username, "string");

  const unassigned = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/assignees`, {
    method: "POST",
    cookie: alice,
    body: { username: "carol-dev", assigned: false },
  });
  assert.equal(unassigned.status, 200);
  const unassignedIssue = (await unassigned.json()).issue;
  assert.deepEqual(unassignedIssue.assignees, ["alice-dev"]);
  assert.equal(unassignedIssue.activities.at(-1).type, "unassigned");
  assert.equal(unassignedIssue.activities.at(-1).from, "carol-dev");
  // The member account and her repository grant still exist.
  const stillThere = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`, { cookie: alice })).json();
  assert.deepEqual(stillThere.assignableMembers, ["alice-dev", "bob-reviewer", "carol-dev"]);

  // A Write viewer may not change the assignees at all.
  const carol = await signIn(app.baseUrl, "carol-dev");
  const refused = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/assignees`, {
    method: "POST",
    cookie: carol,
    body: { username: "alice-dev", assigned: false },
  });
  assert.equal(refused.status, 403);

  // The last saved set is what a later read returns.
  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const reread = await (await jsonRequest(restarted.baseUrl, `${ACME_DOCS}/1`)).json();
  assert.deepEqual(reread.issue.assignees, ["alice-dev"]);
});

test("only labels of the current repository may be applied", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  const applied = await jsonRequest(app.baseUrl, `${ACME_DOCS}/3/labels`, {
    method: "POST",
    cookie: alice,
    body: { labelId: ACME_DOCS_LABELS.bug, applied: true },
  });
  assert.equal(applied.status, 200);
  const appliedIssue = (await applied.json()).issue;
  assert.deepEqual(appliedIssue.labels, [{ id: ACME_DOCS_LABELS.bug, name: "bug", color: "d73a4a" }]);
  assert.equal(appliedIssue.activities.at(-1).type, "labeled");
  assert.equal(appliedIssue.activities.at(-1).to, "bug");

  // The selector of this repository never offers a label of another repository,
  // and such a label may not be associated from here.
  const options = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/3`)).json();
  assert.deepEqual(
    options.labels.map((label) => label.name),
    ["bug", "documentation"],
  );
  const foreign = await jsonRequest(app.baseUrl, `${ACME_DOCS}/3/labels`, {
    method: "POST",
    cookie: alice,
    body: { labelId: OTHER_LABEL, applied: true },
  });
  assert.equal(foreign.status, 400);
  const stored = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/3`)).json();
  assert.deepEqual(
    stored.issue.labels.map((label) => label.name),
    ["bug"],
  );

  // Selecting the same option again removes the association.
  const removed = await jsonRequest(app.baseUrl, `${ACME_DOCS}/3/labels`, {
    method: "POST",
    cookie: alice,
    body: { labelId: ACME_DOCS_LABELS.bug, applied: false },
  });
  assert.equal(removed.status, 200);
  const removedIssue = (await removed.json()).issue;
  assert.deepEqual(removedIssue.labels, []);
  assert.equal(removedIssue.activities.at(-1).type, "unlabeled");
  assert.equal(removedIssue.activities.at(-1).from, "bug");

  // The other issue keeps its own labels.
  const other = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json();
  assert.deepEqual(
    other.issue.labels.map((label) => label.name),
    ["bug"],
  );
});

test("a work item is associated with at most one milestone of its repository", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  const set = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/milestone`, {
    method: "POST",
    cookie: alice,
    body: { milestoneId: V1 },
  });
  assert.equal(set.status, 200);
  const moved = (await set.json()).issue;
  assert.equal(moved.milestone.title, "v1.0");
  assert.equal(moved.activities.at(-1).type, "milestoned");
  assert.equal(moved.activities.at(-1).to, "v1.0");

  // A milestone of another repository is refused instead of being associated.
  const foreign = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/milestone`, {
    method: "POST",
    cookie: alice,
    body: { milestoneId: OTHER_MILESTONE },
  });
  assert.equal(foreign.status, 400);
  const stillV1 = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json();
  assert.equal(stillV1.issue.milestone.title, "v1.0");
  assert.deepEqual(
    stillV1.milestones.map((milestone) => milestone.title),
    ["Q3 launch", "v1.0"],
  );

  // None deletes the association.
  const cleared = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/milestone`, {
    method: "POST",
    cookie: alice,
    body: { milestoneId: null },
  });
  assert.equal(cleared.status, 200);
  const withoutMilestone = (await cleared.json()).issue;
  assert.equal(withoutMilestone.milestone, null);
  assert.equal(withoutMilestone.activities.at(-1).type, "unmilestoned");
  assert.equal(withoutMilestone.activities.at(-1).from, "v1.0");

  // A Write viewer only reads the milestone of this repository.
  const carol = await signIn(app.baseUrl, "carol-dev");
  const refused = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/milestone`, {
    method: "POST",
    cookie: carol,
    body: { milestoneId: Q3 },
  });
  assert.equal(refused.status, 403);

  // The other repository keeps its own milestone list.
  const internal = await (await jsonRequest(app.baseUrl, `${INTERNAL}/1`, {
    cookie: await signIn(app.baseUrl, "bob-reviewer"),
  })).json();
  assert.deepEqual(
    internal.milestones.map((milestone) => milestone.title),
    ["Internal beta"],
  );
});

test("the organization repository carries its own planning records", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  const detail = await (await jsonRequest(app.baseUrl, `${ORGANIZATION_DOCS}/1`, { cookie: alice })).json();
  assert.deepEqual(
    detail.labels.map((label) => label.name),
    ["bug", "documentation"],
  );
  assert.deepEqual(
    detail.milestones.map((milestone) => milestone.title),
    ["Q3 launch", "v1.0"],
  );
  assert.deepEqual(detail.assignableMembers, ["alice-dev", "carol-dev"]);

  const commented = await jsonRequest(app.baseUrl, `${ORGANIZATION_DOCS}/1/comments`, {
    method: "POST",
    cookie: alice,
    body: { body: "A comment in the organization repository." },
  });
  assert.equal(commented.status, 200);
  assert.equal((await commented.json()).issue.comments.at(-1).author, "alice-dev");
});
