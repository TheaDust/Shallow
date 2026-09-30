import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { mergeBaseCommitId, mergeConflicts } from "../src/domain/pull-requests.mjs";

async function startApp(dataDir) {
  const handler = createApp({ dataDir, staticRoot: join(dataDir, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function newDataDir() {
  return mkdtemp(join(tmpdir(), "shallowcode-merge-"));
}

function jsonRequest(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(baseUrl, identifier) {
  const response = await jsonRequest(baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier, password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

const ACME = "/api/repositories/alice-dev/acme-docs";

async function repository(baseUrl, query = "", cookie) {
  const response = await jsonRequest(baseUrl, `${ACME}${query}`, { cookie });
  assert.equal(response.status, 200);
  return (await response.json()).repository;
}

async function pull(baseUrl, number, cookie) {
  const response = await jsonRequest(baseUrl, `${ACME}/pulls/${number}`, { cookie });
  assert.equal(response.status, 200);
  return (await response.json()).pullRequest;
}

test("the seeded eligible pull request carries a satisfied merge and merges atomically", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");

  // The eligible merge seed: protected `main`, one non-author approval of the
  // current compare commit, a successful `test` check and no conflict.
  const before = await pull(app.baseUrl, 2, alice);
  assert.equal(before.status, "open");
  assert.equal(before.merge, null);
  const mergeability = before.mergeability;
  assert.equal(mergeability.mergeable, true);
  assert.equal(mergeability.protectedBranch, true);
  assert.equal(mergeability.requireApproval, true);
  assert.equal(mergeability.requireStatusCheck, true);
  assert.deepEqual(mergeability.reasons, []);
  assert.deepEqual(mergeability.conflicts, []);
  assert.ok(
    mergeability.conditions.every((condition) => condition.satisfied),
    "every merge condition of the eligible seed is satisfied",
  );
  assert.deepEqual(
    mergeability.conditions.map((condition) => condition.id),
    ["open", "approval", "check", "review", "conflicts"],
  );

  const mainBefore = await repository(app.baseUrl, "?branch=main");
  const baseHead = mainBefore.branches.find((branch) => branch.name === "main").headCommitId;
  const compareHead = before.currentCompareCommitId;

  // `Create a merge commit` is the only method this product supports.
  const unknownMethod = await jsonRequest(app.baseUrl, `${ACME}/pulls/2/merge`, {
    method: "POST",
    cookie: alice,
    body: { method: "rebase" },
  });
  assert.equal(unknownMethod.status, 400);
  assert.equal((await unknownMethod.json()).fields.method, "Unknown merge method");
  assert.equal((await pull(app.baseUrl, 2, alice)).status, "open");

  const merged = await jsonRequest(app.baseUrl, `${ACME}/pulls/2/merge`, {
    method: "POST",
    cookie: alice,
    body: { method: "merge" },
  });
  assert.equal(merged.status, 200);
  const mergedPull = (await merged.json()).pullRequest;
  assert.equal(mergedPull.status, "merged");
  assert.equal(mergedPull.mergeability.mergeable, false);
  assert.equal(mergedPull.merge.by, "alice-dev");
  assert.ok(mergedPull.merge.at);
  assert.equal(mergedPull.merge.method, "Create a merge commit");
  assert.ok(mergedPull.merge.commitId);

  // The base branch head is the merge result, its parents are the head at merge
  // time and the current compare commit, and the compare content is integrated.
  const mainAfter = await repository(app.baseUrl, "?branch=main");
  assert.equal(
    mainAfter.branches.find((branch) => branch.name === "main").headCommitId,
    mergedPull.merge.commitId,
  );
  const mergeCommit = (await (
    await jsonRequest(app.baseUrl, `${ACME}/commits/${mergedPull.merge.commitId}`)
  ).json()).commit;
  assert.equal(mergeCommit.parentId, baseHead);
  assert.equal(mergeCommit.secondParentId, compareHead);
  assert.ok(
    mergeCommit.changedFiles.some((file) => file.path === "main-only.md"),
    "the merge commit brings the compare content into the base branch",
  );
  const mainOnly = await jsonRequest(app.baseUrl, `${ACME}/file?branch=main&path=main-only.md`);
  assert.equal(mainOnly.status, 200);

  // Merged is terminal, and the result survives a reload and a restart.
  const terminal = await jsonRequest(app.baseUrl, `${ACME}/pulls/2/status`, {
    method: "POST",
    cookie: alice,
    body: { status: "closed" },
  });
  assert.equal(terminal.status, 400);
  const again = await jsonRequest(app.baseUrl, `${ACME}/pulls/2/merge`, {
    method: "POST",
    cookie: alice,
    body: { method: "merge" },
  });
  assert.equal(again.status, 400);

  const reloaded = await pull(app.baseUrl, 2, alice);
  assert.equal(reloaded.status, "merged");
  assert.equal(reloaded.merge.commitId, mergedPull.merge.commitId);

  await app.close();
  const second = await startApp(dataDir);
  t.after(() => second.close());
  const restarted = await pull(second.baseUrl, 2);
  assert.equal(restarted.status, "merged");
  assert.equal(restarted.merge.by, "alice-dev");
  assert.equal(restarted.merge.commitId, mergedPull.merge.commitId);
  const restartedMain = await repository(second.baseUrl, "?branch=main");
  assert.equal(
    restartedMain.branches.find((branch) => branch.name === "main").headCommitId,
    mergedPull.merge.commitId,
  );
  const stored = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  const storedPull = stored.pullRequests.find((record) => record.number === 2);
  assert.equal(storedPull.status, "merged");
  assert.equal(storedPull.mergedById, "account-alice-dev");
  assert.equal(storedPull.mergeCommitId, mergedPull.merge.commitId);
});

test("a blocked merge names the missing approval and changes nothing", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const bob = await signIn(app.baseUrl, "bob-reviewer");

  // The refusal seed: the same protected `main`, but no valid non-author
  // approval for the current compare commit.
  const blocked = await pull(app.baseUrl, 4, alice);
  assert.equal(blocked.status, "open");
  assert.equal(blocked.mergeability.mergeable, false);
  assert.ok(blocked.mergeability.reasons.includes("Review required by branch protection"));
  assert.deepEqual(
    blocked.mergeability.conditions.map((condition) => [condition.id, condition.satisfied]),
    [
      ["open", true],
      ["approval", false],
      ["check", false],
      ["review", true],
      ["conflicts", true],
    ],
  );

  const mainBefore = await repository(app.baseUrl, "?branch=main");
  const baseHead = mainBefore.branches.find((branch) => branch.name === "main").headCommitId;

  const refused = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/merge`, {
    method: "POST",
    cookie: alice,
    body: { method: "merge" },
  });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).fields.status, "Review required by branch protection");

  // A writer without the merge permission is refused as well.
  const byWriter = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/merge`, {
    method: "POST",
    cookie: bob,
    body: { method: "merge" },
  });
  assert.equal(byWriter.status, 403);

  // Neither the base branch nor the pull request changed.
  const mainAfter = await repository(app.baseUrl, "?branch=main");
  assert.equal(
    mainAfter.branches.find((branch) => branch.name === "main").headCommitId,
    baseHead,
  );
  assert.equal((await pull(app.baseUrl, 4, alice)).status, "open");
  const mainOnly = await jsonRequest(app.baseUrl, `${ACME}/file?branch=main&path=main-only.md`);
  assert.equal(mainOnly.status, 404);

  // A draft proposal offers no merge at all, and an anonymous request is refused.
  const draft = await jsonRequest(app.baseUrl, `${ACME}/pulls/3/merge`, {
    method: "POST",
    cookie: alice,
    body: { method: "merge" },
  });
  assert.equal(draft.status, 403);
  const anonymous = await jsonRequest(app.baseUrl, `${ACME}/pulls/4/merge`, {
    method: "POST",
    body: { method: "merge" },
  });
  assert.equal(anonymous.status, 401);
});

test("an unprotected target merges without the protection requirements", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");

  // `release` carries no rule, so its head may receive the merge without an
  // approval or a successful check.
  const created = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "main", title: "Merge the search work" },
  });
  assert.equal(created.status, 201);
  const number = (await created.json()).pullRequest.number;
  const detail = await pull(app.baseUrl, number, alice);
  assert.equal(detail.mergeability.protectedBranch, false);
  assert.equal(detail.mergeability.mergeable, true);
  assert.deepEqual(
    detail.mergeability.conditions.map((condition) => condition.id),
    ["open", "review", "conflicts"],
  );

  const merged = await jsonRequest(app.baseUrl, `${ACME}/pulls/${number}/merge`, {
    method: "POST",
    cookie: alice,
    body: {},
  });
  assert.equal(merged.status, 200);
  assert.equal((await merged.json()).pullRequest.status, "merged");
  const release = await repository(app.baseUrl, "?branch=release");
  assert.equal(
    release.branches.find((branch) => branch.name === "release").headCommitId,
    (await pull(app.baseUrl, number, alice)).merge.commitId,
  );
  const loader = await jsonRequest(app.baseUrl, `${ACME}/file?branch=release&path=src/loader.ts`);
  assert.equal(loader.status, 200, "the merge brought the compare content into release");
});

test("a branch that moved on the same file blocks the merge as a conflict", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");

  const created = await jsonRequest(app.baseUrl, `${ACME}/pulls`, {
    method: "POST",
    cookie: alice,
    body: { base: "release", compare: "main", title: "Merge the search work" },
  });
  assert.equal(created.status, 201);
  const number = (await created.json()).pullRequest.number;

  // The base branch changes the very file the compare branch changed as well.
  const written = await jsonRequest(app.baseUrl, `${ACME}/file`, {
    method: "POST",
    cookie: alice,
    body: {
      branch: "release",
      path: "src/search.ts",
      previousPath: "src/search.ts",
      content: "// a different search implementation\nexport const search = 1;\n",
      message: "Rewrite the search helper",
    },
  });
  assert.equal(written.status, 201);
  const releaseHead = (await written.json()).commit.id;

  const conflict = await jsonRequest(app.baseUrl, `${ACME}/pulls/${number}`);
  const conflictPayload = (await conflict.json()).pullRequest;
  assert.equal(conflictPayload.mergeability.mergeable, false);
  assert.deepEqual(conflictPayload.mergeability.conflicts, ["src/search.ts"]);
  assert.ok(
    conflictPayload.mergeability.reasons.some((reason) => reason.includes("conflicts")),
    "the conflict explains the blocked merge",
  );
  assert.deepEqual(
    conflictPayload.mergeability.conditions.map((condition) => [condition.id, condition.satisfied]),
    [
      ["open", true],
      ["review", true],
      ["conflicts", false],
    ],
  );

  const refused = await jsonRequest(app.baseUrl, `${ACME}/pulls/${number}/merge`, {
    method: "POST",
    cookie: alice,
    body: { method: "merge" },
  });
  assert.equal(refused.status, 400);
  const release = await repository(app.baseUrl, "?branch=release");
  assert.equal(
    release.branches.find((branch) => branch.name === "release").headCommitId,
    releaseHead,
    "the refused merge left the base branch head unchanged",
  );
  assert.equal((await pull(app.baseUrl, number, alice)).status, "open");
});

test("the merge rules read the shared commit graph instead of cached results", () => {
  const repository = {
    id: "repo",
    branches: [
      { name: "main", headCommitId: "c2" },
      { name: "topic", headCommitId: "t2" },
    ],
    commits: [
      { id: "c1", branch: "main", message: "root", changes: [{ path: "README.md", changeType: "added", content: "root\n" }] },
      { id: "c2", branch: "main", message: "second", parentId: "c1", changes: [{ path: "README.md", changeType: "modified", content: "main\n" }] },
      { id: "t1", branch: "topic", message: "topic", parentId: "c1", changes: [{ path: "README.md", changeType: "modified", content: "topic\n" }] },
      { id: "t2", branch: "topic", message: "topic again", parentId: "t1", changes: [{ path: "notes.md", changeType: "added", content: "note\n" }] },
    ],
  };
  const pullRequest = { baseBranch: "main", compareBranch: "topic" };

  assert.equal(mergeBaseCommitId(repository, "c2", "t2"), "c1");
  // Both branches changed README.md since the shared commit with different
  // content, so the comparison conflicts; the newly added file does not.
  assert.deepEqual(mergeConflicts(repository, pullRequest), ["README.md"]);

  // The same file changed on both sides with the same content is not a conflict.
  repository.commits.find((commit) => commit.id === "t2").changes.push({
    path: "README.md",
    changeType: "modified",
    content: "main\n",
  });
  assert.deepEqual(mergeConflicts(repository, pullRequest), []);

  // A compare branch that already contains the base head conflicts with nothing.
  repository.branches.find((branch) => branch.name === "topic").headCommitId = "c2";
  assert.deepEqual(mergeConflicts(repository, pullRequest), []);
});
