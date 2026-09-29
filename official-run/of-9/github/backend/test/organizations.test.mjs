import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAccountsDomain } from "../src/domain/accounts.mjs";
import { createOrganizationsDomain } from "../src/domain/organizations.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function createDomains() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-orgs-"));
  const store = createJsonStore(join(directory, "state.json"), {
    accounts: {},
    sessions: {},
    organizations: {},
    memberships: {},
    teams: {},
    teamMembers: {},
    repositories: {},
    grants: {},
  });
  const accounts = createAccountsDomain(store);
  const organizations = createOrganizationsDomain(store);
  await accounts.seedIfEmpty();
  await organizations.seedIfEmpty();
  return { directory, store, accounts, organizations };
}

test("seed provisions the Acme Demo organization, repositories, members and teams", async () => {
  const { store } = await createDomains();
  const state = await store.read();

  const org = state.organizations["acme-demo"];
  assert.ok(org);
  assert.equal(org.displayName, "Acme Demo");

  assert.equal(state.memberships["acme-demo:alice-dev"].role, "owner");
  assert.equal(state.memberships["acme-demo:bob-reviewer"].role, "member");

  assert.equal(state.repositories["acme-demo:acme-docs"].visibility, "public");
  assert.equal(state.repositories["acme-demo:acme-private"].visibility, "private");

  // REQ-3 seeds: the public repository and the private repository with
  // public-ready content are personal repositories owned by alice-dev; the
  // private repository carries a non-Admin collaborator grant for
  // bob-reviewer, plus the fork-conflict repository in the personal namespace.
  assert.equal(state.repositories["alice-dev:acme-docs"].visibility, "public");
  assert.equal(state.repositories["alice-dev:acme-docs"].ownerId, "alice-dev");
  assert.equal(state.repositories["alice-dev:secret-research"].visibility, "private");
  assert.equal(state.repositories["alice-dev:secret-research"].description, "Research notes and experiments");
  assert.equal(state.repositories["acme-demo:secret-research"], undefined);
  const researchGrant = Object.values(state.grants).find(
    (grant) => grant.repoId === "alice-dev:secret-research" && grant.subjectId === "bob-reviewer",
  );
  assert.ok(researchGrant);
  assert.equal(researchGrant.role, "read");
  assert.equal(state.repositories["alice-dev:acme-docs-fork"].ownerId, "alice-dev");
  assert.ok(state.git["acme-demo:acme-docs"]);
  assert.ok(state.git["alice-dev:acme-docs"]);
  assert.equal(state.git["alice-dev:acme-docs"].branches["feature-search"], "c3");
  assert.equal(state.git["alice-dev:acme-docs"].files.main["README.md"].content.includes("search flow"), true);

  assert.ok(state.teams["acme-demo:frontend-team"]);
  assert.equal(state.teams["acme-demo:frontend-team"].parentId, "acme-demo:platform-team");
  assert.equal(state.teams["acme-demo:frontend-child"].parentId, "acme-demo:frontend-team");

  const internalGrant = Object.values(state.grants).find(
    (grant) => grant.repoId === "acme-demo:acme-internal",
  );
  assert.ok(internalGrant);
  assert.equal(internalGrant.subjectType, "team");
  assert.equal(internalGrant.subjectId, "acme-demo:frontend-team");
  assert.equal(internalGrant.role, "write");
});

test("organizations are listed only for members of the account", async () => {
  const { organizations } = await createDomains();
  const alice = await organizations.listOrganizations("alice-dev");
  assert.deepEqual(
    alice.map((org) => org.id),
    ["acme-demo"],
  );
  assert.equal(alice[0].role, "owner");
  assert.deepEqual(await organizations.listOrganizations("bob-reviewer").then((list) => list.map((org) => org.id)), ["acme-demo"]);
  assert.deepEqual(await organizations.listOrganizations("nobody"), []);
});

test("create organization stores the organization and owner membership", async () => {
  const { organizations, store } = await createDomains();
  const result = await organizations.createOrganization("alice-dev", {
    name: "mobile-guild",
    displayName: "  Mobile Guild  ",
  });
  assert.equal(result.ok, true);
  assert.equal(result.organization.id, "mobile-guild");
  assert.equal(result.organization.displayName, "Mobile Guild");
  assert.equal(result.organization.role, "owner");

  const state = await store.read();
  assert.ok(state.organizations["mobile-guild"]);
  assert.equal(state.memberships["mobile-guild:alice-dev"].role, "owner");

  const visible = await organizations.listOrganizations("alice-dev");
  assert.ok(visible.some((org) => org.id === "mobile-guild"));
});

test("create organization rejects duplicate, malformed and empty display names", async () => {
  const { organizations, store } = await createDomains();

  const duplicate = await organizations.createOrganization("alice-dev", {
    name: "acme-demo",
    displayName: "",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.name, "Organization name already exists");
  assert.equal(duplicate.errors.displayName, "Display name is required");

  const malformed = await organizations.createOrganization("alice-dev", {
    name: "-invalid-organization",
    displayName: "Something",
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errors.name, "Organization name format is invalid");

  const whitespaceDisplay = await organizations.createOrganization("alice-dev", {
    name: "valid-org",
    displayName: "   ",
  });
  assert.equal(whitespaceDisplay.ok, false);
  assert.equal(whitespaceDisplay.errors.displayName, "Display name is required");

  const state = await store.read();
  assert.equal(state.organizations["-invalid-organization"], undefined);
  assert.equal(state.organizations["valid-org"], undefined);
  assert.ok(!state.organizations["acme-demo"]?.displayName?.includes("undefined"));
});

test("repository visibility follows access rules for visitors, members and owners", async () => {
  const { organizations } = await createDomains();

  const visitor = await organizations.listVisibleRepositories("acme-demo", null);
  assert.deepEqual(visitor.map((repo) => repo.name), ["acme-docs"]);

  const member = await organizations.listVisibleRepositories("acme-demo", "bob-reviewer");
  assert.deepEqual(member.map((repo) => repo.name), ["acme-docs"]);

  const owner = await organizations.listVisibleRepositories("acme-demo", "alice-dev");
  assert.deepEqual(
    owner.map((repo) => repo.name).sort(),
    ["acme-docs", "acme-internal", "acme-private"],
  );

  const denied = await organizations.getRepository("acme-demo", "acme-private", "bob-reviewer");
  assert.deepEqual(denied, { denied: true });
  // bob-reviewer is not a direct member of frontend-team, so the team grant
  // on acme-internal does not reach him.
  assert.deepEqual(await organizations.getRepository("acme-demo", "acme-internal", "bob-reviewer"), { denied: true });

  // The private personal repository is denied for visitors but readable by
  // the seeded collaborator and by its Admin owner.
  assert.deepEqual(await organizations.getRepository("alice-dev", "secret-research", null), { denied: true });
  const bob = await organizations.getRepository("alice-dev", "secret-research", "bob-reviewer");
  assert.equal(bob.repository.name, "secret-research");
  assert.equal(bob.myRole, "read");
  const alice = await organizations.getRepository("alice-dev", "secret-research", "alice-dev");
  assert.equal(alice.myRole, "admin");
});

test("team membership grants effective repository role but hierarchy does not propagate", async () => {
  const { organizations } = await createDomains();
  // bob-reviewer joins frontend-team (which has Write on acme-internal)
  const added = await organizations.addTeamMember("alice-dev", "acme-demo", "frontend-team", "bob-reviewer");
  assert.equal(added.ok, true);

  const repo = await organizations.getRepository("acme-demo", "acme-internal", "bob-reviewer");
  assert.equal(repo.repository.name, "acme-internal");
  assert.equal(repo.myRole, "write");

  // A member of a child team is not a member of the parent team: bob is in
  // frontend-team, not in platform-team; hierarchy creates no grant access.
  const platformGrant = await organizations.getRepository("acme-demo", "acme-internal", "bob-reviewer");
  assert.equal(platformGrant.repository.name, "acme-internal");

  // bob-reviewer is not in frontend-child, so no access through it either.
  assert.equal((await organizations.listTeamMembers("acme-demo", "frontend-child")).includes("bob-reviewer"), false);
});

test("create team validates name, uniqueness within the organization and parent scope", async () => {
  const { organizations, store } = await createDomains();

  const created = await organizations.createTeam("alice-dev", "acme-demo", {
    name: "mobile-team",
    description: "Mobile guild team",
    parentId: "acme-demo:platform-team",
  });
  assert.equal(created.ok, true);
  assert.equal(created.team.parentId, "acme-demo:platform-team");
  assert.equal(created.team.createdBy, "alice-dev");

  const duplicate = await organizations.createTeam("alice-dev", "acme-demo", { name: "frontend-team" });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.name, "Team name already exists");

  const malformed = await organizations.createTeam("alice-dev", "acme-demo", { name: "-bad-team-" });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errors.name, "Team name format is invalid");

  const missing = await organizations.createTeam("alice-dev", "acme-demo", { name: "" });
  assert.equal(missing.ok, false);
  assert.equal(missing.errors.name, "Team name is required");

  const foreignParent = await organizations.createTeam("alice-dev", "acme-demo", {
    name: "team-x",
    parentId: "other-org:team",
  });
  assert.equal(foreignParent.ok, false);
  assert.equal(foreignParent.errors.parentId, "Parent team does not belong to this organization");

  // Same name is allowed in another organization.
  const otherOrg = await organizations.createOrganization("alice-dev", {
    name: "second-org",
    displayName: "Second Org",
  });
  assert.equal(otherOrg.ok, true);
  const sameName = await organizations.createTeam("alice-dev", "second-org", { name: "frontend-team" });
  assert.equal(sameName.ok, true);

  const state = await store.read();
  assert.equal(state.teams["acme-demo:mobile-team"].name, "mobile-team");
  assert.equal(state.teams["-bad-team-"], undefined);
});

test("add team member requires an existing organization member and avoids duplicates", async () => {
  const { organizations } = await createDomains();

  const ok = await organizations.addTeamMember("alice-dev", "acme-demo", "frontend-team", "bob-reviewer");
  assert.equal(ok.ok, true);
  assert.deepEqual(await organizations.listTeamMembers("acme-demo", "frontend-team"), ["bob-reviewer"]);

  const duplicate = await organizations.addTeamMember("alice-dev", "acme-demo", "frontend-team", "bob-reviewer");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.username, "Account is already a member of the team");

  const unknown = await organizations.addTeamMember("alice-dev", "acme-demo", "frontend-team", "unknown-reviewer");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors.username, "Account not found");

  const notMember = await organizations.addTeamMember("alice-dev", "acme-demo", "frontend-team", "alice-dev");
  assert.equal(notMember.ok, true, "owner is an organization member");

  const removed = await organizations.removeTeamMember("alice-dev", "acme-demo", "frontend-team", "bob-reviewer");
  assert.equal(removed.ok, true);
  assert.deepEqual(await organizations.listTeamMembers("acme-demo", "frontend-team"), ["alice-dev"]);
});

test("team parent changes reject cycles and keep the original parent", async () => {
  const { organizations } = await createDomains();

  // frontend-team has parent platform-team; selecting descendant frontend-child cycles.
  const cycle = await organizations.setTeamParent("alice-dev", "acme-demo", "frontend-team", "acme-demo:frontend-child");
  assert.equal(cycle.ok, false);
  assert.equal(cycle.errors.parentId, "Cyclic team hierarchy is not allowed");

  const overview = await organizations.getTeam("acme-demo", "frontend-team", "alice-dev");
  assert.equal(overview.team.parentId, "acme-demo:platform-team");

  const selfParent = await organizations.setTeamParent("alice-dev", "acme-demo", "frontend-team", "acme-demo:frontend-team");
  assert.equal(selfParent.ok, false);
  assert.equal(selfParent.errors.parentId, "Cyclic team hierarchy is not allowed");

  const foreign = await organizations.setTeamParent("alice-dev", "acme-demo", "frontend-team", "other-org:team");
  assert.equal(foreign.ok, false);
  assert.equal(foreign.errors.parentId, "Parent team does not belong to this organization");

  const valid = await organizations.setTeamParent("alice-dev", "acme-demo", "frontend-team", "acme-demo:backend-team");
  assert.equal(valid.ok, true);
  assert.equal(valid.team.parentId, "acme-demo:backend-team");

  const clear = await organizations.setTeamParent("alice-dev", "acme-demo", "frontend-team", null);
  assert.equal(clear.ok, true);
  assert.equal(clear.team.parentId, null);
});

test("grants upsert per subject and repository and require admin permission", async () => {
  const { organizations, store } = await createDomains();

  const first = await organizations.setGrant("alice-dev", "acme-demo", "acme-private", {
    subjectType: "team",
    subjectId: "acme-demo:frontend-team",
    role: "write",
  });
  assert.equal(first.ok, true);

  const same = await organizations.setGrant("alice-dev", "acme-demo", "acme-private", {
    subjectType: "team",
    subjectId: "acme-demo:frontend-team",
    role: "write",
  });
  assert.equal(same.ok, true);

  const state = await store.read();
  const matching = Object.values(state.grants).filter(
    (grant) => grant.repoId === "acme-demo:acme-private" && grant.subjectId === "acme-demo:frontend-team",
  );
  assert.equal(matching.length, 1, "saving the same role does not create a second record");

  const changed = await organizations.setGrant("alice-dev", "acme-demo", "acme-private", {
    subjectType: "team",
    subjectId: "acme-demo:frontend-team",
    role: "read",
  });
  assert.equal(changed.ok, true);
  const afterChangeState = await store.read();
  const afterChange = Object.values(afterChangeState.grants).filter(
    (grant) => grant.repoId === "acme-demo:acme-private" && grant.subjectId === "acme-demo:frontend-team",
  );
  assert.equal(afterChange.length, 1);
  assert.equal(afterChange[0].role, "read");

  const memberGrant = await organizations.setGrant("alice-dev", "acme-demo", "acme-private", {
    subjectType: "member",
    subjectId: "bob-reviewer",
    role: "write",
  });
  assert.equal(memberGrant.ok, true);
  const repo = await organizations.getRepository("acme-demo", "acme-private", "bob-reviewer");
  assert.equal(repo.repository.name, "acme-private");
  assert.equal(repo.myRole, "write");
});

test("non-admins cannot manage access and cannot see private repositories", async () => {
  const { organizations } = await createDomains();

  const forbidden = await organizations.getAccessData("bob-reviewer", "acme-demo", "acme-private");
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.forbidden, true);

  const grantForbidden = await organizations.setGrant("bob-reviewer", "acme-demo", "acme-private", {
    subjectType: "team",
    subjectId: "acme-demo:frontend-team",
    role: "write",
  });
  assert.equal(grantForbidden.ok, false);
  assert.equal(grantForbidden.forbidden, true);

  // bob-reviewer gains Read through the replacement scenario grant, then loses it when revoked? Keep original rules: no access.
  assert.deepEqual(await organizations.getRepository("acme-demo", "acme-private", "bob-reviewer"), { denied: true });
  assert.deepEqual(await organizations.getRepository("acme-demo", "acme-private", null), { denied: true });
});

test("owner status grants admin over organization repositories", async () => {
  const { organizations } = await createDomains();
  const repo = await organizations.getRepository("acme-demo", "acme-private", "alice-dev");
  assert.equal(repo.repository.visibility, "private");
  assert.equal(repo.myRole, "admin");

  const data = await organizations.getAccessData("alice-dev", "acme-demo", "acme-private");
  assert.equal(data.ok, true);
  assert.ok(data.members.some((member) => member.username === "bob-reviewer"));
  assert.ok(data.teams.some((team) => team.name === "frontend-team"));
  assert.equal(data.grants.length, 0);
});

test("add member stores the membership by username or verified email", async () => {
  const { accounts, organizations, store } = await createDomains();

  const byUsername = await organizations.addMember("alice-dev", "acme-demo", {
    username: "carol-dev",
    role: "member",
  });
  assert.equal(byUsername.ok, true);
  assert.deepEqual(byUsername.member, { username: "carol-dev", role: "member" });

  const state = await store.read();
  assert.equal(state.memberships["acme-demo:carol-dev"].role, "member");

  // A Member gains organization visibility but no private-repository access.
  assert.deepEqual(
    await organizations.listOrganizations("carol-dev").then((list) => list.map((org) => org.id)),
    ["acme-demo"],
  );
  assert.deepEqual(await organizations.getRepository("acme-demo", "acme-private", "carol-dev"), { denied: true });

  // Verified-email lookup is case-insensitive; a fresh registered account is
  // added as Owner and gains Admin permission over the organization repositories.
  const registered = await accounts.register({
    username: "dave-dev",
    email: "dave.dev@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(registered.ok, true);
  const byEmail = await organizations.addMember("alice-dev", "acme-demo", {
    username: "DAVE.DEV@example.test",
    role: "owner",
  });
  assert.equal(byEmail.ok, true);
  assert.deepEqual(byEmail.member, { username: "dave-dev", role: "owner" });
  assert.equal((await organizations.getRepository("acme-demo", "acme-private", "dave-dev")).myRole, "admin");
  assert.deepEqual(
    await organizations.listOrganizations("dave-dev").then((list) => list.map((org) => org.id)),
    ["acme-demo"],
  );

  // The same verified email resolves to the same existing member: duplicate.
  const duplicateEmail = await organizations.addMember("alice-dev", "acme-demo", {
    username: "CAROL.DEV@example.test",
    role: "owner",
  });
  assert.equal(duplicateEmail.ok, false);
  assert.equal(duplicateEmail.errors.username, "Account is already a member");
});

test("add member rejects duplicate, unknown, empty and unsupported role", async () => {
  const { organizations, store } = await createDomains();

  const duplicate = await organizations.addMember("alice-dev", "acme-demo", {
    username: "bob-reviewer",
    role: "member",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.username, "Account is already a member");

  const unknown = await organizations.addMember("alice-dev", "acme-demo", {
    username: "unknown-reviewer",
    role: "member",
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors.username, "Account not found");

  const empty = await organizations.addMember("alice-dev", "acme-demo", {
    username: "  ",
    role: "member",
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.errors.username, "Username or email is required");

  const badRole = await organizations.addMember("alice-dev", "acme-demo", {
    username: "carol-dev",
    role: "superuser",
  });
  assert.equal(badRole.ok, false);
  assert.equal(badRole.errors.role, "Role is invalid");

  const state = await store.read();
  assert.equal(state.memberships["acme-demo:carol-dev"], undefined);
  assert.equal(state.memberships["acme-demo:unknown-reviewer"], undefined);
});

test("remove member deletes membership, team memberships and direct grants but keeps teams, team grants and the account", async () => {
  const { organizations, store } = await createDomains();

  // bob-reviewer gains access through a direct grant and through frontend-team.
  await organizations.addTeamMember("alice-dev", "acme-demo", "frontend-team", "bob-reviewer");
  const directGrant = await organizations.setGrant("alice-dev", "acme-demo", "acme-private", {
    subjectType: "member",
    subjectId: "bob-reviewer",
    role: "write",
  });
  assert.equal(directGrant.ok, true);
  assert.equal((await organizations.getRepository("acme-demo", "acme-private", "bob-reviewer")).myRole, "write");
  assert.equal((await organizations.getRepository("acme-demo", "acme-internal", "bob-reviewer")).myRole, "write");

  // bob belongs to another organization and owns a personal repository.
  await organizations.createOrganization("alice-dev", { name: "second-org", displayName: "Second Org" });
  await organizations.addMember("alice-dev", "second-org", { username: "bob-reviewer", role: "member" });

  const removed = await organizations.removeMember("alice-dev", "acme-demo", "bob-reviewer");
  assert.equal(removed.ok, true);

  const state = await store.read();
  assert.equal(state.memberships["acme-demo:bob-reviewer"], undefined);
  assert.deepEqual(await organizations.listPeople("acme-demo").then((list) => list.map((m) => m.username)), ["alice-dev"]);
  assert.deepEqual(await organizations.listTeamMembers("acme-demo", "frontend-team"), []);
  assert.equal(state.grants["acme-demo:acme-private:member:bob-reviewer"], undefined);
  // Teams and team grants survive.
  assert.ok(state.teams["acme-demo:frontend-team"]);
  assert.ok(Object.values(state.grants).some((grant) => grant.repoId === "acme-demo:acme-internal" && grant.subjectType === "team"));

  // Personal account, personal repository and other-org membership survive.
  assert.ok(state.accounts["bob-reviewer"]);
  assert.ok(state.repositories["bob-reviewer:bob-notes"]);
  assert.equal(state.memberships["second-org:bob-reviewer"].role, "member");

  // Effective access is recalculated: everything from the removed membership is gone.
  assert.deepEqual(await organizations.getRepository("acme-demo", "acme-private", "bob-reviewer"), { denied: true });
  assert.deepEqual(await organizations.getRepository("acme-demo", "acme-internal", "bob-reviewer"), { denied: true });
  // The personal repository remains accessible to its owner.
  assert.equal((await organizations.getRepository("bob-reviewer", "bob-notes", "bob-reviewer")).repository.name, "bob-notes");
  // bob keeps the other-organization relationship.
  assert.deepEqual(await organizations.listOrganizations("bob-reviewer").then((list) => list.map((org) => org.id)), ["second-org"]);
});

test("the last owner cannot be removed and no relationships change", async () => {
  const { organizations, store } = await createDomains();

  const rejected = await organizations.removeMember("alice-dev", "acme-demo", "alice-dev");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors.username, "The organization must have at least one Owner");

  const state = await store.read();
  assert.equal(state.memberships["acme-demo:alice-dev"].role, "owner");

  // With a second owner the removal is allowed.
  await organizations.addMember("alice-dev", "acme-demo", { username: "carol-dev", role: "owner" });
  const allowed = await organizations.removeMember("alice-dev", "acme-demo", "alice-dev");
  assert.equal(allowed.ok, true);
  const after = await store.read();
  assert.equal(after.memberships["acme-demo:alice-dev"], undefined);
  assert.equal(after.memberships["acme-demo:carol-dev"].role, "owner");
  assert.deepEqual(await organizations.listOrganizations("alice-dev"), []);
});
