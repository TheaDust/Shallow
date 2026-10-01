import { Button } from "../../ui";
import { formatIssueTime } from "../issues/format-issue-time";
import type { PullRequestDiffSide, PullRequestFileDiff, PullRequestReviewComment } from "./pull-request-api";

/** A line an inline review comment can be anchored to (REQ-6-3-3). */
export interface CommentTarget {
  filePath: string;
  line: number;
  side: PullRequestDiffSide;
}

const PREFIX: Record<string, string> = { added: "+", removed: "-", context: " " };

export interface PullRequestLineCommentsProps {
  comments: PullRequestReviewComment[];
}

/**
 * The stored inline comments of one changed line (REQ-6-3-3): each one spells
 * its author and its body, a draft kept by `Start a review` is marked
 * `Pending review`, and a published comment of an older compare commit is
 * marked `Outdated`.
 */
export function PullRequestLineComments({ comments }: PullRequestLineCommentsProps) {
  if (comments.length === 0) return null;
  return (
    <ul className="pull-request-line-comments">
      {comments.map((comment) => (
        <li key={comment.id} className="pull-request-line-comment">
          <p className="pull-request-line-comment__author">{comment.author}</p>
          <p className="pull-request-line-comment__body">{comment.body}</p>
          {comment.pending ? <p className="pull-request-line-comment__pending">Pending review</p> : null}
          {comment.outdated ? <p className="pull-request-line-comment__outdated">Outdated</p> : null}
          <p className="pull-request-line-comment__time">{formatIssueTime(comment.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}

export interface PullRequestDiffProps {
  file: PullRequestFileDiff;
  /** The comments anchored to a line of this file. */
  comments: PullRequestReviewComment[];
  /** The comments of this file whose line is not part of the current diff. */
  outdated: PullRequestReviewComment[];
  /** True when the caller may comment on a changed line (REQ-6-3-3). */
  canComment: boolean;
  /** The line the single editor is open for, if any. */
  editor: CommentTarget | null;
  onOpenEditor(target: CommentTarget): void;
  editorBody: string;
  onEditorBodyChange(value: string): void;
  onSubmit(pending: boolean): void;
  editorError: string | null;
  working: boolean;
}

/**
 * The diff block of one changed file (REQ-6-3-2, REQ-6-3-3): the file path, the
 * added and deleted lines with the line number each side shows, and the inline
 * review comments anchored to those lines.
 *
 * A changed line carries a button that is shown as “+” and named `Add comment`;
 * activating one opens the single editor of the Files changed view below that
 * line. The buttons need no prior hover, and the first one in document order
 * belongs to the first commentable changed line.
 */
export function PullRequestDiff({
  file,
  comments,
  outdated,
  canComment,
  editor,
  onOpenEditor,
  editorBody,
  onEditorBodyChange,
  onSubmit,
  editorError,
  working,
}: PullRequestDiffProps) {
  const editorId = `pull-request-comment-${file.path.replace(/[^A-Za-z0-9]+/g, "-")}`;

  return (
    <section className="pull-request-diff" aria-label={`Diff of ${file.path}`}>
      <h3 className="pull-request-diff__path">{file.path}</h3>
      <p className="pull-request-diff__counts">
        <span className="pull-request-diff__additions">{`+${file.additions} additions`}</span>
        <span className="pull-request-diff__deletions">{`-${file.deletions} deletions`}</span>
      </p>
      <ol className="pull-request-diff__lines">
        {file.lines.map((line) => {
          const lineComments = comments.filter(
            (comment) => comment.line === line.lineNumber && comment.side === line.side,
          );
          const editorOpen = editor !== null
            && editor.filePath === file.path
            && editor.line === line.lineNumber
            && editor.side === line.side;
          return (
            <li
              key={`${line.index}-${line.type}`}
              className={`pull-request-diff__line pull-request-diff__line--${line.type}`}
              data-line-type={line.type}
            >
              <div className="pull-request-diff__line-row">
                <span className="pull-request-diff__number pull-request-diff__number--old">
                  {line.oldNumber ?? ""}
                </span>
                <span className="pull-request-diff__number pull-request-diff__number--new">
                  {line.newNumber ?? ""}
                </span>
                <code className="pull-request-diff__code">{`${PREFIX[line.type] ?? " "}${line.text}`}</code>
                {canComment && line.side !== "context" ? (
                  <Button
                    variant="ghost"
                    className="pull-request-diff__add"
                    aria-label="Add comment"
                    onClick={() =>
                      onOpenEditor({ filePath: file.path, line: line.lineNumber, side: line.side as PullRequestDiffSide })
                    }
                  >
                    +
                  </Button>
                ) : null}
              </div>
              <PullRequestLineComments comments={lineComments} />
              {editorOpen ? (
                <div className="pull-request-diff__editor">
                  <label className="pull-request-diff__editor-label" htmlFor={editorId}>
                    Comment
                  </label>
                  <textarea
                    id={editorId}
                    className="pull-request-diff__editor-input"
                    value={editorBody}
                    onChange={(event) => onEditorBodyChange(event.target.value)}
                  />
                  {editorError ? (
                    <p className="pull-request-diff__editor-error" role="alert">
                      {editorError}
                    </p>
                  ) : null}
                  <div className="pull-request-diff__editor-actions">
                    <Button variant="primary" disabled={working} onClick={() => onSubmit(false)}>
                      Add single comment
                    </Button>
                    <Button disabled={working} onClick={() => onSubmit(true)}>
                      Start a review
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {outdated.length > 0 ? (
        <section className="pull-request-diff__outdated" aria-label={`Outdated comments on ${file.path}`}>
          <h4 className="pull-request-diff__outdated-heading">Outdated</h4>
          <PullRequestLineComments comments={outdated} />
        </section>
      ) : null}
    </section>
  );
}
