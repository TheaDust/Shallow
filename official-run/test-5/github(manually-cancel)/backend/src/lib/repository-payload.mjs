import { DEFAULT_BRANCH } from "../domain/repositories.mjs";
import { commitsOf, entriesAtPath } from "./repository-content.mjs";

/**
 * Payloads of the repository resource (REQ-3-3 overview, REQ-3-2-1 creation). The
 * overview carries the identity, visibility, description, default branch and the
 * content entries of the default branch so a freshly created or seeded repository
 * is browsable from one response.
 */

export function repositorySummary(repository, ownerName) {
  return {
    id: repository.id,
    name: repository.name,
    ownerType: repository.ownerType === "account" ? "account" : "organization",
    ownerName,
    fullName: `${ownerName}/${repository.name}`,
    description: repository.description ?? "",
    visibility: repository.visibility === "private" ? "private" : "public",
    defaultBranch: repository.defaultBranch ?? DEFAULT_BRANCH,
    createdAt: repository.createdAt ?? null,
    updatedAt: repository.updatedAt ?? null,
  };
}

export function repositoryOverview(repository, ownerName, content) {
  const branch = repository.defaultBranch ?? DEFAULT_BRANCH;
  return {
    ...repositorySummary(repository, ownerName),
    files: entriesAtPath(content, repository.id, branch, ""),
    commitCount: commitsOf(content, repository.id, branch).length,
  };
}
