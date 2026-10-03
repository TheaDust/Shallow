import { hashPassword } from "./passwords.mjs";

const SEED_PASSWORD = "Valid-password-123!";

// Pre-provisioned verified and available accounts required by the scenarios.
// Identities stay stable across restarts; the shared password satisfies the
// REQ-1 password rules.
const SEED_ACCOUNTS = [
  { username: "alice-dev", email: "alice.dev@example.test" },
  { username: "recovery-visibility", email: "recovery-visibility@example.test" },
  { username: "recovery-invalid-code", email: "recovery-invalid-code@example.test" },
  { username: "recovery-success", email: "recovery-success@example.test" },
  { username: "password-change-success", email: "password-change-success@example.test" },
  { username: "password-change-invalid", email: "password-change-invalid@example.test" },
  { username: "password-change-required", email: "password-change-required@example.test" },
  // REQ-2 organization governance.
  { username: "org-owner", email: "org-owner@example.test" },
  { username: "team-maintainer", email: "team-maintainer@example.test" },
  { username: "bob-reviewer", email: "bob-reviewer@example.test" },
  // REQ-2-2 membership and REQ-2-3 repository access scenarios. `new-member`
  // owns an account but no organization membership; `unknown-reviewer`
  // deliberately has no account at all.
  { username: "new-member", email: "new-member@example.test" },
  { username: "existing-member", email: "existing-member@example.test" },
  { username: "org-member", email: "org-member@example.test" },
  { username: "protected-member", email: "protected-member@example.test" },
  { username: "repo-admin", email: "repo-admin@example.test" },
];

export const SEED_ACCOUNT_PASSWORD = SEED_PASSWORD;

export function createSeedAccounts() {
  return SEED_ACCOUNTS.map(({ username, email }) => ({
    id: `account-${username}`,
    username,
    email,
    emailVerified: true,
    status: "available",
    password: hashPassword(SEED_PASSWORD),
    createdAt: "2024-01-01T00:00:00.000Z",
  }));
}

// Pre-provisioned organization `Acme Demo`: owner accounts, one plain member,
// three teams forming platform-team > frontend-team > frontend-child, and the
// public/private repository pair used by the browse scenarios.
const ACME_DEMO_ID = "org-acme-demo";
const ACME_DEMO_CREATED_AT = "2024-01-02T00:00:00.000Z";

export function createSeedOrganizationState() {
  return {
    organizations: [
      {
        id: ACME_DEMO_ID,
        name: "acme-demo",
        displayName: "Acme Demo",
        createdAt: ACME_DEMO_CREATED_AT,
      },
    ],
    memberships: [
      { id: "membership-acme-demo-org-owner", organizationId: ACME_DEMO_ID, accountId: "account-org-owner", role: "owner", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-team-maintainer", organizationId: ACME_DEMO_ID, accountId: "account-team-maintainer", role: "owner", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-bob-reviewer", organizationId: ACME_DEMO_ID, accountId: "account-bob-reviewer", role: "member", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-existing-member", organizationId: ACME_DEMO_ID, accountId: "account-existing-member", role: "member", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-org-member", organizationId: ACME_DEMO_ID, accountId: "account-org-member", role: "member", createdAt: ACME_DEMO_CREATED_AT },
      { id: "membership-acme-demo-protected-member", organizationId: ACME_DEMO_ID, accountId: "account-protected-member", role: "member", createdAt: ACME_DEMO_CREATED_AT },
    ],
    teams: [
      { id: "team-acme-demo-platform-team", organizationId: ACME_DEMO_ID, name: "platform-team", parentTeamId: null, createdAt: ACME_DEMO_CREATED_AT },
      { id: "team-acme-demo-frontend-team", organizationId: ACME_DEMO_ID, name: "frontend-team", parentTeamId: "team-acme-demo-platform-team", createdAt: ACME_DEMO_CREATED_AT },
      { id: "team-acme-demo-frontend-child", organizationId: ACME_DEMO_ID, name: "frontend-child", parentTeamId: "team-acme-demo-frontend-team", createdAt: ACME_DEMO_CREATED_AT },
      { id: "team-acme-demo-access-role-team", organizationId: ACME_DEMO_ID, name: "access-role-team", parentTeamId: null, createdAt: ACME_DEMO_CREATED_AT },
    ],
    teamMemberships: [],
    // Direct repository grants. `repo-admin` administers `acme-docs` through a
    // direct Admin grant (no organization membership needed); `acme-docs`
    // starts without any grant to `frontend-team`; `access-role-team` already
    // holds exactly one direct Write grant so its role can be changed in place.
    repositoryGrants: [
      { id: "grant-acme-docs-repo-admin", repositoryId: "repo-acme-demo-acme-docs", accountId: "account-repo-admin", role: "admin", createdAt: ACME_DEMO_CREATED_AT },
      { id: "grant-acme-docs-access-role-team", repositoryId: "repo-acme-demo-acme-docs", teamId: "team-acme-demo-access-role-team", role: "write", createdAt: ACME_DEMO_CREATED_AT },
    ],
    repositories: [
      {
        id: "repo-acme-demo-acme-docs",
        organizationId: ACME_DEMO_ID,
        name: "acme-docs",
        description: "Public documentation for Acme products",
        visibility: "public",
        createdAt: ACME_DEMO_CREATED_AT,
        updatedAt: "2024-03-01T10:00:00.000Z",
      },
      {
        id: "repo-acme-demo-secret-research",
        organizationId: ACME_DEMO_ID,
        name: "secret-research",
        description: "Confidential research notes for the Acme team",
        visibility: "private",
        createdAt: ACME_DEMO_CREATED_AT,
        updatedAt: "2024-03-02T10:00:00.000Z",
      },
    ],
  };
}
