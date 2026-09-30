import { apiRequest } from "./api";
import type { RepositoryContext, RepositoryRole } from "./repositories-api";

/**
 * Branch protection rules of one repository (REQ-6-1): a rule is bound to one
 * exact branch name and carries the two independently selectable requirements.
 * Reading the rules needs only repository read access; creating or changing one
 * needs repository-administration permission, which the server re-checks.
 */

export interface BranchProtectionRule {
  id: string;
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
  /** Visible summaries of the stored requirements (`1 approval`, `Require status check test`). */
  summaries: string[];
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface BranchProtectionPayload {
  repository: RepositoryContext;
  rules: BranchProtectionRule[];
}

export interface SavedBranchProtectionPayload extends BranchProtectionPayload {
  rule: BranchProtectionRule;
}

export interface BranchProtectionInput {
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
}

/** The exact label of the approval requirement (REQ-6-1). */
export const REQUIRE_APPROVAL_LABEL = "Require 1 approval";
/** The exact label of the status-check requirement (REQ-6-1). */
export const REQUIRE_STATUS_CHECK_LABEL = "Require status check test";

/** Only a repository Admin (or an organization Owner) manages protection rules. */
export function canAdministerBranchProtection(
  role: RepositoryRole | null | undefined,
): boolean {
  return role === "admin";
}

function protectionPath(owner: string, name: string): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branch-protection`;
}

export function fetchBranchProtection(
  owner: string,
  name: string,
): Promise<BranchProtectionPayload> {
  return apiRequest<BranchProtectionPayload>(protectionPath(owner, name));
}

/** Creates the rule of one branch name, or saves the changed toggles of an existing one. */
export function saveBranchProtection(
  owner: string,
  name: string,
  input: BranchProtectionInput,
): Promise<SavedBranchProtectionPayload> {
  return apiRequest<SavedBranchProtectionPayload>(protectionPath(owner, name), {
    method: "POST",
    body: JSON.stringify(input),
  });
}
