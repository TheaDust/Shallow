// Write surface of one repository: create a branch from an existing revision,
// change the repository default branch and add a file through the web editor.
//
// Every rule is re-validated here: the session cookie is the only trusted
// identity source, write permission is read from the stored grants and a
// rejected request writes nothing.

import { normalizeText } from "./auth-rules.mjs";
import { readJson, sendJson } from "./http.mjs";
import {
  BRANCH_MESSAGES,
  FILE_MESSAGES,
  ORG_MESSAGES,
  validateBranchName,
  validateCommitMessage,
  validateNewFilePath,
} from "./org-rules.mjs";
import { publicBranchProtectionRule } from "./org-store.mjs";

const BRANCHES_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/branches$/;
const DEFAULT_BRANCH_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/default-branch$/;
const FILES_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/files$/;
const BRANCH_PROTECTIONS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/branch-protections$/;

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createRepositoryWriteRoutes({ orgStore, findRepository, describeRepository, currentUser }) {
  async function resolve(response, owner, name) {
    const repository = await findRepository(decodeSegment(owner), decodeSegment(name));
    if (!repository) sendJson(response, 404, { error: "Not found" });
    return repository;
  }

  /** The signed-in account when it may write to the repository, else null. */
  async function requireWriter(response, repository, user) {
    if (!user) {
      sendJson(response, 401, { message: "Not signed in" });
      return null;
    }
    if (!(await orgStore.canWriteRepository(repository, user.id))) {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return null;
    }
    return user;
  }

  return async function handleRepositoryWrite(request, response, url, method) {
    const { pathname } = url;
    if (!pathname.startsWith("/api/repositories/")) return false;

    const branchesMatch = pathname.match(BRANCHES_PATH);
    const defaultBranchMatch = pathname.match(DEFAULT_BRANCH_PATH);
    const filesMatch = pathname.match(FILES_PATH);
    const branchProtectionsMatch = pathname.match(BRANCH_PROTECTIONS_PATH);
    if (!branchesMatch && !defaultBranchMatch && !filesMatch && !branchProtectionsMatch) return false;

    const match = branchesMatch ?? defaultBranchMatch ?? filesMatch ?? branchProtectionsMatch;
    const repository = await resolve(response, match[1], match[2]);
    if (!repository) return true;

    const user = await currentUser(request);

    // GET /api/repositories/:owner/:name/branch-protections — the persistent
    // protection rules of this repository plus the caller's administrator
    // permission, so the settings view can offer the creation control only to
    // an Admin or organization Owner (REQ-6-1). Reading stays open with the
    // repository.
    if (branchProtectionsMatch && method === "GET") {
      if (!(await orgStore.canReadRepository(repository, user?.id ?? null))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      sendJson(response, 200, {
        rules: await orgStore.listBranchProtectionRules(repository.id),
        canManage: await orgStore.canManageRepository(repository, user?.id ?? null),
      });
      return true;
    }

    // POST /api/repositories/:owner/:name/branch-protections — create or update
    // the rule of one exact branch. A non-administrator is refused here even
    // when the control is not rendered.
    if (branchProtectionsMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canManageRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readJson(request).catch(() => ({}));
      const branchName = normalizeText(body.branchName);
      const fieldErrors = {};
      if (!validateBranchName(branchName)) {
        fieldErrors.branchName = BRANCH_MESSAGES.branchNameInvalid;
      }
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }
      const rule = await orgStore.upsertBranchProtectionRule({
        repositoryId: repository.id,
        branchName,
        requireApprovals: body.requireApprovals === true,
        requireStatusCheck: body.requireStatusCheck === true,
      });
      sendJson(response, 200, {
        rule: publicBranchProtectionRule(rule),
        rules: await orgStore.listBranchProtectionRules(repository.id),
      });
      return true;
    }

    // POST /api/repositories/:owner/:name/branches — a named reference at the
    // head commit of the current (or explicitly named) base branch.
    if (branchesMatch && method === "POST") {
      if (!(await requireWriter(response, repository, user))) return true;
      const body = await readJson(request).catch(() => ({}));
      const name = typeof body.name === "string" ? body.name : "";
      const baseBranch = normalizeText(body.base);
      if (!validateBranchName(name)) {
        sendJson(response, 400, {
          message: BRANCH_MESSAGES.branchNameInvalid,
          fieldErrors: { name: BRANCH_MESSAGES.branchNameInvalid },
        });
        return true;
      }
      const result = await orgStore.createRepositoryBranch({
        repositoryId: repository.id,
        name,
        baseBranch,
      });
      if (!result.ok) {
        const message =
          result.reason === "duplicate"
            ? BRANCH_MESSAGES.branchNameExists
            : BRANCH_MESSAGES.branchNotFound;
        sendJson(response, 400, { message, fieldErrors: { name: message } });
        return true;
      }
      sendJson(response, 201, {
        branch: {
          name: result.branch.name,
          headCommitId: result.branch.headCommitId ?? null,
        },
        defaultBranch: repository.defaultBranch ?? "main",
      });
      return true;
    }

    // PATCH /api/repositories/:owner/:name/default-branch — an administrator
    // operation; the branches, commits and files of the repository stay as they
    // are, so the previous default branch remains readable.
    if (defaultBranchMatch && method === "PATCH") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canManageRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readJson(request).catch(() => ({}));
      const branch = normalizeText(body.branch);
      const result = await orgStore.setRepositoryDefaultBranch({
        repositoryId: repository.id,
        branch,
      });
      if (!result.ok) {
        sendJson(response, 400, {
          message: BRANCH_MESSAGES.defaultBranchInvalid,
          fieldErrors: { branch: BRANCH_MESSAGES.defaultBranchInvalid },
        });
        return true;
      }
      sendJson(response, 200, { repository: await describeRepository(result.repository, user.id) });
      return true;
    }

    // POST /api/repositories/:owner/:name/files — one commit adding a file to
    // the named branch, which then points at that commit.
    if (filesMatch && method === "POST") {
      const writer = await requireWriter(response, repository, user);
      if (!writer) return true;
      const body = await readJson(request).catch(() => ({}));
      const path = normalizeText(body.path);
      const content = typeof body.content === "string" ? body.content : "";
      const message = normalizeText(body.message);
      const branch = normalizeText(body.branch) || repository.defaultBranch || "main";

      const fieldErrors = {};
      if (!validateNewFilePath(path)) fieldErrors.path = FILE_MESSAGES.filePathInvalid;
      const messageState = validateCommitMessage(message);
      if (messageState === "required") fieldErrors.message = FILE_MESSAGES.commitMessageRequired;
      else if (messageState === "too-long") fieldErrors.message = FILE_MESSAGES.commitMessageTooLong;
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      const result = await orgStore.createRepositoryFileCommit({
        repositoryId: repository.id,
        branch,
        path,
        content,
        message,
        authorName: writer.username,
        authorAccountId: writer.id,
      });
      if (!result.ok) {
        if (result.reason === "path-conflict") {
          sendJson(response, 400, {
            message: FILE_MESSAGES.filePathInvalid,
            fieldErrors: { path: FILE_MESSAGES.filePathInvalid },
          });
          return true;
        }
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const file = {
        branch: result.branch,
        defaultBranch: repository.defaultBranch ?? "main",
        path,
        name: path.split("/").at(-1),
        content,
      };
      sendJson(response, 201, {
        repository: await describeRepository(repository, writer.id),
        branch: result.branch,
        file,
        commit: {
          id: result.commit.id,
          message: result.commit.message,
          authorName: result.commit.authorName,
          createdAt: result.commit.createdAt,
          parentCommitId: result.commit.parentCommitId ?? null,
        },
      });
      return true;
    }

    return false;
  };
}
