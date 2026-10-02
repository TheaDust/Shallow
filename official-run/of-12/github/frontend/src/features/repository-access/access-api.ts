import { apiRequest, mutateJson, type MutationOutcome } from "../../lib/api";
import type { RepositorySummary } from "../organizations/org-api";

/**
 * Typed client for the repository Manage-access page (REQ-2-3).
 *
 * The server owns the permission checks (an organization Owner or repository
 * Admin may grant), the candidate list and the single-grant-per-subject rule;
 * the page renders the returned state after every save.
 */

export type RepositoryRole = "Read" | "Triage" | "Write" | "Maintain" | "Admin";

export const REPOSITORY_ROLES: readonly RepositoryRole[] = [
  "Read",
  "Triage",
  "Write",
  "Maintain",
  "Admin",
];

export type AccessSubjectType = "account" | "team";

export interface AccessSubject {
  subjectType: AccessSubjectType;
  name: string;
}

export interface AccessGrant extends AccessSubject {
  role: RepositoryRole;
  grantor?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RepositoryAccessDetail {
  repository: RepositorySummary;
  /** The caller's effective repository role; Admin may manage access. */
  viewerRole: RepositoryRole | null;
  canManage: boolean;
  roles: RepositoryRole[];
  candidates: AccessSubject[];
  grants: AccessGrant[];
}

function accessPath(owner: string, name: string): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/access`;
}

export async function fetchRepositoryAccess(
  owner: string,
  name: string,
): Promise<RepositoryAccessDetail> {
  const payload = await apiRequest<RepositoryAccessDetail>(accessPath(owner, name));
  return {
    repository: payload.repository,
    viewerRole: payload.viewerRole ?? null,
    canManage: payload.canManage === true,
    roles: payload.roles ?? [...REPOSITORY_ROLES],
    candidates: payload.candidates ?? [],
    grants: payload.grants ?? [],
  };
}

/** Stores or replaces the single direct role grant of one subject. */
export async function saveRepositoryAccess(
  owner: string,
  name: string,
  input: { subjectType: AccessSubjectType; subject: string; role: RepositoryRole | string },
): Promise<MutationOutcome<RepositoryAccessDetail>> {
  return mutateJson<RepositoryAccessDetail>(accessPath(owner, name), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Matching members and teams, narrowed by the typed search text. */
export function filterCandidates(
  candidates: readonly AccessSubject[],
  search: string,
): AccessSubject[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...candidates];
  return candidates.filter((candidate) => candidate.name.toLowerCase().includes(needle));
}

export function subjectKey(subject: AccessSubject): string {
  return `${subject.subjectType}:${subject.name}`;
}
