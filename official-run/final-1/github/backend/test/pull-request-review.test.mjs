// REQ-6-3-4 / REQ-6-4 / REQ-6-5 / REQ-6-6 over the real HTTP surface: submitting a
// review decision, managing the pending reviewer requests, merging an eligible
// protected-target proposal and the close/reopen cycle.
//
// Every operation re-applies its rule on the trusted boundary: reviewing needs a
// signed-in non-author with the write rule, requesting reviewers needs the
// author or a Maintain/Admin/Owner, and merging needs Maintain/Admin/Owner plus
// the enforced protection requirements of the exact target branch.

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
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-pull-review-"));
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

test("a non-author reviewer approves an Open pull request and it persists", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/4");
    assert.equal(before.body.pullRequest.title, "Reviewable onboarding PR");
    assert.deepEqual(before.body.reviews, []);
    assert.equal(before.body.canReview, false);

    const cookie = await signIn(app.baseUrl, "pr-reviewer");
    const submitted = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/reviews",
      { decision: "approved" },
      cookie,
    );
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.reviews.length, 1);
    assert.equal(submitted.body.reviews[0].decision, "approved");
    assert.equal(submitted.body.reviews[0].reviewer, "pr-reviewer");
    assert.equal(submitted.body.reviews[0].stale, false);
    // The valid non-author approval satisfies the protected-branch review rule
    // (the exact `test` check of this proposal is still missing).
    assert.equal(submitted.body.merge.reviewRequired, false);

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const persisted = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/acme-demo/acme-docs/pulls/4",
      );
      assert.equal(persisted.body.reviews.length, 1);
      assert.equal(persisted.body.reviews[0].decision, "approved");
      assert.equal(persisted.body.reviews[0].reviewer, "pr-reviewer");
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a Request changes review stores and displays its exact summary", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "pr-reviewer");
    const summary = "Please tighten the change request wording.";
    const submitted = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/7/reviews",
      { decision: "changes-requested", summary },
      cookie,
    );
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.reviews[0].decision, "changes-requested");
    assert.equal(submitted.body.reviews[0].summary, summary);
    // A valid Request changes review blocks the merge.
    assert.equal(submitted.body.merge.eligible, false);

    const reloaded = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/7");
    assert.equal(reloaded.body.reviews[0].decision, "changes-requested");
    assert.equal(reloaded.body.reviews[0].summary, summary);
  } finally {
    await app.close();
  }
});

test("submitting a review needs a signed-in non-author with the write rule", async () => {
  const app = await startApp();
  try {
    const visitor = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/reviews",
      { decision: "approved" },
    );
    assert.equal(visitor.status, 401);

    // The PR author is never the reviewer.
    const author = await signIn(app.baseUrl, "alice-dev");
    const authorDenied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/reviews",
      { decision: "approved" },
      author,
    );
    assert.equal(authorDenied.status, 403);

    // A Read-only account may not review either.
    const reader = await signIn(app.baseUrl, "issue-viewer");
    const readerDenied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/reviews",
      { decision: "approved" },
      reader,
    );
    assert.equal(readerDenied.status, 403);

    // An unknown decision is rejected and stores nothing.
    const reviewer = await signIn(app.baseUrl, "pr-reviewer");
    const invalid = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/4/reviews",
      { decision: "maybe" },
      reviewer,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.decision, "Review decision is invalid");
    const stored = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/4");
    assert.deepEqual(stored.body.reviews, []);
  } finally {
    await app.close();
  }
});

test("the author requests a reviewer, keeps it after restart and removes it again", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/8");
    assert.equal(before.body.pullRequest.title, "Reviewer request onboarding PR");
    assert.equal(before.body.pullRequest.author, "pr-author");
    assert.deepEqual(before.body.requestedReviewers, []);
    assert.ok(before.body.availableReviewers.includes("bob-reviewer"));

    const cookie = await signIn(app.baseUrl, "pr-author");
    const requested = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/8/reviewers",
      { username: "bob-reviewer" },
      cookie,
    );
    assert.equal(requested.status, 200);
    assert.deepEqual(requested.body.requestedReviewers, ["bob-reviewer"]);

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const persisted = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/acme-demo/acme-docs/pulls/8",
      );
      assert.deepEqual(persisted.body.requestedReviewers, ["bob-reviewer"]);

      const author = await signIn(restarted.baseUrl, "pr-author");
      const removed = await request(
        restarted.baseUrl,
        "DELETE",
        "/api/repositories/acme-demo/acme-docs/pulls/8/reviewers/bob-reviewer",
        undefined,
        author,
      );
      assert.equal(removed.status, 200);
      assert.deepEqual(removed.body.requestedReviewers, []);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("managing reviewers needs the author or a maintainer and an eligible collaborator", async () => {  const app = await startApp();
  try {
    const visitor = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/8/reviewers",
      { username: "bob-reviewer" },
    );
    assert.equal(visitor.status, 401);

    // A non-author writer without the maintain rule may not manage the requests.
    const stranger = await signIn(app.baseUrl, "pr-reviewer");
    const denied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/8/reviewers",
      { username: "bob-reviewer" },
      stranger,
    );
    assert.equal(denied.status, 403);

    // A maintainer may manage them.
    const maintainer = await signIn(app.baseUrl, "pr-maintainer");
    const saved = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/8/reviewers",
      { username: "bob-reviewer" },
      maintainer,
    );
    assert.equal(saved.status, 200);

    // An unknown collaborator is rejected and writes nothing new.
    const invalid = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/8/reviewers",
      { username: "not-a-member" },
      maintainer,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.reviewer, "Reviewer is invalid");
    const stored = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/8");
    assert.deepEqual(stored.body.requestedReviewers, ["bob-reviewer"]);
  } finally {
    await app.close();
  }
});

test("a maintainer merges the eligible protected proposal and its branch advances", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/9");
    assert.equal(before.body.pullRequest.title, "Mergeable onboarding PR");
    assert.equal(before.body.merge.eligible, true);
    assert.equal(before.body.merge.reviewRequired, false);
    assert.ok(before.body.merge.conditions.every((condition) => condition.satisfied));

    const branchesBefore = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/branches");
    const mainBefore = branchesBefore.body.branches.find((branch) => branch.name === "main").headCommitId;

    const cookie = await signIn(app.baseUrl, "pr-maintainer");
    const merged = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/9/merge",
      undefined,
      cookie,
    );
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.status, "merged");
    assert.equal(merged.body.pullRequest.mergedBy, "pr-maintainer");
    assert.ok(merged.body.pullRequest.mergedAt);
    assert.ok(merged.body.pullRequest.mergedCommitId);
    assert.ok(merged.body.events.some((event) => event.type === "merged"));

    const branchesAfter = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/branches");
    const mainAfter = branchesAfter.body.branches.find((branch) => branch.name === "main").headCommitId;
    assert.notEqual(mainAfter, mainBefore);
    assert.equal(mainAfter, merged.body.pullRequest.mergedCommitId);

    // The merged proposal is terminal and keeps the merge record after restart.
    const reopen = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/acme-docs/pulls/9/status",
      { status: "open" },
      cookie,
    );
    assert.equal(reopen.status, 400);

    await app.close();
    const restarted = await startDataDir(app.dataDir);
    try {
      const persisted = await request(
        restarted.baseUrl,
        "GET",
        "/api/repositories/acme-demo/acme-docs/pulls/9",
      );
      assert.equal(persisted.body.pullRequest.status, "merged");
      assert.equal(persisted.body.pullRequest.mergedCommitId, mainAfter);
      const branch = await request(restarted.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/branches");
      assert.equal(branch.body.branches.find((entry) => entry.name === "main").headCommitId, mainAfter);
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("the blocked protected proposal is refused and changes nothing", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "pr-maintainer");

    // The refusal must not depend on the success scenario: merge the eligible
    // sibling first, then the blocked proposal still reports only the missing
    // approval (no merge conflict).
    const merged = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/9/merge",
      undefined,
      cookie,
    );
    assert.equal(merged.status, 200);

    const before = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/10");
    assert.equal(before.body.pullRequest.title, "Blocked onboarding PR");
    assert.equal(before.body.merge.eligible, false);
    assert.equal(before.body.merge.reviewRequired, true);
    assert.equal(before.body.merge.blockedReason, "Review required by branch protection");

    const branchesBefore = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/branches");
    const mainBefore = branchesBefore.body.branches.find((branch) => branch.name === "main").headCommitId;

    const refused = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/10/merge",
      undefined,
      cookie,
    );
    assert.equal(refused.status, 400);
    assert.equal(refused.body.fieldErrors.status, "Review required by branch protection");

    const after = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/10");
    assert.equal(after.body.pullRequest.status, "open");
    const branchesAfter = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/branches");
    assert.equal(branchesAfter.body.branches.find((branch) => branch.name === "main").headCommitId, mainBefore);
  } finally {
    await app.close();
  }
});

test("merging requires the maintain rule", async () => {
  const app = await startApp();
  try {
    // A Read-only viewer may not merge.
    const viewer = await signIn(app.baseUrl, "pr-viewer");
    const viewerDenied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/9/merge",
      undefined,
      viewer,
    );
    assert.equal(viewerDenied.status, 403);

    // A Write contributor may not merge either.
    const contributor = await signIn(app.baseUrl, "pr-author");
    const contributorDenied = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/9/merge",
      undefined,
      contributor,
    );
    assert.equal(contributorDenied.status, 403);

    // The refused attempts left the proposal Open and its target branch intact.
    const stored = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/9");
    assert.equal(stored.body.pullRequest.status, "open");
  } finally {
    await app.close();
  }
});

test("the author closes and reopens an unmerged proposal without moving a branch", async () => {
  const app = await startApp();
  try {
    const branchesBefore = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/branches");
    const mainBefore = branchesBefore.body.branches.find((branch) => branch.name === "main").headCommitId;

    const cookie = await signIn(app.baseUrl, "pr-author");
    const closed = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/acme-docs/pulls/11/status",
      { status: "closed" },
      cookie,
    );
    assert.equal(closed.status, 200);
    assert.equal(closed.body.pullRequest.status, "closed");

    const reopened = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/acme-docs/pulls/11/status",
      { status: "open" },
      cookie,
    );
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.pullRequest.status, "open");

    const branchesAfter = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/branches");
    assert.equal(branchesAfter.body.branches.find((branch) => branch.name === "main").headCommitId, mainBefore);
  } finally {
    await app.close();
  }
});

test("a viewer without the author or maintain rule may not close or reopen", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "pr-viewer");
    const denied = await request(
      app.baseUrl,
      "PATCH",
      "/api/repositories/acme-demo/acme-docs/pulls/12/status",
      { status: "closed" },
      cookie,
    );
    assert.equal(denied.status, 403);

    const stored = await request(app.baseUrl, "GET", "/api/repositories/acme-demo/acme-docs/pulls/12");
    assert.equal(stored.body.pullRequest.status, "open");
  } finally {
    await app.close();
  }
});

test("removing a reviewer request leaves a submitted review intact", async () => {
  const app = await startApp();
  try {
    const reviewer = await signIn(app.baseUrl, "pr-reviewer");
    const submitted = await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/8/reviews",
      { decision: "approved", summary: "Looks good to me." },
      reviewer,
    );
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.reviews.length, 1);

    const author = await signIn(app.baseUrl, "pr-author");
    await request(
      app.baseUrl,
      "POST",
      "/api/repositories/acme-demo/acme-docs/pulls/8/reviewers",
      { username: "bob-reviewer" },
      author,
    );
    const removed = await request(
      app.baseUrl,
      "DELETE",
      "/api/repositories/acme-demo/acme-docs/pulls/8/reviewers/bob-reviewer",
      undefined,
      author,
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.requestedReviewers, []);
    // The submitted review is untouched by the request removal.
    assert.equal(removed.body.reviews.length, 1);
    assert.equal(removed.body.reviews[0].decision, "approved");
    assert.equal(removed.body.reviews[0].reviewer, "pr-reviewer");
  } finally {
    await app.close();
  }
});
