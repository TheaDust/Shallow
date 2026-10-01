import { vi } from "vitest";

import {
  createPersonalRepositoryRecords,
  createRepositoryView,
  explicitForkVisibility,
  forkedRepositoryView,
  organizationRepositoryPayload,
  REPOSITORY_MESSAGES,
  repositoryNameError,
  repositoryViewFromInput,
  STUB_REPOSITORY_TIMESTAMP,
  type StubPersonalRepository,
  type StubPersonalRepositoryRecord,
  type StubRepository,
  type StubRepositoryView,
} from "./repository-stub";
import { handleRepositoryCodeStub } from "./repository-code-stub";
import { handleRepositoryIssueStub, handleRepositoryIssueWriteStub } from "./issue-stub";
import {
  handleRepositoryPullReadStub,
  handleRepositoryPullWriteStub,
} from "./pull-request-stub";

export type { StubPersonalRepository, StubRepository } from "./repository-stub";

export interface StubAccount {
  id: string;
  username: string;
  email: string;
  password: string;
  emailVerified: boolean;
}

export interface StubCall {
  method: string;
  path: string;
  body: unknown;
}

export interface AuthStub {
  accounts: StubAccount[];
  calls: StubCall[];
  /** Force the next /api/register response, e.g. a server-side rejection. */
  setRegisterResponse(status: number, body: unknown): void;
}

export interface StubTeam {
  name: string;
  description?: string | null;
  parent?: string | null;
}

export interface StubOrganization {
  name: string;
  displayName: string;
  members?: Array<{ username: string; role: "owner" | "member" }>;
  teams?: StubTeam[];
  repositories?: StubRepository[];
}

interface StubTeamRecord {
  id: string;
  name: string;
  description: string | null;
  parentTeamId: string | null;
  parent: string | null;
}

const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const REPOSITORY_ROLE_RANK: Record<string, number> = {
  read: 1,
  triage: 2,
  write: 3,
  maintain: 4,
  admin: 5,
};

export interface InstallAuthStubOptions {
  accounts?: Array<Omit<StubAccount, "id" | "emailVerified">>;
  organizations?: StubOrganization[];
  /** Personal repositories, each owned by the account named in `owner`. */
  repositories?: StubPersonalRepository[];
}

const ORGANIZATION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;
const WRITE_ROLES = new Set(["write", "maintain", "admin"]);

/** Mirrors the server branch-name rule; the message is the exact UI text. */
function branchNameProblem(value: string): string | null {
  if (value.length === 0 || value.length > 255) return "Invalid branch";
  if (!BRANCH_NAME_PATTERN.test(value)) return "Invalid branch";
  if (value.endsWith("/") || value.endsWith(".")) return "Invalid branch";
  if (value.includes("..") || value.includes("//")) return "Invalid branch";
  return null;
}

/** Mirrors the server file-path rule. */
function filePathProblem(value: string): string | null {
  const raw = value.trim();
  if (raw.length === 0 || raw.startsWith("/")) return "Invalid file path";
  const segments = raw.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return "Invalid file path";
  }
  return null;
}

/** Mirrors the server commit-message rule. */
function commitMessageProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Commit message is required";
  if (trimmed.length > 72) return "Commit message must be 72 characters or fewer";
  return null;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * Minimal same-origin backend stand-in for component tests. Validation rules
 * live in the backend; these tests feed the UI the responses that matter.
 */
const VERIFICATION_CODE = "123456";

/** Mirrors the backend password rule so component tests see realistic errors. */
function isCompliantPassword(value: string): boolean {
  if (value.length < 12 || value.length > 128) return false;
  if (/\s/.test(value)) return false;
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
}

function isEmailShape(value: string): boolean {
  const email = value.trim();
  if (email.length === 0 || email.length > 254 || /\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2 || parts[0].length === 0) return false;
  const labels = parts[1].split(".");
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

export function installAuthStub(options: InstallAuthStubOptions = {}): AuthStub {
  const accounts: StubAccount[] = (options.accounts ?? []).map((account, index) => ({
    ...account,
    id: `account-${index + 1}`,
    emailVerified: true,
  }));
  let sessionAccount: StubAccount | null = null;
  let registerResponse: { status: number; body: unknown } | null = null;
  const calls: StubCall[] = [];

  // Organizations mirror the server-side shape closely enough for UI tests:
  // repository visibility is filtered by the viewer's stored membership.
  let teamSequence = 0;
  let grantSequence = 0;
  const organizations = (options.organizations ?? []).map((organization, organizationIndex) => {
    const teams: StubTeamRecord[] = (organization.teams ?? []).map((team) => ({
      id: `team-${organizationIndex + 1}-${++teamSequence}`,
      name: team.name,
      description: team.description ?? null,
      parentTeamId: null,
      parent: team.parent ?? null,
    }));
    for (const team of teams) {
      team.parentTeamId = teams.find((candidate) => candidate.name === team.parent)?.id ?? null;
    }
    return {
      name: organization.name,
      displayName: organization.displayName,
      members: (organization.members ?? []).map((member) => ({ ...member })),
      teams,
      teamMembers: [] as Array<{ teamId: string; username: string }>,
      repositories: (organization.repositories ?? []).map((repository) => ({
        ...createRepositoryView(repository),
        grants: (repository.grants ?? []).map((grant) => ({
          id: `grant-seed-${++grantSequence}`,
          ...grant,
        })),
      })),
    };
  });

  // Personal repositories are addressed as `username/name`; they are readable
  // by their owner or when they are public, exactly like the server rule.
  const personalRepositories = createPersonalRepositoryRecords(options.repositories ?? []);

  type StubOrganizationRecord = (typeof organizations)[number];

  /** The signed-in account's personal repository payloads. */
  function personalRepositoryPayload(repository: StubPersonalRepositoryRecord) {
    return {
      id: `repository-${repository.owner}-${repository.name}`,
      owner: repository.owner,
      ownerType: "account" as const,
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility,
      defaultBranch: repository.defaultBranch,
      updatedAt: repository.updatedAt,
      source: repository.source ?? null,
    };
  }


  function publicTeam(organization: StubOrganizationRecord, team: StubTeamRecord) {
    return {
      id: team.id,
      name: team.name,
      description: team.description,
      parentTeamId: team.parentTeamId,
      parent: team.parentTeamId
        ? organization.teams.find((candidate) => candidate.id === team.parentTeamId)?.name ?? null
        : null,
    };
  }

  function isTeamDescendantOf(
    organization: StubOrganizationRecord,
    teamId: string,
    candidateAncestorId: string,
  ): boolean {
    let current = organization.teams.find((team) => team.id === teamId)?.parentTeamId ?? null;
    while (current) {
      if (current === candidateAncestorId) return true;
      current = organization.teams.find((team) => team.id === current)?.parentTeamId ?? null;
    }
    return false;
  }

  function organizationRole(name: string): "owner" | "member" | null {
    if (!sessionAccount) return null;
    const organization = organizations.find((candidate) => candidate.name === name);
    const membership = organization?.members.find(
      (member) => member.username === sessionAccount?.username,
    );
    return membership?.role ?? null;
  }

  /** Mirrors the server rule: Owner, direct account grant or direct team grant. */
  function repositoryRoleOf(
    organization: (typeof organizations)[number],
    repository: {
      grants: Array<{ subjectType: "account" | "team"; subjectName: string; role: string }>;
    },
    username: string | null,
  ): string | null {
    if (!username) return null;
    if (organization.members.find((member) => member.username === username)?.role === "owner") {
      return "admin";
    }
    const teamIds = organization.teamMembers
      .filter((teamMember) => teamMember.username === username)
      .map((teamMember) => teamMember.teamId);
    let best: string | null = null;
    for (const grant of repository.grants) {
      const matches =
        (grant.subjectType === "account" && grant.subjectName === username) ||
        (grant.subjectType === "team" &&
          organization.teams.some(
            (team) => team.name === grant.subjectName && teamIds.includes(team.id),
          ));
      if (!matches) continue;
      if (!best || (REPOSITORY_ROLE_RANK[grant.role] ?? 0) > (REPOSITORY_ROLE_RANK[best] ?? 0)) {
        best = grant.role;
      }
    }
    return best;
  }

  function repositoryRole(
    organization: (typeof organizations)[number],
    repository: {
      grants: Array<{ subjectType: "account" | "team"; subjectName: string; role: string }>;
    },
  ): string | null {
    if (!sessionAccount) return null;
    return repositoryRoleOf(organization, repository, sessionAccount.username);
  }

  /** The same effective-role rule as the server, for one resolved repository. */
  function viewerRoleFor(
    owner: string,
    resolved: { ownerType: "account" | "organization"; organization: unknown; view: unknown },
  ) {
    if (resolved.ownerType === "account") {
      return sessionAccount && owner === sessionAccount.username ? "admin" : null;
    }
    return resolved.organization
      ? repositoryRole(resolved.organization as never, resolved.view as never)
      : null;
  }

  /**
   * The accounts the `Reviewers` picker may offer: every account with Write or
   * higher on the repository, exactly like the server rule (Owner status, a
   * direct account grant or a direct team grant).
   */
  function reviewerCandidatesFor(owner: string, resolved: ResolvedStubRepository) {
    if (resolved.ownerType === "account") return [owner];
    const organization = resolved.organization as (typeof organizations)[number] | null;
    if (!organization) return [];
    return accounts
      .map((account) => account.username)
      .filter(
        (name) =>
          (REPOSITORY_ROLE_RANK[
            repositoryRoleOf(organization, resolved.view as never, name) ?? ""
          ] ?? 0) >= REPOSITORY_ROLE_RANK.write,
      )
      .sort((left, right) => left.localeCompare(right));
  }

  /**
   * The accounts the Assignees picker may offer: everyone holding at least
   * Triage permission on the repository, which mirrors the server rule (Owner
   * status, a direct account grant or a direct team grant).
   */
  function assignableMembersFor(owner: string, resolved: ResolvedStubRepository) {
    if (resolved.ownerType === "account") return [owner];
    const organization = resolved.organization as (typeof organizations)[number] | null;
    if (!organization) return [];
    const grants =
      (resolved.view as unknown as { grants?: Array<{ subjectType: "account" | "team"; subjectName: string; role: string }> })
        .grants ?? [];
    return (organization.members ?? [])
      .filter((member) => {
        if (member.role === "owner") return true;
        const teamIds = organization.teamMembers
          .filter((teamMember) => teamMember.username === member.username)
          .map((teamMember) => teamMember.teamId);
        return grants.some(
          (grant) =>
            (REPOSITORY_ROLE_RANK[grant.role] ?? 0) >= REPOSITORY_ROLE_RANK.triage &&
            ((grant.subjectType === "account" && grant.subjectName === member.username) ||
              (grant.subjectType === "team" &&
                organization.teams.some(
                  (team) => team.name === grant.subjectName && teamIds.includes(team.id),
                ))),
        );
      })
      .map((member) => member.username);
  }

  function readableRepositories(organization: (typeof organizations)[number]) {
    return organization.repositories.filter(
      (repository) =>
        repository.visibility === "public" || repositoryRole(organization, repository) !== null,
    );
  }

  /**
   * Resolves an `owner/name` address against the personal and organization
   * repositories, mirroring the server-side lookup.
   */
  function repositoryView(owner: string, name: string) {
    const organization = organizations.find((candidate) => candidate.name === owner);
    if (organization) {
      const repository = organization.repositories.find(
        (candidate) => candidate.name === name,
      );
      if (repository) {
        return {
          view: repository as StubRepositoryView,
          ownerType: "organization" as const,
          organization,
        };
      }
    }
    const personal = personalRepositories.find(
      (candidate) => candidate.owner === owner && candidate.name === name,
    );
    if (personal) {
      return {
        view: personal as unknown as StubRepositoryView,
        ownerType: "account" as const,
        organization: null,
      };
    }
    return null;
  }

  type ResolvedStubRepository = NonNullable<ReturnType<typeof repositoryView>>;

  /** The same readability rule as the server: public or a granted relationship. */
  function canReadView(owner: string, resolved: ResolvedStubRepository) {
    if (resolved.view.visibility === "public") return true;
    if (!sessionAccount) return false;
    if (resolved.ownerType === "account") return owner === sessionAccount.username;
    return resolved.organization
      ? repositoryRole(resolved.organization, resolved.view as never) !== null
      : false;
  }

  function repositoryPayload(owner: string, resolved: ResolvedStubRepository) {
    const { view } = resolved;
    return {
      id: `${owner}/${view.name}`,
      owner,
      ownerType: resolved.ownerType,
      name: view.name,
      description: view.description,
      visibility: view.visibility,
      defaultBranch: view.defaultBranch,
      updatedAt: view.updatedAt,
      source: view.source ?? null,
    };
  }

  const publicAccount = (account: StubAccount) => ({
    id: account.id,
    username: account.username,
    email: account.email,
    emailVerified: account.emailVerified,
  });

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === "/api/session" && method === "GET") {
      return jsonResponse(200, { account: sessionAccount ? publicAccount(sessionAccount) : null });
    }
    if (url.pathname === "/api/session" && method === "POST") {
      const identifier = String(body?.identifier ?? "").trim();
      const account = accounts.find(
        (candidate) => candidate.username === identifier || candidate.email === identifier,
      );
      if (!account || account.password !== body?.password) {
        return jsonResponse(401, { error: "Invalid credentials" });
      }
      sessionAccount = account;
      return jsonResponse(200, { account: publicAccount(account) });
    }
    if (url.pathname === "/api/session" && method === "DELETE") {
      sessionAccount = null;
      return jsonResponse(200, { ok: true });
    }
    if (url.pathname === "/api/password" && method === "POST") {
      if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
      const fieldErrors: Record<string, string> = {};
      const currentPassword = String(body?.currentPassword ?? "");
      if (currentPassword.length === 0) {
        fieldErrors.currentPassword = "Current password is required";
      } else if (currentPassword !== sessionAccount.password) {
        fieldErrors.currentPassword = "Current password is incorrect";
      }
      const newPassword = String(body?.newPassword ?? "");
      if (!isCompliantPassword(newPassword)) {
        fieldErrors.newPassword = "Password requirements are not satisfied";
      } else if (newPassword !== body?.confirmPassword) {
        fieldErrors.confirmPassword = "Password confirmation does not match";
      }
      if (Object.keys(fieldErrors).length > 0) {
        return jsonResponse(400, { error: "Password change failed", fieldErrors });
      }
      sessionAccount.password = newPassword;
      return jsonResponse(200, { message: "Password updated" });
    }
    if (url.pathname === "/api/password-reset" && method === "POST") {
      const email = String(body?.email ?? "").trim();
      const fieldErrors: Record<string, string> = {};
      if (!isEmailShape(email)) fieldErrors.email = "Email format is invalid";
      if (String(body?.code ?? "").trim() !== VERIFICATION_CODE) {
        fieldErrors.code = "Verification code is invalid";
      }
      const newPassword = String(body?.newPassword ?? "");
      if (!isCompliantPassword(newPassword)) {
        fieldErrors.newPassword = "Password requirements are not satisfied";
      } else if (newPassword !== body?.confirmPassword) {
        fieldErrors.confirmPassword = "Passwords do not match";
      }
      const account = accounts.find((candidate) => candidate.email === email);
      if (!account) fieldErrors.email = "Account not found";
      if (!account || Object.keys(fieldErrors).length > 0) {
        return jsonResponse(400, { error: "Password reset failed", fieldErrors });
      }
      account.password = newPassword;
      return jsonResponse(200, { message: "Password updated" });
    }
    if (url.pathname === "/api/organizations") {
      if (method === "GET") {
        if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
        const mine = organizations
          .filter((organization) => organizationRole(organization.name) !== null)
          .map((organization) => ({
            name: organization.name,
            displayName: organization.displayName,
            role: organizationRole(organization.name),
          }));
        return jsonResponse(200, { organizations: mine });
      }
      if (method === "POST") {
        if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
        const name = String(body?.name ?? "").trim();
        const displayName = String(body?.displayName ?? "").trim();
        if (!ORGANIZATION_NAME_PATTERN.test(name) || name.length > 39) {
          return jsonResponse(400, {
            error: "Organization creation failed",
            fieldErrors: { name: "Organization name format is invalid" },
          });
        }
        if (organizations.some((organization) => organization.name === name)) {
          return jsonResponse(400, {
            error: "Organization creation failed",
            fieldErrors: { name: "Organization name already exists" },
          });
        }
        if (displayName.length === 0) {
          return jsonResponse(400, {
            error: "Organization creation failed",
            fieldErrors: { displayName: "Display name is required" },
          });
        }
        organizations.push({
          name,
          displayName,
          members: [{ username: sessionAccount.username, role: "owner" as const }],
          teams: [],
          teamMembers: [],
          repositories: [],
        });
        return jsonResponse(201, { organization: { name, displayName } });
      }
    }

    const organizationPath = /^\/api\/organizations\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (organizationPath) {
      const name = decodeURIComponent(organizationPath[1]);
      const organization = organizations.find((candidate) => candidate.name === name);
      if (!organization) return jsonResponse(404, { error: "Organization not found" });
      const raw = organizationPath[2] ?? "";
      const segments = raw.length > 0 ? raw.split("/").map(decodeURIComponent) : [];
      const role = organizationRole(name);
      const isOwner = role === "owner";

      if (segments.length === 0 && method === "GET") {
        return jsonResponse(200, {
          organization: { name: organization.name, displayName: organization.displayName },
          viewerRole: role,
        });
      }
      if (segments.length === 1 && segments[0] === "repositories" && method === "GET") {
        return jsonResponse(200, { repositories: readableRepositories(organization) });
      }
      if (segments.length === 1 && segments[0] === "members") {
        if (method === "GET") {
          return jsonResponse(200, {
            members: organization.members.map((member) => ({ ...member })),
          });
        }
        if (method === "POST") {
          if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
          if (!isOwner) return jsonResponse(403, { error: "Access denied" });
          const identifier = String(body?.identifier ?? "").trim();
          const role = String(body?.role ?? "member").toLowerCase();
          if (role !== "member" && role !== "owner") {
            return jsonResponse(400, {
              error: "Member not added",
              fieldErrors: { role: "Role is not supported" },
            });
          }
          const account = accounts.find(
            (candidate) => candidate.username === identifier || candidate.email === identifier,
          );
          if (!account) {
            return jsonResponse(400, {
              error: "Member not added",
              fieldErrors: { identifier: "Account not found" },
            });
          }
          if (organization.members.some((member) => member.username === account.username)) {
            return jsonResponse(400, {
              error: "Member not added",
              fieldErrors: { identifier: "Account is already a member" },
            });
          }
          organization.members.push({ username: account.username, role });
          return jsonResponse(201, { member: { username: account.username, role } });
        }
        return jsonResponse(404, { error: "Not found" });
      }
      if (segments.length === 2 && segments[0] === "members" && method === "DELETE") {
        if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
        if (!isOwner) return jsonResponse(403, { error: "Access denied" });
        const username = segments[1];
        const index = organization.members.findIndex((member) => member.username === username);
        if (index === -1) {
          return jsonResponse(400, {
            error: "Member not removed",
            fieldErrors: { username: "Member not found" },
          });
        }
        if (
          organization.members[index].role === "owner" &&
          organization.members.filter((member) => member.role === "owner").length <= 1
        ) {
          return jsonResponse(400, {
            error: "Member not removed",
            fieldErrors: { username: "Organization must have at least one Owner" },
          });
        }
        organization.members.splice(index, 1);
        organization.teamMembers = organization.teamMembers.filter(
          (teamMember) => teamMember.username !== username,
        );
        return jsonResponse(200, { ok: true });
      }
      if (segments.length === 1 && segments[0] === "teams" && method === "GET") {
        return jsonResponse(200, {
          teams: organization.teams.map((team) => publicTeam(organization, team)),
        });
      }
      if (segments.length === 1 && segments[0] === "teams" && method === "POST") {
        if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
        if (!isOwner) return jsonResponse(403, { error: "Access denied" });
        const teamName = String(body?.name ?? "").trim();
        if (!TEAM_NAME_PATTERN.test(teamName) || teamName.length > 50) {
          return jsonResponse(400, {
            error: "Team not created",
            fieldErrors: { name: "Team name format is invalid" },
          });
        }
        if (organization.teams.some((team) => team.name === teamName)) {
          return jsonResponse(400, {
            error: "Team not created",
            fieldErrors: { name: "Team name already exists" },
          });
        }
        const parentName = String(body?.parent ?? "").trim();
        const parent = parentName
          ? organization.teams.find((team) => team.name === parentName) ?? null
          : null;
        if (parentName && !parent) {
          return jsonResponse(400, {
            error: "Team not created",
            fieldErrors: { parent: "Parent team is invalid" },
          });
        }
        const team: StubTeamRecord = {
          id: `team-new-${++teamSequence}`,
          name: teamName,
          description: String(body?.description ?? "").trim() || null,
          parentTeamId: parent?.id ?? null,
          parent: parent?.name ?? null,
        };
        organization.teams.push(team);
        return jsonResponse(201, { team: publicTeam(organization, team) });
      }
      if (segments.length >= 2 && segments[0] === "teams") {
        const team = organization.teams.find((candidate) => candidate.name === segments[1]);
        if (!team) return jsonResponse(404, { error: "Team not found" });
        if (segments.length === 2 && method === "GET") {
          return jsonResponse(200, {
            organization: { name: organization.name, displayName: organization.displayName },
            team: publicTeam(organization, team),
            members: organization.teamMembers
              .filter((teamMember) => teamMember.teamId === team.id)
              .map((teamMember) => ({ username: teamMember.username }))
              .sort((left, right) => left.username.localeCompare(right.username)),
            viewerRole: role,
            canManage: isOwner,
          });
        }
        if (segments.length === 2 && (method === "PATCH" || method === "PUT")) {
          if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
          if (!isOwner) return jsonResponse(403, { error: "Access denied" });
          const parentName = String(body?.parent ?? "").trim();
          const parent = parentName
            ? organization.teams.find((candidate) => candidate.name === parentName) ?? null
            : null;
          if (parentName && !parent) {
            return jsonResponse(400, {
              error: "Parent team not saved",
              fieldErrors: { parent: "Parent team is invalid" },
            });
          }
          if (parent && (parent.id === team.id || isTeamDescendantOf(organization, parent.id, team.id))) {
            return jsonResponse(400, {
              error: "Parent team not saved",
              fieldErrors: { parent: "Cyclic team hierarchy is not allowed" },
            });
          }
          team.parentTeamId = parent?.id ?? null;
          team.parent = parent?.name ?? null;
          return jsonResponse(200, { team: publicTeam(organization, team) });
        }
        if (segments.length === 3 && segments[2] === "members" && method === "POST") {
          if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
          if (!isOwner) return jsonResponse(403, { error: "Access denied" });
          const username = String(body?.username ?? "").trim();
          const account = accounts.find(
            (candidate) => candidate.username === username || candidate.email === username,
          );
          if (!account) {
            return jsonResponse(400, {
              error: "Member not added",
              fieldErrors: { username: "Account not found" },
            });
          }
          if (!organization.members.some((member) => member.username === account.username)) {
            return jsonResponse(400, {
              error: "Member not added",
              fieldErrors: { username: "Account is not an organization member" },
            });
          }
          if (
            organization.teamMembers.some(
              (teamMember) => teamMember.teamId === team.id && teamMember.username === account.username,
            )
          ) {
            return jsonResponse(400, {
              error: "Member not added",
              fieldErrors: { username: "Account is already a team member" },
            });
          }
          organization.teamMembers.push({ teamId: team.id, username: account.username });
          return jsonResponse(201, { member: { username: account.username } });
        }
        if (segments.length === 4 && segments[2] === "members" && method === "DELETE") {
          if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
          if (!isOwner) return jsonResponse(403, { error: "Access denied" });
          const username = segments[3];
          const before = organization.teamMembers.length;
          organization.teamMembers = organization.teamMembers.filter(
            (teamMember) => !(teamMember.teamId === team.id && teamMember.username === username),
          );
          if (organization.teamMembers.length === before) {
            return jsonResponse(400, {
              error: "Member not removed",
              fieldErrors: { username: "Account is not a team member" },
            });
          }
          return jsonResponse(200, { ok: true });
        }
        return jsonResponse(404, { error: "Not found" });
      }
      return jsonResponse(404, { error: "Not found" });
    }

    const accessPath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/access$/.exec(url.pathname);
    if (accessPath) {
      const owner = decodeURIComponent(accessPath[1]);
      const repositoryName = decodeURIComponent(accessPath[2]);
      const organization = organizations.find((candidate) => candidate.name === owner);
      const repository = organization?.repositories.find(
        (candidate) => candidate.name === repositoryName,
      );
      if (!repository || !organization) return jsonResponse(404, { error: "Not found" });
      const role = repositoryRole(organization, repository);
      if (!(repository.visibility === "public" || role !== null)) {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (role !== "admin") return jsonResponse(403, { error: "Access denied" });
      const publicGrants = () =>
        repository.grants
          .map((grant) => ({
            id: grant.id,
            subjectType: grant.subjectType,
            subjectName: grant.subjectName,
            role: grant.role,
          }))
          .sort((left, right) => left.subjectName.localeCompare(right.subjectName));
      if (method === "GET") {
        return jsonResponse(200, {
          repository: {
            owner,
            name: repository.name,
            ownerType: "organization",
            visibility: repository.visibility,
          },
          organization: { name: organization.name, displayName: organization.displayName },
          grants: publicGrants(),
          canManage: true,
        });
      }
      if (method === "PUT" || method === "POST") {
        const subjectType = body?.subjectType === "team" ? "team" : "account";
        const subjectName = String(body?.subjectName ?? "").trim();
        const wantedRole = String(body?.role ?? "").toLowerCase();
        if (!Object.keys(REPOSITORY_ROLE_RANK).includes(wantedRole)) {
          return jsonResponse(400, {
            error: "Grant not saved",
            fieldErrors: { role: "Role is not supported" },
          });
        }
        const knownSubject =
          subjectType === "account"
            ? organization.members.some((member) => member.username === subjectName)
            : organization.teams.some((team) => team.name === subjectName);
        if (!knownSubject) {
          return jsonResponse(400, {
            error: "Grant not saved",
            fieldErrors: { subject: "Subject is not an organization member or team" },
          });
        }
        const existing = repository.grants.find(
          (grant) => grant.subjectType === subjectType && grant.subjectName === subjectName,
        );
        if (existing) existing.role = wantedRole;
        else
          repository.grants.push({
            id: `grant-new-${++grantSequence}`,
            subjectType,
            subjectName,
            role: wantedRole,
          });
        return jsonResponse(200, { grants: publicGrants() });
      }
      return jsonResponse(404, { error: "Not found" });
    }

    if (url.pathname === "/api/repositories") {
      if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
      if (method === "GET") {
        return jsonResponse(200, {
          repositories: personalRepositories
            .filter((repository) => repository.owner === sessionAccount?.username)
            .map(personalRepositoryPayload)
            .sort((left, right) => left.name.localeCompare(right.name)),
        });
      }
      if (method === "POST") {
        const owner = String(body?.owner ?? "").trim() || sessionAccount.username;
        const name = String(body?.name ?? "").trim();
        const description = String(body?.description ?? "").trim();
        const visibility = body?.visibility === "private" ? "private" : "public";
        const nameReason = repositoryNameError(name);
        if (nameReason) {
          return jsonResponse(400, {
            error: "Repository creation failed",
            fieldErrors: { name: nameReason },
          });
        }
        const ownerOrganization = organizations.find((candidate) => candidate.name === owner);
        if (!ownerOrganization && owner !== sessionAccount.username) {
          return jsonResponse(400, {
            error: "Repository creation failed",
            fieldErrors: { owner: REPOSITORY_MESSAGES.ownerInvalid },
          });
        }
        if (ownerOrganization && organizationRole(ownerOrganization.name) !== "owner") {
          return jsonResponse(400, {
            error: "Repository creation failed",
            fieldErrors: { owner: REPOSITORY_MESSAGES.ownerDenied },
          });
        }
        if (repositoryView(owner, name)) {
          return jsonResponse(400, {
            error: "Repository creation failed",
            fieldErrors: { name: REPOSITORY_MESSAGES.nameExists },
          });
        }
        const createdView = repositoryViewFromInput({
          name,
          description,
          visibility,
          initializeReadme: body?.initializeReadme === true,
        });
        if (ownerOrganization) {
          ownerOrganization.repositories.push({ ...createdView, grants: [] });
        } else {
          personalRepositories.push({ ...createdView, owner });
        }
        return jsonResponse(201, {
          repository: ownerOrganization
            ? organizationRepositoryPayload(owner, createdView)
            : { owner, ownerType: "account", ...createdView },
        });
      }
      return jsonResponse(404, { error: "Not found" });
    }

    const forkPath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/forks$/.exec(url.pathname);
    if (forkPath) {
      if (method !== "POST") return jsonResponse(404, { error: "Not found" });
      if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
      const sourceOwner = decodeURIComponent(forkPath[1]);
      const sourceName = decodeURIComponent(forkPath[2]);
      const resolvedSource = repositoryView(sourceOwner, sourceName);
      if (!resolvedSource) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(sourceOwner, resolvedSource)) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const owner = String(body?.owner ?? "").trim() || sessionAccount.username;
      const name = String(body?.name ?? "").trim() || resolvedSource.view.name;
      const ownerOrganization = organizations.find((candidate) => candidate.name === owner);
      if (!ownerOrganization && owner !== sessionAccount.username) {
        return jsonResponse(400, {
          error: "Repository not forked",
          fieldErrors: { owner: REPOSITORY_MESSAGES.ownerInvalid },
        });
      }
      if (ownerOrganization && organizationRole(ownerOrganization.name) !== "owner") {
        return jsonResponse(400, {
          error: "Repository not forked",
          fieldErrors: { owner: REPOSITORY_MESSAGES.ownerDenied },
        });
      }
      const nameReason = repositoryNameError(name);
      if (nameReason) {
        return jsonResponse(400, {
          error: "Repository not forked",
          fieldErrors: { name: nameReason },
        });
      }
      if (repositoryView(owner, name)) {
        return jsonResponse(400, {
          error: "Repository not forked",
          fieldErrors: { name: REPOSITORY_MESSAGES.nameExists },
        });
      }
      const forkedView = forkedRepositoryView(resolvedSource.view, {
        name,
        visibility: explicitForkVisibility(resolvedSource.view.visibility, body?.visibility),
        sourceOwner,
      });
      if (ownerOrganization) {
        ownerOrganization.repositories.push({ ...forkedView, grants: [] });
      } else {
        personalRepositories.push({ ...forkedView, owner });
      }
      return jsonResponse(201, {
        repository: ownerOrganization
          ? organizationRepositoryPayload(owner, forkedView)
          : { owner, ownerType: "account", ...forkedView },
      });
    }

    if (url.pathname === "/api/search" && method === "GET") {
      const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const type = url.searchParams.get("type") ?? "repositories";
      const results =
        type !== "repositories" || query.length === 0
          ? []
          : [
              ...organizations.flatMap((organization) =>
                readableRepositories(organization)
                  .filter(
                    (repository) =>
                      repository.name.toLowerCase().includes(query) ||
                      (repository.description ?? "").toLowerCase().includes(query),
                  )
                  .map((repository) => ({
                    owner: organization.name,
                    name: repository.name,
                    description: repository.description,
                    visibility: repository.visibility,
                    updatedAt: repository.updatedAt,
                  })),
              ),
              ...personalRepositories
                .filter(
                  (repository) =>
                    repository.visibility === "public" ||
                    repository.owner === sessionAccount?.username,
                )
                .filter(
                  (repository) =>
                    repository.name.toLowerCase().includes(query) ||
                    repository.description.toLowerCase().includes(query),
                )
                .map((repository) => ({
                  owner: repository.owner,
                  name: repository.name,
                  description: repository.description,
                  visibility: repository.visibility,
                  updatedAt: repository.updatedAt,
                })),
            ].sort((left, right) => left.name.localeCompare(right.name));
      return jsonResponse(200, { query, type, results });
    }

    const issuesPath =
      /^\/api\/repositories\/([^/]+)\/([^/]+)\/issues(?:\/([^/]+))?(?:\/(comments|reactions|assignees|labels|milestone|state))?$/.exec(
        url.pathname,
      );
    if (issuesPath) {
      const owner = decodeURIComponent(issuesPath[1]);
      const repositoryName = decodeURIComponent(issuesPath[2]);
      const number = issuesPath[3] === undefined ? null : decodeURIComponent(issuesPath[3]);
      const section = issuesPath[4] ?? null;
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      const viewerRole = viewerRoleFor(owner, resolved);
      const username = sessionAccount?.username ?? null;
      const assignableMembers = assignableMembersFor(owner, resolved);

      // A read is open to every viewer with repository-view permission.
      if (method === "GET" && section === null) {
        if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
        const outcome = handleRepositoryIssueStub({
          owner,
          number,
          view: resolved.view,
          viewerRole,
          username,
          assignableMembers,
        });
        return jsonResponse(outcome.status, outcome.body);
      }

      // Every write resolves the signed-in account first, like the server.
      const action = (() => {
        if (method === "POST" && number === null && section === null) return "create" as const;
        if ((method === "PATCH" || method === "PUT") && number !== null && section === null) {
          return "edit" as const;
        }
        if (method === "POST" && number !== null && section === "comments") {
          return "comment" as const;
        }
        if (method === "POST" && number !== null && section === "reactions") {
          return "reaction" as const;
        }
        if (method === "POST" && number !== null && section === "assignees") {
          return "assignee" as const;
        }
        if (method === "POST" && number !== null && section === "labels") {
          return "label" as const;
        }
        if (method === "POST" && number !== null && section === "milestone") {
          return "milestone" as const;
        }
        if (method === "POST" && number !== null && section === "state") {
          return "state" as const;
        }
        return null;
      })();
      if (action !== null) {
        if (!sessionAccount || username === null) {
          return jsonResponse(401, { error: "Not authenticated" });
        }
        if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
        const outcome = handleRepositoryIssueWriteStub({
          owner,
          action,
          number,
          view: resolved.view,
          viewerRole,
          username,
          body,
          assignableMembers,
        });
        return jsonResponse(outcome.status, outcome.body);
      }

      return jsonResponse(404, { error: "Not found" });
    }

    const pullsPath =
      /^\/api\/repositories\/([^/]+)\/([^/]+)\/pulls(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(
        url.pathname,
      );
    if (pullsPath) {
      const owner = decodeURIComponent(pullsPath[1]);
      const repositoryName = decodeURIComponent(pullsPath[2]);
      const target = pullsPath[3] === undefined ? null : decodeURIComponent(pullsPath[3]);
      const action = pullsPath[4] === undefined ? null : decodeURIComponent(pullsPath[4]);
      const section = pullsPath[5] === undefined ? null : decodeURIComponent(pullsPath[5]);
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
      const viewerRole = viewerRoleFor(owner, resolved);
      const username = sessionAccount?.username ?? null;

      if (method === "GET") {
        const outcome = handleRepositoryPullReadStub({
          owner,
          target: target === "compare" ? "compare" : target === null ? "list" : "detail",
          number: target === null || target === "compare" ? null : target,
          params: url.searchParams,
          view: resolved.view,
          viewerRole,
          username,
          reviewerCandidates: reviewerCandidatesFor(owner, resolved),
        });
        return jsonResponse(outcome.status, outcome.body);
      }

      if (method === "POST") {
        if (!sessionAccount || username === null) {
          return jsonResponse(401, { error: "Not authenticated" });
        }
        const writeAction =
          target === null
            ? ("create" as const)
            : action === "ready-for-review"
              ? ("ready" as const)
              : action === "merge"
                ? ("merge" as const)
                : action === "close"
                  ? ("close" as const)
                  : action === "reopen"
                    ? ("reopen" as const)
                    : action === "reviewers"
                      ? ("requestReviewer" as const)
                      : action === "comments"
                        ? ("comment" as const)
                        : action === "reviews"
                          ? ("review" as const)
                          : action === "checks"
                            ? ("check" as const)
                            : null;
        if (writeAction === null) return jsonResponse(404, { error: "Not found" });
        const outcome = handleRepositoryPullWriteStub({
          owner,
          action: writeAction,
          number: target,
          view: resolved.view,
          viewerRole,
          username,
          body,
          reviewerCandidates: reviewerCandidatesFor(owner, resolved),
        });
        return jsonResponse(outcome.status, outcome.body);
      }

      if (method === "DELETE" && target !== null && action === "reviewers" && section !== null) {
        if (!sessionAccount || username === null) {
          return jsonResponse(401, { error: "Not authenticated" });
        }
        const outcome = handleRepositoryPullWriteStub({
          owner,
          action: "removeReviewer",
          number: target,
          target: section,
          view: resolved.view,
          viewerRole,
          username,
          body: null,
          reviewerCandidates: reviewerCandidatesFor(owner, resolved),
        });
        return jsonResponse(outcome.status, outcome.body);
      }

      return jsonResponse(404, { error: "Not found" });
    }

    const codePath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/(tree|blob|commits|commit|compare|search)(?:\/(.*))?$/.exec(
      url.pathname,
    );
    if (codePath && method === "GET") {
      const owner = decodeURIComponent(codePath[1]);
      const repositoryName = decodeURIComponent(codePath[2]);
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
      const outcome = handleRepositoryCodeStub({
        owner,
        section: codePath[3],
        rest: (codePath[4] ?? "")
          .split("/")
          .filter((segment) => segment.length > 0)
          .map((segment) => decodeURIComponent(segment)),
        params: url.searchParams,
        view: resolved.view,
        viewerRole: viewerRoleFor(owner, resolved),
      });
      if (outcome) return jsonResponse(outcome.status, outcome.body);
      return jsonResponse(404, { error: "Not found" });
    }

    const branchSettingsPath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/settings\/branches$/.exec(
      url.pathname,
    );
    if (branchSettingsPath) {
      const owner = decodeURIComponent(branchSettingsPath[1]);
      const repositoryName = decodeURIComponent(branchSettingsPath[2]);
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
      const role = viewerRoleFor(owner, resolved);
      const publicRules = () =>
        resolved.view.branchProtectionRules.map((rule, index) => ({
          id: `branch-protection-${resolved.view.name}-${index + 1}`,
          branchName: rule.branchName,
          requireApproval: rule.requireApproval === true,
          requireStatusCheck: rule.requireStatusCheck === true,
          requirements: [
            rule.requireApproval === true ? "1 approval" : null,
            rule.requireStatusCheck === true ? "Require status check test" : null,
          ].filter(Boolean),
          updatedBy: sessionAccount?.username ?? null,
          updatedAt: resolved.view.updatedAt,
        }));
      if (method === "GET") {
        return jsonResponse(200, {
          repository: repositoryPayload(owner, resolved),
          branches: [...resolved.view.branches],
          canAdminister: role === "admin",
          canWrite: role !== null && WRITE_ROLES.has(role),
          branchProtectionRules: publicRules(),
        });
      }
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
        if (role !== "admin") return jsonResponse(403, { error: "Access denied" });
        const wanted = String(body?.defaultBranch ?? "");
        if (!resolved.view.branches.includes(wanted)) {
          return jsonResponse(400, {
            error: "Default branch not changed",
            fieldErrors: { defaultBranch: "Default branch must be an existing branch" },
          });
        }
        resolved.view.defaultBranch = wanted;
        resolved.view.updatedAt = new Date().toISOString();
        return jsonResponse(200, { repository: repositoryPayload(owner, resolved) });
      }
      return jsonResponse(404, { error: "Not found" });
    }

    const branchProtectionPath =
      /^\/api\/repositories\/([^/]+)\/([^/]+)\/settings\/branches\/protection$/.exec(
        url.pathname,
      );
    if (branchProtectionPath) {
      if (method !== "POST" && method !== "PUT" && method !== "PATCH") {
        return jsonResponse(404, { error: "Not found" });
      }
      const owner = decodeURIComponent(branchProtectionPath[1]);
      const repositoryName = decodeURIComponent(branchProtectionPath[2]);
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
      if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
      if (viewerRoleFor(owner, resolved) !== "admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      const branchName = String(body?.branchName ?? "").trim();
      if (branchName.length === 0) {
        return jsonResponse(400, {
          error: "Branch protection rule not saved",
          fieldErrors: { branchName: "Branch name pattern is required" },
        });
      }
      const existing = resolved.view.branchProtectionRules.find(
        (rule) => rule.branchName === branchName,
      );
      if (existing) {
        existing.requireApproval = body?.requireApproval === true;
        existing.requireStatusCheck = body?.requireStatusCheck === true;
      } else {
        resolved.view.branchProtectionRules.push({
          branchName,
          requireApproval: body?.requireApproval === true,
          requireStatusCheck: body?.requireStatusCheck === true,
        });
      }
      resolved.view.branchProtectionRules.sort((left, right) =>
        left.branchName.localeCompare(right.branchName),
      );
      const rules = resolved.view.branchProtectionRules.map((rule, index) => ({
        id: `branch-protection-${resolved.view.name}-${index + 1}`,
        branchName: rule.branchName,
        requireApproval: rule.requireApproval === true,
        requireStatusCheck: rule.requireStatusCheck === true,
        requirements: [
          rule.requireApproval === true ? "1 approval" : null,
          rule.requireStatusCheck === true ? "Require status check test" : null,
        ].filter(Boolean),
        updatedBy: sessionAccount?.username ?? null,
        updatedAt: new Date().toISOString(),
      }));
      return jsonResponse(200, { branchProtectionRules: rules });
    }

    const branchesPath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/branches$/.exec(url.pathname);
    if (branchesPath) {
      if (method !== "POST") return jsonResponse(404, { error: "Not found" });
      const owner = decodeURIComponent(branchesPath[1]);
      const repositoryName = decodeURIComponent(branchesPath[2]);
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
      if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
      const role = viewerRoleFor(owner, resolved);
      if (role === null || !WRITE_ROLES.has(role)) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const wanted = String(body?.name ?? "");
      const problem = branchNameProblem(wanted);
      if (problem) {
        return jsonResponse(400, { error: "Branch not created", fieldErrors: { name: problem } });
      }
      if (resolved.view.branches.includes(wanted)) {
        return jsonResponse(400, {
          error: "Branch not created",
          fieldErrors: { name: "Branch already exists" },
        });
      }
      const base = String(body?.base ?? "") || resolved.view.defaultBranch;
      if (!resolved.view.branches.includes(base)) {
        return jsonResponse(400, {
          error: "Branch not created",
          fieldErrors: { base: "Base branch not found" },
        });
      }
      resolved.view.branches.push(wanted);
      resolved.view.branchHeads[wanted] = resolved.view.branchHeads[base];
      return jsonResponse(201, {
        branch: {
          id: `branch-${wanted}`,
          name: wanted,
          commitId: resolved.view.branchHeads[wanted] ?? null,
        },
        branches: [...resolved.view.branches],
      });
    }

    const filesPath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/files$/.exec(url.pathname);
    if (filesPath) {
      if (method !== "POST") return jsonResponse(404, { error: "Not found" });
      const owner = decodeURIComponent(filesPath[1]);
      const repositoryName = decodeURIComponent(filesPath[2]);
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
      if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
      const role = viewerRoleFor(owner, resolved);
      if (role === null || !WRITE_ROLES.has(role)) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const rawPath = typeof body?.path === "string" ? body.path : "";
      const previousPath =
        typeof body?.previousPath === "string" ? body.previousPath.trim() : "";
      const fieldErrors: Record<string, string> = {};
      const pathProblem = filePathProblem(rawPath);
      if (pathProblem) fieldErrors.path = pathProblem;
      const messageProblem = commitMessageProblem(String(body?.message ?? ""));
      if (messageProblem) fieldErrors.message = messageProblem;
      if (Object.keys(fieldErrors).length > 0) {
        return jsonResponse(400, { error: "File not saved", fieldErrors });
      }
      const branchName = String(body?.branch ?? "") || resolved.view.defaultBranch;
      if (!resolved.view.branches.includes(branchName)) {
        return jsonResponse(404, { error: "Not found" });
      }
      const headSha = resolved.view.branchHeads[branchName];
      const head = resolved.view.commits.find((commit) => commit.sha === headSha) ?? null;
      const snapshot = (head?.files ?? []).map((file) => ({ ...file }));
      const path = rawPath.trim();
      const conflict = snapshot.some((file) => {
        if (previousPath.length > 0 && file.path === previousPath) return false;
        return (
          file.path === path ||
          file.path.startsWith(`${path}/`) ||
          path.startsWith(`${file.path}/`)
        );
      });
      if (conflict) {
        return jsonResponse(400, {
          error: "File not saved",
          fieldErrors: { path: "Invalid file path" },
        });
      }
      const files = snapshot.filter(
        (file) => previousPath.length === 0 || file.path !== previousPath,
      );
      const existing = files.find((file) => file.path === path);
      if (existing) existing.content = String(body?.content ?? "");
      else files.push({ path, content: String(body?.content ?? "") });
      const sha = `c${(resolved.view.commits.length + 1).toString(36)}${Date.now().toString(36).slice(-4)}`;
      const commit = {
        sha,
        message: String(body?.message ?? "").trim(),
        author: sessionAccount.username,
        createdAt: new Date().toISOString(),
        parentSha: headSha ?? null,
        files,
      };
      resolved.view.commits.push(commit);
      resolved.view.branchHeads[branchName] = sha;
      return jsonResponse(201, {
        commit: {
          id: `commit-${sha}`,
          sha,
          shortSha: sha,
          message: commit.message,
          author: commit.author,
          parentId: headSha ? `commit-${headSha}` : null,
          createdAt: commit.createdAt,
        },
        branch: branchName,
        path,
      });
    }

    const visibilityPath = /^\/api\/repositories\/([^/]+)\/([^/]+)\/visibility$/.exec(url.pathname);
    if (visibilityPath && (method === "POST" || method === "PUT" || method === "PATCH")) {
      const owner = decodeURIComponent(visibilityPath[1]);
      const repositoryName = decodeURIComponent(visibilityPath[2]);
      if (!sessionAccount) return jsonResponse(401, { error: "Not authenticated" });
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
      const viewerRole =
        resolved.ownerType === "account"
          ? owner === sessionAccount.username
            ? "admin"
            : null
          : resolved.organization
            ? repositoryRole(resolved.organization, resolved.view as never)
            : null;
      if (viewerRole !== "admin") return jsonResponse(403, { error: "Access denied" });
      const visibility = String(body?.visibility ?? "").trim().toLowerCase();
      if (visibility !== "public" && visibility !== "private") {
        return jsonResponse(400, {
          error: "Repository visibility not changed",
          fieldErrors: { visibility: "Visibility is invalid" },
        });
      }
      const confirmation = String(body?.confirmation ?? "").trim();
      if (confirmation.length > 0 && confirmation.toLowerCase() !== resolved.view.name.toLowerCase()) {
        return jsonResponse(400, {
          error: "Repository visibility not changed",
          fieldErrors: { confirmation: "Repository name does not match" },
        });
      }
      resolved.view.visibility = visibility as "public" | "private";
      resolved.view.updatedAt = new Date().toISOString();
      return jsonResponse(200, { repository: repositoryPayload(owner, resolved) });
    }

    const repositoryPath = /^\/api\/repositories\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (repositoryPath && method === "GET") {
      const owner = decodeURIComponent(repositoryPath[1]);
      const repositoryName = decodeURIComponent(repositoryPath[2]);
      const resolved = repositoryView(owner, repositoryName);
      if (!resolved) return jsonResponse(404, { error: "Not found" });
      if (!canReadView(owner, resolved)) return jsonResponse(403, { error: "Access denied" });
      const viewerRole =
        resolved.ownerType === "account"
          ? owner === sessionAccount?.username
            ? "admin"
            : null
          : resolved.organization
            ? repositoryRole(resolved.organization, resolved.view as never)
            : null;
      return jsonResponse(200, {
        repository: repositoryPayload(owner, resolved),
        viewerRole,
        canAdminister: viewerRole === "admin",
      });
    }

    if (url.pathname === "/api/register" && method === "POST") {
      if (registerResponse) return jsonResponse(registerResponse.status, registerResponse.body);
      const account: StubAccount = {
        id: `account-${accounts.length + 1}`,
        username: body.username,
        email: body.email,
        password: body.password,
        emailVerified: true,
      };
      accounts.push(account);
      return jsonResponse(201, { account: publicAccount(account) });
    }
    return jsonResponse(404, { error: "Not found" });
  });

  return {
    accounts,
    calls,
    setRegisterResponse(status, body) {
      registerResponse = { status, body };
    },
  };
}
