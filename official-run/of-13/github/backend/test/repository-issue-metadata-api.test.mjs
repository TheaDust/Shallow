// The issue metadata API: assigning and unassigning participants, applying and
// removing labels of the current repository, setting or clearing the single
// milestone association and closing or reopening an issue. Each operation
// reads the stored relationship of the signed-in account, so Write alone never
// triages, and every accepted write answers the persisted detail payload.

import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };
const BOB = { username: "bob-reviewer", password: "Valid-password-123!" };

const ISSUE = "/api/repositories/acme-demo/acme-docs/issues/1";

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, { username, password }) {
  const response = await call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier: username, password },
  });
  assert.equal(response.status, 200);
  return response.setCookie?.split(";")[0] ?? null;
}

/** Grants one repository role through the public access-management operation. */
async function grant(app, adminCookie, subjectName, role) {
  const response = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/access", {
    method: "PUT",
    cookie: adminCookie,
    body: { subjectType: "account", subjectName, role },
  });
  assert.equal(response.status, 200);
}

test("a visitor and a viewer without Triage cannot change issue metadata", async () => {
  await withApp(async (app) => {
    const anonymous = await call(app.baseUrl, `${ISSUE}/assignees`, {
      method: "POST",
      body: { username: "alice-dev" },
    });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error, "Not authenticated");

    // `bob-reviewer` is an organization member without a repository role.
    const bobCookie = await signIn(app, BOB);
    for (const [path, body] of [
      ["assignees", { username: "alice-dev" }],
      ["labels", { name: "bug" }],
      ["milestone", { title: "v1.0" }],
      ["state", { state: "closed" }],
    ]) {
      const response = await call(app.baseUrl, `${ISSUE}/${path}`, {
        method: "POST",
        cookie: bobCookie,
        body,
      });
      assert.equal(response.status, 403, `${path} is refused`);
      assert.equal(response.body.error, "Access denied");
    }

    const unchanged = await call(app.baseUrl, ISSUE, { cookie: bobCookie });
    assert.equal(unchanged.status, 200);
    assert.deepEqual(unchanged.body.issue.assignees, []);
    assert.deepEqual(
      unchanged.body.issue.labels.map((label) => label.name),
      ["documentation"],
    );
    assert.equal(unchanged.body.issue.state, "open");
    assert.equal(unchanged.body.issue.milestone.title, "Q3 launch");
  });
});

test("a Write collaborator may edit the issue but never its metadata", async () => {
  await withApp(async (app) => {
    const aliceCookie = await signIn(app, ALICE);
    await grant(app, aliceCookie, "bob-reviewer", "write");
    const bobCookie = await signIn(app, BOB);

    const detail = await call(app.baseUrl, ISSUE, { cookie: bobCookie });
    assert.equal(detail.body.viewerRole, "write");
    assert.equal(detail.body.canWrite, true);
    assert.equal(detail.body.canTriage, false);
    // The picker candidates stay hidden from a viewer who cannot triage.
    assert.deepEqual(detail.body.assigneeCandidates, []);

    const edit = await call(app.baseUrl, ISSUE, {
      method: "PATCH",
      cookie: bobCookie,
      body: { description: "Describe the onboarding improvement." },
    });
    assert.equal(edit.status, 200);

    const assign = await call(app.baseUrl, `${ISSUE}/assignees`, {
      method: "POST",
      cookie: bobCookie,
      body: { username: "alice-dev" },
    });
    assert.equal(assign.status, 403);

    const close = await call(app.baseUrl, `${ISSUE}/state`, {
      method: "POST",
      cookie: bobCookie,
      body: { state: "closed" },
    });
    assert.equal(close.status, 403);
    const after = await call(app.baseUrl, ISSUE, { cookie: bobCookie });
    assert.equal(after.body.issue.state, "open");
  });
});

test("an assignee is stored with its operator and time, unassigned again, and survives a restart", async () => {
  await withApp(async (app) => {
    const aliceCookie = await signIn(app, ALICE);

    // The Owner holds Admin permission, so she is the first eligible seeded
    // member; the Write reviewer of the pull-request requirements is the other.
    const before = await call(app.baseUrl, ISSUE, { cookie: aliceCookie });
    assert.deepEqual(before.body.assigneeCandidates, [
      "alice-dev",
      "bob-reviewer",
      "carol-maintainer",
    ]);
    assert.deepEqual(before.body.issue.assignees, []);

    const assigned = await call(app.baseUrl, `${ISSUE}/assignees`, {
      method: "POST",
      cookie: aliceCookie,
      body: { username: "alice-dev" },
    });
    assert.equal(assigned.status, 200);
    assert.deepEqual(assigned.body.issue.assignees, ["alice-dev"]);
    const assignmentEvent = assigned.body.events.at(-1);
    assert.equal(assignmentEvent.type, "assigned");
    assert.equal(assignmentEvent.actor, "alice-dev");
    assert.equal(assignmentEvent.data.assignee, "alice-dev");
    assert.equal(typeof assignmentEvent.createdAt, "string");
    // The account keeps existing and no repository grant is created.
    assert.deepEqual(assigned.body.assigneeCandidates, [
      "alice-dev",
      "bob-reviewer",
      "carol-maintainer",
    ]);

    // Assigning the same member again is a no-op that appends no record.
    const repeated = await call(app.baseUrl, `${ISSUE}/assignees`, {
      method: "POST",
      cookie: aliceCookie,
      body: { username: "alice-dev", assigned: true },
    });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.events.length, assigned.body.events.length);

    await app.restart();
    const reloaded = await call(app.baseUrl, ISSUE, { cookie: aliceCookie });
    assert.deepEqual(reloaded.body.issue.assignees, ["alice-dev"]);

    const unassigned = await call(app.baseUrl, `${ISSUE}/assignees`, {
      method: "POST",
      cookie: aliceCookie,
      body: { username: "alice-dev" },
    });
    assert.equal(unassigned.status, 200);
    assert.deepEqual(unassigned.body.issue.assignees, []);
    assert.equal(unassigned.body.events.at(-1).type, "unassigned");
    // The historical assignment stays in the append-only timeline.
    assert.equal(
      unassigned.body.events.filter((event) => event.type === "assigned").length,
      1,
    );

    // The account itself, its credentials and its grants are untouched.
    const session = await call(app.baseUrl, "/api/session", { cookie: aliceCookie });
    assert.equal(session.body.account.username, "alice-dev");
  });
});

test("a member outside the collaborator scope is refused as an assignee", async () => {
  await withApp(async (app) => {
    const aliceCookie = await signIn(app, ALICE);
    // `bob-reviewer` may be assigned while he holds Write; once his grant drops
    // below Triage he is outside the collaborator scope of the picker again.
    await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/access", {
      method: "PUT",
      cookie: aliceCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "read" },
    });
    const response = await call(app.baseUrl, `${ISSUE}/assignees`, {
      method: "POST",
      cookie: aliceCookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Issue metadata not saved");
    assert.equal(response.body.fieldErrors.username, "Member is not assignable");

    const unknown = await call(app.baseUrl, `${ISSUE}/assignees`, {
      method: "POST",
      cookie: aliceCookie,
      body: { username: "nobody-here" },
    });
    assert.equal(unknown.status, 400);

    const detail = await call(app.baseUrl, ISSUE, { cookie: aliceCookie });
    assert.deepEqual(detail.body.issue.assignees, []);
    const list = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues", {
      cookie: aliceCookie,
    });
    const row = list.body.issues.find((issue) => issue.number === 1);
    assert.deepEqual(row.labels.map((label) => label.name), ["documentation"]);
  });
});

test("a label of the current repository is applied and removed, never one of another repository", async () => {
  await withApp(async (app) => {
    const aliceCookie = await signIn(app, ALICE);

    const detail = await call(app.baseUrl, ISSUE, { cookie: aliceCookie });
    assert.deepEqual(
      detail.body.labels.map((label) => label.name),
      ["bug", "documentation"],
    );

    const applied = await call(app.baseUrl, `${ISSUE}/labels`, {
      method: "POST",
      cookie: aliceCookie,
      body: { name: "bug", applied: true },
    });
    assert.equal(applied.status, 200);
    assert.deepEqual(
      applied.body.issue.labels.map((label) => label.name).sort(),
      ["bug", "documentation"],
    );
    // The stored association points at the `bug` label of `acme-docs`, not at
    // the same-named label of `bob-notes`.
    const bug = applied.body.issue.labels.find((label) => label.name === "bug");
    assert.equal(bug.description, "Something is not working");
    assert.equal(applied.body.events.at(-1).type, "labeled");
    assert.equal(applied.body.events.at(-1).data.labelName, "bug");

    // The list row shows the same persisted label.
    const list = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues", {
      cookie: aliceCookie,
    });
    const row = list.body.issues.find((issue) => issue.number === 1);
    assert.deepEqual(row.labels.map((label) => label.name).sort(), ["bug", "documentation"]);

    const removed = await call(app.baseUrl, `${ISSUE}/labels`, {
      method: "POST",
      cookie: aliceCookie,
      body: { name: "bug" },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(
      removed.body.issue.labels.map((label) => label.name),
      ["documentation"],
    );
    assert.equal(removed.body.events.at(-1).type, "unlabeled");

    // A label that this repository does not define is refused, so the picker
    // can never attach a label of another repository.
    const foreign = await call(app.baseUrl, `${ISSUE}/labels`, {
      method: "POST",
      cookie: aliceCookie,
      body: { name: "not-a-label" },
    });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.fieldErrors.name, "Label is not supported");
  });
});

test("a milestone is associated, replaced by None and never taken from another repository", async () => {
  await withApp(async (app) => {
    const aliceCookie = await signIn(app, ALICE);

    const detail = await call(app.baseUrl, ISSUE, { cookie: aliceCookie });
    assert.deepEqual(
      detail.body.milestones.map((milestone) => milestone.title),
      ["Q3 launch", "v1.0"],
    );

    const assigned = await call(app.baseUrl, `${ISSUE}/milestone`, {
      method: "POST",
      cookie: aliceCookie,
      body: { title: "v1.0" },
    });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.issue.milestone.title, "v1.0");
    assert.equal(assigned.body.events.at(-1).type, "milestoned");
    assert.equal(assigned.body.events.at(-1).data.milestoneTitle, "v1.0");
    // The association never touches the content or the status of the issue.
    assert.equal(assigned.body.issue.title, "Improve onboarding");
    assert.equal(assigned.body.issue.state, "open");

    const cleared = await call(app.baseUrl, `${ISSUE}/milestone`, {
      method: "POST",
      cookie: aliceCookie,
      body: { title: null },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.issue.milestone, null);
    assert.equal(cleared.body.events.at(-1).type, "unmilestoned");

    // `Personal backlog` belongs to `bob-notes`, so it is not selectable here.
    const foreign = await call(app.baseUrl, `${ISSUE}/milestone`, {
      method: "POST",
      cookie: aliceCookie,
      body: { title: "Personal backlog" },
    });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.fieldErrors.title, "Milestone is not supported");

    await app.restart();
    const reloaded = await call(app.baseUrl, ISSUE, { cookie: aliceCookie });
    assert.equal(reloaded.body.issue.milestone, null);
  });
});

test("closing and reopening keep every other field and stay visible to later readers", async () => {
  await withApp(async (app) => {
    const aliceCookie = await signIn(app, ALICE);
    const before = await call(app.baseUrl, ISSUE, { cookie: aliceCookie });

    const closed = await call(app.baseUrl, `${ISSUE}/state`, {
      method: "POST",
      cookie: aliceCookie,
      body: { state: "closed" },
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.issue.state, "closed");
    assert.equal(closed.body.issue.closedBy, "alice-dev");
    assert.equal(typeof closed.body.issue.closedAt, "string");
    assert.equal(closed.body.events.at(-1).type, "closed");

    const { issue: closedIssue } = closed.body;
    const { issue: beforeIssue } = before.body;
    assert.equal(closedIssue.number, beforeIssue.number);
    assert.equal(closedIssue.title, beforeIssue.title);
    assert.equal(closedIssue.body, beforeIssue.body);
    assert.equal(closedIssue.milestone.title, beforeIssue.milestone.title);
    assert.deepEqual(closedIssue.labels, beforeIssue.labels);
    assert.deepEqual(closedIssue.assignees, beforeIssue.assignees);
    assert.equal(closed.body.comments.length, before.body.comments.length);

    await app.restart();
    const list = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues", {
      cookie: aliceCookie,
    });
    const row = list.body.issues.find((issue) => issue.number === 1);
    assert.equal(row.state, "closed");
    assert.deepEqual(list.body.counts, { open: 1, closed: 2, all: 3 });

    const reopened = await call(app.baseUrl, `${ISSUE}/state`, {
      method: "POST",
      cookie: aliceCookie,
      body: { state: "open" },
    });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.issue.state, "open");
    assert.equal(reopened.body.issue.closedAt, null);
    assert.equal(reopened.body.events.at(-1).type, "reopened");
    assert.deepEqual(
      reopened.body.events
        .filter((event) => event.type === "closed" || event.type === "reopened")
        .map((event) => event.type),
      ["closed", "reopened"],
    );

    const invalid = await call(app.baseUrl, `${ISSUE}/state`, {
      method: "POST",
      cookie: aliceCookie,
      body: { state: "merged" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.state, "State is not supported");

    // A visitor reads the same final record without any metadata control.
    const visitor = await call(app.baseUrl, ISSUE);
    assert.equal(visitor.status, 200);
    assert.equal(visitor.body.issue.state, "open");
    assert.equal(visitor.body.canTriage, false);
    assert.deepEqual(visitor.body.assigneeCandidates, []);
  });
});
