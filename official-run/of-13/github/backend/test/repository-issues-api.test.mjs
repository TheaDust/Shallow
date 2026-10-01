import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };

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

test("a visitor lists the seeded issues of the public repository with number, status, author and labels", async () => {
  await withApp(async (app) => {
    const response = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues");
    assert.equal(response.status, 200);
    assert.equal(response.body.repository.name, "acme-docs");
    assert.equal(response.body.repository.owner, "acme-demo");
    assert.equal(response.body.repository.visibility, "public");
    assert.equal(response.body.repository.viewerRole, null);

    // The closed issue and the invalid-edit seed are stored with their exact titles.
    assert.deepEqual(
      response.body.issues.map((issue) => [issue.number, issue.title, issue.state]),
      [
        [3, "Original issue title", "open"],
        [2, "Legacy welcome text", "closed"],
        [1, "Improve onboarding", "open"],
      ],
    );

    const [invalidEditSeed, closed, open] = response.body.issues;
    assert.equal(open.author, "alice-dev");
    assert.equal(open.body, "Describe the onboarding improvement.");
    // The open issue carries `documentation`; `bug` stays an existing label of
    // the repository that no seeded open issue holds yet.
    assert.deepEqual(
      open.labels.map((label) => label.name),
      ["documentation"],
    );
    assert.equal(open.milestone.title, "Q3 launch");
    assert.equal(open.commentCount, 1);
    assert.equal(typeof open.updatedAt, "string");

    assert.deepEqual(
      invalidEditSeed.labels.map((label) => label.name),
      [],
    );
    assert.deepEqual(
      closed.labels.map((label) => label.name),
      ["bug"],
    );

    assert.deepEqual(
      response.body.labels.map((label) => label.name),
      ["bug", "documentation"],
    );
    // Every milestone of the repository, including the selectable `v1.0`.
    assert.deepEqual(
      response.body.milestones.map((milestone) => milestone.title),
      ["Q3 launch", "v1.0"],
    );
    assert.deepEqual(response.body.counts, { open: 2, closed: 1, all: 3 });
  });
});

test("a visitor reads the detail of the seeded open issue with description, metadata, comments and timeline", async () => {
  await withApp(async (app) => {
    const response = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues/1");
    assert.equal(response.status, 200);
    const { issue, comments, events } = response.body;

    assert.equal(issue.number, 1);
    assert.equal(issue.title, "Improve onboarding");
    assert.equal(issue.body, "Describe the onboarding improvement.");
    assert.equal(issue.state, "open");
    assert.equal(issue.author, "alice-dev");
    // The seeded open issue starts without an assignee, so the assignment
    // scenario adds and removes exactly one participant.
    assert.deepEqual(issue.assignees, []);
    assert.deepEqual(
      issue.labels.map((label) => label.name),
      ["documentation"],
    );
    assert.equal(issue.milestone.title, "Q3 launch");
    assert.deepEqual(
      response.body.labels.map((label) => label.name),
      ["bug", "documentation"],
    );
    assert.deepEqual(
      response.body.milestones.map((milestone) => milestone.title),
      ["Q3 launch", "v1.0"],
    );
    assert.equal(response.body.canTriage, false);
    assert.deepEqual(response.body.assigneeCandidates, []);

    assert.equal(comments.length, 1);
    assert.equal(comments[0].author, "alice-dev");
    assert.equal(comments[0].body, "Start with the first-run checklist.");

    // Creation and the comment are recorded in chronological order.
    assert.deepEqual(
      events.map((event) => event.type),
      ["created", "labeled", "milestoned", "commented"],
    );
    const times = events.map((event) => event.createdAt);
    assert.deepEqual(times, [...times].sort((left, right) => left.localeCompare(right)));
    assert.equal(events[0].actor, "alice-dev");
    assert.equal(events.at(-1).type, "commented");

    // A visitor without a repository relationship never gets a write gate.
    assert.equal(response.body.viewerRole, null);
    assert.equal(response.body.canWrite, false);
    assert.equal(response.body.canTriage, false);
  });
});

test("the issue detail answers the same record for the `#number` form and after a restart", async () => {
  await withApp(async (app) => {
    const plain = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues/2");
    assert.equal(plain.status, 200);
    assert.equal(plain.body.issue.title, "Legacy welcome text");
    assert.equal(plain.body.issue.state, "closed");
    assert.equal(plain.body.issue.closedBy, "alice-dev");
    assert.deepEqual(plain.body.issue.assignees, []);
    assert.equal(plain.body.issue.milestone, null);

    const hashed = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues/%232");
    assert.equal(hashed.status, 200);
    assert.equal(hashed.body.issue.number, 2);

    await app.restart();
    const reopened = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues/2");
    assert.equal(reopened.status, 200);
    assert.deepEqual(reopened.body.issue, plain.body.issue);
  });
});

test("an unknown repository, an unknown number and an unreadable private repository are refused", async () => {
  await withApp(async (app) => {
    const unknownRepository = await call(app.baseUrl, "/api/repositories/acme-demo/missing/issues");
    assert.equal(unknownRepository.status, 404);

    const unknownNumber = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues/99");
    assert.equal(unknownNumber.status, 404);

    // `secret-research` is private and holds no issues.
    const privateList = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research/issues");
    assert.equal(privateList.status, 403);
    assert.equal(privateList.body.error, "Access denied");

    const privateDetail = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/issues/1",
    );
    assert.equal(privateDetail.status, 403);

    const writeMethod = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues", {
      method: "POST",
      body: { title: "Anything" },
    });
    // Writing an issue needs a session; a visitor is refused, not routed to 404.
    assert.equal(writeMethod.status, 401);
    assert.equal(writeMethod.body.error, "Not authenticated");
  });
});

test("the organization Owner reads the same issues with the Admin write gates", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const list = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues", { cookie });
    assert.equal(list.status, 200);
    assert.equal(list.body.repository.viewerRole, "admin");
    assert.equal(list.body.issues.length, 3);

    const detail = await call(app.baseUrl, "/api/repositories/acme-demo/acme-docs/issues/1", {
      cookie,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.viewerRole, "admin");
    assert.equal(detail.body.canWrite, true);
    assert.equal(detail.body.canTriage, true);
    // The Owner is the seeded account holding Triage or higher on `acme-docs`,
    // together with the Write reviewer of the pull-request requirements, so
    // the Assignees picker offers exactly those two members.
    assert.deepEqual(detail.body.assigneeCandidates, [
      "alice-dev",
      "bob-reviewer",
      "carol-maintainer",
    ]);

    const privateList = await call(
      app.baseUrl,
      "/api/repositories/acme-demo/secret-research/issues",
      { cookie },
    );
    assert.equal(privateList.status, 200);
    assert.deepEqual(privateList.body.issues, []);
  });
});
