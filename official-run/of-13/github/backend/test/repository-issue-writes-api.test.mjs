import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };
const BOB = { username: "bob-reviewer", password: "Valid-password-123!" };

const ISSUES = "/api/repositories/acme-demo/acme-docs/issues";
const SEED_COMMENT = "issue-comment-acme-docs-1-1";

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

async function numbers(app, cookie) {
  const response = await call(app.baseUrl, ISSUES, { cookie });
  assert.equal(response.status, 200);
  return response.body.issues.map((issue) => issue.number);
}

/**
 * `bob-reviewer` holds the seeded Write grant of the pull-request
 * requirements; a Read grant of the same repository is not Write, so the
 * refused-write scenarios start by giving him exactly that role.
 */
async function withReadOnlyMember(app) {
  const adminCookie = await signIn(app, ALICE);
  const granted = await call(
    app.baseUrl,
    "/api/repositories/acme-demo/acme-docs/access",
    {
      method: "PUT",
      cookie: adminCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "read" },
    },
  );
  assert.equal(granted.status, 200);
  return signIn(app, BOB);
}

test("an issue-write user creates an issue that the list and the detail page then show", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const created = await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie,
      body: { title: "  Add a troubleshooting guide  ", description: "Write the guide." },
    });

    assert.equal(created.status, 201);
    // The number follows the highest stored number of this repository and the
    // title is stored without its surrounding whitespace.
    assert.equal(created.body.issue.number, 4);
    assert.equal(created.body.issue.title, "Add a troubleshooting guide");
    assert.equal(created.body.issue.body, "Write the guide.");
    assert.equal(created.body.issue.state, "open");
    assert.equal(created.body.issue.author, "alice-dev");
    assert.deepEqual(created.body.issue.assignees, []);
    assert.deepEqual(created.body.issue.labels, []);
    assert.equal(created.body.issue.milestone, null);
    assert.equal(created.body.repository.name, "acme-docs");
    assert.equal(created.body.canWrite, true);
    // The creation activity is appended at creation time.
    assert.equal(created.body.events.at(-1).type, "created");
    assert.equal(created.body.events.at(-1).actor, "alice-dev");
    assert.deepEqual(created.body.comments, []);

    // The list locates the new issue by its number and status.
    const list = await call(app.baseUrl, ISSUES, { cookie });
    assert.deepEqual(
      list.body.issues.map((issue) => issue.number),
      [4, 3, 2, 1],
    );
    assert.deepEqual(list.body.counts, { open: 3, closed: 1, all: 4 });
    const row = list.body.issues.find((issue) => issue.number === 4);
    assert.equal(row.title, "Add a troubleshooting guide");
    assert.equal(row.state, "open");

    const detail = await call(app.baseUrl, `${ISSUES}/4`, { cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.issue.title, "Add a troubleshooting guide");
    assert.equal(detail.body.issue.body, "Write the guide.");

    // The record is persisted, so a restart of the service reads it again.
    await app.restart();
    const reopened = await call(app.baseUrl, `${ISSUES}/4`);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.issue.title, "Add a troubleshooting guide");
    assert.equal(reopened.body.issue.author, "alice-dev");
    assert.equal(reopened.body.issue.state, "open");
  });
});

test("a blank, overlong or unauthorized submission allocates no number", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const before = await numbers(app, cookie);

    const blank = await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie,
      // A title of three spaces is blank after trimming.
      body: { title: "   ", description: "" },
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "Issue not created");
    assert.equal(blank.body.fieldErrors.title, "Title is required");

    const overlong = await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie,
      body: { title: "x".repeat(257) },
    });
    assert.equal(overlong.status, 400);
    assert.equal(overlong.body.fieldErrors.title, "Title must be 256 characters or fewer");

    const overlongDescription = await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie,
      body: { title: "Valid title", description: "y".repeat(65537) },
    });
    assert.equal(overlongDescription.status, 400);
    assert.equal(
      overlongDescription.body.fieldErrors.description,
      "Description must be 65536 characters or fewer",
    );

    const visitor = await call(app.baseUrl, ISSUES, { method: "POST", body: { title: "Nope" } });
    assert.equal(visitor.status, 401);

    // A member holding only Read may read the public repository but may not
    // create an issue in it.
    const memberCookie = await withReadOnlyMember(app);
    const member = await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie: memberCookie,
      body: { title: "Nope" },
    });
    assert.equal(member.status, 403);
    assert.equal(member.body.error, "Access denied");

    // The empty description is allowed, and the title limit is exactly 256.
    const atLimit = await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie,
      body: { title: "t".repeat(256), description: "" },
    });
    assert.equal(atLimit.status, 201);
    assert.equal(atLimit.body.issue.body, "");

    // Only the accepted submission consumed a number.
    assert.deepEqual(await numbers(app, cookie), [4, ...before]);
  });
});

test("no refused submission added an issue", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const before = await numbers(app, cookie);

    await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie,
      body: { title: "   " },
    });
    await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie,
      body: { title: "x".repeat(257) },
    });
    await call(app.baseUrl, ISSUES, {
      method: "POST",
      cookie,
      body: { title: "Valid title", description: "y".repeat(65537) },
    });
    await call(app.baseUrl, ISSUES, { method: "POST", body: { title: "Nope" } });
    const memberCookie = await withReadOnlyMember(app);
    await call(app.baseUrl, ISSUES, { method: "POST", cookie: memberCookie, body: { title: "Nope" } });

    assert.deepEqual(await numbers(app, cookie), before);
  });
});

test("only the submitted field of an issue changes, and a refused save keeps the original", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);

    const original = await call(app.baseUrl, `${ISSUES}/3`, { cookie });
    assert.equal(original.body.issue.title, "Original issue title");
    assert.equal(original.body.issue.body, "Describe the original issue.");

    const titleSaved = await call(app.baseUrl, `${ISSUES}/3`, {
      method: "PATCH",
      cookie,
      body: { title: "  Renamed issue title  " },
    });
    assert.equal(titleSaved.status, 200);
    assert.equal(titleSaved.body.issue.title, "Renamed issue title");
    // The description of the same issue is untouched by a title save.
    assert.equal(titleSaved.body.issue.body, "Describe the original issue.");
    assert.equal(titleSaved.body.events.at(-1).type, "edited");
    assert.equal(titleSaved.body.events.at(-1).data.field, "title");
    assert.equal(titleSaved.body.events.at(-1).actor, "alice-dev");

    // A blank title is refused and the stored title stays the saved one.
    const blank = await call(app.baseUrl, `${ISSUES}/3`, {
      method: "PATCH",
      cookie,
      body: { title: "   " },
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "Issue not saved");
    assert.equal(blank.body.fieldErrors.title, "Title is required");
    const afterBlank = await call(app.baseUrl, `${ISSUES}/3`);
    assert.equal(afterBlank.body.issue.title, "Renamed issue title");

    // An overlong title is refused too.
    const overlong = await call(app.baseUrl, `${ISSUES}/3`, {
      method: "PATCH",
      cookie,
      body: { title: "z".repeat(257) },
    });
    assert.equal(overlong.status, 400);
    assert.equal(overlong.body.fieldErrors.title, "Title must be 256 characters or fewer");

    const descriptionSaved = await call(app.baseUrl, `${ISSUES}/3`, {
      method: "PATCH",
      cookie,
      body: { description: "Describe the renamed issue." },
    });
    assert.equal(descriptionSaved.status, 200);
    assert.equal(descriptionSaved.body.issue.body, "Describe the renamed issue.");
    assert.equal(descriptionSaved.body.issue.title, "Renamed issue title");
    assert.equal(descriptionSaved.body.events.at(-1).data.field, "description");

    // The issue list summary shows the new title, and both edits survive a
    // restart of the service.
    await app.restart();
    const reloaded = await call(app.baseUrl, `${ISSUES}/3`);
    assert.equal(reloaded.body.issue.title, "Renamed issue title");
    assert.equal(reloaded.body.issue.body, "Describe the renamed issue.");
    const list = await call(app.baseUrl, ISSUES);
    const row = list.body.issues.find((issue) => issue.number === 3);
    assert.equal(row.title, "Renamed issue title");
    // Neither the status nor the metadata of the edited issue changed.
    assert.equal(row.state, "open");
    assert.deepEqual(row.labels, []);
    assert.deepEqual(row.milestone, null);
    assert.equal(list.body.issues.find((issue) => issue.number === 1).title, "Improve onboarding");
  });
});

test("a save without a session, without a permission or without a field is refused", async () => {
  await withApp(async (app) => {
    const visitor = await call(app.baseUrl, `${ISSUES}/3`, {
      method: "PATCH",
      body: { title: "Nope" },
    });
    assert.equal(visitor.status, 401);

    const memberCookie = await withReadOnlyMember(app);
    const member = await call(app.baseUrl, `${ISSUES}/3`, {
      method: "PATCH",
      cookie: memberCookie,
      body: { title: "Nope" },
    });
    assert.equal(member.status, 403);

    const cookie = await signIn(app, ALICE);
    const empty = await call(app.baseUrl, `${ISSUES}/3`, { method: "PATCH", cookie, body: {} });
    assert.equal(empty.status, 400);

    const unknown = await call(app.baseUrl, `${ISSUES}/99`, {
      method: "PATCH",
      cookie,
      body: { title: "Nope" },
    });
    assert.equal(unknown.status, 404);
  });
});

test("a comment is appended as its own record and a blank or overlong one is refused", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);
    const before = await call(app.baseUrl, `${ISSUES}/1`);

    const created = await call(app.baseUrl, `${ISSUES}/1/comments`, {
      method: "POST",
      cookie,
      body: { body: "  Please add the checklist.  " },
    });
    assert.equal(created.status, 201);
    const comment = created.body.comments.at(-1);
    assert.equal(comment.body, "Please add the checklist.");
    assert.equal(comment.author, "alice-dev");
    assert.equal(typeof comment.createdAt, "string");
    assert.equal(created.body.events.at(-1).type, "commented");
    assert.equal(created.body.comments.length, before.body.comments.length + 1);

    const blank = await call(app.baseUrl, `${ISSUES}/1/comments`, {
      method: "POST",
      cookie,
      body: { body: "   \n  " },
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.fieldErrors.comment, "Comment is required");

    const overlong = await call(app.baseUrl, `${ISSUES}/1/comments`, {
      method: "POST",
      cookie,
      body: { body: "c".repeat(65537) },
    });
    assert.equal(overlong.status, 400);
    assert.equal(overlong.body.fieldErrors.comment, "Comment must be 65536 characters or fewer");

    const visitor = await call(app.baseUrl, `${ISSUES}/1/comments`, {
      method: "POST",
      body: { body: "Nope" },
    });
    assert.equal(visitor.status, 401);

    const memberCookie = await withReadOnlyMember(app);
    const member = await call(app.baseUrl, `${ISSUES}/1/comments`, {
      method: "POST",
      cookie: memberCookie,
      body: { body: "Nope" },
    });
    assert.equal(member.status, 403);

    // Only the accepted comment was stored, and it survives a restart.
    await app.restart();
    const reloaded = await call(app.baseUrl, `${ISSUES}/1`);
    assert.equal(reloaded.body.comments.length, before.body.comments.length + 1);
    assert.equal(reloaded.body.comments.at(-1).body, "Please add the checklist.");
  });
});

test("a reaction is stored once per account, target and type, and selecting it again removes it", async () => {
  await withApp(async (app) => {
    const bobCookie = await signIn(app, BOB);

    const added = await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      cookie: bobCookie,
      body: { reaction: "thumbs_up", commentId: SEED_COMMENT },
    });
    assert.equal(added.status, 200);
    const comment = added.body.comments.find((entry) => entry.id === SEED_COMMENT);
    assert.deepEqual(comment.reactions, [{ reaction: "thumbs_up", count: 1, reacted: true }]);
    assert.deepEqual(added.body.issue.reactions, []);
    assert.equal(added.body.events.at(-1).type, "reacted");

    // Selecting the same reaction a second time removes the association.
    const removed = await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      cookie: bobCookie,
      body: { reaction: "thumbs_up", commentId: SEED_COMMENT },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(
      removed.body.comments.find((entry) => entry.id === SEED_COMMENT).reactions,
      [],
    );
    assert.equal(removed.body.events.at(-1).type, "unreacted");

    // Two accounts on the same comment and reaction yield a count of two.
    const aliceCookie = await signIn(app, ALICE);
    await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      cookie: bobCookie,
      body: { reaction: "heart", commentId: SEED_COMMENT },
    });
    const both = await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      cookie: aliceCookie,
      body: { reaction: "heart", commentId: SEED_COMMENT },
    });
    assert.deepEqual(both.body.comments.find((entry) => entry.id === SEED_COMMENT).reactions, [
      { reaction: "heart", count: 2, reacted: true },
    ]);

    // The same account may also react to the issue itself.
    const onIssue = await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      cookie: bobCookie,
      body: { reaction: "rocket" },
    });
    assert.equal(onIssue.status, 200);
    assert.deepEqual(onIssue.body.issue.reactions, [{ reaction: "rocket", count: 1, reacted: true }]);
    // The comment reactions are untouched by an issue reaction.
    assert.deepEqual(onIssue.body.comments.find((entry) => entry.id === SEED_COMMENT).reactions, [
      { reaction: "heart", count: 2, reacted: true },
    ]);

    // The stored associations survive a restart of the service.
    await app.restart();
    const reloaded = await call(app.baseUrl, `${ISSUES}/1`, { cookie: aliceCookie });
    assert.deepEqual(reloaded.body.issue.reactions, [{ reaction: "rocket", count: 1, reacted: false }]);
    assert.deepEqual(reloaded.body.comments.find((entry) => entry.id === SEED_COMMENT).reactions, [
      { reaction: "heart", count: 2, reacted: true },
    ]);
  });
});

test("a reaction needs a session and an existing target of the addressed issue", async () => {
  await withApp(async (app) => {
    const visitor = await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      body: { reaction: "heart" },
    });
    assert.equal(visitor.status, 401);

    const cookie = await signIn(app, ALICE);
    const unsupported = await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      cookie,
      body: { reaction: "sparkles" },
    });
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.body.fieldErrors.reaction, "Reaction is not supported");

    const unknownComment = await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      cookie,
      body: { reaction: "heart", commentId: "issue-comment-missing" },
    });
    assert.equal(unknownComment.status, 404);

    // The seeded comment of another issue is not a target of this issue.
    const otherIssueComment = await call(app.baseUrl, `${ISSUES}/1/reactions`, {
      method: "POST",
      cookie,
      body: { reaction: "heart", commentId: "issue-comment-acme-docs-3-1" },
    });
    assert.equal(otherIssueComment.status, 404);

    const unknownIssue = await call(app.baseUrl, `${ISSUES}/99/reactions`, {
      method: "POST",
      cookie,
      body: { reaction: "heart" },
    });
    assert.equal(unknownIssue.status, 404);
  });
});
