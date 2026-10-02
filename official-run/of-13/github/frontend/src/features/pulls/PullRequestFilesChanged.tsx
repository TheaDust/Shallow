import { useState } from "react";

import { ApiError } from "../../lib/api";
import {
  addPullRequestComment,
  type PullRequestComment,
  type RepositoryPullRequestDetail,
} from "../../lib/pull-requests-api";
import type { DiffLine } from "../../lib/repository-code-api";
import { Button } from "../../ui";
import { useAccountSession } from "../account/AccountSession";
import { PullRequestReviewForm } from "./PullRequestReviewForm";
import { PullRequestReviewSummary } from "./PullRequestReviewSummary";

const MARKERS: Record<DiffLine["type"], string> = {
  add: "+",
  remove: "-",
  context: " ",
};

export interface PullRequestFilesChangedProps {
  owner: string;
  name: string;
  detail: RepositoryPullRequestDetail;
  /** The persisted detail payload of an accepted comment or review. */
  onUpdated: (detail: RepositoryPullRequestDetail) => void;
}

/** The changed line one inline comment is anchored to. */
interface CommentTarget {
  path: string;
  /** The 1-based position of the line inside the diff of that file. */
  line: number;
}

/** Groups the inline comments of the payload by their file and line. */
function commentsByAnchor(
  comments: PullRequestComment[],
): Map<string, PullRequestComment[]> {
  const grouped = new Map<string, PullRequestComment[]>();
  for (const comment of comments) {
    if (!comment.path || comment.line === null) continue;
    const key = `${comment.path}:${comment.line}`;
    grouped.set(key, [...(grouped.get(key) ?? []), comment]);
  }
  return grouped;
}

/**
 * The Files changed view of one pull request: the read-only diff of the current
 * base and compare commits with the aggregate summary, one expandable block per
 * changed file, the inline comment affordance of every changed line and the
 * `Review changes` entry of a Write reviewer who is not the author. The review
 * summary below that entry shows the stored status of the current compare
 * commit and every decision, so a submitted review is readable right where it
 * was submitted as well as in the Conversation.
 */
export function PullRequestFilesChanged({
  owner,
  name,
  detail,
  onUpdated,
}: PullRequestFilesChangedProps) {
  const { account } = useAccountSession();
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const { pullRequest, comparison } = detail;
  const anchored = commentsByAnchor(detail.comments);
  const isAuthor = account !== null && account.username === pullRequest.author;
  // Write, Maintain and Admin may anchor a comment; the review submission
  // additionally waits for an Open pull request and never belongs to its author.
  const canComment = detail.canWrite;
  const canReview = detail.canWrite && !isAuthor;
  const reviewable = pullRequest.status === "open";

  function openEditor(path: string, line: number): void {
    setTarget({ path, line });
    setBody("");
    setError(null);
  }

  async function publish(pending: boolean): Promise<void> {
    if (target === null) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await addPullRequestComment(owner, name, pullRequest.number, {
        body,
        path: target.path,
        line: target.line,
        pending,
      });
      onUpdated(updated);
      setTarget(null);
      setBody("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The comment was not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pull-request-detail__files" aria-label="Files changed">
      <h2 className="pull-request-detail__subheading">Changed files summary</h2>
      <p className="pull-request-files__summary">
        <span className="pull-request-files__count">{`${comparison.changedFileCount} changed files`}</span>
        <span className="pull-request-files__lines">{`${comparison.additions} additions, ${comparison.deletions} deletions`}</span>
      </p>
      {canReview ? (
        <p className="pull-request-files__review">
          <Button
            type="button"
            disabled={!reviewable}
            onClick={() => setReviewOpen((open) => !open)}
          >
            Review changes
          </Button>
        </p>
      ) : null}
      {reviewOpen && canReview ? (
        <PullRequestReviewForm
          owner={owner}
          name={name}
          number={pullRequest.number}
          onUpdated={onUpdated}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}
      {/* The stored decisions of the current compare commit, readable where the
          review was submitted. The container stays unnamed on purpose: the
          `Summary` field of the review form above shares this page, and a
          container name must never shadow that inner control name. */}
      <PullRequestReviewSummary detail={detail} label={null} />
      {comparison.files.length === 0 ? (
        <p className="pull-request-detail__empty" role="status">
          No changed files.
        </p>
      ) : (
        <ul className="pull-request-files__list">
          {comparison.files.map((file) => (
            <li key={file.path} className="pull-request-file">
              <details className="pull-request-file__details" open>
                <summary className="pull-request-file__summary">
                  <span className="pull-request-file__path">{file.path}</span>
                  <span className="pull-request-file__status">{file.status}</span>
                  <span className="pull-request-file__counts">{`+${file.additions} -${file.deletions}`}</span>
                </summary>
                <ol className="diff-lines">
                  {file.lines.map((line, index) => {
                    const lineNumber = index + 1;
                    const changed = line.type !== "context";
                    const lineComments = anchored.get(`${file.path}:${lineNumber}`) ?? [];
                    const editing = target?.path === file.path && target.line === lineNumber;
                    return (
                      <li key={lineNumber} className={`diff-line diff-line--${line.type}`}>
                        <span className="diff-line__marker">{MARKERS[line.type]}</span>
                        <span className="diff-line__text">{line.text}</span>
                        {changed && canComment ? (
                          <button
                            type="button"
                            className="diff-line__add"
                            aria-label="Add comment"
                            onClick={() => openEditor(file.path, lineNumber)}
                          >
                            +
                          </button>
                        ) : null}
                        {lineComments.length > 0 ? (
                          <ul className="diff-line__comments">
                            {lineComments.map((comment) => (
                              <li key={comment.id} className="pull-request-comment">
                                <p className="pull-request-comment__meta">
                                  <span className="pull-request-detail__comment-author">
                                    {comment.author ?? "Unknown author"}
                                  </span>
                                  {comment.pending ? (
                                    <span className="pull-request-comment__pending">
                                      Pending review
                                    </span>
                                  ) : null}
                                  {comment.outdated ? (
                                    <span className="pull-request-detail__outdated">Outdated</span>
                                  ) : null}
                                </p>
                                <p className="pull-request-detail__comment-body">{comment.body}</p>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {editing ? (
                          <form
                            className="diff-line__editor"
                            aria-label="Inline review comment"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void publish(false);
                            }}
                          >
                            <label htmlFor="pull-inline-comment">Comment</label>
                            <textarea
                              id="pull-inline-comment"
                              name="comment"
                              value={body}
                              onChange={(event) => setBody(event.target.value)}
                            />
                            <Button type="submit" disabled={saving}>
                              Add single comment
                            </Button>
                            <Button
                              type="button"
                              disabled={saving}
                              onClick={() => void publish(true)}
                            >
                              Start a review
                            </Button>
                            {error !== null ? (
                              <p className="diff-line__error" role="alert">
                                {error}
                              </p>
                            ) : null}
                          </form>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
