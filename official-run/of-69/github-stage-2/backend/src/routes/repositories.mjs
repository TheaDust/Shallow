import { randomUUID } from "node:crypto";

import { readJsonSafe, sendJson } from "../lib/http.mjs";
import { findCurrentAccount } from "../lib/sessions.mjs";
import {
  ACCESS_DENIED,
  BRANCH_MESSAGES,
  COMMIT_MESSAGE_MAX_LENGTH,
  FILE_MESSAGES,
  ORGANIZATION_NOT_FOUND,
  REPOSITORY_MESSAGES,
  REPOSITORY_NOT_FOUND,
  canWriteRepository,
  validateBranchName,
  validateRepositoryName,
} from "../lib/organization-rules.mjs";
import {
  canReadRepository,
  findAccountByUsername,
  findOrganizationByName,
  findRepositoryByOwner,
  findRepositoryByOwnerName,
  listReadableRepositories,
  organizationRole,
  organizationRoleFromState,
  readmeFile,
  repositoryCommits,
  repositoryOwnerRef,
  repositoryRoleFromState,
  repositorySummary,
  searchReadableRepositories,
} from "../lib/organizations.mjs";
import {
  addFileCommit,
  branchFileList,
  branchNames,
  commitDetail,
  commitHistory,
  createBranchReference,
  filesInDirectory,
  isValidNewFilePath,
  publicCommit,
  resolveBranchName,
  searchCode,
} from "../lib/repository-code.mjs";

/**
 * Repository discovery, creation and forking.
 *
 * `GET /api/repositories` and `GET /api/search/repositories` are the discovery
 * entries; `GET /api/repositories/:owner/:repo` is the canonical detail of an
 * organization or personal repository; `POST /api/repositories` creates one and
 * `POST /api/repositories/:owner/:repo/fork` copies a readable source into a
 * target namespace. Every permission decision is made here from the session
 * account and the persisted aggregate, never from the rendered UI.
 */
export function createRepositoryApi(database) {
  /**
   * Resolves a target namespace for creation/forking and checks that the
   * account may create repositories there. A personal target must be the
   * caller's own namespace; an organization target requires the Owner role.
   */
  async function resolveTargetOwner(account, ownerType, ownerName) {
    if (ownerType === "user") {
      const target = await findAccountByUsername(database, ownerName);
      if (!target) {
        return { error: { status: 422, body: { errors: { owner: REPOSITORY_MESSAGES.ownerInvalid } } } };
      }
      if (target.id !== account.id) {
        return { error: { status: 403, body: { error: ACCESS_DENIED } } };
      }
      return { owner: { type: "user", id: target.id, name: target.username, displayName: target.username } };
    }
    if (ownerType === "organization") {
      const organization = await findOrganizationByName(database, ownerName);
      if (!organization) {
        return { error: { status: 422, body: { errors: { owner: ORGANIZATION_NOT_FOUND } } } };
      }
      if ((await organizationRole(database, organization.id, account.id)) !== "owner") {
        return { error: { status: 403, body: { error: ACCESS_DENIED } } };
      }
      return {
        owner: {
          type: "organization",
          id: organization.id,
          name: organization.name,
          displayName: organization.displayName,
        },
      };
    }
    return { error: { status: 422, body: { errors: { owner: REPOSITORY_MESSAGES.ownerInvalid } } } };
  }

  /** Validates a candidate repository name inside one owner namespace. */
  async function validateCandidateName(owner, rawName, currentName = null) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (name.length === 0) return { name, error: REPOSITORY_MESSAGES.nameRequired };
    if (!validateRepositoryName(name)) return { name, error: REPOSITORY_MESSAGES.nameInvalid };
    const state = await database.organizationState.read();
    const existing = findRepositoryByOwner(state, owner.type, owner.id, name);
    if (existing && existing.name.toLowerCase() !== (currentName ?? "").toLowerCase()) {
      return { name, error: REPOSITORY_MESSAGES.nameExists };
    }
    return { name, error: null };
  }

  /**
   * Resolves a readable repository for the viewer of a code view. A missing
   * repository answers `404`; one the viewer may not read answers `403`, so no
   * protected content is ever exposed to a visitor without read permission.
   */
  async function readableRepository(response, account, ownerName, repositoryName) {
    const state = await database.organizationState.read();
    const repository = await findRepositoryByOwnerName(database, ownerName, repositoryName);
    if (!repository) {
      sendJson(response, 404, { error: REPOSITORY_NOT_FOUND });
      return null;
    }
    const role =
      repository.ownerType === "organization"
        ? organizationRoleFromState(state, repository.ownerId, account?.id)
        : null;
    const repositoryAccess = repositoryRoleFromState(state, repository, account?.id);
    if (!canReadRepository(repository, repositoryAccess)) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return null;
    }
    return {
      state,
      repository,
      viewer: { role, repositoryRole: repositoryAccess, canManage: repositoryAccess === "admin" },
    };
  }

  /**
   * A readable repository plus the permission one write verb needs. A file or
   * branch change requires Write, Maintain, Admin or an organization Owner; a
   * repository setting change requires Admin. The rule is applied here for
   * every request, so hiding a control in the page is never the guard.
   */
  async function writableRepository(response, account, ownerName, repositoryName, required) {
    const scope = await readableRepository(response, account, ownerName, repositoryName);
    if (!scope) return null;
    if (!account) {
      sendJson(response, 401, { error: "Sign in required" });
      return null;
    }
    const repositoryRole = scope.viewer.repositoryRole;
    const allowed = required === "admin" ? repositoryRole === "admin" : canWriteRepository(repositoryRole);
    if (!allowed) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return null;
    }
    return scope;
  }

  async function sendRepositoryDetail(response, account, ownerName, repositoryName, searchParams) {
    const scope = await readableRepository(response, account, ownerName, repositoryName);
    if (!scope) return;
    const { state, repository, viewer } = scope;
    const branch = resolveBranchName(state, repository, searchParams?.get("branch"));
    sendJson(response, 200, {
      owner: repositoryOwnerRef(state, repository),
      viewer,
      repository: repositorySummary(state, repository),
      readme: readmeFile(state, repository),
      branch,
      branches: branchNames(state, repository).map((name) => ({ name })),
      files: branchFileList(state, repository, branch),
      commits: await repositoryCommits(database, repository),
    });
  }

  /** The commit history of one branch, newest first; an optional `path` narrows it to one file. */
  async function sendCommitHistory(response, account, ownerName, repositoryName, searchParams) {
    const scope = await readableRepository(response, account, ownerName, repositoryName);
    if (!scope) return;
    const { state, repository, viewer } = scope;
    const branch = resolveBranchName(state, repository, searchParams?.get("branch"));
    const path = searchParams?.get("path") ?? null;
    sendJson(response, 200, {
      owner: repositoryOwnerRef(state, repository),
      viewer,
      repository: repositorySummary(state, repository),
      branch,
      path: path && path.trim().length > 0 ? path.trim() : null,
      commits: await commitHistory(database, repository, branch, path),
    });
  }

  /** One commit and the line-by-line difference against its parent revision. */
  async function sendCommitDetail(response, account, ownerName, repositoryName, commitId) {
    const scope = await readableRepository(response, account, ownerName, repositoryName);
    if (!scope) return;
    const { state, repository, viewer } = scope;
    const detail = await commitDetail(database, repository, commitId);
    if (!detail) {
      sendJson(response, 404, { error: "Commit not found" });
      return;
    }
    sendJson(response, 200, {
      owner: repositoryOwnerRef(state, repository),
      viewer,
      repository: repositorySummary(state, repository),
      ...detail,
    });
  }

  /**
   * Code search over the readable content of one branch, inside the directory
   * the query was submitted from (the repository root by default); read-only.
   */
  async function sendCodeSearch(response, account, ownerName, repositoryName, searchParams) {
    const scope = await readableRepository(response, account, ownerName, repositoryName);
    if (!scope) return;
    const { state, repository, viewer } = scope;
    const branch = resolveBranchName(state, repository, searchParams?.get("branch"));
    const path = searchParams?.get("path") ?? "";
    const query = searchParams?.get("q") ?? "";
    sendJson(response, 200, {
      owner: repositoryOwnerRef(state, repository),
      viewer,
      repository: repositorySummary(state, repository),
      branch,
      path: path.trim() || null,
      query: query.trim(),
      results: searchCode(filesInDirectory(branchFileList(state, repository, branch), path), query),
    });
  }

  /**
   * Creates a branch from an existing revision. The new reference starts at the
   * head of the base branch and carries its own copy of that revision's history
   * and files, so browsing and committing on the new branch never rewrites the
   * base branch. Invalid names, duplicate names and unauthorized callers are
   * all refused without writing anything.
   */
  async function createBranch(request, response, account, ownerName, repositoryName) {
    const scope = await writableRepository(response, account, ownerName, repositoryName, "write");
    if (!scope) return;
    const { state, repository, viewer } = scope;
    const body = await readJsonSafe(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const names = branchNames(state, repository);
    if (!validateBranchName(name)) {
      sendJson(response, 422, { error: BRANCH_MESSAGES.nameInvalid });
      return;
    }
    if (names.includes(name)) {
      sendJson(response, 422, { error: BRANCH_MESSAGES.nameExists });
      return;
    }
    const requestedBase = typeof body.base === "string" ? body.base.trim() : "";
    const baseBranch = requestedBase || repository.defaultBranch || names[0];
    if (!names.includes(baseBranch)) {
      sendJson(response, 422, { error: BRANCH_MESSAGES.baseInvalid });
      return;
    }
    const now = new Date().toISOString();
    const next = await database.organizationState.update((draft) => {
      createBranchReference(draft, repository, { name, baseBranch, createdAt: now });
      return draft;
    });
    sendJson(response, 201, {
      owner: repositoryOwnerRef(next, repository),
      viewer,
      repository: repositorySummary(next, repository),
      branch: name,
      branches: branchNames(next, repository).map((branch) => ({ name: branch })),
      files: branchFileList(next, repository, name),
    });
  }

  /**
   * Adds one file to a branch. A valid submission writes exactly one commit
   * (path, content, message, author, parent revision and target branch) and
   * advances that branch's file snapshot; an invalid path or message answers
   * its field message and leaves the files, the branch head and the history
   * untouched.
   */
  async function createFile(request, response, account, ownerName, repositoryName) {
    const scope = await writableRepository(response, account, ownerName, repositoryName, "write");
    if (!scope) return;
    const { state, repository, viewer } = scope;
    const body = await readJsonSafe(request);
    const branch = resolveBranchName(
      state,
      repository,
      typeof body.branch === "string" ? body.branch : undefined,
    );
    const path = typeof body.path === "string" ? body.path.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    const errors = {};
    if (!isValidNewFilePath(branchFileList(state, repository, branch), path)) {
      errors.path = FILE_MESSAGES.pathInvalid;
    }
    if (message.length === 0) errors.message = FILE_MESSAGES.commitMessageRequired;
    else if (message.length > COMMIT_MESSAGE_MAX_LENGTH) errors.message = FILE_MESSAGES.commitMessageTooLong;
    if (Object.keys(errors).length > 0) {
      sendJson(response, 422, { errors });
      return;
    }

    const now = new Date().toISOString();
    let commit = null;
    const next = await database.organizationState.update((draft) => {
      commit = addFileCommit(draft, repository, {
        branch,
        path,
        content,
        message,
        authorId: account.id,
        createdAt: now,
      });
      return draft;
    });
    const { accounts } = await database.accounts.read();
    sendJson(response, 201, {
      owner: repositoryOwnerRef(next, repository),
      viewer,
      repository: repositorySummary(next, repository),
      branch,
      path,
      content,
      commit: publicCommit(commit, accounts),
    });
  }

  /**
   * Changes the default branch of one repository. Only a repository Admin or an
   * organization Owner may apply it; the setting lives on the repository
   * record, so every branch, commit and file it already had stays as it was.
   */
  async function updateDefaultBranch(request, response, account, ownerName, repositoryName) {
    const scope = await writableRepository(response, account, ownerName, repositoryName, "admin");
    if (!scope) return;
    const { state, repository, viewer } = scope;
    const body = await readJsonSafe(request);
    const requested = typeof body.branch === "string" ? body.branch.trim() : "";
    if (!requested || !branchNames(state, repository).includes(requested)) {
      sendJson(response, 422, { error: BRANCH_MESSAGES.baseInvalid });
      return;
    }
    const next = await database.organizationState.update((draft) => {
      const target = draft.repositories.find((candidate) => candidate.id === repository.id);
      if (target) target.defaultBranch = requested;
      return draft;
    });
    sendJson(response, 200, {
      owner: repositoryOwnerRef(next, repository),
      viewer,
      repository: repositorySummary(next, repository),
      branch: requested,
      branches: branchNames(next, repository).map((name) => ({ name })),
    });
  }

  async function createRepository(request, response, account) {
    const body = await readJsonSafe(request);
    const ownerType = body.ownerType === "user" || body.ownerType === "organization" ? body.ownerType : "";
    const ownerName = typeof body.ownerName === "string" ? body.ownerName.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const requestedVisibility = typeof body.visibility === "string" ? body.visibility.trim().toLowerCase() : "";
    const initialize = body.initialize === true;

    const resolution = await resolveTargetOwner(account, ownerType, ownerName);
    if (resolution.error) {
      sendJson(response, resolution.error.status, resolution.error.body);
      return;
    }
    const owner = resolution.owner;

    const errors = {};
    const { name, error: nameError } = await validateCandidateName(owner, body.name);
    if (nameError) errors.name = nameError;
    let visibility = requestedVisibility;
    if (requestedVisibility !== "public" && requestedVisibility !== "private") {
      errors.visibility = REPOSITORY_MESSAGES.visibilityInvalid;
      visibility = "public";
    }
    if (Object.keys(errors).length > 0) {
      sendJson(response, 422, { errors });
      return;
    }

    const now = new Date().toISOString();
    const repository = {
      id: `repo-${randomUUID()}`,
      ownerType: owner.type,
      ownerId: owner.id,
      ownerName: owner.name,
      name,
      description,
      visibility,
      defaultBranch: "main",
      creatorId: account.id,
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
    };
    // The repository record, its initial branch, README file and initialization
    // commit are written in one aggregate update: a failure at any step leaves
    // no partially created repository.
    const next = await database.organizationState.update((state) => {
      state.repositories.push(repository);
      state.branches ??= [];
      state.commits ??= [];
      state.files ??= [];
      if (initialize) {
        state.branches.push({
          id: `branch-${randomUUID()}`,
          repositoryId: repository.id,
          name: repository.defaultBranch,
          createdAt: now,
        });
        const initialContent = `# ${name}\n`;
        state.commits.push({
          id: `commit-${randomUUID()}`,
          repositoryId: repository.id,
          branch: repository.defaultBranch,
          message: "Initial commit",
          authorId: account.id,
          createdAt: now,
          parentId: null,
          changes: [{ path: "README.md", previous: null, content: initialContent }],
        });
        state.files.push({
          id: `file-${randomUUID()}`,
          repositoryId: repository.id,
          branch: repository.defaultBranch,
          path: "README.md",
          content: initialContent,
        });
      }
      return state;
    });
    const created = next.repositories.find((candidate) => candidate.id === repository.id) ?? repository;
    sendJson(response, 201, {
      owner: repositoryOwnerRef(next, created),
      repository: repositorySummary(next, created),
    });
  }

  async function createFork(request, response, account, ownerName, repositoryName) {
    const source = await findRepositoryByOwnerName(database, ownerName, repositoryName);
    if (!source) {
      sendJson(response, 404, { error: REPOSITORY_NOT_FOUND });
      return;
    }
    const state = await database.organizationState.read();
    // A fork requires Read or higher on the source repository.
    if (!canReadRepository(source, repositoryRoleFromState(state, source, account.id))) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return;
    }

    const body = await readJsonSafe(request);
    const ownerType = body.ownerType === "user" || body.ownerType === "organization" ? body.ownerType : "";
    const targetName = typeof body.ownerName === "string" ? body.ownerName.trim() : "";
    const requestedVisibility = typeof body.visibility === "string" ? body.visibility.trim().toLowerCase() : "";
    const requestedName = typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : source.name;

    const resolution = await resolveTargetOwner(account, ownerType, targetName);
    if (resolution.error) {
      sendJson(response, resolution.error.status, resolution.error.body);
      return;
    }
    const owner = resolution.owner;

    const errors = {};
    const { name, error: nameError } = await validateCandidateName(owner, requestedName);
    if (nameError) errors.name = nameError;
    if (requestedVisibility && requestedVisibility !== "public" && requestedVisibility !== "private") {
      errors.visibility = REPOSITORY_MESSAGES.visibilityInvalid;
    }
    if (Object.keys(errors).length > 0) {
      sendJson(response, 422, { errors });
      return;
    }
    // A private source repository can only be forked as a private repository.
    const visibility = source.visibility === "private" ? "private" : requestedVisibility === "private" ? "private" : "public";

    const now = new Date().toISOString();
    const fork = {
      id: `repo-${randomUUID()}`,
      ownerType: owner.type,
      ownerId: owner.id,
      ownerName: owner.name,
      name,
      description: source.description,
      visibility,
      defaultBranch: source.defaultBranch,
      creatorId: account.id,
      forkedFrom: source.id,
      createdAt: now,
      updatedAt: now,
    };
    // The fork, its copied default-branch branch/commits/files and the stored
    // source link are written together; a failure leaves no fork behind.
    const next = await database.organizationState.update((draft) => {
      draft.repositories.push(fork);
      draft.branches ??= [];
      draft.commits ??= [];
      draft.files ??= [];
      for (const branch of draft.branches.filter(
        (candidate) => candidate.repositoryId === source.id && candidate.name === source.defaultBranch,
      )) {
        draft.branches.push({ ...branch, id: `branch-${randomUUID()}`, repositoryId: fork.id, createdAt: now });
      }
      for (const commit of draft.commits.filter(
        (candidate) => candidate.repositoryId === source.id && candidate.branch === source.defaultBranch,
      )) {
        // The copied history keeps its original messages, authors, dates and
        // changed files so the fork's log and diffs match the source.
        draft.commits.push({
          ...commit,
          id: `commit-${randomUUID()}`,
          repositoryId: fork.id,
          changes: (commit.changes ?? []).map((change) => ({ ...change })),
        });
      }
      for (const file of draft.files.filter(
        (candidate) => candidate.repositoryId === source.id && candidate.branch === source.defaultBranch,
      )) {
        draft.files.push({ ...file, id: `file-${randomUUID()}`, repositoryId: fork.id });
      }
      return draft;
    });
    const created = next.repositories.find((candidate) => candidate.id === fork.id) ?? fork;
    sendJson(response, 201, {
      owner: repositoryOwnerRef(next, created),
      repository: repositorySummary(next, created),
    });
  }

  return async function handleRepositoryApi(request, response, pathname, searchParams) {
    if (pathname === "/api/repositories" && request.method === "GET") {
      const account = await findCurrentAccount(database, request);
      sendJson(response, 200, {
        repositories: await listReadableRepositories(database, account?.id),
      });
      return true;
    }

    if (pathname === "/api/repositories" && request.method === "POST") {
      const account = await findCurrentAccount(database, request);
      if (!account) {
        sendJson(response, 401, { error: "Sign in required" });
        return true;
      }
      await createRepository(request, response, account);
      return true;
    }

    if (pathname === "/api/search/repositories" && request.method === "GET") {
      const account = await findCurrentAccount(database, request);
      const query = searchParams?.get("q") ?? "";
      sendJson(response, 200, {
        query: query.trim(),
        results: await searchReadableRepositories(database, account?.id, query),
      });
      return true;
    }

    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] !== "api" || segments[1] !== "repositories") return false;

    if (segments.length === 4 && request.method === "GET") {
      const account = await findCurrentAccount(database, request);
      await sendRepositoryDetail(
        response,
        account,
        decodeURIComponent(segments[2]),
        decodeURIComponent(segments[3]),
        searchParams,
      );
      return true;
    }

    // Read-only code views: history, one commit's difference and code search.
    // They never write to the repository and follow the same read permission as
    // the repository detail.
    if (segments.length === 5 && request.method === "GET" && segments[4] === "commits") {
      const account = await findCurrentAccount(database, request);
      await sendCommitHistory(
        response,
        account,
        decodeURIComponent(segments[2]),
        decodeURIComponent(segments[3]),
        searchParams,
      );
      return true;
    }

    if (segments.length === 5 && request.method === "GET" && segments[4] === "code-search") {
      const account = await findCurrentAccount(database, request);
      await sendCodeSearch(
        response,
        account,
        decodeURIComponent(segments[2]),
        decodeURIComponent(segments[3]),
        searchParams,
      );
      return true;
    }

    if (segments.length === 6 && request.method === "GET" && segments[4] === "commit") {
      const account = await findCurrentAccount(database, request);
      await sendCommitDetail(
        response,
        account,
        decodeURIComponent(segments[2]),
        decodeURIComponent(segments[3]),
        decodeURIComponent(segments[5]),
      );
      return true;
    }

    if (segments.length === 5 && segments[4] === "branches" && request.method === "POST") {
      const account = await findCurrentAccount(database, request);
      await createBranch(request, response, account, decodeURIComponent(segments[2]), decodeURIComponent(segments[3]));
      return true;
    }

    if (segments.length === 5 && segments[4] === "files" && request.method === "POST") {
      const account = await findCurrentAccount(database, request);
      await createFile(request, response, account, decodeURIComponent(segments[2]), decodeURIComponent(segments[3]));
      return true;
    }

    if (segments.length === 5 && segments[4] === "default-branch" && request.method === "PUT") {
      const account = await findCurrentAccount(database, request);
      await updateDefaultBranch(
        request,
        response,
        account,
        decodeURIComponent(segments[2]),
        decodeURIComponent(segments[3]),
      );
      return true;
    }

    if (segments.length === 5 && segments[4] === "fork" && request.method === "POST") {
      const account = await findCurrentAccount(database, request);
      if (!account) {
        sendJson(response, 401, { error: "Sign in required" });
        return true;
      }
      await createFork(request, response, account, decodeURIComponent(segments[2]), decodeURIComponent(segments[3]));
      return true;
    }

    return false;
  };
}
