// Web file editing: one submission stores the new file snapshot as a commit
// and moves the target branch to it, so the change, its message, its author and
// its parent revision are stored as one indivisible record and history is never
// rewritten. Permission is re-checked on the server (Write or higher).

import { randomUUID } from "node:crypto";

import { canWriteRepository } from "./access.mjs";
import { isBranchProtected } from "./branch-protection.mjs";
import {
  authorNameOf,
  branchByName,
  collection,
  commitById,
  filesOfCommit,
  resolveRepositoryForViewer,
} from "./repository-code.mjs";

export const FILE_MESSAGES = {
  invalidPath: "Invalid file path",
  messageRequired: "Commit message is required",
  messageTooLong: "Commit message must be 72 characters or fewer",
  notAuthenticated: "Not authenticated",
  notFound: "Not found",
  accessDenied: "Access denied",
  fileNotSaved: "File not saved",
  branchProtected: "The branch is protected by a branch protection rule",
};

export const COMMIT_MESSAGE_MAX_LENGTH = 72;

let clock = () => new Date().toISOString();

function shortSha() {
  return randomUUID().replace(/-/g, "").slice(0, 7);
}

/**
 * The reason a file path is unusable, or null when it is well formed: it may
 * not be empty, start with `/`, hold a `.` or `..` segment, or contain an empty
 * segment (a leading, trailing or doubled `/`).
 */
export function filePathError(value) {
  if (typeof value !== "string") return FILE_MESSAGES.invalidPath;
  const raw = value.trim();
  if (raw.length === 0) return FILE_MESSAGES.invalidPath;
  if (raw.startsWith("/")) return FILE_MESSAGES.invalidPath;
  const segments = raw.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return FILE_MESSAGES.invalidPath;
  }
  return null;
}

/** The reason a commit message is unusable, or null when it is 1–72 chars. */
export function commitMessageError(value) {
  if (typeof value !== "string") return FILE_MESSAGES.messageRequired;
  const trimmed = value.trim();
  if (trimmed.length === 0) return FILE_MESSAGES.messageRequired;
  if (trimmed.length > COMMIT_MESSAGE_MAX_LENGTH) return FILE_MESSAGES.messageTooLong;
  return null;
}

/**
 * True when the path would clash with the revision's files: an existing file at
 * the path, a path inside an existing file, or an existing file inside the
 * path. The file the editor started from (`previousPath`) is exempt, because
 * rewriting it with new content is the edit case.
 */
function conflictsWithFiles(files, path, previousPath) {
  for (const file of files) {
    const existing = String(file?.path ?? "");
    if (existing.length === 0) continue;
    if (previousPath.length > 0 && existing === previousPath) continue;
    if (existing === path) return true;
    if (existing.startsWith(`${path}/`)) return true;
    if (path.startsWith(`${existing}/`)) return true;
  }
  return false;
}

export function createRepositoryFileService(store) {
  async function commitForViewer(owner, repositoryName, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const source = input ?? {};
    const requestedBranch =
      typeof source.branch === "string" ? source.branch.trim() : "";
    const rawPath = typeof source.path === "string" ? source.path : "";
    const previousPath =
      typeof source.previousPath === "string" ? source.previousPath.trim() : "";
    const content = typeof source.content === "string" ? source.content : "";

    const fieldErrors = {};
    const pathReason = filePathError(rawPath);
    if (pathReason) fieldErrors.path = pathReason;
    if (previousPath.length > 0) {
      const previousReason = filePathError(previousPath);
      if (previousReason) fieldErrors.previousPath = previousReason;
    }
    const messageReason = commitMessageError(source.message);
    if (messageReason) fieldErrors.message = messageReason;
    if (Object.keys(fieldErrors).length > 0) {
      return { status: "invalid", error: FILE_MESSAGES.fileNotSaved, fieldErrors };
    }

    const path = rawPath.trim();

    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      if (!canWriteRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      const branch = branchByName(
        state,
        repository.id,
        requestedBranch.length > 0 ? requestedBranch : repository.defaultBranch,
      );
      if (!branch) {
        outcome = { status: "branch-not-found" };
        return;
      }
      // A branch protection rule blocks direct writes to its exact branch, so
      // a protected branch cannot be updated without going through its review
      // and status-check requirements.
      if (isBranchProtected(state, repository.id, branch.name)) {
        outcome = {
          status: "protected",
          error: FILE_MESSAGES.branchProtected,
          fieldErrors: { branch: FILE_MESSAGES.branchProtected },
        };
        return;
      }
      const parent = branch.commitId ? commitById(state, branch.commitId) : null;
      const snapshot = filesOfCommit(parent).map((file) => ({ ...file }));
      if (conflictsWithFiles(snapshot, path, previousPath)) {
        outcome = {
          status: "invalid",
          error: FILE_MESSAGES.fileNotSaved,
          fieldErrors: { path: FILE_MESSAGES.invalidPath },
        };
        return;
      }

      const files = snapshot.filter(
        (file) => previousPath.length === 0 || file.path !== previousPath,
      );
      const existing = files.find((file) => file.path === path);
      if (existing) existing.content = content;
      else files.push({ path, content });

      const createdAt = clock();
      const commit = {
        id: `commit-${randomUUID()}`,
        repositoryId: repository.id,
        sha: shortSha(),
        message: source.message.trim(),
        authorId: accountId,
        parentId: parent?.id ?? null,
        createdAt,
        files,
      };
      state.commits = [...collection(state, "commits"), commit];
      state.branches = collection(state, "branches").map((candidate) =>
        candidate.id === branch.id ? { ...candidate, commitId: commit.id } : candidate,
      );
      outcome = {
        status: "ok",
        commit: {
          id: commit.id,
          sha: commit.sha,
          shortSha: commit.sha,
          message: commit.message,
          authorId: commit.authorId,
          author: authorNameOf(state, commit),
          parentId: commit.parentId,
          createdAt: commit.createdAt,
        },
        branch: branch.name,
        path,
      };
    });
    return outcome;
  }

  return { commitForViewer };
}
