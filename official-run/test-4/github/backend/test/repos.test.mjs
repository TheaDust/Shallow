import assert from "node:assert/strict";
import test from "node:test";

import {
  canReadRepository,
  effectiveRepositoryRole,
  findOrganization,
  seedOrganizations,
} from "../src/domain/organizations.mjs";
import { seedState } from "../src/domain/accounts.mjs";
import {
  changeRepositoryVisibility,
  createFork,
  createRepository,
  describeRepository,
  listAccountRepositories,
  searchRepositories,
  seedRepositories,
  validateRepositoryName,
} from "../src/domain/repos.mjs";
import { normalizeRepositories, branchCommitList } from "../src/domain/vcs.mjs";

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

test("createRepository with README initialization stores files, the initial branch, and one initial commit", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");

  const outcome = createRepository(state, {
    accountId: alice,
    ownerType: "account",
    owner: "alice-dev",
    name: "playwright-repo",
    description: "Repository created by Playwright",
    visibility: "private",
    initReadme: true,
  });
  assert.ok(outcome.ok);
  const repository = outcome.repository;
  assert.equal(repository.ownerType, "account");
  assert.equal(repository.ownerId, alice);
  assert.equal(repository.visibility, "private");
  assert.equal(repository.defaultBranch, "main");
  assert.equal(repository.creatorAccountId, alice);
  assert.equal(repository.sourceRepositoryId, null);
  assert.deepEqual(
    repository.commits[0].files.map((file) => file.path),
    ["README.md"],
  );
  assert.equal(repository.commits[0].files[0].content, "# playwright-repo\n");
  assert.equal(repository.commits.length, 1);
  assert.equal(repository.commits[0].message, "Initial commit");
  assert.equal(repository.branches[0].name, "main");
  assert.equal(repository.branches[0].commitId, repository.commits[0].id);

  // The repository appears in the target owner's repository list with the metadata.
  const aliceList = listAccountRepositories(state, state.accounts.find((a) => a.username === "alice-dev"), alice);
  assert.ok(aliceList.some((repo) => repo.name === "playwright-repo" && repo.visibility === "private"));
  const detail = describeRepository(state, repository, alice);
  assert.equal(detail.description, "Repository created by Playwright");
  assert.equal(detail.ownerName, "alice-dev");
  assert.equal(detail.currentRole, "admin");
});

test("createRepository without initialization creates an empty repository with no commits", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");

  const outcome = createRepository(state, {
    accountId: alice,
    ownerType: "account",
    owner: "alice-dev",
    name: "empty-repo",
    description: "",
    visibility: "public",
    initReadme: false,
  });
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.repository.commits, []);
  assert.equal(outcome.repository.branches[0].name, "main");
  assert.equal(outcome.repository.branches[0].commitId, null);
  assert.equal(outcome.repository.visibility, "public");
});

test("createRepository rejects duplicate, empty, and invalid names without creating anything", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const before = state.repositories.length;

  const duplicate = createRepository(state, {
    accountId: alice,
    ownerType: "account",
    owner: "alice-dev",
    name: "acme-docs",
    description: "",
    visibility: "private",
    initReadme: true,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.name, "Repository name already exists");

  const empty = createRepository(state, {
    accountId: alice,
    ownerType: "account",
    owner: "alice-dev",
    name: "   ",
    description: "",
    visibility: "private",
    initReadme: true,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.errors.name, "Repository name format is invalid");

  const invalid = createRepository(state, {
    accountId: alice,
    ownerType: "account",
    owner: "alice-dev",
    name: "has space",
    description: "",
    visibility: "private",
    initReadme: true,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.name, "Repository name format is invalid");

  const badVisibility = createRepository(state, {
    accountId: alice,
    ownerType: "account",
    owner: "alice-dev",
    name: "ok-name",
    description: "",
    visibility: "everyone",
    initReadme: true,
  });
  assert.equal(badVisibility.ok, false);
  assert.equal(badVisibility.errors.visibility, "Visibility is invalid");

  assert.equal(state.repositories.length, before);
});

test("createRepository enforces namespace creation permission: self and organization Owner only", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");
  const before = state.repositories.length;

  // bob may create in his own namespace but not in alice's personal namespace.
  const bobPersonal = createRepository(state, {
    accountId: bob,
    ownerType: "account",
    owner: "bob-reviewer",
    name: "bob-repo",
    description: "",
    visibility: "private",
    initReadme: false,
  });
  assert.ok(bobPersonal.ok);

  const notAlice = createRepository(state, {
    accountId: bob,
    ownerType: "account",
    owner: "alice-dev",
    name: "steal-repo",
    description: "",
    visibility: "private",
    initReadme: false,
  });
  assert.equal(notAlice.ok, false);
  assert.equal(notAlice.forbidden, true);

  // The organization Owner may create; an ordinary member may not.
  const aliceOrg = createRepository(state, {
    accountId: alice,
    ownerType: "organization",
    owner: "acme-demo",
    name: "docs-copy",
    description: "",
    visibility: "private",
    initReadme: true,
  });
  assert.ok(aliceOrg.ok);
  assert.equal(aliceOrg.repository.ownerType, "organization");
  assert.equal(aliceOrg.repository.ownerId, findOrganization(state, "acme-demo").id);
  assert.equal(aliceOrg.repository.commits[0].files[0].path, "README.md");

  const bobOrg = createRepository(state, {
    accountId: bob,
    ownerType: "organization",
    owner: "acme-demo",
    name: "member-repo",
    description: "",
    visibility: "private",
    initReadme: false,
  });
  assert.equal(bobOrg.ok, false);
  assert.equal(bobOrg.forbidden, true);

  // A visitor cannot create anything.
  const visitor = createRepository(state, {
    accountId: null,
    ownerType: "account",
    owner: "alice-dev",
    name: "visitor-repo",
    description: "",
    visibility: "private",
    initReadme: false,
  });
  assert.equal(visitor.ok, false);
  assert.equal(visitor.forbidden, true);

  // Name conflicts are scoped to the target namespace: acme-demo may host its own acme-docs.
  const orgDuplicate = createRepository(state, {
    accountId: alice,
    ownerType: "organization",
    owner: "acme-demo",
    name: "acme-docs",
    description: "",
    visibility: "private",
    initReadme: false,
  });
  assert.equal(orgDuplicate.ok, false);
  assert.equal(orgDuplicate.errors.name, "Repository name already exists");

  assert.equal(state.repositories.length, before + 2);
});

test("repository name validation follows a conservative repo-name format", () => {
  assert.ok(validateRepositoryName("acme-docs"));
  assert.ok(validateRepositoryName("acme-docs-copy"));
  assert.ok(validateRepositoryName("repo_1"));
  assert.ok(!validateRepositoryName(""));
  assert.ok(!validateRepositoryName("-leading"));
  assert.ok(!validateRepositoryName("has space"));
  assert.ok(!validateRepositoryName("a".repeat(101)));
});

test("seed provides alice-dev personal repositories and the non-Admin collaborator grant", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");

  const acmeDocs = personalRepo(state, "acme-docs");
  assert.ok(acmeDocs);
  assert.equal(acmeDocs.ownerType, "account");
  assert.equal(acmeDocs.ownerId, alice);
  assert.equal(acmeDocs.visibility, "public");
  assert.ok(acmeDocs.commits.length >= 2);
  assert.deepEqual(
    acmeDocs.branches.map((branch) => branch.name),
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
  assert.equal(acmeDocs.sourceRepositoryId, null);

  const secret = personalRepo(state, "secret-research");
  assert.equal(secret.visibility, "private");
  assert.equal(secret.commits[0].files[0].path, "README.md");

  const conflict = personalRepo(state, "acme-docs-fork");
  assert.ok(conflict);
  assert.equal(conflict.visibility, "private");

  // bob-reviewer is a read collaborator on the private personal repository.
  assert.equal(effectiveRepositoryRole(state, bob, secret), "read");
  assert.equal(effectiveRepositoryRole(state, alice, secret), "admin");
  assert.equal(effectiveRepositoryRole(state, null, secret), null);
});

test("search is visibility-scoped: visitors see public matches only, collaborators see granted private repos", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");

  const visitor = searchRepositories(state, "acme", null);
  const names = visitor.map((repo) => `${repo.ownerName}/${repo.name}`);
  assert.ok(names.includes("alice-dev/acme-docs"));
  assert.ok(names.includes("acme-demo/acme-docs"));
  assert.ok(!names.some((name) => name.includes("secret-research")));
  assert.ok(!names.some((name) => name.includes("acme-internal")));

  const visitorSecret = searchRepositories(state, "secret-research", null);
  assert.equal(visitorSecret.length, 0);

  const aliceResults = searchRepositories(state, "secret", alice);
  assert.deepEqual(aliceResults.map((repo) => repo.name), ["secret-research"]);

  const bobResults = searchRepositories(state, "secret", bob);
  assert.deepEqual(bobResults.map((repo) => repo.name), ["secret-research"]);

  assert.equal(searchRepositories(state, "", null).length, 0);
  assert.equal(searchRepositories(state, "no-such-repo", null).length, 0);
});

test("listAccountRepositories shows only readable personal repositories", () => {
  const state = freshState();
  const alice = state.accounts.find((candidate) => candidate.username === "alice-dev");
  const bob = accountId(state, "bob-reviewer");

  const visitor = listAccountRepositories(state, alice, null).map((repo) => repo.name);
  assert.deepEqual(visitor, ["acme-docs"]);

  const forBob = listAccountRepositories(state, alice, bob).map((repo) => repo.name).sort();
  assert.deepEqual(forBob, ["acme-docs", "secret-research"]);

  const forAlice = listAccountRepositories(state, alice, alice.id).map((repo) => repo.name).sort();
  assert.deepEqual(forAlice, ["acme-docs", "acme-docs-fork", "secret-research"]);
});

test("a fork copies the default-branch files and records the source link", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");

  const outcome = createFork(state, {
    accountId: alice,
    sourceOwnerType: "account",
    sourceOwner: "alice-dev",
    sourceRepo: "acme-docs",
    targetOwnerType: "account",
    targetOwner: "alice-dev",
    name: "acme-docs-copy",
    visibility: "public",
  });
  assert.ok(outcome.ok);
  const fork = outcome.repository;
  assert.equal(fork.ownerType, "account");
  assert.equal(fork.name, "acme-docs-copy");
  assert.equal(fork.visibility, "public");
  assert.equal(fork.sourceRepositoryId, personalRepo(state, "acme-docs").id);
  const source = personalRepo(state, "acme-docs");
  assert.deepEqual(
    fork.commits[0].files.map((file) => file.path),
    ["README.md", "guide.md", "src/search.ts", "docs/overview.md"],
  );
  assert.equal(fork.description, "Documentation for Acme Demo");

  // Forking the same name again conflicts and creates nothing.
  const conflict = createFork(state, {
    accountId: alice,
    sourceOwnerType: "account",
    sourceOwner: "alice-dev",
    sourceRepo: "acme-docs",
    targetOwnerType: "account",
    targetOwner: "alice-dev",
    name: "acme-docs-copy",
    visibility: "public",
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errors.name, "Repository name already exists");

  // The seeded conflict name is also rejected.
  const seededConflict = createFork(state, {
    accountId: alice,
    sourceOwnerType: "account",
    sourceOwner: "alice-dev",
    sourceRepo: "acme-docs",
    targetOwnerType: "account",
    targetOwner: "alice-dev",
    name: "acme-docs-fork",
    visibility: "public",
  });
  assert.equal(seededConflict.ok, false);
  assert.equal(seededConflict.errors.name, "Repository name already exists");

  // Forks never write back to the source.
  fork.commits[0].files[0].content = "changed";
  const sourceHead = branchCommitList(source, "main")[0];
  const sourceCommit = source.commits.find((candidate) => candidate.id === sourceHead.id);
  assert.notEqual(sourceCommit.files[0].content, "changed");
});

test("forking a private source forces the fork to stay Private", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");

  const outcome = createFork(state, {
    accountId: alice,
    sourceOwnerType: "account",
    sourceOwner: "alice-dev",
    sourceRepo: "secret-research",
    targetOwnerType: "account",
    targetOwner: "alice-dev",
    name: "research-copy",
    visibility: "public",
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.repository.visibility, "private");
});

test("forks validate both ends: source readability and target creation permission", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");

  // bob has Read on secret-research via the grant, so he may fork it into his own namespace.
  const bobFork = createFork(state, {
    accountId: bob,
    sourceOwnerType: "account",
    sourceOwner: "alice-dev",
    sourceRepo: "secret-research",
    targetOwnerType: "account",
    targetOwner: "bob-reviewer",
    name: "research-bob",
    visibility: "private",
  });
  assert.ok(bobFork.ok);
  assert.equal(bobFork.repository.visibility, "private");
  assert.equal(bobFork.repository.ownerId, bob);

  // A visitor cannot fork at all.
  const visitorFork = createFork(state, {
    accountId: null,
    sourceOwnerType: "account",
    sourceOwner: "alice-dev",
    sourceRepo: "acme-docs",
    targetOwnerType: "account",
    targetOwner: "alice-dev",
    name: "visitor-fork",
    visibility: "public",
  });
  assert.equal(visitorFork.ok, false);
  assert.equal(visitorFork.forbidden, true);

  // An inaccessible private source is rejected.
  const noGrant = createFork(state, {
    accountId: bob,
    sourceOwnerType: "account",
    sourceOwner: "alice-dev",
    sourceRepo: "secret-research",
    targetOwnerType: "organization",
    targetOwner: "acme-demo",
    name: "org-fork",
    visibility: "private",
  });
  assert.equal(noGrant.ok, false);
  assert.equal(noGrant.forbidden, true);

  // Only the organization Owner may fork into an organization namespace.
  const ownerFork = createFork(state, {
    accountId: alice,
    sourceOwnerType: "account",
    sourceOwner: "alice-dev",
    sourceRepo: "acme-docs",
    targetOwnerType: "organization",
    targetOwner: "acme-demo",
    name: "docs-in-org",
    visibility: "private",
  });
  assert.ok(ownerFork.ok);
  assert.equal(ownerFork.repository.ownerType, "organization");
  assert.equal(ownerFork.repository.ownerId, findOrganization(state, "acme-demo").id);
});

test("visibility changes apply only for the repository admin", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");
  const secret = personalRepo(state, "secret-research");

  assert.equal(effectiveRepositoryRole(state, alice, secret), "admin");
  assert.equal(effectiveRepositoryRole(state, bob, secret), "read");

  const outcome = changeRepositoryVisibility(state, {
    repositoryId: secret.id,
    visibility: "public",
  });
  assert.ok(outcome.ok);
  assert.equal(personalRepo(state, "secret-research").visibility, "public");
  assert.ok(canReadRepository(state, null, personalRepo(state, "secret-research")));

  const invalid = changeRepositoryVisibility(state, {
    repositoryId: secret.id,
    visibility: "everyone",
  });
  assert.equal(invalid.ok, false);

  // The describe payload exposes the current role and visibility for the UI.
  const detail = describeRepository(state, personalRepo(state, "secret-research"), bob);
  assert.equal(detail.visibility, "public");
  assert.equal(detail.currentRole, "read");
  assert.equal(detail.ownerName, "alice-dev");
});
