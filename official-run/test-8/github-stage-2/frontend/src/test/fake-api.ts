import { vi } from "vitest";

import type {
  FakeAccount,
  FakeBranch,
  FakeBranchSeed,
  FakeCommit,
  FakeGrant,
  FakeOrganization,
  FakeOrganizationSeed,
  FakePersonalRepositorySeed,
  FakeRepository,
  FakeTeam,
} from "./fake-seed";

/**
 * Minimal in-memory stand-in for the account, organization and repository API.
 * It exists only to drive the frontend flows under test; the real input rules
 * and persistence are checked against the backend (see backend/test/*.test.mjs).
 * The seed fixture lives in `fake-seed.ts` and is re-exported here.
 */
export * from "./fake-seed";

export interface FakeApi {
  accounts: FakeAccount[];
  organizations: FakeOrganization[];
  /** Every repository of every namespace, personal ones included. */
  repositories: FakeRepository[];
  /** Direct grants on repositories of a personal namespace. */
  personalGrants: FakeGrant[];
  signedInId: string | null;
  registrationBodies: Array<Record<string, unknown>>;
  signOutCount: number;
}

export interface FakeApiOptions {
  organizations?: FakeOrganizationSeed[];
  personalRepositories?: FakePersonalRepositorySeed[];
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
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;
const WRITABLE_ROLES = ["write", "maintain", "admin"];

/** Mirrors the server branch-name rule so the selector can be driven in tests. */
function validBranchName(name: string): boolean {
  if (name.length < 1 || name.length > 255) return false;
  if (!BRANCH_NAME_PATTERN.test(name)) return false;
  if (name.endsWith("/") || name.endsWith(".")) return false;
  return !name.includes("..") && !name.includes("//");
}

/**
 * Builds the branches of one seeded fake repository. `branches` are processed in
 * order, so a branch with `base` continues the snapshot and history of an
 * earlier branch; a seed without `branches` keeps its flat files/commits as the
 * default branch.
 */
function buildBranches(seed: {
  defaultBranch?: string;
  files?: Array<{ path: string; content: string }>;
  commits?: FakeCommit[];
  branches?: FakeBranchSeed[];
}): FakeBranch[] {
  const defaultBranch = seed.defaultBranch ?? "main";
  if (!seed.branches || seed.branches.length === 0) {
    return [{
      name: defaultBranch,
      files: (seed.files ?? []).map((file) => ({ ...file })),
      commits: (seed.commits ?? []).map((commit) => ({ ...commit })),
    }];
  }
  const built: FakeBranch[] = [];
  for (const branch of seed.branches) {
    const base = branch.base ? built.find((candidate) => candidate.name === branch.base) : undefined;
    const snapshot = new Map((base?.files ?? []).map((file) => [file.path, file.content] as const));
    for (const commit of branch.commits ?? []) {
      for (const change of commit.changes ?? []) {
        if (change.content === null || change.content === undefined) snapshot.delete(change.path);
        else snapshot.set(change.path, change.content);
      }
    }
    for (const file of branch.files ?? []) snapshot.set(file.path, file.content ?? "");
    built.push({
      name: branch.name,
      files: [...snapshot].map(([path, content]) => ({ path, content })),
      commits: [...(base?.commits ?? []), ...(branch.commits ?? [])],
    });
  }
  return built;
}

export function installFakeApi(seed: FakeAccount[] = [], options: FakeApiOptions = {}): FakeApi {
  const api: FakeApi = {
    accounts: seed.map((account) => ({ ...account })),
    organizations: [],
    repositories: [],
    personalGrants: [],
    signedInId: null,
    registrationBodies: [],
    signOutCount: 0,
  };

  for (const [index, organization] of (options.organizations ?? []).entries()) {
    const organizationId = `org-${index + 1}`;
    const repositories: FakeRepository[] = organization.repositories.map((repository, repoIndex) => ({
      id: `repo-${index + 1}-${repoIndex + 1}`,
      ownerType: "organization",
      ownerLogin: organization.slug,
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility,
      defaultBranch: repository.defaultBranch ?? "main",
      updatedAt: repository.updatedAt,
      branches: buildBranches(repository),
    }));
    api.repositories.push(...repositories);
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

  for (const [index, repository] of (options.personalRepositories ?? []).entries()) {
    api.repositories.push({
      id: `personal-${index + 1}`,
      ownerType: "account",
      ownerLogin: repository.owner,
      name: repository.name,
      description: repository.description ?? "",
      visibility: repository.visibility,
      defaultBranch: repository.defaultBranch ?? "main",
      updatedAt: repository.updatedAt ?? "2024-08-01T08:00:00.000Z",
      branches: buildBranches(repository),
      forkedFrom: repository.forkedFrom,
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

  const findRepository = (ownerLogin: string, name: string) =>
    api.repositories.find((candidate) => candidate.ownerLogin === ownerLogin && candidate.name === name) ?? null;

  const organizationOf = (repository: FakeRepository) =>
    repository.ownerType === "organization" ? currentOrganization(repository.ownerLogin) : null;

  const ownerRef = (repository: FakeRepository) => {
    const organization = organizationOf(repository);
    return {
      type: repository.ownerType,
      id: organization?.id ?? accountIdOf(repository.ownerLogin) ?? repository.ownerLogin,
      login: repository.ownerLogin,
      displayName: organization?.displayName ?? repository.ownerLogin,
    };
  };

  /** Direct grants stored on that repository, personal namespaces included. */
  const grantsOf = (repository: FakeRepository) => {
    const organization = organizationOf(repository);
    if (organization) {
      return organization.repositoryGrants.filter((grant) => grant.repositoryName === repository.name);
    }
    return api.personalGrants.filter(
      (grant) => grant.ownerLogin === repository.ownerLogin && grant.repositoryName === repository.name,
    );
  };

  /** Effective repository role, mirroring the backend access rules. */
  const repositoryRole = (repository: FakeRepository): string | null => {
    if (repository.ownerType === "account") {
      if (accountIdOf(repository.ownerLogin) === api.signedInId) return "admin";
    } else {
      const organization = organizationOf(repository);
      if (!organization) return null;
      if (membership(organization)?.role === "owner") return "admin";
    }
    const grants = grantsOf(repository);
    const direct = grants.find(
      (grant) => grant.subjectType === "account" && accountIdOf(grant.subjectName) === api.signedInId,
    );
    if (direct) return direct.role;
    const myTeams = new Set(
      api.organizations
        .flatMap((organization) => organization.teamMembers)
        .filter((teamMember) => teamMember.accountId === api.signedInId)
        .map((teamMember) => teamMember.teamSlug),
    );
    const teamGrant = grants.find((grant) => grant.subjectType === "team" && myTeams.has(grant.subjectName));
    return teamGrant?.role ?? null;
  };

  const canRead = (repository: FakeRepository) =>
    repository.visibility === "public" || repositoryRole(repository) !== null;

  /** The branches of a fake repository, as the selector lists them. */
  const branchSummaries = (repository: FakeRepository) =>
    [...repository.branches]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((branch) => ({
        name: branch.name,
        headCommitId: branch.commits.length > 0 ? `${repository.id}-${branch.name}-commit-${branch.commits.length}` : null,
        isDefault: branch.name === repository.defaultBranch,
      }));

  const branchOf = (repository: FakeRepository, name: string) =>
    repository.branches.find((branch) => branch.name === name) ?? null;

  const canWrite = (repository: FakeRepository) => WRITABLE_ROLES.includes(repositoryRole(repository) ?? "");

  const repositoryPayload = (repository: FakeRepository) => {
    const source = repository.forkedFrom
      ? findRepository(repository.forkedFrom.ownerLogin, repository.forkedFrom.name)
      : null;
    return {
      id: repository.id,
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility,
      defaultBranch: repository.defaultBranch,
      updatedAt: repository.updatedAt,
      owner: ownerRef(repository),
      forkedFrom: repository.forkedFrom
        ? {
          id: source?.id ?? `${repository.forkedFrom.ownerLogin}/${repository.forkedFrom.name}`,
          name: repository.forkedFrom.name,
          owner: source
            ? ownerRef(source)
            : {
              type: "organization",
              id: repository.forkedFrom.ownerLogin,
              login: repository.forkedFrom.ownerLogin,
              displayName: repository.forkedFrom.ownerLogin,
            },
        }
        : null,
      readmePath: (branchOf(repository, repository.defaultBranch)?.files ?? [])
        .find((file) => file.path.toLowerCase() === "readme.md")?.path ?? null,
      role: repositoryRole(repository),
    };
  };

  /** Readable repositories across every namespace, mirroring the backend. */
  const readableRepositories = () =>
    api.repositories
      .filter(canRead)
      .map(repositoryPayload)
      .sort((left, right) =>
        left.name.localeCompare(right.name) || (left.owner?.login ?? "").localeCompare(right.owner?.login ?? ""),
      );

  /**
   * The commit chain of one branch as the fake stores it: deterministic ids so
   * a page reload finds the same commit, and the parent of each record is the
   * revision before it (newest last, like the real store).
   */
  const commitChain = (repository: FakeRepository, branch: string) =>
    (branchOf(repository, branch)?.commits ?? []).map((commit, index) => ({
      id: `${repository.id}-${branch}-commit-${index + 1}`,
      shortId: `${repository.id}-${branch}-commit-${index + 1}`.slice(0, 7),
      message: commit.message,
      author: commit.author ?? "",
      createdAt: commit.createdAt ?? repository.updatedAt,
      parentId: index > 0 ? `${repository.id}-${branch}-commit-${index}` : null,
      changes: commit.changes ?? [],
    }));

  /** The first commit of that id across the branches, with its branch name. */
  const findCommit = (repository: FakeRepository, id: string) => {
    for (const branch of repository.branches) {
      const commit = commitChain(repository, branch.name).find((candidate) => candidate.id === id);
      if (commit) return { branch: branch.name, commit };
    }
    return null;
  };

  /** The stored snapshot of one branch, as the tree and file endpoints read it. */
  const snapshotOf = (repository: FakeRepository, branch: string) => branchOf(repository, branch)?.files ?? [];

  const treeEntriesOf = (repository: FakeRepository, branch: string, path: string) => {
    const prefix = path ? `${path}/` : "";
    const directories = new Map<string, { name: string; path: string; type: string }>();
    const files = new Map<string, { name: string; path: string; type: string }>();
    for (const file of snapshotOf(repository, branch)) {
      if (prefix && !file.path.startsWith(prefix)) continue;
      const rest = file.path.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf("/");
      if (slash < 0) files.set(rest, { name: rest, path: file.path, type: "file" });
      else {
        const name = rest.slice(0, slash);
        directories.set(name, { name, path: `${prefix}${name}`, type: "directory" });
      }
    }
    return [...directories.values(), ...files.values()].sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  };

  const splitLines = (content: string | null | undefined) => {
    if (!content) return [] as string[];
    const lines = content.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };

  /** Line comparison of the base revision against the compared revision. */
  const diffLines = (base: string[], head: string[]) => {
    const lengths = Array.from({ length: base.length + 1 }, () => new Array(head.length + 1).fill(0));
    for (let row = base.length - 1; row >= 0; row -= 1) {
      for (let column = head.length - 1; column >= 0; column -= 1) {
        lengths[row][column] = base[row] === head[column]
          ? lengths[row + 1][column + 1] + 1
          : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
      }
    }
    const lines: Array<{ type: "context" | "add" | "remove"; text: string }> = [];
    let row = 0;
    let column = 0;
    while (row < base.length && column < head.length) {
      if (base[row] === head[column]) {
        lines.push({ type: "context", text: base[row] });
        row += 1;
        column += 1;
      } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
        lines.push({ type: "remove", text: base[row] });
        row += 1;
      } else {
        lines.push({ type: "add", text: head[column] });
        column += 1;
      }
    }
    while (row < base.length) lines.push({ type: "remove", text: base[row++] });
    while (column < head.length) lines.push({ type: "add", text: head[column++] });
    return lines;
  };

  /** File content at one commit, walking the chain for the introducing change. */
  const contentAt = (repository: FakeRepository, branch: string, path: string, commitId: string | null) => {
    const chain = commitChain(repository, branch);
    let index = commitId ? chain.findIndex((commit) => commit.id === commitId) : -1;
    while (index >= 0) {
      const change = chain[index].changes.find((candidate) => candidate.path === path);
      if (change) return change.content;
      index = chain[index].parentId ? chain.findIndex((commit) => commit.id === chain[index].parentId) : -1;
    }
    return undefined;
  };

  const commitSummaryOf = (commit: ReturnType<typeof commitChain>[number]) => ({
    id: commit.id,
    shortId: commit.shortId,
    message: commit.message,
    author: commit.author,
    createdAt: commit.createdAt,
    parentId: commit.parentId,
    changedFiles: commit.changes.length,
  });

  const commitDetailOf = (
    repository: FakeRepository,
    branch: string,
    commit: ReturnType<typeof commitChain>[number],
  ) => {
    const changes = commit.changes.map((change) => {
      const base = contentAt(repository, branch, change.path, commit.parentId);
      const head = contentAt(repository, branch, change.path, commit.id);
      const lines = diffLines(splitLines(base), splitLines(head));
      return {
        path: change.path,
        changeType: base === undefined ? "added" : head === null ? "removed" : "modified",
        additions: lines.filter((line) => line.type === "add").length,
        deletions: lines.filter((line) => line.type === "remove").length,
        lines,
      };
    });
    return {
      ...commitSummaryOf(commit),
      branch,
      changes,
      totals: {
        files: changes.length,
        additions: changes.reduce((total, change) => total + change.additions, 0),
        deletions: changes.reduce((total, change) => total + change.deletions, 0),
      },
    };
  };

  const repositoryNameErrors = (ownerLogin: string, name: string) => {
    if (name.length === 0) return { name: "Repository name is required" };
    if (api.repositories.some((candidate) => candidate.ownerLogin === ownerLogin && candidate.name === name)) {
      return { name: "Repository name already exists" };
    }
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return { name: "Repository name format is invalid" };
    return null;
  };

  const accessPayload = (repository: FakeRepository) => ({
    repository: repositoryPayload(repository),
    access: grantsOf(repository)
      .map((grant) => ({
        id: grant.id,
        subjectType: grant.subjectType,
        subjectName: grant.subjectName,
        role: grant.role,
      }))
      .sort((left, right) => left.subjectName.localeCompare(right.subjectName)),
    candidates: (() => {
      const organization = organizationOf(repository);
      return {
        teams: organization ? organization.teams.map((team) => team.slug).sort() : [],
        accounts: organization
          ? organization.members
            .map((member) => api.accounts.find((candidate) => candidate.id === member.accountId)?.username ?? "")
            .filter(Boolean)
            .sort()
          : [],
      };
    })(),
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
    const pathname = url.split("?")[0];
    const segments = pathname.split("/").filter(Boolean);

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
        .filter((organization) => api.repositories.some(
          (repository) => repository.ownerLogin === organization.slug && repository.visibility === "public",
        ))
        .map((organization) => ({ ...organizationSummary(organization), role: null }));
      return jsonResponse(200, { organizations });
    }
    if (url === "/api/public/repositories" && method === "GET") {
      const repositories = api.repositories
        .filter((repository) => repository.visibility === "public")
        .map((repository) => ({ ...repositoryPayload(repository), role: null }))
        .sort((left, right) => left.name.localeCompare(right.name));
      return jsonResponse(200, { repositories });
    }
    if (url.startsWith("/api/search/repositories") && method === "GET") {
      const query = new URLSearchParams(url.split("?")[1] ?? "").get("q") ?? "";
      const value = query.trim().toLowerCase();
      const repositories = readableRepositories().filter((repository) => {
        if (!value) return true;
        const name = repository.name.toLowerCase();
        return (
          name.includes(value) ||
          `${repository.owner?.login ?? ""}/${name}`.includes(value) ||
          `${(repository.owner?.displayName ?? "").toLowerCase()}/${name}`.includes(value)
        );
      });
      return jsonResponse(200, { query, repositories });
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
      return jsonResponse(200, { repositories: readableRepositories() });
    }
    if (url === "/api/repositories" && method === "POST") {
      const account = currentAccount();
      if (!account) return jsonResponse(401, { error: "Authentication required" });
      const ownerLogin = String(body.owner ?? "").trim() || account.username;
      const name = String(body.name ?? "").trim();
      const visibility = String(body.visibility ?? "").trim().toLowerCase();
      const personal = ownerLogin === account.username;
      const organization = api.organizations.find((candidate) => candidate.slug === ownerLogin) ?? null;
      if (!personal && !organization) {
        return jsonResponse(400, { error: "Repository creation failed", fields: { owner: "Owner not found" } });
      }
      if (!personal && membership(organization!)?.role !== "owner") {
        return jsonResponse(403, { error: "You do not have permission to create repositories for this owner" });
      }
      const fields = repositoryNameErrors(ownerLogin, name)
        ?? (visibility === "public" || visibility === "private" ? null : { visibility: "Visibility is invalid" });
      if (fields) return jsonResponse(400, { error: "Repository creation failed", fields });
      const repository: FakeRepository = {
        id: `repo-new-${api.repositories.length + 1}`,
        ownerType: personal ? "account" : "organization",
        ownerLogin,
        name,
        description: String(body.description ?? "").trim(),
        visibility: visibility as "public" | "private",
        defaultBranch: "main",
        updatedAt: new Date().toISOString(),
        branches: [{ name: "main", files: [], commits: [] }],
      };
      if (body.initialize === true) {
        const branch = repository.branches[0];
        branch.files.push({ path: "README.md", content: `# ${name}\n` });
        branch.commits.push({ message: "Initial commit" });
      }
      api.repositories.push(repository);
      return jsonResponse(201, { repository: repositoryPayload(repository) });
    }
    if (segments[1] === "repositories" && segments.length >= 4) {
      const repository = findRepository(decodeURIComponent(segments[2]), decodeURIComponent(segments[3]));
      if (!repository) return jsonResponse(404, { error: "Not found" });

      if (segments.length === 4 && method === "GET") {
        if (!canRead(repository)) return jsonResponse(403, { error: "Access denied" });
        return jsonResponse(200, { repository: repositoryPayload(repository) });
      }

      if (segments.length >= 6 && segments[4] === "blob" && method === "GET") {
        if (!canRead(repository)) return jsonResponse(403, { error: "Access denied" });
        const branch = decodeURIComponent(segments[5]);
        const path = segments.slice(6).map((segment) => decodeURIComponent(segment)).join("/");
        if (!branchOf(repository, branch)) return jsonResponse(404, { error: "Branch not found" });
        const file = snapshotOf(repository, branch).find((candidate) => candidate.path === path);
        if (!file) return jsonResponse(404, { error: "File not found" });
        return jsonResponse(200, {
          repository: repositoryPayload(repository),
          branch,
          path: file.path,
          content: file.content,
        });
      }

      if (segments[4] === "tree" && method === "GET") {
        if (!canRead(repository)) return jsonResponse(403, { error: "Access denied" });
        const rest = segments.slice(5).map((segment) => decodeURIComponent(segment));
        const branch = rest[0] ?? repository.defaultBranch;
        const path = rest.slice(1).join("/");
        if (!branchOf(repository, branch)) return jsonResponse(404, { error: "Branch not found" });
        const entries = treeEntriesOf(repository, branch, path);
        if (path && entries.length === 0) return jsonResponse(404, { error: "File not found" });
        return jsonResponse(200, { repository: repositoryPayload(repository), branch, path, entries });
      }

      if (segments.length === 5 && segments[4] === "branches") {
        if (method === "GET") {
          if (!canRead(repository)) return jsonResponse(403, { error: "Access denied" });
          return jsonResponse(200, { repository: repositoryPayload(repository), branches: branchSummaries(repository) });
        }
        if (method === "POST") {
          const account = currentAccount();
          if (!account) return jsonResponse(401, { error: "Authentication required" });
          if (!canWrite(repository)) return jsonResponse(403, { error: "Access denied" });
          const name = String(body.name ?? "").trim();
          if (!validBranchName(name)) {
            return jsonResponse(400, { error: "Branch creation failed", fields: { name: "Invalid branch" } });
          }
          if (branchOf(repository, name)) {
            return jsonResponse(400, { error: "Branch creation failed", fields: { name: "Branch already exists" } });
          }
          const from = String(body.from ?? "").trim() || repository.defaultBranch;
          const base = branchOf(repository, from);
          repository.branches.push({
            name,
            files: (base?.files ?? []).map((file) => ({ ...file })),
            commits: [...(base?.commits ?? [])],
          });
          return jsonResponse(201, {
            repository: repositoryPayload(repository),
            branch: { name, headCommitId: null, isDefault: name === repository.defaultBranch },
            branches: branchSummaries(repository),
          });
        }
      }

      if (segments.length === 5 && segments[4] === "default-branch" && method === "POST") {
        const account = currentAccount();
        if (!account) return jsonResponse(401, { error: "Authentication required" });
        if (repositoryRole(repository) !== "admin") return jsonResponse(403, { error: "Access denied" });
        const branch = String(body.branch ?? "").trim();
        if (!branchOf(repository, branch)) {
          return jsonResponse(400, { error: "Default branch update failed", fields: { branch: "Branch not found" } });
        }
        repository.defaultBranch = branch;
        return jsonResponse(200, { repository: repositoryPayload(repository), branches: branchSummaries(repository) });
      }

      if (segments.length === 5 && segments[4] === "files" && method === "POST") {
        const account = currentAccount();
        if (!account) return jsonResponse(401, { error: "Authentication required" });
        if (!canWrite(repository)) return jsonResponse(403, { error: "Access denied" });
        const branch = String(body.branch ?? "").trim();
        const target = branchOf(repository, branch);
        if (!target) {
          return jsonResponse(400, { error: "File creation failed", fields: { branch: "Branch not found" } });
        }
        const path = String(body.path ?? "").trim();
        const message = String(body.message ?? "").trim();
        const content = typeof body.content === "string" ? body.content : "";
        const fields: Record<string, string> = {};
        const segmentsOfPath = path.split("/");
        if (
          !path
          || path.startsWith("/")
          || segmentsOfPath.some((segment) => segment === "" || segment === "." || segment === "..")
          || target.files.some((file) => file.path === path || file.path.startsWith(`${path}/`))
          || target.files.some((file) => path.startsWith(`${file.path}/`))
        ) {
          fields.path = "Invalid file path";
        }
        if (!message) fields.message = "Commit message is required";
        else if (message.length > 72) fields.message = "Commit message is too long";
        if (Object.keys(fields).length > 0) {
          return jsonResponse(400, { error: "File creation failed", fields });
        }
        target.files.push({ path, content });
        target.commits.push({ message, author: account.username, createdAt: new Date().toISOString(), changes: [{ path, content }] });
        return jsonResponse(201, {
          repository: repositoryPayload(repository),
          branch,
          path,
          content,
          commit: {
            id: `${repository.id}-${branch}-commit-${target.commits.length}`,
            shortId: `${repository.id}-${branch}-commit-${target.commits.length}`.slice(0, 7),
            message,
            author: account.username,
            createdAt: new Date().toISOString(),
            parentId: null,
            changedFiles: 1,
          },
        });
      }

      if (segments[4] === "commits" && segments.length >= 6 && method === "GET") {
        if (!canRead(repository)) return jsonResponse(403, { error: "Access denied" });
        const rest = segments.slice(5).map((segment) => decodeURIComponent(segment));
        const branch = rest[0];
        const path = rest.slice(1).join("/");
        if (!branchOf(repository, branch)) return jsonResponse(404, { error: "Branch not found" });
        const chain = commitChain(repository, branch)
          .filter((commit) => !path || commit.changes.some((change) => change.path === path))
          .reverse();
        return jsonResponse(200, {
          repository: repositoryPayload(repository),
          branch,
          path,
          count: commitChain(repository, branch).length,
          commits: chain.map(commitSummaryOf),
        });
      }

      if (segments[4] === "commit" && segments.length === 6 && method === "GET") {
        if (!canRead(repository)) return jsonResponse(403, { error: "Access denied" });
        const id = decodeURIComponent(segments[5]);
        const found = findCommit(repository, id);
        if (!found) return jsonResponse(404, { error: "Commit not found" });
        return jsonResponse(200, {
          repository: repositoryPayload(repository),
          commit: commitDetailOf(repository, found.branch, found.commit),
        });
      }

      if (segments[4] === "search" && segments.length === 5 && method === "GET") {
        if (!canRead(repository)) return jsonResponse(403, { error: "Access denied" });
        const query = new URLSearchParams(url.split("?")[1] ?? "").get("q") ?? "";
        const needle = query.trim().toLowerCase();
        const matches = needle
          ? snapshotOf(repository, repository.defaultBranch).flatMap((file) => {
            const lines = splitLines(file.content)
              .map((text, index) => ({ number: index + 1, text }))
              .filter((line) => line.text.toLowerCase().includes(needle));
            return lines.length > 0 ? [{ path: file.path, lines }] : [];
          })
          : [];
        return jsonResponse(200, {
          repository: repositoryPayload(repository),
          branch: repository.defaultBranch,
          query,
          matches,
        });
      }

      if (segments.length === 5 && segments[4] === "fork" && method === "POST") {
        const account = currentAccount();
        if (!account) return jsonResponse(401, { error: "Authentication required" });
        if (!canRead(repository)) return jsonResponse(403, { error: "Access denied" });
        const targetLogin = String(body.owner ?? "").trim() || account.username;
        const personalTarget = targetLogin === account.username;
        const targetOrganization = api.organizations.find((candidate) => candidate.slug === targetLogin) ?? null;
        if (!personalTarget && membership(targetOrganization!)?.role !== "owner") {
          return jsonResponse(403, { error: "Access denied" });
        }
        const name = String(body.name ?? "").trim() || repository.name;
        const fields = repositoryNameErrors(targetLogin, name);
        if (fields) return jsonResponse(400, { error: "Fork failed", fields });
        const requested = String(body.visibility ?? repository.visibility).trim().toLowerCase();
        const fork: FakeRepository = {
          id: `repo-fork-${api.repositories.length + 1}`,
          ownerType: personalTarget ? "account" : "organization",
          ownerLogin: targetLogin,
          name,
          description: repository.description,
          visibility: repository.visibility === "private" ? "private" : requested === "private" ? "private" : "public",
          defaultBranch: repository.defaultBranch,
          updatedAt: new Date().toISOString(),
          branches: repository.branches.map((branch) => ({
            name: branch.name,
            files: branch.files.map((file) => ({ ...file })),
            commits: branch.commits.map((commit) => ({ ...commit })),
          })),
          forkedFrom: { ownerLogin: repository.ownerLogin, name: repository.name },
        };
        api.repositories.push(fork);
        return jsonResponse(201, { repository: repositoryPayload(fork) });
      }

      if (segments.length === 5 && segments[4] === "visibility" && method === "POST") {
        if (repositoryRole(repository) !== "admin") return jsonResponse(403, { error: "Access denied" });
        const visibility = String(body.visibility ?? "").trim().toLowerCase();
        if (visibility !== "public" && visibility !== "private") {
          return jsonResponse(400, { error: "Visibility update failed", fields: { visibility: "Visibility is invalid" } });
        }
        repository.visibility = visibility;
        return jsonResponse(200, { repository: repositoryPayload(repository) });
      }

      if (segments[4] === "access") {
        if (repositoryRole(repository) !== "admin") return jsonResponse(403, { error: "Access denied" });
        const organization = organizationOf(repository);
        if (segments.length === 5 && method === "GET") {
          return jsonResponse(200, accessPayload(repository));
        }
        if (segments.length === 5 && method === "POST") {
          const subjectType = body.subjectType === "team" ? "team" : "account";
          const name = String(body.name ?? "").trim();
          const role = String(body.role ?? "").trim().toLowerCase();
          if (!["read", "triage", "write", "maintain", "admin"].includes(role)) {
            return jsonResponse(400, { error: "Access update failed", fields: { role: "Role is invalid" } });
          }
          const subjectExists = subjectType === "team"
            ? Boolean(organization?.teams.some((team) => team.slug === name))
            : Boolean(accountIdOf(name));
          if (!subjectExists) {
            return jsonResponse(400, {
              error: "Access update failed",
              fields: { name: subjectType === "team" ? "Team not found" : "Account not found" },
            });
          }
          const grants = organization ? organization.repositoryGrants : api.personalGrants;
          const existing = grants.find(
            (grant) => grant.repositoryName === repository.name && grant.subjectType === subjectType && grant.subjectName === name,
          );
          if (existing) existing.role = role;
          else {
            grants.push({
              id: `grant-${grants.length + 1}-new`,
              repositoryName: repository.name,
              subjectType,
              subjectName: name,
              role,
              ownerLogin: organization ? undefined : repository.ownerLogin,
            });
          }
          return jsonResponse(200, accessPayload(repository));
        }
        if (segments.length === 6 && method === "PATCH") {
          const grants = organization ? organization.repositoryGrants : api.personalGrants;
          const grant = grants.find(
            (candidate) => candidate.id === decodeURIComponent(segments[5]) && candidate.repositoryName === repository.name,
          );
          if (!grant) return jsonResponse(404, { error: "Not found" });
          const role = String(body.role ?? "").trim().toLowerCase();
          if (!["read", "triage", "write", "maintain", "admin"].includes(role)) {
            return jsonResponse(400, { error: "Access update failed", fields: { role: "Role is invalid" } });
          }
          grant.role = role;
          return jsonResponse(200, accessPayload(repository));
        }
      }

      return jsonResponse(404, { error: "Not found" });
    }

    if (segments[1] === "organizations" && segments.length >= 3) {
      const organization = currentOrganization(decodeURIComponent(segments[2]));
      if (!organization) return jsonResponse(404, { error: "Not found" });
      const member = membership(organization);
      const organizationRepositories = api.repositories.filter(
        (repository) => repository.ownerType === "organization" && repository.ownerLogin === organization.slug,
      );
      const isPublic = organizationRepositories.some((repository) => repository.visibility === "public");

      if (segments.length === 3 && method === "GET") {
        if (!currentAccount() && !isPublic) return jsonResponse(403, { error: "Access denied" });
        return jsonResponse(200, { organization: organizationSummary(organization) });
      }
      if (segments.length === 4 && segments[3] === "repositories" && method === "GET") {
        if (!currentAccount() && !isPublic) return jsonResponse(403, { error: "Access denied" });
        const repositories = organizationRepositories
          .filter(canRead)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(repositoryPayload);
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
