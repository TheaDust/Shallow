/**
 * Repository creation and forking rules (REQ-3-2-1, REQ-3-2-2).
 *
 * A repository record is built as one unit: identifier, owner, visibility,
 * default branch, creator and — when initialization is requested — the initial
 * branch and a first commit that adds the README file. Files are content at a
 * revision, so the working tree is derived from that commit history
 * (`domain/commit-graph.mjs`). A fork copies the accessible history of its
 * source under fresh identifiers and records the source-repository link; it
 * never writes back.
 */

import { randomUUID } from "node:crypto";

import { findRepository } from "./repositories.mjs";

export const REPOSITORY_VISIBILITIES = ["public", "private"];
export const DEFAULT_REPOSITORY_BRANCH = "main";
export const README_PATH = "README.md";

export const REPOSITORY_NAME_MESSAGES = {
  required: "Repository name is required",
  invalid: "Repository name is invalid",
};

export function normalizeRepositoryName(name) {
  return String(name ?? "").trim();
}

export function isValidRepositoryName(name) {
  if (!name || name.length > 100) return false;
  if (name === "." || name === "..") return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

export function repositoryNameExistsMessage(fullName) {
  return `The repository ${fullName} already exists on this account.`;
}

/** `Public`/`Private` choice of the creation and fork forms; null when invalid. */
export function readRepositoryVisibility(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return REPOSITORY_VISIBILITIES.includes(normalized) ? normalized : null;
}

function buildReadme(name, description) {
  return description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
}

export function buildRepository({
  owner,
  name,
  visibility,
  description = "",
  creator,
  initialize = false,
  now = new Date().toISOString(),
}) {
  const id = randomUUID();
  const commitId = `${id}-commit-1`;
  return {
    id,
    owner: { type: owner.type, id: owner.id, login: owner.login },
    name,
    visibility,
    description,
    defaultBranch: DEFAULT_REPOSITORY_BRANCH,
    createdBy: { accountId: creator.id, login: creator.login },
    createdAt: now,
    updatedAt: now,
    sourceRepository: null,
    branches: [
      { name: DEFAULT_REPOSITORY_BRANCH, headCommitId: initialize ? commitId : null },
    ],
    commits: initialize
      ? [
          {
            id: commitId,
            branch: DEFAULT_REPOSITORY_BRANCH,
            message: "Initial commit",
            authorLogin: creator.login,
            createdAt: now,
            parentId: null,
            changes: [
              { path: README_PATH, changeType: "added", content: buildReadme(name, description) },
            ],
          },
        ]
      : [],
  };
}

/** Copies the source's branches, history and files under fresh identifiers. */
export function buildFork({ source, owner, name, visibility, creator, now = new Date().toISOString() }) {
  const id = randomUUID();
  const identifiers = new Map();
  const remap = (previousId) => {
    if (!previousId) return null;
    if (!identifiers.has(previousId)) identifiers.set(previousId, randomUUID());
    return identifiers.get(previousId);
  };

  return {
    id,
    owner: { type: owner.type, id: owner.id, login: owner.login },
    name,
    visibility,
    description: source.description ?? "",
    defaultBranch: source.defaultBranch,
    createdBy: { accountId: creator.id, login: creator.login },
    createdAt: now,
    updatedAt: now,
    sourceRepository: {
      id: source.id,
      owner: source.owner.login,
      name: source.name,
    },
    branches: (source.branches ?? []).map((branch) => ({
      name: branch.name,
      headCommitId: remap(branch.headCommitId),
    })),
    commits: (source.commits ?? []).map((commit) => ({
      ...commit,
      id: remap(commit.id),
      parentId: remap(commit.parentId),
      changes: (commit.changes ?? []).map((change) => ({ ...change })),
    })),
  };
}

/**
 * A fork name that is free in the target namespace: the source name when it is
 * available, otherwise the GitHub-style `name-1`, `name-2`, … suffix.
 */
export function availableForkName(state, ownerLogin, sourceName) {
  if (!findRepository(state, ownerLogin, sourceName)) return sourceName;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${sourceName}-${index}`;
    if (!findRepository(state, ownerLogin, candidate)) return candidate;
  }
  return `${sourceName}-${randomUUID().slice(0, 8)}`;
}
