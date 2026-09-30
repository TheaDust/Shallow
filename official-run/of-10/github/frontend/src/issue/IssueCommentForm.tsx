import { useId, useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  addIssueComment,
  issueCommentError,
  type RepositoryIssuePayload,
} from "../lib/issues-api";
import { Button, FormField } from "../ui";

export interface IssueCommentFormProps {
  owner: string;
  name: string;
  number: number;
  /** The stored answer of a successful comment; the discussion shows it. */
  onSaved(payload: RepositoryIssuePayload): void;
}

/**
 * The comment editor of one issue (REQ-5-2-3): a form whose field is labeled
 * "Comment" and whose submit button is named exactly "Comment".
 *
 * A body of 1-65536 characters after trimming is stored, so a whitespace-only
 * or overlong body is refused with the reason on the page and appends neither a
 * comment nor an activity record; the stored answer of a successful submission
 * is the record the discussion and the timeline then show.
 */
export function IssueCommentForm({ owner, name, number, onSaved }: IssueCommentFormProps) {
  const fieldId = `issue-comment-${useId()}`;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const complaint = issueCommentError(draft);
    if (complaint) {
      setError(complaint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await addIssueComment(owner, name, number, draft.trim()));
      setDraft("");
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.body ?? apiErrorMessage(caught, "The comment could not be added."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="issue-comment-form" onSubmit={submit}>
      <FormField id={fieldId} label="Comment" error={error ?? undefined}>
        <textarea
          id={fieldId}
          className="issue-edit__input issue-edit__textarea"
          name="comment"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </FormField>
      <div className="issue-edit__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Comment
        </Button>
      </div>
    </form>
  );
}
