/**
 * Branch protection rules (REQ-6-1).
 *
 * A rule is a persistent merge restriction bound to one exact branch name: it
 * stores the branch name itself (no wildcard semantics) plus the two
 * independently selectable requirements this product supports — "at least 1
 * valid Approve from someone other than the PR author" and "required check
 * `test` is success". Saving a rule for a name that already carries one updates
 * the stored toggles instead of adding a second rule, so one branch never holds
 * two conflicting restrictions.
 *
 * A branch that carries a rule with at least one enabled requirement is
 * protected: a direct file change through the Code page is refused for it, and
 * the requirements are applied when a pull request into that branch is merged
 * (REQ-6 / REQ-6-1).
 */

import { findRepositoryBranch } from "./repository-branches.mjs";

export const BRANCH_PROTECTION_MESSAGES = {
  patternRequired: "Branch name pattern is required",
  invalidPattern: "Enter an exact branch name",
  forbidden: "Only a repository Admin can manage branch protection rules",
  signInRequired: "Sign in is required to manage branch protection rules",
  saveFailed: "The branch protection rule could not be saved",
  notFound: "Branch protection rule not found",
};

/** The one check this product knows; its status is stored per compare commit. */
export const REQUIRED_CHECK_NAME = "test";

/** The statuses a check of this product can hold (REQ-6-1). */
export const CHECK_STATUSES = ["pending", "success", "failure"];

const MAX_PATTERN_LENGTH = 255;

function trimmed(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/** Every stored rule of a repository, in the order they were created. */
export function repositoryProtectionRules(repository) {
  const rules = Array.isArray(repository?.protectionRules) ? repository.protectionRules : [];
  return rules.filter((rule) => rule && typeof rule.pattern === "string" && rule.pattern);
}

/** The rule bound to exactly this branch name, or null (REQ-6-1). */
export function findProtectionRule(repository, branchName) {
  const wanted = trimmed(branchName);
  if (!wanted) return null;
  return repositoryProtectionRules(repository).find((rule) => rule.pattern === wanted) ?? null;
}

/** The read model of one rule: the exact branch name and its toggles. */
export function protectionRuleSummary(rule) {
  return {
    id: rule.id ?? "",
    pattern: rule.pattern ?? "",
    requireApproval: rule.requireApproval === true,
    requireStatusCheck: rule.requireStatusCheck === true,
    createdAt: rule.createdAt ?? null,
    createdBy: rule.createdBy ?? null,
    updatedAt: rule.updatedAt ?? null,
    updatedBy: rule.updatedBy ?? null,
  };
}

/** Whether a stored rule restricts the branch: it needs one enabled requirement. */
export function ruleRestrictsBranch(rule) {
  return Boolean(rule) && (rule.requireApproval === true || rule.requireStatusCheck === true);
}

/**
 * Whether a branch is protected against direct writes: an explicit protection
 * flag on the branch reference, or a stored rule naming that exact branch.
 */
export function isBranchProtected(repository, branchName) {
  const branch = findRepositoryBranch(repository, branchName);
  if (branch?.protected === true) return true;
  return ruleRestrictsBranch(findProtectionRule(repository, branchName));
}

/** The rule the merge of a pull request into this branch has to apply. */
export function mergeRestrictionFor(repository, branchName) {
  const rule = findProtectionRule(repository, branchName);
  return ruleRestrictsBranch(rule) ? rule : null;
}

/**
 * The rule a branch name pattern has to satisfy: an exact branch name, not a
 * wildcard expression, so no `*`, `?` or whitespace may appear.
 */
export function protectionPatternError(pattern) {
  const value = trimmed(pattern);
  if (!value) return BRANCH_PROTECTION_MESSAGES.patternRequired;
  if (value.length > MAX_PATTERN_LENGTH) return BRANCH_PROTECTION_MESSAGES.invalidPattern;
  if (/[*?\s]/.test(value)) return BRANCH_PROTECTION_MESSAGES.invalidPattern;
  return null;
}
