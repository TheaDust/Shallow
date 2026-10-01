import type { RepositorySummary } from "../repositories/repository-api";
import { PULL_REQUEST_REVIEW_STATUS_LABELS, PULL_REQUEST_STATUS_LABELS } from "./pull-request-api";
import { pullRequestsHref } from "./pull-request-links";
import type { PullRequestFilters } from "./pull-request-filters";

export interface PullRequestFilterBarProps {
  repository: Pick<RepositorySummary, "owner" | "name">;
  /** The authors of the currently listed pull requests. */
  authors: string[];
  /** False while the rows are still being read. */
  ready: boolean;
  filters: PullRequestFilters;
  onChange(filters: PullRequestFilters): void;
}

/** The status entries of the filter, in the order Draft, Open, Closed, Merged. */
const STATUS_ORDER = ["draft", "open", "closed", "merged"] as const;

/**
 * The filter bar of the Pull requests list page (REQ-6-2-1).
 *
 * Draft, Open, Closed and Merged are links — never buttons — that carry the
 * whole filter context, so the selected status survives a reload and can be
 * reopened from the address. Selecting the active status again clears it. The
 * author and the review status are native selects; filtering only narrows the
 * displayed rows and changes no pull request, branch or review.
 */
export function PullRequestFilterBar({
  repository,
  authors,
  ready,
  filters,
  onChange,
}: PullRequestFilterBarProps) {
  const statusLink = (status: (typeof STATUS_ORDER)[number], text: string) => (
    <a
      className="pull-request-filters__status"
      href={pullRequestsHref(repository, {
        ...filters,
        status: filters.status === status ? "" : status,
      })}
      aria-current={filters.status === status ? "page" : undefined}
    >
      {text}
    </a>
  );

  return (
    <div className="pull-request-filters">
      <div className="pull-request-filters__statuses">
        {STATUS_ORDER.map((status) => statusLink(status, PULL_REQUEST_STATUS_LABELS[status]))}
      </div>
      <div className="pull-request-filters__field">
        <label className="pull-request-filters__label" htmlFor="pull-request-author-filter">
          Author
        </label>
        <select
          id="pull-request-author-filter"
          className="pull-request-filters__select"
          value={filters.author}
          disabled={!ready}
          onChange={(event) => onChange({ ...filters, author: event.target.value })}
        >
          <option value="">All authors</option>
          {authors.map((author) => (
            <option key={author} value={author}>
              {author}
            </option>
          ))}
        </select>
      </div>
      <div className="pull-request-filters__field">
        <label className="pull-request-filters__label" htmlFor="pull-request-review-filter">
          Review status
        </label>
        <select
          id="pull-request-review-filter"
          className="pull-request-filters__select"
          value={filters.review}
          disabled={!ready}
          onChange={(event) => onChange({ ...filters, review: event.target.value as PullRequestFilters["review"] })}
        >
          <option value="">All reviews</option>
          <option value="review_required">{PULL_REQUEST_REVIEW_STATUS_LABELS.review_required}</option>
          <option value="approved">{PULL_REQUEST_REVIEW_STATUS_LABELS.approved}</option>
          <option value="changes_requested">{PULL_REQUEST_REVIEW_STATUS_LABELS.changes_requested}</option>
        </select>
      </div>
    </div>
  );
}
