import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAccountsDomain } from "../src/domain/accounts.mjs";
import { createOrganizationsDomain } from "../src/domain/organizations.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function createDomains() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-codever-"));
  const store = createJsonStore(join(directory, "state.json"), {
    accounts: {},
    sessions: {},
    organizations: {},
    memberships: {},
    teams: {},
    teamMembers: {},
    repositories: {},
    grants: {},
    git: {},
  });
  const accounts = createAccountsDomain(store);
  const organizations = createOrganizationsDomain(store);
  await accounts.seedIfEmpty();
  await organizations.seedIfEmpty();
  return { directory, store, accounts, organizations };
}

test("branch history lists commits newest first and file scope filters by path", async () => {
  const { organizations } = await createDomains();

  const history = await organizations.getRepositoryCommits("acme-demo", "acme-docs", {}, null);
  assert.equal(history.ok, true);
  assert.equal(history.branch, "main");
  assert.deepEqual(
    history.commits.map((commit) => commit.message),
    ["Document search flow", "Initial commit"],
  );
  assert.equal(history.commits[0].author, "alice-dev");
  assert.equal(history.commits[0].parentId, "c1");
  assert.ok(
    history.commits[0].changes.some((change) => change.path === "src/search.ts"),
  );

  const fileHistory = await organizations.getRepositoryCommits(
    "acme-demo",
    "acme-docs",
    { path: "README.md" },
    null,
  );
  assert.deepEqual(
    fileHistory.commits.map((commit) => commit.message),
    ["Document search flow", "Initial commit"],
  );

  // main-only.md was only touched by c3, which is not on main.
  const mainOnly = await organizations.getRepositoryCommits(
    "acme-demo",
    "acme-docs",
    { path: "main-only.md" },
    null,
  );
  assert.deepEqual(mainOnly.commits, []);

  // feature-search branch includes the c3 commit.
  const featureHistory = await organizations.getRepositoryCommits(
    "acme-demo",
    "acme-docs",
    { branch: "feature-search" },
    null,
  );
  assert.deepEqual(
    featureHistory.commits.map((commit) => commit.message),
    ["Add main-only file", "Document search flow", "Initial commit"],
  );
});

test("commit diff exposes changed files, additions/deletions and line diffs", async () => {
  const { organizations } = await createDomains();

  const diff = await organizations.getCommitDiff("acme-demo", "acme-docs", "c2", {}, null);
  assert.equal(diff.ok, true);
  assert.equal(diff.base, "c1");
  assert.equal(diff.compare, "c2");
  assert.equal(diff.commit.message, "Document search flow");
  assert.deepEqual(
    diff.files.map((file) => file.path),
    ["README.md", "src/search.ts"],
  );
  assert.equal(diff.totalAdditions, 4);
  assert.equal(diff.totalDeletions, 1);

  const readme = diff.files.find((file) => file.path === "README.md");
  assert.equal(readme.additions, 1);
  assert.equal(readme.deletions, 1);
  assert.ok(readme.lines.some((line) => line.type === "add"));
  assert.ok(readme.lines.some((line) => line.type === "del"));

  const search = diff.files.find((file) => file.path === "src/search.ts");
  assert.equal(search.additions, 3);
  assert.equal(search.deletions, 0);
  assert.ok(search.lines.every((line) => line.type === "add" || line.type === "context"));

  // File-scoped diff keeps only that file.
  const scoped = await organizations.getCommitDiff("acme-demo", "acme-docs", "c2", { path: "src/search.ts" }, null);
  assert.deepEqual(scoped.files.map((file) => file.path), ["src/search.ts"]);
  assert.equal(scoped.totalAdditions, 3);
  assert.equal(scoped.totalDeletions, 0);
});

test("revision comparison resolves branches and commits and stays read-only", async () => {
  const { organizations, store } = await createDomains();

  const compared = await organizations.getCompareDiff("acme-demo", "acme-docs", "main", "feature-search", {}, null);
  assert.equal(compared.ok, true);
  assert.equal(compared.base, "c2");
  assert.equal(compared.compare, "c3");
  // The feature branch carries the added main-only file and the modified
  // seeded comparison path src/search.ts (REQ-6-2-2).
  assert.deepEqual(compared.files.map((file) => file.path), ["main-only.md", "src/search.ts"]);
  assert.equal(compared.totalAdditions, 2);
  assert.equal(compared.totalDeletions, 1);

  const stateBefore = await store.read();
  const beforeGit = JSON.stringify(stateBefore.git["acme-demo:acme-docs"]);
  const stateAfter = await store.read();
  assert.equal(JSON.stringify(stateAfter.git["acme-demo:acme-docs"]), beforeGit);

  const missing = await organizations.getCompareDiff("acme-demo", "acme-docs", "main", "no-such-ref", {}, null);
  assert.equal(missing.notFound, true);
});

test("code search matches only readable files in the current repository", async () => {
  const { organizations } = await createDomains();

  const results = await organizations.searchRepositoryCode("acme-demo", "acme-docs", "search", {}, null);
  assert.equal(results.ok, true);
  assert.deepEqual(
    results.results.map((result) => result.path),
    ["README.md", "src/search.ts"],
  );
  assert.equal(results.results[0].branch, "main");
  assert.ok(results.results[0].snippet.includes("search"));

  const filtered = await organizations.searchRepositoryCode("acme-demo", "acme-docs", "search", { path: "src/" }, null);
  assert.deepEqual(filtered.results.map((result) => result.path), ["src/search.ts"]);

  const none = await organizations.searchRepositoryCode("acme-demo", "acme-docs", "no-such-token", {}, null);
  assert.deepEqual(none.results, []);

  // Private repository denies visitors.
  const denied = await organizations.searchRepositoryCode("alice-dev", "secret-research", "research", {}, null);
  assert.equal(denied.denied, true);
});

test("creating a commit stores one indivisible record and moves the branch head", async () => {
  const { organizations, store } = await createDomains();

  // `main` is protected in the seed (REQ-6-5), so the web-editor commit flow
  // is exercised on an unprotected branch.
  const branch = "feature-search";
  const before = await organizations.getRepositoryCommits("acme-demo", "acme-docs", { branch }, null);
  const headBefore = before.commits[0].id;

  const created = await organizations.createRepositoryCommit("alice-dev", "acme-demo", "acme-docs", {
    branch,
    path: "docs/guide.md",
    content: "# Guide\n\nCreated through the web editor.\n",
    message: "Add docs/guide.md",
  });
  assert.equal(created.ok, true);
  assert.equal(created.commit.message, "Add docs/guide.md");
  assert.equal(created.commit.author, "alice-dev");
  assert.equal(created.commit.parentId, headBefore);

  const state = await store.read();
  const git = state.git["acme-demo:acme-docs"];
  assert.notEqual(git.branches[branch], headBefore);
  assert.equal(git.commits[git.branches[branch]].changes[0].path, "docs/guide.md");
  assert.equal(git.files[branch]["docs/guide.md"].content, "# Guide\n\nCreated through the web editor.\n");

  const history = await organizations.getRepositoryCommits("acme-demo", "acme-docs", { branch }, null);
  assert.equal(history.commits[0].message, "Add docs/guide.md");

  const blob = await organizations.getRepositoryContents("acme-demo", "acme-docs", { path: "docs/guide.md", branch }, null);
  assert.equal(blob.content, "# Guide\n\nCreated through the web editor.\n");
});

test("commit creation rejects invalid paths, empty messages and conflicts without changes", async () => {
  const { organizations, store } = await createDomains();

  const invalid = await organizations.createRepositoryCommit("alice-dev", "acme-demo", "acme-docs", {
    branch: "main",
    path: "../invalid.md",
    content: "must not be saved",
    message: "",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.path, "Invalid file path");
  assert.equal(invalid.errors.message, "Commit message is required");

  const leading = await organizations.createRepositoryCommit("alice-dev", "acme-demo", "acme-docs", {
    branch: "main",
    path: "/absolute.md",
    content: "x",
    message: "Add file",
  });
  assert.equal(leading.errors.path, "Invalid file path");

  const conflict = await organizations.createRepositoryCommit("alice-dev", "acme-demo", "acme-docs", {
    branch: "main",
    path: "README.md",
    content: "overwrite",
    message: "Overwrite README",
  });
  assert.equal(conflict.errors.path, "A file or directory already exists at this path");

  const tooLong = await organizations.createRepositoryCommit("alice-dev", "acme-demo", "acme-docs", {
    branch: "main",
    path: "notes.md",
    content: "x",
    message: "x".repeat(73),
  });
  assert.equal(tooLong.errors.message, "Commit message must be at most 72 characters");

  const state = await store.read();
  const git = state.git["acme-demo:acme-docs"];
  assert.equal(git.branches.main, "c2");
  assert.equal(Object.keys(git.commits).length, 8);
  assert.equal(git.files.main["../invalid.md"], undefined);
});

test("commit creation enforces Write-or-higher permission server-side", async () => {
  const { organizations, store } = await createDomains();

  const forbidden = await organizations.createRepositoryCommit("carol-dev", "acme-demo", "acme-docs", {
    branch: "main",
    path: "bob.md",
    content: "x",
    message: "Add bob.md",
  });
  assert.equal(forbidden.forbidden, true);

  const anonymous = await organizations.createRepositoryCommit(null, "acme-demo", "acme-docs", {
    branch: "main",
    path: "anon.md",
    content: "x",
    message: "Add anon.md",
  });
  assert.equal(anonymous.forbidden, true);

  const state = await store.read();
  assert.equal(state.git["acme-demo:acme-docs"].branches.main, "c2");
});

test("branch history and diffs are denied for inaccessible private repositories", async () => {
  const { organizations } = await createDomains();

  const history = await organizations.getRepositoryCommits("alice-dev", "secret-research", {}, null);
  assert.equal(history.denied, true);

  const diff = await organizations.getCommitDiff("alice-dev", "secret-research", "r1", {}, null);
  assert.equal(diff.denied, true);

  const branches = await organizations.listBranches("alice-dev", "secret-research", null);
  assert.equal(branches.denied, true);
});

test("creating a branch points at the base head and does not rewrite history", async () => {
  const { organizations, store } = await createDomains();

  const created = await organizations.createBranch("alice-dev", "acme-demo", "acme-docs", {
    name: "feature/api-v2",
    base: "main",
  });
  assert.equal(created.ok, true);
  assert.equal(created.branch.name, "feature/api-v2");
  assert.equal(created.branch.commitId, "c2");
  assert.equal(created.branch.createdBy, "alice-dev");
  assert.ok(created.branch.createdAt);

  const state = await store.read();
  const git = state.git["acme-demo:acme-docs"];
  assert.equal(git.branches.main, "c2");
  assert.equal(git.branches["feature-search"], "c3");
  assert.equal(git.branches.release, "c4");
  assert.equal(git.branches["feature/api-v2"], "c2");
  // The new branch is immediately browsable with the base snapshot.
  assert.equal(git.files["feature/api-v2"]["README.md"].content, git.files.main["README.md"].content);
  assert.equal(git.files["feature/api-v2"]["src/search.ts"].content, git.files.main["src/search.ts"].content);

  const contents = await organizations.getRepositoryContents(
    "acme-demo",
    "acme-docs",
    { branch: "feature/api-v2" },
    null,
  );
  assert.equal(contents.ok, true);
  assert.ok(contents.entries.some((entry) => entry.name === "README.md"));

  // Creating from a commit id base works too.
  const fromCommit = await organizations.createBranch("alice-dev", "acme-demo", "acme-docs", {
    name: "from-c3",
    base: "c3",
  });
  assert.equal(fromCommit.ok, true);
  assert.equal(fromCommit.branch.commitId, "c3");
  const stateAfter = await store.read();
  assert.equal(stateAfter.git["acme-demo:acme-docs"].branches["from-c3"], "c3");
});

test("branch creation rejects invalid names, duplicates and missing permission", async () => {
  const { organizations, store } = await createDomains();

  const invalidNames = [
    "",
    "bad name",
    "ends/",
    "ends.",
    "has..dots",
    "has//slash",
    "no ä",
    "x".repeat(256),
  ];
  for (const name of invalidNames) {
    const result = await organizations.createBranch("alice-dev", "acme-demo", "acme-docs", {
      name,
      base: "main",
    });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(name)}`);
    assert.equal(result.errors.name, "Invalid branch");
  }

  const duplicate = await organizations.createBranch("alice-dev", "acme-demo", "acme-docs", {
    name: "main",
    base: "main",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.name, "Branch already exists");

  const missingBase = await organizations.createBranch("alice-dev", "acme-demo", "acme-docs", {
    name: "no-base",
    base: "missing-branch",
  });
  assert.equal(missingBase.ok, false);
  assert.equal(missingBase.errors.base, "Base branch not found");

  const readOnly = await organizations.createBranch("carol-dev", "acme-demo", "acme-docs", {
    name: "bob-branch",
    base: "main",
  });
  assert.equal(readOnly.forbidden, true);

  const anonymous = await organizations.createBranch(null, "acme-demo", "acme-docs", {
    name: "anon-branch",
    base: "main",
  });
  assert.equal(anonymous.forbidden, true);

  const state = await store.read();
  const git = state.git["acme-demo:acme-docs"];
  assert.equal(git.branches.main, "c2");
  assert.equal(git.branches["bob-branch"], undefined);
  assert.equal(git.branches["anon-branch"], undefined);
  // Seed branches: main, feature-search, release, draft-feature,
  // search-pagination, merge-ready, merge-blocked.
  assert.equal(Object.keys(git.branches).length, 7);
});

test("an Admin changes the default branch and the old branch stays available", async () => {
  const { organizations, store } = await createDomains();

  const changed = await organizations.setDefaultBranch("alice-dev", "acme-demo", "acme-docs", "release");
  assert.equal(changed.ok, true);
  assert.equal(changed.repository.defaultBranch, "release");

  const state = await store.read();
  const repo = state.repositories["acme-demo:acme-docs"];
  assert.equal(repo.defaultBranch, "release");
  assert.equal(repo.defaultBranchChangedBy, "alice-dev");
  assert.ok(repo.defaultBranchChangedAt);
  assert.ok(state.git["acme-demo:acme-docs"].branches.main);

  // The repository overview now reads the new default branch.
  const overview = await organizations.getRepository("acme-demo", "acme-docs", null);
  assert.equal(overview.repository.defaultBranch, "release");
  assert.ok(overview.repository.files.some((file) => file.name === "README.md"));

  // Non-existing branches are rejected and no change is stored.
  const missing = await organizations.setDefaultBranch("alice-dev", "acme-demo", "acme-docs", "nope");
  assert.equal(missing.ok, false);
  assert.equal(missing.errors.branch, "Branch not found");
  const stateAfter = await store.read();
  assert.equal(stateAfter.repositories["acme-demo:acme-docs"].defaultBranch, "release");
});

test("changing the default branch requires Admin and is rejected for other roles", async () => {
  const { organizations, store } = await createDomains();

  const deniedMember = await organizations.setDefaultBranch("bob-reviewer", "acme-demo", "acme-docs", "release");
  assert.equal(deniedMember.forbidden, true);

  const anonymous = await organizations.setDefaultBranch(null, "acme-demo", "acme-docs", "release");
  assert.equal(anonymous.forbidden, true);

  const state = await store.read();
  assert.equal(state.repositories["acme-demo:acme-docs"].defaultBranch, "main");
  assert.equal(state.repositories["acme-demo:acme-docs"].defaultBranchChangedBy, undefined);
});
