import { useState } from "react";

import { PullRequestDiff, type CommentTarget } from "./PullRequestDiff";
import { PullRequestReviewForm } from "./PullRequestReviewForm";
import type {
  PullRequestDecision,
  PullRequestDetail,
  PullRequestReviewComment,
} from "./pull-request-api";

export interface PullRequestReviewWriteResult {
  ok: boolean;
  message?: string;
}

export interface PullRequestFilesProps {
  pullRequest: PullRequestDetail;
  /** Stores one inline review comment of the current compare commit. */
  onComment(input: {
    filePath: string;
    line: number;
    side: CommentTarget["side"];
    body: string;
    pending: boolean;
  }): Promise<PullRequestReviewWriteResult>;
  /** Stores one review decision of the current compare commit. */
  onReview(input: {
    decision: PullRequestDecision;
    summary: string;
  }): Promise<PullRequestReviewWriteResult>;
}

/** The inline comments anchored to a file of the current diff. */
function commentsOf(
  comments: PullRequestReviewComment[],
  filePath: string,
): PullRequestReviewComment[] {
  return comments.filter((comment) => comment.filePath === filePath);
}

/**
 * The Files changed view of a pull request (REQ-6-3-2, REQ-6-3-3, REQ-6-3-4).
 *
 * It reads the current diff of the base and compare commits and spells the
 * aggregate statistics as `<addition count> additions, <deletion count>
 * deletions` next to the number of changed files. Every changed file shows its
 * path, its added and deleted lines and the inline comments anchored to them;
 * a reviewer who may comment activates one `Add comment` button, which opens
 * the single editor with the `Comment` field and the `Add single comment` and
 * `Start a review` buttons, and the `Review changes` entry opens the review
 * form. Reading or commenting here changes no file, commit, branch or review
 * decision other than the record the server stores.
 */
export function PullRequestFiles({ pullRequest, onComment, onReview }: PullRequestFilesProps) {
  const { files, summary, reviewComments, permissions } = pullRequest;
  const [editor, setEditor] = useState<CommentTarget | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewWorking, setReviewWorking] = useState(false);

  const knownPaths = new Set(files.map((file) => file.path));
  const orphanComments = reviewComments.filter((comment) => !knownPaths.has(comment.filePath));

  function openEditor(target: CommentTarget) {
    setEditor(target);
    setBody("");
    setError(null);
  }

  async function submit(pending: boolean) {
    if (!editor) return;
    const text = body.trim();
    if (!text) {
      setError("Comment is required");
      return;
    }
    setWorking(true);
    setError(null);
    const result = await onComment({
      filePath: editor.filePath,
      line: editor.line,
      side: editor.side,
      body: text,
      pending,
    });
    setWorking(false);
    if (!result.ok) {
      setError(result.message ?? "The comment could not be saved");
      return;
    }
    setEditor(null);
    setBody("");
  }

  async function submitReview(input: { decision: PullRequestDecision; summary: string }) {
    setReviewWorking(true);    setReviewError(null);
    const result = await onReview(input);
    setReviewWorking(false);
    if (!result.ok) setReviewError(result.message ?? "The review could not be saved");
  }

  return (
    <section className="pull-request-files" aria-label="Pull request files changed">
      <p className="pull-request-files__summary">
        <span className="pull-request-files__count">{`${summary.filesChanged} changed files`}</span>
        {/* The aggregate the requirement spells: `<addition count> additions,
            <deletion count> deletions`. Its own element carries the visible
            text and the same string as its accessible name. */}
        <span
          className="pull-request-files__totals"
          aria-label={`${summary.additions} additions, ${summary.deletions} deletions`}
        >
          {`${summary.additions} additions, ${summary.deletions} deletions`}
        </span>
      </p>
      {files.length > 0 ? (
        files.map((file) => {
          const attached = commentsOf(reviewComments, file.path);
          const lineExists = (comment: PullRequestReviewComment) =>
            file.lines.some((line) => line.lineNumber === comment.line && line.side === comment.side);
          return (
            <PullRequestDiff
              key={file.path}
              file={file}
              comments={attached.filter(lineExists)}
              outdated={attached.filter((comment) => !lineExists(comment))}
              canComment={permissions.canCommentOnLines}
              editor={editor}
              onOpenEditor={openEditor}
              editorBody={body}
              onEditorBodyChange={setBody}
              onSubmit={submit}
              editorError={error}
              working={working}
            />
          );
        })
      ) : (
        <p className="pull-request-files__empty">No file differences.</p>
      )}

      {orphanComments.length > 0 ? (
        <section className="pull-request-files__outdated" aria-label="Outdated comments">
          <h3 className="pull-request-files__outdated-heading">Outdated</h3>
          <ul className="pull-request-line-comments">
            {orphanComments.map((comment) => (
              <li key={comment.id} className="pull-request-line-comment">
                <p className="pull-request-line-comment__author">{`${comment.author} on ${comment.filePath}:${comment.line}`}</p>
                <p className="pull-request-line-comment__body">{comment.body}</p>
                {comment.pending ? <p className="pull-request-line-comment__pending">Pending review</p> : null}
                {comment.outdated ? <p className="pull-request-line-comment__outdated">Outdated</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PullRequestReviewForm
        pullRequest={pullRequest}
        working={reviewWorking}
        error={reviewError}
        onSubmit={submitReview}
      />
    </section>
  );
}
