// Persisted organization, team, membership and repository-access state.
//
// Identity rules used throughout this module:
// - an organization is identified by its globally unique lowercase identifier;
// - a team is identified by its organization plus its name;
// - a repository is identified by its owner plus its name.
//
// Access to a private repository is granted only by organization Owner status,
// a direct grant to the account, or a direct team membership of a team that
// holds a grant. Organization membership alone never implies repository access.

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createJsonStore } from "./json-store.mjs";
import { createIssueStore } from "./issue-store.mjs";
import { createPullRequestStore } from "./pull-request-store.mjs";
import { INITIAL_COMMIT_MESSAGE, createSeedState, organizationSeedUpgrade } from "./org-seeds.mjs";
import { TRIAGE_ROLES, WRITE_ROLES } from "./org-rules.mjs";
import { createReleaseStore } from "./release-store.mjs";
import {
  defaultBranchName,
  getRepositoryCommit,
  getRepositoryFile,
  getRepositoryReadmePath,
  listBranchRecords,
  listRepositoryCommits,
  listRepositoryTree,
  searchRepositoryCode,
} from "./repository-code-store.mjs";

const COLLECTIONS = [
  "organizations",
  "memberships",
  "teams",
  "teamMembers",
  "repositories",
  "branches",
  "commits",
  "accessGrants",
  "labels",
  "milestones",
  "issues",
  "issueComments",
  "issueEvents",
  "issueReactions",
  "pullRequests",
  "pullRequestComments",
  "pullRequestEvents",
  "pullRequestReviews",
  "branchProtectionRules",
  "organizationAuditEvents",
  "releases",
];

function publicOrganization(organization) {
  if (!organization) return null;
  return { id: organization.id, displayName: organization.displayName };
}

function publicTeam(state, team) {
  if (!team) return null;
  const parent = team.parentTeamId
    ? state.teams.find((entry) => entry.id === team.parentTeamId)
    : null;
  return { id: team.id, name: team.name, parentName: parent ? parent.name : null };
}

export function publicRepository(repository) {
  if (!repository) return null;
  return {
    id: repository.id,
    name: repository.name,
    description: repository.description ?? "",
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch ?? "main",
    forkOfRepositoryId: repository.forkOfRepositoryId ?? null,
    // Archived status of the persisted record (REQ-3-5): the overview badge and
    // the read-only affordances read the same stored field.
    archived: repository.archived === true,
    updatedAt: repository.updatedAt,
  };
}

/** The persisted branch protection rule, as the settings view reads it. */
export function publicBranchProtectionRule(rule) {
  if (!rule) return null;
  return {
    id: rule.id,
    branchName: rule.branchName,
    requireApprovals: rule.requireApprovals === true,
    requireStatusCheck: rule.requireStatusCheck === true,
    statusCheckName: rule.statusCheckName ?? (rule.requireStatusCheck ? "test" : null),
  };
}

function membershipOf(state, organizationId, accountId) {
  if (!accountId) return null;
  return (
    state.memberships.find(
      (entry) => entry.organizationId === organizationId && entry.accountId === accountId,
    ) ?? null
  );
}

function teamIdsOfAccount(state, accountId) {
  return new Set(
    state.teamMembers.filter((entry) => entry.accountId === accountId).map((entry) => entry.teamId),
  );
}

/**
 * Pure read check shared by the repository list, the repository detail and the
 * workspace entry points. `accountId` is null for an unauthenticated visitor.
 */
function readAllowed(state, repository, accountId) {
  if (repository.visibility === "public") return true;
  if (!accountId) return false;
  if (repository.ownerType === "account" && repository.ownerId === accountId) return true;
  if (repository.ownerType === "organization") {
    const membership = state.memberships.find(
      (entry) => entry.organizationId === repository.ownerId && entry.accountId === accountId,
    );
    if (membership?.role === "Owner") return true;
  }
  const grantedDirectly = state.accessGrants.some(
    (grant) => grant.repositoryId === repository.id && grant.subjectType === "account" && grant.subjectId === accountId,
  );
  if (grantedDirectly) return true;
  const teamIds = new Set(
    state.teamMembers.filter((entry) => entry.accountId === accountId).map((entry) => entry.teamId),
  );
  return state.accessGrants.some(
    (grant) => grant.repositoryId === repository.id && grant.subjectType === "team" && teamIds.has(grant.subjectId),
  );
}

/**
 * Write check: an organization Owner, the repository owner, or a subject
 * holding a Write, Maintain or Admin grant may create commits and branches.
 * Read and Triage may browse but never write, so these roles are per-operation
 * and not a cumulative ladder.
 */
function writeAllowed(state, repository, accountId) {
  if (!accountId) return false;
  if (repository.ownerType === "account" && repository.ownerId === accountId) return true;
  if (repository.ownerType === "organization") {
    if (membershipOf(state, repository.ownerId, accountId)?.role === "Owner") return true;
  }
  const writable = (grant) =>
    grant.repositoryId === repository.id &&
    WRITE_ROLES.includes(grant.role) &&
    ((grant.subjectType === "account" && grant.subjectId === accountId) ||
      (grant.subjectType === "team" && teamIdsOfAccount(state, accountId).has(grant.subjectId)));
  return state.accessGrants.some(writable);
}

/**
 * Triage check: the issue-metadata operations (assigning, labelling, setting a
 * milestone and changing status) need Triage, Maintain or Admin, or an
 * organization Owner. Write alone is not enough, and Triage cannot create or
 * comment, so these roles are per-operation rather than a cumulative ladder.
 */
function triageAllowed(state, repository, accountId) {
  if (!accountId) return false;
  if (repository.ownerType === "account" && repository.ownerId === accountId) return true;
  if (repository.ownerType === "organization") {
    if (membershipOf(state, repository.ownerId, accountId)?.role === "Owner") return true;
  }
  const teamIds = teamIdsOfAccount(state, accountId);
  return state.accessGrants.some(
    (grant) =>
      grant.repositoryId === repository.id &&
      TRIAGE_ROLES.includes(grant.role) &&
      ((grant.subjectType === "account" && grant.subjectId === accountId) ||
        (grant.subjectType === "team" && teamIds.has(grant.subjectId))),
  );
}

/**
 * Manage-access check: only an organization Owner, the repository owner, or a
 * subject holding an Admin grant on this repository may change its access.
 * Admin is an operation-specific role, not an automatic top of read access.
 */
function manageAllowed(state, repository, accountId) {
  if (!accountId) return false;
  if (repository.ownerType === "account" && repository.ownerId === accountId) return true;
  if (repository.ownerType === "organization") {
    if (membershipOf(state, repository.ownerId, accountId)?.role === "Owner") return true;
  }
  const isAdminGrant = (grant) =>
    grant.repositoryId === repository.id && grant.role === "Admin";
  if (
    state.accessGrants.some(
      (grant) => isAdminGrant(grant) && grant.subjectType === "account" && grant.subjectId === accountId,
    )
  ) {
    return true;
  }
  const teamIds = teamIdsOfAccount(state, accountId);
  return state.accessGrants.some(
    (grant) => isAdminGrant(grant) && grant.subjectType === "team" && teamIds.has(grant.subjectId),
  );
}

/**
 * Merge/maintain check: the pull-request review and merge operations need
 * Maintain or Admin, or an organization Owner. Write alone is not enough, so
 * these roles stay per-operation rather than a cumulative ladder.
 */
function maintainAllowed(state, repository, accountId) {
  if (!accountId) return false;
  if (repository.ownerType === "account" && repository.ownerId === accountId) return true;
  if (repository.ownerType === "organization") {
    if (membershipOf(state, repository.ownerId, accountId)?.role === "Owner") return true;
  }
  const teamIds = teamIdsOfAccount(state, accountId);
  return state.accessGrants.some(
    (grant) =>
      grant.repositoryId === repository.id &&
      (grant.role === "Maintain" || grant.role === "Admin") &&
      ((grant.subjectType === "account" && grant.subjectId === accountId) ||
        (grant.subjectType === "team" && teamIds.has(grant.subjectId))),
  );
}

export function createOrgStore(dataDir) {
  const store = createJsonStore(join(dataDir, "organizations.json"), createSeedState());
  // Runs once per store instance: an empty directory keeps the full seed, an
  // existing file written by an older build receives only the seeds still
  // missing by stable id (see `organizationSeedUpgrade`).
  const ready = Promise.resolve(store.update(organizationSeedUpgrade)).catch(() => undefined);
  // The issue records and the pull requests share the same file (and the same
  // serialized writer) as the organizations they belong to.
  const issueStore = createIssueStore(store);
  const pullRequestStore = createPullRequestStore(store);
  const releaseStore = createReleaseStore(store);

  /**
   * Appends one audit event inside an in-flight store update. It is called from
   * the same mutation that performs the organization action, so the record and
   * the action it describes are written atomically.
   */
  function appendAuditEvent(draft, { organizationId, actorName, action, target }) {
    if (!Array.isArray(draft.organizationAuditEvents)) draft.organizationAuditEvents = [];
    draft.organizationAuditEvents.push({
      id: `audit-${randomUUID()}`,
      organizationId,
      actorName: actorName ?? null,
      action,
      target,
      createdAt: new Date().toISOString(),
    });
  }

  async function readState() {
    await ready;
    const state = await store.read();
    for (const key of COLLECTIONS) {
      if (!Array.isArray(state[key])) state[key] = [];
    }
    return state;
  }

  const listMemberships = (state, organizationId) =>
    state.memberships.filter((entry) => entry.organizationId === organizationId);

  return {
    dataDir,
    ...issueStore,
    ...pullRequestStore,
    ...releaseStore,

    async listOrganizationsForAccount(accountId) {
      if (!accountId) return [];
      const state = await readState();
      return state.memberships
        .filter((entry) => entry.accountId === accountId)
        .map((entry) => {
          const organization = state.organizations.find((candidate) => candidate.id === entry.organizationId);
          return organization ? { ...publicOrganization(organization), role: entry.role } : null;
        })
        .filter(Boolean);
    },

    async listAllOrganizations() {
      const state = await readState();
      return state.organizations.map(publicOrganization);
    },

    /** Organizations a visitor may open: those with at least one public repository. */
    async listPublicOrganizations() {
      const state = await readState();
      return state.organizations
        .filter((organization) =>
          state.repositories.some(
            (repository) =>
              repository.ownerType === "organization" &&
              repository.ownerId === organization.id &&
              repository.visibility === "public",
          ),
        )
        .map(publicOrganization);
    },

    /**
     * The persisted audit events of one organization, newest first. The list is
     * read-only: it is a record of past actions, so viewing or filtering it
     * never changes the organization state.
     */
    async listOrganizationAuditEvents(organizationId) {
      const state = await readState();
      return state.organizationAuditEvents
        .filter((entry) => entry.organizationId === organizationId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .map((entry) => ({
          id: entry.id,
          actor: entry.actorName ?? "",
          action: entry.action,
          target: entry.target ?? "",
          createdAt: entry.createdAt,
        }));
    },

    async getOrganization(organizationId) {
      const state = await readState();
      return publicOrganization(state.organizations.find((entry) => entry.id === organizationId));
    },

    async organizationExists(organizationId) {
      const state = await readState();
      return state.organizations.some((entry) => entry.id === organizationId);
    },

    async hasPublicRepository(organizationId) {
      const state = await readState();
      return state.repositories.some(
        (repository) =>
          repository.ownerType === "organization" &&
          repository.ownerId === organizationId &&
          repository.visibility === "public",
      );
    },

    async getMembership(organizationId, accountId) {
      if (!accountId) return null;
      const state = await readState();
      return listMemberships(state, organizationId).find((entry) => entry.accountId === accountId) ?? null;
    },

    async listMembers(organizationId) {
      const state = await readState();
      return listMemberships(state, organizationId).map((entry) => ({ accountId: entry.accountId, role: entry.role }));
    },

    /** Creates the organization plus the creating account's Owner membership. */
    async createOrganization({ name, displayName, ownerAccountId }) {
      let created = null;
      await store.update((draft) => {
        if (!Array.isArray(draft.organizations)) draft.organizations = [];
        if (!Array.isArray(draft.memberships)) draft.memberships = [];
        if (draft.organizations.some((entry) => entry.id === name)) return;
        const organization = { id: name, displayName, createdAt: new Date().toISOString() };
        draft.organizations.push(organization);
        draft.memberships.push({ organizationId: name, accountId: ownerAccountId, role: "Owner" });
        created = publicOrganization(organization);
      });
      return created;
    },

    /** Raw direct access grants of one repository (subjects are ids). */
    async listAccessGrants(repositoryId) {
      const state = await readState();
      return state.accessGrants
        .filter((grant) => grant.repositoryId === repositoryId)
        .map((grant) => ({ ...grant }));
    },

    /**
     * Creates a direct grant, or updates the role of the existing one so the
     * same subject never accumulates duplicate rows.
     */
    async upsertAccessGrant({ repositoryId, subjectType, subjectId, role }) {
      let saved = null;
      await store.update((draft) => {
        if (!Array.isArray(draft.accessGrants)) draft.accessGrants = [];
        const existing = draft.accessGrants.find(
          (grant) =>
            grant.repositoryId === repositoryId &&
            grant.subjectType === subjectType &&
            grant.subjectId === subjectId,
        );
        if (existing) {
          existing.role = role;
          saved = { ...existing };
          return;
        }
        const grant = { id: `grant-${randomUUID()}`, repositoryId, subjectType, subjectId, role };
        draft.accessGrants.push(grant);
        saved = { ...grant };
      });
      return saved;
    },

    /** Updates the role of one existing grant in place; no duplicate row. */
    async updateAccessGrantRole({ repositoryId, grantId, role }) {
      let result = { ok: false, grant: null };
      await store.update((draft) => {
        const grant = (draft.accessGrants ?? []).find(
          (entry) => entry.repositoryId === repositoryId && entry.id === grantId,
        );
        if (!grant) return;
        grant.role = role;
        result = { ok: true, grant: { ...grant } };
      });
      return result;
    },

    /** Adds an existing account to the organization with Member or Owner role. */
    async addOrganizationMember({ organizationId, accountId, role, actorName, targetName }) {
      let result = { ok: false, reason: "already-member" };
      await store.update((draft) => {
        if (!Array.isArray(draft.memberships)) draft.memberships = [];
        const exists = draft.memberships.some(
          (entry) => entry.organizationId === organizationId && entry.accountId === accountId,
        );
        if (exists) return;
        draft.memberships.push({ organizationId, accountId, role });
        appendAuditEvent(draft, {
          organizationId,
          actorName,
          action: "Member added",
          target: targetName ?? accountId,
        });
        result = { ok: true };
      });
      return result;
    },

    /**
     * Atomically removes the organization membership together with every team
     * membership and direct account grant of that account inside the
     * organization. Team grants are left untouched. Removing the last Owner is
     * rejected and writes nothing.
     */
    async removeOrganizationMember({ organizationId, accountId }) {
      let result = { ok: false, reason: "not-a-member" };
      await store.update((draft) => {
        const memberships = Array.isArray(draft.memberships) ? draft.memberships : [];
        const membership = memberships.find(
          (entry) => entry.organizationId === organizationId && entry.accountId === accountId,
        );
        if (!membership) return;
        const owners = memberships.filter(
          (entry) => entry.organizationId === organizationId && entry.role === "Owner",
        );
        if (membership.role === "Owner" && owners.length <= 1) {
          result = { ok: false, reason: "last-owner" };
          return;
        }
        draft.memberships = memberships.filter(
          (entry) => !(entry.organizationId === organizationId && entry.accountId === accountId),
        );
        if (Array.isArray(draft.teamMembers)) {
          const teamIds = new Set(
            (draft.teams ?? []).filter((team) => team.organizationId === organizationId).map((team) => team.id),
          );
          draft.teamMembers = draft.teamMembers.filter(
            (entry) => !(teamIds.has(entry.teamId) && entry.accountId === accountId),
          );
        }
        if (Array.isArray(draft.accessGrants)) {
          const repositoryIds = new Set(
            (draft.repositories ?? [])
              .filter((repository) => repository.ownerType === "organization" && repository.ownerId === organizationId)
              .map((repository) => repository.id),
          );
          draft.accessGrants = draft.accessGrants.filter(
            (grant) =>
              !(
                repositoryIds.has(grant.repositoryId) &&
                grant.subjectType === "account" &&
                grant.subjectId === accountId
              ),
          );
        }
        result = { ok: true };
      });
      return result;
    },

    async listRepositories(organizationId) {
      const state = await readState();
      return state.repositories.filter(
        (repository) => repository.ownerType === "organization" && repository.ownerId === organizationId,
      );
    },

    async getRepository({ organizationId, name }) {
      const state = await readState();
      return (
        state.repositories.find(
          (repository) =>
            repository.ownerType === "organization" &&
            repository.ownerId === organizationId &&
            repository.name === name,
        ) ?? null
      );
    },

    async getRepositoryByOwner({ ownerType, ownerId, name }) {
      const state = await readState();
      return (
        state.repositories.find(
          (repository) =>
            repository.ownerType === ownerType && repository.ownerId === ownerId && repository.name === name,
        ) ?? null
      );
    },

    async getRepositoryById(repositoryId) {
      const state = await readState();
      return state.repositories.find((repository) => repository.id === repositoryId) ?? null;
    },

    async repositoryExists({ ownerType, ownerId, name }) {
      const state = await readState();
      return state.repositories.some(
        (repository) =>
          repository.ownerType === ownerType && repository.ownerId === ownerId && repository.name === name,
      );
    },

    /**
     * Creation permission per namespace: an account may create repositories in
     * its own personal namespace, and an organization Owner may create them for
     * the organization. Ordinary members hold no creation permission.
     */
    async canCreateRepository({ ownerType, ownerId, accountId }) {
      if (!accountId) return false;
      const state = await readState();
      if (ownerType === "account") return ownerId === accountId;
      if (ownerType === "organization") {
        return state.memberships.some(
          (entry) =>
            entry.organizationId === ownerId && entry.accountId === accountId && entry.role === "Owner",
        );
      }
      return false;
    },

    /**
     * Atomically stores the repository, its default branch and — when
     * initialization is requested — the initial commit with the README file. A
     * failed uniqueness check writes nothing, so no partially created repository
     * can exist. Returns null when the name is already used in that namespace.
     */
    async createRepository({
      ownerType,
      ownerId,
      name,
      description,
      visibility,
      initialize,
      creatorAccountId,
      creatorName,
    }) {
      let created = null;
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!Array.isArray(draft.repositories)) draft.repositories = [];
        if (!Array.isArray(draft.branches)) draft.branches = [];
        if (!Array.isArray(draft.commits)) draft.commits = [];
        if (
          draft.repositories.some(
            (entry) =>
              entry.ownerType === ownerType && entry.ownerId === ownerId && entry.name === name,
          )
        ) {
          return;
        }
        const repository = {
          id: `repo-${randomUUID()}`,
          ownerType,
          ownerId,
          name,
          description: description ?? "",
          visibility,
          defaultBranch: "main",
          forkOfRepositoryId: null,
          creatorAccountId: creatorAccountId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        draft.repositories.push(repository);
        let headCommitId = null;
        if (initialize) {
          const commit = {
            id: `commit-${randomUUID()}`,
            repositoryId: repository.id,
            branch: "main",
            message: INITIAL_COMMIT_MESSAGE,
            authorName: creatorName,
            authorAccountId: creatorAccountId ?? null,
            createdAt: now,
            parentCommitId: null,
            files: [{ path: "README.md", content: `# ${name}\n` }],
          };
          draft.commits.push(commit);
          headCommitId = commit.id;
        }
        draft.branches.push({
          id: `branch-${randomUUID()}`,
          repositoryId: repository.id,
          name: "main",
          headCommitId,
          createdAt: now,
        });
        if (ownerType === "organization") {
          appendAuditEvent(draft, {
            organizationId: ownerId,
            actorName: creatorName ?? null,
            action: "Repository created",
            target: name,
          });
        }
        created = { ...repository };
      });
      return created;
    },

    /**
     * Atomically creates an independent fork: the repository record, the copied
     * default-branch history of the source and the new branch. The copies get
     * fresh ids, so a later change in the fork can never reach the source. The
     * caller has already checked both the read permission on the source and the
     * creation permission in the target namespace.
     */
    async forkRepository({
      sourceRepositoryId,
      ownerType,
      ownerId,
      name,
      visibility,
      creatorAccountId,
    }) {
      let created = null;
      let reason = "ok";
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!Array.isArray(draft.repositories)) draft.repositories = [];
        if (!Array.isArray(draft.branches)) draft.branches = [];
        if (!Array.isArray(draft.commits)) draft.commits = [];
        const source = draft.repositories.find((entry) => entry.id === sourceRepositoryId);
        if (!source) {
          reason = "source-missing";
          return;
        }
        if (
          draft.repositories.some(
            (entry) =>
              entry.ownerType === ownerType && entry.ownerId === ownerId && entry.name === name,
          )
        ) {
          reason = "duplicate";
          return;
        }
        const repository = {
          id: `repo-${randomUUID()}`,
          ownerType,
          ownerId,
          name,
          description: source.description ?? "",
          visibility,
          defaultBranch: source.defaultBranch ?? "main",
          forkOfRepositoryId: source.id,
          creatorAccountId: creatorAccountId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        draft.repositories.push(repository);
        const sourceCommits = draft.commits.filter(
          (entry) => entry.repositoryId === source.id && entry.branch === repository.defaultBranch,
        );
        let parentCommitId = null;
        for (const commit of sourceCommits) {
          const copy = {
            ...structuredClone(commit),
            id: `commit-${randomUUID()}`,
            repositoryId: repository.id,
            parentCommitId,
          };
          draft.commits.push(copy);
          parentCommitId = copy.id;
        }
        draft.branches.push({
          id: `branch-${randomUUID()}`,
          repositoryId: repository.id,
          name: repository.defaultBranch,
          headCommitId: parentCommitId,
          createdAt: now,
        });
        created = { ...repository };
      });
      return { ok: created !== null, reason, repository: created };
    },

    /**
     * Commit history of one branch (the default branch when none is named),
     * newest first. An optional `path` narrows the same history to the commits
     * that changed that file, which is what the file page's history link asks
     * for.
     */
    async listRepositoryCommits(repositoryId, { branch = "", path = "" } = {}) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return [];
      return listRepositoryCommits(state, repository, { branch, path });
    },

    /**
     * One commit with the file differences against its parent revision. The
     * comparison is derived from the stored snapshots, so opening it never
     * writes to the repository.
     */
    async getRepositoryCommit(repositoryId, commitId) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return null;
      return getRepositoryCommit(state, repository, commitId);
    },

    /**
     * Keyword search inside the readable file content of one branch. Only
     * content is searched, so a file name can never produce a match.
     */
    async searchRepositoryCode(repositoryId, { branch = "", query = "" } = {}) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return null;
      return searchRepositoryCode(state, repository, { branch, query });
    },

    /** Directory listing of one branch. `path` is "" for the root. */
    async listRepositoryTree(repositoryId, { branch = "", path = "" } = {}) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return null;
      return listRepositoryTree(state, repository, { branch, path });
    },

    /** One stored file of one branch, or null when it does not exist. */
    async getRepositoryFile(repositoryId, { branch = "", path = "" } = {}) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return null;
      return getRepositoryFile(state, repository, { branch, path });
    },

    /** Root README of one branch, or null when the branch has none. */
    async getRepositoryReadmePath(repositoryId, { branch = "" } = {}) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return null;
      return getRepositoryReadmePath(state, repository, { branch });
    },

    /** Branch names of one repository plus the branch read by default. */
    async listRepositoryBranches(repositoryId) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return null;
      return {
        defaultBranch: defaultBranchName(repository),
        branches: listBranchRecords(state, repositoryId),
      };
    },

    /**
     * Creates a branch pointing at the head commit of `baseBranch`; no file is
     * copied and the base branch keeps its own head. Returns the reason instead
     * of writing when the name is invalid or already used.
     */
    async createRepositoryBranch({ repositoryId, name, baseBranch }) {
      let result = { ok: false, reason: "repository-missing", branch: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!Array.isArray(draft.branches)) draft.branches = [];
        const repository = (draft.repositories ?? []).find((entry) => entry.id === repositoryId);
        if (!repository) return;
        if (draft.branches.some((entry) => entry.repositoryId === repositoryId && entry.name === name)) {
          result = { ok: false, reason: "duplicate", branch: null };
          return;
        }
        const baseName = baseBranch || defaultBranchName(repository);
        const base = draft.branches.find(
          (entry) => entry.repositoryId === repositoryId && entry.name === baseName,
        );
        if (!base) {
          result = { ok: false, reason: "base-missing", branch: null };
          return;
        }
        const branch = {
          id: `branch-${randomUUID()}`,
          repositoryId,
          name,
          headCommitId: base.headCommitId ?? null,
          createdAt: now,
        };
        draft.branches.push(branch);
        result = { ok: true, reason: "ok", branch: { ...branch } };
      });
      return result;
    },

    /**
     * Persists the default branch of one repository. The branches, their head
     * commits and the stored files stay untouched, so the previous default
     * branch remains readable under its own name.
     */
    async setRepositoryDefaultBranch({ repositoryId, branch }) {
      let result = { ok: false, reason: "repository-missing", repository: null };
      await store.update((draft) => {
        const repository = (draft.repositories ?? []).find((entry) => entry.id === repositoryId);
        if (!repository) return;
        const exists = (draft.branches ?? []).some(
          (entry) => entry.repositoryId === repositoryId && entry.name === branch,
        );
        if (!exists) {
          result = { ok: false, reason: "branch-missing", repository: null };
          return;
        }
        repository.defaultBranch = branch;
        repository.updatedAt = new Date().toISOString();
        result = { ok: true, reason: "ok", repository: { ...repository } };
      });
      return result;
    },

    /**
     * Appends one commit that adds `path` to `branch` and advances that branch
     * head, all inside a single store update: a rejected conflict leaves the
     * file data, the branch head and the commit history unchanged.
     */
    async createRepositoryFileCommit({
      repositoryId,
      branch,
      path,
      content,
      message,
      authorName,
      authorAccountId,
    }) {
      let result = { ok: false, reason: "repository-missing", commit: null, branch: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!Array.isArray(draft.commits)) draft.commits = [];
        const repository = (draft.repositories ?? []).find((entry) => entry.id === repositoryId);
        if (!repository) return;
        const branchName = branch || defaultBranchName(repository);
        const target = (draft.branches ?? []).find(
          (entry) => entry.repositoryId === repositoryId && entry.name === branchName,
        );
        if (!target) {
          result = { ok: false, reason: "branch-missing", commit: null, branch: null };
          return;
        }
        const parent = target.headCommitId
          ? draft.commits.find((entry) => entry.id === target.headCommitId) ?? null
          : null;
        const files = (parent?.files ?? []).map((file) => ({ ...file }));
        const conflict = files.some(
          (file) =>
            file.path === path ||
            file.path.startsWith(`${path}/`) ||
            path.startsWith(`${file.path}/`),
        );
        if (conflict) {
          result = { ok: false, reason: "path-conflict", commit: null, branch: null };
          return;
        }
        files.push({ path, content });
        const commit = {
          id: `commit-${randomUUID()}`,
          repositoryId,
          branch: branchName,
          message,
          authorName,
          authorAccountId: authorAccountId ?? null,
          createdAt: now,
          parentCommitId: parent?.id ?? null,
          files,
        };
        draft.commits.push(commit);
        target.headCommitId = commit.id;
        repository.updatedAt = now;
        result = { ok: true, reason: "ok", commit: { ...commit }, branch: branchName };
      });
      return result;
    },

    async canWriteRepository(repository, accountId) {
      if (!repository) return false;
      const state = await readState();
      return writeAllowed(state, repository, accountId ?? null);
    },

    async canReadRepository(repository, accountId) {
      if (!repository) return false;
      const state = await readState();
      return readAllowed(state, repository, accountId ?? null);
    },

    async canManageRepository(repository, accountId) {
      if (!repository) return false;
      const state = await readState();
      return manageAllowed(state, repository, accountId ?? null);
    },

    async canTriageRepository(repository, accountId) {
      if (!repository) return false;
      const state = await readState();
      return triageAllowed(state, repository, accountId ?? null);
    },

    async canMaintainRepository(repository, accountId) {
      if (!repository) return false;
      const state = await readState();
      return maintainAllowed(state, repository, accountId ?? null);
    },

    /** Protection rules of one repository, in creation order. */
    async listBranchProtectionRules(repositoryId) {
      const state = await readState();
      return state.branchProtectionRules
        .filter((entry) => entry.repositoryId === repositoryId)
        .map(publicBranchProtectionRule);
    },

    /**
     * Creates a branch protection rule or updates the existing rule of the same
     * branch name in place, so the exact branch keeps a single persistent rule.
     * The caller has already re-checked the administrator permission.
     */
    async upsertBranchProtectionRule({
      repositoryId,
      branchName,
      requireApprovals,
      requireStatusCheck,
    }) {
      let saved = null;
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!Array.isArray(draft.branchProtectionRules)) draft.branchProtectionRules = [];
        const existing = draft.branchProtectionRules.find(
          (entry) => entry.repositoryId === repositoryId && entry.branchName === branchName,
        );
        if (existing) {
          existing.requireApprovals = requireApprovals;
          existing.requireStatusCheck = requireStatusCheck;
          existing.statusCheckName = requireStatusCheck ? "test" : null;
          existing.updatedAt = now;
          saved = publicBranchProtectionRule(existing);
          return;
        }
        const rule = {
          id: `protection-${randomUUID()}`,
          repositoryId,
          branchName,
          requireApprovals,
          requireStatusCheck,
          statusCheckName: requireStatusCheck ? "test" : null,
          createdAt: now,
          updatedAt: now,
        };
        draft.branchProtectionRules.push(rule);
        saved = publicBranchProtectionRule(rule);
      });
      return saved;
    },

    /**
     * Accounts associated with one repository: the owner of an account-owned
     * repository, the members of an organization-owned one, the direct account
     * grantees and the members of a granted team. They are the eligible
     * assignees of the repository's issues (REQ-5-3-1); membership alone never
     * grants repository permission, it only offers the account as a candidate.
     */
    async listRepositoryMemberAccountIds(repositoryId) {
      const state = await readState();
      const repository = state.repositories.find((entry) => entry.id === repositoryId);
      if (!repository) return [];
      const ids = new Set();
      if (repository.ownerType === "account") ids.add(repository.ownerId);
      if (repository.ownerType === "organization") {
        for (const membership of state.memberships) {
          if (membership.organizationId === repository.ownerId) ids.add(membership.accountId);
        }
      }
      for (const grant of state.accessGrants) {
        if (grant.repositoryId !== repositoryId) continue;
        if (grant.subjectType === "account") ids.add(grant.subjectId);
        else {
          for (const member of state.teamMembers) {
            if (member.teamId === grant.subjectId) ids.add(member.accountId);
          }
        }
      }
      return [...ids];
    },

    async listReadableRepositories(accountId) {
      const state = await readState();
      return state.repositories.filter((repository) => readAllowed(state, repository, accountId ?? null));
    },

    /**
     * Persists one repository's visibility. The caller has already checked the
     * administrator permission; the stored record is the single source every
     * list, search and detail view reads afterwards.
     */
    async setRepositoryVisibility({ repositoryId, visibility }) {
      let result = { ok: false, repository: null };
      await store.update((draft) => {
        const repository = (draft.repositories ?? []).find((entry) => entry.id === repositoryId);
        if (!repository) return;
        repository.visibility = visibility;
        repository.updatedAt = new Date().toISOString();
        result = { ok: true, repository: { ...repository } };
      });
      return result;
    },

    /**
     * Persists the Archived status of one repository (REQ-3-5). Only the flag
     * and the update time change: the files, issues, branches and access grants
     * of the repository stay exactly as they are, so restoring it brings back
     * the same content. The caller has already checked the administrator
     * permission.
     */
    async setRepositoryArchived({ repositoryId, archived }) {
      let result = { ok: false, repository: null };
      await store.update((draft) => {
        const repository = (draft.repositories ?? []).find((entry) => entry.id === repositoryId);
        if (!repository) return;
        repository.archived = archived === true;
        repository.updatedAt = new Date().toISOString();
        result = { ok: true, repository: { ...repository } };
      });
      return result;
    },

    async listTeams(organizationId) {
      const state = await readState();
      return state.teams
        .filter((team) => team.organizationId === organizationId)
        .map((team) => publicTeam(state, team));
    },

    async getTeam(organizationId, name) {
      const state = await readState();
      return publicTeam(
        state,
        state.teams.find((team) => team.organizationId === organizationId && team.name === name),
      );
    },

    async getTeamById(teamId) {
      const state = await readState();
      return publicTeam(state, state.teams.find((team) => team.id === teamId));
    },

    /** Returns null when the name is already used inside the same organization. */
    async createTeam({ organizationId, name }) {
      let created = null;
      await store.update((draft) => {
        if (!Array.isArray(draft.teams)) draft.teams = [];
        if (draft.teams.some((team) => team.organizationId === organizationId && team.name === name)) return;
        const team = {
          id: `team-${randomUUID()}`,
          organizationId,
          name,
          parentTeamId: null,
          createdAt: new Date().toISOString(),
        };
        draft.teams.push(team);
        created = publicTeam(draft, team);
      });
      return created;
    },

    async listTeamMemberIds(organizationId, name) {
      const state = await readState();
      const team = state.teams.find((entry) => entry.organizationId === organizationId && entry.name === name);
      if (!team) return null;
      return state.teamMembers.filter((entry) => entry.teamId === team.id).map((entry) => entry.accountId);
    },

    async addTeamMember({ organizationId, name, accountId }) {
      let found = false;
      await store.update((draft) => {
        if (!Array.isArray(draft.teamMembers)) draft.teamMembers = [];
        const team = draft.teams.find((entry) => entry.organizationId === organizationId && entry.name === name);
        if (!team) return;
        found = true;
        if (draft.teamMembers.some((entry) => entry.teamId === team.id && entry.accountId === accountId)) return;
        draft.teamMembers.push({ teamId: team.id, accountId });
      });
      return found;
    },

    async removeTeamMember({ organizationId, name, accountId }) {
      let found = false;
      await store.update((draft) => {
        if (!Array.isArray(draft.teamMembers)) draft.teamMembers = [];
        const team = draft.teams.find((entry) => entry.organizationId === organizationId && entry.name === name);
        if (!team) return;
        found = true;
        draft.teamMembers = draft.teamMembers.filter(
          (entry) => !(entry.teamId === team.id && entry.accountId === accountId),
        );
      });
      return found;
    },

    /**
     * Persists a parent-team change. A parent that is the team itself or one of
     * its descendants would create a cycle, so the whole change is rejected and
     * the previously saved parent is kept.
     */
    async setTeamParent({ organizationId, name, parentName }) {
      let result = { ok: false, reason: "team-not-found" };
      await store.update((draft) => {
        const team = draft.teams.find((entry) => entry.organizationId === organizationId && entry.name === name);
        if (!team) return;

        if (parentName === null || parentName === "") {
          team.parentTeamId = null;
          result = { ok: true, team: publicTeam(draft, team) };
          return;
        }

        const parent = draft.teams.find(
          (entry) => entry.organizationId === organizationId && entry.name === parentName,
        );
        if (!parent) {
          result = { ok: false, reason: "parent-not-found" };
          return;
        }

        const seen = new Set();
        let cursor = parent;
        while (cursor) {
          if (cursor.id === team.id) {
            result = { ok: false, reason: "cyclic" };
            return;
          }
          if (seen.has(cursor.id)) break;
          seen.add(cursor.id);
          const nextId = cursor.parentTeamId;
          cursor = nextId ? draft.teams.find((entry) => entry.id === nextId) : null;
        }

        team.parentTeamId = parent.id;
        result = { ok: true, team: publicTeam(draft, team) };
      });
      return result;
    },
  };
}
