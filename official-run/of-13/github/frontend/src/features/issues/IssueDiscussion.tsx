import type { IssueComment, IssueReactionType } from "../../lib/issues-api";
import { IssueCommentForm } from "./IssueCommentForm";
import { IssueReactionBar } from "./IssueReactionBar";
import { formatIssueTime } from "./issue-format";

export interface IssueDiscussionProps {
  comments: readonly IssueComment[];
  /** Write, Maintain and Admin may append a comment to the discussion. */
  canWrite: boolean;
  /** Every signed-in reader who can view the issue may react. */
  canReact: boolean;
  onSubmitComment(body: string): Promise<string | null>;
  onToggleReaction(reaction: IssueReactionType, commentId: string): void;
}

/**
 * The discussion of one issue: every stored comment as its own article with its
 * author, body, time and reactions, and the comment editor for a viewer with
 * Write permission. Neither a refused submission nor a reaction toggle adds an
 * entry on the client alone: the page always answers with the persisted
 * discussion.
 */
export function IssueDiscussion({
  comments,
  canWrite,
  canReact,
  onSubmitComment,
  onToggleReaction,
}: IssueDiscussionProps) {
  return (
    <section className="issue-detail__comments" aria-labelledby="issue-comments-title">
      <h2 id="issue-comments-title">Comments</h2>
      {comments.length === 0 ? (
        <p className="issue-detail__empty" role="status">
          No comments yet
        </p>
      ) : (
        <ul className="issue-detail__comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className="issue-comment">
              <article className="issue-comment__body">
                <p className="issue-comment__head">
                  <span className="issue-comment__author">{comment.author ?? "Unknown author"}</span>
                  <time className="issue-comment__time" dateTime={comment.createdAt}>
                    {formatIssueTime(comment.createdAt)}
                  </time>
                </p>
                <p className="issue-comment__text">{comment.body}</p>
                <IssueReactionBar
                  target="comment"
                  reactions={comment.reactions ?? []}
                  canReact={canReact}
                  onToggle={(reaction) => onToggleReaction(reaction, comment.id)}
                />
              </article>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? <IssueCommentForm onSubmit={onSubmitComment} /> : null}
    </section>
  );
}
