/**
 * Repository access management (REQ-2-3).
 *
 * A repository Admin — the owning account, an organization Owner or an account
 * with an `admin` grant — may grant one role to a current organization member or
 * to a team of the owning organization. There is exactly one direct grant per
 * subject and repository: saving a role again replaces it, and the effective
 * role of an account stays the highest of its Owner status, its direct grants
 * and the grants of the teams it is a *direct* member of.
 */

import { randomUUID } from "node:crypto";

import {
  REPOSITORY_ROLES,
  canAdministerRepository,
  effectiveRepositoryRole,
  normalizeRepositoryRole,
} from "./domain/repository-access.mjs";
import { canViewRepository, findRepository, toRepositorySummary } from "./domain/repositories.mjs";
import { isOrganizationOwner } from "./domain/organizations.mjs";

const ADMIN_MESSAGE = "You must be a repository administrator to manage its access.";
const SUBJECT_MESSAGE = "Choose an account or team of the owning organization";

function failure(status, error, fields) {
  return { ok: false, status, error, fields: fields ?? {} };
}

/**
 * Organizations whose members and teams are authorization candidates: the
 * organization that owns the repository, or — for a personal repository — the
 * organizations the repository owner owns.
 */
function candidateOrganizations(state, repository) {
  const organizations = state.organizations ?? [];
  if (repository.owner.type === "organization") {
    const owner = organizations.find((organization) => organization.id === repository.owner.id);
    return owner
      ? [owner]
      : organizations.filter(
          (organization) =>
            String(organization.login ?? "").toLowerCase() ===
            String(repository.owner.login ?? "").toLowerCase(),
        );
  }
  return organizations.filter((organization) =>
    isOrganizationOwner(organization, repository.owner.id),
  );
}

/** Current organization members and teams that may receive a repository role. */
function candidateSubjects(state, repository) {
  const subjects = [];
  const seen = new Set();
  for (const organization of candidateOrganizations(state, repository)) {
    for (const member of organization.members ?? []) {
      const account = (state.accounts ?? []).find((candidate) => candidate.id === member.accountId);
      if (!account || seen.has(`account:${account.id}`)) continue;
      seen.add(`account:${account.id}`);
      subjects.push({ type: "account", id: account.id, name: account.username });
    }
    for (const team of state.teams ?? []) {
      if (team.organizationId !== organization.id || seen.has(`team:${team.id}`)) continue;
      seen.add(`team:${team.id}`);
      subjects.push({ type: "team", id: team.id, name: team.name });
    }
  }
  return subjects.sort((left, right) => left.name.localeCompare(right.name));
}

function subjectName(state, grant) {
  if (grant.subjectType === "team") {
    const team = (state.teams ?? []).find((candidate) => candidate.id === grant.subjectId);
    return team ? team.name : "";
  }
  const account = (state.accounts ?? []).find((candidate) => candidate.id === grant.subjectId);
  return account ? account.username : "";
}

function listGrants(state, repository) {
  return (state.repositoryGrants ?? [])
    .filter((grant) => grant.repositoryId === repository.id)
    .map((grant) => ({
      id: grant.id ?? `${grant.subjectType}:${grant.subjectId}`,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      name: subjectName(state, grant),
      role: normalizeRepositoryRole(grant.role),
      grantorId: grant.grantorId ?? null,
      createdAt: grant.createdAt ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Resolves the requested subject inside the candidates of this repository. The
 * request may carry a typed subject (`account`/`team` plus the identifier or the
 * visible name) or the compact `team:<name>` form.
 */
function resolveSubject(state, repository, input) {
  let subjectType = String(input.subjectType ?? input.type ?? "").trim().toLowerCase();
  let subjectId = String(input.subjectId ?? input.subject ?? "").trim();
  const separator = subjectId.indexOf(":");
  if (separator > 0) {
    const prefix = subjectId.slice(0, separator).toLowerCase();
    if (prefix === "account" || prefix === "team") {
      subjectType = subjectType || prefix;
      subjectId = subjectId.slice(separator + 1);
    }
  }
  const candidates = candidateSubjects(state, repository);
  const typed = subjectType
    ? candidates.filter((candidate) => candidate.type === subjectType)
    : candidates;
  return (
    typed.find((candidate) => candidate.id === subjectId) ??
    typed.find((candidate) => candidate.name === subjectId) ??
    null
  );
}

export function createRepositoryAccessHandlers({ jsonStore, resolveViewer }) {
  /** Grant list and authorization subjects of one repository (Admin only). */
  async function getRepositoryAccess(sessionId, owner, name) {
    const state = await jsonStore.read();
    const repository = findRepository(state, owner, name);
    if (!repository) return failure(404, "Not found");
    const viewer = resolveViewer(state, sessionId);
    if (!canViewRepository(state, repository, viewer)) {
      return failure(viewer ? 403 : 404, viewer ? "Access denied" : "Not found");
    }
    if (!canAdministerRepository(state, repository, viewer)) return failure(403, ADMIN_MESSAGE);
    return {
      ok: true,
      repository: toRepositorySummary(repository, state),
      viewer: {
        role: effectiveRepositoryRole(state, repository, viewer),
        canAdminister: true,
      },
      grants: listGrants(state, repository),
      candidates: candidateSubjects(state, repository),
    };
  }

  /**
   * Stores one direct role grant for a subject. A second save for the same
   * subject and repository replaces the stored role instead of adding a record.
   */
  async function saveRepositoryAccess(sessionId, owner, name, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const repository = findRepository(state, owner, name);
      if (!repository) {
        outcome = failure(404, "Not found");
        return;
      }
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!canViewRepository(state, repository, viewer)) {
        outcome = failure(404, "Not found");
        return;
      }
      if (!canAdministerRepository(state, repository, viewer)) {
        outcome = failure(403, ADMIN_MESSAGE);
        return;
      }
      const subject = resolveSubject(state, repository, input);
      const role = String(input.role ?? "").trim().toLowerCase();
      const fields = {};
      if (!subject) fields.subject = SUBJECT_MESSAGE;
      if (!REPOSITORY_ROLES.includes(role)) fields.role = "Choose a role";
      if (Object.keys(fields).length > 0) {
        outcome = failure(400, "Access grant failed", fields);
        return;
      }
      state.repositoryGrants = state.repositoryGrants ?? [];
      const existing = state.repositoryGrants.find(
        (grant) =>
          grant.repositoryId === repository.id &&
          grant.subjectType === subject.type &&
          grant.subjectId === subject.id,
      );
      if (existing) {
        existing.role = role;
        existing.grantorId = viewer.id;
        existing.updatedAt = new Date().toISOString();
        outcome = {
          ok: true,
          status: 200,
          grant: listGrants(state, repository).find(
            (grant) => grant.subjectType === subject.type && grant.subjectId === subject.id,
          ),
        };
        return;
      }
      const grant = {
        id: randomUUID(),
        repositoryId: repository.id,
        subjectType: subject.type,
        subjectId: subject.id,
        role,
        grantorId: viewer.id,
        createdAt: new Date().toISOString(),
      };
      state.repositoryGrants.push(grant);
      outcome = {
        ok: true,
        status: 201,
        grant: listGrants(state, repository).find(
          (candidate) => candidate.subjectType === subject.type && candidate.subjectId === subject.id,
        ),
      };
    });
    return outcome;
  }

  return { getRepositoryAccess, saveRepositoryAccess };
}
