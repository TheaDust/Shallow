/**
 * Branch protection rules of one repository (REQ-6-1).
 *
 * Reading the rules needs only read access to the repository; creating or
 * changing one needs repository-administration permission, recomputed from the
 * persisted state on every request. The whole rule is stored in one atomic
 * write, so a refused save leaves the stored rules exactly as they were.
 */

import { randomUUID } from "node:crypto";

import {
  BRANCH_NAME_MAX_LENGTH,
  BRANCH_PROTECTION_MESSAGES,
  rulesOfRepository,
  toBranchProtectionRulePayload,
} from "./domain/branch-protection.mjs";
import { canAdministerRepository } from "./domain/repository-access.mjs";
import {
  canViewRepository,
  findRepository,
  toRepositoryContext,
} from "./domain/repositories.mjs";

function failure(status, error, fields) {
  return { ok: false, status, error, fields: fields ?? {} };
}

export function createBranchProtectionHandlers({ jsonStore, resolveViewer }) {
  function readRepository(state, sessionId, owner, name) {
    const viewer = resolveViewer(state, sessionId);
    const repository = findRepository(state, owner, name);
    if (!repository) return { status: 404 };
    if (!canViewRepository(state, repository, viewer)) return { status: viewer ? 403 : 404 };
    return { viewer, repository };
  }

  /** Every stored rule of the repository, readable by anyone who may read it. */
  async function listBranchProtection(sessionId, owner, name) {
    const state = await jsonStore.read();
    const loaded = readRepository(state, sessionId, owner, name);
    if (loaded.status) return loaded;
    const { repository, viewer } = loaded;
    return {
      status: 200,
      payload: {
        repository: toRepositoryContext(repository, state, viewer, repository.defaultBranch),
        rules: rulesOfRepository(state, repository.id).map(toBranchProtectionRulePayload),
      },
    };
  }

  /**
   * Creates the rule of one exact branch name, or saves the changed toggles of an
   * existing one. Only a repository Admin (or an organization Owner) may do it.
   */
  async function saveBranchProtection(sessionId, owner, name, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const loaded = readRepository(state, sessionId, owner, name);
      if (loaded.status) {
        outcome = failure(loaded.status, loaded.status === 403 ? "Access denied" : "Not found");
        return;
      }
      const { repository, viewer } = loaded;
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!canAdministerRepository(state, repository, viewer)) {
        outcome = failure(403, BRANCH_PROTECTION_MESSAGES.forbidden);
        return;
      }
      const branchName = String(input.branchName ?? input.pattern ?? "").trim();
      if (!branchName) {
        outcome = failure(400, "Branch protection rule failed", {
          branchName: BRANCH_PROTECTION_MESSAGES.branchRequired,
        });
        return;
      }
      if (branchName.length > BRANCH_NAME_MAX_LENGTH) {
        outcome = failure(400, "Branch protection rule failed", {
          branchName: BRANCH_PROTECTION_MESSAGES.branchTooLong,
        });
        return;
      }
      const requireApproval = input.requireApproval === true;
      const requireStatusCheck = input.requireStatusCheck === true;
      const at = new Date().toISOString();
      state.branchProtectionRules = state.branchProtectionRules ?? [];
      const existing = state.branchProtectionRules.find(
        (rule) => rule.repositoryId === repository.id && rule.branchName === branchName,
      );
      let rule;
      if (existing) {
        existing.requireApproval = requireApproval;
        existing.requireStatusCheck = requireStatusCheck;
        existing.updatedBy = viewer.username;
        existing.updatedAt = at;
        rule = existing;
      } else {
        rule = {
          id: randomUUID(),
          repositoryId: repository.id,
          branchName,
          requireApproval,
          requireStatusCheck,
          createdBy: viewer.username,
          createdAt: at,
          updatedBy: viewer.username,
          updatedAt: at,
        };
        state.branchProtectionRules.push(rule);
      }
      outcome = {
        ok: true,
        status: existing ? 200 : 201,
        payload: {
          repository: toRepositoryContext(repository, state, viewer, repository.defaultBranch),
          rule: toBranchProtectionRulePayload(rule),
          rules: rulesOfRepository(state, repository.id).map(toBranchProtectionRulePayload),
        },
      };
    });
    return outcome;
  }

  return { listBranchProtection, saveBranchProtection };
}
