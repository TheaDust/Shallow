import { randomUUID } from "node:crypto";

import { ensureOrganizationState, findAccountByUsernameOrEmail, findTeam, isOwner } from "./organizations.mjs";
import {
  normalizeRepositoryOwners,
  repositoryOwnerId,
  repositoryOwnerRef,
  repositoryOwnedBy,
  repositoryOwnerType,
} from "./repository-ownership.mjs";
import {
  MESSAGES,
  WRITE_REPOSITORY_ROLES,
  commitMessageError,
  isValidBranchName,
  isValidRepositoryName,
  isValidRepositoryRole,
  normalizeRole,
  normalizeText,
} from "./validation.mjs";

/**
 * Repository domain: ownership, access, queries, access grants, visibility,
 * creation, forking and the default-branch assets (branches, commits, files).
 *
 * Everything lives in the same persisted state document as accounts,
 * organizations and memberships, so one `store.update` keeps a multi-record
 * change (a repository plus its initial branch, README and commit) atomic.
 * `...From(state)` helpers are pure and are reused by the read endpoints and by
 * the mutating functions while they hold the store lock.
 */

const REPOSITORY_COLLECTIONS = ["repositories", "repositoryGrants", "branches", "commits", "files"];

export function ensureRepositoryState(state) {
  ensureOrganizationState(state);
  for (const key of REPOSITORY_COLLECTIONS) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  normalizeRepositoryOwners(state);
}

export function findRepository(state, ownerId, name) {
  return state.repositories.find(
    (repository) => repositoryOwnedBy(repository, ownerId) && repository.name === name,
  );
}

/** Every repository that belongs to that owner regardless of type. */
export function repositoriesOfOwner(state, ownerId) {
  return state.repositories.filter((repository) => repositoryOwnedBy(repository, ownerId));
}

/**
 * Resolves a repository from the two URL identifiers. The owner login is an
 * account username or an organization slug; the account namespace is checked
 * first, which is also where a repository creation defaults to.
 */
export function findRepositoryForOwner(state, ownerLogin, name) {
  const value = normalizeText(ownerLogin);
  if (!value) return undefined;
  const account = state.accounts.find((candidate) => candidate.username === value);
  if (account) {
    const personal = findRepository(state, account.id, name);
    if (personal) return personal;
  }
  const organization = state.organizations.find((candidate) => candidate.slug === value);
  if (organization) return findRepository(state, organization.id, name);
  return undefined;
}

/* ---------------------------------------------------------------- shapes -- */

/** Root README of the default branch, if the repository has one. */
export function readmePathOf(state, repository) {
  const branch = repository.defaultBranch ?? "main";
  const file = (state.files ?? []).find(
    (candidate) => candidate.repositoryId === repository.id
      && candidate.branch === branch
      && candidate.path.toLowerCase() === "readme.md",
  );
  return file ? file.path : null;
}

export function publicRepository(state, repository, accountId = null) {
  const owner = repositoryOwnerRef(state, repository);
  const source = repository.forkedFromRepositoryId
    ? state.repositories.find((candidate) => candidate.id === repository.forkedFromRepositoryId)
    : undefined;
  const sourceOwner = source ? repositoryOwnerRef(state, source) : null;
  return {
    id: repository.id,
    name: repository.name,
    description: repository.description ?? "",
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch ?? "main",
    updatedAt: repository.updatedAt ?? null,
    owner,
    // `owner/name` of the repository this one was forked from; null for a
    // repository created directly.
    forkedFrom: source && sourceOwner ? { id: source.id, name: source.name, owner: sourceOwner } : null,
    readmePath: readmePathOf(state, repository),
    // Effective role of the viewing account on this repository (null when the
    // viewer only reads it through public visibility).
    role: accountId ? repositoryAccessRole(state, repository, accountId) : null,
  };
}

/** One “Manage access” row: the grant subject name and its stored role. */
export function publicRepositoryGrant(state, grant) {
  const subject = grant.subjectType === "team"
    ? state.teams.find((team) => team.id === grant.subjectId)
    : state.accounts.find((account) => account.id === grant.subjectId);
  return {
    id: grant.id,
    subjectType: grant.subjectType,
    subjectName: grant.subjectType === "team" ? subject?.slug ?? "" : subject?.username ?? "",
    role: grant.role,
  };
}

/* --------------------------------------------------------------- access -- */

/**
 * Effective repository access for one account.
 *
 * A personal repository is administered by its owner account; an organization
 * repository by an organization Owner. Organization membership alone grants
 * nothing: the remaining access comes from a direct grant or from membership of
 * a team that holds a grant. Public repositories are readable by everyone.
 */
export function repositoryAccessRole(state, repository, accountId) {
  if (!accountId) return null;
  if (repositoryOwnerType(repository) === "account") {
    if (repositoryOwnerId(repository) === accountId) return "admin";
  } else if (isOwner(state, repositoryOwnerId(repository), accountId)) {
    return "admin";
  }
  const direct = state.repositoryGrants.find(
    (grant) => grant.repositoryId === repository.id && grant.subjectType === "account" && grant.subjectId === accountId,
  );
  if (direct) return direct.role;
  const teamIds = new Set(state.teamMembers.filter((member) => member.accountId === accountId).map((member) => member.teamId));
  const teamGrant = state.repositoryGrants.find(
    (grant) => grant.repositoryId === repository.id && grant.subjectType === "team" && teamIds.has(grant.subjectId),
  );
  if (teamGrant) return teamGrant.role;
  return null;
}

export function canReadRepository(state, repository, accountId) {
  if (repository.visibility === "public") return true;
  return repositoryAccessRole(state, repository, accountId) !== null;
}

export function organizationHasPublicRepository(state, organization) {
  return state.repositories.some(
    (repository) => repositoryOwnerType(repository) === "organization"
      && repositoryOwnerId(repository) === organization.id
      && repository.visibility === "public",
  );
}

/** True when the account may open a repository’s Settings / Manage access. */
export function isRepositoryAdmin(state, repository, accountId) {
  return repositoryAccessRole(state, repository, accountId) === "admin";
}

/* ------------------------------------------------------------ grants --- */

export function repositoryAccessList(state, repository) {
  return state.repositoryGrants
    .filter((grant) => grant.repositoryId === repository.id)
    .map((grant) => publicRepositoryGrant(state, grant))
    .sort((left, right) => left.subjectName.localeCompare(right.subjectName));
}

/**
 * Subjects the access picker may offer for that owner: an organization offers
 * its teams and members, a personal namespace only accounts (it has no teams).
 */
export function repositoryAccessCandidates(state, owner) {
  if (!owner) return { teams: [], accounts: [] };
  if (owner.type === "organization") {
    return {
      teams: state.teams
        .filter((team) => team.organizationId === owner.id)
        .map((team) => team.slug)
        .sort(),
      accounts: state.memberships
        .filter((membership) => membership.organizationId === owner.id)
        .map((membership) => state.accounts.find((account) => account.id === membership.accountId)?.username ?? "")
        .filter(Boolean)
        .sort(),
    };
  }
  return {
    teams: [],
    accounts: state.accounts
      .filter((account) => account.id !== owner.id)
      .map((account) => account.username)
      .sort(),
  };
}

/* -------------------------------------------------------------- queries -- */

export function listRepositories(state, organization, accountId, { name = "", type = "all" } = {}) {
  const query = normalizeText(name).toLowerCase();
  return state.repositories
    .filter((repository) => repositoryOwnerType(repository) === "organization"
      && repositoryOwnerId(repository) === organization.id)
    .filter((repository) => canReadRepository(state, repository, accountId))
    .filter((repository) => (query ? repository.name.toLowerCase().includes(query) : true))
    .filter((repository) => (type === "public" ? repository.visibility === "public" : type === "private" ? repository.visibility === "private" : true))
    .map((repository) => publicRepository(state, repository))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Repositories the viewer may read that match a free-text query. An empty query
 * keeps every readable repository, so the same helper backs the public explore
 * list. Matching accepts the repository name and the `owner/name` forms (URL
 * login and display name), and the access filter is `canReadRepository` —
 * search, lists and direct links share one rule, so a private repository never
 * leaks into results.
 */
export function searchRepositories(state, query, accountId = null) {
  const value = normalizeText(query).toLowerCase();
  return state.repositories
    .filter((repository) => canReadRepository(state, repository, accountId))
    .filter((repository) => {
      if (!value) return true;
      const owner = repositoryOwnerRef(state, repository);
      const name = repository.name.toLowerCase();
      const fullNames = [
        `${owner?.login ?? ""}/${name}`,
        `${(owner?.displayName ?? "").toLowerCase()}/${name}`,
      ];
      return name.includes(value) || fullNames.some((full) => full.includes(value));
    })
    .map((repository) => publicRepository(state, repository, accountId))
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      return (left.owner?.login ?? "").localeCompare(right.owner?.login ?? "");
    });
}

/** Public repositories an unauthenticated visitor may explore. */
export function publicRepositories(state) {
  return searchRepositories(state, "", null);
}

/**
 * Every repository the signed-in account may read across the whole state.
 *
 * Access is not limited to organizations the account belongs to: a repository
 * Admin reaches a public repository through a direct grant even without a
 * membership, and a personal repository is readable by its owner, so the
 * signed-in workspace must list both. Visibility filtering reuses
 * `canReadRepository`, so a private repository without a grant never appears.
 */
export function repositoriesForAccount(state, accountId) {
  return state.repositories
    .filter((repository) => canReadRepository(state, repository, accountId))
    .map((repository) => publicRepository(state, repository, accountId))
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      return (left.owner?.login ?? "").localeCompare(right.owner?.login ?? "");
    });
}

/* ------------------------------------------------------------ mutations -- */

function repositoryErrors(state, ownerId, name) {
  const value = normalizeText(name);
  if (value.length === 0) return { name: MESSAGES.repositoryNameRequired };
  if (findRepository(state, ownerId, value)) return { name: MESSAGES.repositoryNameExists };
  if (!isValidRepositoryName(value)) return { name: MESSAGES.repositoryNameInvalid };
  return null;
}

function normalizeVisibility(value) {
  const visibility = normalizeText(value).toLowerCase();
  return visibility === "public" || visibility === "private" ? visibility : null;
}

/**
 * Resolves the namespace a repository is created in. An empty login means the
 * signed-in account’s personal namespace; the account namespace wins over an
 * organization with the same login because the personal one is the default.
 */
function resolveTargetNamespace(state, login, accountId) {
  const account = state.accounts.find((candidate) => candidate.id === accountId);
  const value = normalizeText(login);
  if (account && (value.length === 0 || value === account.username)) {
    return { owner: { type: "account", id: account.id }, allowed: true };
  }
  const organization = state.organizations.find((candidate) => candidate.slug === value);
  if (!organization) return { owner: null, allowed: false };
  return { owner: { type: "organization", id: organization.id }, allowed: isOwner(state, organization.id, accountId) };
}

/** Initial branch + README file + initial commit, written in the caller’s update. */
function initializeRepository(state, repository, authorId, when) {
  const account = state.accounts.find((candidate) => candidate.id === authorId);
  const branch = repository.defaultBranch ?? "main";
  const commitId = randomUUID();
  state.commits.push({
    id: commitId,
    repositoryId: repository.id,
    branch,
    parentCommitId: null,
    message: "Initial commit",
    authorId,
    authorName: account?.username ?? "",
    createdAt: when,
    changes: [{ path: "README.md", content: `# ${repository.name}\n` }],
  });
  state.branches.push({
    id: randomUUID(),
    repositoryId: repository.id,
    name: branch,
    headCommitId: commitId,
    createdAt: when,
  });
  state.files.push({
    id: randomUUID(),
    repositoryId: repository.id,
    branch,
    path: "README.md",
    content: `# ${repository.name}\n`,
    commitId,
  });
}

function newRepository(owner, name, description, visibility, accountId, when) {
  return {
    id: randomUUID(),
    ownerType: owner.type,
    ownerId: owner.id,
    name,
    description,
    visibility,
    defaultBranch: "main",
    forkedFromRepositoryId: null,
    createdBy: accountId,
    createdAt: when,
    updatedAt: when,
  };
}

/**
 * Creates a repository in a personal or organization namespace.
 *
 * The permission check (Owner of the organization namespace, or the account’s
 * own personal namespace) runs inside the store lock. When initialization is
 * requested the branch, README and initial commit are written by the same
 * `store.update`, so a rejected submission leaves no partially created
 * repository behind.
 */
export async function createRepository(store, accountId, input = {}) {
  const name = normalizeText(input.name);
  const description = normalizeText(input.description);
  const initialize = input.initialize === true;
  let result = { ok: false, fields: {} };

  await store.update((state) => {
    ensureRepositoryState(state);
    const target = resolveTargetNamespace(state, input.owner, accountId);
    if (!target.owner) {
      result = { ok: false, fields: { owner: MESSAGES.ownerNotFound } };
      return;
    }
    if (!target.allowed) {
      result = { forbidden: true };
      return;
    }
    const fields = repositoryErrors(state, target.owner.id, name);
    if (fields) {
      result = { ok: false, fields };
      return;
    }
    const visibility = normalizeVisibility(input.visibility) ?? "public";
    const when = new Date().toISOString();
    const repository = newRepository(target.owner, name, description, visibility, accountId, when);
    state.repositories.push(repository);
    if (initialize) initializeRepository(state, repository, accountId, when);
    result = { ok: true, repository: publicRepository(state, repository, accountId) };
  });

  return result;
}

/** Copies the source’s branches, commits and files into the fork, with new ids. */
function copyRepositoryHistory(state, source, fork, when) {
  const commits = state.commits.filter((commit) => commit.repositoryId === source.id);
  const branches = state.branches.filter((branch) => branch.repositoryId === source.id);
  const files = state.files.filter((file) => file.repositoryId === source.id);
  const ids = new Map(commits.map((commit) => [commit.id, randomUUID()]));
  for (const commit of commits) {
    state.commits.push({
      ...commit,
      id: ids.get(commit.id),
      repositoryId: fork.id,
      parentCommitId: commit.parentCommitId ? ids.get(commit.parentCommitId) ?? null : null,
      // The change list is copied, never shared with the source repository.
      changes: (commit.changes ?? []).map((change) => ({ ...change })),
    });
  }
  for (const branch of branches) {
    state.branches.push({
      ...branch,
      id: randomUUID(),
      repositoryId: fork.id,
      headCommitId: branch.headCommitId ? ids.get(branch.headCommitId) ?? null : null,
      createdAt: when,
    });
  }
  for (const file of files) {
    state.files.push({
      ...file,
      id: randomUUID(),
      repositoryId: fork.id,
      commitId: file.commitId ? ids.get(file.commitId) ?? null : null,
    });
  }
}

/**
 * Forks a readable repository into a personal or organization namespace.
 *
 * Both ends are validated inside the store lock: the account must be able to
 * read the source and be allowed to create in the target namespace. A private
 * source produces a private fork; the copied history is independent, so later
 * commits in the fork never write back to the source.
 */
export async function forkRepository(store, sourceOwnerLogin, sourceName, accountId, input = {}) {
  const requestedName = normalizeText(input.name);
  const requestedVisibility = normalizeVisibility(input.visibility);
  let result = { ok: false, fields: {} };

  await store.update((state) => {
    ensureRepositoryState(state);
    const source = findRepositoryForOwner(state, sourceOwnerLogin, sourceName);
    if (!source) {
      result = { notFound: true };
      return;
    }
    if (!canReadRepository(state, source, accountId)) {
      result = { forbidden: true };
      return;
    }
    const target = resolveTargetNamespace(state, input.owner, accountId);
    if (!target.owner) {
      result = { ok: false, fields: { owner: MESSAGES.ownerNotFound } };
      return;
    }
    if (!target.allowed) {
      result = { forbidden: true };
      return;
    }
    const name = requestedName.length > 0 ? requestedName : source.name;
    const fields = repositoryErrors(state, target.owner.id, name);
    if (fields) {
      result = { ok: false, fields };
      return;
    }
    if (input.visibility !== undefined && requestedVisibility === null) {
      result = { ok: false, fields: { visibility: MESSAGES.visibilityInvalid } };
      return;
    }
    // A private source can only be forked as a private repository.
    const visibility = source.visibility === "private"
      ? "private"
      : requestedVisibility ?? "public";
    const when = new Date().toISOString();
    const fork = newRepository(target.owner, name, source.description ?? "", visibility, accountId, when);
    fork.forkedFromRepositoryId = source.id;
    state.repositories.push(fork);
    copyRepositoryHistory(state, source, fork, when);
    result = { ok: true, repository: publicRepository(state, fork, accountId) };
  });

  return result;
}

/** One file of a branch, as the read-only file page needs it. */
export function repositoryFile(state, repository, branch, path) {
  const value = normalizeText(path);
  if (!value) return null;
  return state.files.find(
    (file) => file.repositoryId === repository.id && file.branch === branch && file.path === value,
  ) ?? null;
}

/* -------------------------------------------------- code browsing (REQ-4) -- */

/**
 * The read-only code views of REQ-4 (tree, file, history, commit, code search)
 * all read the same persisted snapshot: `state.files` holds the files of one
 * branch and every commit carries the `changes` that produced it, so the tree,
 * the file content and the diff never drift apart.
 */

/** Repository-relative path without surrounding slashes: "", "src", "src/a.ts". */
export function normalizeRepositoryPath(value) {
  return normalizeText(value).replace(/^\/+|\/+$/g, "");
}

/** The stored branch of that name, or the default branch when none is given. */
export function findRepositoryBranch(state, repository, name) {
  const value = normalizeText(name) || repository.defaultBranch || "main";
  return state.branches.find(
    (branch) => branch.repositoryId === repository.id && branch.name === value,
  ) ?? null;
}

/**
 * Resolves the branch a code view reads. An omitted name reads the default
 * branch, which may still be empty (a repository whose history was never
 * initialized); an explicitly named branch that does not exist is unknown, so
 * the caller can answer 404 instead of showing an empty page.
 */
export function resolveRepositoryBranch(state, repository, name) {
  const requested = normalizeText(name);
  const stored = findRepositoryBranch(state, repository, requested);
  if (stored) return { name: stored.name, stored: true };
  if (requested) return null;
  return { name: repository.defaultBranch || "main", stored: false };
}

function commitById(state, repository, commitId) {
  return state.commits.find(
    (candidate) => candidate.repositoryId === repository.id && candidate.id === commitId,
  );
}

/**
 * Content of `path` at `commitId`, walking the parent chain for the change that
 * introduced the file. Returns `undefined` when the file did not exist yet and
 * `null` when the newest change removed it.
 */
export function fileContentAt(state, repository, path, commitId) {
  const seen = new Set();
  let commit = commitId ? commitById(state, repository, commitId) : undefined;
  while (commit && !seen.has(commit.id)) {
    seen.add(commit.id);
    const change = (commit.changes ?? []).find((candidate) => candidate.path === path);
    if (change) return change.content ?? null;
    commit = commit.parentCommitId ? commitById(state, repository, commit.parentCommitId) : undefined;
  }
  return undefined;
}

function compareCommitsNewestFirst(left, right) {
  const leftTime = Date.parse(left.createdAt ?? "") || 0;
  const rightTime = Date.parse(right.createdAt ?? "") || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return right.index - left.index;
}

function commitSummary(commit) {
  return {
    id: commit.id,
    shortId: commit.id.slice(0, 7),
    message: commit.message ?? "",
    author: commit.authorName ?? "",
    createdAt: commit.createdAt ?? null,
    parentId: commit.parentCommitId ?? null,
    changedFiles: (commit.changes ?? []).length,
  };
}

/**
 * The commits of one branch: the chain reachable from its head, newest first.
 * A branch is a reference, so a branch created from another head reads that
 * revision’s history as well, while commits made on the branch itself extend it.
 */
function branchCommitChain(state, repository, branch) {
  const record = findRepositoryBranch(state, repository, branch);
  if (!record) return [];
  const commits = [];
  const seen = new Set();
  let commit = record.headCommitId ? commitById(state, repository, record.headCommitId) : undefined;
  while (commit && !seen.has(commit.id)) {
    seen.add(commit.id);
    commits.push(commit);
    commit = commit.parentCommitId ? commitById(state, repository, commit.parentCommitId) : undefined;
  }
  return commits;
}

/**
 * Commit records of a branch, newest first, optionally narrowed to the commits
 * that changed one file path (the history view of a file page).
 */
export function branchCommits(state, repository, branch, path = "") {
  const target = normalizeRepositoryPath(path);
  return branchCommitChain(state, repository, branch)
    .filter((commit) => !target || (commit.changes ?? []).some((change) => change.path === target))
    .map((commit, index) => ({ ...commitSummary(commit), index }))
    .sort(compareCommitsNewestFirst)
    .map(({ index, ...summary }) => summary);
}

/** Splits stored content into lines, dropping only the trailing newline. */
export function splitContentLines(content) {
  if (typeof content !== "string" || content === "") return [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Line-level comparison of two revisions: context, added and removed lines. */
export function diffContentLines(baseLines, headLines) {
  if (baseLines.length * headLines.length > 40_000) {
    return [
      ...baseLines.map((text) => ({ type: "remove", text })),
      ...headLines.map((text) => ({ type: "add", text })),
    ];
  }
  const rows = baseLines.length;
  const columns = headLines.length;
  const lengths = Array.from({ length: rows + 1 }, () => new Int32Array(columns + 1));
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      lengths[row][column] = baseLines[row] === headLines[column]
        ? lengths[row + 1][column + 1] + 1
        : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
    }
  }
  const lines = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (baseLines[row] === headLines[column]) {
      lines.push({ type: "context", text: baseLines[row] });
      row += 1;
      column += 1;
    } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
      lines.push({ type: "remove", text: baseLines[row] });
      row += 1;
    } else {
      lines.push({ type: "add", text: headLines[column] });
      column += 1;
    }
  }
  while (row < rows) {
    lines.push({ type: "remove", text: baseLines[row] });
    row += 1;
  }
  while (column < columns) {
    lines.push({ type: "add", text: headLines[column] });
    column += 1;
  }
  return lines;
}

/** Immutable change record with the changed files, their diff and its counts. */
export function commitDetail(state, repository, commit) {
  const changes = (commit.changes ?? []).map((change) => {
    const base = fileContentAt(state, repository, change.path, commit.parentCommitId ?? null);
    const head = fileContentAt(state, repository, change.path, commit.id);
    const lines = diffContentLines(splitContentLines(base), splitContentLines(head));
    const additions = lines.filter((line) => line.type === "add").length;
    const deletions = lines.filter((line) => line.type === "remove").length;
    const changeType = base === undefined
      ? "added"
      : head === null
        ? "removed"
        : "modified";
    return { path: change.path, changeType, additions, deletions, lines };
  });
  return {
    ...commitSummary(commit),
    branch: commit.branch,
    changes,
    totals: {
      files: changes.length,
      additions: changes.reduce((total, change) => total + change.additions, 0),
      deletions: changes.reduce((total, change) => total + change.deletions, 0),
    },
  };
}

/** One commit of that repository, or undefined when the id is unknown. */
export function repositoryCommit(state, repository, commitId) {
  return commitById(state, repository, commitId);
}

/** Files and directly nested directories at one path of a branch snapshot. */
export function repositoryTree(state, repository, branch, path = "") {
  const directory = normalizeRepositoryPath(path);
  const prefix = directory ? `${directory}/` : "";
  const directories = new Map();
  const files = new Map();
  for (const file of state.files) {
    if (file.repositoryId !== repository.id || file.branch !== branch) continue;
    if (prefix && !file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash < 0) {
      files.set(rest, { name: rest, path: file.path, type: "file" });
    } else {
      const name = rest.slice(0, slash);
      directories.set(name, { name, path: `${prefix}${name}`, type: "directory" });
    }
  }
  return [...directories.values(), ...files.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/** True when files exist under that path, so an unknown directory can 404. */
export function repositoryDirectoryExists(state, repository, branch, path) {
  const directory = normalizeRepositoryPath(path);
  if (!directory) return true;
  const prefix = `${directory}/`;
  return state.files.some(
    (file) => file.repositoryId === repository.id && file.branch === branch && file.path.startsWith(prefix),
  );
}

/** Lines of readable file content that contain the query, per matching file. */
export function searchRepositoryFiles(state, repository, branch, query) {
  const needle = normalizeText(query).toLowerCase();
  if (!needle) return [];
  const matches = [];
  for (const file of state.files) {
    if (file.repositoryId !== repository.id || file.branch !== branch) continue;
    const lines = splitContentLines(file.content);
    const hits = [];
    for (const [index, text] of lines.entries()) {
      if (text.toLowerCase().includes(needle)) hits.push({ number: index + 1, text });
    }
    if (hits.length > 0) matches.push({ path: file.path, lines: hits.slice(0, 5) });
  }
  return matches.sort((left, right) => left.path.localeCompare(right.path));
}

/** Commit count of a branch, as the “Commits” entry may show it. */
export function branchCommitCount(state, repository, branch) {
  return branchCommitChain(state, repository, branch).length;
}

/* ------------------------------------------- branches and files (REQ-4-3/4) -- */

/**
 * The stored branches of one repository, sorted by name. `isDefault` marks the
 * branch a repository entry reads without an explicit branch; it is only a
 * pointer, so every branch stays switchable and its own snapshot.
 */
export function listRepositoryBranches(state, repository) {
  const defaultBranch = repository.defaultBranch ?? "main";
  return state.branches
    .filter((branch) => branch.repositoryId === repository.id)
    .map((branch) => ({
      name: branch.name,
      headCommitId: branch.headCommitId ?? null,
      isDefault: branch.name === defaultBranch,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** True when the effective role may create commits (Write, Maintain, Admin, Owner). */
export function canWriteRepository(state, repository, accountId) {
  const role = repositoryAccessRole(state, repository, accountId);
  return role !== null && WRITE_REPOSITORY_ROLES.includes(role);
}

/** The stored file snapshot of one branch: path → content, with its commit id. */
function branchSnapshot(state, repository, branch) {
  return state.files
    .filter((file) => file.repositoryId === repository.id && file.branch === branch)
    .map((file) => ({ path: file.path, content: file.content ?? "", commitId: file.commitId ?? null }));
}

/**
 * Creates a named branch from the head of a base branch (REQ-4-3-2).
 *
 * The new record is only a reference: it points at the base commit id and its
 * snapshot is the base revision, so no commit is copied and neither the base
 * branch history nor its files are rewritten. Permission, format and duplicate
 * checks run inside the store lock, so a refused name leaves no branch behind.
 */
export async function createRepositoryBranch(store, ownerLogin, repositoryName, actorId, input = {}) {
  const name = normalizeText(input.name);
  let result = { notFound: true };

  await store.update((state) => {
    ensureRepositoryState(state);
    const { owner, repository } = resolveRepository(state, ownerLogin, repositoryName);
    if (!owner || !repository) {
      result = { notFound: true };
      return;
    }
    if (!canWriteRepository(state, repository, actorId)) {
      result = { forbidden: true };
      return;
    }
    if (!isValidBranchName(name)) {
      result = { ok: false, fields: { name: MESSAGES.branchNameInvalid } };
      return;
    }
    if (state.branches.some((branch) => branch.repositoryId === repository.id && branch.name === name)) {
      result = { ok: false, fields: { name: MESSAGES.branchNameExists } };
      return;
    }
    const base = findRepositoryBranch(state, repository, normalizeText(input.from));
    const baseName = base?.name ?? repository.defaultBranch ?? "main";
    const when = new Date().toISOString();
    state.branches.push({
      id: randomUUID(),
      repositoryId: repository.id,
      name,
      headCommitId: base?.headCommitId ?? null,
      createdAt: when,
    });
    for (const file of branchSnapshot(state, repository, baseName)) {
      state.files.push({
        id: randomUUID(),
        repositoryId: repository.id,
        branch: name,
        path: file.path,
        content: file.content,
        commitId: file.commitId,
      });
    }
    result = {
      ok: true,
      repository: publicRepository(state, repository, actorId),
      branch: { name, headCommitId: base?.headCommitId ?? null, isDefault: name === (repository.defaultBranch ?? "main") },
      branches: listRepositoryBranches(state, repository),
    };
  });

  return result;
}

/**
 * Points the repository’s default branch at an existing branch (REQ-4-3-3).
 * Only the pointer changes: the previous branch, its commits and its files stay
 * stored and the selector keeps offering them.
 */
export async function setRepositoryDefaultBranch(store, ownerLogin, repositoryName, actorId, input = {}) {
  const name = normalizeText(input.branch);
  let result = { notFound: true };

  await store.update((state) => {
    ensureRepositoryState(state);
    const { owner, repository } = resolveRepository(state, ownerLogin, repositoryName);
    if (!owner || !repository) {
      result = { notFound: true };
      return;
    }
    if (!isRepositoryAdmin(state, repository, actorId)) {
      result = { forbidden: true };
      return;
    }
    const target = state.branches.find(
      (branch) => branch.repositoryId === repository.id && branch.name === name,
    );
    if (!target) {
      result = { ok: false, fields: { branch: MESSAGES.branchNotFound } };
      return;
    }
    repository.defaultBranch = target.name;
    repository.updatedAt = new Date().toISOString();
    result = {
      ok: true,
      repository: publicRepository(state, repository, actorId),
      branches: listRepositoryBranches(state, repository),
    };
  });

  return result;
}

/**
 * The validation message of a new file path, or null when it may be created
 * (REQ-4-4): empty, absolute, a `..` segment, or a conflict with a stored file
 * or directory of that branch are all invalid.
 */
export function filePathError(state, repository, branch, path) {
  const value = normalizeText(path);
  if (!value || value.startsWith("/")) return MESSAGES.filePathInvalid;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return MESSAGES.filePathInvalid;
  }
  const snapshot = branchSnapshot(state, repository, branch);
  if (snapshot.some((file) => file.path === value)) return MESSAGES.filePathInvalid;
  // The path is already a directory of that branch, or one of its ancestors is
  // stored as a file, so either way it cannot become a new file path.
  if (snapshot.some((file) => file.path.startsWith(`${value}/`))) return MESSAGES.filePathInvalid;
  if (snapshot.some((file) => value.startsWith(`${file.path}/`))) return MESSAGES.filePathInvalid;
  return null;
}

/**
 * Adds one file to a branch through a new commit (REQ-4-4).
 *
 * A successful submission writes one immutable commit that carries the path,
 * content, message, author, parent and branch, then advances the branch head and
 * stores the new snapshot entry. An invalid submission is refused before
 * anything is written, so file data, branch head and history stay unchanged.
 */
export async function createRepositoryFile(store, ownerLogin, repositoryName, actorId, input = {}) {
  const branchName = normalizeText(input.branch);
  const path = normalizeText(input.path);
  const content = typeof input.content === "string" ? input.content : "";
  const message = normalizeText(input.message);
  let result = { notFound: true };

  await store.update((state) => {
    ensureRepositoryState(state);
    const { owner, repository } = resolveRepository(state, ownerLogin, repositoryName);
    if (!owner || !repository) {
      result = { notFound: true };
      return;
    }
    if (!canWriteRepository(state, repository, actorId)) {
      result = { forbidden: true };
      return;
    }
    const branch = findRepositoryBranch(state, repository, branchName);
    if (!branch) {
      result = { ok: false, fields: { branch: MESSAGES.branchNotFound } };
      return;
    }
    const pathMessage = filePathError(state, repository, branch.name, path);
    const messageError = commitMessageError(message);
    if (pathMessage || messageError) {
      result = {
        ok: false,
        fields: {
          ...(pathMessage ? { path: pathMessage } : {}),
          ...(messageError ? { message: messageError } : {}),
        },
      };
      return;
    }
    const account = state.accounts.find((candidate) => candidate.id === actorId);
    const when = new Date().toISOString();
    const commitId = randomUUID();
    state.commits.push({
      id: commitId,
      repositoryId: repository.id,
      branch: branch.name,
      parentCommitId: branch.headCommitId ?? null,
      message,
      authorId: actorId,
      authorName: account?.username ?? "",
      createdAt: when,
      changes: [{ path, content }],
    });
    branch.headCommitId = commitId;
    state.files.push({
      id: randomUUID(),
      repositoryId: repository.id,
      branch: branch.name,
      path,
      content,
      commitId,
    });
    repository.updatedAt = when;
    result = {
      ok: true,
      repository: publicRepository(state, repository, actorId),
      branch: branch.name,
      path,
      content,
      commit: { ...commitSummary(state.commits[state.commits.length - 1]), branch: branch.name },
    };
  });

  return result;
}

/* -------------------------------------------- access mutations ----- */

function resolveRepository(state, ownerLogin, repositoryName) {
  const repository = findRepositoryForOwner(state, ownerLogin, repositoryName);
  return repository
    ? { owner: repositoryOwnerRef(state, repository), repository }
    : { owner: null, repository: undefined };
}

function grantSubject(state, owner, subjectType, name) {
  if (subjectType === "team") {
    if (owner?.type !== "organization") return null;
    const team = findTeam(state, owner.id, name);
    return team ? { type: "team", id: team.id, sortKey: team.slug } : null;
  }
  const account = findAccountByUsernameOrEmail(state, name);
  return account ? { type: "account", id: account.id, sortKey: account.username } : null;
}

function accessPayload(state, owner, repository) {
  return {
    repository: publicRepository(state, repository),
    access: repositoryAccessList(state, repository),
    candidates: repositoryAccessCandidates(state, owner),
  };
}

/** Adds a grant for one person or team, updating the row when it already exists. */
export async function grantRepositoryAccess(store, ownerLogin, repositoryName, actorId, input = {}) {
  const subjectType = input.subjectType === "team" ? "team" : input.subjectType === "account" ? "account" : "";
  const name = normalizeText(input.name);
  const role = normalizeRole(input.role);
  let result = { notFound: true };

  await store.update((state) => {
    ensureRepositoryState(state);
    const { owner, repository } = resolveRepository(state, ownerLogin, repositoryName);
    if (!owner || !repository) {
      result = { notFound: true };
      return;
    }
    if (!isRepositoryAdmin(state, repository, actorId)) {
      result = { forbidden: true };
      return;
    }
    if (!isValidRepositoryRole(role)) {
      result = { ok: false, fields: { role: MESSAGES.roleInvalid } };
      return;
    }
    const subject = subjectType ? grantSubject(state, owner, subjectType, name) : null;
    if (!subject) {
      const message = subjectType === "team" ? MESSAGES.teamNotFound : MESSAGES.accountNotFound;
      result = { ok: false, fields: { name: message } };
      return;
    }
    const existing = state.repositoryGrants.find(
      (grant) => grant.repositoryId === repository.id && grant.subjectType === subject.type && grant.subjectId === subject.id,
    );
    if (existing) {
      existing.role = role;
    } else {
      state.repositoryGrants.push({
        id: randomUUID(),
        repositoryId: repository.id,
        subjectType: subject.type,
        subjectId: subject.id,
        role,
        createdAt: new Date().toISOString(),
      });
    }
    result = { ok: true, ...accessPayload(state, owner, repository) };
  });

  return result;
}

/** Updates the role of an existing access row instead of adding a second one. */
export async function updateRepositoryGrant(store, ownerLogin, repositoryName, actorId, grantId, input = {}) {
  const role = normalizeRole(input.role);
  let result = { notFound: true };

  await store.update((state) => {
    ensureRepositoryState(state);
    const { owner, repository } = resolveRepository(state, ownerLogin, repositoryName);
    if (!owner || !repository) {
      result = { notFound: true };
      return;
    }
    const grant = state.repositoryGrants.find(
      (candidate) => candidate.id === grantId && candidate.repositoryId === repository.id,
    );
    if (!grant) {
      result = { notFound: true };
      return;
    }
    if (!isRepositoryAdmin(state, repository, actorId)) {
      result = { forbidden: true };
      return;
    }
    if (!isValidRepositoryRole(role)) {
      result = { ok: false, fields: { role: MESSAGES.roleInvalid } };
      return;
    }
    grant.role = role;
    result = { ok: true, ...accessPayload(state, owner, repository) };
  });

  return result;
}

/**
 * Changes repository visibility. The permission check runs inside the store
 * lock against the stored grants, so hiding the control in the UI is never the
 * authority. The new visibility is persisted, which makes it the state searched,
 * listed and opened by later visitors.
 */
export async function setRepositoryVisibility(store, ownerLogin, repositoryName, actorId, input = {}) {
  const visibility = normalizeText(input.visibility).toLowerCase();
  let result = { notFound: true };

  await store.update((state) => {
    ensureRepositoryState(state);
    const { owner, repository } = resolveRepository(state, ownerLogin, repositoryName);
    if (!owner || !repository) {
      result = { notFound: true };
      return;
    }
    if (!isRepositoryAdmin(state, repository, actorId)) {
      result = { forbidden: true };
      return;
    }
    if (visibility !== "public" && visibility !== "private") {
      result = { ok: false, fields: { visibility: MESSAGES.visibilityInvalid } };
      return;
    }
    repository.visibility = visibility;
    result = { ok: true, repository: publicRepository(state, repository, actorId) };
  });

  return result;
}
