import { useState } from "react";

import { ApiError } from "../../lib/api";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";

export interface IssueEditFormProps {
  /**
   * The label of the textbox. It names the field only: the form itself stays
   * unnamed, so no container shadows the label of the control inside it.
   */
  fieldLabel: string;
  /** The exact name of the save button. */
  saveLabel: string;
  /** The stored value the form starts from. */
  value: string;
  multiline?: boolean;
  /**
   * Saves one submitted value. It resolves with the server message of a refused
   * save, or null when the new value was stored.
   */
  onSave(value: string): Promise<string | null>;
  onCancel(): void;
}

/**
 * The inline editor of one issue field. Opening it never hides the readable
 * value: the caller keeps the heading and the description visible, so a refused
 * save still shows the stored value next to the message.
 */
export function IssueEditForm({
  fieldLabel,
  saveLabel,
  value,
  multiline = false,
  onSave,
  onCancel,
}: IssueEditFormProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = fieldLabel === "Issue title" ? "issue-title" : "issue-description";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    onSave(draft)
      .then((message) => {
        if (message !== null) setError(message);
      })
      .catch((failure) => {
        setError(failure instanceof ApiError ? failure.message : "The issue was not saved.");
      })
      .finally(() => setBusy(false));
  }

  return (
    <form className="issue-edit-form" onSubmit={submit}>
      <FormField id={fieldId} label={fieldLabel} error={error ?? undefined}>
        {multiline ? (
          <textarea
            id={fieldId}
            name={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <input
            id={fieldId}
            name={fieldId}
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
      </FormField>
      <div className="issue-edit-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {saveLabel}
        </Button>
        <Button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
