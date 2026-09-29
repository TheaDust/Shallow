import { useEffect, useState } from "react";

import { formatUpdatedTime } from "../../lib/format";
import { Button } from "../../ui";
import type { CheckStatus } from "./api";

// The Checks results area on the PR detail page, attached to the current
// compare commit. It is available on arrival and displays `test: pending`
// initially. Only a repository Admin may update the status from this area;
// saving displays the new status together with the setter and time.
export function ChecksPanel({
  status,
  setter,
  setAt,
  canUpdate,
  onSave,
}: {
  status: CheckStatus;
  setter: string | null;
  setAt: string | null;
  canUpdate: boolean;
  onSave(status: CheckStatus): Promise<boolean>;
}) {
  const [selected, setSelected] = useState<CheckStatus>(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(status);
  }, [status]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await onSave(selected);
    setBusy(false);
    if (!ok) {
      setError("Unable to save the check status");
    }
  };

  return (
    <section className="checks-panel" aria-label="Checks">
      <h3 className="checks-panel__heading">Checks</h3>
      <p className="checks-panel__status">
        test: {status}
        {setter && setAt ? (
          <span className="checks-panel__meta">
            {" "}
            — set by {setter} at {formatUpdatedTime(setAt)}
          </span>
        ) : null}
      </p>
      {canUpdate ? (
        <div className="checks-panel__form">
          <label htmlFor="test-status-select">test status</label>
          <select
            id="test-status-select"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value as CheckStatus);
              setError(null);
            }}
          >
            <option value="pending">pending</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
          </select>
          <Button disabled={busy} onClick={() => void save()}>
            Save
          </Button>
          {error ? (
            <p role="alert" className="checks-panel__error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
