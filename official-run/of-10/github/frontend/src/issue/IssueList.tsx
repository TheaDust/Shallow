import { issueDateTime } from "../lib/issue-dates";
import { repositoryIssueHref } from "../lib/repository-routes";
import { issueStatusLabel, type IssueSummary } from "../lib/issues-api";
import { IssueLabelBadge } from "./IssueLabelBadge";

export interface IssueListProps {
  owner: string;
  name: string;
  issues: readonly IssueSummary[];
}

/**
 * The rows of the Issues list page (REQ-5-1-1). Every row references one
 * persisted issue: its repository-scoped number, its title as a link, the
 * Open/Closed status, the labels of the current repository, the author and the
 * update time.
 */
export function IssueList({ owner, name, issues }: IssueListProps) {
  if (issues.length === 0) {
    return (
      <p className="issue-list__empty" role="status">
        No issues match the current filters.
      </p>
    );
  }

  return (
    <ul className="issue-list">
      {issues.map((issue) => {
        const href = repositoryIssueHref(owner, name, issue.number);
        return (
          <li key={issue.number} className="issue-list__row" data-status={issue.status}>
            <p className="issue-list__headline">
              <span className="issue-status" data-status={issue.status}>
                {issueStatusLabel(issue.status)}
              </span>
              <a className="issue-list__number" href={href}>
                #{issue.number}
              </a>
              {/* The accessible name of the title link is the exact title. */}
              <a className="issue-list__title" href={href}>
                {issue.title}
              </a>
            </p>
            <ul className="issue-list__labels">
              {issue.labels.map((label) => (
                <li key={label.id}>
                  <IssueLabelBadge label={label} />
                </li>
              ))}
            </ul>
            <p className="issue-list__meta">
              <span className="issue-list__author">{issue.author}</span>
              {" opened this issue · updated "}
              <time dateTime={issue.updatedAt}>{issueDateTime(issue.updatedAt)}</time>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
