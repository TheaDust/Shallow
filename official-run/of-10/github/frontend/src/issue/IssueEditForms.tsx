import { useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  issueDescriptionError,
  issueTitleError,
  saveIssueDescription,
  saveIssueTitle,
  type RepositoryIssuePayload,
} from "../lib/issues-api";
import { Button } from "../ui/Button";

export interface IssueEditorProps {
  owner: string;
  name: string;
  number: number;
  /** The stored value the editor starts from. */
  current: string;
  onSaved(payload: RepositoryIssuePayload): void;
  onCancel(): void;
}

/**
 * Title editor of one issue (REQ-5-2-2). Only the title of the target issue is
 * written; a refused save (blank or overlong value, missing permission, failed
 * request) leaves the stored title, the description and the timeline untouched
 * and shows the reason on the page.
 */
export function IssueTitleEditor({ owner, name, number, current, onSaved, onCancel }: IssueEditorProps) {
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const complaint = issueTitleError(draft);
    if (complaint) {
      setError(complaint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveIssueTitle(owner, name, number, draft.trim()));
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.title ?? apiErrorMessage(caught, "The title could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="issue-edit" onSubmit={submit}>
      <label className="issue-edit__label" htmlFor="issue-title-input">
        Issue title
      </label>
      <input
        id="issue-title-input"
        className="issue-edit__input"
        type="text"
        name="title"
        value={draft}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
      />
      {error ? (
        <p className="issue-edit__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="issue-edit__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Save issue title
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Description editor of one issue (REQ-5-2-2). Saving the description and saving
 * the title are separate actions: this form writes the description alone and keeps
 * the description of every other issue untouched.
 */
export function IssueDescriptionEditor({
  owner,
  name,
  number,
  current,
  onSaved,
  onCancel,
}: IssueEditorProps) {
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const complaint = issueDescriptionError(draft);
    if (complaint) {
      setError(complaint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveIssueDescription(owner, name, number, draft.trim()));
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.description ?? apiErrorMessage(caught, "The description could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="issue-edit" onSubmit={submit}>
      <label className="issue-edit__label" htmlFor="issue-description-input">
        Issue description
      </label>
      <textarea
        id="issue-description-input"
        className="issue-edit__input issue-edit__textarea"
        name="description"
        rows={4}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {error ? (
        <p className="issue-edit__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="issue-edit__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Save issue description
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
