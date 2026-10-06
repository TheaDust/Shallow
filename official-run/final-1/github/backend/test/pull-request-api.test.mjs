// REQ-6-1 and REQ-6-2 over the real HTTP surface: the pull-request list of a
// public repository, the branch comparison, creation with the title rule,
// persistence across a restart, the branch protection rule of one exact branch
// and the `test` status check of an Open pull request.
//
// Every mutation is checked per operation: a visitor reads, a Write contributor
// creates pull requests, and only the repository Admin creates a protection rule
// or sets the status check.

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
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-pull-"));
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

async function request(baseUrl, method, path, body, cookie) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}

async function signIn(baseUrl, identifier) {
  const result = await request(baseUrl, "POST", "/api/auth/sign-in", {
    identifier,
    password: "Valid-password-123!",
  });
  assert.equal(result.status, 200);
  return result.cookie;
}

test("a metadata editor sets an existing repository milestone on a pull request", async () => {
  const app = await startApp();
  try {
    // `issue-editor` holds Maintain on the public `acme-docs`: the operation
    // rule for assigning a repository milestone is the triage rule.
    const editor = await signIn(app.baseUrl, "issue-editor");

    // A name this repository does not define is refused without writing, so the
    // selector never creates a milestone or borrows one from elsewhere.
    const unknown = await request(
      app.baseUrl,
      "PUT",
      "/api/repositories/acme-demo/acme-docs/pulls/1/milestone",
      { name: "v9.9" },
      editor,
    );
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fieldErrors.milestone, "Milestone is invalid");

    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/1");
    assert.equal(before.body.pullRequest.milestone, null);

    // Selecting the existing milestone stores the relationship in one step and
    // leaves the content and status of the pull request untouched.
    const set = await request(
      app.baseUrl,
      "PUT",
      "/api/repositories/acme-demo/acme-docs/pulls/1/milestone",
      { name: "v1.0" },
      editor,
    );
    assert.equal(set.status, 200);
    assert.equal(set.body.pullRequest.milestone.name, "v1.0");
    assert.equal(set.body.pullRequest.status, "open");
    assert.ok(set.body.events.some((event) => event.type === "milestone-set"));

    // A Write-only account may read the metadata but not change it.
    const writer = await signIn(app.baseUrl, "pr-contributor");
    const refused = await request(
      app.baseUrl,
      "PUT",
      "/api/repositories/acme-demo/acme-docs/pulls/1/milestone",
      { name: "v1.0" },
      writer,
    );
    assert.equal(refused.status, 403);

    // Any reader sees the saved relationship, and it survives a restart.
    const visitor = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/1");
    assert.equal(visitor.body.pullRequest.milestone.name, "v1.0");

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const persisted = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/acme-demo/acme-docs/pulls/1",
      );
      assert.equal(persisted.body.pullRequest.milestone.name, "v1.0");

      // The selector may clear the relationship again; only the milestone
      // changes, so the title and status stay as they were.
      const editorAgain = await signIn(restarted.baseUrl, "issue-editor");
      const cleared = await request(
        restarted.baseUrl,
        "DELETE",
        "/api/repositories/acme-demo/acme-docs/pulls/1/milestone",
        undefined,
        editorAgain,
      );
      assert.equal(cleared.status, 200);
      assert.equal(cleared.body.pullRequest.milestone, null);
      assert.equal(cleared.body.pullRequest.status, "open");
      assert.equal(cleared.body.pullRequest.title, "Improve onboarding");
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a visitor lists the seeded Open pull request of the public repository", async () => {
  const app = await startApp();
  try {
    const list = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls");
    assert.equal(list.status, 200);
    const pull = list.body.pullRequests.find((entry) => entry.title === "Improve onboarding");
    assert.ok(pull, "the seeded Open pull request is listed");
    assert.equal(pull.number, 1);
    assert.equal(pull.status, "open");
    assert.equal(pull.sourceBranch, "onboarding-docs");
    assert.equal(pull.targetBranch, "main");
    assert.equal(typeof pull.author, "string");

    const detail = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/1");
    assert.equal(detail.status, 200);
    assert.equal(detail.body.pullRequest.title, "Improve onboarding");
    assert.equal(detail.body.pullRequest.status, "open");
    // The comparison reads the same stored revisions as the list.
    assert.ok(detail.body.baseCommit);
    assert.ok(detail.body.compareCommit);
    assert.ok(detail.body.commits.some((commit) => commit.id === detail.body.pullRequest.compareCommitId));
    assert.deepEqual(
      detail.body.changes.map((change) => change.path),
      ["docs/onboarding.md"],
    );

    // Reading the list twice serves the same stored data.
    const again = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls");
    assert.deepEqual(
      again.body.pullRequests.map((entry) => entry.number),
      list.body.pullRequests.map((entry) => entry.number),
    );
  } finally {
    await app.close();
  }
});

test("pull requests of a private repository stay unreadable for a visitor", async () => {
  const app = await startApp();
  try {
    const denied = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/secret-research/pulls");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");
  } finally {
    await app.close();
  }
});

test("the comparison reports the changed file and commit of feature-search", async () => {
  const app = await startApp();
  try {
    const comparison = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/pulls/compare?base=main&compare=feature-search",
    );
    assert.equal(comparison.status, 200);
    assert.equal(comparison.body.base, "main");
    assert.equal(comparison.body.compare, "feature-search");
    assert.equal(comparison.body.identical, false);
    assert.ok(comparison.body.changes.some((change) => change.path === "src/search.ts"));
    assert.ok(comparison.body.commits.length > 0);
    assert.equal(comparison.body.commits[0].message, "Refine the search result");

    const same = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/acme-docs/pulls/compare?base=main&compare=main",
    );
    assert.equal(same.status, 200);
    assert.equal(same.body.identical, true);
    assert.deepEqual(same.body.changes, []);
  } finally {
    await app.close();
  }
});

test("a Write contributor creates an Open pull request from a valid comparison", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "pr-contributor");
    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls");
    const expectedNumber =
      Math.max(...before.body.pullRequests.map((entry) => entry.number)) + 1;
    const title = "Add the search refinement";
    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls",
      { title, description: "Refines the stored search helper.", base: "main", compare: "feature-search" },
      cookie,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.pullRequest.title, title);
    assert.equal(created.body.pullRequest.status, "open");
    assert.equal(created.body.pullRequest.number, expectedNumber);
    assert.equal(created.body.pullRequest.sourceBranch, "feature-search");
    assert.equal(created.body.pullRequest.targetBranch, "main");
    assert.equal(created.body.canWrite, true);

    const list = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls");
    assert.ok(list.body.pullRequests.some((entry) => entry.title === title));

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const persisted = await request(
        restarted.baseUrl,
        "GET",
        `/api/repositories/acme-demo/acme-docs/pulls/${expectedNumber}`,
      );
      assert.equal(persisted.status, 200);
      assert.equal(persisted.body.pullRequest.title, title);
      assert.equal(persisted.body.pullRequest.status, "open");
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a draft creation stores Draft and can be marked Ready for review", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "pr-contributor");
    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls",
      { title: "Draft the search refinement", base: "main", compare: "feature-search", draft: true },
      cookie,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.pullRequest.status, "draft");

    const number = created.body.pullRequest.number;
    const ready = await request(
      app.baseUrl,
      "PATCH",
      `/api/repositories/acme-demo/acme-docs/pulls/${number}/status`,
      { status: "open" },
      cookie,
    );
    assert.equal(ready.status, 200);
    assert.equal(ready.body.pullRequest.status, "open");
  } finally {
    await app.close();
  }
});

test("a whitespace-only pull request title is rejected and creates nothing", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "pr-contributor");
    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls");
    const rejected = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls",
      { title: "   ", base: "main", compare: "feature-search" },
      cookie,
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fieldErrors.title, "Title is required");

    const after = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls");
    assert.equal(after.body.pullRequests.length, before.body.pullRequests.length);

    // The two identical sides are refused too, so no empty proposal is stored.
    const identical = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls",
      { title: "Same branches", base: "main", compare: "main" },
      cookie,
    );
    assert.equal(identical.status, 400);
    assert.equal(identical.body.fieldErrors.compare, "No differences between these branches");
  } finally {
    await app.close();
  }
});

test("pull-request creation needs the write rule", async () => {
  const app = await startApp();
  try {
    const visitor = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls",
      { title: "Anonymous proposal", base: "main", compare: "feature-search" },
    );
    assert.equal(visitor.status, 401);

    // `issue-viewer` holds only Read on `acme-docs`.
    const reader = await signIn(app.baseUrl, "issue-viewer");
    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls",
      { title: "Read-only proposal", base: "main", compare: "feature-search" },
      reader,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.message, "Access denied");
  } finally {
    await app.close();
  }
});

test("an Admin creates a branch protection rule that survives a restart", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "protection-admin");

    const empty = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-protection-demo/branch-protections",
    );
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.rules, []);
    assert.equal(empty.body.canManage, false);

    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-protection-demo/branch-protections",
      { branchName: "main", requireApprovals: true, requireStatusCheck: true },
      cookie,
    );
    assert.equal(created.status, 200);
    assert.equal(created.body.rule.branchName, "main");
    assert.equal(created.body.rule.requireApprovals, true);
    assert.equal(created.body.rule.requireStatusCheck, true);
    assert.equal(created.body.rule.statusCheckName, "test");

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const admin = await signIn(restarted.baseUrl, "protection-admin");
      const persisted = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/acme-demo/branch-protection-demo/branch-protections",
        undefined,
        admin,
      );
      assert.equal(persisted.status, 200);
      assert.equal(persisted.body.canManage, true);
      assert.deepEqual(
        persisted.body.rules.map((rule) => [rule.branchName, rule.requireApprovals, rule.requireStatusCheck]),
        [["main", true, true]],
      );

      // A repeated save updates the same exact branch instead of duplicating it.
      const again = await request(
        restarted.baseUrl,
        "POST",
        "/api/repositories/acme-demo/branch-protection-demo/branch-protections",
        { branchName: "main", requireApprovals: true, requireStatusCheck: true },
        admin,
      );
      assert.equal(again.status, 200);
      assert.equal(again.body.rules.length, 1);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a non-Admin can read the public repository but never create the rule", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "protection-viewer");
    const forbidden = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-protection-demo/branch-protections",
      { branchName: "main", requireApprovals: true, requireStatusCheck: true },
      cookie,
    );
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.message, "Access denied");

    const rules = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-protection-demo/branch-protections",
      undefined,
      cookie,
    );
    assert.equal(rules.status, 200);
    assert.equal(rules.body.canManage, false);
    assert.deepEqual(rules.body.rules, []);
  } finally {
    await app.close();
  }
});

test("the Admin moves the test check from pending to success and it persists", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "protection-admin");
    const before = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1",
    );
    assert.equal(before.body.pullRequest.title, "Protection status onboarding PR");
    assert.equal(before.body.pullRequest.status, "open");
    assert.deepEqual(before.body.checks, [{ name: "test", status: "pending", setter: null }]);

    const updated = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1/checks",
      { name: "test", status: "success" },
      cookie,
    );
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.checks, [
      { name: "test", status: "success", setter: "protection-admin" },
    ]);

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const persisted = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/acme-demo/branch-protection-demo/pulls/1",
      );
      assert.deepEqual(persisted.body.checks, [
        { name: "test", status: "success", setter: "protection-admin" },
      ]);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("setting a status check needs the administrator rule and a valid status", async () => {
  const app = await startApp();
  try {
    const visitor = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1/checks",
      { name: "test", status: "success" },
    );
    assert.equal(visitor.status, 401);

    const viewer = await signIn(app.baseUrl, "protection-viewer");
    const denied = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1/checks",
      { name: "test", status: "success" },
      viewer,
    );
    assert.equal(denied.status, 403);

    const admin = await signIn(app.baseUrl, "protection-admin");
    const invalid = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1/checks",
      { name: "test", status: "unknown" },
      admin,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.status, "Check status is invalid");

    // The rejected update left the seeded pending status in place.
    const stored = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1",
    );
    assert.deepEqual(stored.body.checks, [{ name: "test", status: "pending", setter: null }]);
  } finally {
    await app.close();
  }
});

test("the seeded Draft pull request is listed as Draft and its author marks it ready for review", async () => {
  const app = await startApp();
  try {
    const list = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls");
    const draft = list.body.pullRequests.find((entry) => entry.title === "Draft onboarding update");
    assert.ok(draft, "the seeded Draft pull request is listed");
    assert.equal(draft.status, "draft");
    assert.equal(draft.sourceBranch, "draft-feature");
    assert.equal(draft.targetBranch, "main");
    assert.equal(draft.author, "draft-author");

    // A visitor and a non-author writer may not transition the draft.
    const visitor = await request(
      app.baseUrl,
      "PATCH",
      `/api/repositories/acme-demo/acme-docs/pulls/${draft.number}/status`,
      { status: "open" },
    );
    assert.equal(visitor.status, 401);
    const contributor = await signIn(app.baseUrl, "pr-contributor");
    const stranger = await request(
      app.baseUrl,
      "PATCH",
      `/api/repositories/acme-demo/acme-docs/pulls/${draft.number}/status`,
      { status: "open" },
      contributor,
    );
    assert.equal(stranger.status, 403);

    const author = await signIn(app.baseUrl, "draft-author");
    const ready = await request(
      app.baseUrl,
      "PATCH",
      `/api/repositories/acme-demo/acme-docs/pulls/${draft.number}/status`,
      { status: "open" },
      author,
    );
    assert.equal(ready.status, 200);
    assert.equal(ready.body.pullRequest.status, "open");
    // The title and both branches stay exactly as stored.
    assert.equal(ready.body.pullRequest.title, "Draft onboarding update");
    assert.equal(ready.body.pullRequest.sourceBranch, "draft-feature");
    assert.equal(ready.body.pullRequest.targetBranch, "main");
    assert.ok(
      ready.body.events.some(
        (event) => event.type === "ready-for-review" && event.actor === "draft-author",
      ),
      "the ready-for-review activity is recorded",
    );

    const stored = await request(
      app.baseUrl,
      "GET",
      `/api/repositories/acme-demo/acme-docs/pulls/${draft.number}`,
    );
    assert.equal(stored.body.pullRequest.status, "open");
    assert.ok(stored.body.events.some((event) => event.type === "ready-for-review"));
  } finally {
    await app.close();
  }
});

test("a non-author reviewer publishes a line comment that persists", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/4");
    assert.equal(before.body.pullRequest.status, "open");
    assert.deepEqual(before.body.reviewComments, []);
    assert.ok(before.body.changes.some((change) => change.path === "src/index.js"));

    const cookie = await signIn(app.baseUrl, "pr-reviewer");
    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/comments",
      { body: "Please clarify this line.", filePath: "src/index.js", lineIndex: 1, state: "published" },
      cookie,
    );
    assert.equal(created.status, 200);
    assert.equal(created.body.reviewComments.length, 1);
    const comment = created.body.reviewComments[0];
    assert.equal(comment.body, "Please clarify this line.");
    assert.equal(comment.state, "published");
    assert.equal(comment.author, "pr-reviewer");
    assert.equal(comment.filePath, "src/index.js");
    assert.equal(comment.lineIndex, 1);

    const reloaded = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/4");
    assert.equal(reloaded.body.reviewComments.length, 1);
    assert.equal(reloaded.body.reviewComments[0].body, "Please clarify this line.");
  } finally {
    await app.close();
  }
});

test("a reviewer stores a pending review comment that persists", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "pr-reviewer");
    const created = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/5/comments",
      { body: "Hold this until the tests pass.", filePath: "src/README.md", lineIndex: 1, state: "pending" },
      cookie,
    );
    assert.equal(created.status, 200);
    assert.equal(created.body.reviewComments.length, 1);
    assert.equal(created.body.reviewComments[0].state, "pending");
    assert.equal(created.body.reviewComments[0].body, "Hold this until the tests pass.");

    const reloaded = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/5");
    assert.equal(reloaded.body.reviewComments[0].state, "pending");
    assert.equal(reloaded.body.reviewComments[0].body, "Hold this until the tests pass.");
  } finally {
    await app.close();
  }
});

test("review line comments need a signed-in non-author with the write rule", async () => {
  const app = await startApp();
  try {
    const visitor = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/comments",
      { body: "Anonymous note", filePath: "src/index.js", lineIndex: 1, state: "published" },
    );
    assert.equal(visitor.status, 401);

    // The PR author is never treated as the reviewer.
    const author = await signIn(app.baseUrl, "alice-dev");
    const authorDenied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/comments",
      { body: "Author note", filePath: "src/index.js", lineIndex: 1, state: "published" },
      author,
    );
    assert.equal(authorDenied.status, 403);

    // A Read-only account may not review either.
    const reader = await signIn(app.baseUrl, "issue-viewer");
    const readerDenied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/comments",
      { body: "Read-only note", filePath: "src/index.js", lineIndex: 1, state: "published" },
      reader,
    );
    assert.equal(readerDenied.status, 403);

    // An empty body is rejected and stores nothing.
    const reviewer = await signIn(app.baseUrl, "pr-reviewer");
    const empty = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/comments",
      { body: "   ", filePath: "src/index.js", lineIndex: 1, state: "published" },
      reviewer,
    );
    assert.equal(empty.status, 400);
    assert.equal(empty.body.fieldErrors.comment, "Comment is required");
    const stored = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/4");
    assert.deepEqual(stored.body.reviewComments, []);
  } finally {
    await app.close();
  }
});

test("only a Maintain/Admin/Owner merges an Open pull request and Merged is terminal", async () => {
  const app = await startApp();
  try {
    // A Write contributor may not merge.
    const contributor = await signIn(app.baseUrl, "pr-contributor");
    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1/merge",
      undefined,
      contributor,
    );
    assert.equal(denied.status, 403);

    const visitor = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1/merge",
    );
    assert.equal(visitor.status, 401);

    // An organization Owner merges the Open proposal of an unprotected target
    // into its base branch.
    const owner = await signIn(app.baseUrl, "org-owner");
    const merged = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1/merge",
      undefined,
      owner,
    );
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.status, "merged");
    assert.equal(merged.body.pullRequest.mergedBy, "org-owner");
    assert.ok(merged.body.pullRequest.mergedCommitId);
    assert.ok(merged.body.events.some((event) => event.type === "merged"));

    // Merged is terminal: it can neither be closed nor reopened.
    const reopen = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/branch-protection-demo/pulls/1/status",
      { status: "open" },
      owner,
    );
    assert.equal(reopen.status, 400);

    // A Draft proposal can never be merged.
    const draft = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/6/merge",
      undefined,
      owner,
    );
    assert.equal(draft.status, 400);
    assert.equal(draft.body.fieldErrors.status, "This pull request cannot be merged");
  } finally {
    await app.close();
  }
});
