import { relativeTime } from "../lib/relative-time";
import { repositoryCommitHref } from "../lib/repository-routes";
import type { RepositoryCommit } from "../lib/repositories-api";

export interface CommitListProps {
  owner: string;
  name: string;
  commits: RepositoryCommit[];
  /** Empty-state wording; defaults to a branch without commits. */
  emptyMessage?: string;
}

function shortId(commit: RepositoryCommit): string {
  return commit.shortId ?? commit.id.slice(0, 7);
}

/**
 * Commit history list in reverse chronological order: every item shows the
 * short hash, the commit message (both open the commit entry), the author, the
 * relative time and how many files the commit changed (REQ-4-2-1).
 */
export function CommitList({ owner, name, commits, emptyMessage }: CommitListProps) {
  if (commits.length === 0) {
    return (
      <p className="commit-list__empty">{emptyMessage ?? "This branch has no commits yet."}</p>
    );
  }
  return (
    <ol className="commit-list">
      {commits.map((commit) => {
        const href = repositoryCommitHref(owner, name, commit.id);
        const changed = commit.changedFiles?.length ?? 0;
        return (
          <li key={commit.id} className="commit-list__item">
            <p className="commit-list__message">
              <a href={href}>{commit.message}</a>
            </p>
            <p className="commit-list__meta">
              <a className="commit-list__hash" href={href}>
                {shortId(commit)}
              </a>
              <span className="commit-list__author">{commit.author}</span>
              <time className="commit-list__time" dateTime={commit.createdAt}>
                {relativeTime(commit.createdAt)}
              </time>
              {changed > 0 ? (
                <span className="commit-list__files">{changed} files changed</span>
              ) : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
