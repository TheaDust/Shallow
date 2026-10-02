import { randomUUID } from "node:crypto";

import { findAccountByEmail, findAccountByUsername, hashPassword } from "./identity.mjs";
import { ORGANIZATION_ROLE_MEMBER, ORGANIZATION_ROLE_OWNER } from "./organizations.mjs";

/**
 * Shared seed accounts. Every account is verified and available, and is stored
 * with a sign-in capable credential. Later stages append their own accounts and
 * relationships here without touching existing entries.
 */
export const SEED_ACCOUNTS = [
  {
    username: "alice-dev",
    email: "alice.dev@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "recovery-visibility",
    email: "recovery-visibility@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "recovery-invalid-code",
    email: "recovery-invalid-code@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "recovery-success",
    email: "recovery-success@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "password-change-success",
    email: "password-change-success@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "password-change-invalid",
    email: "password-change-invalid@example.test",
    password: "Valid-password-123!",
  },
  {
    username: "password-change-required",
    email: "password-change-required@example.test",
    password: "Valid-password-123!",
  },
  {
    // Owner of the seeded organization; verified and able to create organizations.
    username: "org-owner",
    email: "org-owner@example.test",
    password: "Valid-password-123!",
  },
  {
    // Second Owner of the seeded organization; manages teams in the same organization.
    username: "team-maintainer",
    email: "team-maintainer@example.test",
    password: "Valid-password-123!",
  },
  {
    // Registered organization member available as a candidate for team membership.
    username: "bob-reviewer",
    email: "bob-reviewer@example.test",
    password: "Valid-password-123!",
  },
  {
    // Registered account that is not a member yet; can be added by an Owner.
    username: "new-member",
    email: "new-member@example.test",
    password: "Valid-password-123!",
  },
  {
    // Existing ordinary member of the seeded organization.
    username: "existing-member",
    email: "existing-member@example.test",
    password: "Valid-password-123!",
  },
  {
    // Ordinary non-Owner member of the seeded organization.
    username: "org-member",
    email: "org-member@example.test",
    password: "Valid-password-123!",
  },
  {
    // Another ordinary member of the seeded organization.
    username: "protected-member",
    email: "protected-member@example.test",
    password: "Valid-password-123!",
  },
  {
    // Holds the repository Admin role on the seeded repository `acme-docs` and
    // may therefore manage that repository's access list.
    username: "repo-admin",
    email: "repo-admin@example.test",
    password: "Valid-password-123!",
  },
];

/**
 * Seed organization with its repository catalogue and team hierarchy. `name` is
 * the organization's unique name (also the overview heading), `slug` its URL
 * identifier and `displayName` the human-readable name shown in lists. A team's
 * optional `parent` names another team of the same organization.
 */
export const SEED_ORGANIZATIONS = [
  {
    slug: "acme-demo",
    name: "Acme Demo",
    displayName: "Acme Demo",
    owners: ["org-owner", "team-maintainer"],
    // repo-admin holds the repository Admin role below and is a plain member of
    // the organization, so the organization (with that repository) is reachable
    // through "Your organizations" while membership alone grants no other access.
    members: ["repo-admin", "bob-reviewer", "existing-member", "org-member", "protected-member"],
    teams: [
      { name: "platform-team" },
      { name: "frontend-team", parent: "platform-team" },
      { name: "frontend-child", parent: "frontend-team" },
      { name: "access-role-team" },
    ],
    repositories: [
      {
        name: "acme-docs",
        description: "Documentation, guides and release notes for Acme Demo.",
        visibility: "public",
        updatedAt: "2024-05-02T09:30:00.000Z",
        // Direct access grants present before the access-management scenarios:
        // repo-admin holds the repository Admin role while access-role-team holds
        // exactly one Write grant. frontend-team deliberately has no grant yet.
        grants: [
          { account: "repo-admin", role: "admin" },
          { team: "access-role-team", role: "write" },
        ],
      },
      {
        name: "secret-research",
        description: "Confidential research notes, visible to authorized members only.",
        visibility: "private",
        updatedAt: "2024-05-03T11:15:00.000Z",
      },
    ],
  },
];

export function createSeedAccount(seed) {
  const { salt, hash } = hashPassword(seed.password);
  return {
    id: seed.id ?? `seed-${seed.username}`,
    username: seed.username,
    email: seed.email,
    emailVerified: seed.emailVerified ?? true,
    status: seed.status ?? "available",
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: seed.createdAt ?? "2024-01-01T00:00:00.000Z",
  };
}

/**
 * Adds any missing seed account while leaving existing accounts (and any user
 * changes to them) untouched.
 */
export function ensureSeedAccounts(state) {
  state.accounts = Array.isArray(state.accounts) ? state.accounts : [];
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  for (const seed of SEED_ACCOUNTS) {
    if (findAccountByUsername(state, seed.username) || findAccountByEmail(state, seed.email)) continue;
    state.accounts.push(createSeedAccount(seed));
  }
}

/**
 * Adds the seed organizations with their memberships and repositories. Existing
 * organizations, relationships and user changes are left untouched.
 */
export function ensureSeedOrganizations(state) {
  state.organizations = Array.isArray(state.organizations) ? state.organizations : [];
  state.organizationMembers = Array.isArray(state.organizationMembers) ? state.organizationMembers : [];
  state.repositories = Array.isArray(state.repositories) ? state.repositories : [];
  state.repositoryGrants = Array.isArray(state.repositoryGrants) ? state.repositoryGrants : [];
  state.teams = Array.isArray(state.teams) ? state.teams : [];
  state.teamMembers = Array.isArray(state.teamMembers) ? state.teamMembers : [];

  for (const seed of SEED_ORGANIZATIONS) {
    let organization = state.organizations.find((candidate) => candidate.slug === seed.slug);
    const isNewOrganization = !organization;
    if (!organization) {
      organization = {
        id: `seed-org-${seed.slug}`,
        slug: seed.slug,
        name: seed.name,
        displayName: seed.displayName,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      state.organizations.push(organization);
    }

    // Membership relationships are written together with the organization and
    // only then: a member a user removed must never come back after a restart.
    if (isNewOrganization) {
      const rolesByUsername = [
        ...seed.owners.map((username) => ({ username, role: ORGANIZATION_ROLE_OWNER })),
        ...seed.members.map((username) => ({ username, role: ORGANIZATION_ROLE_MEMBER })),
      ];
      for (const { username, role } of rolesByUsername) {
        const account = findAccountByUsername(state, username);
        if (!account) continue;
        state.organizationMembers.push({
          id: randomUUID(),
          organizationId: organization.id,
          accountId: account.id,
          role,
          createdAt: "2024-01-01T00:00:00.000Z",
        });
      }
    }

    const createdTeams = [];
    for (const team of seed.teams ?? []) {
      const existing = state.teams.find((candidate) => (
        candidate.organizationId === organization.id && candidate.name === team.name
      ));
      if (existing) continue;
      const created = {
        id: `seed-team-${seed.slug}-${team.name}`,
        organizationId: organization.id,
        name: team.name,
        parentTeamId: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      state.teams.push(created);
      createdTeams.push({ created, parentName: team.parent });
    }

    // Parents are linked once, right after the teams of this seed are stored, so
    // a later user change to the hierarchy survives a restart.
    for (const { created, parentName } of createdTeams) {
      if (!parentName) continue;
      const parent = state.teams.find((candidate) => (
        candidate.organizationId === organization.id && candidate.name === parentName
      ));
      if (parent) created.parentTeamId = parent.id;
    }

    const createdRepositories = [];
    for (const repository of seed.repositories) {
      const existing = state.repositories.find((candidate) => (
        candidate.organizationId === organization.id && candidate.name === repository.name
      ));
      if (existing) continue;
      const created = {
        id: `seed-repo-${seed.slug}-${repository.name}`,
        organizationId: organization.id,
        name: repository.name,
        description: repository.description,
        visibility: repository.visibility,
        updatedAt: repository.updatedAt,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      state.repositories.push(created);
      createdRepositories.push({ created, grants: repository.grants ?? [] });
    }

    // Access grants are written once, with the repository they belong to: a role
    // a user later changes must survive a restart instead of being re-seeded.
    for (const { created, grants } of createdRepositories) {
      for (const grant of grants) {
        const principal = grant.team
          ? { teamId: state.teams.find((candidate) => (
            candidate.organizationId === organization.id && candidate.name === grant.team
          ))?.id }
          : { accountId: findAccountByUsername(state, grant.account)?.id };
        if (!principal.teamId && !principal.accountId) continue;
        state.repositoryGrants.push({
          id: `seed-grant-${seed.slug}-${created.name}-${grant.team ?? grant.account}`,
          repositoryId: created.id,
          role: grant.role,
          createdAt: "2024-01-01T00:00:00.000Z",
          ...principal,
        });
      }
    }
  }
}

/** Applies every seed group once, before the first read of a fresh data dir. */
export function ensureSeedData(state) {
  ensureSeedAccounts(state);
  ensureSeedOrganizations(state);
}
