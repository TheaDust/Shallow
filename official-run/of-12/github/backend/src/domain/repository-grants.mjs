import { randomUUID } from "node:crypto";

import { findAccountByIdentifier, organizationMembers } from "./organizations.mjs";
import { organizationTeams } from "./teams.mjs";
import {
  effectiveRepositoryRole,
  isRepositoryRole,
  organizationMembership,
  REPOSITORY_ROLES,
} from "./repository-access.mjs";

/**
 * Repository role grants (REQ-2-3).
 *
 * An organization Owner or a repository Admin (the effective role matrix:
 * Owner status counts as Admin) grants one of Read/Triage/Write/Maintain/Admin
 * to a current organization member or to a team of the organization. For a
 * given subject and repository exactly one direct grant is stored: saving the
 * same role again keeps the single record and changing the role replaces it.
 * The grant stores the subject, the repository it belongs to, the role, the
 * granting account and the timestamp.
 */

export const REPOSITORY_ACCESS_MESSAGES = {
  repositoryNotFound: "Repository not found",
  forbidden: "Only an organization Owner or repository Admin can manage access",
  subjectRequired: "Select a member or team",
  accountNotMember: "Account is not a member of this organization",
  teamNotInOrganization: "Team does not belong to this organization",
  roleNotSupported: "Role is not supported",
  saveFailed: "The access grant could not be saved",
};

/** True when the account may grant or change roles on this repository. */
export function canManageRepositoryAccess(data, repository, accountId) {
  return effectiveRepositoryRole(data, repository, accountId) === "Admin";
}

function subjectName(data, grant) {
  if (grant.subjectType === "team") {
    return data.teams.find((team) => team.id === grant.subjectId)?.name ?? grant.subjectId;
  }
  return data.accounts.find((account) => account.id === grant.subjectId)?.username ?? grant.subjectId;
}

/** The candidate subjects of the picker: current members and teams. */
export function accessCandidates(data, repository) {
  if (repository.ownerType !== "organization") return [];
  const members = organizationMembers(data, repository.ownerId).map((member) => ({
    subjectType: "account",
    name: member.username,
  }));
  const teams = organizationTeams(data, repository.ownerId).map((team) => ({
    subjectType: "team",
    name: team.name,
  }));
  return [...members, ...teams].sort((left, right) => left.name.localeCompare(right.name));
}

/** The stored grants as displayable rows, each carrying its subject name. */
export function accessGrants(data, repository) {
  return (repository.grants ?? [])
    .map((grant) => ({
      subjectType: grant.subjectType,
      name: subjectName(data, grant),
      role: grant.role,
      grantor: grant.grantedBy ?? null,
      createdAt: grant.createdAt ?? null,
      updatedAt: grant.updatedAt ?? grant.createdAt ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Read model of the Manage-access page for the current viewer. */
export function repositoryAccessState(data, repository, accountId) {
  return {
    viewerRole: effectiveRepositoryRole(data, repository, accountId),
    canManage: canManageRepositoryAccess(data, repository, accountId),
    roles: [...REPOSITORY_ROLES],
    candidates: accessCandidates(data, repository),
    grants: accessGrants(data, repository),
  };
}

function resolveSubject(data, repository, subjectType, subject) {
  const raw = typeof subject === "string" ? subject.trim() : "";
  if (!raw) return { error: REPOSITORY_ACCESS_MESSAGES.subjectRequired };
  const lower = raw.toLowerCase();
  if (subjectType === "team") {
    if (repository.ownerType !== "organization") {
      return { error: REPOSITORY_ACCESS_MESSAGES.teamNotInOrganization };
    }
    const team = data.teams.find(
      (candidate) => candidate.organizationId === repository.ownerId
        && (candidate.name === lower || candidate.id === raw),
    );
    if (!team) return { error: REPOSITORY_ACCESS_MESSAGES.teamNotInOrganization };
    return { subjectId: team.id };
  }
  const account = findAccountByIdentifier(data, raw);
  if (!account) return { error: REPOSITORY_ACCESS_MESSAGES.accountNotMember };
  if (repository.ownerType === "organization"
    && !organizationMembership(data, repository.ownerId, account.id)) {
    return { error: REPOSITORY_ACCESS_MESSAGES.accountNotMember };
  }
  return { subjectId: account.id };
}

/**
 * Stores (or replaces) the single direct grant of a subject on a repository.
 * The permission check, the subject resolution and the write happen inside one
 * atomic update, so a rejected request leaves the stored grants untouched.
 */
export async function setRepositoryGrant(store, repositoryId, accountId, input) {
  const role = typeof input.role === "string" ? input.role.trim() : "";
  const subjectType = input.subjectType === "team" ? "team" : "account";

  let outcome = null;
  await store.update((draft) => {
    const repository = draft.repositories.find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    if (!canManageRepositoryAccess(draft, repository, accountId)) {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    if (!isRepositoryRole(role)) {
      outcome = { ok: false, errors: { role: REPOSITORY_ACCESS_MESSAGES.roleNotSupported } };
      return undefined;
    }
    const resolved = resolveSubject(draft, repository, subjectType, input.subject);
    if (resolved.error) {
      outcome = { ok: false, errors: { subject: resolved.error } };
      return undefined;
    }

    const now = new Date().toISOString();
    repository.grants = Array.isArray(repository.grants) ? repository.grants : [];
    const existing = repository.grants.find(
      (grant) => grant.subjectType === subjectType && grant.subjectId === resolved.subjectId,
    );
    if (existing) {
      // Only one direct grant per subject and repository: the role is
      // replaced in place instead of appending a second record.
      existing.role = role;
      existing.grantedBy = accountId;
      existing.updatedAt = now;
    } else {
      repository.grants.push({
        id: randomUUID(),
        subjectType,
        subjectId: resolved.subjectId,
        role,
        grantedBy: accountId,
        createdAt: now,
      });
    }
    outcome = { ok: true, repository };
    return draft;
  });
  return outcome;
}
