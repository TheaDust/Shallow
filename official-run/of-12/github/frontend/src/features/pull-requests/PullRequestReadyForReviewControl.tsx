import { useState } from "react";

import { Button, Dialog } from "../../ui";
import type { PullRequestDetail } from "./pull-request-api";

export interface PullRequestReadyForReviewControlProps {
  pullRequest: PullRequestDetail;
  working: boolean;
  error: string | null;
  onConfirm(): void;
}

/**
 * The “Ready for review” entry of a draft pull request (REQ-6-2-4).
 *
 * Only the author, Maintain, Admin or an organization Owner sees it, and only
 * while the pull request is a draft: activating it opens one confirmation with a
 * single Confirm button, which moves the same pull request from Draft to Open
 * and appends the activity record. The number, title, description, branches and
 * commits are not touched.
 */
export function PullRequestReadyForReviewControl({
  pullRequest,
  working,
  error,
  onConfirm,
}: PullRequestReadyForReviewControlProps) {
  const [confirming, setConfirming] = useState(false);
  if (pullRequest.status !== "draft" || !pullRequest.permissions.canMarkReady) return null;

  return (
    <section className="pull-request-ready" aria-label="Ready for review">
      <Button variant="primary" onClick={() => setConfirming(true)}>
        Ready for review
      </Button>
      {confirming ? (
        <Dialog
          open
          title="Ready for review"
          description="This draft pull request becomes Open so it can be reviewed and merged."
          onOpenChange={setConfirming}
          actions={
            <Button
              variant="primary"
              disabled={working}
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
            >
              Confirm
            </Button>
          }
        >
          <p>{`Mark “${pullRequest.title}” as Ready for review?`}</p>
        </Dialog>
      ) : null}
      {error ? (
        <p className="pull-request-ready__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
