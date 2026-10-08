import { useState } from "react";

import {
  submitRepositoryPullRequestReview,
  type PullRequestReview,
  type ReviewDecision,
} from "../lib/org-api";
import { Button, Dialog, FormField } from "../ui";

const DECISION_LABEL: Record<ReviewDecision, string> = {
  approved: "Approved",
  "changes-requested": "Changes requested",
};

/** The exact visible label of one persisted review decision. */
export function reviewDecisionLabel(decision: ReviewDecision): string {
  return DECISION_LABEL[decision] ?? decision;
}

/** The persisted review decisions of one pull request, newest first. */
export function ReviewsList({ reviews }: { reviews: PullRequestReview[] }) {
  if (reviews.length === 0) {
    return <p className="pull-reviews__empty">No reviews yet.</p>;
  }
  return (
    <ul className="pull-reviews__list">
      {reviews.map((review) => (
        <li key={review.id} className="pull-review">
          <p className="pull-review__meta">
            <span className="pull-review__reviewer">{review.reviewer}</span>{" "}
            <span className="pull-review__decision">{reviewDecisionLabel(review.decision)}</span>
            {review.stale ? " (stale)" : ""}
          </p>
          {review.summary ? <p className="pull-review__summary">{review.summary}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export interface ReviewChangesProps {
  owner: string;
  name: string;
  number: string;
  /** Reloads the pull request after a review is stored. */
  onChanged(): void;
}

/**
 * The `Review changes` form of the Files changed view (REQ-6-3-4). A non-author
 * reviewer opens it, selects `Approve` or `Request changes`, optionally writes a
 * summary and submits; the stored decision and its exact summary stay visible
 * after reload.
 */
export function ReviewChanges({ owner, name, number, onChanged }: ReviewChangesProps) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<ReviewDecision>("approved");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await submitRepositoryPullRequestReview(owner, name, number, {
      decision,
      summary,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors.decision ?? result.fieldErrors.summary ?? result.message);
      return;
    }
    setSummary("");
    setDecision("approved");
    setOpen(false);
    onChanged();
  };

  return (
    <div className="pull-review-form">
      <Button variant="primary" onClick={() => setOpen(true)}>
        Review changes
      </Button>
      {error && !open ? (
        <p className="pull-review-form__error" role="alert">
          {error}
        </p>
      ) : null}
      {open ? (
        <Dialog
          open
          title="Review changes"
          onOpenChange={(next) => (next ? setOpen(true) : close())}
          actions={
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              Submit review
            </Button>
          }
        >
          <fieldset className="pull-review-form__decisions">
            <legend>Review changes</legend>
            <label className="pull-review-form__decision">
              <input
                type="radio"
                name="review-decision"
                value="approved"
                checked={decision === "approved"}
                onChange={() => setDecision("approved")}
              />
              Approve
            </label>
            <label className="pull-review-form__decision">
              <input
                type="radio"
                name="review-decision"
                value="changes-requested"
                checked={decision === "changes-requested"}
                onChange={() => setDecision("changes-requested")}
              />
              Request changes
            </label>
          </fieldset>
          <FormField id="review-summary" label="Summary" error={error ?? undefined}>
            <textarea
              id="review-summary"
              rows={4}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </FormField>
        </Dialog>
      ) : null}
    </div>
  );
}
