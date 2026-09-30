import type { RepositoryCommit } from "../lib/repositories-api";
import { repositoryCommitHref } from "../lib/repository-routes";
import { issueDateTime } from "../lib/issue-dates";

export interface PullRequestCommitsProps {
  owner: string;
  name: string;
  /** Commits reachable from the compare branch but not from the base branch. */
  commits: readonly RepositoryCommit[];
  commitCount: number;
}

/**
 * The Commits section of one pull request (REQ-6): the `Commit summary` of the
 * compare branch relative to the base branch and the commits themselves, each
 * one linking to its own stored diff. The summary and the list read the same
 * persisted comparison, so a reload never shows a different set of commits.
 */
export function PullRequestCommits({
  owner,
  name,
  commits,
  commitCount,
}: PullRequestCommitsProps) {
  return (
    <section className="pull-commits" aria-labelledby="pull-commits-heading">
      <h2 id="pull-commits-heading" className="pull-section-heading">
        Commits
      </h2>
      <div className="pull-commits__summary">
        <h3 className="pull-section-heading">Commit summary</h3>
        <p className="pull-commits__count">
          {commitCount === 1 ? "1 commit" : `${commitCount} commits`}
        </p>
      </div>
      {commits.length === 0 ? (
        <p className="pull-commits__empty">These branches have no comparable commits.</p>
      ) : (
        <ul className="pull-commits__list">
          {commits.map((commit) => (
            <li key={commit.id} className="pull-commit">
              <a className="pull-commit__message" href={repositoryCommitHref(owner, name, commit.id)}>
                {commit.message}
              </a>
              <span className="pull-commit__author">{commit.author}</span>
              <time className="pull-commit__time" dateTime={commit.createdAt}>
                {issueDateTime(commit.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
