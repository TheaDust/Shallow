import type { RepositoryPullRequestDetail } from "../../lib/pull-requests-api";
import { repositoryCommitHref } from "../../lib/repository-code-api";
import { formatPullRequestTime } from "./pull-format";

export interface PullRequestCommitsProps {
  owner: string;
  name: string;
  detail: RepositoryPullRequestDetail;
}

/**
 * The Commits view of one pull request: the commit summary of the commits the
 * compare branch carries relative to the base branch. It reads the recorded
 * comparison of the same persisted record as every other tab and never creates
 * a commit.
 */
export function PullRequestCommits({ owner, name, detail }: PullRequestCommitsProps) {
  const { pullRequest, comparison } = detail;

  return (
    <section className="pull-request-detail__commits" aria-label="Commits">
      <h2 className="pull-request-detail__subheading">Commit summary</h2>
      <p className="pull-request-detail__commit-count">
        {`${comparison.commitCount} ${
          comparison.commitCount === 1 ? "commit" : "commits"
        } on ${pullRequest.sourceBranch}`}
      </p>
      {comparison.commits.length === 0 ? (
        <p className="pull-request-detail__empty" role="status">
          No commits to show
        </p>
      ) : (
        <ul className="pull-request-detail__commit-list">
          {comparison.commits.map((commit) => (
            <li key={commit.id} className="pull-request-commit">
              <a
                className="pull-request-commit__sha"
                href={repositoryCommitHref(owner, name, commit.sha)}
              >
                {commit.shortSha ?? commit.sha}
              </a>
              <span className="pull-request-detail__message">{commit.message}</span>
              <span className="pull-request-detail__commit-author">
                {commit.author ?? "Unknown author"}
              </span>
              <time className="pull-request-detail__event-time" dateTime={commit.createdAt}>
                {formatPullRequestTime(commit.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
