import { useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { readFormValues } from "../../lib/forms";
import type { MutationOutcome } from "../../lib/api";

/**
 * The comment editor of an issue discussion (REQ-5-2-3).
 *
 * The editor is labeled “Comment” and its submit button is named exactly
 * “Comment”. Only Write, Maintain and Admin see it; a whitespace-only comment is
 * refused with “Comment is required” and appends neither a comment nor an
 * activity record, so the editor keeps its text until a valid body is stored.
 */
export interface IssueCommentEditorProps {
  canComment: boolean;
  onSubmit(body: string): Promise<MutationOutcome<unknown>>;
}

const COMMENT_FIELD_ID = "issue-comment";

export function IssueCommentEditor({ canComment, onSubmit }: IssueCommentEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!canComment) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readFormValues(form, ["comment"]);
    setSaving(true);
    const result = await onSubmit(values.comment ?? "");
    setSaving(false);
    if (result.ok) {
      form.reset();
      setError(null);
      setMessage(null);
      return;
    }
    setError(result.errors.comment ?? null);
    setMessage(result.errors.comment ? null : result.message);
  };

  return (
    <form className="issue-comment-editor" onSubmit={submit} noValidate>
      <FormField id={COMMENT_FIELD_ID} label="Comment" error={error ?? undefined}>
        <textarea id={COMMENT_FIELD_ID} name="comment" rows={3} />
      </FormField>
      {message ? (
        <p className="issue-comment-editor__error" role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={saving}>
        Comment
      </Button>
    </form>
  );
}
