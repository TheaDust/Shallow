import { randomUUID } from "node:crypto";

import { hashPassword } from "./accounts.mjs";

/**
 * Pre-provisioned accounts required by the acceptance scenarios. They are
 * written into empty storage on first use; later restarts keep the stored
 * state (including user modifications) untouched.
 */
export const SEED_ACCOUNTS = [
  { username: "alice-dev", email: "alice.dev@example.test", password: "Valid-password-123!" },
  { username: "recovery-visibility", email: "recovery-visibility@example.test", password: "Valid-password-123!" },
  { username: "recovery-invalid-code", email: "recovery-invalid-code@example.test", password: "Valid-password-123!" },
  { username: "recovery-success", email: "recovery-success@example.test", password: "Valid-password-123!" },
  { username: "password-change-success", email: "password-change-success@example.test", password: "Valid-password-123!" },
  { username: "password-change-invalid", email: "password-change-invalid@example.test", password: "Valid-password-123!" },
  { username: "password-change-required", email: "password-change-required@example.test", password: "Valid-password-123!" },
  { username: "org-owner", email: "org-owner@example.test", password: "Valid-password-123!" },
  { username: "team-maintainer", email: "team-maintainer@example.test", password: "Valid-password-123!" },
  { username: "bob-reviewer", email: "bob-reviewer@example.test", password: "Valid-password-123!" },
  { username: "new-member", email: "new-member@example.test", password: "Valid-password-123!" },
  { username: "existing-member", email: "existing-member@example.test", password: "Valid-password-123!" },
  { username: "org-member", email: "org-member@example.test", password: "Valid-password-123!" },
  { username: "protected-member", email: "protected-member@example.test", password: "Valid-password-123!" },
  { username: "repo-admin", email: "repo-admin@example.test", password: "Valid-password-123!" },
];

/**
 * Organization, team and repository seed data. The organization's `slug` is the
 * globally unique identifier used in URLs; `displayName` is the human name shown
 * on links (e.g. “Acme Demo”). Parents are resolved after all teams exist.
 */
export const SEED_ORGANIZATIONS = [
  {
    slug: "acme-demo",
    displayName: "Acme Demo",
    members: [
      { username: "org-owner", role: "owner" },
      { username: "team-maintainer", role: "owner" },
      { username: "bob-reviewer", role: "member" },
      { username: "existing-member", role: "member" },
      { username: "org-member", role: "member" },
      { username: "protected-member", role: "member" },
    ],
    teams: [
      { slug: "platform-team", parent: null },
      { slug: "frontend-team", parent: "platform-team" },
      { slug: "frontend-child", parent: "frontend-team" },
      { slug: "access-role-team", parent: null },
    ],
    repositories: [
      {
        name: "acme-docs",
        description: "Public product documentation for ACME.",
        visibility: "public",
        updatedAt: "2024-05-01T10:00:00.000Z",
        grants: [
          { type: "account", name: "repo-admin", role: "admin" },
          { type: "team", name: "access-role-team", role: "write" },
        ],
      },
      {
        name: "secret-research",
        description: "Private research notes for ACME.",
        visibility: "private",
        updatedAt: "2024-06-15T09:30:00.000Z",
      },
    ],
  },
];

export function createSeedAccount(seed) {
  return {
    id: randomUUID(),
    username: seed.username,
    email: seed.email,
    emailVerified: true,
    status: "available",
    passwordHash: hashPassword(seed.password),
    createdAt: new Date().toISOString(),
  };
}

function seedOrganizations(state) {
  for (const seed of SEED_ORGANIZATIONS) {
    let organization = state.organizations.find((candidate) => candidate.slug === seed.slug);
    if (!organization) {
      organization = {
        id: randomUUID(),
        slug: seed.slug,
        displayName: seed.displayName,
        createdAt: new Date().toISOString(),
      };
      state.organizations.push(organization);
    }

    // Organization memberships are written once per organization: a membership
    // the Owner later removes must stay removed across restarts, while a data
    // document created by an earlier stage still gains the current seed members.
    if (!organization.seededMembers) {
      for (const member of seed.members ?? []) {
        const account = state.accounts.find((candidate) => candidate.username === member.username);
        if (!account) continue;
        const exists = state.memberships.some(
          (candidate) => candidate.organizationId === organization.id && candidate.accountId === account.id,
        );
        if (!exists) {
          state.memberships.push({
            id: randomUUID(),
            organizationId: organization.id,
            accountId: account.id,
            role: member.role,
            createdAt: new Date().toISOString(),
          });
        }
      }
      organization.seededMembers = true;
    }

    for (const team of seed.teams ?? []) {
      const exists = state.teams.some(
        (candidate) => candidate.organizationId === organization.id && candidate.slug === team.slug,
      );
      if (!exists) {
        state.teams.push({
          id: randomUUID(),
          organizationId: organization.id,
          slug: team.slug,
          parentTeamId: null,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Resolve parents after the whole team list exists so order never matters.
    for (const team of seed.teams ?? []) {
      if (!team.parent) continue;
      const child = state.teams.find(
        (candidate) => candidate.organizationId === organization.id && candidate.slug === team.slug,
      );
      const parent = state.teams.find(
        (candidate) => candidate.organizationId === organization.id && candidate.slug === team.parent,
      );
      if (child && parent && child.parentTeamId !== parent.id) child.parentTeamId = parent.id;
    }

    for (const repository of seed.repositories ?? []) {
      const stored = state.repositories.find(
        (candidate) => candidate.organizationId === organization.id && candidate.name === repository.name,
      );
      if (!stored) {
        state.repositories.push({
          id: randomUUID(),
          organizationId: organization.id,
          name: repository.name,
          description: repository.description,
          visibility: repository.visibility,
          updatedAt: repository.updatedAt,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Access grants are topped up after teams, accounts and repositories exist.
    for (const repository of seed.repositories ?? []) {
      const stored = state.repositories.find(
        (candidate) => candidate.organizationId === organization.id && candidate.name === repository.name,
      );
      if (!stored) continue;
      for (const grant of repository.grants ?? []) {
        const subjectId = grant.type === "team"
          ? state.teams.find((team) => team.organizationId === organization.id && team.slug === grant.name)?.id
          : state.accounts.find((account) => account.username === grant.name)?.id;
        if (!subjectId) continue;
        const exists = state.repositoryGrants.some(
          (candidate) => candidate.repositoryId === stored.id
            && candidate.subjectType === grant.type
            && candidate.subjectId === subjectId,
        );
        if (!exists) {
          state.repositoryGrants.push({
            id: randomUUID(),
            repositoryId: stored.id,
            subjectType: grant.type,
            subjectId,
            role: grant.role,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }
}

export async function ensureSeeded(store) {
  await store.update((state) => {
    for (const key of ["accounts", "sessions", "organizations", "memberships", "teams", "teamMembers", "repositories", "repositoryGrants"]) {
      if (!Array.isArray(state[key])) state[key] = [];
    }

    // Top up any missing seed account without touching existing records, so a
    // storage document seeded by an earlier stage still gains new accounts and
    // restarts keep user registrations and password changes intact.
    for (const seed of SEED_ACCOUNTS) {
      const exists = state.accounts.some((account) => account.username === seed.username);
      if (!exists) state.accounts.push(createSeedAccount(seed));
    }

    seedOrganizations(state);

    if (!state.seededAt) state.seededAt = new Date().toISOString();
  });
}
