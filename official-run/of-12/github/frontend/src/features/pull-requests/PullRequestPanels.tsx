import { commitHref } from "../repositories/repository-links";
import { formatCommitTime, shortCommitId } from "../repositories/format-commit";
import type { RepositorySummary } from "../repositories/repository-api";
import type { PullRequestDetail } from "./pull-request-api";

export interface PullRequestCommitsProps {
  repository: RepositorySummary;
  pullRequest: PullRequestDetail;
}

/**
 * The Commits section of a pull request (REQ-6-3-1): the `Commit summary` of the
 * commits the compare branch carries relative to the base revision, newest
 * first. A commit the base revision already reaches is not part of the proposal
 * and is not listed.
 */
export function PullRequestCommits({ repository, pullRequest }: PullRequestCommitsProps) {
  const { commits } = pullRequest;
  return (
    <section className="pull-request-commits" aria-label="Pull request commits">
      <p className="pull-request-commits__summary">
        <span className="pull-request-commits__label">Commit summary</span>
        <span className="pull-request-commits__count">
          {commits.length === 1 ? "1 commit" : `${commits.length} commits`}
        </span>
      </p>
      {commits.length > 0 ? (
        <ul className="pull-request-commits__list">
          {commits.map((commit) => (
            <li key={commit.id} className="pull-request-commit">
              <a className="pull-request-commit__message" href={commitHref(repository, commit.id)}>
                {commit.message}
              </a>
              <span className="pull-request-commit__author">{commit.author}</span>
              <time className="pull-request-commit__time" dateTime={commit.createdAt ?? undefined}>
                {formatCommitTime(commit.createdAt)}
              </time>
              <span className="pull-request-commit__id">{shortCommitId(commit.id)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pull-request-commits__empty">This pull request adds no commit to the base branch.</p>
      )}
    </section>
  );
}
