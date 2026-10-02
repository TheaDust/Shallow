import type { RepositoryVisibility } from "../organizations/types";

/** A repository is owned by an individual account or by an organization. */
export type RepositoryOwnerKind = "organization" | "account";

export interface RepositoryOwner {
  kind: RepositoryOwnerKind;
  /** Display name: the organization name or the account username. */
  name: string;
  /** URL identifier: the organization slug or the account username. */
  slug: string;
}

export interface RepositoryFileEntry {
  kind: "file" | "directory";
  name: string;
  path: string;
}

export interface RepositoryCommitSummary {
  id: string;
  message: string;
  authorName: string;
  committedAt: string;
}

/** Overview payload of one repository (organization or personal). */
export interface RepositoryView {
  id: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  defaultBranch: string;
  /** Branch whose snapshot the Code page is currently browsing. */
  branch: string;
  /** Every stored branch name, default branch first. */
  branches: string[];
  updatedAt: string;
  createdAt?: string;
  owner: RepositoryOwner;
  /** Only an owner or a repository Admin reaches the Settings area. */
  canManage: boolean;
  /** Whether the account may create branches and commits on this repository. */
  canWrite: boolean;
  forkSource: { owner: RepositoryOwner; name: string } | null;
  files: RepositoryFileEntry[];
  latestCommit: RepositoryCommitSummary | null;
  commitCount: number;
}

/** One repository entry of an owner's repository list. */
export interface RepositoryListItem {
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  defaultBranch: string;
  updatedAt: string;
  createdAt?: string;
  owner: RepositoryOwner;
}

export interface RepositoryOwnerList {
  owner: RepositoryOwner;
  repositories: RepositoryListItem[];
}

/** One selectable owner namespace of the creation and fork forms. */
export interface RepositoryNamespace {
  kind: RepositoryOwnerKind;
  /** Organization slug or account username. */
  id: string;
  /** Visible option text: the organization name or the username. */
  label: string;
}

export interface CreateRepositoryInput {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  description?: string;
  visibility: RepositoryVisibility;
  initializeWithReadme?: boolean;
}

export interface ForkRepositoryInput {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  visibility: RepositoryVisibility;
}

export interface RepositoryFileContent {
  name: string;
  path: string;
  branch: string;
  content: string;
  repository: string;
  owner: RepositoryOwner;
}

/** Submitted file change of the new-file editor: one new commit on one branch. */
export interface CreateRepositoryFileInput {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  branch: string;
  path: string;
  content: string;
  message: string;
}

/** One entry of a directory listing at the current path on the current branch. */
export interface RepositoryDirectoryEntry {
  kind: "file" | "directory";
  name: string;
  path: string;
}

/** Directory listing payload: the repository, branch and current path context. */
export interface RepositoryDirectory {
  repository: string;
  owner: RepositoryOwner;
  branch: string;
  path: string;
  entries: RepositoryDirectoryEntry[];
}

/** One immutable commit record of a branch or file path. */
export interface RepositoryCommitRecord {
  id: string;
  shortId: string;
  message: string;
  authorName: string;
  committedAt: string;
  parentId: string | null;
  additions: number;
  deletions: number;
  changedFiles: string[];
}

/** Commit history payload of one branch (optionally of one file path). */
export interface RepositoryCommitHistory {
  repository: string;
  owner: RepositoryOwner;
  branch: string;
  path: string;
  commits: RepositoryCommitRecord[];
}

/** One line of a line-by-line comparison. */
export interface RepositoryDiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

/** Changed file of one commit with its numeric additions and deletions. */
export interface RepositoryCommitFile {
  path: string;
  additions: number;
  deletions: number;
  lines: RepositoryDiffLine[];
}

/** Comparison payload of one commit against its parent revision. */
export interface RepositoryCommitDetail extends RepositoryCommitRecord {
  repository: string;
  owner: RepositoryOwner;
  branch: string;
  files: RepositoryCommitFile[];
}

/** One matching file of a repository code search with its matching lines. */
export interface RepositoryCodeSearchMatch {
  path: string;
  name: string;
  lines: { number: number; text: string }[];
}

/** Code search payload of the current repository and branch. */
export interface RepositoryCodeSearch {
  repository: string;
  owner: RepositoryOwner;
  branch: string;
  query: string;
  total: number;
  results: RepositoryCodeSearchMatch[];
}
