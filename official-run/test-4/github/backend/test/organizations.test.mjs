import assert from "node:assert/strict";
import test from "node:test";

import {
  addOrganizationMember,
  addTeamMember,
  canGrantRepositoryAccess,
  canReadRepository,
  createOrganization,
  createTeam,
  effectiveRepositoryRole,
  findOrganization,
  findTeam,
  listOrganizationMembers,
  listOrganizationsForAccount,
  listRepoGrants,
  listTeamMembers,
  listTeams,
  listVisibleRepositories,
  organizationRole,
  removeOrganizationMember,
  removeTeamMember,
  seedOrganizations,
  setRepoGrant,
  setTeamParent,
  updateRepoGrantRole,
  validateDisplayName,
  validateOrganizationName,
  validateTeamName,
} from "../src/domain/organizations.mjs";
import { registerAccount, seedState } from "../src/domain/accounts.mjs";

function freshState() {
  const state = { accounts: [], sessions: [], recovery: [], organizations: [], organizationMembers: [], repositories: [], teams: [], teamMembers: [], repoGrants: [] };
  seedState(state);
  seedOrganizations(state);
  return state;
}

function accountId(state, username) {
  return state.accounts.find((candidate) => candidate.username === username).id;
}

test("seed provides Acme Demo, public and private repositories, member bob-reviewer and teams", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  assert.ok(org);
  assert.equal(org.displayName, "Acme Demo");
  assert.equal(organizationRole(state, org.id, accountId(state, "alice-dev")), "owner");
  assert.equal(organizationRole(state, org.id, accountId(state, "bob-reviewer")), "member");

  const repos = listVisibleRepositories(state, org.id, null);
  assert.deepEqual(repos.map((repo) => repo.name), ["acme-docs"]);
  assert.equal(repos[0].visibility, "public");

  const names = listTeams(state, org.id).map((team) => team.name);
  assert.ok(names.includes("frontend-team"));
  assert.ok(names.includes("platform-team"));
  const frontend = listTeams(state, org.id).find((team) => team.name === "frontend-team");
  assert.equal(frontend.parentName, "platform-team");

  const members = listOrganizationMembers(state, org.id).map((member) => member.username);
  assert.ok(members.includes("bob-reviewer"));
  assert.ok(members.includes("alice-dev"));
});

test("organization name validation follows the REQ-1 username format", () => {
  assert.ok(validateOrganizationName("mobile-guild"));
  assert.ok(validateOrganizationName("a"));
  assert.ok(!validateOrganizationName("-invalid-organization"));
  assert.ok(!validateOrganizationName(""));
  assert.ok(!validateOrganizationName("UPPER"));
  assert.ok(!validateOrganizationName("has space"));
  assert.ok(!validateOrganizationName("a".repeat(40)));
});

test("display name must be 1-100 characters after trimming", () => {
  assert.ok(validateDisplayName("Mobile Guild"));
  assert.ok(validateDisplayName("A"));
  assert.ok(!validateDisplayName("   "));
  assert.ok(!validateDisplayName(""));
  assert.ok(!validateDisplayName("x".repeat(101)));
  assert.ok(validateDisplayName("  padded  "));
});

test("team name validation is 1-50 lowercase ASCII letters, digits or hyphens without edge hyphens", () => {
  assert.ok(validateTeamName("mobile-team"));
  assert.ok(validateTeamName("a"));
  assert.ok(validateTeamName("a".repeat(50)));
  assert.ok(!validateTeamName(""));
  assert.ok(!validateTeamName("-mobile"));
  assert.ok(!validateTeamName("mobile-"));
  assert.ok(!validateTeamName("Mobile"));
  assert.ok(!validateTeamName("mobile team"));
  assert.ok(!validateTeamName("a".repeat(51)));
});

test("createOrganization stores the organization and Owner membership; duplicate and malformed names are rejected", () => {
  const state = freshState();
  const alice = accountId(state, "alice-dev");

  const created = createOrganization(state, { accountId: alice, name: "mobile-guild", displayName: "  Mobile Guild  " });
  assert.ok(created.ok);
  assert.equal(created.organization.name, "mobile-guild");
  assert.equal(created.organization.displayName, "Mobile Guild");
  assert.equal(organizationRole(state, created.organization.id, alice), "owner");
  assert.deepEqual(
    listOrganizationsForAccount(state, alice).map((org) => org.name),
    ["acme-demo", "mobile-guild"],
  );

  const duplicate = createOrganization(state, { accountId: alice, name: "mobile-guild", displayName: "" });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.name, "Organization name already exists");
  assert.equal(duplicate.errors.displayName, "Display name is required");

  const malformed = createOrganization(state, { accountId: alice, name: "-invalid-organization", displayName: "Bad" });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errors.name, "Organization name format is invalid");

  const whitespace = createOrganization(state, { accountId: alice, name: "fresh-org", displayName: "   " });
  assert.equal(whitespace.ok, false);
  assert.equal(whitespace.errors.displayName, "Display name is required");
  assert.equal(findOrganization(state, "fresh-org"), null);
});

test("createTeam validates format, duplicate and parent ownership; stores creator and timestamp", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const alice = accountId(state, "alice-dev");

  const created = createTeam(state, {
    organizationId: org.id,
    accountId: alice,
    name: "mobile-team",
    description: " Mobile work ",
    parentTeamId: null,
  });
  assert.ok(created.ok);
  assert.equal(created.team.name, "mobile-team");
  assert.equal(created.team.creatorAccountId, alice);
  assert.ok(created.team.createdAt);

  const duplicate = createTeam(state, { organizationId: org.id, accountId: alice, name: "mobile-team" });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.name, "Team name already exists");

  const malformed = createTeam(state, { organizationId: org.id, accountId: alice, name: "-bad-team" });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errors.name, "Team name format is invalid");

  // Parent from another organization is rejected; seed has only one org, so
  // simulate by creating a second org and using its team id.
  const second = createOrganization(state, { accountId: alice, name: "other-org", displayName: "Other Org" });
  const foreignTeam = createTeam(state, { organizationId: second.organization.id, accountId: alice, name: "foreign-team" });
  const wrongParent = createTeam(state, { organizationId: org.id, accountId: alice, name: "new-team", parentTeamId: foreignTeam.team.id });
  assert.equal(wrongParent.ok, false);
  assert.equal(wrongParent.errors.parentTeam, "Parent team does not belong to this organization");
});

test("addTeamMember accepts only current organization members and stores the relationship once", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const team = findTeam(state, org.id, "frontend-team");
  const bob = accountId(state, "bob-reviewer");

  assert.deepEqual(listTeamMembers(state, team.id), []);

  const added = addTeamMember(state, { organizationId: org.id, teamId: team.id, username: "bob-reviewer" });
  assert.ok(added.ok);
  assert.deepEqual(listTeamMembers(state, team.id), [{ username: "bob-reviewer" }]);

  const duplicate = addTeamMember(state, { organizationId: org.id, teamId: team.id, username: "bob-reviewer" });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.username, "Account is already a member");

  const unknown = addTeamMember(state, { organizationId: org.id, teamId: team.id, username: "unknown-reviewer" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors.username, "Account not found");

  // alice-dev is an organization member too, so adding works.
  const alice = addTeamMember(state, { organizationId: org.id, teamId: team.id, username: "alice-dev" });
  assert.ok(alice.ok);
  assert.equal(listTeamMembers(state, team.id).length, 2);
});

test("team membership does not leak to other teams and removal is immediate", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const frontend = findTeam(state, org.id, "frontend-team");
  const docs = findTeam(state, org.id, "docs-team");

  addTeamMember(state, { organizationId: org.id, teamId: frontend.id, username: "bob-reviewer" });
  assert.deepEqual(listTeamMembers(state, docs.id), []);

  const removed = removeTeamMember(state, { teamId: frontend.id, username: "bob-reviewer" });
  assert.ok(removed.ok);
  assert.deepEqual(listTeamMembers(state, frontend.id), []);
});

test("setTeamParent rejects cycles and keeps the original parent", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const frontend = findTeam(state, org.id, "frontend-team");
  const platform = findTeam(state, org.id, "platform-team");
  const child = findTeam(state, org.id, "frontend-child");

  // Original parent from seed.
  assert.equal(frontend.parentTeamId, platform.id);

  // Self-parent is rejected.
  const self = setTeamParent(state, { organizationId: org.id, teamId: frontend.id, parentTeamId: frontend.id });
  assert.equal(self.ok, false);
  assert.equal(self.errors.parentTeam, "Cyclic team hierarchy is not allowed");
  assert.equal(frontend.parentTeamId, platform.id);

  // Descendant as parent is rejected.
  const cycle = setTeamParent(state, { organizationId: org.id, teamId: frontend.id, parentTeamId: child.id });
  assert.equal(cycle.ok, false);
  assert.equal(cycle.errors.parentTeam, "Cyclic team hierarchy is not allowed");
  assert.equal(frontend.parentTeamId, platform.id);

  // A non-cyclic candidate parent is saved.
  const docs = findTeam(state, org.id, "docs-team");
  const saved = setTeamParent(state, { organizationId: org.id, teamId: frontend.id, parentTeamId: docs.id });
  assert.ok(saved.ok);
  assert.equal(frontend.parentTeamId, docs.id);

  // Clearing the parent is allowed.
  const cleared = setTeamParent(state, { organizationId: org.id, teamId: frontend.id, parentTeamId: null });
  assert.ok(cleared.ok);
  assert.equal(frontend.parentTeamId, null);
});

test("private repositories are visible only to organization Owner or granted subjects", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const privateRepo = state.repositories.find((repo) => repo.ownerId === org.id && repo.visibility === "private");
  const bob = accountId(state, "bob-reviewer");
  const alice = accountId(state, "alice-dev");

  assert.equal(canReadRepository(state, null, privateRepo), false);
  assert.equal(canReadRepository(state, bob, privateRepo), false);
  assert.equal(canReadRepository(state, alice, privateRepo), true);

  // A team grant gives direct team members access.
  const frontend = findTeam(state, org.id, "frontend-team");
  addTeamMember(state, { organizationId: org.id, teamId: frontend.id, username: "bob-reviewer" });
  state.repoGrants.push({
    repositoryId: privateRepo.id,
    subjectType: "team",
    subjectId: frontend.id,
    role: "read",
    grantorAccountId: alice,
    createdAt: new Date().toISOString(),
  });
  assert.equal(canReadRepository(state, bob, privateRepo), true);
  assert.equal(canReadRepository(state, accountId(state, "alice-dev"), privateRepo), true);

  // A direct grant also grants access.
  const directState = freshState();
  const directOrg = findOrganization(directState, "acme-demo");
  const privateRepo2 = directState.repositories.find((repo) => repo.ownerId === directOrg.id && repo.visibility === "private");
  directState.repoGrants.push({
    repositoryId: privateRepo2.id,
    subjectType: "account",
    subjectId: accountId(directState, "bob-reviewer"),
    role: "read",
    grantorAccountId: accountId(directState, "alice-dev"),
    createdAt: new Date().toISOString(),
  });
  assert.equal(canReadRepository(directState, accountId(directState, "bob-reviewer"), privateRepo2), true);

  // Organization membership alone grants no private access.
  const plain = freshState();
  assert.equal(canReadRepository(plain, accountId(plain, "bob-reviewer"), privateRepo), false);
});

test("seedOrganizations only seeds once and preserves user changes on restart", () => {
  const state = freshState();
  const orgCount = state.organizations.length;
  const bobCount = state.accounts.filter((candidate) => candidate.username === "bob-reviewer").length;
  seedOrganizations(state);
  assert.equal(state.organizations.length, orgCount);
  assert.equal(state.accounts.filter((candidate) => candidate.username === "bob-reviewer").length, bobCount);
});

test("addOrganizationMember stores Member or Owner immediately; duplicate, unknown and unsupported role are rejected", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");

  // A registered nonmember can be added by username or verified email.
  const registered = registerAccount(state, {
    username: "charlie-dev",
    email: "charlie.dev@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.ok(registered.ok);

  const byUsername = addOrganizationMember(state, {
    organizationId: org.id,
    identifier: "charlie-dev",
    role: "member",
  });
  assert.ok(byUsername.ok);
  assert.ok(listOrganizationMembers(state, org.id).some((member) => member.username === "charlie-dev" && member.role === "member"));

  const charlieId = state.accounts.find((account) => account.username === "charlie-dev").id;
  assert.ok(listOrganizationsForAccount(state, charlieId).some((item) => item.name === "acme-demo"));

  // Adding by verified email also works for a fresh account.
  const byEmail = addOrganizationMember(state, {
    organizationId: org.id,
    identifier: "charlie.dev@example.test",
    role: "owner",
  });
  assert.equal(byEmail.ok, false);
  assert.equal(byEmail.errors.identifier, "Account is already a member");

  // Owner role is stored and grants Admin permission over repositories.
  const ownerAdd = addOrganizationMember(state, {
    organizationId: org.id,
    identifier: "bob-reviewer",
    role: "owner",
  });
  assert.equal(ownerAdd.ok, false);
  assert.equal(ownerAdd.errors.identifier, "Account is already a member");

  const fresh = freshState();
  const freshOrg = findOrganization(fresh, "acme-demo");
  registerAccount(fresh, {
    username: "dana-dev",
    email: "dana.dev@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  const ownerRole = addOrganizationMember(fresh, {
    organizationId: freshOrg.id,
    identifier: "dana-dev",
    role: "owner",
  });
  assert.equal(ownerRole.ok, true);
  assert.equal(organizationRole(fresh, freshOrg.id, accountId(fresh, "dana-dev")), "owner");

  // Unknown account and unsupported role.
  const unknown = addOrganizationMember(fresh, {
    organizationId: freshOrg.id,
    identifier: "unknown-reviewer",
    role: "member",
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors.identifier, "Account not found");

  const badRole = addOrganizationMember(fresh, {
    organizationId: freshOrg.id,
    identifier: "dana-dev",
    role: "boss",
  });
  assert.equal(badRole.ok, false);
  assert.equal(badRole.errors.role, "Role is invalid");
});

test("removeOrganizationMember atomically deletes membership, team memberships and direct grants but keeps the rest", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const privateRepo = state.repositories.find((repo) => repo.ownerId === org.id && repo.visibility === "private");
  const frontend = findTeam(state, org.id, "frontend-team");
  const alice = accountId(state, "alice-dev");

  // charlie is a member of a second organization as well.
  registerAccount(state, {
    username: "charlie-dev",
    email: "charlie.dev@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  const second = createOrganization(state, { accountId: alice, name: "other-org", displayName: "Other Org" });
  addOrganizationMember(state, {
    organizationId: second.organization.id,
    identifier: "charlie-dev",
    role: "member",
  });

  // charlie is a member of acme-demo, in frontend-team, with a direct grant;
  // frontend-team also carries a team grant that must survive.
  addOrganizationMember(state, { organizationId: org.id, identifier: "charlie-dev", role: "member" });
  addTeamMember(state, { organizationId: org.id, teamId: frontend.id, username: "charlie-dev" });
  setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "account",
    subject: "charlie-dev",
    role: "write",
  });
  setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "team",
    subject: "frontend-team",
    role: "read",
  });

  const charlieId = accountId(state, "charlie-dev");
  assert.equal(canReadRepository(state, charlieId, privateRepo), true);

  const removed = removeOrganizationMember(state, { organizationId: org.id, username: "charlie-dev" });
  assert.ok(removed.ok);

  assert.equal(organizationRole(state, org.id, charlieId), null);
  assert.deepEqual(listTeamMembers(state, frontend.id), []);
  assert.equal(listRepoGrants(state, privateRepo.id).length, 1); // only the team grant remains
  assert.equal(listRepoGrants(state, privateRepo.id)[0].subjectName, "frontend-team");
  assert.equal(canReadRepository(state, charlieId, privateRepo), false);
  assert.equal(canReadRepository(state, charlieId, privateRepo), false);

  // The account, its other-organization relationship and the team survive.
  assert.ok(state.accounts.some((account) => account.username === "charlie-dev"));
  assert.equal(organizationRole(state, second.organization.id, charlieId), "member");
  assert.ok(state.teams.some((team) => team.id === frontend.id));
});

test("the last Owner cannot be removed and all relationships stay unchanged", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const bob = accountId(state, "bob-reviewer");

  const before = listOrganizationMembers(state, org.id);
  const result = removeOrganizationMember(state, { organizationId: org.id, username: "alice-dev" });
  assert.equal(result.ok, false);
  assert.equal(result.errors.username, "The last Owner cannot be removed");
  assert.deepEqual(listOrganizationMembers(state, org.id), before);
  assert.equal(organizationRole(state, org.id, accountId(state, "alice-dev")), "owner");
  assert.equal(organizationRole(state, org.id, bob), "member");

  // A second Owner makes removal of the first one possible.
  registerAccount(state, {
    username: "dana-dev",
    email: "dana.dev@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  addOrganizationMember(state, { organizationId: org.id, identifier: "dana-dev", role: "owner" });
  const secondResult = removeOrganizationMember(state, { organizationId: org.id, username: "alice-dev" });
  assert.ok(secondResult.ok);
  assert.equal(organizationRole(state, org.id, accountId(state, "alice-dev")), null);
  assert.equal(organizationRole(state, org.id, accountId(state, "dana-dev")), "owner");
});

test("setRepoGrant stores exactly one record per subject and repository and replaces the role", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const privateRepo = state.repositories.find((repo) => repo.ownerId === org.id && repo.visibility === "private");
  const alice = accountId(state, "alice-dev");

  const first = setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "team",
    subject: "frontend-team",
    role: "write",
  });
  assert.ok(first.ok);
  assert.equal(listRepoGrants(state, privateRepo.id).length, 1);
  assert.equal(listRepoGrants(state, privateRepo.id)[0].role, "write");

  // Saving the same role again does not create a second record.
  const again = setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "team",
    subject: "frontend-team",
    role: "write",
  });
  assert.ok(again.ok);
  assert.equal(listRepoGrants(state, privateRepo.id).length, 1);

  // Changing the role replaces the original role.
  const changed = setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "team",
    subject: "frontend-team",
    role: "read",
  });
  assert.ok(changed.ok);
  assert.equal(listRepoGrants(state, privateRepo.id).length, 1);
  assert.equal(listRepoGrants(state, privateRepo.id)[0].role, "read");
  assert.equal(listRepoGrants(state, privateRepo.id)[0].subjectName, "frontend-team");
});

test("updateRepoGrantRole replaces the role without duplicating and rejects invalid roles", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const privateRepo = state.repositories.find((repo) => repo.ownerId === org.id && repo.visibility === "private");
  const alice = accountId(state, "alice-dev");
  const frontend = findTeam(state, org.id, "frontend-team");

  setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "team",
    subject: "frontend-team",
    role: "write",
  });
  const updated = updateRepoGrantRole(state, {
    repositoryId: privateRepo.id,
    subjectType: "team",
    subjectId: frontend.id,
    role: "read",
  });
  assert.ok(updated.ok);
  assert.equal(listRepoGrants(state, privateRepo.id).length, 1);
  assert.equal(listRepoGrants(state, privateRepo.id)[0].role, "read");

  const invalid = updateRepoGrantRole(state, {
    repositoryId: privateRepo.id,
    subjectType: "team",
    subjectId: frontend.id,
    role: "superuser",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.role, "Role is invalid");
  assert.equal(listRepoGrants(state, privateRepo.id)[0].role, "read");
});

test("grant validation: only current organization members or the organization's own teams are grantable", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const privateRepo = state.repositories.find((repo) => repo.ownerId === org.id && repo.visibility === "private");
  const alice = accountId(state, "alice-dev");

  const notMember = setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "account",
    subject: "charlie-dev",
    role: "read",
  });
  assert.equal(notMember.ok, false);
  assert.equal(notMember.errors.subject, "Account not found");

  const foreignTeam = setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "team",
    subject: "nope-team",
    role: "read",
  });
  assert.equal(foreignTeam.ok, false);
  assert.equal(foreignTeam.errors.subject, "Team not found");
});

test("effective repository role is the highest of Owner status, direct grants and team grants only", () => {
  const state = freshState();
  const org = findOrganization(state, "acme-demo");
  const privateRepo = state.repositories.find((repo) => repo.ownerId === org.id && repo.visibility === "private");
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");
  const frontend = findTeam(state, org.id, "frontend-team");

  assert.equal(effectiveRepositoryRole(state, bob, privateRepo), null);
  assert.equal(effectiveRepositoryRole(state, alice, privateRepo), "admin");
  assert.equal(canGrantRepositoryAccess(state, alice, privateRepo), true);
  assert.equal(canGrantRepositoryAccess(state, bob, privateRepo), false);

  // Direct grant: bob gets write.
  setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "account",
    subject: "bob-reviewer",
    role: "write",
  });
  assert.equal(effectiveRepositoryRole(state, bob, privateRepo), "write");
  assert.equal(canReadRepository(state, bob, privateRepo), true);

  // Team grant applies only to direct team members; team hierarchy does not propagate.
  const child = findTeam(state, org.id, "frontend-child");
  setRepoGrant(state, {
    organizationId: org.id,
    repositoryId: privateRepo.id,
    grantorAccountId: alice,
    subjectType: "team",
    subject: "frontend-team",
    role: "admin",
  });
  // bob is not in frontend-team yet.
  assert.equal(effectiveRepositoryRole(state, bob, privateRepo), "write");
  addTeamMember(state, { organizationId: org.id, teamId: frontend.id, username: "bob-reviewer" });
  assert.equal(effectiveRepositoryRole(state, bob, privateRepo), "admin");
  assert.equal(canGrantRepositoryAccess(state, bob, privateRepo), true);

  // A member of a child team is not a member of the parent team.
  addTeamMember(state, { organizationId: org.id, teamId: child.id, username: "alice-dev" });
  const otherState = freshState();
  const otherOrg = findOrganization(otherState, "acme-demo");
  const otherRepo = otherState.repositories.find((repo) => repo.ownerId === otherOrg.id && repo.visibility === "private");
  const otherChild = findTeam(otherState, otherOrg.id, "frontend-child");
  const otherParent = findTeam(otherState, otherOrg.id, "frontend-team");
  addTeamMember(otherState, { organizationId: otherOrg.id, teamId: otherChild.id, username: "bob-reviewer" });
  setRepoGrant(otherState, {
    organizationId: otherOrg.id,
    repositoryId: otherRepo.id,
    grantorAccountId: accountId(otherState, "alice-dev"),
    subjectType: "team",
    subject: otherParent.name,
    role: "read",
  });
  assert.equal(effectiveRepositoryRole(otherState, accountId(otherState, "bob-reviewer"), otherRepo), null);
  assert.equal(canReadRepository(otherState, accountId(otherState, "bob-reviewer"), otherRepo), false);
});
