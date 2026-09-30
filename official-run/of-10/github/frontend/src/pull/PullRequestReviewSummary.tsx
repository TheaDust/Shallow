import { issueDateTime } from "../lib/issue-dates";
import type { PullRequestReview } from "../lib/pull-requests-api";

export interface PullRequestReviewSummaryProps {
  reviews: readonly PullRequestReview[];
}

/**
 * The review summary of one pull request (REQ-6-3-4) on the right side of the
 * detail page: every stored decision with its reviewer, its status (`Approved`,
 * `Changes requested` or `Commented`), its explanation and the time. A decision
 * submitted for an earlier compare commit is kept but marked stale, so the
 * summary always describes the comparison the page currently shows. The heading
 * names the area without carrying an accessible name of its own, so the
 * `Summary` field of the review form stays the only control labelled `Summary`.
 */
export function PullRequestReviewSummary({ reviews }: PullRequestReviewSummaryProps) {
  return (
    <section className="pull-review-summary" aria-labelledby="pull-review-summary-heading">
      <h3 id="pull-review-summary-heading" className="pull-section-heading">
        Review summary
      </h3>
      {reviews.length === 0 ? (
        <p className="pull-review-summary__empty">No reviews yet.</p>
      ) : (
        <ul className="pull-review-summary__list">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="pull-review-summary__item"
              data-decision={review.decision}
            >
              <p className="pull-review-summary__meta">
                <span className="pull-review-summary__reviewer">{review.reviewer}</span>
                {" "}
                <span className="pull-review-summary__status">{review.decisionLabel}</span>
                {review.commitShortId ? ` on ${review.commitShortId}` : ""}
                {review.stale ? " (stale)" : ""}
                {" · "}
                <time dateTime={review.createdAt}>{issueDateTime(review.createdAt)}</time>
              </p>
              {review.body ? <p className="pull-review-summary__body">{review.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
