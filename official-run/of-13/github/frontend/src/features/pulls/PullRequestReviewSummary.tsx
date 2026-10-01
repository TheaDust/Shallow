import type { RepositoryPullRequestDetail } from "../../lib/pull-requests-api";
import {
  formatPullRequestTime,
  pullRequestReviewDecisionLabel,
  pullRequestReviewStatusLabel,
} from "./pull-format";

export interface PullRequestReviewSummaryProps {
  detail: RepositoryPullRequestDetail;
  /**
   * The accessible name of the summary container, `Review summary` by default.
   * `null` renders it as an unnamed container: on a page that also carries the
   * `Summary` field of the review form the container name must never shadow
   * that inner control name.
   */
  label?: string | null;
}

/**
 * The review summary of one pull request: the effective status of the current
 * compare commit followed by every stored decision with its reviewer, its
 * explanation and its time.
 *
 * The status is a live `status` region whose accessible name is exactly the
 * visible status text (`Approved`, `Changes requested` or `Review required`),
 * so a submitted review is announced and readable by its decision name. The
 * component reads the persisted detail payload of the pull request and never
 * writes anything, so Conversation and Files changed always show the same
 * stored decisions.
 */
export function PullRequestReviewSummary({
  detail,
  label = "Review summary",
}: PullRequestReviewSummaryProps) {
  const { pullRequest, reviews } = detail;
  const statusLabel = pullRequestReviewStatusLabel(pullRequest.reviewStatus);

  return (
    <section className="pull-request-detail__reviews" aria-label={label ?? undefined}>
      <h2 className="pull-request-detail__subheading">Review summary</h2>
      <p className="pull-request-detail__review-state" role="status" aria-label={statusLabel}>
        {statusLabel}
      </p>
      {reviews.length === 0 ? (
        <p className="pull-request-detail__empty" role="status">
          No reviews yet
        </p>
      ) : (
        <ul className="pull-request-detail__review-list">
          {reviews.map((review) => (
            <li key={review.id} className="pull-request-review">
              <p className="pull-request-review__meta">
                <span className="pull-request-detail__reviewer">
                  {review.reviewer ?? "Unknown reviewer"}
                </span>
                <span className="pull-request-detail__decision">
                  {pullRequestReviewDecisionLabel(review.decision)}
                </span>
                <time className="pull-request-detail__event-time" dateTime={review.createdAt}>
                  {formatPullRequestTime(review.createdAt)}
                </time>
                {review.stale ? (
                  <span className="pull-request-detail__stale">Stale</span>
                ) : null}
              </p>
              {review.body.length > 0 ? (
                <p className="pull-request-review__body">{review.body}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
