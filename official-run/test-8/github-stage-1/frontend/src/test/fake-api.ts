import { vi } from "vitest";

/**
 * Minimal in-memory stand-in for the account and organization API. It exists
 * only to drive the frontend flows under test; the real input rules and
 * persistence are checked against the backend (see backend/test/*.test.mjs).
 */
export interface FakeAccount {
  id: string;
  username: string;
  email: string;
  password: string;
}

export interface FakeTeam {
  id: string;
  slug: string;
  parent: string | null;
}

export interface FakeRepository {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  updatedAt: string;
}

export interface FakeGrant {
  id: string;
  repositoryName: string;
  subjectType: "account" | "team";
  subjectName: string;
  role: string;
}

export interface FakeOrganization {
  id: string;
  slug: string;
  displayName: string;
  members: Array<{ accountId: string; role: "owner" | "member" }>;
  teams: FakeTeam[];
  teamMembers: Array<{ teamSlug: string; accountId: string }>;
  repositories: FakeRepository[];
  repositoryGrants: FakeGrant[];
}

export interface FakeOrganizationSeed {
  slug: string;
  displayName: string;
  members: Array<{ username: string; role: "owner" | "member" }>;
  teams: Array<{ slug: string; parent: string | null }>;
  repositories: Array<{
    name: string;
    description: string;
    visibility: "public" | "private";
    updatedAt: string;
    grants?: Array<{ type: "account" | "team"; name: string; role: string }>;
  }>;
}

/** Mirrors the real seed accounts used by the acceptance scenarios. */
export const DEFAULT_ACCOUNTS: FakeAccount[] = [
  { id: "account-alice", username: "alice-dev", email: "alice.dev@example.test", password: "Valid-password-123!" },
  { id: "account-org-owner", username: "org-owner", email: "org-owner@example.test", password: "Valid-password-123!" },
  { id: "account-team-maintainer", username: "team-maintainer", email: "team-maintainer@example.test", password: "Valid-password-123!" },
  { id: "account-bob", username: "bob-reviewer", email: "bob-reviewer@example.test", password: "Valid-password-123!" },
  { id: "account-new-member", username: "new-member", email: "new-member@example.test", password: "Valid-password-123!" },
  { id: "account-existing-member", username: "existing-member", email: "existing-member@example.test", password: "Valid-password-123!" },
  { id: "account-org-member", username: "org-member", email: "org-member@example.test", password: "Valid-password-123!" },
  { id: "account-protected-member", username: "protected-member", email: "protected-member@example.test", password: "Valid-password-123!" },
  { id: "account-repo-admin", username: "repo-admin", email: "repo-admin@example.test", password: "Valid-password-123!" },
];

/** Mirrors the real seed organization used by the acceptance scenarios. */
export const DEFAULT_ORGANIZATIONS: FakeOrganizationSeed[] = [
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
      { name: "secret-research", description: "Private research notes for ACME.", visibility: "private", updatedAt: "2024-06-15T09:30:00.000Z" },
    ],
  },
];

export interface FakeApi {
  accounts: FakeAccount[];
  organizations: FakeOrganization[];
  signedInId: string | null;
  registrationBodies: Array<Record<string, unknown>>;
  signOutCount: number;
}

export interface FakeApiOptions {
  organizations?: FakeOrganizationSeed[];
}

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const ORG_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEAM_NAME_PATTERN = /^[a-z0-9-]+$/;

export function installFakeApi(seed: FakeAccount[] = [], options: FakeApiOptions = {}): FakeApi {
  const api: FakeApi = {
    accounts: seed.map((account) => ({ ...account })),
    organizations: [],
    signedInId: null,
    registrationBodies: [],
    signOutCount: 0,
  };

  for (const [index, organization] of (options.organizations ?? []).entries()) {
    const organizationId = `org-${index + 1}`;
    const repositories = organization.repositories.map((repository, repoIndex) => ({
      id: `repo-${index + 1}-${repoIndex + 1}`,
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility,
      updatedAt: repository.updatedAt,
    }));
    const repositoryGrants = organization.repositories.flatMap((repository, repoIndex) =>
      (repository.grants ?? []).map((grant, grantIndex) => ({
        id: `grant-${index + 1}-${repoIndex + 1}-${grantIndex + 1}`,
        repositoryName: repository.name,
        subjectType: grant.type,
        subjectName: grant.name,
        role: grant.role,
      })),
    );
    api.organizations.push({
      id: organizationId,
      slug: organization.slug,
      displayName: organization.displayName,
      members: organization.members
        .map((member) => {
          const account = api.accounts.find((candidate) => candidate.username === member.username);
          return account ? { accountId: account.id, role: member.role } : null;
        })
        .filter((member): member is { accountId: string; role: "owner" | "member" } => member !== null),
      teams: organization.teams.map((team, teamIndex) => ({ id: `team-${index + 1}-${teamIndex + 1}`, slug: team.slug, parent: team.parent })),
      teamMembers: [],
      repositories,
      repositoryGrants,
    });
  }

  const publicAccount = (account: FakeAccount) => ({
    id: account.id,
    username: account.username,
    email: account.email,
    emailVerified: true,
  });

  const currentAccount = () => api.accounts.find((candidate) => candidate.id === api.signedInId) ?? null;

  const currentOrganization = (slug: string) => api.organizations.find((organization) => organization.slug === slug) ?? null;

  const membership = (organization: FakeOrganization) =>
    organization.members.find((member) => member.accountId === api.signedInId) ?? null;

  const organizationSummary = (organization: FakeOrganization) => ({
    id: organization.id,
    slug: organization.slug,
    displayName: organization.displayName,
    role: membership(organization)?.role ?? null,
  });

  const accountIdOf = (username: string) => api.accounts.find((candidate) => candidate.username === username)?.id ?? null;

  /** Effective repository role, mirroring the backend access rules. */
  const repositoryRole = (organization: FakeOrganization, repository: FakeRepository): string | null => {
    if (membership(organization)?.role === "owner") return "admin";
    const grants = organization.repositoryGrants.filter((grant) => grant.repositoryName === repository.name);
    const direct = grants.find(
      (grant) => grant.subjectType === "account" && accountIdOf(grant.subjectName) === api.signedInId,
    );
    if (direct) return direct.role;
    const myTeams = new Set(
      organization.teamMembers
        .filter((teamMember) => teamMember.accountId === api.signedInId)
        .map((teamMember) => teamMember.teamSlug),
    );
    const teamGrant = grants.find((grant) => grant.subjectType === "team" && myTeams.has(grant.subjectName));
    return teamGrant?.role ?? null;
  };

  const canRead = (organization: FakeOrganization, repository: FakeRepository) =>
    repository.visibility === "public" || repositoryRole(organization, repository) !== null;

  const repositoryPayload = (organization: FakeOrganization, repository: FakeRepository) => ({
    id: repository.id,
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility,
    updatedAt: repository.updatedAt,
    organization: { slug: organization.slug, displayName: organization.displayName },
    role: repositoryRole(organization, repository),
  });

  const accessPayload = (organization: FakeOrganization, repository: FakeRepository) => ({
    repository: repositoryPayload(organization, repository),
    access: organization.repositoryGrants
      .filter((grant) => grant.repositoryName === repository.name)
      .map((grant) => ({
        id: grant.id,
        subjectType: grant.subjectType,
        subjectName: grant.subjectName,
        role: grant.role,
      }))
      .sort((left, right) => left.subjectName.localeCompare(right.subjectName)),
    candidates: {
      teams: organization.teams.map((team) => team.slug).sort(),
      accounts: organization.members
        .map((member) => api.accounts.find((candidate) => candidate.id === member.accountId)?.username ?? "")
        .filter(Boolean)
        .sort(),
    },
  });

  const peoplePayload = (organization: FakeOrganization) => ({
    organization: organizationSummary(organization),
    people: organization.members
      .map((entry) => {
        const account = api.accounts.find((candidate) => candidate.id === entry.accountId);
        return account ? { username: account.username, email: account.email, role: entry.role === "owner" ? "Owner" : "Member" } : null;
      })
      .filter(Boolean),
  });

  const teamPayload = (organization: FakeOrganization, team: FakeTeam) => ({ id: team.id, slug: team.slug, parent: team.parent });

  const registrationErrors = (body: Record<string, unknown>) => {
    const fields: Record<string, string> = {};
    const username = String(body.username ?? "").trim();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    if (api.accounts.some((account) => account.username === username)) {
      fields.username = "Username already exists";
    } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(username)) {
      fields.username = "Username format is invalid";
    }
    if (!email.includes("@") || !email.split("@")[1]?.includes(".")) fields.email = "Email format is invalid";
    if (password.length < 12) fields.password = "Password requirements are not satisfied";
    else if (password !== body.confirmPassword) fields.confirmPassword = "Password confirmation does not match";
    if (body.agreeToTerms !== true) fields.terms = "Agree to terms is required";
    return fields;
  };

  const handler = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<FakeResponse> => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const segments = url.split("/").filter(Boolean);

    if (url === "/api/session" && method === "GET") {
      return jsonResponse(200, { account: currentAccount() ? publicAccount(currentAccount()!) : null });
    }
    if (url === "/api/session" && method === "POST") {
      const account = api.accounts.find(
        (candidate) =>
          (candidate.username === body.identifier || candidate.email === body.identifier) &&
          candidate.password === body.password,
      );
      if (!account) return jsonResponse(401, { error: "Invalid credentials" });
      api.signedInId = account.id;
      return jsonResponse(200, { account: publicAccount(account) });
    }
    if (url === "/api/session" && method === "DELETE") {
      api.signedInId = null;
      api.signOutCount += 1;
      return jsonResponse(200, { ok: true });
    }
    if (url === "/api/accounts" && method === "POST") {
      api.registrationBodies.push(body);
      const fields = registrationErrors(body);
      if (Object.keys(fields).length > 0) return jsonResponse(400, { error: "Registration failed", fields });
      const account: FakeAccount = {
        id: `account-${api.accounts.length + 1}`,
        username: String(body.username).trim(),
        email: String(body.email).trim(),
        password: String(body.password),
      };
      api.accounts.push(account);
      return jsonResponse(201, { account: publicAccount(account) });
    }
    if (url === "/api/password/change" && method === "POST") {
      const account = currentAccount();
      if (!account) return jsonResponse(401, { error: "Authentication required" });
      const currentPassword = String(body.currentPassword ?? "");
      const newPassword = String(body.newPassword ?? "");
      if (currentPassword.length === 0) {
        return jsonResponse(400, { error: "Password change failed", fields: { currentPassword: "Current password is required" } });
      }
      if (account.password !== currentPassword) {
        return jsonResponse(400, { error: "Password change failed", fields: { currentPassword: "Current password is incorrect" } });
      }
      if (newPassword.length < 12) {
        return jsonResponse(400, { error: "Password change failed", fields: { newPassword: "Password requirements are not satisfied" } });
      }
      if (newPassword !== String(body.confirmPassword ?? "")) {
        return jsonResponse(400, { error: "Password change failed", fields: { confirmPassword: "Password confirmation does not match" } });
      }
      account.password = newPassword;
      api.signedInId = null;
      return jsonResponse(200, { message: "Password updated" });
    }
    if (url === "/api/password/forgot" && method === "POST") {
      return jsonResponse(200, { email: body.email, verificationCode: "123456" });
    }
    if (url === "/api/password/reset" && method === "POST") {
      if (String(body.code) !== "123456") {
        return jsonResponse(400, { error: "Password reset failed", fields: { code: "Verification code is invalid" } });
      }
      if (String(body.newPassword).length < 12) {
        return jsonResponse(400, { error: "Password reset failed", fields: { password: "Password requirements are not satisfied" } });
      }
      const account = api.accounts.find((candidate) => candidate.email === body.email);
      if (account) account.password = String(body.newPassword);
      return jsonResponse(200, { message: "Password updated" });
    }

    // ------------------------------------------------------- organizations --
    if (url === "/api/public/organizations" && method === "GET") {
      const organizations = api.organizations
        .filter((organization) => organization.repositories.some((repository) => repository.visibility === "public"))
        .map((organization) => ({ ...organizationSummary(organization), role: null }));
      return jsonResponse(200, { organizations });
    }
    if (url === "/api/organizations" && method === "GET") {
      if (!currentAccount()) return jsonResponse(401, { error: "Authentication required" });
      const organizations = api.organizations
        .filter((organization) => membership(organization))
        .map((organization) => organizationSummary(organization));
      return jsonResponse(200, { organizations });
    }
    if (url === "/api/organizations" && method === "POST") {
      if (!currentAccount()) return jsonResponse(401, { error: "Authentication required" });
      const slug = String(body.organizationName ?? "").trim();
      const displayName = String(body.displayName ?? "").trim();
      const fields: Record<string, string> = {};
      if (api.organizations.some((organization) => organization.slug === slug || organization.displayName === slug)) {
        fields.organizationName = "Organization name already exists";
      } else {
        if (!ORG_NAME_PATTERN.test(slug) || slug.length > 39) fields.organizationName = "Organization name format is invalid";
        if (displayName.length === 0) fields.displayName = "Display name is required";
        else if (displayName.length > 100) fields.displayName = "Display name is too long";
      }
      if (Object.keys(fields).length > 0) return jsonResponse(400, { error: "Organization creation failed", fields });
      const organization: FakeOrganization = {
        id: `org-${api.organizations.length + 1}`,
        slug,
        displayName,
        members: [{ accountId: api.signedInId!, role: "owner" }],
        teams: [],
        teamMembers: [],
        repositories: [],
        repositoryGrants: [],
      };
      api.organizations.push(organization);
      return jsonResponse(201, { organization: organizationSummary(organization) });
    }

    if (url === "/api/repositories" && method === "GET") {
      if (!currentAccount()) return jsonResponse(401, { error: "Authentication required" });
      const repositories = api.organizations
        .flatMap((organization) =>
          organization.repositories
            .filter((repository) => canRead(organization, repository))
            .map((repository) => repositoryPayload(organization, repository)),
        )
        .sort((left, right) => left.name.localeCompare(right.name));
      return jsonResponse(200, { repositories });
    }
    if (segments[1] === "repositories" && segments.length >= 4) {
      const organization = currentOrganization(decodeURIComponent(segments[2]));
      const repository = organization?.repositories.find((candidate) => candidate.name === decodeURIComponent(segments[3]));
      if (!organization || !repository) return jsonResponse(404, { error: "Not found" });

      if (segments.length === 4 && method === "GET") {
        if (!canRead(organization, repository)) return jsonResponse(403, { error: "Access denied" });
        return jsonResponse(200, { repository: repositoryPayload(organization, repository) });
      }

      if (segments[4] === "access") {
        if (repositoryRole(organization, repository) !== "admin") return jsonResponse(403, { error: "Access denied" });
        if (segments.length === 5 && method === "GET") {
          return jsonResponse(200, accessPayload(organization, repository));
        }
        if (segments.length === 5 && method === "POST") {
          const subjectType = body.subjectType === "team" ? "team" : "account";
          const name = String(body.name ?? "").trim();
          const role = String(body.role ?? "").trim().toLowerCase();
          if (!["read", "triage", "write", "maintain", "admin"].includes(role)) {
            return jsonResponse(400, { error: "Access update failed", fields: { role: "Role is invalid" } });
          }
          const subjectExists = subjectType === "team"
            ? organization.teams.some((team) => team.slug === name)
            : Boolean(accountIdOf(name));
          if (!subjectExists) {
            return jsonResponse(400, {
              error: "Access update failed",
              fields: { name: subjectType === "team" ? "Team not found" : "Account not found" },
            });
          }
          const existing = organization.repositoryGrants.find(
            (grant) => grant.repositoryName === repository.name && grant.subjectType === subjectType && grant.subjectName === name,
          );
          if (existing) existing.role = role;
          else {
            organization.repositoryGrants.push({
              id: `grant-${organization.repositoryGrants.length + 1}-new`,
              repositoryName: repository.name,
              subjectType,
              subjectName: name,
              role,
            });
          }
          return jsonResponse(200, accessPayload(organization, repository));
        }
        if (segments.length === 6 && method === "PATCH") {
          const grant = organization.repositoryGrants.find(
            (candidate) => candidate.id === decodeURIComponent(segments[5]) && candidate.repositoryName === repository.name,
          );
          if (!grant) return jsonResponse(404, { error: "Not found" });
          const role = String(body.role ?? "").trim().toLowerCase();
          if (!["read", "triage", "write", "maintain", "admin"].includes(role)) {
            return jsonResponse(400, { error: "Access update failed", fields: { role: "Role is invalid" } });
          }
          grant.role = role;
          return jsonResponse(200, accessPayload(organization, repository));
        }
      }

      return jsonResponse(404, { error: "Not found" });
    }

    if (segments[1] === "organizations" && segments.length >= 3) {
      const organization = currentOrganization(decodeURIComponent(segments[2]));
      if (!organization) return jsonResponse(404, { error: "Not found" });
      const member = membership(organization);
      const isPublic = organization.repositories.some((repository) => repository.visibility === "public");

      if (segments.length === 3 && method === "GET") {
        if (!currentAccount() && !isPublic) return jsonResponse(403, { error: "Access denied" });
        return jsonResponse(200, { organization: organizationSummary(organization) });
      }
      if (segments.length === 4 && segments[3] === "repositories" && method === "GET") {
        if (!currentAccount() && !isPublic) return jsonResponse(403, { error: "Access denied" });
        const repositories = organization.repositories
          .filter((repository) => canRead(organization, repository))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((repository) => repositoryPayload(organization, repository));
        return jsonResponse(200, { organization: organizationSummary(organization), repositories });
      }
      if (segments.length === 4 && segments[3] === "people" && method === "GET") {
        if (!member) return jsonResponse(403, { error: "Access denied" });
        return jsonResponse(200, peoplePayload(organization));
      }
      if (segments.length === 4 && segments[3] === "members" && method === "POST") {
        if (member?.role !== "owner") return jsonResponse(403, { error: "Access denied" });
        const identifier = String(body.username ?? "").trim();
        const role = String(body.role ?? "member").trim().toLowerCase() || "member";
        const account = api.accounts.find(
          (candidate) => candidate.username === identifier || candidate.email === identifier,
        );
        if (!account) {
          return jsonResponse(400, { error: "Member update failed", fields: { username: "Account not found" } });
        }
        if (!["member", "owner"].includes(role)) {
          return jsonResponse(400, { error: "Member update failed", fields: { role: "Role is invalid" } });
        }
        if (organization.members.some((entry) => entry.accountId === account.id)) {
          return jsonResponse(400, { error: "Member update failed", fields: { username: "Account is already a member" } });
        }
        organization.members.push({ accountId: account.id, role: role as "owner" | "member" });
        return jsonResponse(200, peoplePayload(organization));
      }
      if (segments.length === 5 && segments[3] === "members" && method === "DELETE") {
        if (member?.role !== "owner") return jsonResponse(403, { error: "Access denied" });
        const identifier = decodeURIComponent(segments[4]);
        const account = api.accounts.find(
          (candidate) => candidate.username === identifier || candidate.email === identifier,
        );
        if (!account) {
          return jsonResponse(400, { error: "Member update failed", fields: { username: "Account not found" } });
        }
        const entry = organization.members.find((candidate) => candidate.accountId === account.id);
        if (!entry) {
          return jsonResponse(400, { error: "Member update failed", fields: { username: "Account is not an organization member" } });
        }
        const owners = organization.members.filter((candidate) => candidate.role === "owner");
        if (entry.role === "owner" && owners.length <= 1) {
          return jsonResponse(400, {
            error: "Member update failed",
            fields: { username: "Organization must have at least one Owner" },
          });
        }
        organization.members = organization.members.filter((candidate) => candidate.accountId !== account.id);
        organization.teamMembers = organization.teamMembers.filter((teamMember) => teamMember.accountId !== account.id);
        organization.repositoryGrants = organization.repositoryGrants.filter(
          (grant) => !(grant.subjectType === "account" && accountIdOf(grant.subjectName) === account.id),
        );
        return jsonResponse(200, peoplePayload(organization));
      }
      if (segments.length === 4 && segments[3] === "teams") {
        if (!member) return jsonResponse(403, { error: "Access denied" });
        if (method === "GET") {
          const teams = [...organization.teams].sort((a, b) => a.slug.localeCompare(b.slug)).map((team) => teamPayload(organization, team));
          return jsonResponse(200, { organization: organizationSummary(organization), teams });
        }
        if (method === "POST") {
          if (member.role !== "owner") return jsonResponse(403, { error: "Access denied" });
          const teamName = String(body.teamName ?? "").trim();
          if (teamName.length < 1 || teamName.length > 50 || !TEAM_NAME_PATTERN.test(teamName) || teamName.startsWith("-") || teamName.endsWith("-")) {
            return jsonResponse(400, { error: "Team creation failed", fields: { teamName: "Team name is invalid" } });
          }
          if (organization.teams.some((team) => team.slug === teamName)) {
            return jsonResponse(400, { error: "Team creation failed", fields: { teamName: "Team name already exists" } });
          }
          const team: FakeTeam = { id: `team-${organization.teams.length + 1}`, slug: teamName, parent: null };
          organization.teams.push(team);
          return jsonResponse(201, { team: teamPayload(organization, team) });
        }
      }
      if (segments.length >= 5 && segments[3] === "teams") {
        const team = organization.teams.find((candidate) => candidate.slug === decodeURIComponent(segments[4]));
        if (!team) return jsonResponse(404, { error: "Not found" });
        if (!member) return jsonResponse(403, { error: "Access denied" });
        if (segments.length === 5 && method === "GET") {
          const members = organization.teamMembers
            .filter((teamMember) => teamMember.teamSlug === team.slug)
            .map((teamMember) => {
              const account = api.accounts.find((candidate) => candidate.id === teamMember.accountId);
              return { id: account?.id ?? teamMember.accountId, username: account?.username ?? "", email: account?.email ?? "" };
            });
          return jsonResponse(200, {
            organization: organizationSummary(organization),
            team: teamPayload(organization, team),
            members,
            parentOptions: organization.teams.filter((candidate) => candidate.slug !== team.slug).map((candidate) => candidate.slug).sort(),
          });
        }
        if (segments.length === 6 && segments[5] === "parent" && method === "POST") {
          if (member.role !== "owner") return jsonResponse(403, { error: "Access denied" });
          const parent = String(body.parentTeam ?? "").trim();
          if (parent !== "") {
            const parentTeam = organization.teams.find((candidate) => candidate.slug === parent);
            const isDescendant = (start: string): boolean => {
              const seen = new Set<string>();
              let current = organization.teams.find((candidate) => candidate.slug === start);
              while (current?.parent && !seen.has(current.slug)) {
                if (current.parent === team.slug) return true;
                seen.add(current.slug);
                current = organization.teams.find((candidate) => candidate.slug === current?.parent);
              }
              return false;
            };
            if (parent === team.slug || isDescendant(parent) || !parentTeam) {
              return jsonResponse(400, { error: "Team update failed", fields: { parentTeam: "Cyclic team hierarchy is not allowed" } });
            }
            team.parent = parent;
          } else {
            team.parent = null;
          }
          return jsonResponse(200, { team: teamPayload(organization, team) });
        }
        if (segments.length === 6 && segments[5] === "members" && method === "POST") {
          if (member.role !== "owner") return jsonResponse(403, { error: "Access denied" });
          const account = api.accounts.find((candidate) => candidate.username === String(body.username ?? "").trim());
          if (!account) return jsonResponse(400, { error: "Team member update failed", fields: { username: "Account not found" } });
          if (!organization.members.some((entry) => entry.accountId === account.id)) {
            return jsonResponse(400, { error: "Team member update failed", fields: { username: "Account is not an organization member" } });
          }
          if (!organization.teamMembers.some((entry) => entry.teamSlug === team.slug && entry.accountId === account.id)) {
            organization.teamMembers.push({ teamSlug: team.slug, accountId: account.id });
          }
          const members = organization.teamMembers
            .filter((entry) => entry.teamSlug === team.slug)
            .map((entry) => {
              const memberAccount = api.accounts.find((candidate) => candidate.id === entry.accountId);
              return { id: memberAccount?.id ?? entry.accountId, username: memberAccount?.username ?? "", email: memberAccount?.email ?? "" };
            });
          return jsonResponse(200, { team: teamPayload(organization, team), members });
        }
        if (segments.length === 7 && segments[5] === "members" && method === "DELETE") {
          if (member.role !== "owner") return jsonResponse(403, { error: "Access denied" });
          const username = decodeURIComponent(segments[6]);
          organization.teamMembers = organization.teamMembers.filter((entry) => {
            const account = api.accounts.find((candidate) => candidate.id === entry.accountId);
            return !(entry.teamSlug === team.slug && account?.username === username);
          });
          const members = organization.teamMembers
            .filter((entry) => entry.teamSlug === team.slug)
            .map((entry) => {
              const memberAccount = api.accounts.find((candidate) => candidate.id === entry.accountId);
              return { id: memberAccount?.id ?? entry.accountId, username: memberAccount?.username ?? "", email: memberAccount?.email ?? "" };
            });
          return jsonResponse(200, { team: teamPayload(organization, team), members });
        }
      }
    }

    return jsonResponse(404, { error: "Not found" });
  };

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => handler(input, init ?? {}));
  return api;
}
