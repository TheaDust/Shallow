import { useState } from "react";

import { addInlineComment, InlineCommentPayload, PullDetail, ReviewDecision, submitPullReview } from "../../lib/pull-api";
import { RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";

interface PullDiffViewProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  detail: PullDetail;
  onChanged: (pull: PullDetail) => void;
}

interface EditorAnchor {
  path: string;
  line: number;
}

function diffLineMarker(type: string): string {
  return type === "add" ? "+" : type === "del" ? "−" : " ";
}

/**
 * The Files changed tab of a pull-request detail page (REQ-6-3-3/6-3-4): the
 * aggregate diff with expandable per-file blocks, the per-line Add comment
 * buttons on changed lines, the single Comment editor with Add single comment
 * and Start a review, and the Review changes form with Summary, Comment /
 * Approve / Request changes radios, and Submit review. Published inline
 * comments stay anchored to their file and line; pending Start a review
 * drafts are visible only to their author with the Pending review marker and
 * are not public before review submission.
 */
export function PullDiffView({ ownerType, ownerName, repoName, detail, onChanged }: PullDiffViewProps) {
  const { account } = useSession();
  const [collapsed, setCollapsed] = useState<Set<string> | null>(
    () => new Set(detail.files.map((file) => file.path)),
  );
  const [editorAnchor, setEditorAnchor] = useState<EditorAnchor | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("comment");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);

  const additions = detail.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = detail.files.reduce((sum, file) => sum + file.deletions, 0);

  function isFileCollapsed(path: string): boolean {
    return collapsed !== null && collapsed.has(path);
  }

  function toggleFile(path: string) {
    setCollapsed((previous) => {
      const current = previous ?? new Set<string>();
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function visibleComments(path: string, line: number): InlineCommentPayload[] {
    return (detail.inlineComments ?? []).filter(
      (comment) =>
        comment.path === path &&
        comment.line === line &&
        (comment.published || (account !== null && comment.author.username === account.username)),
    );
  }

  async function submitComment(path: string, line: number, startReview: boolean) {
    if (savingComment) return;
    setSavingComment(true);
    setCommentError(null);
    try {
      const outcome = await addInlineComment(ownerType, ownerName, repoName, detail.number, {
        path,
        line,
        body: commentBody,
        startReview,
      });
      if (outcome.ok) {
        if (outcome.pull) {
          setCommentBody("");
          setEditorAnchor(null);
          onChanged(outcome.pull);
        }
        return;
      }
      setCommentError(
        typeof outcome.errors.body === "string"
          ? outcome.errors.body
          : "Could not add the comment",
      );
    } finally {
      setSavingComment(false);
    }
  }

  async function submitReviewForm() {
    if (submittingReview) return;
    setSubmittingReview(true);
    setReviewError(null);
    try {
      const outcome = await submitPullReview(ownerType, ownerName, repoName, detail.number, {
        decision,
        explanation: summary,
      });
      if (outcome.ok) {
        setReviewOpen(false);
        setSummary("");
        setDecision("comment");
        onChanged(outcome.pull);
      } else {
        setReviewError(
          typeof outcome.errors.decision === "string"
            ? outcome.errors.decision
            : "Could not submit the review",
        );
      }
    } finally {
      setSubmittingReview(false);
    }
  }

  return (
    <section aria-label="Files changed">
      <h3>Changed files summary</h3>
      {detail.files.length === 0 ? (
        <p>No files changed.</p>
      ) : (
        <>
          <p className="pull-diff__files-count">
            {detail.files.length} {detail.files.length === 1 ? "file" : "files"} changed
          </p>
          <p className="pull-diff__aggregate">
            {additions} additions, {deletions} deletions
          </p>
          <ul className="commit-detail__files">
            {detail.files.map((file) => (
              <li key={file.path} className="commit-detail__file">
                <span>{file.path}</span>
                <span className="commit-detail__counts">
                  +{file.additions} −{file.deletions}
                </span>
              </li>
            ))}
          </ul>
          <div className="diff-view">
            {detail.files.map((file) => (
              <section key={file.path} className="diff-file" aria-label={file.path}>
                <div className="diff-file__header">
                  <h3 className="diff-file__path">{file.path}</h3>
                  <span className="diff-file__status">{file.status}</span>
                  <span className="diff-file__counts">
                    +{file.additions} −{file.deletions}
                  </span>
                  <button
                    type="button"
                    className="button diff-file__toggle"
                    aria-expanded={!isFileCollapsed(file.path)}
                    onClick={() => toggleFile(file.path)}
                  >
                    {isFileCollapsed(file.path) ? "Expand" : "Collapse"}
                  </button>
                </div>
                {!isFileCollapsed(file.path) && (
                  <div className="diff-lines" role="group" aria-label={`Diff for ${file.path}`}>
                    {file.lines.map((line, index) => {
                      const lineNumber = index + 1;
                      const isAnchor =
                        editorAnchor !== null &&
                        editorAnchor.path === file.path &&
                        editorAnchor.line === lineNumber;
                      const comments = visibleComments(file.path, lineNumber);
                      return (
                        <div key={index}>
                          <div className={`diff-line diff-line--${line.type}`} data-testid="diff-line">
                            <span className="diff-line__marker" aria-hidden="true">
                              {diffLineMarker(line.type)}
                            </span>
                            <span className="diff-line__text">{line.text}</span>
                            {detail.canReview && line.type !== "context" && !isAnchor && (
                              <button
                                type="button"
                                className="diff-line__comment-button"
                                aria-label="Add comment"
                                onClick={() => {
                                  setEditorAnchor({ path: file.path, line: lineNumber });
                                  setCommentBody("");
                                  setCommentError(null);
                                }}
                              >
                                +
                              </button>
                            )}
                          </div>
                          {isAnchor && (
                            <div className="diff-comment-editor">
                              <label
                                className="account-form__label"
                                htmlFor={`comment-${file.path}-${lineNumber}`}
                              >
                                Comment
                              </label>
                              <textarea
                                id={`comment-${file.path}-${lineNumber}`}
                                className="account-form__input diff-comment-editor__body"
                                value={commentBody}
                                onChange={(event) => {
                                  setCommentBody(event.target.value);
                                  setCommentError(null);
                                }}
                              />
                              {commentError && (
                                <p role="alert" className="branch-selector__error">
                                  {commentError}
                                </p>
                              )}
                              <div className="diff-comment-editor__actions">
                                <button
                                  type="button"
                                  className="button button--primary"
                                  disabled={savingComment}
                                  onClick={() => void submitComment(file.path, lineNumber, false)}
                                >
                                  Add single comment
                                </button>
                                <button
                                  type="button"
                                  className="button"
                                  disabled={savingComment}
                                  onClick={() => void submitComment(file.path, lineNumber, true)}
                                >
                                  Start a review
                                </button>
                                <button
                                  type="button"
                                  className="button"
                                  onClick={() => setEditorAnchor(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          {comments.map((comment) => (
                            <div key={comment.id} className="diff-comment" data-testid="inline-comment">
                              <div className="diff-comment__meta">
                                <span className="diff-comment__author">{comment.author.username}</span>
                                {!comment.published && (
                                  <span className="diff-comment__pending">Pending review</span>
                                )}
                                {comment.outdated && (
                                  <span className="diff-comment__outdated">Outdated</span>
                                )}
                              </div>
                              <p className="diff-comment__body">{comment.body}</p>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
          {detail.canReview && (
            <div className="review-changes">
              {!reviewOpen && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    setReviewOpen(true);
                    setReviewError(null);
                  }}
                >
                  Review changes
                </button>
              )}
              {reviewOpen && (
                <div className="review-form">
                  <h4>Submit your review</h4>
                  <label className="account-form__label" htmlFor="review-summary">
                    Summary
                  </label>
                  <textarea
                    id="review-summary"
                    className="account-form__input review-form__summary"
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                  />
                  <fieldset className="review-form__decisions">
                    <legend>Review decision</legend>
                    <label className="review-form__decision">
                      <input
                        type="radio"
                        name="review-decision"
                        value="comment"
                        checked={decision === "comment"}
                        onChange={() => setDecision("comment")}
                      />
                      Comment
                    </label>
                    <label className="review-form__decision">
                      <input
                        type="radio"
                        name="review-decision"
                        value="approve"
                        checked={decision === "approve"}
                        onChange={() => setDecision("approve")}
                      />
                      Approve
                    </label>
                    <label className="review-form__decision">
                      <input
                        type="radio"
                        name="review-decision"
                        value="request_changes"
                        checked={decision === "request_changes"}
                        onChange={() => setDecision("request_changes")}
                      />
                      Request changes
                    </label>
                  </fieldset>
                  {reviewError && (
                    <p role="alert" className="branch-selector__error">
                      {reviewError}
                    </p>
                  )}
                  <div className="review-form__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={submittingReview}
                      onClick={() => void submitReviewForm()}
                    >
                      Submit review
                    </button>
                    <button type="button" className="button" onClick={() => setReviewOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
