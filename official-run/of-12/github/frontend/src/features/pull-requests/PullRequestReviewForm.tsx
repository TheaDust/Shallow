import { useState } from "react";

import { Button, Dialog, FormField } from "../../ui";
import type { PullRequestDecision, PullRequestDetail } from "./pull-request-api";

/** The decisions the review form offers, in the documented order (REQ-6-3-4). */
export const REVIEW_DECISIONS: PullRequestDecision[] = ["comment", "approve", "request_changes"];

/** The exact accessible name of every radio control of the review form. */
export const REVIEW_DECISION_LABELS: Record<PullRequestDecision, string> = {
  comment: "Comment",
  approve: "Approve",
  request_changes: "Request changes",
};

export interface PullRequestReviewFormProps {
  pullRequest: PullRequestDetail;
  working: boolean;
  error: string | null;
  onSubmit(input: { decision: PullRequestDecision; summary: string }): void;
}

/**
 * The review entry of the Files changed view (REQ-6-3-4).
 *
 * `Review changes` opens one review form with the optional `Summary` field, the
 * radio controls `Comment`, `Approve` and `Request changes` and the
 * `Submit review` button. Only a reviewer who is not the author of an Open pull
 * request sees the entry; a submitted decision is answered by the refreshed
 * detail, so the review summary of Conversation displays the stored record.
 */
export function PullRequestReviewForm({
  pullRequest,
  working,
  error,
  onSubmit,
}: PullRequestReviewFormProps) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<PullRequestDecision>("comment");
  const [summary, setSummary] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (!pullRequest.permissions.canSubmitReview) return null;

  const message = localError ?? error;

  return (
    <section className="pull-request-review-form" aria-label="Review changes">
      <Button variant="primary" onClick={() => setOpen(true)}>
        Review changes
      </Button>
      {/* The form is opened by the button, so its fields and radios exist only
          while the reviewer is filling them in. */}
      {open ? (
        <Dialog
          open
          title="Review changes"
          description="Submit your review of this pull request."
          onOpenChange={setOpen}
          actions={
            <Button
              variant="primary"
              disabled={working}
              onClick={() => {
                if (summary.length > 65536) {
                  setLocalError("Summary must be 65536 characters or fewer");
                  return;
                }
                setLocalError(null);
                setOpen(false);
                onSubmit({ decision, summary });
              }}
            >
              Submit review
            </Button>
          }
        >
          <FormField id="pull-request-review-summary" label="Summary">
            <textarea
              id="pull-request-review-summary"
              className="pull-request-review-form__summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </FormField>
          <fieldset className="pull-request-review-form__decisions">
            <legend>Review decision</legend>
            {REVIEW_DECISIONS.map((value) => (
              <label key={value} className="pull-request-review-form__decision">
                <input
                  type="radio"
                  name="pull-request-review-decision"
                  value={value}
                  checked={decision === value}
                  onChange={() => setDecision(value)}
                />
                {REVIEW_DECISION_LABELS[value]}
              </label>
            ))}
          </fieldset>
        </Dialog>
      ) : null}
      {message ? (
        <p className="pull-request-review-form__error" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
