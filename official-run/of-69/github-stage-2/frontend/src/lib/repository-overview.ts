import type { ForkedFrom, ReadmeFile, RepositoryCommit } from "./organization-api";
import { buildCodeModel, type RepositoryCodeModel, type RepositoryCodeSource } from "./repository-code";
import { repositoryUrl, type RepositoryOwnerRef } from "./routes";

export interface RepositoryOverviewModel {
  description: string;
  defaultBranch: string;
  updatedAt?: string;
  /** The Code page state: branch selector, directory entries and opened file. */
  code: RepositoryCodeModel;
  forkedFrom: { name: string; href: string } | null;
  cloneUrls: { https: string; ssh: string };
}

export interface RepositoryDetailLike extends RepositoryCodeSource {
  repository: {
    description: string;
    defaultBranch?: string | null;
    updatedAt?: string;
    forkedFrom?: ForkedFrom | null;
  };
  readme?: ReadmeFile | null;
  commits?: RepositoryCommit[] | null;
}

function cloneUrls(owner: RepositoryOwnerRef, repository: string): { https: string; ssh: string } {
  const origin = typeof window === "undefined" ? "https://example.test" : window.location.origin;
  const host = typeof window === "undefined" ? "example.test" : window.location.hostname;
  const path = `${owner.name}/${repository}.git`;
  return { https: `${origin}/${path}`, ssh: `git@${host}:${path}` };
}

/**
 * Normalizes an organization or personal repository detail payload into the
 * values the repository page renders: the Code page state (branch, directory
 * entries and the opened file), the commit history, the fork source link and
 * the read-only clone addresses.
 */
export function buildOverviewModel(
  owner: RepositoryOwnerRef,
  repository: string,
  detail: RepositoryDetailLike,
  search: URLSearchParams,
): RepositoryOverviewModel {
  return {
    description: detail.repository.description,
    defaultBranch: detail.repository.defaultBranch ?? "main",
    updatedAt: detail.repository.updatedAt,
    code: buildCodeModel(owner, repository, detail, {
      branch: search.get("branch") ?? undefined,
      path: search.get("path") ?? undefined,
      file: search.get("file") ?? undefined,
    }),
    forkedFrom: detail.repository.forkedFrom
      ? {
          name: detail.repository.forkedFrom.name,
          href: repositoryUrl(detail.repository.forkedFrom.owner, detail.repository.forkedFrom.name),
        }
      : null,
    cloneUrls: cloneUrls(owner, repository),
  };
}
