// REQ-5-5 over the real HTTP surface: a signed-in viewer of a readable issue
// adds one `+1` reaction and removes only its own reaction again, the stored
// count is read back by every later reader (including after a restart), the
// issue content and its timeline stay untouched, and a visitor without a
// session can read the existing count but never react.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
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

async function signIn(baseUrl, identifier, password) {
  const response = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(response.status, 200, `sign-in of ${identifier} failed`);
  return response.cookie;
}

const ISSUES = "/api/repositories/acme-demo/evo-reaction-repository-s1/issues";
const REACTION_PASSWORD = "Evo-Password-987!";

test("a visitor reads the stored +1 count of a public issue but cannot react", async () => {
  const app = await startApp();
  try {
    const detail = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.issue.title, "Evo reaction issue s3");
    assert.equal(detail.body.canReact, false);
    assert.deepEqual(detail.body.reactions, [{ type: "+1", count: 1, reacted: false }]);

    // Reading never changes the stored count.
    const again = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.deepEqual(again.body.reactions, [{ type: "+1", count: 1, reacted: false }]);

    const rejected = await request(app.baseUrl, "POST", `${ISSUES}/3/reactions`, { type: "+1" });
    assert.equal(rejected.status, 401);
    const unchanged = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.equal(unchanged.body.reactions[0].count, 1);
  } finally {
    await app.close();
  }
});

test("a signed-in viewer adds a +1 reaction that persists across a restart", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.author@evolution.test", REACTION_PASSWORD);
    const before = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
    assert.deepEqual(before.body.reactions, []);
    assert.equal(before.body.canReact, true);

    const added = await request(
      app.baseUrl,
      "POST",
      `${ISSUES}/1/reactions`,
      { type: "+1" },
      cookie,
    );
    assert.equal(added.status, 201);
    assert.deepEqual(added.body.reactions, [{ type: "+1", count: 1, reacted: true }]);
    // The reaction never changes the issue content or its metadata.
    assert.equal(added.body.issue.title, "Evo reaction issue s1");
    assert.equal(added.body.issue.description, before.body.issue.description);
    assert.deepEqual(added.body.comments, []);
    assert.deepEqual(added.body.issue.labels, []);
    assert.deepEqual(added.body.issue.assignees, []);
    assert.equal(added.body.issue.milestone, null);
    assert.deepEqual(
      added.body.events.map((event) => event.type),
      before.body.events.map((event) => event.type),
    );

    // Reacting twice keeps one record instead of doubling the count.
    const repeated = await request(
      app.baseUrl,
      "POST",
      `${ISSUES}/1/reactions`,
      { type: "+1" },
      cookie,
    );
    assert.deepEqual(repeated.body.reactions, [{ type: "+1", count: 1, reacted: true }]);

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const reloaded = await request(restarted.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
      assert.deepEqual(reloaded.body.reactions, [{ type: "+1", count: 1, reacted: true }]);
      assert.equal(reloaded.body.issue.title, "Evo reaction issue s1");
      // A different viewer sees the same count without owning it.
      const otherCookie = await signIn(
        restarted.baseUrl,
        "evo.reaction.user@evolution.test",
        REACTION_PASSWORD,
      );
      const other = await request(restarted.baseUrl, "GET", `${ISSUES}/1`, undefined, otherCookie);
      assert.deepEqual(other.body.reactions, [{ type: "+1", count: 1, reacted: false }]);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("removing a reaction deletes only the caller's own record", async () => {
  const app = await startApp();
  try {
    // `evo-reaction-user` starts without a reaction (scenario 2).
    const cookie = await signIn(app.baseUrl, "evo.reaction.user@evolution.test", REACTION_PASSWORD);
    const before = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.deepEqual(before.body.reactions, []);

    await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "+1" }, cookie);
    const added = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.deepEqual(added.body.reactions, [{ type: "+1", count: 1, reacted: true }]);

    const removed = await request(
      app.baseUrl,
      "DELETE",
      `${ISSUES}/2/reactions/%2B1`,
      undefined,
      cookie,
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.reactions, []);
    assert.equal(removed.body.issue.title, "Evo reaction issue s2");

    const reloaded = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.deepEqual(reloaded.body.reactions, []);

    // Another account's identical reaction is never removed by this caller.
    const other = await signIn(
      app.baseUrl,
      "evo.reaction.author@evolution.test",
      REACTION_PASSWORD,
    );
    const cleared = await request(
      app.baseUrl,
      "DELETE",
      `${ISSUES}/3/reactions/%2B1`,
      undefined,
      other,
    );
    assert.deepEqual(cleared.body.reactions, [{ type: "+1", count: 1, reacted: false }]);
  } finally {
    await app.close();
  }
});

test("an unknown reaction type is refused and writes nothing", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.user@evolution.test", REACTION_PASSWORD);
    const rejected = await request(
      app.baseUrl,
      "POST",
      `${ISSUES}/2/reactions`,
      { type: "thumbsup" },
      cookie,
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fieldErrors.reaction, "Reaction is invalid");

    const after = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.deepEqual(after.body.reactions, []);
  } finally {
    await app.close();
  }
});

test("an unreadable issue refuses the reaction of a signed-in account", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.user@evolution.test", REACTION_PASSWORD);
    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/secret-research/issues/1/reactions",
      { type: "+1" },
      cookie,
    );
    assert.equal(denied.status, 403);
  } finally {
    await app.close();
  }
});
