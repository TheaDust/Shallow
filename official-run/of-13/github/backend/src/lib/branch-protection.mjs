// Branch protection rules: a persistent merge restriction bound to one exact
// branch name of one repository.
//
// A rule stores the branch name verbatim and the two independently selectable
// requirements this product supports: "at least 1 valid Approve from someone
// other than the PR author" and "required check `test` is success". The rule
// name has no wildcard semantics — it is compared to a branch name literally.
//
// The service lists the rules of a readable repository for every reader and
// lets only a repository Admin (or organization Owner) store one; the stored
// relationship is re-checked inside the same atomic update that writes, so a
// hidden control is never the guard. The merge eligibility itself is evaluated
// in `pull-request-merge-rules.mjs`, which resolves the rule of a target branch
// through `protectionRuleFor` below.

import { randomUUID } from "node:crypto";

import { canAdministerRepository } from "./access.mjs";
import { usernameOf } from "./pull-request-decisions.mjs";
import { collection, resolveRepositoryForViewer } from "./repository-code.mjs";

export const BRANCH_PROTECTION_MESSAGES = {
  notAuthenticated: "Not authenticated",
  accessDenied: "Access denied",
  notFound: "Not found",
  notSaved: "Branch protection rule not saved",
  branchRequired: "Branch name pattern is required",
};

/** The readable summary of each selectable requirement. */
export const PROTECTION_REQUIREMENT_SUMMARIES = {
  approval: "1 approval",
  statusCheck: "Require status check test",
};

export const BRANCH_NAME_PATTERN_MAX_LENGTH = 255;

let clock = () => new Date().toISOString();

export function protectionRulesOf(state, repositoryId) {
  return collection(state, "branchProtectionRules").filter(
    (rule) => rule.repositoryId === repositoryId,
  );
}

/** The rule bound to exactly this branch name, or null. */
export function protectionRuleFor(state, repositoryId, branchName) {
  if (typeof branchName !== "string" || branchName.length === 0) return null;
  return (
    protectionRulesOf(state, repositoryId).find((rule) => rule.branchName === branchName) ?? null
  );
}

export function isBranchProtected(state, repositoryId, branchName) {
  return protectionRuleFor(state, repositoryId, branchName) !== null;
}

/** The stored rule as the frontend reads it, with its visible summaries. */
export function protectionRulePayload(state, rule) {
  return {
    id: rule.id,
    branchName: rule.branchName,
    requireApproval: rule.requireApproval === true,
    requireStatusCheck: rule.requireStatusCheck === true,
    requirements: [
      rule.requireApproval === true ? PROTECTION_REQUIREMENT_SUMMARIES.approval : null,
      rule.requireStatusCheck === true ? PROTECTION_REQUIREMENT_SUMMARIES.statusCheck : null,
    ].filter(Boolean),
    updatedBy: rule.updatedById ? usernameOf(state, rule.updatedById) : null,
    updatedAt: rule.updatedAt ?? rule.createdAt ?? null,
  };
}

function protectionPayload(state, repository) {
  return {
    branchProtectionRules: protectionRulesOf(state, repository.id)
      .slice()
      .sort((left, right) => String(left.branchName).localeCompare(String(right.branchName)))
      .map((rule) => protectionRulePayload(state, rule)),
  };
}

function normalizedPattern(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The branch-protection rules of one repository and its save operation. The
 * branch name is stored verbatim as an exact name; saving a name that already
 * carries a rule replaces the two toggles of that rule instead of adding a
 * second one.
 */
export function createBranchProtectionService(store) {
  async function listForViewer(owner, repositoryName, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    return {
      status: "ok",
      protection: {
        ...protectionPayload(state, resolved.repository),
        canAdminister: canAdministerRepository(state, resolved.repository, accountId),
      },
    };
  }

  async function saveRuleForViewer(owner, repositoryName, input, accountId) {
    if (!accountId) return { status: "unauthorized" };
    const branchName = normalizedPattern(input?.branchName);
    if (branchName.length === 0 || branchName.length > BRANCH_NAME_PATTERN_MAX_LENGTH) {
      return {
        status: "invalid",
        error: BRANCH_PROTECTION_MESSAGES.notSaved,
        fieldErrors: { branchName: BRANCH_PROTECTION_MESSAGES.branchRequired },
      };
    }
    // Only these two toggles exist, and each one is selectable on its own.
    const requireApproval = input?.requireApproval === true;
    const requireStatusCheck = input?.requireStatusCheck === true;

    let outcome = null;
    await store.update((state) => {
      const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
      if (resolved.status !== "ok") {
        outcome = resolved;
        return;
      }
      const repository = resolved.repository;
      if (!canAdministerRepository(state, repository, accountId)) {
        outcome = { status: "denied" };
        return;
      }
      const savedAt = clock();
      const existing = protectionRuleFor(state, repository.id, branchName);
      const rule = existing
        ? {
            ...existing,
            branchName,
            requireApproval,
            requireStatusCheck,
            updatedById: accountId,
            updatedAt: savedAt,
          }
        : {
            id: `branch-protection-${randomUUID()}`,
            repositoryId: repository.id,
            branchName,
            requireApproval,
            requireStatusCheck,
            createdById: accountId,
            createdAt: savedAt,
            updatedById: accountId,
            updatedAt: savedAt,
          };
      state.branchProtectionRules = existing
        ? collection(state, "branchProtectionRules").map((candidate) =>
            candidate.id === rule.id ? rule : candidate,
          )
        : [...collection(state, "branchProtectionRules"), rule];
      outcome = { status: "ok", protection: protectionPayload(state, repository) };
    });
    return outcome;
  }

  return { listForViewer, saveRuleForViewer };
}
