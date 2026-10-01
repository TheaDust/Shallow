import { ApiError, apiRequest } from "./api";
import type { RepositoryVisibility } from "./organizations-api";

/** The `owner/name` address of the repository a fork was copied from. */
export interface RepositorySource {
  owner: string;
  name: string;
}

/** A repository record as the API returns it after creation or forking. */
export interface RepositoryRecord {
  id?: string;
  owner: string;
  ownerType?: "account" | "organization";
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  defaultBranch?: string | null;
  createdBy?: string | null;
  updatedAt?: string;
  source?: RepositorySource | null;
}

export interface CreateRepositoryInput {
  owner: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  initializeReadme: boolean;
}

export interface ForkRepositoryInput {
  owner: string;
  name: string;
  visibility: RepositoryVisibility;
}

export async function createRepository(
  input: CreateRepositoryInput,
): Promise<RepositoryRecord> {
  const payload = await apiRequest<{ repository: RepositoryRecord }>("/api/repositories", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.repository;
}

export async function forkRepository(
  sourceOwner: string,
  sourceName: string,
  input: ForkRepositoryInput,
): Promise<RepositoryRecord> {
  const payload = await apiRequest<{ repository: RepositoryRecord }>(
    `/api/repositories/${encodeURIComponent(sourceOwner)}/${encodeURIComponent(sourceName)}/forks`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.repository;
}

export interface ChangeRepositoryVisibilityInput {
  visibility: RepositoryVisibility;
  /**
   * Optional confirmation text. The change never requires retyping the
   * repository name, but a present value that does not match is refused.
   */
  confirmation?: string;
}

/**
 * Switches a repository between Public and Private. Only a repository Admin
 * may do this; the server re-checks the permission and the optional
 * confirmation text.
 */
export async function changeRepositoryVisibility(
  owner: string,
  name: string,
  input: ChangeRepositoryVisibilityInput,
): Promise<RepositoryRecord> {
  const payload = await apiRequest<{ repository: RepositoryRecord }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/visibility`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.repository;
}

/** The signed-in account's personal repositories. */
export async function listMyRepositories(): Promise<RepositoryRecord[]> {
  const payload = await apiRequest<{ repositories: RepositoryRecord[] }>("/api/repositories");
  return payload.repositories;
}

/** The per-field validation reasons a rejected write returned. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const fieldErrors = (error.body as { fieldErrors?: unknown }).fieldErrors;
    if (fieldErrors && typeof fieldErrors === "object") {
      return fieldErrors as Record<string, string>;
    }
  }
  return {};
}

/** The read-only clone address shown in the repository Code popover. */
export function cloneValues(owner: string, name: string): { https: string; ssh: string } {
  const path = `${owner}/${name}`;
  return {
    https: `https://github.com/${path}.git`,
    ssh: `git@github.com:${path}.git`,
  };
}
