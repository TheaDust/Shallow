import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore, createSeedData } from "../src/domain/store.mjs";

/**
 * REQ-6-4 to REQ-6-6: the collaboration control of a pull request.
 *
 * A "reviewer request" is a pending-review relationship between a pull request
 * and one eligible candidate account; the `merge-lab` repository seeds the
 * branch protection rule of `main` together with an eligible and a blocked
 * proposal, and the `acme-docs` proposals carry no pending-review relationship
 * at all (REQ-6-4). Closing and reopening change only the status, the operator
 * and the time (REQ-6-6), and merging writes the current compare commit into
 * the base branch after every condition of the rule is satisfied (REQ-6-5).
 * Every refusal stores nothing.
 */

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
          const text = await response.text();
          return {
            status: response.status,
            cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
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

async function storedDocument() {
  try {
    return JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return createSeedData();
  }
}

async function storedPullRequest(repositoryId, number) {
  return (await storedDocument()).pullRequests.find(
    (pullRequest) => pullRequest.repositoryId === repositoryId && pullRequest.number === number,
  );
}

async function branchHead(repositoryName, branchName) {
  const repository = (await storedDocument()).repositories.find(
    (candidate) => candidate.name === repositoryName,
  );
  return repository.branches.find((branch) => branch.name === branchName).headId;
}

const ACME = "/api/repositories/alice-dev/acme-docs/pulls";
const LAB = "/api/repositories/alice-dev/merge-lab/pulls";
const ACME_ID = "repository-alice-dev-acme-docs";
const LAB_ID = "repository-alice-dev-merge-lab";
const signInAs = (username) => app.signIn(username, "Valid-password-123!");

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-code-pull-collaboration-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

describe("REQ-6-4 request or remove pull request reviewers", () => {
  it("seeds the open proposal without a pending-review relationship", async () => {
    const detail = await app.request(`${ACME}/1`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.pullRequest.status, "open");
    assert.equal(detail.body.pullRequest.author, "alice-dev");
    assert.deepEqual(detail.body.pullRequest.reviewers, []);
    assert.deepEqual(detail.body.pullRequest.reviews, []);
    // Only accounts with Write or higher that are not the author are offered.
    assert.deepEqual(
      detail.body.pullRequest.reviewerCandidates.map((candidate) => [candidate.username, candidate.role]),
      [
        ["bob-reviewer", "Write"],
        ["carol-maintainer", "Maintain"],
      ],
    );
  });

  it("stores the request of an eligible account with the operator and keeps it after a reload", async () => {
    const cookie = await signInAs("alice-dev");
    const requested = await app.request(`${ACME}/1/reviewers`, {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(requested.status, 201);
    assert.equal(requested.body.pullRequest.permissions.canRequestReviewers, true);
    assert.deepEqual(requested.body.pullRequest.reviewers.map((reviewer) => reviewer.username), ["bob-reviewer"]);
    // Asking for a review grants no decision and no approval by itself.
    assert.deepEqual(requested.body.pullRequest.reviews, []);
    assert.equal(requested.body.pullRequest.merge.approvals, 0);

    const stored = await storedPullRequest(ACME_ID, 1);
    assert.equal(stored.reviewers.length, 1);
    assert.equal(stored.reviewers[0].username, "bob-reviewer");
    assert.equal(stored.reviewers[0].requestedBy, "alice-dev");
    assert.ok(stored.reviewers[0].requestedAt);

    // The same request again neither duplicates the relationship nor fails.
    const again = await app.request(`${ACME}/1/reviewers`, {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(again.status, 200);
    assert.equal((await storedPullRequest(ACME_ID, 1)).reviewers.length, 1);

    const reopened = await startApp(dataDir);
    const reloaded = await reopened.request(`${ACME}/1`);
    assert.deepEqual(reloaded.body.pullRequest.reviewers.map((reviewer) => reviewer.username), ["bob-reviewer"]);
    await new Promise((resolve) => reopened.server.close(resolve));
  });

  it("refuses an ineligible account, a foreign writer and an anonymous caller", async () => {
    const alice = await signInAs("alice-dev");
    for (const username of ["dana-observer", "alice-dev", "nobody"]) {
      const refused = await app.request(`${ACME}/1/reviewers`, {
        method: "POST",
        cookie: alice,
        body: { username },
      });
      assert.equal(refused.status, 400, `expected ${username} to be refused`);
      assert.equal(refused.body.fields.username, "That account cannot be requested as a reviewer");
    }
    assert.deepEqual((await storedPullRequest(ACME_ID, 1)).reviewers.map((r) => r.username), ["bob-reviewer"]);

    // A non-author writer who is neither the author nor a maintainer may not
    // manage the relationship.
    const bob = await signInAs("bob-reviewer");
    const forbidden = await app.request(`${ACME}/1/reviewers`, {
      method: "POST",
      cookie: bob,
      body: { username: "carol-maintainer" },
    });
    assert.equal(forbidden.status, 403);
    const anonymous = await app.request(`${ACME}/1/reviewers`, {
      method: "POST",
      body: { username: "carol-maintainer" },
    });
    assert.equal(anonymous.status, 401);
    // A closed proposal cannot gain a request either.
    const closed = await app.request(`${ACME}/2/reviewers`, {
      method: "POST",
      cookie: alice,
      body: { username: "bob-reviewer" },
    });
    assert.equal(closed.status, 400);
    assert.deepEqual((await storedPullRequest(ACME_ID, 2)).reviewers, []);
  });

  it("deletes the relationship without touching the review the account submitted", async () => {
    const cookie = await signInAs("alice-dev");
    // The eligible proposal already carries an approval of `bob-reviewer`.
    const before = await app.request(`${LAB}/1`);
    assert.equal(before.body.pullRequest.merge.approvals, 1);

    const requested = await app.request(`${LAB}/1/reviewers`, {
      method: "POST",
      cookie,
      body: { username: "bob-reviewer" },
    });
    assert.equal(requested.status, 201);
    assert.deepEqual(requested.body.pullRequest.reviewers.map((reviewer) => reviewer.username), ["bob-reviewer"]);

    const removed = await app.request(`${LAB}/1/reviewers/bob-reviewer`, { method: "DELETE", cookie });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.pullRequest.reviewers, []);
    // The submitted decision of that account survives the removal.
    assert.equal(removed.body.pullRequest.reviews.length, 1);
    assert.equal(removed.body.pullRequest.reviews[0].reviewer, "bob-reviewer");
    assert.equal(removed.body.pullRequest.merge.approvals, 1);
    assert.equal(removed.body.pullRequest.merge.mergeable, true);

    const stored = await storedPullRequest(LAB_ID, 1);
    assert.deepEqual(stored.reviewers, []);
    assert.equal(stored.reviews.length, 1);

    const missing = await app.request(`${LAB}/1/reviewers/bob-reviewer`, { method: "DELETE", cookie });
    assert.equal(missing.status, 404);
    assert.equal((await storedPullRequest(LAB_ID, 1)).reviews.length, 1);
  });
});

describe("REQ-6-5 merge an eligible pull request", () => {
  it("merges the eligible proposal into the protected base branch", async () => {
    const headBefore = await branchHead("merge-lab", "main");
    const cookie = await signInAs("carol-maintainer");
    const detail = await app.request(`${LAB}/1`, { cookie });
    assert.equal(detail.body.pullRequest.merge.mergeable, true);
    assert.deepEqual(detail.body.pullRequest.merge.rules, {
      requireApproval: true,
      requireStatusCheck: true,
      pattern: "main",
    });
    assert.deepEqual(
      detail.body.pullRequest.merge.conditions.map((condition) => [condition.label, condition.satisfied]),
      [
        ["Require 1 approval", true],
        ["Require status check test", true],
        ["No requested changes", true],
      ],
    );

    const merged = await app.request(`${LAB}/1/merge`, { method: "POST", cookie });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.status, "merged");
    assert.equal(merged.body.pullRequest.mergedBy, "carol-maintainer");
    assert.ok(merged.body.pullRequest.mergedAt);

    const stored = await storedPullRequest(LAB_ID, 1);
    assert.equal(stored.status, "merged");
    assert.equal(stored.mergedBy, "carol-maintainer");
    assert.ok(stored.mergeCommitId);
    // The base branch head is the merge commit, whose parent is the previous
    // head and whose snapshot is the one of the compare commit.
    assert.equal(await branchHead("merge-lab", "main"), stored.mergeCommitId);
    const repository = (await storedDocument()).repositories.find((entry) => entry.id === LAB_ID);
    const mergeCommit = repository.commits.find((commit) => commit.id === stored.mergeCommitId);
    assert.equal(mergeCommit.parentId, headBefore);
    assert.equal(mergeCommit.branch, "main");
    const compareCommit = repository.commits.find((commit) => commit.id === stored.compareCommitId);
    assert.deepEqual(
      mergeCommit.tree.map((file) => [file.path, file.content]),
      compareCommit.tree.map((file) => [file.path, file.content]).sort((left, right) => left[0].localeCompare(right[0])),
    );

    // The merged state and the resulting commit stay after a reload, and Merged
    // is terminal.
    const reopened = await startApp(dataDir);
    const reloaded = await reopened.request(`${LAB}/1`);
    assert.equal(reloaded.body.pullRequest.status, "merged");
    assert.equal(reloaded.body.pullRequest.mergeCommitId, stored.mergeCommitId);
    assert.equal(
      (await reopened.request("/api/repositories/alice-dev/merge-lab")).body.repository.defaultBranch,
      "main",
    );
    const again = await reopened.request(`${LAB}/1/merge`, { method: "POST", cookie });
    assert.equal(again.status, 400);
    assert.deepEqual(again.body.blockers.map((blocker) => blocker.code), ["merged"]);
    await new Promise((resolve) => reopened.server.close(resolve));
  });

  it("keeps a proposal without the required approval unmergeable and unchanged", async () => {
    const headBefore = await branchHead("merge-lab", "main");
    const cookie = await signInAs("carol-maintainer");
    const detail = await app.request(`${LAB}/2`, { cookie });
    assert.equal(detail.body.pullRequest.merge.mergeable, false);
    assert.deepEqual(detail.body.pullRequest.merge.blockers, [
      { code: "approval", message: "Review required by branch protection" },
    ]);
    assert.deepEqual(
      detail.body.pullRequest.merge.conditions.map((condition) => [condition.label, condition.satisfied]),
      [
        ["Require 1 approval", false],
        ["Require status check test", true],
        ["No requested changes", true],
      ],
    );

    const blocked = await app.request(`${LAB}/2/merge`, { method: "POST", cookie });
    assert.equal(blocked.status, 400);
    assert.deepEqual(blocked.body.blockers, [{ code: "approval", message: "Review required by branch protection" }]);
    assert.equal((await storedPullRequest(LAB_ID, 2)).status, "open");
    assert.equal(await branchHead("merge-lab", "main"), headBefore);

    // A writer who may not merge is refused before any branch is touched.
    const bob = await signInAs("bob-reviewer");
    const forbidden = await app.request(`${LAB}/1/merge`, { method: "POST", cookie: bob });
    assert.equal(forbidden.status, 403);
    assert.equal((await storedPullRequest(LAB_ID, 3)).status, "open");
  });
});

describe("REQ-6-6 close or reopen a pull request without merging", () => {
  it("closes and reopens for the author and records both transitions without moving a branch", async () => {
    const cookie = await signInAs("alice-dev");
    const headBefore = await branchHead("acme-docs", "main");

    const closed = await app.request(`${ACME}/3/close`, { method: "POST", cookie });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.pullRequest.status, "closed");
    assert.ok(closed.body.pullRequest.closedAt);
    assert.equal(closed.body.pullRequest.permissions.canClose, false);
    assert.equal(closed.body.pullRequest.permissions.canReopen, true);

    const reopened = await app.request(`${ACME}/3/reopen`, { method: "POST", cookie });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.pullRequest.status, "open");

    const stored = await storedPullRequest(ACME_ID, 3);
    assert.equal(stored.status, "open");
    assert.deepEqual(
      stored.timeline.map((event) => event.text).slice(-2),
      ["closed this pull request", "reopened this pull request"],
    );
    assert.equal(stored.timeline.at(-1).actor, "alice-dev");
    assert.equal(await branchHead("acme-docs", "main"), headBefore);
    // The discussion, the reviews and the diff stay readable.
    const detail = await app.request(`${ACME}/3`);
    assert.equal(detail.body.pullRequest.status, "open");
    assert.ok(detail.body.pullRequest.files.length > 0);

    // A pull request that is not closed cannot be reopened again.
    const refused = await app.request(`${ACME}/3/reopen`, { method: "POST", cookie });
    assert.equal(refused.status, 400);
  });

  it("refuses a viewer who is neither the author nor a maintainer", async () => {
    const cookie = await signInAs("dana-observer");
    const detail = await app.request(`${ACME}/1`, { cookie });
    assert.equal(detail.body.pullRequest.permissions.canClose, false);
    assert.equal(detail.body.pullRequest.permissions.canReopen, false);

    const headBefore = await branchHead("acme-docs", "main");
    const refused = await app.request(`${ACME}/1/close`, { method: "POST", cookie });
    assert.equal(refused.status, 403);
    assert.equal((await storedPullRequest(ACME_ID, 1)).status, "open");
    assert.equal(await branchHead("acme-docs", "main"), headBefore);

    const anonymous = await app.request(`${ACME}/1/close`, { method: "POST" });
    assert.equal(anonymous.status, 401);
    assert.equal((await storedPullRequest(ACME_ID, 1)).status, "open");
  });

  it("keeps a merged pull request terminal", async () => {
    const cookie = await signInAs("carol-maintainer");
    // The eligible proposal is merged here when an earlier scenario did not
    // already do it, so this check never depends on the execution order.
    if ((await storedPullRequest(LAB_ID, 1)).status !== "merged") {
      const merged = await app.request(`${LAB}/1/merge`, { method: "POST", cookie });
      assert.equal(merged.status, 200);
    }

    const headBefore = await branchHead("merge-lab", "main");
    const close = await app.request(`${LAB}/1/close`, { method: "POST", cookie });
    assert.equal(close.status, 400);
    const reopen = await app.request(`${LAB}/1/reopen`, { method: "POST", cookie });
    assert.equal(reopen.status, 400);
    assert.equal((await storedPullRequest(LAB_ID, 1)).status, "merged");
    assert.equal(await branchHead("merge-lab", "main"), headBefore);
    assert.equal((await storedPullRequest(LAB_ID, 1)).closedAt ?? null, null);
  });
});
