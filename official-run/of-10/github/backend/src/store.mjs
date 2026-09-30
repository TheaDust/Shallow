import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createJsonStore } from "./lib/json-store.mjs";
import { createInitialState } from "./seed.mjs";
import { createBranchProtectionHandlers } from "./store-branch-protection.mjs";
import { createCodeWriteHandlers } from "./store-code-writes.mjs";
import { createIssueHandlers } from "./store-issues.mjs";
import { createPullRequestHandlers } from "./store-pull-requests.mjs";
import { createOrganizationHandlers } from "./store-organizations.mjs";
import { createRepositoryAccessHandlers } from "./store-repository-access.mjs";
import {
  ACCOUNT_MESSAGES,
  RESET_VERIFICATION_CODE,
  collectPasswordChangeErrors,
  collectPasswordResetErrors,
  collectRegistrationErrors,
  normalizeEmail,
  normalizeUsername,
} from "./domain/validation.mjs";
import { hashPassword, verifyPassword } from "./domain/credentials.mjs";
import {
  canAdministerRepository,
  listCreatableNamespaces as listNamespaces,
  resolveCreatableNamespace,
} from "./domain/repository-access.mjs";
import {
  REPOSITORY_NAME_MESSAGES,
  availableForkName,
  buildFork,
  buildRepository,
  isValidRepositoryName,
  normalizeRepositoryName,
  readRepositoryVisibility,
  repositoryNameExistsMessage,
} from "./domain/repository-creation.mjs";
import {
  canViewRepository,
  findRepository,
  findRepositoryByFullName,
  listCommitPayloads,
  normalizeSearchType,
  resolveBranch,
  searchRepositories as searchRepositoryResults,
  toCommitPayload,
  toComparisonPayload,
  toFilePayload,
  toRepositoryContext,
  toRepositorySummary,
  toRepositoryView,
} from "./domain/repositories.mjs";
import { branchPaths, findCommit, normalizePath } from "./domain/commit-graph.mjs";
import { searchCode } from "./domain/code-search.mjs";

export function toPublicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    emailVerified: account.emailVerified === true,
  };
}

function readNewPassword(input) {
  return typeof input.newPassword === "string" ? input.newPassword : "";
}

function findAccountByUsername(accounts, username) {
  return accounts.find((account) => account.username === username);
}

function findAccountByEmail(accounts, email) {
  const normalized = normalizeEmail(email).toLowerCase();
  return accounts.find((account) => normalizeEmail(account.email).toLowerCase() === normalized);
}

function repositoryFailure(status, error, fields) {
  return { ok: false, status, error, fields: fields ?? {} };
}

/** Repository view returned by every write that changes a repository record. */
function repositoryPayload(state, repository, branch, viewer) {
  return toRepositoryView(repository, state, viewer, branch, "");
}

/**
 * Accounts and sessions live in one JSON state file so that every write is
 * validated against the current state and applied atomically.
 */
export function createStore({ dataDir }) {
  const jsonStore = createJsonStore(join(dataDir, "state.json"), createInitialState());

  /**
   * Loads the repository, the resolved branch and the viewer's context for one
   * read, applying the single visibility rule; the refusal status distinguishes
   * a signed-in viewer who may not read an existing private repository (`403`)
   * from every anonymous viewer, who keeps the plain `Not found` answer.
   */
  async function readRepositoryRead(state, sessionId, owner, name, branch) {
    const viewer = resolveViewer(state, sessionId);
    const repository = findRepository(state, owner, name);
    if (!repository) return { status: 404 };
    if (!canViewRepository(state, repository, viewer)) return { status: viewer ? 403 : 404 };
    const resolvedBranch = resolveBranch(repository, branch);
    if (!resolvedBranch) return { status: 404 };
    return {
      viewer,
      repository,
      branch: resolvedBranch,
      context: toRepositoryContext(repository, state, viewer, resolvedBranch),
    };
  }

  async function registerAccount(input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const username = normalizeUsername(input.username);
      const email = normalizeEmail(input.email);
      const errors = collectRegistrationErrors(input);

      if (!errors.username && findAccountByUsername(state.accounts, username)) {
        errors.username = ACCOUNT_MESSAGES.usernameExists;
      }
      if (!errors.email && findAccountByEmail(state.accounts, email)) {
        errors.email = ACCOUNT_MESSAGES.emailExists;
      }
      if (Object.keys(errors).length > 0) {
        outcome = { ok: false, errors };
        return;
      }

      const account = {
        id: randomUUID(),
        username,
        email,
        emailVerified: true,
        status: "active",
        credential: hashPassword(input.password),
        createdAt: new Date().toISOString(),
      };
      state.accounts.push(account);
      outcome = { ok: true, account: toPublicAccount(account) };
    });
    return outcome;
  }

  async function authenticate(identifier, password) {
    const state = await jsonStore.read();
    const key = normalizeUsername(identifier).trim();
    if (!key) return { ok: false };
    const account = findAccountByUsername(state.accounts, key) ?? findAccountByEmail(state.accounts, key);
    if (!account) return { ok: false };
    if (account.status !== "active" || account.emailVerified !== true) return { ok: false };
    if (!verifyPassword(password, account.credential)) return { ok: false };
    return { ok: true, account: toPublicAccount(account) };
  }

  async function createSession(accountId) {
    let session;
    await jsonStore.update((state) => {
      const record = {
        id: randomUUID(),
        accountId,
        active: true,
        createdAt: new Date().toISOString(),
      };
      state.sessions.push(record);
      session = { id: record.id, accountId, active: true };
    });
    return session;
  }

  function resolveViewer(state, sessionId) {
    if (!sessionId) return null;
    const session = state.sessions.find((candidate) => candidate.id === sessionId && candidate.active);
    if (!session) return null;
    return state.accounts.find((candidate) => candidate.id === session.accountId) ?? null;
  }

  async function findSessionAccount(sessionId) {
    if (!sessionId) return null;
    const state = await jsonStore.read();
    const account = resolveViewer(state, sessionId);
    return account ? toPublicAccount(account) : null;
  }

  /** Search reads the viewer from the current session and applies the access rule. */
  async function searchRepositories(
    sessionId,
    { query = "", type = "repositories", repository: repositoryRef = "", path = "" } = {},
  ) {
    const state = await jsonStore.read();
    const viewer = resolveViewer(state, sessionId);
    const normalizedType = normalizeSearchType(type);
    // Code search reads only the readable content of the searched repositories,
    // so a result can never leak a repository the viewer may not read.
    if (normalizedType === "code") {
      const scoped = repositoryRef ? findRepositoryByFullName(state, repositoryRef) : null;
      if (repositoryRef && !(scoped && canViewRepository(state, scoped, viewer))) {
        return { query: String(query ?? ""), type: normalizedType, repository: null, results: [], repositories: [] };
      }
      const found = searchCode(state, viewer, scoped ?? state.repositories ?? [], query, {
        path,
        repository: scoped,
      });
      return {
        query: String(query ?? ""),
        type: normalizedType,
        repository: found.repository,
        results: found.results,
        repositories: [],
      };
    }
    return searchRepositoryResults(state, viewer, { query, type: normalizedType });
  }

  /**
   * Returns the code view of one directory for the current viewer, or the status
   * of the refusal (see `readRepositoryRead`).
   */
  async function getRepositoryView(sessionId, owner, name, { branch, path } = {}) {
    const state = await jsonStore.read();
    const loaded = await readRepositoryRead(state, sessionId, owner, name, branch);
    if (loaded.status) return loaded;
    const view = toRepositoryView(loaded.repository, state, loaded.viewer, loaded.branch, path);
    // A readable repository whose branch has no such directory is not an unknown
    // address: the caller keeps the repository and branch context.
    if (!view) return { status: 404, missingPath: true, repository: loaded.context };
    return { status: 200, repository: view };
  }

  /** Repositories of one namespace the viewer may read (personal list, REQ-3). */
  async function listRepositories(sessionId, ownerLogin) {
    const state = await jsonStore.read();
    const viewer = resolveViewer(state, sessionId);
    const login = String(ownerLogin ?? viewer?.username ?? "").trim();
    if (!login) return repositoryFailure(401, "Not authenticated");
    const owner = (state.accounts ?? []).find(
      (account) => account.username.toLowerCase() === login.toLowerCase(),
    );
    const organization = owner
      ? null
      : (state.organizations ?? []).find(
          (candidate) => String(candidate.login ?? "").toLowerCase() === login.toLowerCase(),
        );
    if (!owner && !organization) return repositoryFailure(404, "Not found");
    const repositories = (state.repositories ?? [])
      .filter((repository) => repository.owner.login.toLowerCase() === login.toLowerCase())
      .filter((repository) => canViewRepository(state, repository, viewer))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((repository) => toRepositorySummary(repository, state));
    return {
      ok: true,
      owner: {
        type: owner ? "user" : "organization",
        login: owner ? owner.username : organization.login,
      },
      repositories,
    };
  }

  async function listCreatableNamespaceOptions(sessionId) {
    const state = await jsonStore.read();
    const viewer = resolveViewer(state, sessionId);
    if (!viewer) return repositoryFailure(401, "Not authenticated");
    return { ok: true, namespaces: listNamespaces(state, viewer) };
  }

  /**
   * Creates a repository (optionally with an initial README commit) as one
   * atomic write: a rejected request leaves no partial repository behind.
   */
  async function createRepository(sessionId, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = repositoryFailure(401, "Not authenticated");
        return;
      }
      const namespace = resolveCreatableNamespace(
        state,
        viewer,
        input.owner ?? viewer.username,
        input.ownerType,
      );
      if (!namespace.ok) {
        outcome = repositoryFailure(namespace.error === "Not authenticated" ? 401 : 403, namespace.error);
        return;
      }
      const name = normalizeRepositoryName(input.name);
      const fields = {};
      if (!name) fields.name = REPOSITORY_NAME_MESSAGES.required;
      else if (!isValidRepositoryName(name)) fields.name = REPOSITORY_NAME_MESSAGES.invalid;

      const visibility = readRepositoryVisibility(input.visibility);
      if (!visibility) fields.visibility = "Choose Public or Private";

      if (!fields.name && findRepository(state, namespace.owner.login, name)) {
        fields.name = repositoryNameExistsMessage(`${namespace.owner.login}/${name}`);
      }
      if (Object.keys(fields).length > 0) {
        outcome = repositoryFailure(400, "Repository creation failed", fields);
        return;
      }

      const repository = buildRepository({
        owner: namespace.owner,
        name,
        visibility,
        description: String(input.description ?? "").trim(),
        creator: { id: viewer.id, login: viewer.username },
        initialize: input.initializeWithReadme === true,
      });
      state.repositories.push(repository);
      outcome = {
        ok: true,
        status: 201,
        repository: repositoryPayload(state, repository, repository.defaultBranch, viewer),
      };
    });
    return outcome;
  }

  function readForkTarget(state, viewer, source, input) {
    const namespace = resolveCreatableNamespace(
      state,
      viewer,
      input.owner ?? viewer.username,
      input.ownerType,
    );
    if (!namespace.ok) {
      return {
        failure: repositoryFailure(
          namespace.error === "Not authenticated" ? 401 : 403,
          namespace.error,
        ),
      };
    }
    const requested = String(input.name ?? "").trim();
    const name = requested
      ? normalizeRepositoryName(requested)
      : availableForkName(state, namespace.owner.login, source.name);
    const fields = {};
    if (!isValidRepositoryName(name)) fields.name = REPOSITORY_NAME_MESSAGES.invalid;
    else if (findRepository(state, namespace.owner.login, name)) {
      fields.name = repositoryNameExistsMessage(`${namespace.owner.login}/${name}`);
    }
    if (Object.keys(fields).length > 0) {
      return { failure: repositoryFailure(400, "Fork creation failed", fields) };
    }
    return { namespace, name };
  }

  /** Default name/visibility the fork form offers for one target namespace. */
  async function getForkDefaults(sessionId, owner, name, namespaceLogin) {
    const state = await jsonStore.read();
    const viewer = resolveViewer(state, sessionId);
    if (!viewer) return repositoryFailure(401, "Not authenticated");
    const source = findRepository(state, owner, name);
    if (!canViewRepository(state, source, viewer)) return repositoryFailure(404, "Not found");
    const namespace = resolveCreatableNamespace(state, viewer, namespaceLogin ?? viewer.username);
    if (!namespace.ok) {
      return repositoryFailure(namespace.error === "Not authenticated" ? 401 : 403, namespace.error);
    }
    return {
      ok: true,
      namespace: { type: namespace.owner.type, login: namespace.owner.login },
      name: availableForkName(state, namespace.owner.login, source.name),
      visibility: source.visibility,
    };
  }

  /**
   * Creates an independent fork: the source's history is copied, the source
   * identifier is recorded and the source repository is never written to.
   */
  async function forkRepository(sessionId, owner, name, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = repositoryFailure(401, "Not authenticated");
        return;
      }
      const source = findRepository(state, owner, name);
      if (!canViewRepository(state, source, viewer)) {
        outcome = repositoryFailure(404, "Not found");
        return;
      }
      const target = readForkTarget(state, viewer, source, input);
      if (target.failure) {
        outcome = target.failure;
        return;
      }
      const requestedVisibility = readRepositoryVisibility(input.visibility);
      if (input.visibility != null && String(input.visibility).trim() !== "" && !requestedVisibility) {
        outcome = repositoryFailure(400, "Fork creation failed", {
          visibility: "Choose Public or Private",
        });
        return;
      }
      // A private source stays private; a public source may be forked either way.
      const visibility =
        source.visibility === "private" ? "private" : requestedVisibility ?? "public";
      const fork = buildFork({
        source,
        owner: target.namespace.owner,
        name: target.name,
        visibility,
        creator: { id: viewer.id, login: viewer.username },
      });
      state.repositories.push(fork);
      outcome = {
        ok: true,
        status: 201,
        repository: repositoryPayload(state, fork, fork.defaultBranch, viewer),
      };
    });
    return outcome;
  }

  /** Only a repository administrator may change visibility (REQ-3-4). */
  async function changeRepositoryVisibility(sessionId, owner, name, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = repositoryFailure(401, "Not authenticated");
        return;
      }
      const repository = findRepository(state, owner, name);
      if (!canViewRepository(state, repository, viewer)) {
        outcome = repositoryFailure(404, "Not found");
        return;
      }
      if (!canAdministerRepository(state, repository, viewer)) {
        outcome = repositoryFailure(
          403,
          "You must be a repository administrator to change its visibility.",
        );
        return;
      }
      const visibility = readRepositoryVisibility(input.visibility);
      if (!visibility) {
        outcome = repositoryFailure(400, "Visibility change failed", {
          visibility: "Choose Public or Private",
        });
        return;
      }
      const confirmation = String(input.confirmationName ?? "").trim().toLowerCase();
      const accepted = [repository.name.toLowerCase(), `${repository.owner.login}/${repository.name}`.toLowerCase()];
      if (confirmation && !accepted.includes(confirmation)) {
        outcome = repositoryFailure(400, "Repository name does not match", {
          confirmationName: "The repository name does not match",
        });
        return;
      }
      repository.visibility = visibility;
      repository.updatedAt = new Date().toISOString();
      outcome = {
        ok: true,
        status: 200,
        repository: repositoryPayload(state, repository, repository.defaultBranch, viewer),
      };
    });
    return outcome;
  }

  async function getRepositoryFile(sessionId, owner, name, { branch, path } = {}) {
    const state = await jsonStore.read();
    const loaded = await readRepositoryRead(state, sessionId, owner, name, branch);
    if (loaded.status) return loaded;
    const file = toFilePayload(loaded.repository, loaded.branch, path);
    // A readable repository whose branch has no such file is not the same as an
    // unreadable one: the caller may show the file as absent on that branch.
    if (!file) return { status: 404, missingFile: true, repository: loaded.context };
    return {
      status: 200,
      payload: { repository: loaded.context, file },
    };
  }

  /** Branch history, or the file-scoped history of one path (REQ-4-2-1). */
  async function listRepositoryCommits(sessionId, owner, name, { branch, path } = {}) {
    const state = await jsonStore.read();
    const loaded = await readRepositoryRead(state, sessionId, owner, name, branch);
    if (loaded.status) return loaded;
    const wanted = normalizePath(path);
    return {
      status: 200,
      payload: {
        repository: loaded.context,
        branch: loaded.branch,
        path: wanted,
        // The branch's file paths let a history view offer its file scopes
        // without a second read of the tree.
        files: branchPaths(loaded.repository, loaded.branch),
        commits: listCommitPayloads(loaded.repository, loaded.branch, wanted),
      },
    };
  }

  /** One commit with its parent, changed files and line-level diff (REQ-4-2-2). */
  async function getRepositoryCommit(sessionId, owner, name, commitId, { path } = {}) {
    const state = await jsonStore.read();
    const loaded = await readRepositoryRead(state, sessionId, owner, name, "");
    if (loaded.status) return loaded;
    const commit = findCommit(loaded.repository, commitId);
    if (!commit) return { status: 404 };
    const payload = toCommitPayload(loaded.repository, commit);
    const wanted = normalizePath(path);
    // A diff limited to one changed file reports that file alone, including its
    // own additions and deletions.
    const changedFiles = wanted
      ? payload.changedFiles.filter((file) => file.path === wanted)
      : payload.changedFiles;
    return {
      status: 200,
      payload: {
        repository: loaded.context,
        commit: {
          ...payload,
          ...(wanted ? { path: wanted } : {}),
          changedFiles,
          filesChanged: changedFiles.length,
          additions: changedFiles.reduce((total, file) => total + file.additions, 0),
          deletions: changedFiles.reduce((total, file) => total + file.deletions, 0),
        },
      },
    };
  }

  /** Comparison of two readable revisions (REQ-4-2-2). */
  async function compareRepositoryRevisions(sessionId, owner, name, { base, compare } = {}) {
    const state = await jsonStore.read();
    const loaded = await readRepositoryRead(state, sessionId, owner, name, "");
    if (loaded.status) return loaded;
    const comparison = toComparisonPayload(loaded.repository, base, compare);
    if (!comparison) return { status: 404 };
    return { status: 200, payload: { repository: loaded.context, ...comparison } };
  }

  /**
   * Local recovery request: the answer never depends on whether the address is
   * registered, and no email, link or recovery record is produced.
   */
  async function requestPasswordReset() {
    return { code: RESET_VERIFICATION_CODE };
  }

  async function resetPassword(input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const errors = collectPasswordResetErrors(input);
      if (Object.keys(errors).length > 0) {
        outcome = { ok: false, error: "Password reset failed", fields: errors };
        return;
      }
      const account = findAccountByEmail(state.accounts, input.email);
      if (!account) {
        outcome = { ok: false, error: ACCOUNT_MESSAGES.recoveryEmailUnknown, fields: {} };
        return;
      }
      account.credential = hashPassword(readNewPassword(input));
      // A recovered account loses every session it had before the reset.
      for (const session of state.sessions) {
        if (session.accountId === account.id) session.active = false;
      }
      outcome = { ok: true };
    });
    return outcome;
  }

  /**
   * Changes the password of the account behind the current session only. Other
   * accounts and the current session stay untouched; older sessions of the same
   * account stop being usable.
   */
  async function changePassword(sessionId, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const session = state.sessions.find((candidate) => candidate.id === sessionId && candidate.active);
      const account = session ? state.accounts.find((candidate) => candidate.id === session.accountId) : null;
      if (!account) {
        outcome = { ok: false, unauthorized: true };
        return;
      }
      const errors = collectPasswordChangeErrors(input, account.credential);
      if (Object.keys(errors).length > 0) {
        outcome = { ok: false, error: "Password update failed", fields: errors };
        return;
      }
      account.credential = hashPassword(readNewPassword(input));
      for (const candidate of state.sessions) {
        if (candidate.accountId === account.id && candidate.id !== session.id) candidate.active = false;
      }
      outcome = { ok: true };
    });
    return outcome;
  }

  async function endSession(sessionId) {
    if (!sessionId) return false;
    let ended = false;
    await jsonStore.update((state) => {
      const session = state.sessions.find((candidate) => candidate.id === sessionId);
      if (session && session.active) {
        session.active = false;
        ended = true;
      }
    });
    return ended;
  }

  // Organization, membership and team operations share the same state file and
  // session resolution as the account and repository operations above.
  const organizationHandlers = createOrganizationHandlers({ jsonStore, resolveViewer });
  // Repository access management (REQ-2-3) shares the same state file and session.
  const repositoryAccessHandlers = createRepositoryAccessHandlers({ jsonStore, resolveViewer });
  // Branch and file writes of the code pages (REQ-4-3, REQ-4-4) share it too.
  const codeWriteHandlers = createCodeWriteHandlers({ jsonStore, resolveViewer });
  // Issue reads and writes (REQ-5) read the same sessions and repositories.
  const issueHandlers = createIssueHandlers({ jsonStore, resolveViewer });
  // Pull requests and branch protection rules (REQ-6) share them too.
  const pullRequestHandlers = createPullRequestHandlers({ jsonStore, resolveViewer });
  const branchProtectionHandlers = createBranchProtectionHandlers({ jsonStore, resolveViewer });

  return {
    registerAccount,
    authenticate,
    createSession,
    findSessionAccount,
    searchRepositories,
    getRepositoryView,
    getRepositoryFile,
    listRepositoryCommits,
    getRepositoryCommit,
    compareRepositoryRevisions,
    listRepositories,
    listCreatableNamespaceOptions,
    createRepository,
    getForkDefaults,
    forkRepository,
    changeRepositoryVisibility,
    endSession,
    requestPasswordReset,
    resetPassword,
    changePassword,
    ...organizationHandlers,
    ...repositoryAccessHandlers,
    ...codeWriteHandlers,
    ...issueHandlers,
    ...pullRequestHandlers,
    ...branchProtectionHandlers,
  };
}
