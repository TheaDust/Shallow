/**
 * Code and version-control writes (REQ-4-3, REQ-4-4).
 *
 * Every write recomputes the viewer's permission from the persisted state and
 * applies the whole change in one atomic store update, so a refused request
 * leaves the repository exactly as it was and a stored one survives a restart.
 */

import { branchExists, resolveRevision } from "./domain/commit-graph.mjs";
import {
  BRANCH_MESSAGES,
  canWriteRepository,
  createBranchReference,
  isValidBranchName,
  setDefaultBranch,
} from "./domain/branch-management.mjs";
import {
  FILE_EDIT_MESSAGES,
  buildFileCommit,
  commitMessageError,
  isValidFilePath,
  normalizeCommitMessage,
  pathConflict,
} from "./domain/file-edits.mjs";
import { canAdministerRepository } from "./domain/repository-access.mjs";
import {
  BRANCH_PROTECTION_MESSAGES,
  isBranchProtected,
} from "./domain/branch-protection.mjs";
import {
  canViewRepository,
  findRepository,
  toFilePayload,
  toRepositoryContext,
} from "./domain/repositories.mjs";

function failure(status, error, fields) {
  return { ok: false, status, error, fields: fields ?? {} };
}

export function createCodeWriteHandlers({ jsonStore, resolveViewer }) {
  /**
   * Creates one named reference at a base commit, which defaults to the head of
   * the branch the user is browsing. Only a signed-in writer may create it; the
   * base commit's history and every other branch stay untouched.
   */
  async function createRepositoryBranch(sessionId, owner, name, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      const repository = findRepository(state, owner, name);
      if (!canViewRepository(state, repository, viewer)) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!canWriteRepository(state, repository, viewer)) {
        outcome = failure(403, BRANCH_MESSAGES.forbidden);
        return;
      }
      const branchName = String(input.name ?? "").trim();
      if (!isValidBranchName(branchName) || branchExists(repository, branchName)) {
        outcome = failure(400, "Branch creation failed", { name: BRANCH_MESSAGES.invalid });
        return;
      }
      const baseReference = String(input.baseBranch ?? input.base ?? "").trim();
      const base = resolveRevision(repository, baseReference || repository.defaultBranch);
      if (!base) {
        outcome = failure(404, "Not found");
        return;
      }
      const createdAt = new Date().toISOString();
      createBranchReference(repository, {
        name: branchName,
        headCommitId: base.commit.id,
        creator: viewer.username,
        createdAt,
      });
      repository.updatedAt = createdAt;
      outcome = {
        ok: true,
        status: 201,
        payload: {
          repository: toRepositoryContext(repository, state, viewer, branchName),
          branch: {
            name: branchName,
            headCommitId: base.commit.id,
            baseRef: base.ref,
            baseCommitId: base.commit.id,
            createdBy: viewer.username,
            createdAt,
          },
        },
      };
    });
    return outcome;
  }

  /**
   * Points the repository default branch at another existing branch. Only a
   * repository administrator (or organization Owner) may do it; every existing
   * branch keeps its name, head and history.
   */
  async function updateDefaultBranch(sessionId, owner, name, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      const repository = findRepository(state, owner, name);
      if (!canViewRepository(state, repository, viewer)) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!canAdministerRepository(state, repository, viewer)) {
        outcome = failure(403, BRANCH_MESSAGES.notAdministerable);
        return;
      }
      const branchName = String(input.branch ?? input.defaultBranch ?? "").trim();
      if (!branchExists(repository, branchName)) {
        outcome = failure(400, "Default branch update failed", {
          branch: "That branch does not exist.",
        });
        return;
      }
      setDefaultBranch(repository, {
        branch: branchName,
        operator: viewer.username,
        at: new Date().toISOString(),
      });
      outcome = {
        ok: true,
        status: 200,
        payload: { repository: toRepositoryContext(repository, state, viewer, branchName) },
      };
    });
    return outcome;
  }

  /**
   * Stores one file change as a single commit and moves the target branch to it.
   * The path, the message and the viewer's role are validated first, so a refused
   * submission changes neither the file, the branch head nor the history.
   */
  async function commitRepositoryFile(sessionId, owner, name, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      const repository = findRepository(state, owner, name);
      if (!canViewRepository(state, repository, viewer)) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!canWriteRepository(state, repository, viewer)) {
        outcome = failure(403, FILE_EDIT_MESSAGES.forbidden);
        return;
      }
      const branch = String(input.branch ?? "").trim() || repository.defaultBranch;
      if (!branchExists(repository, branch)) {
        outcome = failure(404, "Not found");
        return;
      }
      // A protected branch is never written to directly (REQ-6-1): the change
      // must go through a pull request, so the rule cannot be bypassed here.
      if (isBranchProtected(state, repository, branch)) {
        outcome = failure(403, BRANCH_PROTECTION_MESSAGES.directWriteBlocked);
        return;
      }

      const path = String(input.path ?? "").trim();
      const previousPath = String(input.previousPath ?? "").trim();
      const fields = {};
      if (!isValidFilePath(path)) {
        fields.path = FILE_EDIT_MESSAGES.invalidPath;
      } else if (path !== previousPath && pathConflict(repository, branch, path)) {
        // A new or renamed path may not collide with an existing file or directory.
        fields.path = FILE_EDIT_MESSAGES.invalidPath;
      }
      const messageError = commitMessageError(input.message);
      if (messageError) fields.message = messageError;
      if (Object.keys(fields).length > 0) {
        outcome = failure(400, "File change failed", fields);
        return;
      }

      const commit = buildFileCommit(repository, {
        branch,
        path,
        previousPath,
        content: typeof input.content === "string" ? input.content : "",
        message: normalizeCommitMessage(input.message),
        authorLogin: viewer.username,
        createdAt: new Date().toISOString(),
      });
      repository.commits = repository.commits ?? [];
      repository.commits.push(commit);
      const reference = (repository.branches ?? []).find((candidate) => candidate.name === branch);
      reference.headCommitId = commit.id;
      repository.updatedAt = commit.createdAt;

      outcome = {
        ok: true,
        status: 201,
        payload: {
          repository: toRepositoryContext(repository, state, viewer, branch),
          file: toFilePayload(repository, branch, path),
          commit: {
            id: commit.id,
            message: commit.message,
            author: commit.authorLogin,
            createdAt: commit.createdAt,
            parentId: commit.parentId,
            branch: commit.branch,
          },
        },
      };
    });
    return outcome;
  }

  return { createRepositoryBranch, updateDefaultBranch, commitRepositoryFile };
}
