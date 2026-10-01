import { pullHref } from "../repositories/repository-links";
import type { RepositorySummary } from "../repositories/repository-api";
import { PULL_REQUEST_STATUS_LABELS, type PullRequestSummary } from "./pull-request-api";

export interface PullRequestListProps {
  repository: RepositorySummary;
  pullRequests: PullRequestSummary[];
}

/**
 * The rows of the Pull requests page (REQ-6).
 *
 * Every row spells the repository-scoped number, the title as a link to the
 * pull request, the author, the target and source branches and the persisted
 * status. The number and the title are two links to the same address, so the
 * title link's accessible name is exactly the persisted title.
 */
export function PullRequestList({ repository, pullRequests }: PullRequestListProps) {
  return (
    <ul className="pull-request-list">
      {pullRequests.map((pullRequest) => (
        <li key={pullRequest.number} className="pull-request-row">
          <p className="pull-request-row__heading">
            <a className="pull-request-row__number" href={pullHref(repository, pullRequest.number)}>
              {`#${pullRequest.number}`}
            </a>
            <a className="pull-request-row__title" href={pullHref(repository, pullRequest.number)}>
              {pullRequest.title}
            </a>
          </p>
          <p className="pull-request-row__meta">
            <span className="pull-request-row__status">{PULL_REQUEST_STATUS_LABELS[pullRequest.status]}</span>
            <span className="pull-request-row__author">{pullRequest.author}</span>
            <span className="pull-request-row__branches">
              {`into ${pullRequest.baseBranch} from ${pullRequest.compareBranch}`}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
