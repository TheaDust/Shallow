// REQ-5-5 over the real HTTP surface: the seeded reaction repository of the
// evolution scenarios, adding and removing one's own `+1` reaction, the
// persistence of the stored reaction across a restart, the read-only visitor,
// the refusal of an unauthenticated caller and the fact that reacting never
// changes the content or the metadata of the issue.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-reaction-"));
  return startDataDir(dataDir);
}

/** A second app over the same data directory models a restart. */
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

async function signIn(baseUrl, identifier) {
  const response = await request(baseUrl, "POST", "/api/auth/sign-in", {
    identifier,
    password: "Evo-Password-987!",
  });
  assert.equal(response.status, 200, `sign-in of ${identifier} failed`);
  return response.cookie;
}

const REPOSITORY = "/api/repositories/evo-reaction-author/evo-reaction-repository-s1";
const issuesUrl = (number) => `${REPOSITORY}/issues/${number}`;
const reactionsUrl = (number) => `${issuesUrl(number)}/reactions`;
const reactionUrl = (number, type) => `${reactionsUrl(number)}/${encodeURIComponent(type)}`;

/** The reaction entry of one type, or null when the count is zero. */
function reactionOf(view, type) {
  return view.body.reactions.find((entry) => entry.type === type) ?? null;
}

/** The content and metadata an issue keeps across a reaction change. */
function immutableShape(view) {
  return {
    number: view.body.issue.number,
    title: view.body.issue.title,
    description: view.body.issue.description,
    status: view.body.issue.status,
    author: view.body.issue.author,
    labels: view.body.issue.labels,
    assignees: view.body.issue.assignees,
    milestone: view.body.issue.milestone,
    comments: view.body.comments,
    events: view.body.events,
  };
}

test("the seeded reaction repository is public and reaches all three issues", async () => {
  const app = await startApp();
  try {
    const listed = await request(app.baseUrl, "GET", `${REPOSITORY}/issues`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.repository.name, "evo-reaction-repository-s1");
    assert.equal(listed.body.repository.visibility, "public");
    assert.deepEqual(
      listed.body.issues.map((issue) => issue.title),
      ["Evo reaction issue s1", "Evo reaction issue s2", "Evo reaction issue s3"],
    );

    const first = await request(app.baseUrl, "GET", issuesUrl(1));
    assert.deepEqual(first.body.reactions, []);
    const second = await request(app.baseUrl, "GET", issuesUrl(2));
    assert.deepEqual(second.body.reactions, []);
    assert.equal(second.body.canReact, false);

    // `-s3` starts with one stored `+1` reaction, counted for the visitor.
    const third = await request(app.baseUrl, "GET", issuesUrl(3));
    assert.deepEqual(third.body.reactions, [{ type: "+1", count: 1, viewerReacted: false }]);
  } finally {
    await app.close();
  }
});

test("s1: the added `+1` reaction is stored, counted and kept across a restart", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.author@evolution.test");
    const before = await request(app.baseUrl, "GET", issuesUrl(1), undefined, cookie);
    assert.equal(before.body.canReact, true);
    assert.deepEqual(before.body.reactions, []);
    const original = immutableShape(before);

    const added = await request(app.baseUrl, "POST", reactionsUrl(1), { type: "+1" }, cookie);
    assert.equal(added.status, 200);
    assert.deepEqual(reactionOf(added, "+1"), { type: "+1", count: 1, viewerReacted: true });
    assert.deepEqual(immutableShape(added), original);

    // Repeating the same reaction never stores a second reaction.
    const repeated = await request(app.baseUrl, "POST", reactionsUrl(1), { type: "+1" }, cookie);
    assert.deepEqual(reactionOf(repeated, "+1"), { type: "+1", count: 1, viewerReacted: true });

    // Reloading the same issue, and a restarted server over the same data
    // directory, read the same stored reaction.
    const reloaded = await request(app.baseUrl, "GET", issuesUrl(1), undefined, cookie);
    assert.deepEqual(reactionOf(reloaded, "+1"), { type: "+1", count: 1, viewerReacted: true });
    await app.close();

    const restarted = await startDataDir(app.dataDir);
    try {
      const afterRestart = await request(restarted.baseUrl, "GET", issuesUrl(1), undefined, cookie);
      assert.deepEqual(reactionOf(afterRestart, "+1"), { type: "+1", count: 1, viewerReacted: true });
      assert.deepEqual(immutableShape(afterRestart), original);
      const stored = JSON.parse(await readFile(join(restarted.dataDir, "organizations.json"), "utf8"));
      assert.equal(stored.issueReactions.length, 2);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close().catch(() => undefined);
  }
});

test("s2: removing the own `+1` returns the count to its original value", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");
    const before = await request(app.baseUrl, "GET", issuesUrl(2), undefined, cookie);
    assert.deepEqual(before.body.reactions, []);
    const original = immutableShape(before);

    const added = await request(app.baseUrl, "POST", reactionsUrl(2), { type: "+1" }, cookie);
    assert.deepEqual(reactionOf(added, "+1"), { type: "+1", count: 1, viewerReacted: true });

    const removed = await request(app.baseUrl, "DELETE", reactionUrl(2, "+1"), undefined, cookie);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.reactions, []);
    assert.deepEqual(immutableShape(removed), original);

    // The removal survives a reload and repeating it changes nothing.
    const again = await request(app.baseUrl, "DELETE", reactionUrl(2, "+1"), undefined, cookie);
    assert.deepEqual(again.body.reactions, []);
    const reloaded = await request(app.baseUrl, "GET", issuesUrl(2), undefined, cookie);
    assert.deepEqual(reloaded.body.reactions, []);
    assert.deepEqual(immutableShape(reloaded), original);
  } finally {
    await app.close();
  }
});

test("one account removes only its own reaction and the count keeps the other one", async () => {
  const app = await startApp();
  try {
    const author = await signIn(app.baseUrl, "evo.reaction.author@evolution.test");
    const user = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");

    // Issue 2 starts without any reaction, so both accounts react to it first.
    await request(app.baseUrl, "POST", reactionsUrl(2), { type: "+1" }, author);
    const one = await request(app.baseUrl, "GET", issuesUrl(2), undefined, user);
    assert.deepEqual(reactionOf(one, "+1"), { type: "+1", count: 1, viewerReacted: false });

    await request(app.baseUrl, "POST", reactionsUrl(2), { type: "+1" }, user);
    const both = await request(app.baseUrl, "GET", issuesUrl(2), undefined, user);
    assert.deepEqual(reactionOf(both, "+1"), { type: "+1", count: 2, viewerReacted: true });

    // The removal of one account leaves the other account's reaction stored.
    const removed = await request(app.baseUrl, "DELETE", reactionUrl(2, "+1"), undefined, user);
    assert.deepEqual(reactionOf(removed, "+1"), { type: "+1", count: 1, viewerReacted: false });
    const visitor = await request(app.baseUrl, "GET", issuesUrl(2));
    assert.deepEqual(visitor.body.reactions, [{ type: "+1", count: 1, viewerReacted: false }]);
    assert.equal(visitor.body.canReact, false);
  } finally {
    await app.close();
  }
});

test("a visitor reads the counts but cannot react, and an unauthenticated write is refused", async () => {
  const app = await startApp();
  try {
    const posted = await request(app.baseUrl, "POST", reactionsUrl(1), { type: "+1" });
    assert.equal(posted.status, 401);
    const deleted = await request(app.baseUrl, "DELETE", reactionUrl(1, "+1"));
    assert.equal(deleted.status, 401);

    const missing = await request(app.baseUrl, "POST", reactionsUrl(1), { type: "+1" }, undefined);
    assert.equal(missing.status, 401);

    // An unknown reaction type and an unknown issue are refused.
    const cookie = await signIn(app.baseUrl, "evo.reaction.author@evolution.test");
    const invalid = await request(app.baseUrl, "POST", reactionsUrl(1), { type: "sparkle" }, cookie);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.reaction, "Reaction is invalid");
    const unknown = await request(app.baseUrl, "POST", reactionsUrl(99), { type: "+1" }, cookie);
    assert.equal(unknown.status, 404);
  } finally {
    await app.close();
  }
});

test("the seeded `+1` count of the third issue reaches a visitor entry point", async () => {
  const app = await startApp();
  try {
    // The repository is discoverable by its name, which is the public entry the
    // visitor scenario uses before it opens the issue.
    const found = await request(app.baseUrl, "GET", "/api/repositories?q=evo-reaction-repository-s1");
    assert.deepEqual(found.body.repositories.map((entry) => entry.name), ["evo-reaction-repository-s1"]);
    const view = await request(app.baseUrl, "GET", issuesUrl(3));
    assert.equal(view.status, 200);
    assert.deepEqual(view.body.reactions, [{ type: "+1", count: 1, viewerReacted: false }]);
  } finally {
    await app.close();
  }
});
