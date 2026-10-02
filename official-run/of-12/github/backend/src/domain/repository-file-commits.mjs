/**
 * File writes through the Code page (REQ-4-4).
 *
 * One accepted submission stores the new file content, the commit message, the
 * author, the parent commit, the changed path and the target branch as a single
 * commit record inside one atomic store update, and moves the branch head to
 * that commit. A rejected submission (permission, invalid path, noncompliant
 * message, path conflict, protected branch) leaves the stored document exactly
 * as it was, so the file, the branch head and the commit history stay unchanged
 * together.
 */

import { randomUUID } from "node:crypto";

import { COMMIT_ROLES, effectiveRepositoryRole } from "./repository-access.mjs";
import { isBranchProtected } from "./branch-protection.mjs";
import {
  BRANCH_MESSAGES,
  commitMessageError,
  filePathError,
  findRepositoryBranch,
  pathConflict,
  repositoryBranchList,
} from "./repository-branches.mjs";

function trimmed(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/** The file set of the commit a branch points to, or its legacy `files` array. */
function headTree(draft, repository, branch) {
  if (branch) {
    const head = (repository.commits ?? []).find((commit) => commit?.id === branch.headId);
    if (head && Array.isArray(head.tree)) return head.tree.map((file) => ({ ...file }));
  }
  return (Array.isArray(repository.files) ? repository.files : []).map((file) => ({ ...file }));
}

/**
 * Creates one commit on a branch: the stored path/content change, the message,
 * the author, the parent commit and the target branch, plus the resulting file
 * snapshot. The branch is created at the first commit of an empty repository
 * and only then; an unknown branch is refused.
 */
export async function commitRepositoryFile(store, repositoryId, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    if (!account || !COMMIT_ROLES.includes(effectiveRepositoryRole(draft, repository, accountId))) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const requestedBranch = trimmed(input.branch);
    const branch = findRepositoryBranch(repository, requestedBranch || repository.defaultBranch);
    const emptyRepository = repositoryBranchList(repository).length === 0;
    if (!branch && !(emptyRepository && (!requestedBranch || requestedBranch === repository.defaultBranch))) {
      outcome = { ok: false, missing: true, errors: { branch: BRANCH_MESSAGES.branchNotFound } };
      return undefined;
    }
    const branchName = branch?.name ?? repository.defaultBranch ?? "main";

    const errors = {};
    const path = trimmed(input.path);
    const pathError = filePathError(path);
    if (pathError) errors.path = pathError;
    const message = trimmed(input.message);
    const messageError = commitMessageError(message);
    if (messageError) errors.message = messageError;

    const creating = input.create === true;
    const originalPath = trimmed(input.originalPath).replace(/^\/+|\/+$/g, "");
    const renaming = !creating && originalPath !== "" && originalPath !== path;
    if (!pathError) {
      const ignore = creating ? null : (renaming ? null : originalPath || path);
      if (pathConflict(repository, branchName, path, ignore)) {
        errors.path = BRANCH_MESSAGES.pathTaken;
      }
    }
    // A branch carrying a protection rule of its exact name (REQ-6-1) refuses a
    // direct file change, so the rule cannot be bypassed by editing the branch
    // instead of merging a pull request into it.
    if (isBranchProtected(repository, branchName)) errors.branch = BRANCH_MESSAGES.branchProtected;
    if (Object.keys(errors).length > 0) {
      outcome = { ok: false, errors };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    const content = typeof input.content === "string" ? input.content : "";
    const nextTree = headTree(draft, repository, branch).filter((file) => {
      if (creating || !renaming) return true;
      return file.path !== originalPath;
    });
    const existingIndex = nextTree.findIndex((file) => file.path === path);
    if (existingIndex >= 0) {
      nextTree[existingIndex] = { path, content, updatedAt: timestamp };
    } else {
      nextTree.push({ path, content, updatedAt: timestamp });
    }
    nextTree.sort((left, right) => String(left.path).localeCompare(String(right.path)));

    const changed = [];
    if (renaming) changed.push({ path: originalPath, change: "removed" });
    changed.push({ path, change: creating || renaming ? "added" : "modified" });

    const commit = {
      id: randomUUID(),
      message,
      authorId: account.id,
      author: account.username,
      branch: branchName,
      parentId: branch?.headId ?? null,
      createdAt: timestamp,
      files: changed,
      tree: nextTree,
    };
    if (!Array.isArray(repository.commits)) repository.commits = [];
    repository.commits.push(commit);

    if (branch) {
      branch.headId = commit.id;
    } else if (!Array.isArray(repository.branches)) {
      repository.branches = [{ name: branchName, headId: commit.id, createdBy: account.id, createdAt: timestamp }];
    } else {
      repository.branches.push({ name: branchName, headId: commit.id, createdBy: account.id, createdAt: timestamp });
    }
    if (!repository.defaultBranch) repository.defaultBranch = branchName;
    repository.updatedAt = timestamp;
    outcome = { ok: true, repositoryId: repository.id, branch: branchName, commitId: commit.id, path };
    return draft;
  });
  return outcome;
}
