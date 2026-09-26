import { useState } from 'react';
import type { RepositoryDiffLine } from '../types';

interface DiffLinesProps {
  lines: RepositoryDiffLine[];
  /**
   * REQ-6-3-3: whether the signed-in viewer may comment on this PR's
   * changed lines (Write/Maintain/Admin who is not the PR author, on an
   * Open PR). When false no Add comment buttons are rendered at all.
   */
  canComment?: boolean;
  /**
   * REQ-6-3-3: submits one inline comment (pending === true keeps it as a
   * Start-a-review draft) and returns the rejection message on failure, or
   * null on success. A failed submission never displays as published — the
   * editor stays open with the entered body and the error.
   */
  onSubmitComment?: (line: number, body: string, pending: boolean) => Promise<string | null>;
}

/**
 * REQ-4-2-2: the line-by-line diff of one file. Context lines carry no
 * prefix, added lines a "+" prefix, deleted lines a "-" prefix; the visible
 * text of every line includes the prefix so the content reads unambiguously.
 *
 * REQ-6-3-3: every added/deleted line of a commentable view offers an
 * "Add comment" button (visually "+"), available for direct activation
 * without a prerequisite hover; the first such button in document order
 * targets the first commentable changed line. Activating one opens a single
 * editor labeled "Comment" with "Add single comment" and "Start a review"
 * buttons. The saved comments of the file are rendered by the caller at the
 * file-block level so they stay visible whether the block is expanded or
 * collapsed.
 */
export default function DiffLines({
  lines,
  canComment = false,
  onSubmitComment,
}: DiffLinesProps) {
  const [editorLine, setEditorLine] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!lines || lines.length === 0) {
    return null;
  }

  const openEditor = (line: number) => {
    setEditorLine(line);
    setText('');
    setError(null);
    setSubmitting(false);
  };

  const closeEditor = () => {
    setEditorLine(null);
    setText('');
    setError(null);
    setSubmitting(false);
  };

  const submit = async (pending: boolean) => {
    if (editorLine === null || !onSubmitComment) {
      return;
    }
    if (text.trim() === '') {
      setError('Comment is required');
      return;
    }
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    const message = await onSubmitComment(editorLine, text, pending);
    setSubmitting(false);
    if (message) {
      setError(message);
      return;
    }
    closeEditor();
  };

  return (
    <div className="diff-lines">
      {lines.map((line, index) => (
        <div key={index}>
          <div
            className={`diff-line ${line.type}`}
            data-testid={`diff-line-${line.type}`}
          >
            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
            {line.text}
            {canComment && line.type !== 'context' ? (
              <button
                type="button"
                className="diff-add-comment-button"
                aria-label="Add comment"
                aria-expanded={editorLine === index}
                onClick={() => openEditor(index)}
              >
                +
              </button>
            ) : null}
          </div>
          {editorLine === index ? (
            <div className="inline-comment-editor">
              <textarea
                className="inline-comment-textarea"
                aria-label="Comment"
                rows={3}
                value={text}
                disabled={submitting}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
              />
              {error ? (
                <p role="alert" className="form-error">
                  {error}
                </p>
              ) : null}
              <div className="inline-comment-editor-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={submitting}
                  onClick={() => void submit(false)}
                >
                  Add single comment
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={submitting}
                  onClick={() => void submit(true)}
                >
                  Start a review
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={submitting}
                  onClick={closeEditor}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
