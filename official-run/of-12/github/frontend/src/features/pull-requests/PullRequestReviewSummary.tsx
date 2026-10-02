import { formatIssueTime } from "../issues/format-issue-time";
import { PULL_REQUEST_DECISION_LABELS, type PullRequestReview } from "./pull-request-api";

export interface PullRequestReviewSummaryProps {
  /** The stored review decisions of the pull request (REQ-6-3-4). */
  reviews: PullRequestReview[];
}

/**
 * The Review summary of a pull request (REQ-6-3-4, REQ-6-1).
 *
 * It lists the stored decisions of the current compare commit with the reviewer,
 * the status, the optional overall comment and the time; a decision recorded for
 * an older compare commit stays readable and is marked `Outdated` instead of
 * counting. The status itself is the strong text `Approved`, `Changes
 * requested` or `Commented`, so the review summary of Conversation and the one
 * next to the Files changed diff spell the same value.
 */
export function PullRequestReviewSummary({ reviews }: PullRequestReviewSummaryProps) {
  return (
    <section className="pull-request-review-summary-section" aria-label="Review summary">
      <h3 className="pull-request-review-summary__heading">Review summary</h3>
      {reviews.length > 0 ? (
        <ul className="pull-request-reviews">
          {reviews.map((review) => {
            const label = PULL_REQUEST_DECISION_LABELS[review.decision];
            return (
              <li key={review.id || `${review.reviewer}-${review.createdAt}`} className="pull-request-review">
                <span className="pull-request-review__reviewer">{review.reviewer}</span>
                <strong className="pull-request-review__decision" aria-label={label}>
                  {label}
                </strong>
                {review.summary ? (
                  <span className="pull-request-review__summary">{review.summary}</span>
                ) : null}
                <span className="pull-request-review__time">{formatIssueTime(review.createdAt)}</span>
                {review.stale ? <span className="pull-request-review__stale">Outdated</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="pull-request-review-summary__empty">No reviews yet.</p>
      )}
    </section>
  );
}
