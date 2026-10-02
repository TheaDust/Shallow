import {
  canManageRepository,
  canReadRepository,
  canWriteRepository,
  changeRepositoryVisibility,
  createRepository,
  findRepository,
  findUserRepository,
  forkRepository,
  listAccountRepositories,
  repositoryOwner,
  repositorySummary,
  repositoryView,
  resolveRepositoryOwner,
  searchRepositories,
} from "../domain/repositories.mjs";
import { findOrganizationBySlug } from "../domain/organizations.mjs";
import {
  changeDefaultBranch,
  commitDetailView,
  commitRecordView,
  createBranch,
  createFileCommit,
  fileNameOf,
  findBranch,
  listBranchHistory,
  listDirectoryEntries,
  readCommit,
  readRepositoryFile,
  searchRepositoryContent,
} from "../domain/repository-content.mjs";
import { readJson, sendJson } from "../lib/http.mjs";
import { createRouter } from "../lib/router.mjs";
import { resolveSessionAccount } from "../lib/session.mjs";

const SIGN_IN_REQUIRED = "Sign in required";
const NOT_FOUND = "Not found";
const ACCESS_DENIED = "Access denied";

async function readBody(request, response) {
  try {
    return await readJson(request);
  } catch {
    sendJson(response, 400, { error: "Invalid request body" });
    return null;
  }
}

function publicOwner(owner) {
  if (!owner) return null;
  return { kind: owner.kind, name: owner.name, slug: owner.slug };
}

/**
 * Resolves the repository addressed by an owner kind, owner and name, together
 * with the resolved owner namespace. Shared by the read-only query handlers and
 * the branch mutations so one resolution serves every repository endpoint.
 */
function resolveTarget(state, ownerKind, ownerIdentifier, name) {
  const owner = resolveRepositoryOwner(state, ownerKind, ownerIdentifier);
  if (!owner) return { owner: null, repository: null };
  const repository = owner.kind === "organization"
    ? findRepository(state, owner.organizationId, name)
    : findUserRepository(state, owner.slug, name);
  return { owner, repository };
}

/**
 * Repository API for personal and organization repositories: the repository
 * directory, creation, forks, the owned repository lists and the read-only file
 * content of one branch. Read access is always decided from the authoritative
 * state through `canReadRepository`, so lists, direct links and file pages use
 * exactly one visibility rule.
 */
export function createRepositoryRouter({ store }) {
  const router = createRouter();

  // Public directory behind the home page: public repositories of every owner.
  router.add("GET", "/api/explore/repositories", async (request, response) => {
    const state = await store.read();
    const repositories = state.repositories
      .filter((repository) => repository.visibility === "public")
      .map((repository) => repositorySummary(state, repository))
      .filter(Boolean)
      .sort((left, right) => (
        `${left.owner.name}/${left.name}`.localeCompare(`${right.owner.name}/${right.name}`)
      ));
    sendJson(response, 200, { repositories });
  });

  // Global repository search of the top search box. The result set is decided
  // by the same read rule as every repository list, so a private repository
  // never appears for a viewer who may not read it.
  router.add("GET", "/api/search/repositories", async (request, response, params, url) => {
    const { state, account } = await resolveSessionAccount(store, request);
    const query = url.searchParams.get("q") ?? "";
    sendJson(response, 200, {
      query,
      repositories: searchRepositories(state, query, account?.id ?? null),
    });
  });

  // Creating a personal or organization repository in one mutation.
  router.add("POST", "/api/repositories", async (request, response) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const { account } = await resolveSessionAccount(store, request);
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    const result = await store.mutate((state) => {
      const current = state.accounts.find((candidate) => (
        candidate.id === account.id && candidate.status === "available"
      ));
      if (!current) return { authenticated: false };
      return { authenticated: true, ...createRepository(state, current, body) };
    });
    if (!result.authenticated) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    const state = await store.read();
    const repository = state.repositories.find((candidate) => candidate.id === result.repository.id);
    sendJson(response, 201, { repository: repositoryView(state, repository, account.id) });
  });

  // Visibility change of one repository. The repository administrator is
  // decided from the authoritative state (never from a submitted role), and the
  // new visibility is stored in the same mutation that validates it.
  router.add("POST", "/api/repositories/visibility", async (request, response) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const { account } = await resolveSessionAccount(store, request);
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    const result = await store.mutate((state) => {
      const current = state.accounts.find((candidate) => (
        candidate.id === account.id && candidate.status === "available"
      ));
      if (!current) return { authenticated: false };
      const owner = resolveRepositoryOwner(state, body.ownerKind, body.owner);
      if (!owner) return { missing: true };
      const repository = owner.kind === "organization"
        ? findRepository(state, owner.organizationId, body.name)
        : findUserRepository(state, owner.slug, body.name);
      return changeRepositoryVisibility(state, repository, current.id, body.visibility);
    });
    if (result.authenticated === false) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    if (result.missing) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    const state = await store.read();
    const repository = state.repositories.find((candidate) => candidate.id === result.repository.id);
    sendJson(response, 200, { repository: repositoryView(state, repository, account.id) });
  });

  // "Your repositories": the personal repositories of one account.
  router.add("GET", "/api/users/:username/repositories", async (request, response, params) => {
    const { state, account } = await resolveSessionAccount(store, request);
    const owner = resolveRepositoryOwner(state, "account", params.username);
    if (!owner) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const repositories = listAccountRepositories(state, owner.accountId)
      .filter((repository) => canReadRepository(state, repository, account?.id ?? null))
      .map((repository) => repositorySummary(state, repository))
      .filter(Boolean);
    sendJson(response, 200, { owner: publicOwner(owner), repositories });
  });

  router.add("GET", "/api/users/:username/repositories/:name", async (request, response, params, url) => {
    const { state, account } = await resolveSessionAccount(store, request);
    const repository = findUserRepository(state, params.username, params.name);
    if (!repository) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (!canReadRepository(state, repository, account?.id ?? null)) {
      sendJson(response, account ? 403 : 404, { error: account ? ACCESS_DENIED : NOT_FOUND });
      return;
    }
    sendJson(response, 200, {
      repository: repositoryView(state, repository, account?.id ?? null, url.searchParams.get("branch")),
    });
  });

  // Read-only content of one file on one branch; the repository is identified
  // by owner kind, owner and name, so personal and organization files use one
  // endpoint and one access rule.
  router.add("GET", "/api/repositories/files", async (request, response, params, url) => {
    const { state, account } = await resolveSessionAccount(store, request);
    const owner = resolveRepositoryOwner(state, url.searchParams.get("ownerKind"), url.searchParams.get("owner"));
    if (!owner) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const repository = owner.kind === "organization"
      ? findRepository(state, owner.organizationId, url.searchParams.get("name"))
      : findUserRepository(state, owner.slug, url.searchParams.get("name"));
    if (!repository) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (!canReadRepository(state, repository, account?.id ?? null)) {
      sendJson(response, account ? 403 : 404, { error: account ? ACCESS_DENIED : NOT_FOUND });
      return;
    }
    const branch = url.searchParams.get("branch") || repository.defaultBranch;
    const file = readRepositoryFile(state, repository, branch, url.searchParams.get("path"));
    if (!file) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    sendJson(response, 200, {
      file: {
        name: fileNameOf(file.path),
        path: file.path,
        branch,
        content: file.content,
        repository: repository.name,
        owner: publicOwner(repositoryOwner(state, repository)),
      },
    });
  });

  /**
   * Reads the repository addressed by the query string after applying exactly
   * the same read rule as every other repository view. Returns the resolution
   * outcome so each read-only handler answers 404 for a visitor and 403 for a
   * signed-in account that may not read the repository.
   */
  async function readTarget(request, url) {
    const { state, account } = await resolveSessionAccount(store, request);
    const { owner, repository } = resolveTarget(
      state,
      url.searchParams.get("ownerKind"),
      url.searchParams.get("owner"),
      url.searchParams.get("name"),
    );
    if (!owner || !repository) return { status: 404, error: NOT_FOUND };
    if (!canReadRepository(state, repository, account?.id ?? null)) {
      return { status: account ? 403 : 404, error: account ? ACCESS_DENIED : NOT_FOUND };
    }
    return { state, repository, owner };
  }

  /**
   * Resolves a repository inside one mutation after re-reading the signed-in
   * account from the authoritative state and applying the shared read rule.
   * `mustWrite` additionally requires content write permission (Write, Maintain,
   * Admin or organization Owner).
   */
  function resolveMutationTarget(state, account, body, { mustWrite = false, mustManage = false } = {}) {
    const current = state.accounts.find((candidate) => (
      candidate.id === account.id && candidate.status === "available"
    ));
    if (!current) return { authenticated: false };
    const { owner, repository } = resolveTarget(state, body.ownerKind, body.owner, body.name);
    if (!owner || !repository) return { missing: true };
    if (!canReadRepository(state, repository, current.id)) return { denied: true };
    if (mustWrite && !canWriteRepository(state, repository, current.id)) return { forbidden: true };
    if (mustManage && !canManageRepository(state, repository, current.id)) return { forbidden: true };
    return { current, repository };
  }

  // Creates a named branch at the head of a base branch (the current branch
  // unless another one is submitted). Creating a branch writes a new reference
  // and never copies files into the base branch nor rewrites its history.
  router.add("POST", "/api/repositories/branches", async (request, response) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const { account } = await resolveSessionAccount(store, request);
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    const result = await store.mutate((state) => {
      const target = resolveMutationTarget(state, account, body, { mustWrite: true });
      if (!target.repository) return target;
      return { ...target, ...createBranch(state, target.repository, {
        branch: body.branch,
        baseBranch: body.baseBranch,
      }) };
    });
    if (result.authenticated === false) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    if (result.missing) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (result.denied || result.forbidden) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    const state = await store.read();
    const repository = state.repositories.find((candidate) => candidate.id === result.repository.id);
    sendJson(response, 201, {
      repository: repositoryView(state, repository, account.id, result.branch.name),
    });
  });

  // Adding a file to the current branch of one repository: a single immutable
  // commit is appended to the branch head. The write rule (Write, Maintain,
  // Admin or organization Owner), the file path rule and the commit message
  // rule are all applied before anything is stored, so a rejected submission
  // leaves the file data, the branch head and the commit history unchanged.
  router.add("POST", "/api/repositories/files", async (request, response) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const { account } = await resolveSessionAccount(store, request);
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    const result = await store.mutate((state) => {
      const target = resolveMutationTarget(state, account, body, { mustWrite: true });
      if (!target.repository) return target;
      return {
        ...target,
        ...createFileCommit(state, target.repository, target.current, {
          branch: body.branch,
          path: body.path,
          content: body.content,
          message: body.message,
        }),
      };
    });
    if (result.authenticated === false) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    if (result.missing) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (result.denied || result.forbidden) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    const state = await store.read();
    const repository = state.repositories.find((candidate) => candidate.id === result.repository.id);
    sendJson(response, 201, {
      file: {
        ...result.file,
        repository: repository.name,
        owner: publicOwner(repositoryOwner(state, repository)),
      },
      commit: commitRecordView(result.commit),
    });
  });

  // Changes the default branch of one repository: the stored pointer only, so
  // the previous branch, its commits and its files stay exactly as they are.
  // Reserved to the repository administrator (Admin grant, organization Owner
  // or personal owner).
  router.add("POST", "/api/repositories/default-branch", async (request, response) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const { account } = await resolveSessionAccount(store, request);
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    const result = await store.mutate((state) => {
      const target = resolveMutationTarget(state, account, body, { mustManage: true });
      if (!target.repository) return target;
      return { ...target, ...changeDefaultBranch(state, target.repository, body.branch) };
    });
    if (result.authenticated === false) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    if (result.missing) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (result.denied || result.forbidden) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    const state = await store.read();
    const repository = state.repositories.find((candidate) => candidate.id === result.repository.id);
    sendJson(response, 200, { repository: repositoryView(state, repository, account.id) });
  });

  // Directory listing of one path on one branch: the Code page of the selected
  // branch. Directories are only path hierarchy, the entries stay derived from
  // the stored files of that branch.
  router.add("GET", "/api/repositories/tree", async (request, response, params, url) => {
    const target = await readTarget(request, url);
    if (target.error) {
      sendJson(response, target.status, { error: target.error });
      return;
    }
    const { state, repository, owner } = target;
    const branch = url.searchParams.get("branch") || repository.defaultBranch;
    if (!findBranch(state, repository, branch)) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const path = url.searchParams.get("path") ?? "";
    const file = readRepositoryFile(state, repository, branch, path);
    if (file) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    sendJson(response, 200, {
      directory: {
        repository: repository.name,
        owner: publicOwner(owner),
        branch,
        path,
        entries: listDirectoryEntries(state, repository, branch, path),
      },
    });
  });

  // Commit history of one branch (or of one file path on that branch), newest
  // first. The records are read-only and reflect the same stored commits the
  // comparison page reads.
  router.add("GET", "/api/repositories/commits", async (request, response, params, url) => {
    const target = await readTarget(request, url);
    if (target.error) {
      sendJson(response, target.status, { error: target.error });
      return;
    }
    const { state, repository, owner } = target;
    const branch = url.searchParams.get("branch") || repository.defaultBranch;
    if (!findBranch(state, repository, branch)) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const path = url.searchParams.get("path") ?? "";
    sendJson(response, 200, {
      history: {
        repository: repository.name,
        owner: publicOwner(owner),
        branch,
        path,
        commits: listBranchHistory(state, repository, branch, path)
          .map((commit) => commitRecordView(commit))
          .filter(Boolean),
      },
    });
  });

  // One commit of the repository: identity, author, time, parent, changed files
  // and the line-by-line difference against the parent revision. Read-only.
  router.add("GET", "/api/repositories/commit", async (request, response, params, url) => {
    const target = await readTarget(request, url);
    if (target.error) {
      sendJson(response, target.status, { error: target.error });
      return;
    }
    const { state, repository, owner } = target;
    const commit = readCommit(state, repository, url.searchParams.get("id"));
    if (!commit) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const branch = state.branches.find((candidate) => candidate.id === commit.branchId)?.name
      ?? repository.defaultBranch;
    sendJson(response, 200, {
      commit: {
        ...commitDetailView(state, repository, branch, commit),
        repository: repository.name,
        owner: publicOwner(owner),
      },
    });
  });

  // Code search inside one repository: only readable file content of the
  // selected branch is searched, and the search never changes repository data.
  router.add("GET", "/api/repositories/code-search", async (request, response, params, url) => {
    const target = await readTarget(request, url);
    if (target.error) {
      sendJson(response, target.status, { error: target.error });
      return;
    }
    const { state, repository, owner } = target;
    const branch = url.searchParams.get("branch") || repository.defaultBranch;
    if (!findBranch(state, repository, branch)) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const found = searchRepositoryContent(state, repository, branch, url.searchParams.get("q") ?? "");
    sendJson(response, 200, {
      search: {
        repository: repository.name,
        owner: publicOwner(owner),
        branch,
        ...found,
      },
    });
  });

  const forkHandler = (kind) => async (request, response, params) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const { account } = await resolveSessionAccount(store, request);
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    const result = await store.mutate((state) => {
      const current = state.accounts.find((candidate) => (
        candidate.id === account.id && candidate.status === "available"
      ));
      if (!current) return { authenticated: false };
      const source = kind === "organization"
        ? findRepository(state, findOrganizationBySlug(state, params.slug)?.id, params.name)
        : findUserRepository(state, params.username, params.name);
      if (!source) return { missing: true };
      // Forking needs Read or higher on the source repository.
      if (!canReadRepository(state, source, current.id)) return { denied: true };
      return forkRepository(state, current, source, body);
    });
    if (result.authenticated === false) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    if (result.missing) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (result.denied) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    const state = await store.read();
    const fork = state.repositories.find((candidate) => candidate.id === result.repository.id);
    sendJson(response, 201, { repository: repositoryView(state, fork, account.id) });
  };

  router.add("POST", "/api/users/:username/repositories/:name/fork", forkHandler("account"));
  router.add("POST", "/api/organizations/:slug/repositories/:name/fork", forkHandler("organization"));

  return router;
}
