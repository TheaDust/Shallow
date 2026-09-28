import assert from "node:assert/strict";
import test from "node:test";

import { seedState } from "../src/domain/accounts.mjs";
import { seedOrganizations } from "../src/domain/organizations.mjs";
import { seedRepositories } from "../src/domain/repos.mjs";
import {
  branchCommitList,
  branchSnapshot,
  canWriteRepository,
  commitDiff,
  compareDiff,
  createBranch,
  createFileCommit,
  diffSnapshots,
  findBranch,
  isValidBranchName,
  normalizeRepositories,
  searchCode,
} from "../src/domain/vcs.mjs";

function freshState() {
  const state = {
    accounts: [],
    sessions: [],
    recovery: [],
    organizations: [],
    organizationMembers: [],
    repositories: [],
    teams: [],
    teamMembers: [],
    repoGrants: [],
  };
  seedState(state);
  seedOrganizations(state);
  seedRepositories(state);
  normalizeRepositories(state);
  return state;
}

function accountId(state, username) {
  return state.accounts.find((candidate) => candidate.username === username).id;
}

function personalRepo(state, name) {
  return state.repositories.find(
    (candidate) => candidate.ownerType === "account" && candidate.name === name,
  );
}

test("seed acme-docs carries the REQ-4 branches, history, and file snapshots", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");

  assert.deepEqual(
    repo.branches.map((branch) => `${branch.name}:${branch.protected ? "protected" : "open"}`),
    [
      "main:open",
      "feature-search:protected",
      "release:open",
      "draft-feature:open",
      "feature-review:open",
      "review-candidate:open",
      "merge-ready:open",
      "merge-blocked:open",
    ],
  );

  const mainCommits = branchCommitList(repo, "main");
  assert.deepEqual(mainCommits.map((commit) => commit.message), [
    "Document search flow",
    "Initial commit",
  ]);
  assert.ok(mainCommits[0].authorName === "alice-dev");
  assert.ok(mainCommits[0].parentId === mainCommits[1].id);
  assert.ok(mainCommits[0].createdAt > mainCommits[1].createdAt);

  // main has a nested directory with a text file; feature-search does not.
  const mainFiles = branchSnapshot(repo, "main").map((file) => file.path);
  assert.ok(mainFiles.includes("docs/overview.md"));
  assert.ok(mainFiles.includes("README.md"));
  const featureFiles = branchSnapshot(repo, "feature-search").map((file) => file.path);
  assert.ok(!featureFiles.includes("docs/overview.md"));
  assert.ok(featureFiles.includes("main-only.md"));
  assert.ok(!mainFiles.includes("main-only.md"));

  // The known query is visible as a complete text value in README.md on main.
  const readme = branchSnapshot(repo, "main").find((file) => file.path === "README.md");
  assert.ok(readme.content.includes("search flow"));
});

test("file-scoped history keeps only commits that modified the path", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");

  const readmeHistory = branchCommitList(repo, "main", "README.md").map((commit) => commit.message);
  assert.deepEqual(readmeHistory, ["Document search flow", "Initial commit"]);

  const srcHistory = branchCommitList(repo, "main", "src/search.ts").map((commit) => commit.message);
  assert.deepEqual(srcHistory, ["Document search flow", "Initial commit"]);

  // docs/overview.md was added by the latest commit only.
  const overviewHistory = branchCommitList(repo, "main", "docs/overview.md").map(
    (commit) => commit.message,
  );
  assert.deepEqual(overviewHistory, ["Document search flow"]);

  // A path that exists on another branch has no history on this branch.
  const mainOnly = branchCommitList(repo, "main", "main-only.md");
  assert.deepEqual(mainOnly, []);
  assert.equal(branchCommitList(repo, "feature-search", "main-only.md").length, 1);
});

test("a Write-permission user creates a commit that moves the branch head atomically", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const repo = personalRepo(state, "acme-docs");
  const before = branchCommitList(repo, "main");
  const beforeHead = before[0];

  const outcome = createFileCommit(state, repo, {
    accountId: alice,
    authorName: "alice-dev",
    branch: "main",
    path: "docs/guide.md",
    content: "# Guide\n\nStep-by-step usage.\n",
    message: "Add docs/guide.md",
  });
  assert.ok(outcome.ok);

  const after = branchCommitList(repo, "main");
  assert.equal(after.length, before.length + 1);
  assert.equal(after[0].message, "Add docs/guide.md");
  assert.equal(after[0].parentId, beforeHead.id);
  assert.equal(after[0].authorName, "alice-dev");

  // The snapshot contains the new file; the branch head points at the commit.
  const files = branchSnapshot(repo, "main");
  const added = files.find((file) => file.path === "docs/guide.md");
  assert.equal(added.content, "# Guide\n\nStep-by-step usage.\n");
  const branch = repo.branches.find((candidate) => candidate.name === "main");
  assert.equal(branch.commitId, outcome.commit.id);

  // Historical content is not rewritten.
  const initial = branchCommitList(repo, "main").find((commit) => commit.message === "Initial commit");
  const initialCommit = repo.commits.find((candidate) => candidate.id === initial.id);
  assert.ok(!initialCommit.files.some((file) => file.path === "docs/guide.md"));
});

test("invalid paths are rejected with Invalid file path and change nothing", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const repo = personalRepo(state, "acme-docs");
  const before = repo.commits.length;
  const beforeHead = repo.branches.find((branch) => branch.name === "main").commitId;

  for (const path of ["", "/leading.md", "../invalid.md", "a/../b.md", "a//b.md", "trailing/"]) {
    const outcome = createFileCommit(state, repo, {
      accountId: alice,
      branch: "main",
      path,
      content: "must not be saved",
      message: "Add file",
    });
    assert.equal(outcome.ok, false, `path ${JSON.stringify(path)} must be rejected`);
    assert.equal(outcome.errors.path, "Invalid file path");
  }

  assert.equal(repo.commits.length, before);
  assert.equal(repo.branches.find((branch) => branch.name === "main").commitId, beforeHead);
});

test("conflicting paths and noncompliant messages are rejected without partial state", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const repo = personalRepo(state, "acme-docs");
  const before = repo.commits.length;
  const beforeHead = repo.branches.find((branch) => branch.name === "main").commitId;

  // Exact file conflict.
  const fileConflict = createFileCommit(state, repo, {
    accountId: alice,
    branch: "main",
    path: "README.md",
    content: "x",
    message: "Add file",
  });
  assert.equal(fileConflict.ok, false);
  assert.equal(fileConflict.errors.path, "File already exists at this path");

  // A directory occupies the path (a file lies below it).
  const dirConflict = createFileCommit(state, repo, {
    accountId: alice,
    branch: "main",
    path: "docs",
    content: "x",
    message: "Add file",
  });
  assert.equal(dirConflict.ok, false);
  assert.equal(dirConflict.errors.path, "File already exists at this path");

  // A parent segment is occupied by an existing file.
  const parentConflict = createFileCommit(state, repo, {
    accountId: alice,
    branch: "main",
    path: "README.md/x.md",
    content: "x",
    message: "Add file",
  });
  assert.equal(parentConflict.ok, false);
  assert.equal(parentConflict.errors.path, "File already exists at this path");

  // Empty commit message.
  const emptyMessage = createFileCommit(state, repo, {
    accountId: alice,
    branch: "main",
    path: "docs/guide.md",
    content: "x",
    message: "   ",
  });
  assert.equal(emptyMessage.ok, false);
  assert.equal(emptyMessage.errors.message, "Commit message is required");

  // Over-long commit message.
  const longMessage = createFileCommit(state, repo, {
    accountId: alice,
    branch: "main",
    path: "docs/guide.md",
    content: "x",
    message: "m".repeat(73),
  });
  assert.equal(longMessage.ok, false);
  assert.equal(longMessage.errors.message, "Commit message must be 1-72 characters");

  // A protected branch rejects the submission with the reason.
  const protectedBranch = createFileCommit(state, repo, {
    accountId: alice,
    branch: "feature-search",
    path: "docs/guide.md",
    content: "x",
    message: "Add file",
  });
  assert.equal(protectedBranch.ok, false);
  assert.equal(protectedBranch.errors.branch, "Branch is protected");

  assert.equal(repo.commits.length, before);
  assert.equal(repo.branches.find((branch) => branch.name === "main").commitId, beforeHead);
  assert.equal(
    repo.branches.find((branch) => branch.name === "feature-search").commitId,
    state.repositories.find((candidate) => candidate.name === "acme-docs" && candidate.ownerType === "account")
      .branches.find((branch) => branch.name === "feature-search").commitId,
  );
});

test("only Write, Maintain, Admin, or organization Owner may create commits", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");
  const repo = personalRepo(state, "acme-docs");

  assert.equal(canWriteRepository(state, alice, repo), true);
  assert.equal(canWriteRepository(state, bob, repo), false);
  assert.equal(canWriteRepository(state, null, repo), false);

  assert.equal(createFileCommit(state, repo, { accountId: null, branch: "main", path: "x.md", content: "x", message: "m" }).ok, false);
  assert.equal(createFileCommit(state, repo, { accountId: bob, branch: "main", path: "x.md", content: "x", message: "m" }).forbidden, true);

  // A read-only collaborator on the private repo still cannot write.
  const secret = personalRepo(state, "secret-research");
  assert.equal(canWriteRepository(state, bob, secret), false);
  assert.equal(canWriteRepository(state, alice, secret), true);
});

test("commit detail shows the parent revision, changed files, and line-level counts", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const head = branchCommitList(repo, "main")[0];

  const detail = commitDiff(state, repo, head.id);
  assert.ok(detail);
  assert.equal(detail.commit.message, "Document search flow");
  assert.equal(detail.base.shortId, branchCommitList(repo, "main")[1].shortId);
  const paths = detail.files.map((file) => file.path);
  assert.ok(paths.includes("src/search.ts"));
  assert.ok(paths.includes("docs/overview.md"));
  assert.ok(paths.includes("README.md"));
  const search = detail.files.find((file) => file.path === "src/search.ts");
  assert.equal(search.status, "modified");
  assert.ok(search.additions > 0);
  assert.ok(search.deletions > 0);
  const overview = detail.files.find((file) => file.path === "docs/overview.md");
  assert.equal(overview.status, "added");
  assert.ok(overview.lines.some((line) => line.type === "add"));

  // The initial commit has no parent but still shows its added files.
  const initial = commitDiff(state, repo, detail.base.id);
  assert.equal(initial.base, null);
  assert.equal(initial.files.length, 3);
});

test("compare diff between two revisions lists only changed files and supports path scope", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const commits = branchCommitList(repo, "main");
  const base = commits[1];
  const compare = commits[0];

  const result = compareDiff(state, repo, base.id, compare.id);
  assert.ok(result);
  assert.equal(result.base.shortId, base.shortId);
  assert.equal(result.compare.shortId, compare.shortId);
  assert.deepEqual(
    result.files.map((file) => file.path),
    ["README.md", "docs/overview.md", "src/search.ts"],
  );
  assert.ok(result.files.every((file) => file.status !== "modified" || file.additions + file.deletions > 0));
  assert.ok(result.files.every((file) => !(file.status === "modified" && file.additions === 0 && file.deletions === 0)));

  // Comparing a revision with itself shows no files.
  const same = compareDiff(state, repo, base.id, base.id);
  assert.deepEqual(same.files, []);

  // Path scope limits the output to that file.
  const scoped = compareDiff(state, repo, base.id, compare.id, "src/search.ts");
  assert.equal(scoped.files.length, 1);
  assert.equal(scoped.files[0].path, "src/search.ts");

  // Unknown revisions yield null.
  assert.equal(compareDiff(state, repo, "commit_nope", compare.id), null);
});

test("line diff groups unchanged context with additions and deletions", () => {
  const base = [{ path: "a.txt", content: "one\ntwo\nthree\n" }];
  const compare = [{ path: "a.txt", content: "one\nTWO\nthree\nfour\n" }];
  const files = diffSnapshots(base, compare);
  assert.equal(files.length, 1);
  assert.equal(files[0].additions, 2);
  assert.equal(files[0].deletions, 1);
  const types = files[0].lines.map((line) => line.type);
  assert.ok(types.includes("add"));
  assert.ok(types.includes("del"));
  assert.ok(types.includes("context"));

  // Identical files are omitted entirely.
  assert.deepEqual(diffSnapshots(base, base), []);
  assert.deepEqual(diffSnapshots([], []), []);
});

test("branch names follow the REQ-4-3 rules", () => {
  assert.equal(isValidBranchName("feature/api-v2"), true);
  assert.equal(isValidBranchName("pw-branch-ab12"), true);
  assert.equal(isValidBranchName("main"), true);
  assert.equal(isValidBranchName("A-B_c.d/e"), true);
  assert.equal(isValidBranchName(""), false);
  assert.equal(isValidBranchName("invalid..branch"), false);
  assert.equal(isValidBranchName("a//b"), false);
  assert.equal(isValidBranchName("trailing/"), false);
  assert.equal(isValidBranchName("trailing."), false);
  assert.equal(isValidBranchName("has space"), false);
  assert.equal(isValidBranchName("a".repeat(256)), false);
  assert.equal(isValidBranchName("a".repeat(255)), true);
  assert.equal(isValidBranchName("../up"), false);
});

test("createBranch stores the base commit and creator without rewriting history", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const repo = personalRepo(state, "acme-docs");
  const mainHead = branchCommitList(repo, "main")[0];
  const commitsBefore = repo.commits.length;
  const filesBefore = branchSnapshot(repo, "main").length;

  const outcome = createBranch(state, repo, {
    accountId: alice,
    name: "feature/api-v2",
    baseBranch: "main",
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.branch.name, "feature/api-v2");
  const created = findBranch(repo, "feature/api-v2");
  assert.equal(created.commitId, mainHead.id);
  assert.equal(created.protected, false);
  assert.equal(created.createdByAccountId, alice);
  assert.ok(created.createdAt);

  // Original history and files are untouched; the new branch reads the base snapshot.
  assert.equal(repo.commits.length, commitsBefore);
  assert.equal(branchSnapshot(repo, "main").length, filesBefore);
  assert.equal(branchSnapshot(repo, "feature/api-v2").length, filesBefore);
  assert.deepEqual(
    branchCommitList(repo, "feature/api-v2").map((commit) => commit.message),
    branchCommitList(repo, "main").map((commit) => commit.message),
  );

  // A different base branch points at that branch's head.
  const fromFeature = createBranch(state, repo, {
    accountId: alice,
    name: "pw-branch-1",
    baseBranch: "feature-search",
  });
  assert.ok(fromFeature.ok);
  assert.equal(findBranch(repo, "pw-branch-1").commitId, findBranch(repo, "feature-search").commitId);
});

test("createBranch rejects duplicates, invalid names, and missing permission", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");
  const repo = personalRepo(state, "acme-docs");

  assert.equal(
    createBranch(state, repo, { accountId: alice, name: "main", baseBranch: "main" }).ok,
    false,
  );
  assert.equal(
    createBranch(state, repo, { accountId: alice, name: "invalid..branch", baseBranch: "main" }).ok,
    false,
  );
  assert.equal(
    createBranch(state, repo, { accountId: alice, name: "ends/", baseBranch: "main" }).ok,
    false,
  );
  assert.equal(
    createBranch(state, repo, { accountId: alice, name: "a//b", baseBranch: "main" }).ok,
    false,
  );
  assert.equal(
    createBranch(state, repo, { accountId: alice, name: "", baseBranch: "main" }).ok,
    false,
  );

  // bob has no write role; an anonymous visitor neither.
  assert.equal(
    createBranch(state, repo, { accountId: bob, name: "bobs-branch", baseBranch: "main" }).forbidden,
    true,
  );
  assert.equal(
    createBranch(state, repo, { accountId: null, name: "anon-branch", baseBranch: "main" }).forbidden,
    true,
  );

  // No branch was created by any failed attempt.
  assert.deepEqual(
    repo.branches.map((branch) => branch.name),
    [
      "main",
      "feature-search",
      "release",
      "draft-feature",
      "feature-review",
      "review-candidate",
      "merge-ready",
      "merge-blocked",
    ],
  );
});

test("searchCode matches content within one repository branch with path and language filters", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");

  // Two files on main contain the known query; one is under src/.
  const all = searchCode(repo, "main", "search flow");
  assert.deepEqual(all.results.map((result) => result.path), ["README.md", "src/search.ts"]);
  assert.ok(all.results.every((result) => result.branch === "main"));
  assert.ok(
    all.results
      .find((result) => result.path === "README.md")
      .matches.some((match) => match.text.includes("search flow")),
  );
  assert.ok(
    all.results
      .find((result) => result.path === "src/search.ts")
      .matches.some((match) => match.text.includes("search flow")),
  );

  // Path filter narrows to files under src/.
  const scoped = searchCode(repo, "main", "search flow", { path: "src/" });
  assert.deepEqual(scoped.results.map((result) => result.path), ["src/search.ts"]);

  // Language filter narrows by extension-derived language.
  const typescript = searchCode(repo, "main", "search", { language: "TypeScript" });
  assert.deepEqual(typescript.results.map((result) => result.path), ["src/search.ts"]);
  const markdown = searchCode(repo, "main", "search", { language: "Markdown" });
  assert.ok(markdown.results.some((result) => result.path === "README.md"));

  // Matching is case-insensitive; an absent query yields no results.
  assert.equal(searchCode(repo, "main", "SEARCH FLOW").results.length, 2);
  assert.deepEqual(searchCode(repo, "main", "no-such-token").results, []);

  // The private repository contains the same term but is a different object:
  // searching acme-docs never returns another repository's files.
  const secret = personalRepo(state, "secret-research");
  assert.ok(branchSnapshot(secret, "main").some((file) => file.content.includes("search flow")));
  assert.ok(all.results.every((result) => !result.path.includes("notes.md")));
});
