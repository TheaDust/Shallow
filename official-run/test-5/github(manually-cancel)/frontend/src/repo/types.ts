/**
 * Shared payload types of the repository module (REQ-3): the repository resource,
 * its content and the creation form. The organization module re-exports the
 * repository payload types from here, so both modules describe one model.
 */

export type RepositoryVisibility = "public" | "private";
export type RepositoryOwnerType = "account" | "organization";

export interface RepositorySummary {
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  updatedAt: string | null;
  ownerName?: string;
  fullName?: string;
}

/** One entry of the file list on the default branch: a file or a directory. */
export interface RepositoryFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface RepositoryDetail extends RepositorySummary {
  id?: string;
  ownerType?: RepositoryOwnerType;
  createdAt: string | null;
  defaultBranch: string | null;
  ownerName: string;
  fullName: string;
  files?: RepositoryFileEntry[];
  commitCount?: number;
}

export interface RepositoryCommit {
  id: string;
  message: string;
  authorName: string;
  createdAt: string | null;
  changedPaths?: string[];
}

export interface RepositoryFileContent {
  name: string;
  path: string;
  branch: string;
  content: string;
  updatedAt: string | null;
}

/** A namespace the creation form may submit to: the account itself or an organization. */
export interface RepositoryOwnerOption {
  id: string;
  type: RepositoryOwnerType;
  name: string;
  label: string;
}

/** Values of the “New repository” form. */
export interface RepositoryFormValues {
  ownerType: RepositoryOwnerType;
  ownerName: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  initialize: boolean;
}

export interface RepositoryFormErrors {
  owner?: string;
  name?: string;
  description?: string;
  visibility?: string;
}

/** The two protocols of the clone popover (REQ-3-2-3). */
export type CloneProtocol = "https" | "ssh";
