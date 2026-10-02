// Merge eligibility of one pull request.
//
// Before a merge the system rereads the target-branch head, the current compare
// commit and the protection rule of the target branch, then evaluates every
// condition on its own: no valid `Request changes` decision, the enabled
// requirements of the branch protection rule (1 valid non-author Approve for
// the current compare commit and/or `test` success for it) and no merge
// conflict between the target-branch head at merge time and the compare commit.
// An unprotected target carries no approval-count or check-success requirement,
// but still needs a conflict-free, non-blocked merge.
//
// The same evaluation answers the merge area of the pull-request page, so a
// blocked record explains its unmet condition before any click. Nothing here
// writes: the outcome is a pure function of the stored state.

import { protectionRuleFor } from "./branch-protection.mjs";
import {
  approversOf,
  reviewStatusOf,
  testStatusOf,
} from "./pull-request-decisions.mjs";
import { branchByName, commitById, filesOfCommit } from "./repository-code.mjs";

/** The reason shown when a protection rule still waits for a valid approval. */
export const MERGE_REQUIRED_APPROVAL_REASON = "Review required by branch protection";
export const MERGE_REQUIRED_STATUS_CHECK_REASON = "Required status check test must succeed";
export const MERGE_CHANGES_REQUESTED_REASON = "Changes requested must be resolved before merging";
export const MERGE_CONFLICTS_REASON = "This branch has conflicts that must be resolved";

function fileMapOf(commit) {
  const map = new Map();
  for (const file of filesOfCommit(commit)) {
    const path = typeof file?.path === "string" ? file.path : null;
    if (path) map.set(path, typeof file.content === "string" ? file.content : "");
  }
  return map;
}

function contentOf(map, path) {
  return map.has(path) ? map.get(path) : null;
}

/**
 * The paths changed on both sides since the recorded base revision with a
 * different resulting content: those revisions cannot be integrated without a
 * conflict, so the merge is refused without touching any branch.
 */
export function mergeConflictsOf(baseCommit, targetCommit, compareCommit) {
  const base = fileMapOf(baseCommit);
  const target = fileMapOf(targetCommit);
  const compare = fileMapOf(compareCommit);
  const paths = new Set([...base.keys(), ...target.keys(), ...compare.keys()]);
  const conflicts = [];
  for (const path of paths) {
    const baseValue = contentOf(base, path);
    const targetValue = contentOf(target, path);
    const compareValue = contentOf(compare, path);
    const targetChanged = targetValue !== baseValue;
    const compareChanged = compareValue !== baseValue;
    if (targetChanged && compareChanged && targetValue !== compareValue) conflicts.push(path);
  }
  return conflicts.sort((left, right) => left.localeCompare(right));
}

/**
 * The file snapshot the merge commit carries: an unchanged path keeps the
 * target revision, a path only the compare branch changed takes the compare
 * revision (a missing one deletes it), and a path both sides changed keeps the
 * compared revision — the conflict check above already refused the differing
 * cases.
 */
export function mergedFilesOf(baseCommit, targetCommit, compareCommit) {
  const base = fileMapOf(baseCommit);
  const target = fileMapOf(targetCommit);
  const compare = fileMapOf(compareCommit);
  const paths = new Set([...base.keys(), ...target.keys(), ...compare.keys()]);
  const files = [];
  for (const path of paths) {
    const baseValue = contentOf(base, path);
    const targetValue = contentOf(target, path);
    const compareValue = contentOf(compare, path);
    const compareChanged = compareValue !== baseValue;
    const selected = compareChanged ? compareValue : targetValue;
    if (selected !== null) files.push({ path, content: selected });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** The merge state of one pull request, resolved from the stored objects. */
export function mergeStateOf(state, repository, pullRequest) {
  const targetBranch = branchByName(state, repository.id, pullRequest.targetBranch);
  const targetHead = targetBranch?.commitId ? commitById(state, targetBranch.commitId) : null;
  const baseCommit = pullRequest.baseCommitId ? commitById(state, pullRequest.baseCommitId) : null;
  const compareCommit = pullRequest.compareCommitId
    ? commitById(state, pullRequest.compareCommitId)
    : null;
  const rule = protectionRuleFor(state, repository.id, pullRequest.targetBranch);
  const conflicts = mergeConflictsOf(baseCommit, targetHead, compareCommit);

  // Every condition is evaluated independently; the order is the order the
  // merge area displays them in.
  const conditions = [
    {
      id: "changes_requested",
      label: MERGE_CHANGES_REQUESTED_REASON,
      satisfied: reviewStatusOf(state, pullRequest) !== "changes_requested",
    },
  ];
  if (rule?.requireApproval === true) {
    conditions.push({
      id: "approval",
      label: MERGE_REQUIRED_APPROVAL_REASON,
      satisfied: approversOf(state, pullRequest).length >= 1,
    });
  }
  if (rule?.requireStatusCheck === true) {
    conditions.push({
      id: "status_check",
      label: MERGE_REQUIRED_STATUS_CHECK_REASON,
      satisfied: testStatusOf(state, pullRequest) === "success",
    });
  }
  conditions.push({
    id: "conflicts",
    label: MERGE_CONFLICTS_REASON,
    satisfied: conflicts.length === 0,
  });

  return {
    targetBranch,
    targetHead,
    baseCommit,
    compareCommit,
    rule,
    conflicts,
    conditions,
    mergeable: conditions.every((condition) => condition.satisfied),
  };
}

/** The reason of the first unmet condition, or null when the merge is allowed. */
export function mergeBlockerOf(state, repository, pullRequest) {
  const merged = mergeStateOf(state, repository, pullRequest);
  return merged.conditions.find((condition) => !condition.satisfied)?.label ?? null;
}
