// REQ-5-5 over the real HTTP surface: the seeded reaction count of the public
// scenario repository, the per-viewer reaction toggle any signed-in reader may
// perform, its persistence across a restart and its refusal for a visitor. The
// checks also prove a reaction never changes the issue content, discussion or
// metadata, and that each scenario's own issue keeps its initial state.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const REACTION_PASSWORD = "Evo-Password-987!";
const REPOSITORY = "/api/repositories/acme-demo/evo-reaction-repository-s1";
const ISSUES = `${REPOSITORY}/issues`;

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-reaction-"));
  return startDataDir(dataDir);
}

/** A second app over the same data directory models a reload or a restart. */
async function startDataDir(dataDir) {
  const store = createAuthStore(dataDir);
  const orgStore = createOrgStore(dataDir);
  const handler = createRequestHandler({ store, orgStore, staticRoot: join(dataDir, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function collectCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(baseUrl, method, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, cookie: collectCookie(response) };
}

/** Signs an evolution account in by the email address its scenario states. */
async function signIn(baseUrl, identifier) {
  const response = await request(baseUrl, "POST", "/api/auth/sign-in", {
    identifier,
    password: REACTION_PASSWORD,
  });
  assert.equal(response.status, 200, `sign-in of ${identifier} failed`);
  assert.equal(response.body.user.username !== undefined, true);
  return { cookie: response.cookie, username: response.body.user.username };
}

const plusOne = (payload) => payload.reactions.find((entry) => entry.type === "+1") ?? null;

test("the seeded public repository carries the three evolution issues", async () => {
  const app = await startApp();
  try {
    const listed = await request(app.baseUrl, "GET", ISSUES);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.repository.name, "evo-reaction-repository-s1");
    assert.deepEqual(
      listed.body.issues.map((issue) => issue.title),
      ["Evo reaction issue s1", "Evo reaction issue s2", "Evo reaction issue s3"],
    );
  } finally {
    await app.close();
  }
});

test("REQ-5-5 scenario 3: the visitor reads the existing +1 count without a control", async () => {
  const app = await startApp();
  try {
    const detail = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.issue.title, "Evo reaction issue s3");
    assert.equal(detail.body.canReact, false);
    assert.deepEqual(plainReactions(detail.body), [{ type: "+1", count: 2, reacted: false }]);

    // The visitor holds no reaction control and is refused by the trusted
    // boundary as well.
    const added = await request(app.baseUrl, "POST", `${ISSUES}/3/reactions`, { type: "+1" });
    assert.equal(added.status, 401);
    const removed = await request(app.baseUrl, "DELETE", `${ISSUES}/3/reactions/%2B1`);
    assert.equal(removed.status, 401);

    const after = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.deepEqual(plainReactions(after.body), [{ type: "+1", count: 2, reacted: false }]);
  } finally {
    await app.close();
  }
});

test("REQ-5-5 scenario 1: the author adds +1 and reads it back after a reload", async () => {
  const app = await startApp();
  try {
    const { cookie, username } = await signIn(app.baseUrl, "evo.reaction.author@evolution.test");
    assert.equal(username, "evo-reaction-author");

    const before = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
    assert.equal(before.body.canReact, true);
    assert.deepEqual(plainReactions(before.body), []);

    const added = await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "+1" }, cookie);
    assert.equal(added.status, 200);
    assert.deepEqual(plainReactions(added.body), [{ type: "+1", count: 1, reacted: true }]);

    // A repeated add of the same type stores no second reaction.
    const repeated = await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "+1" }, cookie);
    assert.deepEqual(plainReactions(repeated.body), [{ type: "+1", count: 1, reacted: true }]);

    // The reload reads the same persisted record, and the issue content,
    // discussion and metadata are untouched by the reaction.
    const reloaded = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
    assert.deepEqual(plainReactions(reloaded.body), [{ type: "+1", count: 1, reacted: true }]);
    assert.equal(reloaded.body.issue.title, "Evo reaction issue s1");
    assert.equal(reloaded.body.issue.description, "Tracks adding a reaction to the evolution issue.");
    assert.deepEqual(reloaded.body.issue.labels, []);
    assert.deepEqual(reloaded.body.issue.assignees, []);
    assert.equal(reloaded.body.issue.milestone, null);
    assert.deepEqual(reloaded.body.comments, []);
    assert.deepEqual(reloaded.body.events.map((event) => event.type), ["created"]);
  } finally {
    await app.close();
  }
});

test("REQ-5-5 scenario 2: adding then activating the same reaction removes only the own count", async () => {
  const app = await startApp();
  try {
    const { cookie } = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");
    const before = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.deepEqual(plainReactions(before.body), []);

    const added = await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "+1" }, cookie);
    assert.deepEqual(plainReactions(added.body), [{ type: "+1", count: 1, reacted: true }]);

    const removed = await request(app.baseUrl, "DELETE", `${ISSUES}/2/reactions/%2B1`, undefined, cookie);
    assert.equal(removed.status, 200);
    assert.deepEqual(plainReactions(removed.body), []);
    // The removal left the issue content, discussion and metadata untouched.
    assert.equal(removed.body.issue.title, "Evo reaction issue s2");
    assert.equal(removed.body.issue.description, "Tracks adding and removing a reaction on the evolution issue.");
    assert.equal(removed.body.issue.status, "open");
    assert.deepEqual(removed.body.comments, []);

    // Removing a reaction the account does not hold is a no-op.
    const again = await request(app.baseUrl, "DELETE", `${ISSUES}/2/reactions/%2B1`, undefined, cookie);
    assert.equal(again.status, 200);
    assert.deepEqual(plainReactions(again.body), []);

    const reloaded = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.deepEqual(plainReactions(reloaded.body), []);
  } finally {
    await app.close();
  }
});

test("only the caller's own reaction is removed from a shared count", async () => {
  const app = await startApp();
  try {
    const author = await signIn(app.baseUrl, "evo.reaction.author@evolution.test");
    const user = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");

    await request(app.baseUrl, "POST", `${ISSUES}/3/reactions`, { type: "+1" }, author.cookie);
    const shared = await request(app.baseUrl, "GET", `${ISSUES}/3`, undefined, user.cookie);
    assert.deepEqual(plainReactions(shared.body), [{ type: "+1", count: 3, reacted: false }]);

    await request(app.baseUrl, "POST", `${ISSUES}/3/reactions`, { type: "+1" }, user.cookie);
    const both = await request(app.baseUrl, "GET", `${ISSUES}/3`, undefined, author.cookie);
    assert.deepEqual(plainReactions(both.body), [{ type: "+1", count: 4, reacted: true }]);

    const removed = await request(app.baseUrl, "DELETE", `${ISSUES}/3/reactions/%2B1`, undefined, user.cookie);
    assert.deepEqual(plainReactions(removed.body), [{ type: "+1", count: 3, reacted: false }]);

    const visitor = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.deepEqual(plainReactions(visitor.body), [{ type: "+1", count: 3, reacted: false }]);
  } finally {
    await app.close();
  }
});

test("a reaction stays stored across a restart and never enters another issue", async () => {
  const app = await startApp();
  try {
    const { cookie } = await signIn(app.baseUrl, "evo.reaction.author@evolution.test");
    await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "+1" }, cookie);

    const restarted = await startDataDir(app.dataDir);
    try {
      const { cookie: again } = await signIn(restarted.baseUrl, "evo.reaction.author@evolution.test");
      const reloaded = await request(restarted.baseUrl, "GET", `${ISSUES}/1`, undefined, again);
      assert.deepEqual(plainReactions(reloaded.body), [{ type: "+1", count: 1, reacted: true }]);

      // The sibling issues of the same repository keep their own initial state.
      const other = await request(restarted.baseUrl, "GET", `${ISSUES}/2`);
      assert.deepEqual(plainReactions(other.body), []);
      const seeded = await request(restarted.baseUrl, "GET", `${ISSUES}/3`);
      assert.deepEqual(plainReactions(seeded.body), [{ type: "+1", count: 2, reacted: false }]);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("an unsupported reaction type is refused without storing anything", async () => {
  const app = await startApp();
  try {
    const { cookie } = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");
    const invalid = await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "sparkle" }, cookie);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.type, "Reaction is invalid");

    const detail = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.deepEqual(plainReactions(detail.body), []);
  } finally {
    await app.close();
  }
});

test("reacting to an issue that does not exist answers 404", async () => {
  const app = await startApp();
  try {
    const { cookie } = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");
    const missing = await request(app.baseUrl, "POST", `${ISSUES}/99/reactions`, { type: "+1" }, cookie);
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

/** The stored reactions without the per-viewer flag, for a comparison. */
function plainReactions(payload) {
  return payload.reactions.map((entry) => ({
    type: entry.type,
    count: entry.count,
    reacted: entry.reacted,
  }));
}
