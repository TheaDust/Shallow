import { randomUUID } from "node:crypto";

import {
  canReadRepository,
  effectiveRepositoryRole,
  membershipOf,
  organizationById,
  repositoryByOwnerAndName,
  teamsOfOrganization,
} from "./access.mjs";

// The repository role matrix. Roles are stored lowercase and are not a
// cumulative ladder: an operation reads the exact relationship it needs.
export const REPOSITORY_ROLES = ["read", "triage", "write", "maintain", "admin"];

export const ACCESS_MESSAGES = {
  notAuthenticated: "Not authenticated",
  notFound: "Not found",
  accessDenied: "Access denied",
  roleUnsupported: "Role is not supported",
  subjectInvalid: "Subject is not an organization member or team",
};

let clock = () => new Date().toISOString();

function normalizeRole(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function subjectTypeOf(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Repository access grants. Only an organization Owner or an account whose
 * effective repository role is Admin may write; the subject must be a current
 * member of the owning organization or one of its teams, and one repository
 * keeps at most one direct grant per subject.
 */
export function createRepositoryAccessService(store) {
  function organizationOf(state, repository) {
    if (repository?.ownerType !== "organization") return null;
    return organizationById(state, repository.ownerId);
  }

  function isRepositoryAdmin(state, repository, accountId) {
    return effectiveRepositoryRole(state, repository, accountId) === "admin";
  }

  function publicGrants(state, repository) {
    const accountsById = new Map((state.accounts ?? []).map((account) => [account.id, account]));
    const teamsById = new Map((state.teams ?? []).map((team) => [team.id, team]));
    return (state.repositoryGrants ?? [])
      .filter((grant) => grant.repositoryId === repository.id)
      .map((grant) => {
        const subject =
          grant.subjectType === "account"
            ? accountsById.get(grant.subjectId)?.username
            : teamsById.get(grant.subjectId)?.name;
        if (!subject) return null;
        return {
          id: grant.id,
          subjectType: grant.subjectType,
          subjectName: subject,
          role: grant.role,
          grantedBy: grant.grantedBy ?? null,
          createdAt: grant.createdAt ?? null,
          updatedAt: grant.updatedAt ?? null,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.subjectName.localeCompare(right.subjectName));
  }

  /**
   * The access-management view: the repository, its owning organization (the
   * source of candidate members and teams) and every stored grant.
   */
  async function accessForViewer(ownerName, repositoryName, accountId) {
    const state = await store.read();
    const repository = repositoryByOwnerAndName(state, ownerName, repositoryName);
    if (!repository) return { status: "not-found" };
    if (!canReadRepository(state, repository, accountId)) return { status: "denied" };
    if (!isRepositoryAdmin(state, repository, accountId)) return { status: "forbidden" };

    const organization = organizationOf(state, repository);
    return {
      status: "ok",
      access: {
        repository: {
          owner: ownerName,
          name: repository.name,
          ownerType: repository.ownerType,
          visibility: repository.visibility,
        },
        organization: organization
          ? { name: organization.name, displayName: organization.displayName }
          : null,
        grants: publicGrants(state, repository),
        canManage: true,
      },
    };
  }

  /**
   * Adds a direct role grant or replaces the stored role of the same subject.
   * The whole check-and-write sequence runs inside one store update, so a
   * rejected subject or role leaves every relationship untouched.
   */
  async function saveGrant(ownerName, repositoryName, accountId, input) {
    const source = input ?? {};
    const subjectType = subjectTypeOf(source.subjectType);
    const subjectName =
      typeof source.subjectName === "string"
        ? source.subjectName.trim()
        : typeof source.subject === "string"
          ? source.subject.trim()
          : "";
    const role = normalizeRole(source.role);

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const repository = repositoryByOwnerAndName(state, ownerName, repositoryName);
      if (!repository) {
        outcome = { notFound: true };
        return;
      }
      if (!accountId) {
        outcome = { unauthorized: true };
        return;
      }
      if (!isRepositoryAdmin(state, repository, accountId)) {
        outcome = { forbidden: true };
        return;
      }
      if (!REPOSITORY_ROLES.includes(role)) {
        outcome = { ok: false, fieldErrors: { role: ACCESS_MESSAGES.roleUnsupported } };
        return;
      }
      const organization = organizationOf(state, repository);
      if (!organization) {
        outcome = { ok: false, fieldErrors: { subject: ACCESS_MESSAGES.subjectInvalid } };
        return;
      }

      let subject = null;
      if (subjectType === "account") {
        const account = (state.accounts ?? []).find(
          (candidate) => candidate.username === subjectName || candidate.email === subjectName,
        );
        if (account && membershipOf(state, organization.id, account.id)) {
          subject = { type: "account", id: account.id, name: account.username };
        }
      } else if (subjectType === "team") {
        const team = teamsOfOrganization(state, organization.id).find(
          (candidate) => candidate.name === subjectName || candidate.id === subjectName,
        );
        if (team) subject = { type: "team", id: team.id, name: team.name };
      }
      if (!subject) {
        outcome = { ok: false, fieldErrors: { subject: ACCESS_MESSAGES.subjectInvalid } };
        return;
      }

      const timestamp = clock();
      const existing = (state.repositoryGrants ?? []).find(
        (grant) =>
          grant.repositoryId === repository.id &&
          grant.subjectType === subject.type &&
          grant.subjectId === subject.id,
      );
      if (existing) {
        state.repositoryGrants = (state.repositoryGrants ?? []).map((grant) =>
          grant.id === existing.id ? { ...grant, role, updatedAt: timestamp } : grant,
        );
      } else {
        state.repositoryGrants = [
          ...(state.repositoryGrants ?? []),
          {
            id: `grant-${randomUUID()}`,
            repositoryId: repository.id,
            subjectType: subject.type,
            subjectId: subject.id,
            role,
            grantedBy: accountId,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ];
      }
      outcome = { ok: true, grants: publicGrants(state, repository) };
    });
    return outcome;
  }

  return { accessForViewer, saveGrant };
}
