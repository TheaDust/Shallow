import { useId, useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  addPullRequestInlineComment,
  type PullRequestPayload,
} from "../lib/pull-requests-api";
import { Button, FormField } from "../ui";

export interface PullRequestInlineCommentEditorProps {
  owner: string;
  name: string;
  number: number;
  /** The changed file and the position of the commented line in its diff. */
  path: string;
  line: number;
  /** The stored answer; the diff view shows the new comment from it. */
  onSaved(payload: PullRequestPayload): void;
  onClose(): void;
}

/**
 * The single editor one changed line opens (REQ-6-3-3): a `Comment` field with
 * `Add single comment`, which publishes the body right away, and `Start a
 * review`, which keeps it as the reviewer's own pending draft until the review
 * is submitted. An empty body or a refused submission stores nothing, so no
 * partial comment can be displayed; the editor keeps the text so it can be
 * corrected.
 */
export function PullRequestInlineCommentEditor({
  owner,
  name,
  number,
  path,
  line,
  onSaved,
  onClose,
}: PullRequestInlineCommentEditorProps) {
  const fieldId = `pull-inline-comment-${useId()}`;
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(pending: boolean) {
    if (busy) return;
    const text = body.trim();
    if (!text) {
      setError("Comment is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await addPullRequestInlineComment(owner, name, number, { path, line, body: text, pending }));
      setBody("");
      onClose();
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(
        fields.body ??
          fields.line ??
          fields.path ??
          apiErrorMessage(caught, "The comment could not be added."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="pull-inline-editor"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      <FormField id={fieldId} label="Comment">
        <textarea
          id={fieldId}
          className="pull-inline-editor__input"
          name="inline-comment"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </FormField>
      <div className="pull-inline-editor__actions">
        <Button
          type="button"
          variant="primary"
          disabled={busy}
          onClick={() => void submit(false)}
        >
          Add single comment
        </Button>
        <Button type="button" disabled={busy} onClick={() => void submit(true)}>
          Start a review
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="form-message form-message--error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
