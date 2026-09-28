import assert from "node:assert/strict";
import test from "node:test";

import { seedState } from "../src/domain/accounts.mjs";
import { seedOrganizations } from "../src/domain/organizations.mjs";
import { changeDefaultBranch, seedRepositories } from "../src/domain/repos.mjs";
import { branchCommitList, findBranch, normalizeRepositories } from "../src/domain/vcs.mjs";

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

test("REQ-4-3-3 seed provides the main and release branches with retained histories", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");

  assert.ok(findBranch(repo, "main"));
  assert.ok(findBranch(repo, "release"));
  assert.ok(findBranch(repo, "feature-search"));
  assert.equal(repo.defaultBranch, "main");

  // Both branches keep their commit histories (release carries one commit
  // ahead of main for the seeded pull request comparison).
  assert.deepEqual(branchCommitList(repo, "main").map((commit) => commit.message), [
    "Document search flow",
    "Initial commit",
  ]);
  assert.deepEqual(branchCommitList(repo, "release").map((commit) => commit.message), [
    "Add changelog",
    "Document search flow",
    "Initial commit",
  ]);
});

test("an Admin changes the default branch; the old branch and commits remain", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const repo = personalRepo(state, "acme-docs");
  const mainHead = branchCommitList(repo, "main")[0].id;
  const commitsBefore = repo.commits.length;
  const branchesBefore = repo.branches.map((branch) => branch.name);

  const outcome = changeDefaultBranch(state, repo, { accountId: alice, branch: "release" });
  assert.ok(outcome.ok);
  assert.equal(repo.defaultBranch, "release");
  assert.equal(repo.defaultBranchChangedBy, alice);
  assert.ok(repo.defaultBranchChangedAt);
  assert.ok(repo.updatedAt >= repo.defaultBranchChangedAt);

  // The previous default branch still exists with its commit and history.
  assert.deepEqual(repo.branches.map((branch) => branch.name), branchesBefore);
  assert.equal(findBranch(repo, "main").commitId, mainHead);
  assert.equal(repo.commits.length, commitsBefore);
  assert.deepEqual(branchCommitList(repo, "main").map((commit) => commit.message), [
    "Document search flow",
    "Initial commit",
  ]);

  // A persisted round-trip of the state keeps the new default branch.
  const persisted = JSON.parse(JSON.stringify(state));
  const rereadRepo = persisted.repositories.find((candidate) => candidate.id === repo.id);
  assert.equal(rereadRepo.defaultBranch, "release");
  assert.equal(rereadRepo.defaultBranchChangedBy, alice);
  assert.ok(rereadRepo.defaultBranchChangedAt);
});

test("a non-Admin cannot change the default branch and the value stays unchanged", () => {
  const state = freshState();
  const bob = accountId(state, "bob-reviewer");
  const repo = personalRepo(state, "acme-docs");

  assert.equal(
    changeDefaultBranch(state, repo, { accountId: bob, branch: "release" }).forbidden,
    true,
  );
  assert.equal(
    changeDefaultBranch(state, repo, { accountId: null, branch: "release" }).forbidden,
    true,
  );
  assert.equal(repo.defaultBranch, "main");
  assert.equal(repo.defaultBranchChangedBy, undefined);
});

test("an unknown branch is rejected without changing the default branch", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const repo = personalRepo(state, "acme-docs");

  const outcome = changeDefaultBranch(state, repo, { accountId: alice, branch: "no-such-branch" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors.branch, "Branch not found");
  assert.equal(repo.defaultBranch, "main");
  assert.equal(repo.defaultBranchChangedBy, undefined);
  assert.deepEqual(repo.branches.map((branch) => branch.name), [
    "main",
    "feature-search",
    "release",
    "draft-feature",
    "feature-review",
    "review-candidate",
    "merge-ready",
    "merge-blocked",
  ]);
});
