import { apiRequest } from "./api";
import type { RepositoryRole, RepositorySummary } from "./repositories-api";

/**
 * Repository access management (REQ-2-3). A grant names one subject — an
 * organization member or a team — and one role; the server stores exactly one
 * direct grant per subject and repository.
 */

export type RepositoryAccessSubjectType = "account" | "team";

export interface RepositoryAccessSubject {
  type: RepositoryAccessSubjectType;
  id: string;
  name: string;
}

export interface RepositoryAccessGrant {
  id: string;
  subjectType: RepositoryAccessSubjectType;
  subjectId: string;
  name: string;
  role: RepositoryRole;
  grantorId?: string | null;
  createdAt?: string | null;
}

export interface RepositoryAccessPayload {
  repository: RepositorySummary;
  viewer: { role: RepositoryRole | null; canAdminister: boolean };
  grants: RepositoryAccessGrant[];
  candidates: RepositoryAccessSubject[];
}

export interface SaveRepositoryAccessInput {
  subjectType: RepositoryAccessSubjectType;
  subjectId: string;
  role: RepositoryRole;
}

/** The role options the picker and each grant row expose, highest role last. */
export const REPOSITORY_ROLE_OPTIONS: ReadonlyArray<{ value: RepositoryRole; label: string }> = [
  { value: "read", label: "Read" },
  { value: "triage", label: "Triage" },
  { value: "write", label: "Write" },
  { value: "maintain", label: "Maintain" },
  { value: "admin", label: "Admin" },
];

export function repositoryRoleLabel(role: RepositoryRole | string): string {
  return REPOSITORY_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? String(role);
}

export function fetchRepositoryAccess(
  owner: string,
  name: string,
): Promise<RepositoryAccessPayload> {
  return apiRequest<RepositoryAccessPayload>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/access`,
  );
}

export async function saveRepositoryAccess(
  owner: string,
  name: string,
  input: SaveRepositoryAccessInput,
): Promise<RepositoryAccessGrant> {
  const payload = await apiRequest<{ grant: RepositoryAccessGrant }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/access`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.grant;
}
