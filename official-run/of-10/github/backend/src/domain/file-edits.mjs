/**
 * File changes made from the web file editor (REQ-4-4).
 *
 * One submission becomes one immutable commit: the path and content change, the
 * commit message, the author, the parent commit and the target branch are stored
 * together and the branch is moved to the new commit, so a rejected submission
 * leaves the files, the branch head and the history exactly as they were.
 */

import { randomUUID } from "node:crypto";

import { branchHead, branchPaths, fileAt, normalizePath } from "./commit-graph.mjs";

/** The only path and message errors this feature reveals; both are shown verbatim. */
export const FILE_EDIT_MESSAGES = {
  invalidPath: "Invalid file path",
  requiredMessage: "Commit message is required",
  longMessage: "The commit message must be 72 characters or fewer",
  forbidden: "You need write permission to edit files in this repository.",
  unknownBranch: "That branch does not exist.",
};

export const COMMIT_MESSAGE_MAX_LENGTH = 72;

export function normalizeCommitMessage(message) {
  return String(message ?? "").trim();
}

/** The commit message holds 1-72 non-empty characters after trimming. */
export function commitMessageError(message) {
  const value = normalizeCommitMessage(message);
  if (!value) return FILE_EDIT_MESSAGES.requiredMessage;
  if ([...value].length > COMMIT_MESSAGE_MAX_LENGTH) return FILE_EDIT_MESSAGES.longMessage;
  return null;
}

/**
 * A writable path is non-empty, does not begin with `/` and has no empty, `.` or
 * `..` segment, so it can never escape the branch it is written to.
 */
export function isValidFilePath(path) {
  const value = String(path ?? "").trim();
  if (!value || value.startsWith("/")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Whether a new or renamed path collides with an existing file, with an existing
 * directory of the branch or with a file used as one of its parent directories.
 */
export function pathConflict(repository, branch, path) {
  const head = branchHead(repository, branch);
  if (!head) return null;
  const wanted = normalizePath(path);
  if (!wanted) return "invalid";
  const files = new Set(branchPaths(repository, branch));
  if (files.has(wanted)) return "file";

  const segments = wanted.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    // An existing file can never become the directory of another file.
    if (files.has(segments.slice(0, index).join("/"))) return "parentFile";
  }
  const prefix = `${wanted}/`;
  return [...files].some((existing) => existing.startsWith(prefix)) ? "directory" : null;
}

export function newCommitId() {
  return randomUUID().replaceAll("-", "");
}

/**
 * One atomic file change: a rename records the removal of the old path and the
 * addition of the new one, every other submission records one added or modified
 * path. The returned commit is not yet stored.
 */
export function buildFileCommit(
  repository,
  { branch, path, previousPath, content, message, authorLogin, createdAt },
) {
  const head = branchHead(repository, branch);
  const wanted = normalizePath(path);
  const changes = [];
  if (previousPath && previousPath !== wanted) {
    changes.push({ path: previousPath, changeType: "deleted", content: null });
  }
  const exists = fileAt(repository, branch, wanted) !== null;
  changes.push({
    path: wanted,
    changeType: exists ? "modified" : "added",
    content: String(content ?? ""),
  });
  return {
    id: newCommitId(),
    branch,
    message: normalizeCommitMessage(message),
    authorLogin: authorLogin ?? null,
    createdAt: createdAt ?? new Date().toISOString(),
    parentId: head ? head.id : null,
    changes,
  };
}
