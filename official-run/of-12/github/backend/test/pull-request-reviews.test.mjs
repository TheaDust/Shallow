import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore, createSeedData } from "../src/domain/store.mjs";

/**
 * REQ-6-3-1 to REQ-6-3-4: the pull-request review workspace.
 *
 * The detail page reads one persisted pull request with its description,
 * discussion, commits and aggregate diff; an inline comment is anchored to a
 * file path, a changed line and the current compare commit and is either
 * published immediately or kept as a pending draft; a review decision stores the
 * reviewer, the current compare commit, the decision and the summary. Every
 * refusal — no session, no review permission, the author's own proposal, a pull
 * request that is not open, an empty body, an unknown line or an unknown
 * decision — stores nothing.
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

async function storedPullRequest(number) {
  return (await storedDocument()).pullRequests.find((pullRequest) => pullRequest.number === number);
}

const PULLS = "/api/repositories/alice-dev/acme-docs/pulls";
const signInAs = (username) => app.signIn(username, "Valid-password-123!");

/** The changed line the seeded diff offers first: the added `docs/onboarding.md`. */
const FIRST_CHANGED_LINE = { filePath: "docs/onboarding.md", line: 1, side: "added" };

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-code-pull-reviews-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

describe("REQ-6-3-1 read the pull request overview, commits and changed files", () => {
  it("reads the seeded public pull request without a session", async () => {
    const detail = await app.request(`${PULLS}/1`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.viewerRole, null);
    assert.equal(detail.body.pullRequest.number, 1);
    assert.equal(detail.body.pullRequest.title, "Improve onboarding");
    assert.equal(detail.body.pullRequest.status, "open");
    assert.equal(detail.body.pullRequest.baseBranch, "main");
    assert.equal(detail.body.pullRequest.compareBranch, "onboarding-docs");
    assert.match(detail.body.pullRequest.description, /onboarding/);
    // The seeded discussion the detail page displays in Conversation.
    assert.equal(detail.body.pullRequest.comments.length, 1);
    assert.equal(detail.body.pullRequest.comments[0].author, "bob-reviewer");
    assert.match(detail.body.pullRequest.comments[0].body, /screenshot/);
    // At least one comparable commit relative to the base revision.
    assert.ok(detail.body.pullRequest.commits.length >= 1);
    assert.ok(detail.body.pullRequest.commits.every((commit) => commit.id !== "9c3e5b1-acme-docs-document-search-flow"));
  });

  it("reads the same pull request again without writing anything", async () => {
    const before = JSON.stringify((await storedDocument()).pullRequests);
    const first = await app.request(`${PULLS}/1?tab=conversation`);
    const second = await app.request(`${PULLS}/1?tab=commits`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(JSON.stringify((await storedDocument()).pullRequests), before);
  });
});

describe("REQ-6-3-2 inspect the changed files and the aggregate diff", () => {
  it("spells the known changed path and the aggregate counts of the public pull request", async () => {
    const detail = await app.request(`${PULLS}/1`);
    const files = detail.body.pullRequest.files;
    assert.deepEqual(detail.body.pullRequest.summary, { filesChanged: 2, additions: 3, deletions: 1 });
    assert.deepEqual(files.map((file) => file.path), ["docs/onboarding.md", "src/search.ts"]);
    assert.equal(files[0].change, "added");
    assert.equal(files[1].change, "modified");
    // The unchanged files of the same repository never appear in the diff.
    assert.equal(files.some((file) => file.path === "README.md"), false);
    // Every file carries per-line differences with their line numbers.
    assert.ok(files.every((file) => file.lines.every((line) => typeof line.lineNumber === "number")));
    assert.equal(files[1].lines.find((line) => line.side === "removed").lineNumber, 5);
  });

  it("spells the same two changed files for the seeded comparison pull request", async () => {
    // `Fix search` targets `main` from `feature-search`: the branch adds
    // `main-only.md` and modifies `src/search.ts`, so its Files changed view
    // spells the same aggregate as the first pull request (REQ-6-3-2).
    const detail = await app.request(`${PULLS}/2`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.pullRequest.summary, { filesChanged: 2, additions: 3, deletions: 1 });
    assert.deepEqual(
      detail.body.pullRequest.files.map((file) => ({ path: file.path, change: file.change })),
      [
        { path: "main-only.md", change: "added" },
        { path: "src/search.ts", change: "modified" },
      ],
    );
  });

  it("keeps the diff of the same compare commit on every read", async () => {
    const before = await app.request(`${PULLS}/1`);
    const after = await app.request(`${PULLS}/1`);
    assert.deepEqual(after.body.pullRequest.files, before.body.pullRequest.files);
    assert.deepEqual(after.body.pullRequest.summary, before.body.pullRequest.summary);
  });
});

describe("REQ-6-3-3 add review comments to changed code lines", () => {
  it("refuses a visitor, a foreign account and the author without storing a record", async () => {
    const before = await storedPullRequest(1);
    const anonymous = await app.request(`${PULLS}/1/comments`, {
      method: "POST",
      body: { ...FIRST_CHANGED_LINE, body: "Please document this line." },
    });
    assert.equal(anonymous.status, 401);

    const stranger = await app.request(`${PULLS}/1/comments`, {
      method: "POST",
      cookie: await signInAs("dana-observer"),
      body: { ...FIRST_CHANGED_LINE, body: "Please document this line." },
    });
    assert.equal(stranger.status, 403);

    const author = await app.request(`${PULLS}/1/comments`, {
      method: "POST",
      cookie: await signInAs("alice-dev"),
      body: { ...FIRST_CHANGED_LINE, body: "Please document this line." },
    });
    assert.equal(author.status, 403);

    assert.deepEqual((await storedPullRequest(1)).reviewComments, []);
    assert.deepEqual(await storedPullRequest(1), before);
  });

  it("publishes a single comment on the addressed line and keeps it after a reload", async () => {
    const cookie = await signInAs("bob-reviewer");
    const created = await app.request(`${PULLS}/1/comments`, {
      method: "POST",
      cookie,
      body: { ...FIRST_CHANGED_LINE, body: "Please link the first run here." },
    });
    assert.equal(created.status, 201);
    const comment = created.body.pullRequest.reviewComments.at(-1);
    assert.equal(comment.filePath, "docs/onboarding.md");
    assert.equal(comment.line, 1);
    assert.equal(comment.side, "added");
    assert.equal(comment.author, "bob-reviewer");
    assert.equal(comment.body, "Please link the first run here.");
    assert.equal(comment.pending, false);
    assert.equal(comment.outdated, false);
    assert.equal(comment.commitId, created.body.pullRequest.currentCompareCommitId);

    const stored = (await storedPullRequest(1)).reviewComments.at(-1);
    assert.equal(stored.commitId, "c5d8f41-acme-docs-onboarding-notes");
    assert.equal(stored.pending, false);

    // Every reader of the public pull request reads the published comment.
    const anonymous = await app.request(`${PULLS}/1`);
    assert.equal(anonymous.body.pullRequest.reviewComments.at(-1).body, "Please link the first run here.");

    const reopened = await startApp(dataDir);
    try {
      const again = await reopened.request(`${PULLS}/1`);
      assert.equal(again.body.pullRequest.reviewComments.at(-1).body, "Please link the first run here.");
      assert.equal(again.body.pullRequest.reviewComments.at(-1).line, 1);
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("keeps a comment of `Start a review` pending until the review is submitted", async () => {
    const cookie = await signInAs("bob-reviewer");
    const created = await app.request(`${PULLS}/5/comments`, {
      method: "POST",
      cookie,
      body: { filePath: "docs/draft-notes.md", line: 1, side: "added", body: "Keep this draft private.", pending: true },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.pullRequest.reviewComments.at(-1).pending, true);

    // Only its author reads the pending draft.
    const anonymous = await app.request(`${PULLS}/5`);
    assert.deepEqual(anonymous.body.pullRequest.reviewComments, []);
    const author = await app.request(`${PULLS}/5`, { cookie: await signInAs("alice-dev") });
    assert.deepEqual(author.body.pullRequest.reviewComments, []);
    const reviewer = await app.request(`${PULLS}/5`, { cookie });
    assert.equal(reviewer.body.pullRequest.reviewComments.at(-1).body, "Keep this draft private.");
    assert.equal(reviewer.body.pullRequest.reviewComments.at(-1).pending, true);

    // Submitting the review publishes the draft of that reviewer.
    const submitted = await app.request(`${PULLS}/5/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "comment", summary: "Some notes." },
    });
    assert.equal(submitted.status, 201);
    const published = submitted.body.pullRequest.reviewComments.at(-1);
    assert.equal(published.pending, false);
    assert.equal(published.body, "Keep this draft private.");
    const readAgain = await app.request(`${PULLS}/5`);
    assert.equal(readAgain.body.pullRequest.reviewComments.at(-1).pending, false);
  });

  it("refuses an empty body, an unknown file and an unknown line", async () => {
    const cookie = await signInAs("carol-maintainer");
    const before = await storedPullRequest(4);

    const empty = await app.request(`${PULLS}/4/comments`, {
      method: "POST",
      cookie,
      body: { ...FIRST_CHANGED_LINE, body: "   " },
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.fields.body, "Comment is required");

    const unknownFile = await app.request(`${PULLS}/4/comments`, {
      method: "POST",
      cookie,
      body: { filePath: "README.md", line: 1, side: "added", body: "Not a changed line." },
    });
    assert.equal(unknownFile.status, 400);
    assert.equal(unknownFile.body.fields.filePath, "The file is not part of this pull request");

    const unknownLine = await app.request(`${PULLS}/4/comments`, {
      method: "POST",
      cookie,
      body: { filePath: "docs/onboarding.md", line: 42, side: "added", body: "Nowhere." },
    });
    assert.equal(unknownLine.status, 400);
    assert.equal(unknownLine.body.fields.line, "The line is not part of this pull request");

    assert.deepEqual(await storedPullRequest(4), before);
  });

  it("refuses to comment on a draft pull request", async () => {
    const cookie = await signInAs("bob-reviewer");
    const response = await app.request(`${PULLS}/3/comments`, {
      method: "POST",
      cookie,
      body: { filePath: "docs/draft-notes.md", line: 1, side: "added", body: "Not yet." },
    });
    assert.equal(response.status, 400);
    assert.deepEqual((await storedPullRequest(3)).reviewComments, []);
  });
});

describe("REQ-6-3-4 submit a pull request review", () => {
  it("accepts an Approve without a summary and reports it to the merge state", async () => {
    const cookie = await signInAs("bob-reviewer");
    const submitted = await app.request(`${PULLS}/4/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "approve" },
    });
    assert.equal(submitted.status, 201);
    const review = submitted.body.pullRequest.reviews.at(-1);
    assert.equal(review.reviewer, "bob-reviewer");
    assert.equal(review.decision, "approve");
    assert.equal(review.summary, "");
    assert.equal(review.stale, false);
    assert.equal(review.commitId, "c5d8f41-acme-docs-onboarding-notes");
    assert.match(review.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(submitted.body.pullRequest.reviewStatus, "approved");
    // The decision is readable for the branch-protection merge eligibility.
    assert.equal(submitted.body.pullRequest.merge.approvals, 1);

    const reopened = await startApp(dataDir);
    try {
      const again = await reopened.request(`${PULLS}/4`);
      assert.equal(again.body.pullRequest.reviews.at(-1).decision, "approve");
      assert.equal(again.body.pullRequest.reviewStatus, "approved");
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("stores the summary of a Request changes and keeps the history of the reviewer", async () => {
    const cookie = await signInAs("carol-maintainer");
    const requested = await app.request(`${PULLS}/5/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "request_changes", summary: "Please cover the empty search case." },
    });
    assert.equal(requested.status, 201);
    const review = requested.body.pullRequest.reviews.at(-1);
    assert.equal(review.decision, "request_changes");
    assert.equal(review.summary, "Please cover the empty search case.");
    assert.equal(requested.body.pullRequest.reviewStatus, "changes_requested");
    assert.equal(requested.body.pullRequest.merge.changeRequests, 1);

    // The new decision of the same reviewer replaces the effective one while the
    // earlier record stays in the history.
    const replaced = await app.request(`${PULLS}/5/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "comment", summary: "The case is covered now." },
    });
    assert.equal(replaced.status, 201);
    const reviews = replaced.body.pullRequest.reviews;
    assert.equal(reviews.length, 3);
    assert.deepEqual(reviews.map((entry) => entry.decision), ["comment", "request_changes", "comment"]);
    assert.equal(replaced.body.pullRequest.reviewStatus, "review_required");
    assert.equal(replaced.body.pullRequest.merge.changeRequests, 0);
    assert.equal(reviews[1].summary, "Please cover the empty search case.");

    const stored = await storedPullRequest(5);
    assert.deepEqual(stored.reviews.map((entry) => entry.decision), ["comment", "request_changes", "comment"]);
  });

  it("refuses a visitor, the author, a foreign account and a draft pull request", async () => {
    const before = JSON.stringify((await storedDocument()).pullRequests);
    const anonymous = await app.request(`${PULLS}/1/reviews`, {
      method: "POST",
      body: { decision: "approve" },
    });
    assert.equal(anonymous.status, 401);

    const author = await app.request(`${PULLS}/1/reviews`, {
      method: "POST",
      cookie: await signInAs("alice-dev"),
      body: { decision: "approve" },
    });
    assert.equal(author.status, 403);

    const stranger = await app.request(`${PULLS}/1/reviews`, {
      method: "POST",
      cookie: await signInAs("dana-observer"),
      body: { decision: "approve" },
    });
    assert.equal(stranger.status, 403);

    const draft = await app.request(`${PULLS}/3/reviews`, {
      method: "POST",
      cookie: await signInAs("bob-reviewer"),
      body: { decision: "approve" },
    });
    assert.equal(draft.status, 400);

    const unknown = await app.request(`${PULLS}/1/reviews`, {
      method: "POST",
      cookie: await signInAs("bob-reviewer"),
      body: { decision: "maybe" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fields.decision, "Unknown review decision");

    assert.equal(JSON.stringify((await storedDocument()).pullRequests), before);
  });

  it("marks the decision of an older compare commit as stale after a new commit", async () => {
    const cookie = await signInAs("carol-maintainer");
    const submitted = await app.request(`${PULLS}/1/reviews`, {
      method: "POST",
      cookie,
      body: { decision: "approve", summary: "Looks good." },
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.pullRequest.reviewStatus, "approved");

    // A new commit on the compare branch moves the current compare commit; the
    // stored decision stays readable and becomes stale.
    await fetch(`${app.baseUrl}/api/repositories/alice-dev/acme-docs/contents`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: await signInAs("alice-dev") },
      body: JSON.stringify({
        branch: "onboarding-docs",
        path: "docs/onboarding.md",
        content: "# Onboarding\n\nA short path from cloning the repository to the first contribution.\n\nAsk in Discussions when you are stuck.\n",
        message: "Extend the onboarding notes",
      }),
    });
    const after = await app.request(`${PULLS}/1`);
    assert.equal(after.body.pullRequest.currentCompareCommitId !== "c5d8f41-acme-docs-onboarding-notes", true);
    const review = after.body.pullRequest.reviews.find((entry) => entry.reviewer === "carol-maintainer");
    assert.equal(review.stale, true);
    assert.equal(review.decision, "approve");
    assert.equal(after.body.pullRequest.reviewStatus, "review_required");
    // The published comment stays anchored to its own commit and is outdated.
    const comment = after.body.pullRequest.reviewComments.find((entry) => entry.author === "bob-reviewer");
    assert.equal(comment.outdated, true);
    assert.equal(comment.commitId, "c5d8f41-acme-docs-onboarding-notes");
  });
});
