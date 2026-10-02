/**
 * Issue writes of one repository (REQ-5-2): creating a work item, editing its
 * title and its description separately, appending discussion comments and adding
 * or removing one's own reaction. Every case checks the stored record — not only
 * the response — and that a refused submission left the previous state alone.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore } from "../src/domain/store.mjs";

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
  dataDir = await mkdtemp(join(tmpdir(), "shallow-issue-writes-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const ISSUES = "/api/repositories/alice-dev/acme-docs/issues";
const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");
/** The seeded account that holds no role on any repository. */
const outsiderCookie = () => app.signIn("dana-observer", "Valid-password-123!");

/** The stored numbers of the repository, so a case never invents one. */
async function storedNumbers() {
  const response = await app.request(ISSUES);
  return response.body.issues.map((issue) => issue.number);
}

describe("REQ-5-2-1 create a repository issue", () => {
  it("stores the issue with the next number, its author and a creation activity", async () => {
    const before = await storedNumbers();
    const highest = Math.max(...before);
    const cookie = await aliceCookie();

    const created = await app.request(ISSUES, {
      method: "POST",
      cookie,
      body: { title: "Document the release checklist", description: "Steps before the Q3 launch." },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.issue.number, highest + 1);
    assert.equal(created.body.issue.title, "Document the release checklist");
    assert.equal(created.body.issue.body, "Steps before the Q3 launch.");
    assert.equal(created.body.issue.status, "open");
    assert.equal(created.body.issue.author, "alice-dev");
    assert.equal(created.body.issue.commentCount, 0);
    assert.equal(created.body.timeline[0].type, "created");
    assert.equal(created.body.timeline[0].actor, "alice-dev");
    assert.equal(created.body.timeline[0].text, "opened this issue");

    // The detail address of the new number and the list read the same record.
    const detail = await app.request(`${ISSUES}/${created.body.issue.number}`, { cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.issue.title, "Document the release checklist");
    const list = await app.request(ISSUES, { cookie });
    assert.deepEqual(
      list.body.issues.map((issue) => issue.number),
      [...before, highest + 1],
    );
    const row = list.body.issues.at(-1);
    assert.equal(row.title, "Document the release checklist");
    assert.equal(row.status, "open");
    assert.equal(row.author, "alice-dev");
  });

  it("accepts an empty description but never a blank title", async () => {
    const before = await storedNumbers();
    const cookie = await aliceCookie();

    const blank = await app.request(ISSUES, {
      method: "POST",
      cookie,
      body: { title: "   ", description: "" },
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "Title is required");
    assert.equal(blank.body.fields.title, "Title is required");

    const empty = await app.request(ISSUES, {
      method: "POST",
      cookie,
      body: { title: "  Optional description only  ", description: "" },
    });
    assert.equal(empty.status, 201);
    assert.equal(empty.body.issue.title, "Optional description only");
    assert.equal(empty.body.issue.body, "");
    assert.deepEqual(await storedNumbers(), [...before, empty.body.issue.number].sort((left, right) => left - right));
  });

  it("refuses an overlong title or description without allocating a number", async () => {
    const before = await storedNumbers();
    const cookie = await aliceCookie();

    const longTitle = await app.request(ISSUES, {
      method: "POST",
      cookie,
      body: { title: "x".repeat(257), description: "" },
    });
    assert.equal(longTitle.status, 400);
    assert.equal(longTitle.body.fields.title, "Title must be 256 characters or fewer");

    const longDescription = await app.request(ISSUES, {
      method: "POST",
      cookie,
      body: { title: "A valid title", description: "y".repeat(65537) },
    });
    assert.equal(longDescription.status, 400);
    assert.equal(longDescription.body.error, "Description must be 65536 characters or fewer");

    // The largest allowed title and description are still accepted.
    const boundary = await app.request(ISSUES, {
      method: "POST",
      cookie,
      body: { title: "z".repeat(256), description: "y".repeat(65536) },
    });
    assert.equal(boundary.status, 201);
    assert.equal(boundary.body.issue.title.length, 256);

    assert.deepEqual(await storedNumbers(), [...before, boundary.body.issue.number].sort((left, right) => left - right));
  });

  it("refuses a visitor and a viewer without write permission", async () => {
    const before = await storedNumbers();

    const visitor = await app.request(ISSUES, { method: "POST", body: { title: "Anonymous issue" } });
    assert.equal(visitor.status, 401);

    // dana-observer may read the public repository but holds no role on it.
    const outsider = await outsiderCookie();
    const viewer = await app.request(ISSUES, { method: "POST", cookie: outsider, body: { title: "No write access" } });
    assert.equal(viewer.status, 403);

    assert.deepEqual(await storedNumbers(), before);
  });
});

describe("REQ-5-2-2 edit an issue title and description", () => {
  it("updates only the addressed field, the list summary and the activity", async () => {
    const cookie = await aliceCookie();
    const before = await app.request(`${ISSUES}/1`, { cookie });
    assert.equal(before.body.issue.title, "Improve onboarding");

    const renamed = await app.request(`${ISSUES}/1/title`, {
      method: "POST",
      cookie,
      body: { title: "Improve the onboarding flow" },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.issue.title, "Improve the onboarding flow");
    assert.equal(renamed.body.issue.body, "Describe the onboarding improvement.");
    assert.deepEqual(renamed.body.issue.assignees, ["bob-reviewer"]);
    assert.deepEqual(renamed.body.issue.labels, ["bug", "documentation"]);
    assert.equal(renamed.body.issue.milestone, "Q3 launch");
    assert.equal(renamed.body.issue.status, "open");
    assert.equal(renamed.body.timeline.some((event) => event.type === "edited"), true);

    const described = await app.request(`${ISSUES}/1/description`, {
      method: "POST",
      cookie,
      body: { description: "Describe the onboarding improvement in two steps." },
    });
    assert.equal(described.status, 200);
    assert.equal(described.body.issue.body, "Describe the onboarding improvement in two steps.");
    assert.equal(described.body.issue.title, "Improve the onboarding flow");

    // The list summary carries the new title and the detail survives a reload.
    const list = await app.request(ISSUES, { cookie });
    assert.equal(list.body.issues.find((issue) => issue.number === 1).title, "Improve the onboarding flow");
    const reloaded = await app.request(`${ISSUES}/1`, { cookie });
    assert.equal(reloaded.body.issue.title, "Improve the onboarding flow");
    assert.equal(reloaded.body.issue.body, "Describe the onboarding improvement in two steps.");
  });

  it("keeps the original value when the title is blank or overlong", async () => {
    const cookie = await aliceCookie();
    // The invalid-edit seed keeps its known original title.
    const original = await app.request(`${ISSUES}/3`, { cookie });
    assert.equal(original.body.issue.title, "Original issue title");

    const blank = await app.request(`${ISSUES}/3/title`, { method: "POST", cookie, body: { title: "   " } });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "Title is required");

    const long = await app.request(`${ISSUES}/3/title`, {
      method: "POST",
      cookie,
      body: { title: "x".repeat(257) },
    });
    assert.equal(long.status, 400);

    const reloaded = await app.request(`${ISSUES}/3`, { cookie });
    assert.equal(reloaded.body.issue.title, "Original issue title");
    assert.equal(reloaded.body.issue.body, "The original description of the seeded issue.");
  });

  it("refuses a viewer without write permission and keeps the stored values", async () => {
    const outsider = await outsiderCookie();
    const before = await app.request(`${ISSUES}/1`);

    const denied = await app.request(`${ISSUES}/1/title`, { method: "POST", cookie: outsider, body: { title: "Hijacked" } });
    assert.equal(denied.status, 403);
    const visitor = await app.request(`${ISSUES}/1/description`, { method: "POST", body: { description: "Nope" } });
    assert.equal(visitor.status, 401);

    const after = await app.request(`${ISSUES}/1`);
    assert.equal(after.body.issue.title, before.body.issue.title);
    assert.equal(after.body.issue.body, before.body.issue.body);
  });
});

describe("REQ-5-2-3 comment on an issue discussion", () => {
  it("appends a stored comment with its author, body and activity record", async () => {
    const cookie = await aliceCookie();
    const before = await app.request(`${ISSUES}/1`, { cookie });
    const body = "  The welcome screen should link to the guide.  ";

    const created = await app.request(`${ISSUES}/1/comments`, { method: "POST", cookie, body: { body } });
    assert.equal(created.status, 201);
    const comment = created.body.comments.at(-1);
    assert.equal(comment.author, "alice-dev");
    assert.equal(comment.body, body.trim());
    assert.equal(typeof comment.createdAt, "string");
    assert.equal(created.body.timeline.at(-1).type, "commented");
    assert.equal(created.body.timeline.at(-1).actor, "alice-dev");

    // The stored comment survives a reload and the discussion only grew.
    const reloaded = await app.request(`${ISSUES}/1`, { cookie });
    assert.equal(reloaded.body.comments.length, before.body.comments.length + 1);
    assert.equal(reloaded.body.comments.at(-1).body, body.trim());
    const list = await app.request(ISSUES, { cookie });
    assert.equal(list.body.issues.find((issue) => issue.number === 1).commentCount, before.body.comments.length + 1);
  });

  it("appends nothing for a whitespace-only or overlong comment", async () => {
    const cookie = await aliceCookie();
    const before = await app.request(`${ISSUES}/1`, { cookie });

    const blank = await app.request(`${ISSUES}/1/comments`, { method: "POST", cookie, body: { body: "   \n  " } });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "Comment is required");
    assert.equal(blank.body.fields.comment, "Comment is required");

    const overlong = await app.request(`${ISSUES}/1/comments`, {
      method: "POST",
      cookie,
      body: { body: "c".repeat(65537) },
    });
    assert.equal(overlong.status, 400);
    assert.equal(overlong.body.error, "Comment must be 65536 characters or fewer");

    const after = await app.request(`${ISSUES}/1`, { cookie });
    assert.equal(after.body.comments.length, before.body.comments.length);
    assert.equal(after.body.timeline.length, before.body.timeline.length);
  });

  it("refuses a comment without a session or without write permission", async () => {
    const before = await app.request(`${ISSUES}/1`);
    const visitor = await app.request(`${ISSUES}/1/comments`, { method: "POST", body: { body: "Anonymous" } });
    assert.equal(visitor.status, 401);

    const outsider = await outsiderCookie();
    const viewer = await app.request(`${ISSUES}/1/comments`, { method: "POST", cookie: outsider, body: { body: "Viewer" } });
    assert.equal(viewer.status, 403);

    const after = await app.request(`${ISSUES}/1`);
    assert.equal(after.body.comments.length, before.body.comments.length);
  });
});

describe("REQ-5-2-3 reactions on an issue and its comments", () => {
  it("stores one association per account, target and reaction and toggles it off", async () => {
    const alice = await aliceCookie();
    const before = await app.request(`${ISSUES}/1`, { cookie: alice });
    const comment = before.body.comments[0];

    const added = await app.request(`${ISSUES}/1/comments/${comment.id}/reactions`, {
      method: "POST",
      cookie: alice,
      body: { type: "👍" },
    });
    assert.equal(added.status, 200);
    const target = added.body.comments.find((entry) => entry.id === comment.id);
    assert.deepEqual(target.reactions, [{ type: "👍", count: 1, mine: true }]);
    assert.equal(added.body.timeline.at(-1).type, "reacted");

    // Selecting the same reaction again removes it — never a duplicate.
    const removed = await app.request(`${ISSUES}/1/comments/${comment.id}/reactions`, {
      method: "POST",
      cookie: alice,
      body: { type: "👍" },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.comments.find((entry) => entry.id === comment.id).reactions, []);

    // The stored association survives a reload for the reacting account, and
    // another signed-in viewer sees the count without owning it.
    await app.request(`${ISSUES}/1/comments/${comment.id}/reactions`, {
      method: "POST",
      cookie: alice,
      body: { type: "🎉" },
    });
    const bob = await bobCookie();
    const forBob = await app.request(`${ISSUES}/1`, { cookie: bob });
    assert.deepEqual(forBob.body.comments[0].reactions, [{ type: "🎉", count: 1, mine: false }]);
    const forAlice = await app.request(`${ISSUES}/1`, { cookie: alice });
    assert.deepEqual(forAlice.body.comments[0].reactions, [{ type: "🎉", count: 1, mine: true }]);

    await app.request(`${ISSUES}/1/comments/${comment.id}/reactions`, {
      method: "POST",
      cookie: alice,
      body: { type: "🎉" },
    });
  });

  it("reacts on the issue itself and refuses an unknown target or reaction", async () => {
    const cookie = await aliceCookie();
    const added = await app.request(`${ISSUES}/3/reactions`, { method: "POST", cookie, body: { type: "🚀" } });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.issue.reactions, [{ type: "🚀", count: 1, mine: true }]);

    const unknownType = await app.request(`${ISSUES}/3/reactions`, {
      method: "POST",
      cookie,
      body: { type: "sparkles" },
    });
    assert.equal(unknownType.status, 400);
    assert.equal(unknownType.body.error, "Unknown reaction");

    const unknownComment = await app.request(`${ISSUES}/3/comments/missing/reactions`, {
      method: "POST",
      cookie,
      body: { type: "🚀" },
    });
    assert.equal(unknownComment.status, 400);

    const visitor = await app.request(`${ISSUES}/3/reactions`, { method: "POST", body: { type: "🚀" } });
    assert.equal(visitor.status, 401);
  });
});
