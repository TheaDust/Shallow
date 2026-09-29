import { useState } from "react";

import { Button, Dialog } from "../../ui";

// Merge area of an eligible Open PR. The only supported merge method is
// "Create a merge commit"; confirming displays Merged and that state remains
// after reload. A blocked PR keeps a visible disabled Merge pull request
// button and explains its unmet review or protection condition before any
// click.
export function MergeBox({
  eligible,
  reasons,
  conditions = [],
  onMerge,
}: {
  eligible: boolean;
  reasons: string[];
  conditions?: Array<{ label: string; satisfied: boolean }>;
  onMerge(): Promise<boolean>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmMerge = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await onMerge();
    setBusy(false);
    if (ok) {
      setConfirmOpen(false);
    } else {
      setError("The pull request could not be merged");
    }
  };

  return (
    <section className="merge-box" aria-label="Merge pull request">
      {reasons.length > 0 ? (
        <div className="merge-box__reasons">
          {reasons.map((reason) => (
            <p key={reason} className="merge-box__reason">
              {reason}
            </p>
          ))}
        </div>
      ) : null}
      <Button variant="primary" disabled={!eligible || busy} onClick={() => setConfirmOpen(true)}>
        Merge pull request
      </Button>

      <Dialog
        open={confirmOpen}
        title="Merge pull request"
        onOpenChange={setConfirmOpen}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void confirmMerge()}>
              Confirm merge
            </Button>
          </>
        }
      >
        <p>
          Merge the changes into the base branch by creating a merge commit. The
          merge method is <strong>Create a merge commit</strong>.
        </p>
        {conditions.length > 0 ? (
          <ul className="merge-box__conditions">
            {conditions.map((condition) => (
              <li
                key={condition.label}
                className={`merge-box__condition ${
                  condition.satisfied
                    ? "merge-box__condition--satisfied"
                    : "merge-box__condition--unsatisfied"
                }`}
              >
                {condition.label}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="merge-box__error">
            {error}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
