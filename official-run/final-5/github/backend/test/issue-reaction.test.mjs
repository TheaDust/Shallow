// REQ-5-5 over the real HTTP surface: the persisted reactions of a public
// issue. Any signed-in viewer of a readable issue may add the `+1` reaction and
// withdraw exactly their own reaction; a visitor reads the existing counts but
// is refused on every reaction write, and a reaction never changes the issue
// record it belongs to.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

const EVO_PASSWORD = "Evo-Password-987!";
const ISSUES = "/api/repositories/acme-demo/evo-reaction-repository-s1/issues";

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
    password: EVO_PASSWORD,
  });
  assert.equal(response.status, 200, `sign-in of ${identifier} failed`);
  return response.cookie;
}

function reactionOf(view, type) {
  return view.body.reactions.find((entry) => entry.type === type) ?? null;
}

/** The fields a reaction must never change, for the before/after comparison. */
function issueContent(view) {
  const { number, title, description, status, author, labels, assignees, milestone } = view.body.issue;
  return {
    number,
    title,
    description,
    status,
    author,
    labels,
    assignees,
    milestone,
    comments: view.body.comments,
  };
}

test("REQ-5-5: a signed-in viewer adds the +1 reaction and it survives a restart", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", `${ISSUES}/1`);
    assert.equal(before.status, 200);
    assert.equal(before.body.issue.title, "Evo reaction issue s1");
    assert.equal(before.body.canReact, false);
    assert.equal(reactionOf(before, "+1"), null);

    const cookie = await signIn(app.baseUrl, "evo-reaction-author");
    const opened = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
    assert.equal(opened.body.canReact, true);

    const added = await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "+1" }, cookie);
    assert.equal(added.status, 200);
    const added1 = reactionOf(added, "+1");
    assert.equal(added1.count, 1);
    assert.equal(added1.reacted, true);
    // The reaction leaves the issue record itself untouched.
    assert.deepEqual(issueContent(added), issueContent(before));

    // Repeating the same reaction keeps exactly one persisted record.
    const repeated = await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "+1" }, cookie);
    assert.equal(repeated.status, 200);
    assert.equal(reactionOf(repeated, "+1").count, 1);

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const cookie2 = await signIn(restarted.baseUrl, "evo-reaction-author");
      const reloaded = await request(restarted.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie2);
      const kept = reactionOf(reloaded, "+1");
      assert.equal(kept.count, 1);
      assert.equal(kept.reacted, true);
      assert.equal(reloaded.body.issue.title, "Evo reaction issue s1");
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("REQ-5-5: the viewer withdraws only their own reaction and the count returns to its original value", async () => {
  const app = await startApp();
  try {
    const user = await signIn(app.baseUrl, "evo-reaction-user");
    const initial = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, user);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.issue.title, "Evo reaction issue s2");
    assert.equal(reactionOf(initial, "+1"), null);
    const original = issueContent(initial);

    const added = await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "+1" }, user);
    assert.equal(reactionOf(added, "+1").count, 1);
    assert.equal(reactionOf(added, "+1").reacted, true);

    const removed = await request(app.baseUrl, "DELETE", `${ISSUES}/2/reactions/%2B1`, undefined, user);
    assert.equal(removed.status, 200);
    assert.equal(reactionOf(removed, "+1"), null);
    assert.deepEqual(issueContent(removed), original);

    // Another account's reaction of the same type is never withdrawn by this
    // viewer, and the count reflects both accounts.
    const other = await signIn(app.baseUrl, "evo-reaction-author");
    await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "+1" }, other);
    const mine = await request(app.baseUrl, "POST", `${ISSUES}/2/reactions`, { type: "+1" }, user);
    assert.equal(reactionOf(mine, "+1").count, 2);
    const withdrawn = await request(app.baseUrl, "DELETE", `${ISSUES}/2/reactions/%2B1`, undefined, user);
    assert.equal(reactionOf(withdrawn, "+1").count, 1);
    assert.equal(reactionOf(withdrawn, "+1").reacted, false);

    // The other account still sees its own reaction as its own.
    const otherView = await request(app.baseUrl, "GET", `${ISSUES}/2`, undefined, other);
    assert.equal(reactionOf(otherView, "+1").count, 1);
    assert.equal(reactionOf(otherView, "+1").reacted, true);
    assert.deepEqual(issueContent(otherView), original);
  } finally {
    await app.close();
  }
});

test("REQ-5-5: a visitor reads the existing count but can never react", async () => {
  const app = await startApp();
  try {
    const visited = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.equal(visited.status, 200);
    assert.equal(visited.body.issue.title, "Evo reaction issue s3");
    assert.equal(visited.body.canReact, false);
    const existing = reactionOf(visited, "+1");
    assert.equal(existing.count, 1);
    assert.equal(existing.reacted, false);

    const refused = await request(app.baseUrl, "POST", `${ISSUES}/3/reactions`, { type: "+1" });
    assert.equal(refused.status, 401);
    const stillThere = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.equal(reactionOf(stillThere, "+1").count, 1);
  } finally {
    await app.close();
  }
});

test("REQ-5-5: an unknown reaction type and an unknown issue are refused without writing", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-reaction-author");
    const invalid = await request(app.baseUrl, "POST", `${ISSUES}/1/reactions`, { type: "heart" }, cookie);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.reaction, "Reaction is invalid");

    const missing = await request(app.baseUrl, "POST", `${ISSUES}/99/reactions`, { type: "+1" }, cookie);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.message, "Issue not found");

    const unchanged = await request(app.baseUrl, "GET", `${ISSUES}/1`, undefined, cookie);
    assert.equal(reactionOf(unchanged, "+1"), null);
  } finally {
    await app.close();
  }
});

test("REQ-5-5: an existing store receives the reaction seeds once and keeps its records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-reaction-upgrade-"));
  // A store written by the previous build: seed version 4, a user repository
  // with a user issue and no reaction records at all.
  await writeFile(
    join(dataDir, "organizations.json"),
    JSON.stringify({
      seedVersion: 4,
      organizations: [{ id: "acme-demo", displayName: "Acme Demo" }],
      memberships: [{ organizationId: "acme-demo", accountId: "account-org-owner", role: "Owner" }],
      teams: [],
      teamMembers: [],
      repositories: [
        {
          id: "repo-user-notes",
          ownerType: "organization",
          ownerId: "acme-demo",
          name: "user-notes",
          description: "Kept as it is.",
          visibility: "public",
          defaultBranch: "main",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      branches: [],
      commits: [],
      accessGrants: [],
      labels: [],
      milestones: [],
      issues: [
        {
          id: "issue-user-notes-1",
          repositoryId: "repo-user-notes",
          number: 1,
          title: "User issue",
          description: "Kept as it is.",
          status: "open",
          authorName: "org-owner",
          labelIds: [],
          assigneeIds: [],
          milestoneId: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      issueComments: [],
      issueEvents: [],
      issueReactions: [],
    }),
    "utf8",
  );

  const store = createOrgStore(dataDir);
  // The user records are kept untouched.
  assert.equal((await store.getRepositoryById("repo-user-notes")).name, "user-notes");
  const userIssues = await store.listIssues("repo-user-notes");
  assert.deepEqual(userIssues.map((issue) => issue.title), ["User issue"]);

  // The reaction seeds arrive with their repository and their existing count.
  const repository = await store.getRepository({
    organizationId: "acme-demo",
    name: "evo-reaction-repository-s1",
  });
  assert.ok(repository, "the reaction repository was not added");
  const issues = await store.listIssues(repository.id);
  assert.deepEqual(issues.map((issue) => issue.title), [
    "Evo reaction issue s1",
    "Evo reaction issue s2",
    "Evo reaction issue s3",
  ]);
  const s3 = await store.getIssue(repository.id, 3);
  assert.deepEqual(s3.reactions.map((entry) => [entry.type, entry.count]), [["+1", 1]]);

  // Restarting against the same directory neither duplicates nor overwrites.
  const restarted = createOrgStore(dataDir);
  const stored = JSON.parse(await readFile(join(dataDir, "organizations.json"), "utf8"));
  assert.equal(
    stored.issues.filter((issue) => issue.repositoryId === repository.id).length,
    3,
    "restarting duplicated the reaction issues",
  );
  assert.equal(stored.issueReactions.length, 1, "restarting duplicated the seeded reaction");
  assert.equal((await restarted.listIssues("repo-user-notes")).length, 1);
});

test("REQ-5-5: a reaction of a private issue stays behind the repository read rule", async () => {
  const app = await startApp();
  try {
    const refused = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/secret-research/issues/1",
    );
    assert.equal(refused.status, 403);
    // The repository read rule is applied before any session check, so an
    // anonymous caller learns nothing about a private repository's issues.
    const anonymous = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/secret-research/issues/1/reactions",
      { type: "+1" },
    );
    assert.equal(anonymous.status, 403);
    assert.equal(anonymous.body.message, "Access denied");
  } finally {
    await app.close();
  }
});
