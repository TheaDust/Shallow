import { useId, useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import { addPullRequestComment, type PullRequestPayload } from "../lib/pull-requests-api";
import { Button, FormField } from "../ui";

export interface PullRequestCommentFormProps {
  owner: string;
  name: string;
  number: number;
  /** The stored answer of a successful comment; the conversation shows it. */
  onSaved(payload: PullRequestPayload): void;
}

/**
 * The comment editor of one pull request (REQ-6): a form whose field is labeled
 * "Comment" and whose submit button is named exactly "Comment". Only Write,
 * Maintain and Admin may comment — the server re-checks the role — and a
 * whitespace-only body is refused on the page without appending any record.
 */
export function PullRequestCommentForm({
  owner,
  name,
  number,
  onSaved,
}: PullRequestCommentFormProps) {
  const fieldId = `pull-comment-${useId()}`;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!draft.trim()) {
      setError("Comment is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await addPullRequestComment(owner, name, number, draft.trim()));
      setDraft("");
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.body ?? apiErrorMessage(caught, "The comment could not be added."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pull-comment-form" onSubmit={(event) => void submit(event)}>
      <FormField id={fieldId} label="Comment" error={error ?? undefined}>
        <textarea
          id={fieldId}
          className="pull-comment-form__input"
          name="comment"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Comment
      </Button>
    </form>
  );
}
