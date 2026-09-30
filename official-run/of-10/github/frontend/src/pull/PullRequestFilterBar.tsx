import {
  PULL_REQUEST_STATUSES,
  pullRequestStatusLabel,
  type ReviewStatus,
} from "../lib/pull-requests-api";
import {
  toPullRequestFilterQuery,
  type PullRequestFilterPatch,
  type PullRequestFilterValues,
} from "../lib/pull-request-filters";
import { repositoryPullRequestsHref, type PullRequestFilterQuery } from "../lib/repository-routes";

export interface PullRequestFilterBarProps {
  owner: string;
  name: string;
  filters: PullRequestFilterValues;
  onChange(patch: PullRequestFilterPatch): void;
}

const REVIEW_OPTIONS: ReadonlyArray<{ value: ReviewStatus | ""; label: string }> = [
  { value: "", label: "All review statuses" },
  { value: "review_required", label: "Review required" },
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes requested" },
];

/**
 * The filters of the Pull requests list page (REQ-6-2-1). Draft, Open, Closed
 * and Merged are links, not buttons or tabs: each one addresses the same list
 * with that status. The author field filters as the user types — no Enter and no
 * search button — and the review status selects one review state of the current
 * compare commit. Every filter only changes which rows are displayed and keeps
 * the pull requests, branches and reviews untouched.
 */
export function PullRequestFilterBar({
  owner,
  name,
  filters,
  onChange,
}: PullRequestFilterBarProps) {
  const hrefFor = (state: PullRequestFilterQuery["state"]) =>
    repositoryPullRequestsHref(owner, name, { ...toPullRequestFilterQuery(filters), state });

  return (
    <div className="pull-filters">
      <nav className="pull-filters__states" aria-label="Pull request status">
        {PULL_REQUEST_STATUSES.map((status) => (
          <a
            key={status}
            className="pull-filters__state"
            href={hrefFor(status)}
            aria-current={filters.status === status ? "page" : undefined}
          >
            {pullRequestStatusLabel(status)}
          </a>
        ))}
      </nav>

      <p className="pull-filters__field">
        <label className="pull-filters__label" htmlFor="pull-author-filter">
          Author
        </label>
        <input
          id="pull-author-filter"
          className="pull-filters__author"
          type="text"
          name="author"
          placeholder="Filter by author"
          autoComplete="off"
          value={filters.author}
          onChange={(event) => onChange({ author: event.target.value })}
        />
      </p>

      <p className="pull-filters__field">
        <label className="pull-filters__label" htmlFor="pull-review-filter">
          Review status
        </label>
        <select
          id="pull-review-filter"
          className="pull-filters__review"
          value={filters.review}
          onChange={(event) => onChange({ review: event.target.value as ReviewStatus | "" })}
        >
          {REVIEW_OPTIONS.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </p>
    </div>
  );
}
