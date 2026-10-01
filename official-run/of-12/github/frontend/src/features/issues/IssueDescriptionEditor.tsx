import { useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { readFormValues } from "../../lib/forms";
import type { MutationOutcome } from "../../lib/api";

/**
 * The description of an issue with its separate edit action (REQ-5-2-2).
 *
 * “Edit issue description” opens a form with the textbox “Issue description”
 * and the button “Save issue description”. The description may be empty, so only
 * an overlong value, a refused permission or a failed write is rejected — and in
 * that case the stored description stays as it was.
 */
export interface IssueDescriptionEditorProps {
  description: string;
  canEdit: boolean;
  onSave(description: string): Promise<MutationOutcome<unknown>>;
}

const DESCRIPTION_FIELD_ID = "issue-description";

export function IssueDescriptionEditor({ description, canEdit, onSave }: IssueDescriptionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = readFormValues(event.currentTarget, ["description"]);
    setSaving(true);
    const result = await onSave(values.description ?? "");
    setSaving(false);
    if (result.ok) {
      setEditing(false);
      setError(null);
      setMessage(null);
      return;
    }
    setError(result.errors.description ?? null);
    setMessage(result.errors.description ? null : result.message);
  };

  return (
    <div className="issue-description">
      <p className="repository-issue__description">
        {description || <span className="repository-issue__description-empty">No description provided.</span>}
      </p>
      {canEdit && !editing ? (
        <Button
          variant="secondary"
          onClick={() => {
            setError(null);
            setMessage(null);
            setEditing(true);
          }}
        >
          Edit issue description
        </Button>
      ) : null}
      {canEdit && editing ? (
        <form className="issue-description__form" onSubmit={onSubmit} noValidate>
          <FormField id={DESCRIPTION_FIELD_ID} label="Issue description" error={error ?? undefined}>
            <textarea id={DESCRIPTION_FIELD_ID} name="description" rows={4} defaultValue={description} />
          </FormField>
          {message ? (
            <p className="issue-description__error" role="alert">
              {message}
            </p>
          ) : null}
          <div className="issue-description__actions">
            <Button type="submit" variant="primary" disabled={saving}>
              Save issue description
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setError(null);
                setMessage(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
