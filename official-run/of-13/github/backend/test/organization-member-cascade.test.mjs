import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationService } from "../src/lib/organizations.mjs";
import { createInitialState } from "../src/lib/seed.mjs";

// The repository grant endpoints arrive with a later module, so the removal
// cascade on stored grants is verified against the same service the HTTP API
// uses, with the grant written straight into the persisted state.
function memoryStore(initial) {
  let state = structuredClone(initial);
  return {
    async read() {
      return structuredClone(state);
    },
    async update(mutator) {
      const draft = structuredClone(state);
      const returned = await mutator(draft);
      state = returned === undefined ? draft : returned;
      return structuredClone(state);
    },
    snapshot() {
      return structuredClone(state);
    },
  };
}

test("removing a member deletes direct grants on this organization's repositories only", async () => {
  const initial = createInitialState();
  initial.repositoryGrants.push(
    {
      id: "grant-bob-secret",
      repositoryId: "repository-acme-demo-secret-research",
      subjectType: "account",
      subjectId: "account-bob-reviewer",
      role: "read",
    },
    {
      id: "grant-team-secret",
      repositoryId: "repository-acme-demo-secret-research",
      subjectType: "team",
      subjectId: "team-acme-demo-frontend-team",
      role: "write",
    },
    {
      id: "grant-bob-personal",
      repositoryId: "repository-bob-reviewer-bob-notes",
      subjectType: "account",
      subjectId: "account-bob-reviewer",
      role: "admin",
    },
  );
  initial.teamMembers.push({
    id: "team-member-bob-frontend",
    teamId: "team-acme-demo-frontend-team",
    accountId: "account-bob-reviewer",
  });

  const store = memoryStore(initial);
  const organizations = createOrganizationService(store);
  const outcome = await organizations.removeMember(
    "acme-demo",
    "account-alice-dev",
    "bob-reviewer",
  );
  assert.deepEqual(outcome, { ok: true });

  const state = store.snapshot();
  assert.equal(
    state.memberships.some((membership) => membership.accountId === "account-bob-reviewer"),
    false,
  );
  assert.equal(
    state.teamMembers.some((teamMember) => teamMember.accountId === "account-bob-reviewer"),
    false,
  );
  // Direct grants on this organization's repositories are gone; the team
  // grants (including the seeded one) and the personal repository grant stay.
  assert.deepEqual(
    state.repositoryGrants.map((grant) => grant.id).sort(),
    [
      "grant-acme-docs-carol-maintainer-maintain",
      "grant-acme-docs-platform-team-write",
      "grant-bob-personal",
      "grant-team-secret",
    ],
  );
  // Teams, the account and its personal repository survive.
  assert.equal(state.teams.length, 4);
  assert.ok(state.accounts.some((account) => account.id === "account-bob-reviewer"));
  assert.ok(
    state.repositories.some((repository) => repository.id === "repository-bob-reviewer-bob-notes"),
  );
});

test("a failed last-Owner removal leaves every relationship unchanged", async () => {
  const store = memoryStore(createInitialState());
  const organizations = createOrganizationService(store);
  const before = store.snapshot();

  const outcome = await organizations.removeMember(
    "acme-demo",
    "account-alice-dev",
    "alice-dev",
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.fieldErrors.username, "Organization must have at least one Owner");
  assert.deepEqual(store.snapshot(), before);
});
