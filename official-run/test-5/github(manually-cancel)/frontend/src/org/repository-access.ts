import type { AccessSubject, RepositoryRole } from "./types";

/**
 * Shared constants of the repository-access picker (REQ-2-3). The role labels are
 * the exact names the requirements use; team hierarchy never propagates access.
 */
export const REPOSITORY_ROLE_OPTIONS: ReadonlyArray<{ value: RepositoryRole; label: string }> = [
  { value: "read", label: "Read" },
  { value: "triage", label: "Triage" },
  { value: "write", label: "Write" },
  { value: "maintain", label: "Maintain" },
  { value: "admin", label: "Admin" },
];

export function repositoryRoleLabel(role: RepositoryRole): string {
  return REPOSITORY_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

/** Matching is local and immediate: no submit action is needed before selecting. */
export function matchesAccessSubject(subject: AccessSubject, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return subject.name.toLowerCase().includes(needle);
}
