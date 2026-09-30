/**
 * Branch protection rules of one repository (REQ-6-1).
 *
 * A rule is one persistent merge restriction bound to an exact branch name: it
 * stores the branch name and the two independently selectable requirements
 * ("at least 1 valid Approve from someone other than the PR author" and
 * "required check `test` is success"). The branch name has no wildcard
 * semantics: it is compared literally with the branch of a write or a merge.
 */

export const BRANCH_PROTECTION_MESSAGES = {
  branchRequired: "Branch name is required",
  branchTooLong: "The branch name must be 255 characters or fewer",
  forbidden: "You must be a repository administrator to manage branch protection rules.",
  directWriteBlocked: "This branch is protected; open a pull request instead.",
};

/** Visible summaries of one stored requirement (REQ-6-1). */
export const APPROVAL_SUMMARY = "1 approval";
export const STATUS_CHECK_SUMMARY = "Require status check test";

export const BRANCH_NAME_MAX_LENGTH = 255;

/** Every stored rule of one repository, in branch-name order. */
export function rulesOfRepository(state, repositoryId) {
  return (state.branchProtectionRules ?? [])
    .filter((rule) => rule.repositoryId === repositoryId)
    .sort((left, right) => left.branchName.localeCompare(right.branchName));
}

/** The rule bound to one exact branch name, or null when the branch is unprotected. */
export function findBranchProtectionRule(state, repositoryId, branchName) {
  const wanted = String(branchName ?? "").trim();
  if (!wanted) return null;
  return (
    (state.branchProtectionRules ?? []).find(
      (rule) => rule.repositoryId === repositoryId && rule.branchName === wanted,
    ) ?? null
  );
}

/** Whether one branch carries a protected-branch restriction. */
export function isBranchProtected(state, repository, branchName) {
  if (!repository) return false;
  return findBranchProtectionRule(state, repository.id, branchName) !== null;
}

/** The visible summaries of a stored rule: only the enabled requirements appear. */
export function branchProtectionSummaries(rule) {
  const summaries = [];
  if (rule?.requireApproval === true) summaries.push(APPROVAL_SUMMARY);
  if (rule?.requireStatusCheck === true) summaries.push(STATUS_CHECK_SUMMARY);
  return summaries;
}

export function toBranchProtectionRulePayload(rule) {
  return {
    id: rule.id,
    branchName: rule.branchName,
    requireApproval: rule.requireApproval === true,
    requireStatusCheck: rule.requireStatusCheck === true,
    summaries: branchProtectionSummaries(rule),
    createdBy: rule.createdBy ?? null,
    createdAt: rule.createdAt ?? "",
    updatedBy: rule.updatedBy ?? null,
    updatedAt: rule.updatedAt ?? "",
  };
}
