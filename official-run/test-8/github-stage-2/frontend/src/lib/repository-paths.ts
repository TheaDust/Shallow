/**
 * Hash-URL builders for the code views (repository tree, file, history, commit,
 * code search). They live in one place so a link never disagrees with the route
 * matcher in `routes.ts` about the shape of a repository URL.
 */

function owner(ownerLogin: string): string {
  return encodeURIComponent(ownerLogin);
}

function repository(repositoryName: string): string {
  return encodeURIComponent(repositoryName);
}

function branchSegment(branch: string): string {
  return encodeURIComponent(branch);
}

function pathSegments(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function repositoryPath(ownerLogin: string, repositoryName: string): string {
  return `/repositories/${owner(ownerLogin)}/${repository(repositoryName)}`;
}

/** Directory listing of one branch; an empty path is the repository root. */
export function treePath(ownerLogin: string, repositoryName: string, branch: string, path = ""): string {
  const base = `${repositoryPath(ownerLogin, repositoryName)}/tree/${branchSegment(branch)}`;
  return path ? `${base}/${pathSegments(path)}` : base;
}

/** Read-only page of one file of a branch. */
export function blobPath(ownerLogin: string, repositoryName: string, branch: string, path: string): string {
  return `${repositoryPath(ownerLogin, repositoryName)}/blob/${branchSegment(branch)}/${pathSegments(path)}`;
}

/** Web editor that adds a new file to one branch (REQ-4-4). */
export function newFilePath(ownerLogin: string, repositoryName: string, branch: string): string {
  return `${repositoryPath(ownerLogin, repositoryName)}/new/${branchSegment(branch)}`;
}

/** Repository Settings → Branches (REQ-4-3-3). */
export function settingsBranchesPath(ownerLogin: string, repositoryName: string): string {
  return `${repositoryPath(ownerLogin, repositoryName)}/settings/branches`;
}

/** Commit history of a branch, optionally narrowed to one file path. */
export function commitsPath(ownerLogin: string, repositoryName: string, branch: string, path = ""): string {
  const base = `${repositoryPath(ownerLogin, repositoryName)}/commits/${branchSegment(branch)}`;
  return path ? `${base}/${pathSegments(path)}` : base;
}

export function commitPath(ownerLogin: string, repositoryName: string, commitId: string): string {
  return `${repositoryPath(ownerLogin, repositoryName)}/commit/${encodeURIComponent(commitId)}`;
}

export function codeSearchPath(ownerLogin: string, repositoryName: string): string {
  return `${repositoryPath(ownerLogin, repositoryName)}/search`;
}

/** The file name of a repository path ("src/README.md" → "README.md"). */
export function fileNameOf(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/** The directory part of a repository path ("src/README.md" → "src"). */
export function directoryOf(path: string): string {
  return path.split("/").filter(Boolean).slice(0, -1).join("/");
}

/** The path segments of a repository path, used by breadcrumbs. */
export function pathSegmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}
