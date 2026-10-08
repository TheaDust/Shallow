// REQ-5-5 over the real HTTP surface: the seeded reaction of the public
// reaction repository, adding and removing the caller's own reaction, the
// isolation between two accounts, the read-only count a visitor sees, the
// refusal of a visitor's reaction and the upgrade of a store that predates
// these seeds.

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
  await store.ensureSeeded();
  await orgStore.ensureSeeded();
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

/** Signs in with the pre-provisioned `evo-*` credential of the scenario. */
async function signIn(baseUrl, identifier, password = "Evo-Password-987!") {
  const response = await request(baseUrl, "POST", "/api/auth/sign-in", { identifier, password });
  assert.equal(response.status, 200, `sign-in of ${identifier} failed`);
  return response.cookie;
}

const ISSUES = "/api/repositories/evo-reaction-author/evo-reaction-repository-s1/issues";

const reactionOf = (detail) => detail.body.reactions.find((entry) => entry.type === "+1");

test("the seeded reaction repository lists its three issues to a visitor", async () => {
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

test("a visitor reads the existing reaction count and cannot react", async () => {
  const app = await startApp();
  try {
    const detail = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.canReact, false);
    assert.deepEqual(reactionOf(detail), { type: "+1", count: 1, reacted: false });

    // The visitor cannot add a reaction and the stored count stays as it was.
    const attempt = await request(app.baseUrl, "POST", `${ISSUES}/3/reactions`, { type: "+1" });
    assert.equal(attempt.status, 401);
    const after = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.deepEqual(reactionOf(after), { type: "+1", count: 1, reacted: false });

    // The removal is refused for a visitor too.
    const removal = await request(app.baseUrl, "DELETE", `${ISSUES}/3/reactions/%2B1`);
    assert.equal(removal.status, 401);
  } finally {
    await app.close();
  }
});

test("an account adds, reloads and removes its own reaction", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");

    const before = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.equal(before.body.canReact, true);
    assert.deepEqual(reactionOf(before), { type: "+1", count: 0, reacted: false });

    const added = await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "+1" }, cookie);
    assert.equal(added.status, 200);
    assert.deepEqual(reactionOf(added), { type: "+1", count: 1, reacted: true });

    // The state is persisted: a fresh read (and a restart) shows the same count.
    const reloaded = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
    assert.deepEqual(reactionOf(reloaded), { type: "+1", count: 1, reacted: true });

    // Repeating the same reaction stores nothing new.
    const repeated = await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "+1" }, cookie);
    assert.deepEqual(reactionOf(repeated), { type: "+1", count: 1, reacted: true });

    const removed = await request(app.baseUrl, "DELETE", `${ISSUES}/2/reactions/%2B1`, undefined, cookie);
    assert.equal(removed.status, 200);
    assert.deepEqual(reactionOf(removed), { type: "+1", count: 0, reacted: false });

    const restarted = await startDataDir(app.dataDir);
    try {
      const afterRestart = await request(restarted.baseUrl, "GET", `${ISSUES}/2`, undefined, cookie);
      assert.deepEqual(reactionOf(afterRestart), { type: "+1", count: 0, reacted: false });
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a reaction leaves the issue content, discussion and metadata untouched", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");
    const before = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);

    const added = await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "+1" }, cookie);
    assert.equal(added.status, 200);

    const after = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
    assert.deepEqual(after.body.issue, before.body.issue);
    assert.deepEqual(after.body.comments, before.body.comments);
    assert.deepEqual(after.body.events, before.body.events);
    assert.deepEqual(reactionOf(after), { type: "+1", count: 1, reacted: true });
  } finally {
    await app.close();
  }
});

test("one account's removal keeps every other account's reaction", async () => {
  const app = await startApp();
  try {
    const author = await signIn(app.baseUrl, "evo-reaction-author");
    const user = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");

    await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "+1" }, author);
    await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "+1" }, user);

    const both = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, user);
    assert.deepEqual(reactionOf(both), { type: "+1", count: 2, reacted: true });

    await request(app.baseUrl, "DELETE", `${ISSUES}/1/reactions/%2B1`, undefined, user);
    const remaining = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, author);
    assert.deepEqual(reactionOf(remaining), { type: "+1", count: 1, reacted: true });

    const fromUser = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, user);
    assert.deepEqual(reactionOf(fromUser), { type: "+1", count: 1, reacted: false });
  } finally {
    await app.close();
  }
});

test("an unsupported reaction name is refused without writing", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");
    const attempt = await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "heart" }, cookie);
    assert.equal(attempt.status, 400);
    assert.equal(attempt.body.fieldErrors.reaction, "Reaction is invalid");

    const detail = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
    assert.deepEqual(reactionOf(detail), { type: "+1", count: 0, reacted: false });
  } finally {
    await app.close();
  }
});

test("one issue's reaction never changes another issue's count", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo.reaction.user@evolution.test");
    await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "+1" }, cookie);

    const s1 = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
    assert.deepEqual(reactionOf(s1), { type: "+1", count: 0, reacted: false });
    const s3 = await request(app.baseUrl, "GET", `${ISSUES}/3`, undefined, cookie);
    assert.deepEqual(reactionOf(s3), { type: "+1", count: 1, reacted: false });

    const missing = await request(app.baseUrl, "POST", `${ISSUES}/99/reactions`, { type: "+1" }, cookie);
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test("an inherited store gains the reaction fixtures without losing user records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-reaction-upgrade-"));
  // An earlier version wrote the organization state before the reaction seeds
  // existed: a fresh store without them models exactly that file.
  const legacy = createOrgStore(dataDir);
  await legacy.ensureSeeded();
  const { readFile, writeFile } = await import("node:fs/promises");
  const file = join(dataDir, "organizations.json");
  const stored = JSON.parse(await readFile(file, "utf8"));
  stored.issues = stored.issues.filter((issue) => issue.repositoryId !== "repo-evo-reaction-repository-s1");
  stored.repositories = stored.repositories.filter((entry) => entry.id !== "repo-evo-reaction-repository-s1");
  stored.issueReactions = [];
  stored.organizations.push({ id: "user-guild", displayName: "User Guild", createdAt: stored.organizations[0].createdAt });
  stored.appliedSeedKeys = stored.appliedSeedKeys.filter(
    (key) => !key.includes("evo-reaction"),
  );
  await writeFile(file, JSON.stringify(stored, null, 2));

  const upgraded = createOrgStore(dataDir);
  await upgraded.ensureSeeded();
  const repositories = await upgraded.listReadableRepositories(null);
  const fixture = repositories.find((entry) => entry.name === "evo-reaction-repository-s1");
  assert.ok(fixture, "the preset reaction repository is provisioned");
  const issues = await upgraded.listIssues(fixture.id);
  assert.deepEqual(
    issues.map((issue) => issue.title),
    ["Evo reaction issue s1", "Evo reaction issue s2", "Evo reaction issue s3"],
  );
  // The record a user added before the upgrade survives, and a second startup
  // neither duplicates the presets nor loses the reaction count.
  const organizations = await upgraded.listAllOrganizations();
  assert.ok(organizations.some((organization) => organization.id === "user-guild"));

  const again = createOrgStore(dataDir);
  await again.ensureSeeded();
  const againRepositories = await again.listReadableRepositories(null);
  assert.equal(
    againRepositories.filter((entry) => entry.name === "evo-reaction-repository-s1").length,
    1,
  );
  const againIssues = await again.listIssues(fixture.id);
  assert.equal(againIssues.length, 3);
  const detail = await again.getIssue(fixture.id, 3);
  assert.deepEqual(detail.reactions, [{ type: "+1", count: 1, accountIds: ["account-evo-reaction-author"] }]);
});
