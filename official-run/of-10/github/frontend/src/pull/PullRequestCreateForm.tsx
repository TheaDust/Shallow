import { useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  pullRequestDescriptionError,
  pullRequestTitleError,
  trimPullRequestText,
} from "../lib/pull-request-creation";
import { createPullRequest } from "../lib/pull-requests-api";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

/** A normal creation persists an Open proposal, a draft one a Draft proposal. */
export type PullRequestCreateMode = "normal" | "draft";

export interface PullRequestCreateFormProps {
  owner: string;
  name: string;
  /** The target branch of the stored proposal. */
  base: string;
  /** The source branch whose commits the proposal brings in. */
  compare: string;
  mode: PullRequestCreateMode;
  /** Called with the repository-scoped number of the stored proposal. */
  onCreated(pullRequestNumber: number): void;
  onCancel(): void;
}

/**
 * The creation form of a valid comparison result (REQ-6-2-3, REQ-6-2-4). It
 * carries the `Title` of the proposal, its optional `Description` and exactly
 * one submit button named after the creation it performs, so the comparison page
 * never offers a second, competing selection entry while the form is open. A
 * title that is empty after trimming its surrounding whitespace is reported as
 * `Title is required` and creates nothing, and an overlong title or description
 * is refused the same way; the server re-checks those limits together with the
 * branch pair, the comparison and the viewer's role before it stores anything.
 */
export function PullRequestCreateForm({
  owner,
  name,
  base,
  compare,
  mode,
  onCreated,
  onCancel,
}: PullRequestCreateFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const action = mode === "draft" ? "Create draft pull request" : "Create pull request";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const titleComplaint = pullRequestTitleError(title);
    const descriptionComplaint = pullRequestDescriptionError(description);
    setTitleError(titleComplaint);
    setDescriptionError(descriptionComplaint);
    if (titleComplaint || descriptionComplaint) {
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = await createPullRequest(owner, name, {
        base,
        compare,
        title: trimPullRequestText(title),
        description: trimPullRequestText(description),
        ...(mode === "draft" ? { draft: true } : {}),
      });
      onCreated(payload.pullRequest.number);
    } catch (caught) {
      const fields = readErrorFields(caught);
      if (fields.title) setTitleError(fields.title);
      if (fields.description) setDescriptionError(fields.description);
      setError(
        fields.compare ??
          fields.base ??
          (fields.title || fields.description
            ? null
            : apiErrorMessage(caught, "The pull request could not be created.")),
      );
      setBusy(false);
    }
  }

  return (
    <form className="pull-create__form" onSubmit={(event) => void submit(event)}>
      <FormField id="pull-create-title" label="Title" error={titleError ?? undefined}>
        <input
          id="pull-create-title"
          type="text"
          autoComplete="off"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField id="pull-create-description" label="Description" error={descriptionError ?? undefined}>
        <textarea
          id="pull-create-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <div className="pull-create__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {action}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
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
