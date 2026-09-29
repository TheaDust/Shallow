import { useEffect, useState } from "react";

import { Button, Dialog } from "../../ui";
import type { ReviewDecision } from "./api";

// One review form opened from the Files changed view (REQ-6-3-4): an optional
// Summary field, radio controls named Comment, Approve and Request changes,
// and a single Submit review button. Submitting records the reviewer's
// decision for the PR's current compare commit; a failed submission keeps the
// form open with the error and never displays the review as published.
const DECISIONS: Array<{ value: ReviewDecision; label: string }> = [
  { value: "comment", label: "Comment" },
  { value: "approve", label: "Approve" },
  { value: "request_changes", label: "Request changes" },
];

export function ReviewChangesForm({
  open,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onSubmit(decision: ReviewDecision, summary: string): void;
  onClose(): void;
}) {
  const [decision, setDecision] = useState<ReviewDecision>("comment");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    if (open) {
      setDecision("comment");
      setSummary("");
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      title="Submit your review"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => onSubmit(decision, summary.trim())}>
            Submit review
          </Button>
        </>
      }
    >
      <div className="ui-field">
        <label htmlFor="review-summary-field">Summary</label>
        <textarea
          id="review-summary-field"
          rows={3}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>
      <fieldset className="review-decision">
        <legend>Review decision</legend>
        {DECISIONS.map((entry) => (
          <label key={entry.value} className="review-decision__option">
            <input
              type="radio"
              name="review-decision"
              value={entry.value}
              checked={decision === entry.value}
              onChange={() => setDecision(entry.value)}
            />
            {entry.label}
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="review-form__error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
