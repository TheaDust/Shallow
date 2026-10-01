import { apiRequest } from "./api";

/** Repository role keys, exactly the values accepted by the server. */
export type RepositoryRoleKey = "read" | "triage" | "write" | "maintain" | "admin";

export interface RepositoryRoleOption {
  value: RepositoryRoleKey;
  label: string;
}

/** The visible role names used by every Role control. */
export const REPOSITORY_ROLE_OPTIONS: readonly RepositoryRoleOption[] = [
  { value: "read", label: "Read" },
  { value: "triage", label: "Triage" },
  { value: "write", label: "Write" },
  { value: "maintain", label: "Maintain" },
  { value: "admin", label: "Admin" },
];

export function repositoryRoleLabel(role: string): string {
  return REPOSITORY_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

export type AccessSubjectType = "account" | "team";

export interface AccessGrant {
  id: string;
  subjectType: AccessSubjectType;
  subjectName: string;
  role: RepositoryRoleKey;
  grantedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RepositoryAccess {
  repository: {
    owner: string;
    name: string;
    ownerType: "organization" | "account";
    visibility: "public" | "private";
  };
  organization: { name: string; displayName: string } | null;
  grants: AccessGrant[];
  canManage: boolean;
}

export interface SaveRepositoryGrantInput {
  subjectType: AccessSubjectType;
  subjectName: string;
  role: string;
}

function repositoryPath(owner: string, name: string): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export async function fetchRepositoryAccess(
  owner: string,
  name: string,
): Promise<RepositoryAccess> {
  return apiRequest<RepositoryAccess>(`${repositoryPath(owner, name)}/access`);
}

/** Adds or replaces the single direct grant of the subject and returns the list. */
export async function saveRepositoryGrant(
  owner: string,
  name: string,
  input: SaveRepositoryGrantInput,
): Promise<AccessGrant[]> {
  const payload = await apiRequest<{ grants: AccessGrant[] }>(
    `${repositoryPath(owner, name)}/access`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return payload.grants;
}
