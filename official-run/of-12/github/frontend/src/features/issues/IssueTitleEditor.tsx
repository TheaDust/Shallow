import { useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { readFormValues } from "../../lib/forms";
import type { MutationOutcome } from "../../lib/api";

/**
 * The title of an issue with its separate edit action (REQ-5-2-2).
 *
 * Only Write, Maintain and Admin see “Edit issue title”; the form it opens holds
 * a textbox labeled “Issue title” and the button “Save issue title”. A rejected
 * save (blank or overlong title, refused permission, failed write) leaves the
 * stored title and the heading unchanged, so a reload still shows the original.
 */
export interface IssueTitleEditorProps {
  title: string;
  canEdit: boolean;
  onSave(title: string): Promise<MutationOutcome<unknown>>;
}

const TITLE_FIELD_ID = "issue-title";

export function IssueTitleEditor({ title, canEdit, onSave }: IssueTitleEditorProps) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onOpen = () => {
    setError(null);
    setMessage(null);
    setEditing(true);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = readFormValues(event.currentTarget, ["title"]);
    setSaving(true);
    const result = await onSave(values.title ?? "");
    setSaving(false);
    if (result.ok) {
      setEditing(false);
      setError(null);
      setMessage(null);
      return;
    }
    setError(result.errors.title ?? null);
    setMessage(result.errors.title ? null : result.message);
  };

  return (
    <div className="issue-title">
      <h1 className="repository-issue__title">{title}</h1>
      {canEdit && !editing ? (
        <Button variant="secondary" onClick={onOpen}>
          Edit issue title
        </Button>
      ) : null}
      {canEdit && editing ? (
        <form className="issue-title__form" onSubmit={onSubmit} noValidate>
          <FormField id={TITLE_FIELD_ID} label="Issue title" error={error ?? undefined}>
            <input id={TITLE_FIELD_ID} name="title" type="text" defaultValue={title} autoComplete="off" />
          </FormField>
          {message ? (
            <p className="issue-title__error" role="alert">
              {message}
            </p>
          ) : null}
          <div className="issue-title__actions">
            <Button type="submit" variant="primary" disabled={saving}>
              Save issue title
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
