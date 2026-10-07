// HTTP surface for organizations, teams and repository read access.
//
// Every rule is re-validated here: the session cookie is the only trusted
// identity source, organization membership is read from the store, and a
// rejected operation writes nothing.

import { normalizeText } from "./auth-rules.mjs";
import { readJson, sendJson } from "./http.mjs";
import {
  ORG_MESSAGES,
  normalizeOrganizationName,
  validateAccessRole,
  validateDisplayName,
  validateMembershipRole,
  validateOrganizationName,
  validateRepositoryName,
  validateTeamName,
  validateVisibility,
} from "./org-rules.mjs";
import { createRepositoryCodeRoutes } from "./repository-code-routes.mjs";
import { createRepositoryWriteRoutes } from "./repository-write-routes.mjs";
import { createIssueRoutes } from "./issue-routes.mjs";
import { createPullRequestRoutes } from "./pull-request-routes.mjs";
import { createReleaseRoutes } from "./release-routes.mjs";
import { publicRepository } from "./org-store.mjs";

const ORGANIZATIONS_PATH = "/api/organizations";
const REPOSITORIES_PATH = "/api/repositories";
const ORGANIZATION_PATH = /^\/api\/organizations\/([^/]+)(?:\/(repositories|people|teams))?$/;
const ORGANIZATION_AUDIT_LOG_PATH = /^\/api\/organizations\/([^/]+)\/audit-log$/;
const TEAM_MEMBERS_PATH = /^\/api\/organizations\/([^/]+)\/teams\/([^/]+)\/members$/;
const TEAM_MEMBER_PATH = /^\/api\/organizations\/([^/]+)\/teams\/([^/]+)\/members\/([^/]+)$/;
const TEAM_PATH = /^\/api\/organizations\/([^/]+)\/teams\/([^/]+)$/;
const PERSON_PATH = /^\/api\/organizations\/([^/]+)\/people\/([^/]+)$/;
const REPOSITORY_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)$/;
const REPOSITORY_FORK_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/fork$/;
const REPOSITORY_ACCESS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/access$/;
const REPOSITORY_ACCESS_GRANT_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/access\/([^/]+)$/;
const REPOSITORY_VISIBILITY_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/visibility$/;
const REPOSITORY_ARCHIVE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/(archive|restore)$/;

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readBody(request) {
  return readJson(request).catch(() => ({}));
}

export function createOrgApi({ store, orgStore, currentUser }) {
  /**
   * Descriptor of one organization action for the persisted audit trail
   * (REQ-2-4). The trusted route builds it from the session identity, so the
   * recorded actor is never taken from the request body.
   */
  const auditOf = (user, organizationId, action, target) => ({
    organizationId,
    actorName: user.username,
    action,
    target,
  });

  async function organizationOr404(response, organizationId) {
    const organization = await orgStore.getOrganization(organizationId);
    if (!organization) sendJson(response, 404, { error: "Not found" });
    return organization;
  }

  async function requireMember(response, organizationId, user) {
    if (!user) {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return null;
    }
    const membership = await orgStore.getMembership(organizationId, user.id);
    if (!membership) {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return null;
    }
    return membership;
  }

  async function requireOwner(response, organizationId, user) {
    if (!user) {
      sendJson(response, 401, { message: "Not signed in" });
      return null;
    }
    const membership = await orgStore.getMembership(organizationId, user.id);
    if (membership?.role !== "Owner") {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return null;
    }
    return membership;
  }

  async function describeOwner(ownerType, ownerId) {
    if (ownerType === "organization") {
      const organization = await orgStore.getOrganization(ownerId);
      return organization ? { id: organization.id, displayName: organization.displayName } : null;
    }
    const account = await store.findAccountsByIds([ownerId]);
    // The address of an account-owned repository uses the username, while the
    // stored owner remains the account id.
    return account[0] ? { id: account[0].username, displayName: account[0].username } : null;
  }

  /** Resolves a repository by (owner name, repository name) for either owner type. */
  async function findRepository(owner, name) {
    const organization = await orgStore.getOrganization(owner);
    if (organization) return orgStore.getRepository({ organizationId: organization.id, name });
    const account = await store.findAccountByIdentifier(owner);
    if (account) return orgStore.getRepositoryByOwner({ ownerType: "account", ownerId: account.id, name });
    // Direct links may carry the immutable account id instead of the username.
    const [byId] = await store.findAccountsByIds([owner]);
    if (byId) return orgStore.getRepositoryByOwner({ ownerType: "account", ownerId: byId.id, name });
    return null;
  }

  /** Resolves the owner selected on the creation/fork form to a stored owner. */
  async function resolveOwner(ownerType, ownerName) {
    const value = normalizeText(ownerName);
    if (!value) return null;
    if (ownerType === "organization") {
      const organization = await orgStore.getOrganization(value);
      return organization ? { ownerType: "organization", ownerId: organization.id } : null;
    }
    const [account] = await store.findAccountsByIds([value]);
    if (account) return { ownerType: "account", ownerId: account.id, username: account.username };
    const byIdentifier = await store.findAccountByIdentifier(value);
    return byIdentifier
      ? { ownerType: "account", ownerId: byIdentifier.id, username: byIdentifier.username }
      : null;
  }

  /** Repository payload: stored record plus owner, source link and code facts. */
  async function describeRepositoryDetail(repository, viewerId) {
    const owner = await describeOwner(repository.ownerType, repository.ownerId);
    let fork = null;
    if (repository.forkOfRepositoryId) {
      const source = await orgStore.getRepositoryById(repository.forkOfRepositoryId);
      if (source) {
        const sourceOwner = await describeOwner(source.ownerType, source.ownerId);
        if (sourceOwner) fork = { id: source.id, name: source.name, owner: sourceOwner };
      }
    }
    return {
      ...publicRepository(repository),
      owner,
      canManage: await orgStore.canManageRepository(repository, viewerId ?? null),
      canWrite: await orgStore.canWriteRepository(repository, viewerId ?? null),
      fork,
      readmePath: await orgStore.getRepositoryReadmePath(repository.id),
      commitCount: (await orgStore.listRepositoryCommits(repository.id)).length,
    };
  }

  /** Enriches one stored grant with the visible name of its subject. */
  async function describeGrant(grant) {
    let subjectName = null;
    if (grant.subjectType === "account") {
      const [account] = await store.findAccountsByIds([grant.subjectId]);
      subjectName = account ? account.username : null;
    } else {
      const team = await orgStore.getTeamById(grant.subjectId);
      subjectName = team ? team.name : null;
    }
    return { id: grant.id, subjectType: grant.subjectType, subjectName, role: grant.role };
  }

  /** Returns the repository when the caller may manage its access. */
  async function requireRepositoryAdmin(response, repository, user) {
    if (!user) {
      sendJson(response, 401, { message: "Not signed in" });
      return false;
    }
    if (!(await orgStore.canManageRepository(repository, user.id))) {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return false;
    }
    return true;
  }

  const codeRoutes = createRepositoryCodeRoutes({
    orgStore,
    findRepository,
    describeOwner,
    currentUser,
  });

  const writeRoutes = createRepositoryWriteRoutes({
    orgStore,
    findRepository,
    describeRepository: describeRepositoryDetail,
    currentUser,
  });

  // Issue list, issue detail, issue creation and discussion comments (REQ-5).
  const issueRoutes = createIssueRoutes({
    store,
    orgStore,
    findRepository,
    describeOwner,
    currentUser,
  });

  // Pull-request list, comparison, creation, detail, reviews and reviewers
  // (REQ-6).
  const pullRoutes = createPullRequestRoutes({
    store,
    orgStore,
    findRepository,
    describeOwner,
    currentUser,
  });

  // Repository releases (REQ-4-5): the readable list, one detail and publishing.
  const releaseRoutes = createReleaseRoutes({
    orgStore,
    findRepository,
    describeOwner,
    currentUser,
  });

  return async function handle(request, response, url, method) {
    const { pathname } = url;
    if (!pathname.startsWith(ORGANIZATIONS_PATH) && !pathname.startsWith(REPOSITORIES_PATH)) return false;

    const user = await currentUser(request);

    // GET /api/organizations — the signed-in account's organizations, or the
    // public organizations a visitor may open.
    if (pathname === ORGANIZATIONS_PATH && method === "GET") {
      sendJson(response, 200, {
        organizations: user
          ? await orgStore.listOrganizationsForAccount(user.id)
          : await orgStore.listPublicOrganizations(),
      });
      return true;
    }

    // POST /api/organizations — create an organization owned by the caller.
    if (pathname === ORGANIZATIONS_PATH && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const body = await readBody(request);
      const name = normalizeOrganizationName(body.name);
      const displayName = typeof body.displayName === "string" ? body.displayName : "";

      const fieldErrors = {};
      if (!validateOrganizationName(name)) {
        fieldErrors.name = ORG_MESSAGES.organizationNameFormat;
      } else if (await orgStore.organizationExists(name)) {
        fieldErrors.name = ORG_MESSAGES.organizationNameExists;
      }
      if (!validateDisplayName(displayName)) {
        fieldErrors.displayName = ORG_MESSAGES.displayNameRequired;
      }
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      const organization = await orgStore.createOrganization({
        name,
        displayName: normalizeText(displayName),
        ownerAccountId: user.id,
        audit: auditOf(user, name, "Organization created", name),
      });
      if (!organization) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { name: ORG_MESSAGES.organizationNameExists },
        });
        return true;
      }
      sendJson(response, 201, { organization });
      return true;
    }

    // GET /api/repositories — every repository the caller may read. The
    // optional `q` narrows the same readable set, case-insensitively, by the
    // repository name and its persisted description, so the global search can
    // never surface a repository outside the read rule (REQ-3-1).
    if (pathname === REPOSITORIES_PATH && method === "GET") {
      const query = normalizeText(url.searchParams.get("q") ?? "").toLowerCase();
      let repositories = await orgStore.listReadableRepositories(user?.id ?? null);
      if (query) {
        repositories = repositories.filter(
          (repository) =>
            repository.name.toLowerCase().includes(query) ||
            (repository.description ?? "").toLowerCase().includes(query),
        );
      }
      const ownerCache = new Map();
      const described = [];
      for (const repository of repositories) {
        const key = `${repository.ownerType}:${repository.ownerId}`;
        if (!ownerCache.has(key)) {
          ownerCache.set(key, await describeOwner(repository.ownerType, repository.ownerId));
        }
        const owner = ownerCache.get(key);
        if (owner) described.push({ ...publicRepository(repository), owner });
      }
      sendJson(response, 200, { repositories: described });
      return true;
    }

    // POST /api/repositories — create a repository in a namespace the caller may
    // create in. The repository record, its default branch and (when requested)
    // the initialization commit are written in one store update, so a failure at
    // any step leaves no partially created repository.
    if (pathname === REPOSITORIES_PATH && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      const body = await readBody(request);
      const ownerType = body.ownerType === "organization" ? "organization" : "account";
      const name = normalizeText(body.name);
      const description = normalizeText(body.description);
      const visibility = normalizeText(body.visibility);
      const initialize = body.initialize === true;

      const fieldErrors = {};
      const owner = await resolveOwner(ownerType, body.ownerId ?? body.owner);
      if (!owner) fieldErrors.owner = ORG_MESSAGES.repositoryOwnerInvalid;
      if (!name) fieldErrors.name = ORG_MESSAGES.repositoryNameRequired;
      else if (!validateRepositoryName(name)) fieldErrors.name = ORG_MESSAGES.repositoryNameFormat;
      if (!validateVisibility(visibility)) fieldErrors.visibility = ORG_MESSAGES.visibilityInvalid;
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      const allowed = await orgStore.canCreateRepository({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        accountId: user.id,
      });
      if (!allowed) {
        sendJson(response, 403, {
          message: ORG_MESSAGES.accessDenied,
          fieldErrors: { owner: ORG_MESSAGES.accessDenied },
        });
        return true;
      }

      if (
        await orgStore.repositoryExists({
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          name,
        })
      ) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { name: ORG_MESSAGES.repositoryNameExists },
        });
        return true;
      }

      const created = await orgStore.createRepository({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        name,
        description,
        visibility,
        initialize,
        creatorAccountId: user.id,
        creatorName: user.username,
        audit:
          owner.ownerType === "organization"
            ? auditOf(user, owner.ownerId, "Repository created", name)
            : null,
      });
      if (!created) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { name: ORG_MESSAGES.repositoryNameExists },
        });
        return true;
      }
      sendJson(response, 201, { repository: await describeRepositoryDetail(created, user.id) });
      return true;
    }

    // POST /api/repositories/:owner/:name/fork — creates an independent fork in
    // a namespace the caller may create in, copying the source's readable
    // default-branch history. Both permissions are re-checked here.
    const repositoryForkMatch = pathname.match(REPOSITORY_FORK_PATH);
    if (repositoryForkMatch && method === "POST") {
      const source = await findRepository(
        decodeSegment(repositoryForkMatch[1]),
        decodeSegment(repositoryForkMatch[2]),
      );
      if (!source) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canReadRepository(source, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }

      const body = await readBody(request);
      const ownerType = body.ownerType === "organization" ? "organization" : "account";
      const name = normalizeText(body.name) || source.name;
      const requested = normalizeText(body.visibility);
      // A private source can only be forked privately; a public source may be
      // forked as either public or private.
      const visibility = source.visibility === "private" ? "private" : requested || "public";

      const fieldErrors = {};
      const owner = await resolveOwner(ownerType, body.ownerId ?? body.owner);
      if (!owner) fieldErrors.owner = ORG_MESSAGES.repositoryOwnerInvalid;
      if (!name) fieldErrors.name = ORG_MESSAGES.repositoryNameRequired;
      else if (!validateRepositoryName(name)) fieldErrors.name = ORG_MESSAGES.repositoryNameFormat;
      if (!validateVisibility(visibility)) fieldErrors.visibility = ORG_MESSAGES.visibilityInvalid;
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      const allowed = await orgStore.canCreateRepository({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        accountId: user.id,
      });
      if (!allowed) {
        sendJson(response, 403, {
          message: ORG_MESSAGES.accessDenied,
          fieldErrors: { owner: ORG_MESSAGES.accessDenied },
        });
        return true;
      }

      const result = await orgStore.forkRepository({
        sourceRepositoryId: source.id,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        name,
        visibility,
        creatorAccountId: user.id,
      });
      if (!result.ok) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { name: ORG_MESSAGES.repositoryNameExists },
        });
        return true;
      }
      sendJson(response, 201, { repository: await describeRepositoryDetail(result.repository, user.id) });
      return true;
    }

    // Read-only code views of one repository: the branch commit list, its
    // directory tree, one file, one commit compared with its parent and the
    // code search. All of them apply the shared read rule.
    if (await codeRoutes(request, response, url, method)) return true;

    // Branch-scoped write views: create a branch, change the repository default
    // branch and add one file. Each one re-checks the stored permission.
    if (await writeRoutes(request, response, url, method)) return true;

    // Issue list, issue detail, issue creation and discussion comments.
    if (await issueRoutes(request, response, url, method)) return true;

    // Pull-request list, branch comparison, creation, detail and checks.
    if (await pullRoutes(request, response, url, method)) return true;

    // Repository releases: the readable list, one detail and publishing.
    if (await releaseRoutes(request, response, url, method)) return true;

    // PATCH /api/repositories/:owner/:name/visibility — repository visibility
    // is an administrator operation, re-checked here against the stored grants.
    const repositoryVisibilityMatch = pathname.match(REPOSITORY_VISIBILITY_PATH);
    if (repositoryVisibilityMatch && method === "PATCH") {
      const repository = await findRepository(
        decodeSegment(repositoryVisibilityMatch[1]),
        decodeSegment(repositoryVisibilityMatch[2]),
      );
      if (!repository) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (!(await requireRepositoryAdmin(response, repository, user))) return true;
      const body = await readBody(request);
      const visibility = normalizeText(body.visibility);
      if (!validateVisibility(visibility)) {
        sendJson(response, 400, {
          message: ORG_MESSAGES.visibilityInvalid,
          fieldErrors: { visibility: ORG_MESSAGES.visibilityInvalid },
        });
        return true;
      }
      const result = await orgStore.setRepositoryVisibility({
        repositoryId: repository.id,
        visibility,
      });
      if (!result.ok) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, {
        repository: await describeRepositoryDetail(result.repository, user.id),
      });
      return true;
    }

    const repositoryAccessGrantMatch = pathname.match(REPOSITORY_ACCESS_GRANT_PATH);
    if (repositoryAccessGrantMatch && method === "PATCH") {
      const repository = await findRepository(
        decodeSegment(repositoryAccessGrantMatch[1]),
        decodeSegment(repositoryAccessGrantMatch[2]),
      );
      if (!repository) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (!(await requireRepositoryAdmin(response, repository, user))) return true;
      const body = await readBody(request);
      const role = normalizeText(body.role);
      if (!validateAccessRole(role)) {
        sendJson(response, 400, {
          message: ORG_MESSAGES.roleInvalid,
          fieldErrors: { role: ORG_MESSAGES.roleInvalid },
        });
        return true;
      }
      const grantId = decodeSegment(repositoryAccessGrantMatch[3]);
      const previous = (await orgStore.listAccessGrants(repository.id)).find(
        (entry) => entry.id === grantId,
      );
      const subjectName = previous ? (await describeGrant(previous)).subjectName ?? "" : "";
      const result = await orgStore.updateAccessGrantRole({
        repositoryId: repository.id,
        grantId,
        role,
        audit:
          repository.ownerType === "organization"
            ? auditOf(user, repository.ownerId, "Access role updated", subjectName)
            : null,
      });
      if (!result.ok) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, { access: await describeGrant(result.grant) });
      return true;
    }

    const repositoryAccessMatch = pathname.match(REPOSITORY_ACCESS_PATH);
    if (repositoryAccessMatch) {
      const repository = await findRepository(
        decodeSegment(repositoryAccessMatch[1]),
        decodeSegment(repositoryAccessMatch[2]),
      );
      if (!repository) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (!(await requireRepositoryAdmin(response, repository, user))) return true;

      if (method === "GET") {
        const grants = await orgStore.listAccessGrants(repository.id);
        const access = [];
        for (const grant of grants) access.push(await describeGrant(grant));
        // Candidate subjects the Admin may grant to: the owning organization's
        // teams and members. Read here with the repository-admin check, so an
        // Admin grant without organization membership can still use the picker.
        let candidates = { teams: [], accounts: [] };
        if (repository.ownerType === "organization") {
          const teams = await orgStore.listTeams(repository.ownerId);
          const members = await orgStore.listMembers(repository.ownerId);
          const accounts = await store.findAccountsByIds(members.map((member) => member.accountId));
          candidates = {
            teams: teams.map((team) => ({ id: team.id, name: team.name })),
            accounts: accounts.map((account) => ({ id: account.id, username: account.username })),
          };
        }
        sendJson(response, 200, { access, candidates });
        return true;
      }

      if (method === "POST") {
        const body = await readBody(request);
        const subjectType = normalizeText(body.subjectType);
        const subjectName = normalizeText(body.subjectName ?? body.identifier);
        const role = normalizeText(body.role);
        if (subjectType !== "team" && subjectType !== "account") {
          sendJson(response, 400, { message: ORG_MESSAGES.accessDenied });
          return true;
        }
        if (!validateAccessRole(role)) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.roleInvalid,
            fieldErrors: { role: ORG_MESSAGES.roleInvalid },
          });
          return true;
        }
        let subjectId = null;
        if (subjectType === "account") {
          const account = await store.findAccountByIdentifier(subjectName);
          subjectId = account ? account.id : null;
        } else if (repository.ownerType === "organization") {
          const team = await orgStore.getTeam(repository.ownerId, subjectName);
          subjectId = team ? team.id : null;
        }
        if (!subjectId) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.accountNotFound,
            fieldErrors: { subjectName: ORG_MESSAGES.accountNotFound },
          });
          return true;
        }
        const grant = await orgStore.upsertAccessGrant({
          repositoryId: repository.id,
          subjectType,
          subjectId,
          role,
          audit:
            repository.ownerType === "organization"
              ? {
                  ...auditOf(user, repository.ownerId, "Access granted", subjectName),
                  updatedAction: "Access role updated",
                }
              : null,
        });
        sendJson(response, 201, { access: await describeGrant(grant) });
        return true;
      }
      return false;
    }

    // POST /api/repositories/:owner/:name/archive|restore — the archive state
    // is an administrator operation (REQ-3-5), re-checked here against the
    // stored grants. The stored content, issues, branches and permissions stay
    // untouched; only the flag every read and write check consults changes.
    const repositoryArchiveMatch = pathname.match(REPOSITORY_ARCHIVE_PATH);
    if (repositoryArchiveMatch && method === "POST") {
      const repository = await findRepository(
        decodeSegment(repositoryArchiveMatch[1]),
        decodeSegment(repositoryArchiveMatch[2]),
      );
      if (!repository) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (!(await requireRepositoryAdmin(response, repository, user))) return true;
      const result = await orgStore.setRepositoryArchived({
        repositoryId: repository.id,
        archived: repositoryArchiveMatch[3] === "archive",
      });
      if (!result.ok) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, {
        repository: await describeRepositoryDetail(result.repository, user.id),
      });
      return true;
    }

    const repositoryMatch = pathname.match(REPOSITORY_PATH);
    if (repositoryMatch && method === "GET") {
      const repository = await findRepository(
        decodeSegment(repositoryMatch[1]),
        decodeSegment(repositoryMatch[2]),
      );
      if (!repository) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (!(await orgStore.canReadRepository(repository, user?.id ?? null))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      sendJson(response, 200, {
        repository: await describeRepositoryDetail(repository, user?.id ?? null),
      });
      return true;
    }

    // DELETE /api/organizations/:id/people/:identifier — atomic member removal.
    const personMatch = pathname.match(PERSON_PATH);
    if (personMatch && method === "DELETE") {
      const organizationId = decodeSegment(personMatch[1]);
      const identifier = decodeSegment(personMatch[2]);
      if (!(await requireOwner(response, organizationId, user))) return true;
      const account = await store.findAccountByIdentifier(identifier);
      if (!account) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const result = await orgStore.removeOrganizationMember({
        organizationId,
        accountId: account.id,
        audit: auditOf(user, organizationId, "Member removed", account.username),
      });
      if (!result.ok) {
        if (result.reason === "last-owner") {
          sendJson(response, 400, {
            message: ORG_MESSAGES.lastOwner,
            fieldErrors: { member: ORG_MESSAGES.lastOwner },
          });
          return true;
        }
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, { ok: true });
      return true;
    }

    const memberMatch = pathname.match(TEAM_MEMBER_PATH);
    if (memberMatch) {
      const organizationId = decodeSegment(memberMatch[1]);
      const teamName = decodeSegment(memberMatch[2]);
      const username = decodeSegment(memberMatch[3]);
      if (!(await organizationOr404(response, organizationId))) return true;

      if (method === "DELETE") {
        if (!(await requireOwner(response, organizationId, user))) return true;
        const account = await store.findAccountByIdentifier(username);
        if (account) {
          await orgStore.removeTeamMember({
            organizationId,
            name: teamName,
            accountId: account.id,
            audit: auditOf(user, organizationId, "Team member removed", account.username),
          });
        }
        sendJson(response, 200, { ok: true });
        return true;
      }
      return false;
    }

    const membersMatch = pathname.match(TEAM_MEMBERS_PATH);
    if (membersMatch) {
      const organizationId = decodeSegment(membersMatch[1]);
      const teamName = decodeSegment(membersMatch[2]);
      if (!(await organizationOr404(response, organizationId))) return true;

      if (method === "GET") {
        if (!(await requireMember(response, organizationId, user))) return true;
        const ids = await orgStore.listTeamMemberIds(organizationId, teamName);
        if (ids === null) {
          sendJson(response, 404, { error: "Not found" });
          return true;
        }
        const accounts = await store.findAccountsByIds(ids);
        const byId = new Map(accounts.map((account) => [account.id, account]));
        sendJson(response, 200, {
          members: ids.map((id) => byId.get(id)).filter(Boolean).map((account) => ({ username: account.username })),
        });
        return true;
      }

      if (method === "POST") {
        if (!(await requireOwner(response, organizationId, user))) return true;
        const team = await orgStore.getTeam(organizationId, teamName);
        if (!team) {
          sendJson(response, 404, { error: "Not found" });
          return true;
        }
        const body = await readBody(request);
        const username = normalizeText(body.username);
        const account = await store.findAccountByIdentifier(username);
        if (!account) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.accountNotFound,
            fieldErrors: { username: ORG_MESSAGES.accountNotFound },
          });
          return true;
        }
        const membership = await orgStore.getMembership(organizationId, account.id);
        if (!membership) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.notOrganizationMember,
            fieldErrors: { username: ORG_MESSAGES.notOrganizationMember },
          });
          return true;
        }
        await orgStore.addTeamMember({
          organizationId,
          name: teamName,
          accountId: account.id,
          audit: auditOf(user, organizationId, "Team member added", account.username),
        });
        sendJson(response, 201, { member: { username: account.username } });
        return true;
      }
      return false;
    }

    const teamMatch = pathname.match(TEAM_PATH);
    if (teamMatch) {
      const organizationId = decodeSegment(teamMatch[1]);
      const teamName = decodeSegment(teamMatch[2]);
      if (!(await organizationOr404(response, organizationId))) return true;

      if (method === "GET") {
        if (!(await requireMember(response, organizationId, user))) return true;
        const team = await orgStore.getTeam(organizationId, teamName);
        if (!team) {
          sendJson(response, 404, { error: "Not found" });
          return true;
        }
        sendJson(response, 200, { team });
        return true;
      }

      if (method === "PATCH") {
        if (!(await requireOwner(response, organizationId, user))) return true;
        const body = await readBody(request);
        const parentName = body.parentName === null ? null : normalizeText(body.parentName);
        const result = await orgStore.setTeamParent({ organizationId, name: teamName, parentName });
        if (!result.ok) {
          if (result.reason === "cyclic") {
            sendJson(response, 400, {
              message: ORG_MESSAGES.cyclicHierarchy,
              fieldErrors: { parentName: ORG_MESSAGES.cyclicHierarchy },
            });
            return true;
          }
          if (result.reason === "parent-not-found") {
            sendJson(response, 400, {
              message: ORG_MESSAGES.parentTeamInvalid,
              fieldErrors: { parentName: ORG_MESSAGES.parentTeamInvalid },
            });
            return true;
          }
          sendJson(response, 404, { error: "Not found" });
          return true;
        }
        sendJson(response, 200, { team: result.team });
        return true;
      }
      return false;
    }

    // GET /api/organizations/:id/audit-log — the persisted organization actions
    // of one organization. Only its Owner may read them; an ordinary Member may
    // view the organization but never the audit log.
    const auditLogMatch = pathname.match(ORGANIZATION_AUDIT_LOG_PATH);
    if (auditLogMatch && method === "GET") {
      const organizationId = decodeSegment(auditLogMatch[1]);
      const organization = await orgStore.getOrganization(organizationId);
      if (!organization) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      if (!(await requireOwner(response, organizationId, user))) return true;
      sendJson(response, 200, {
        organization,
        events: await orgStore.listAuditEvents(organizationId),
      });
      return true;
    }

    const organizationMatch = pathname.match(ORGANIZATION_PATH);
    if (organizationMatch) {
      const organizationId = decodeSegment(organizationMatch[1]);
      const section = organizationMatch[2] ?? null;
      const organization = await orgStore.getOrganization(organizationId);
      if (!organization) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }

      if (!section && method === "GET") {
        if (!user && !(await orgStore.hasPublicRepository(organizationId))) {
          sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
          return true;
        }
        const membership = await orgStore.getMembership(organizationId, user?.id ?? null);
        sendJson(response, 200, { organization, viewerRole: membership?.role ?? null });
        return true;
      }

      if (section === "repositories" && method === "GET") {
        const viewerId = user?.id ?? null;
        if (!user && !(await orgStore.hasPublicRepository(organizationId))) {
          sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
          return true;
        }
        const query = normalizeText(url.searchParams.get("q") ?? "").toLowerCase();
        const visibility = url.searchParams.get("visibility") ?? "";
        const all = await orgStore.listRepositories(organizationId);
        const visible = [];
        for (const repository of all) {
          if (!(await orgStore.canReadRepository(repository, viewerId))) continue;
          if (query && !repository.name.toLowerCase().includes(query)) continue;
          if (visibility && visibility !== "all" && repository.visibility !== visibility) continue;
          visible.push(repository);
        }
        sendJson(response, 200, { organization, repositories: visible.map(publicRepository) });
        return true;
      }

      if (section === "people" && method === "GET") {
        if (!(await requireMember(response, organizationId, user))) return true;
        const members = await orgStore.listMembers(organizationId);
        const accounts = await store.findAccountsByIds(members.map((member) => member.accountId));
        const byId = new Map(accounts.map((account) => [account.id, account]));
        sendJson(response, 200, {
          organization,
          members: members
            .map((member) => {
              const account = byId.get(member.accountId);
              return account ? { username: account.username, role: member.role } : null;
            })
            .filter(Boolean),
        });
        return true;
      }

      // POST /api/organizations/:id/people — an Owner directly adds an existing
      // account (by username or verified email). There is no invitation step.
      if (section === "people" && method === "POST") {
        if (!(await requireOwner(response, organizationId, user))) return true;
        const body = await readBody(request);
        const identifier = normalizeText(body.identifier ?? body.username);
        const role = normalizeText(body.role) || "Member";
        if (!validateMembershipRole(role)) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.roleInvalid,
            fieldErrors: { role: ORG_MESSAGES.roleInvalid },
          });
          return true;
        }
        const account = await store.findAccountByIdentifier(identifier);
        if (!account) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.accountNotFound,
            fieldErrors: { identifier: ORG_MESSAGES.accountNotFound },
          });
          return true;
        }
        const result = await orgStore.addOrganizationMember({
          organizationId,
          accountId: account.id,
          role,
          audit: auditOf(user, organizationId, "Member added", account.username),
        });
        if (!result.ok) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.accountAlreadyMember,
            fieldErrors: { identifier: ORG_MESSAGES.accountAlreadyMember },
          });
          return true;
        }
        sendJson(response, 201, { member: { username: account.username, role } });
        return true;
      }

      if (section === "teams" && method === "GET") {
        if (!(await requireMember(response, organizationId, user))) return true;
        sendJson(response, 200, { organization, teams: await orgStore.listTeams(organizationId) });
        return true;
      }

      if (section === "teams" && method === "POST") {
        if (!(await requireOwner(response, organizationId, user))) return true;
        const body = await readBody(request);
        const name = typeof body.name === "string" ? body.name : "";
        if (!validateTeamName(name)) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.teamNameInvalid,
            fieldErrors: { name: ORG_MESSAGES.teamNameInvalid },
          });
          return true;
        }
        const team = await orgStore.createTeam({
          organizationId,
          name,
          audit: auditOf(user, organizationId, "Team created", name),
        });
        if (!team) {
          sendJson(response, 400, {
            message: ORG_MESSAGES.teamNameInvalid,
            fieldErrors: { name: ORG_MESSAGES.teamNameInvalid },
          });
          return true;
        }
        sendJson(response, 201, { team });
        return true;
      }

      return false;
    }

    return false;
  };
}
