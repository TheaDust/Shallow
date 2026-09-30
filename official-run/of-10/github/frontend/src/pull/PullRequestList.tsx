import { pullRequestStatusLabel, type PullRequestSummary } from "../lib/pull-requests-api";
import { repositoryPullRequestHref } from "../lib/repository-routes";
import { issueDateTime } from "../lib/issue-dates";

export interface PullRequestListProps {
  owner: string;
  name: string;
  pullRequests: readonly PullRequestSummary[];
}

/**
 * The rows of the Pull requests list page (REQ-6-2-1). Every row references one
 * stored proposal: its repository-scoped number, its title as a link, the
 * persisted status, the author, the compare (source) branch and the base
 * (target) branch.
 */
export function PullRequestList({ owner, name, pullRequests }: PullRequestListProps) {
  if (pullRequests.length === 0) {
    return (
      <p className="pull-list__empty" role="status">
        No pull requests match the current filters.
      </p>
    );
  }

  return (
    <ul className="pull-list">
      {pullRequests.map((pullRequest) => {
        const href = repositoryPullRequestHref(owner, name, pullRequest.number);
        return (
          <li key={pullRequest.number} className="pull-list__row" data-status={pullRequest.status}>
            <p className="pull-list__headline">
              <span className="pull-status" data-status={pullRequest.status}>
                {pullRequestStatusLabel(pullRequest.status)}
              </span>
              <a className="pull-list__number" href={href}>
                #{pullRequest.number}
              </a>
              {/* The accessible name of the title link is the exact title. */}
              <a className="pull-list__title" href={href}>
                {pullRequest.title}
              </a>
            </p>
            <p className="pull-list__meta">
              <span className="pull-list__author">{pullRequest.author}</span>
              {" wants to merge "}
              <span className="pull-list__compare">{pullRequest.compareBranch}</span>
              {" into "}
              <span className="pull-list__base">{pullRequest.baseBranch}</span>
              {" · opened "}
              <time dateTime={pullRequest.createdAt}>{issueDateTime(pullRequest.createdAt)}</time>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
