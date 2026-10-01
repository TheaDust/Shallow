/**
 * Branch protection writes (REQ-6-1).
 *
 * Only a repository Admin (or an organization Owner, whose effective role on an
 * organization repository is Admin) may create or change the rule of a branch;
 * the role is checked inside the same atomic update that stores the rule, so a
 * rejected request leaves the document unchanged and a non-Admin can never save
 * a restriction through the API even when the page hides the entry.
 */

import { randomUUID } from "node:crypto";

import {
  findProtectionRule,
  protectionPatternError,
  protectionRuleSummary,
} from "./branch-protection.mjs";
import { effectiveRepositoryRole } from "./repository-access.mjs";

/**
 * Creates the rule of one exact branch name, or updates the existing rule of
 * that name with the submitted toggles. The branch name is stored verbatim.
 */
export async function saveBranchProtectionRule(store, repositoryId, accountId, input) {
  let outcome = null;
  await store.update((draft) => {
    const repository = (draft.repositories ?? []).find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    const account = (draft.accounts ?? []).find((candidate) => candidate.id === accountId);
    if (!account || effectiveRepositoryRole(draft, repository, accountId) !== "Admin") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }

    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : "";
    const patternError = protectionPatternError(pattern);
    if (patternError) {
      outcome = { ok: false, errors: { pattern: patternError } };
      return undefined;
    }

    const timestamp = new Date().toISOString();
    const requireApproval = input.requireApproval === true;
    const requireStatusCheck = input.requireStatusCheck === true;
    if (!Array.isArray(repository.protectionRules)) repository.protectionRules = [];
    const existing = findProtectionRule(repository, pattern);
    let saved;
    if (existing) {
      existing.requireApproval = requireApproval;
      existing.requireStatusCheck = requireStatusCheck;
      existing.updatedBy = account.id;
      existing.updatedAt = timestamp;
      saved = existing;
    } else {
      saved = {
        id: randomUUID(),
        pattern,
        requireApproval,
        requireStatusCheck,
        createdBy: account.id,
        createdAt: timestamp,
        updatedBy: account.id,
        updatedAt: timestamp,
      };
      repository.protectionRules.push(saved);
    }
    repository.updatedAt = timestamp;
    outcome = { ok: true, repositoryId: repository.id, rule: protectionRuleSummary(saved), created: !existing };
    return draft;
  });
  return outcome;
}
