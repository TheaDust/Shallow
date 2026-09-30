import { useId, useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  submitPullRequestReview,
  type PullRequestPayload,
  type ReviewDecision,
} from "../lib/pull-requests-api";
import { Button, FormField } from "../ui";

export interface PullRequestReviewFormProps {
  owner: string;
  name: string;
  number: number;
  /** The stored answer of a successful review; the page shows it everywhere. */
  onSaved(payload: PullRequestPayload): void;
  onClose(): void;
}

const DECISIONS: ReadonlyArray<{ value: ReviewDecision; label: string }> = [
  { value: "comment", label: "Comment" },
  { value: "approve", label: "Approve" },
  { value: "request_changes", label: "Request changes" },
];

/**
 * The one review form of a pull request (REQ-6-3-4), opened by `Review changes`
 * under the changed files. It carries the optional `Summary` explanation, the
 * three radio controls `Comment`, `Approve` and `Request changes`, and the
 * `Submit review` button. The stored decision belongs to the current compare
 * commit; a new decision of the same reviewer replaces their own decision for
 * that commit while the older record stays in the timeline. Only a writer who is
 * not the author of an Open proposal may submit one, and the server refuses the
 * same request.
 */
export function PullRequestReviewForm({
  owner,
  name,
  number,
  onSaved,
  onClose,
}: PullRequestReviewFormProps) {
  const fieldId = `pull-review-${useId()}`;
  const [decision, setDecision] = useState<ReviewDecision>("comment");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await submitPullRequestReview(owner, name, number, decision, summary.trim()));
      setSummary("");
      onClose();
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.decision ?? apiErrorMessage(caught, "The review could not be submitted."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pull-review-form" onSubmit={(event) => void submit(event)}>
      <FormField id={`${fieldId}-summary`} label="Summary">
        <textarea
          id={`${fieldId}-summary`}
          className="pull-review-form__input"
          name="summary"
          rows={3}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </FormField>
      <fieldset className="pull-review-form__decisions">
        <legend>Review decision</legend>
        {DECISIONS.map((option) => (
          <label key={option.value} className="pull-review-form__decision">
            <input
              type="radio"
              name={`${fieldId}-decision`}
              value={option.value}
              checked={decision === option.value}
              onChange={() => setDecision(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <div className="pull-review-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Submit review
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
