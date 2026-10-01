import { useState } from "react";

import { ApiError } from "../../lib/api";
import {
  submitPullRequestReview,
  type PullRequestReviewChoice,
  type RepositoryPullRequestDetail,
} from "../../lib/pull-requests-api";
import { Button } from "../../ui";

export interface PullRequestReviewFormProps {
  owner: string;
  name: string;
  number: number;
  /** The persisted detail payload of the accepted review. */
  onUpdated: (detail: RepositoryPullRequestDetail) => void;
  /** Called after a stored review, so the form closes again. */
  onClose: () => void;
}

const DECISIONS: Array<{ value: PullRequestReviewChoice; label: string }> = [
  { value: "comment", label: "Comment" },
  { value: "approve", label: "Approve" },
  { value: "request_changes", label: "Request changes" },
];

/**
 * The review form of the Files changed view: an optional Summary, the radio
 * controls `Comment`, `Approve` and `Request changes`, and one `Submit review`
 * button. The submitted decision is stored by the server; a refused submission
 * displays the failure and stores no review.
 */
export function PullRequestReviewForm({
  owner,
  name,
  number,
  onUpdated,
  onClose,
}: PullRequestReviewFormProps) {
  const [summary, setSummary] = useState("");
  const [decision, setDecision] = useState<PullRequestReviewChoice>("comment");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await submitPullRequestReview(owner, name, number, {
        decision,
        body: summary,
      });
      onUpdated(updated);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : "The review was not saved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="pull-request-review-form" aria-label="Review" onSubmit={(event) => void submit(event)}>
      <p className="pull-request-review-form__summary">
        <label htmlFor="pull-review-summary">Summary</label>
        <textarea
          id="pull-review-summary"
          name="summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </p>
      <fieldset className="pull-request-review-form__decisions">
        <legend>Review decision</legend>
        {DECISIONS.map((entry) => (
          <label key={entry.value} className="pull-request-review-form__decision">
            <input
              type="radio"
              name="decision"
              value={entry.value}
              checked={decision === entry.value}
              onChange={() => setDecision(entry.value)}
            />
            {entry.label}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={submitting}>
        Submit review
      </Button>
      {error !== null ? (
        <p className="pull-request-review-form__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
