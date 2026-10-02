import { randomUUID } from "node:crypto";

import {
  findAccountByIdentifier,
  ORGANIZATION_ROLES,
  organizationMembership,
} from "./organizations.mjs";

/**
 * Organization membership management (REQ-2-2-3 / REQ-2-2-4).
 *
 * An Owner may add an existing account to the organization and gains the
 * "organization-account-role" membership relationship immediately (there is no
 * invitation or pending state), and may remove a member again. Removing a
 * member atomically drops the organization membership, every team membership
 * of that account inside the organization and every direct grant to the
 * account on repositories of the organization; team grants stay untouched and
 * the account itself is never deleted. The last Owner cannot be removed.
 */

export const ORGANIZATION_MEMBER_MESSAGES = {
  accountNotFound: "Account not found",
  alreadyMember: "Account is already a member",
  notMember: "Account is not a member of this organization",
  lastOwner: "The last Owner cannot be removed",
  invalidRole: "Role is not supported",
  forbidden: "Only an organization Owner can manage this organization",
};

export function normalizeOrganizationRole(value) {
  if (value === undefined || value === null || value === "") return "Member";
  return typeof value === "string" ? value.trim() : "";
}

/** Adds an existing account to the organization with the requested role. */
export async function addOrganizationMember(store, organizationId, accountId, input) {
  const role = normalizeOrganizationRole(input.role);
  const data = await store.read();
  if (organizationMembership(data, organizationId, accountId)?.role !== "Owner") {
    return { ok: false, forbidden: true };
  }
  // "Member" and "Owner" are the only supported roles; anything else is
  // rejected before the store is touched.
  if (!ORGANIZATION_ROLES.includes(role)) {
    return { ok: false, errors: { role: ORGANIZATION_MEMBER_MESSAGES.invalidRole } };
  }

  let outcome = null;
  await store.update((draft) => {
    if (organizationMembership(draft, organizationId, accountId)?.role !== "Owner") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    const account = findAccountByIdentifier(draft, input.username);
    if (!account) {
      outcome = { ok: false, errors: { username: ORGANIZATION_MEMBER_MESSAGES.accountNotFound } };
      return undefined;
    }
    if (organizationMembership(draft, organizationId, account.id)) {
      outcome = { ok: false, errors: { username: ORGANIZATION_MEMBER_MESSAGES.alreadyMember } };
      return undefined;
    }
    draft.memberships.push({
      id: randomUUID(),
      organizationId,
      accountId: account.id,
      role,
      createdAt: new Date().toISOString(),
    });
    outcome = { ok: true, member: { username: account.username, role } };
    return draft;
  });
  return outcome;
}

/**
 * Removes a member and every relationship it holds inside this organization.
 * Team grants are kept, other organizations and personal resources are never
 * touched, and an organization always keeps at least one Owner.
 */
export async function removeOrganizationMember(store, organizationId, accountId, identifier) {
  let outcome = null;
  await store.update((draft) => {
    if (organizationMembership(draft, organizationId, accountId)?.role !== "Owner") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    const account = findAccountByIdentifier(draft, identifier);
    const membership = account ? organizationMembership(draft, organizationId, account.id) : null;
    if (!membership) {
      outcome = { ok: false, errors: { username: ORGANIZATION_MEMBER_MESSAGES.notMember } };
      return undefined;
    }
    const isLastOwner = membership.role === "Owner"
      && draft.memberships.filter(
        (candidate) => candidate.organizationId === organizationId && candidate.role === "Owner",
      ).length <= 1;
    if (isLastOwner) {
      outcome = { ok: false, errors: { username: ORGANIZATION_MEMBER_MESSAGES.lastOwner } };
      return undefined;
    }
    const teamIds = new Set(
      draft.teams.filter((team) => team.organizationId === organizationId).map((team) => team.id),
    );
    const repositoryIds = new Set(
      draft.repositories
        .filter((repository) => repository.ownerType === "organization" && repository.ownerId === organizationId)
        .map((repository) => repository.id),
    );

    draft.memberships = draft.memberships.filter((candidate) => candidate !== membership);
    draft.teamMembers = draft.teamMembers.filter(
      (member) => !(teamIds.has(member.teamId) && member.accountId === account.id),
    );
    for (const repository of draft.repositories) {
      if (!repositoryIds.has(repository.id)) continue;
      repository.grants = (repository.grants ?? []).filter(
        (grant) => !(grant.subjectType === "account" && grant.subjectId === account.id),
      );
    }
    outcome = { ok: true, member: { username: account.username } };
    return draft;
  });
  return outcome;
}
