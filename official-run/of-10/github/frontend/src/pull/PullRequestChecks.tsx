import { useEffect, useState, type FormEvent } from "react";

import { apiErrorMessage } from "../lib/api";
import {
  CHECK_STATUSES,
  REQUIREMENT_CHECK_NAME,
  savePullRequestCheck,
  type CheckStatus,
  type PullRequestPayload,
} from "../lib/pull-requests-api";
import { issueDateTime } from "../lib/issue-dates";
import { Button, ListboxCombobox } from "../ui";

export interface PullRequestChecksProps {
  owner: string;
  name: string;
  number: number;
  checks: PullRequestPayload["pullRequest"]["checks"];
  /** Only a repository Admin updates the check status (REQ-6-1). */
  canSetStatus: boolean;
  onSaved(value: PullRequestPayload): void;
}

/**
 * The Checks area of one pull request (REQ-6-1): the `test` result of the
 * pull-request's current compare commit. A commit without a stored result reads
 * as pending, so a new compare commit never inherits the previous success. A
 * repository Admin selects another status in the `test status` combobox and
 * saves it; the stored result then names the setter and the time, and reloading
 * the page reads the same record for the same commit.
 */
export function PullRequestChecks({
  owner,
  name,
  number,
  checks,
  canSetStatus,
  onSaved,
}: PullRequestChecksProps) {
  const current = checks.find((check) => check.name === REQUIREMENT_CHECK_NAME) ?? checks[0];
  const [draft, setDraft] = useState<CheckStatus>(current?.status ?? "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current) setDraft(current.status);
  }, [current?.status, current?.commitId]);

  if (!current) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await savePullRequestCheck(owner, name, number, draft);
      onSaved(payload);
    } catch (caught) {
      setError(apiErrorMessage(caught, "The check status could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pull-checks" aria-labelledby="pull-checks-heading">
      <h2 id="pull-checks-heading" className="pull-section-heading">
        Checks
      </h2>
      <p className="pull-check__status">
        {`${current.name}: ${current.status}`}
      </p>
      {current.setBy && current.setAt ? (
        <p className="pull-check__meta">
          {"Set by "}
          <span className="pull-check__setter">{current.setBy}</span>
          {" at "}
          <time dateTime={current.setAt}>{issueDateTime(current.setAt)}</time>
        </p>
      ) : null}
      {canSetStatus ? (
        <form className="pull-check__form" onSubmit={(event) => void save(event)}>
          <ListboxCombobox
            id={`pull-check-status-${number}`}
            label="test status"
            value={draft}
            options={CHECK_STATUSES.map((status) => ({ value: status, label: status }))}
            onChange={(value) => setDraft(value as CheckStatus)}
            disabled={busy}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="form-message form-message--error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
