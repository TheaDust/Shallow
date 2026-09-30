/**
 * Repository roles, collaborators and namespace permissions (REQ-3, REQ-2-3).
 *
 * Every decision is recomputed from the persisted state, so ownership, grant or
 * visibility changes take effect on the next request everywhere (search, lists,
 * direct links, repository pages). Roles are not a client-side ladder: each
 * operation asks for the permission it needs (`canCreateRepositoryIn`,
 * `canAdministerRepository`, ...) instead of inferring it from a role name.
 *
 * A private organization repository is readable only by an organization Owner,
 * by an account with a direct role grant and by a direct member of a team that
 * holds a role grant. Organization membership alone grants nothing, and team
 * hierarchy propagates neither membership nor authorization.
 */

import { findOrganization, isOrganizationOwner } from "./organizations.mjs";

export const REPOSITORY_ROLES = ["read", "triage", "write", "maintain", "admin"];

const ROLE_RANK = new Map(REPOSITORY_ROLES.map((role, index) => [role, index + 1]));

export const NAMESPACE_FORBIDDEN = "You cannot create repositories in that namespace.";
export const NAMESPACE_UNKNOWN = "That owner does not exist.";

export function normalizeRepositoryRole(role) {
  const value = String(role ?? "").trim().toLowerCase();
  return REPOSITORY_ROLES.includes(value) ? value : "read";
}

export function highestRepositoryRole(roles) {
  let best = null;
  for (const role of roles) {
    if (!role) continue;
    if (!best || ROLE_RANK.get(role) > ROLE_RANK.get(best)) best = role;
  }
  return best;
}

export function findAccountByLogin(state, login) {
  const wanted = String(login ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return (state.accounts ?? []).find((account) => account.username.toLowerCase() === wanted) ?? null;
}

export function findOrganizationByLogin(state, login) {
  return findOrganization(state, login);
}

/**
 * Role granted to this account directly on one repository. Membership of an
 * organization never appears here: only an explicit grant does.
 */
export function accountRepositoryRole(state, repositoryId, accountId) {
  return highestRepositoryRole(
    (state.repositoryGrants ?? [])
      .filter(
        (grant) =>
          grant.repositoryId === repositoryId &&
          grant.subjectType === "account" &&
          grant.subjectId === accountId,
      )
      .map((grant) => normalizeRepositoryRole(grant.role)),
  );
}

/**
 * Role granted to one repository through a team the account is a direct member
 * of. A parent or child team of that team never contributes: team hierarchy is
 * display and management metadata only.
 */
export function teamRepositoryRole(state, repositoryId, accountId) {
  const teamIds = new Set(
    (state.teamMemberships ?? [])
      .filter((membership) => membership.accountId === accountId)
      .map((membership) => membership.teamId),
  );
  if (teamIds.size === 0) return null;
  return highestRepositoryRole(
    (state.repositoryGrants ?? [])
      .filter(
        (grant) =>
          grant.repositoryId === repositoryId &&
          grant.subjectType === "team" &&
          teamIds.has(grant.subjectId),
      )
      .map((grant) => normalizeRepositoryRole(grant.role)),
  );
}

/** The viewer's effective role on one repository, or null without any access. */
export function effectiveRepositoryRole(state, repository, viewer) {
  if (!repository || !viewer) return null;
  if (repository.owner.type === "user" && repository.owner.id === viewer.id) return "admin";
  if (repository.owner.type === "organization") {
    const organization =
      (state.organizations ?? []).find((candidate) => candidate.id === repository.owner.id) ??
      findOrganizationByLogin(state, repository.owner.login);
    if (isOrganizationOwner(organization, viewer.id)) return "admin";
  }
  return highestRepositoryRole([
    accountRepositoryRole(state, repository.id, viewer.id),
    teamRepositoryRole(state, repository.id, viewer.id),
  ]);
}

export function canAdministerRepository(state, repository, viewer) {
  return effectiveRepositoryRole(state, repository, viewer) === "admin";
}

/**
 * Resolves the namespace a repository is created in. A personal namespace
 * belongs to its own account; an organization namespace requires Owner status.
 */
export function resolveCreatableNamespace(state, viewer, login, ownerType) {
  if (!viewer) return { ok: false, error: "Not authenticated" };
  const wanted = String(login ?? "").trim();
  if (!wanted) return { ok: false, error: NAMESPACE_UNKNOWN };

  const organization = findOrganizationByLogin(state, wanted);
  if (String(ownerType ?? "").trim().toLowerCase() !== "user" && organization) {
    if (!isOrganizationOwner(organization, viewer.id)) return { ok: false, error: NAMESPACE_FORBIDDEN };
    return {
      ok: true,
      owner: { type: "organization", id: organization.id, login: organization.login },
    };
  }

  const account = findAccountByLogin(state, wanted);
  if (account) {
    if (account.id !== viewer.id) return { ok: false, error: NAMESPACE_FORBIDDEN };
    return { ok: true, owner: { type: "user", id: account.id, login: account.username } };
  }
  return { ok: false, error: NAMESPACE_UNKNOWN };
}

/** Namespaces the viewer may create repositories in (personal first). */
export function listCreatableNamespaces(state, viewer) {
  if (!viewer) return [];
  const namespaces = [{ type: "user", login: viewer.username }];
  for (const organization of state.organizations ?? []) {
    if (isOrganizationOwner(organization, viewer.id)) {
      namespaces.push({
        type: "organization",
        login: organization.login,
        name: organization.name ?? organization.login,
      });
    }
  }
  return namespaces;
}
