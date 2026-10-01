// REQ-6-2-1 / REQ-6-2-2 / REQ-6-2-3 / REQ-6-2-4: listing and filtering the
// pull requests of one repository, comparing two branches before creation,
// creating a normal or a draft pull request from a valid comparison and the
// ready-for-review transition of a draft.
//
// The stored records always come from the trusted state: a comparison never
// writes anything, a creation stores the two branch names with the commits they
// pointed at in one atomic update, and a refused request leaves no partial
// record behind.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };
const BOB = { username: "bob-reviewer", password: "Valid-password-123!" };
const REPOSITORY = "/api/repositories/acme-demo/acme-docs";
const PULLS = `${REPOSITORY}/pulls`;

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, { username, password }) {
  const response = await call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier: username, password },
  });
  assert.equal(response.status, 200);
  return response.setCookie?.split(";")[0] ?? null;
}

/** `null` while no write has happened yet, else the stored state text. */
async function stateSnapshot(app) {
  try {
    return await readFile(join(app.dataDir, "state.json"), "utf8");
  } catch {
    return null;
  }
}

async function createPull(app, cookie, body) {
  return call(app.baseUrl, PULLS, { method: "POST", cookie, body });
}

test("a visitor lists the stored pull requests of the public repository", async () => {
  await withApp(async (app) => {
    const list = await call(app.baseUrl, PULLS);
    assert.equal(list.status, 200);
    assert.equal(list.body.repository.owner, "acme-demo");
    assert.equal(list.body.repository.visibility, "public");
    assert.equal(list.body.canCreate, false);
    assert.deepEqual(list.body.counts, { draft: 1, open: 5, closed: 1, merged: 0, all: 7 });

    const rows = list.body.pullRequests;
    assert.deepEqual(
      rows.map((row) => `${row.number}:${row.title}:${row.status}:${row.author}`),
      [
        "7:Refresh the docs layout:open:alice-dev",
        "6:Ship the search fixes:open:alice-dev",
        "5:Refine search ranking:open:alice-dev",
        "4:Update search filters:open:alice-dev",
        "3:Draft onboarding update:draft:alice-dev",
        "2:Fix search:closed:alice-dev",
        "1:Improve onboarding:open:alice-dev",
      ],
    );
    const open = rows.find((row) => row.number === 1);
    assert.equal(open.sourceBranch, "release");
    assert.equal(open.targetBranch, "main");
    assert.equal(open.reviewStatus, "review_required");
    // No seeded record starts with a reviewer request; the reviewer-request
    // requirement stores that relationship itself.
    assert.deepEqual(open.reviewers, []);
    const closed = rows.find((row) => row.number === 2);
    assert.equal(closed.sourceBranch, "feature-search");
    assert.equal(closed.targetBranch, "main");
  });
});

test("the branch comparison is read-only and reserved for Write or higher", async () => {
  await withApp(async (app) => {
    const visitor = await call(app.baseUrl, `${PULLS}/compare?base=main&compare=feature-search`);
    assert.equal(visitor.status, 401);

    const memberCookie = await signIn(app, BOB);
    const cookie = await signIn(app, ALICE);
    // `bob-reviewer` holds the seeded Write grant of the pull-request
    // requirements; a Read grant of the same repository is still not Write, so
    // the comparison stays closed to him after this replacement.
    const granted = await call(app.baseUrl, `${REPOSITORY}/access`, {
      method: "PUT",
      cookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "read" },
    });
    assert.equal(granted.status, 200);
    // From here on every call is a read.
    const before = await stateSnapshot(app);

    const member = await call(app.baseUrl, `${PULLS}/compare?base=main&compare=feature-search`, {
      cookie: memberCookie,
    });
    assert.equal(member.status, 403);
    assert.equal(member.body.error, "Access denied");

    const comparison = await call(
      app.baseUrl,
      `${PULLS}/compare?base=main&compare=feature-search`,
      { cookie },
    );
    assert.equal(comparison.status, 200);
    assert.deepEqual(comparison.body.branches, [
      "docs-polish",
      "draft-feature",
      "feature-search",
      "main",
      "release",
      "search-filters",
      "search-fixes",
      "search-ranking",
    ]);
    assert.equal(comparison.body.base.name, "main");
    assert.equal(comparison.body.compare.name, "feature-search");
    assert.equal(comparison.body.sameBranch, false);
    assert.equal(comparison.body.noChanges, false);
    assert.equal(comparison.body.canCreate, true);
    assert.equal(comparison.body.commitCount, 1);
    assert.deepEqual(comparison.body.commits.map((commit) => commit.message), [
      "Draft search prototype",
    ]);
    // The known changed file is part of the comparison; the file is removed by
    // the compare branch, so the diff really reports it.
    assert.ok(comparison.body.files.some((file) => file.path === "src/search.ts"));

    // The same branch in both selects has nothing to merge.
    const same = await call(app.baseUrl, `${PULLS}/compare?base=main&compare=main`, { cookie });
    assert.equal(same.status, 200);
    assert.equal(same.body.sameBranch, true);
    assert.equal(same.body.noChanges, true);
    assert.equal(same.body.canCreate, false);

    // Two branches pointing at the same revision have no difference either.
    const identical = await call(
      app.baseUrl,
      `${PULLS}/compare?base=feature-search&compare=draft-feature`,
      { cookie },
    );
    assert.equal(identical.status, 200);
    assert.equal(identical.body.sameBranch, false);
    assert.equal(identical.body.noChanges, true);
    assert.equal(identical.body.canCreate, false);

    // Reading a comparison never writes state.
    assert.equal(await stateSnapshot(app), before);
  });
});

test("a Write contributor creates an Open pull request and reads it back", async () => {
  await withApp(async (app) => {
    const before = await stateSnapshot(app);
    const cookie = await signIn(app, ALICE);

    const created = await createPull(app, cookie, {
      base: "main",
      compare: "feature-search",
      title: "  Add the search docs  ",
      description: "Document the search flow.",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.pullRequest.number, 8);
    assert.equal(created.body.pullRequest.title, "Add the search docs");
    assert.equal(created.body.pullRequest.status, "open");
    assert.equal(created.body.pullRequest.author, "alice-dev");
    assert.equal(created.body.pullRequest.sourceBranch, "feature-search");
    assert.equal(created.body.pullRequest.targetBranch, "main");
    assert.equal(created.body.pullRequest.baseCommit.sha, "d4e5f6a");
    assert.equal(created.body.pullRequest.compareCommit.sha, "f7a8b9c");
    assert.ok(created.body.pullRequest.createdAt);
    assert.deepEqual(created.body.events.map((event) => event.type), ["created"]);
    assert.equal(created.body.canMerge, false);

    const detail = await call(app.baseUrl, `${PULLS}/8`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.pullRequest.title, "Add the search docs");
    assert.equal(detail.body.pullRequest.status, "open");
    assert.equal(detail.body.comparison.commitCount, 1);

    const list = await call(app.baseUrl, PULLS);
    assert.equal(list.body.counts.open, 6);
    assert.equal(list.body.pullRequests[0].number, 8);

    // The new record survives a restart of the application.
    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, `${PULLS}/8`);
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.pullRequest.title, "Add the search docs");
    assert.equal(reloaded.body.pullRequest.status, "open");
    assert.notEqual(await stateSnapshot(app), before);
  });
});

test("creating a pull request needs Write or higher and a session", async () => {
  await withApp(async (app) => {
    const visitor = await createPull(app, null, {
      base: "main",
      compare: "feature-search",
      title: "Visitor attempt",
    });
    assert.equal(visitor.status, 401);

    // A direct Read grant is not Write.
    const adminCookie = await signIn(app, ALICE);
    const granted = await call(app.baseUrl, `${REPOSITORY}/access`, {
      method: "PUT",
      cookie: adminCookie,
      body: { subjectType: "account", subjectName: "bob-reviewer", role: "read" },
    });
    assert.equal(granted.status, 200);
    const readOnlyCookie = await signIn(app, BOB);
    const readOnly = await createPull(app, readOnlyCookie, {
      base: "main",
      compare: "feature-search",
      title: "Read attempt",
    });
    assert.equal(readOnly.status, 403);
    assert.equal(readOnly.body.error, "Access denied");

    // The grant only changed the role; no pull request was stored.
    const list = await call(app.baseUrl, PULLS);
    assert.equal(list.body.counts.all, 7);
  });
});

test("an invalid comparison, a blank title or a duplicate pair creates nothing", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);

    const blank = await createPull(app, cookie, {
      base: "main",
      compare: "feature-search",
      title: "   ",
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.fieldErrors.title, "Title is required");

    const overlong = await createPull(app, cookie, {
      base: "main",
      compare: "feature-search",
      title: "x".repeat(257),
    });
    assert.equal(overlong.status, 400);
    assert.ok(overlong.body.fieldErrors.title);

    const longDescription = await createPull(app, cookie, {
      base: "main",
      compare: "feature-search",
      title: "Valid title",
      description: "y".repeat(65537),
    });
    assert.equal(longDescription.status, 400);
    assert.ok(longDescription.body.fieldErrors.description);

    const same = await createPull(app, cookie, {
      base: "main",
      compare: "main",
      title: "Same branch",
    });
    assert.equal(same.status, 400);
    assert.ok(same.body.fieldErrors.compare);

    const withoutDifference = await createPull(app, cookie, {
      base: "feature-search",
      compare: "draft-feature",
      title: "No difference",
    });
    assert.equal(withoutDifference.status, 400);
    assert.ok(withoutDifference.body.fieldErrors.compare);

    const unknownBranch = await createPull(app, cookie, {
      base: "main",
      compare: "not-a-branch",
      title: "Unknown branch",
    });
    assert.equal(unknownBranch.status, 400);
    assert.ok(unknownBranch.body.fieldErrors.compare);

    const beforeSuccess = await stateSnapshot(app);
    const created = await createPull(app, cookie, {
      base: "main",
      compare: "feature-search",
      title: "Add the search docs",
    });
    assert.equal(created.status, 201);

    // A second live pull request of the same pair is refused.
    const duplicate = await createPull(app, cookie, {
      base: "main",
      compare: "feature-search",
      title: "Add the search docs again",
    });
    assert.equal(duplicate.status, 400);
    assert.ok(duplicate.body.fieldErrors.compare);

    // The Closed pull request of the pair is not a live one, so the successful
    // creation above was allowed even though `Fix search` uses the same pair.
    const list = await call(app.baseUrl, PULLS);
    assert.equal(list.body.counts.all, 8);
    assert.equal(list.body.counts.open, 6);
    assert.notEqual(await stateSnapshot(app), beforeSuccess);
  });
});

test("a draft pull request stores the same fields and cannot be merged", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);

    const created = await createPull(app, cookie, {
      base: "main",
      compare: "feature-search",
      title: "Draft the search docs",
      description: "Work in progress.",
      draft: true,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.pullRequest.status, "draft");
    assert.equal(created.body.pullRequest.title, "Draft the search docs");
    assert.equal(created.body.pullRequest.number, 8);
    assert.equal(created.body.canMerge, false);

    const merged = await call(app.baseUrl, `${PULLS}/8/merge`, { method: "POST", cookie });
    assert.equal(merged.status, 400);
    assert.ok(merged.body.fieldErrors.status);

    const list = await call(app.baseUrl, PULLS);
    assert.equal(list.body.pullRequests[0].status, "draft");
    assert.equal(list.body.counts.draft, 2);

    // The author marks it ready for review: the same number turns Open, its
    // branches, commits and title stay untouched and the activity is recorded.
    const ready = await call(app.baseUrl, `${PULLS}/8/ready-for-review`, {
      method: "POST",
      cookie,
    });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.pullRequest.status, "open");
    assert.equal(ready.body.pullRequest.number, 8);
    assert.equal(ready.body.pullRequest.title, "Draft the search docs");
    assert.equal(ready.body.pullRequest.sourceBranch, "feature-search");
    assert.equal(ready.body.pullRequest.compareCommit.sha, "f7a8b9c");
    assert.deepEqual(
      ready.body.events.map((event) => event.type),
      ["created", "ready_for_review"],
    );

    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, `${PULLS}/8`);
    assert.equal(reloaded.body.pullRequest.status, "open");
    assert.equal(reloaded.body.pullRequest.title, "Draft the search docs");
  });
});

test("the seeded draft belongs to its author and only they or a manager mark it ready", async () => {
  await withApp(async (app) => {
    const draft = await call(app.baseUrl, `${PULLS}/3`);
    assert.equal(draft.status, 200);
    assert.equal(draft.body.pullRequest.title, "Draft onboarding update");
    assert.equal(draft.body.pullRequest.status, "draft");
    assert.equal(draft.body.pullRequest.sourceBranch, "draft-feature");
    assert.equal(draft.body.pullRequest.targetBranch, "main");
    assert.equal(draft.body.pullRequest.author, "alice-dev");
    assert.deepEqual(draft.body.reviews, []);
    assert.equal(draft.body.canReadyForReview, false);

    const before = await stateSnapshot(app);
    const visitor = await call(app.baseUrl, `${PULLS}/3/ready-for-review`, { method: "POST" });
    assert.equal(visitor.status, 401);

    const memberCookie = await signIn(app, BOB);
    const withSession = await stateSnapshot(app);
    const member = await call(app.baseUrl, `${PULLS}/3/ready-for-review`, {
      method: "POST",
      cookie: memberCookie,
    });
    assert.equal(member.status, 403);
    assert.equal(await stateSnapshot(app), withSession);
    assert.notEqual(withSession, before);

    const cookie = await signIn(app, ALICE);
    const author = await call(app.baseUrl, `${PULLS}/3/ready-for-review`, {
      method: "POST",
      cookie,
    });
    assert.equal(author.status, 200);
    assert.equal(author.body.pullRequest.status, "open");
    assert.deepEqual(author.body.events.map((event) => event.type), ["created", "ready_for_review"]);

    // The transition happens once; the same call on an Open record is refused.
    const again = await call(app.baseUrl, `${PULLS}/3/ready-for-review`, {
      method: "POST",
      cookie,
    });
    assert.equal(again.status, 400);
  });
});

test("merging needs a manager role, an Open record and every merge condition", async () => {
  await withApp(async (app) => {
    const memberCookie = await signIn(app, BOB);
    const denied = await call(app.baseUrl, `${PULLS}/6/merge`, {
      method: "POST",
      cookie: memberCookie,
    });
    assert.equal(denied.status, 403);

    const cookie = await signIn(app, ALICE);
    const closed = await call(app.baseUrl, `${PULLS}/2/merge`, { method: "POST", cookie });
    assert.equal(closed.status, 400);
    assert.equal(closed.body.pullRequest, undefined);

    // The blocked record of the protected `main`: it carries no valid approval
    // and no successful `test` check, so the merge is refused with the reason
    // of the unmet branch-protection condition.
    const blocked = await call(app.baseUrl, `${PULLS}/1/merge`, { method: "POST", cookie });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.fieldErrors.merge, "Review required by branch protection");
    assert.equal(blocked.body.pullRequest, undefined);
    const blockedDetail = await call(app.baseUrl, `${PULLS}/1`);
    assert.equal(blockedDetail.body.pullRequest.status, "open");
    assert.equal(blockedDetail.body.canMerge, false);

    // The eligible record carries the approval and the successful check of its
    // current compare commit, so its merge goes through.
    const merged = await call(app.baseUrl, `${PULLS}/6/merge`, { method: "POST", cookie });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.pullRequest.status, "merged");
    assert.equal(merged.body.pullRequest.mergedBy, "alice-dev");
    assert.ok(merged.body.pullRequest.mergedAt);
    assert.ok(merged.body.pullRequest.mergeCommitSha);
    assert.deepEqual(
      merged.body.events.map((event) => event.type),
      ["created", "reviewed", "merged"],
    );

    // Merged is terminal: the record cannot be merged a second time.
    const again = await call(app.baseUrl, `${PULLS}/6/merge`, { method: "POST", cookie });
    assert.equal(again.status, 400);

    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, `${PULLS}/6`);
    assert.equal(reloaded.body.pullRequest.status, "merged");
  });
});

test("an unknown repository, an unknown number and an unreadable private repository are refused", async () => {
  await withApp(async (app) => {
    const missingRepository = await call(app.baseUrl, "/api/repositories/acme-demo/not-there/pulls");
    assert.equal(missingRepository.status, 404);

    const missingNumber = await call(app.baseUrl, `${PULLS}/99`);
    assert.equal(missingNumber.status, 404);
    assert.equal(missingNumber.body.error, "Pull request not found");

    const privateList = await call(app.baseUrl, "/api/repositories/acme-demo/secret-research/pulls");
    assert.equal(privateList.status, 403);
  });
});
