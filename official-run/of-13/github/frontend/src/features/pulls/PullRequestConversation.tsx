import type {
  PullRequestComment,
  RepositoryPullRequestDetail,
} from "../../lib/pull-requests-api";
import { describePullRequestEvent, formatPullRequestTime } from "./pull-format";
import { PullRequestReviewSummary } from "./PullRequestReviewSummary";

export interface PullRequestConversationProps {
  detail: RepositoryPullRequestDetail;
}

/** The code location of one inline comment, or `null` for a discussion one. */
function commentAnchor(comment: PullRequestComment): string | null {
  if (!comment.path) return null;
  return comment.line === null ? comment.path : `${comment.path}:${comment.line}`;
}

/**
 * The Conversation view of one pull request: the author's description, the
 * ordinary and inline comments of the discussion, the review summary of the
 * current compare commit and the append-only status timeline. Every value comes
 * from the same persisted detail payload, so the view itself writes nothing.
 */
export function PullRequestConversation({ detail }: PullRequestConversationProps) {
  const { pullRequest, comments, events } = detail;

  return (
    <section className="pull-request-detail__conversation" aria-label="Conversation">
      <p className="pull-request-detail__description">
        {pullRequest.description.length > 0
          ? pullRequest.description
          : "No description provided."}
      </p>
      <PullRequestReviewSummary detail={detail} />
      <section className="pull-request-detail__comments" aria-label="Comments">
        <h2 className="pull-request-detail__subheading">Comments</h2>
        {comments.length === 0 ? (
          <p className="pull-request-detail__empty" role="status">
            No comments yet
          </p>
        ) : (
          <ul className="pull-request-detail__comment-list">
            {comments.map((comment) => {
              const anchor = commentAnchor(comment);
              return (
                <li key={comment.id} className="pull-request-comment">
                  <p className="pull-request-comment__meta">
                    <span className="pull-request-detail__comment-author">
                      {comment.author ?? "Unknown author"}
                    </span>
                    {anchor ? (
                      <span className="pull-request-comment__anchor">{anchor}</span>
                    ) : null}
                    <time className="pull-request-detail__event-time" dateTime={comment.createdAt}>
                      {formatPullRequestTime(comment.createdAt)}
                    </time>
                  </p>
                  <p className="pull-request-detail__comment-body">{comment.body}</p>
                  {comment.pending ? (
                    <p className="pull-request-comment__pending">Pending review</p>
                  ) : null}
                  {comment.outdated ? (
                    <p className="pull-request-detail__outdated">Outdated</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="pull-request-detail__activity" aria-label="Activity">
        <h2 className="pull-request-detail__subheading">Activity</h2>
        <ul className="pull-request-detail__event-list">
          {events.map((event) => (
            <li key={event.id}>
              <span className="pull-request-detail__actor">{event.actor ?? "Unknown actor"}</span>
              <span className="pull-request-detail__event">
                {describePullRequestEvent(event)}
              </span>
              <time className="pull-request-detail__event-time" dateTime={event.createdAt}>
                {formatPullRequestTime(event.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
