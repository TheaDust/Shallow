import { apiRequest } from "./api";
import type { RepositoryContext, RepositoryFile } from "./repositories-api";

/**
 * Write calls of the code and version-control pages (REQ-4-3, REQ-4-4). Every
 * one is checked again on the server against the current session and the target
 * object, so a hidden or disabled entry is never the only protection.
 */

export interface CreateBranchInput {
  name: string;
  /** Base branch or commit; the current branch head when omitted. */
  baseBranch?: string;
}

export interface CreatedBranch {
  name: string;
  headCommitId: string | null;
  baseRef: string;
  baseCommitId: string;
  createdBy: string | null;
  createdAt: string;
}

export interface CreateBranchPayload {
  repository: RepositoryContext;
  branch: CreatedBranch;
}

export interface CommitFileInput {
  branch: string;
  path: string;
  content: string;
  message: string;
  /** Original path of an edited file, so a renamed file is recorded as a move. */
  previousPath?: string;
}

export interface CommitFilePayload {
  repository: RepositoryContext;
  file: RepositoryFile;
  commit: {
    id: string;
    message: string;
    author: string;
    createdAt: string;
    parentId: string | null;
    branch: string;
  };
}

/** Creates one named reference at a base commit (REQ-4-3-2). */
export async function createRepositoryBranch(
  owner: string,
  name: string,
  input: CreateBranchInput,
): Promise<CreateBranchPayload> {
  return apiRequest<CreateBranchPayload>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Points the repository default branch at another existing branch (REQ-4-3-3). */
export async function updateRepositoryDefaultBranch(
  owner: string,
  name: string,
  branch: string,
): Promise<RepositoryContext> {
  const payload = await apiRequest<{ repository: RepositoryContext }>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/default-branch`,
    { method: "POST", body: JSON.stringify({ branch }) },
  );
  return payload.repository;
}

/** Stores one file change as a single commit on the branch (REQ-4-4). */
export function commitRepositoryFile(
  owner: string,
  name: string,
  input: CommitFileInput,
): Promise<CommitFilePayload> {
  return apiRequest<CommitFilePayload>(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
