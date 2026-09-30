import { Fragment, useState } from "react";

import type { ChangedFile, DiffLine } from "../lib/repositories-api";
import { issueDateTime } from "../lib/issue-dates";
import type {
  PullRequestDetail,
  PullRequestInlineComment,
  PullRequestPayload,
} from "../lib/pull-requests-api";
import { Button } from "../ui";
import { PullRequestInlineCommentEditor } from "./PullRequestInlineCommentEditor";
import { PullRequestReviewForm } from "./PullRequestReviewForm";

export interface PullRequestChangedFilesProps {
  owner: string;
  name: string;
  number: number;
  pullRequest: PullRequestDetail;
  /** The changed file the current address selected, when the view offers one. */
  selectedPath?: string;
  /** Address of one changed file's own diff on the same pull request. */
  fileHref(path: string): string;
  /** The stored answer of an accepted write; the page shows it everywhere. */
  onSaved(payload: PullRequestPayload): void;
}

function marker(kind: DiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return " ";
}

/** Whether a line of the diff is one a review comment may be anchored to. */
function isCommentable(line: DiffLine): boolean {
  return line.kind === "add" || line.kind === "remove";
}

/** One stored inline comment with its author, body, state and position. */
function InlineComment({ comment }: { comment: PullRequestInlineComment }) {
  return (
    <li className="pull-inline-comment" data-state={comment.state} data-outdated={comment.outdated}>
      <p className="pull-inline-comment__meta">
        <span className="pull-inline-comment__author">{comment.author}</span>
        {" commented on "}
        <span className="pull-inline-comment__path">{comment.path}</span>
        {comment.lineNumber ? ` line ${comment.lineNumber}` : ""}
        {" · "}
        <time dateTime={comment.createdAt}>{issueDateTime(comment.createdAt)}</time>
        {comment.state === "pending" ? " · Pending review" : ""}
        {comment.outdated ? " · Outdated" : ""}
      </p>
      <p className="pull-inline-comment__body">{comment.body}</p>
    </li>
  );
}

/**
 * The Files changed view of a pull request (REQ-6-3-2, REQ-6-3-3): the diff of
 * the current base and compare commits with its per-file, per-line differences
 * and the aggregate statistics. Every added and deleted line owns its own `+`
 * button named `Add comment`, so the first one in document order is the first
 * commentable line and no hover is needed to activate it. Activating one opens
 * the single `Comment` editor of that line, which publishes the body at once or
 * keeps it as a pending review draft. The stored comments are shown under their
 * line and marked `Outdated` once the comparison moved on. The view also carries
 * the `Review changes` entry that opens the one review form (REQ-6-3-4).
 */
export function PullRequestChangedFiles({
  owner,
  name,
  number,
  pullRequest,
  selectedPath,
  fileHref,
  onSaved,
}: PullRequestChangedFilesProps) {
  const [editing, setEditing] = useState<{ path: string; line: number } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { permissions, inlineComments } = pullRequest;

  const commentsOf = (file: ChangedFile, index: number): PullRequestInlineComment[] =>
    inlineComments.filter(
      (comment) => comment.path === file.path && !comment.outdated && comment.line === index,
    );
  // A comment whose compare commit moved on can no longer be anchored to a line
  // of the current diff; it stays readable under its file, marked Outdated.
  const detachedOf = (file: ChangedFile): PullRequestInlineComment[] =>
    inlineComments.filter(
      (comment) =>
        comment.path === file.path &&
        (comment.outdated || comment.line < 0 || comment.line >= file.diff.length),
    );

  return (
    <section className="changed-files" aria-labelledby="changed-files-heading">
      <h2 id="changed-files-heading">Changed files</h2>
      <p className="changed-files__summary">
        <span className="changed-files__count">{pullRequest.filesChanged} changed files</span>
        <span className="changed-files__totals">
          {pullRequest.additions} additions, {pullRequest.deletions} deletions
        </span>
      </p>
      {permissions.canReview ? (
        <div className="pull-review-entry">
          {reviewOpen ? (
            <PullRequestReviewForm
              owner={owner}
              name={name}
              number={number}
              onSaved={(payload) => {
                setReviewOpen(false);
                onSaved(payload);
              }}
              onClose={() => setReviewOpen(false)}
            />
          ) : (
            <Button variant="primary" onClick={() => setReviewOpen(true)}>
              Review changes
            </Button>
          )}
        </div>
      ) : null}
      {pullRequest.changedFiles.length === 0 ? (
        <p className="changed-files__empty">No changed files.</p>
      ) : (
        <ul className="changed-files__list">
          {pullRequest.changedFiles.map((file) => {
            const selected = selectedPath === file.path;
            return (
              <li
                key={file.path}
                className="changed-file"
                data-selected={selected ? "true" : undefined}
              >
                <p className="changed-file__header">
                  <a
                    className="changed-file__path"
                    href={fileHref(file.path)}
                    aria-current={selected ? "true" : undefined}
                  >
                    {file.path}
                  </a>
                  <span className="changed-file__stats">
                    <span className="changed-file__additions">+{file.additions}</span>
                    <span className="changed-file__deletions">-{file.deletions}</span>
                  </span>
                </p>
                <div className="changed-file__diff">
                  {file.diff.map((line, index) => {
                    const comments = commentsOf(file, index);
                    const editorOpen =
                      editing !== null && editing.path === file.path && editing.line === index;
                    return (
                      <Fragment key={`${line.kind}-${index}`}>
                        <div className="diff-line" data-kind={line.kind}>
                          <span className="diff-line__number" aria-hidden="true">
                            {line.kind === "remove" ? (line.oldLine ?? "") : (line.newLine ?? "")}
                          </span>
                          <span className="diff-line__text">
                            {marker(line.kind)}
                            {line.text}
                          </span>
                          {permissions.canInlineComment && isCommentable(line) ? (
                            <button
                              type="button"
                              className="diff-line__comment"
                              aria-label="Add comment"
                              onClick={() => setEditing({ path: file.path, line: index })}
                            >
                              +
                            </button>
                          ) : null}
                        </div>
                        {comments.length > 0 ? (
                          <ul className="pull-inline-comments">
                            {comments.map((comment) => (
                              <InlineComment key={comment.id} comment={comment} />
                            ))}
                          </ul>
                        ) : null}
                        {editorOpen ? (
                          <PullRequestInlineCommentEditor
                            owner={owner}
                            name={name}
                            number={number}
                            path={file.path}
                            line={index}
                            onSaved={onSaved}
                            onClose={() => setEditing(null)}
                          />
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
                {detachedOf(file).length > 0 ? (
                  <ul className="pull-inline-comments pull-inline-comments--outdated">
                    {detachedOf(file).map((comment) => (
                      <InlineComment key={comment.id} comment={comment} />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
