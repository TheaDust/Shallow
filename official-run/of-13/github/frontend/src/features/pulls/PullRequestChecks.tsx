import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  updatePullRequestCheckStatus,
  type PullRequestCheckStatus,
  type RepositoryPullRequestDetail,
} from "../../lib/pull-requests-api";
import { Button } from "../../ui";
import { formatPullRequestTime } from "./pull-format";

export interface PullRequestChecksProps {
  owner: string;
  name: string;
  detail: RepositoryPullRequestDetail;
  /** The answer of an accepted save: the page shows the stored record. */
  onUpdated(detail: RepositoryPullRequestDetail): void;
}

/** The states the `test status` combobox offers, in order. */
const CHECK_OPTIONS: Array<{ value: PullRequestCheckStatus; label: string }> = [
  { value: "pending", label: "pending" },
  { value: "success", label: "success" },
  { value: "failure", label: "failure" },
];

/**
 * The `Checks` area of one pull request: the results attached to its current
 * compare commit. The supported `test` check is always shown with its stored
 * state — `pending` while that commit carries no result — together with the
 * setter and the time of the stored one.
 *
 * Only a repository Admin is offered the `test status` combobox and the `Save`
 * button. The combobox opens the three selectable items (`pending`, `success`
 * and `failure`) on click; picking one only changes the pending choice, and
 * `Save` stores it for the current compare commit. The server re-checks the
 * stored role and binds the result to the commit it was saved for.
 */
export function PullRequestChecks({
  owner,
  name,
  detail,
  onUpdated,
}: PullRequestChecksProps) {
  const { pullRequest } = detail;
  const check = detail.checks.find((candidate) => candidate.name === "test") ?? null;
  const current: PullRequestCheckStatus = check?.status ?? "pending";
  const canAdminister = detail.viewerRole === "admin";

  const listboxId = useId();
  const valueId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PullRequestCheckStatus>(current);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The area always follows the stored record; a refused save leaves it as is.
  useEffect(() => {
    setStatus(current);
    setError(null);
    setOpen(false);
  }, [current, pullRequest.number, pullRequest.mergeCommitSha]);

  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [open]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onUpdated(
        await updatePullRequestCheckStatus(owner, name, pullRequest.number, {
          name: "test",
          status,
        }),
      );
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The check status was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pull-request-checks" aria-label="Checks">
      {/* The status of the check is one visible value with its setter. */}
      <p className="pull-request-checks__status">{`test: ${current}`}</p>
      {check && check.updatedBy ? (
        <p className="pull-request-checks__setter">
          {`Updated by ${check.updatedBy} on ${formatPullRequestTime(check.updatedAt ?? "")}`}
        </p>
      ) : null}
      {canAdminister ? (
        <div className="pull-request-checks__controls" ref={containerRef}>
          <span className="pull-request-checks__label" aria-hidden="true">
            test status
          </span>
          <div className="pull-request-checks__combobox">
            <button
              type="button"
              role="combobox"
              aria-label="test status"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={listboxId}
              className="pull-request-checks__combobox-trigger"
              disabled={busy}
              onClick={() => setOpen((value) => !value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setOpen(true);
                } else if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
            >
              <span id={valueId}>{status}</span>
            </button>
            {open ? (
              <ul
                id={listboxId}
                className="pull-request-checks__options"
                role="listbox"
                aria-label="test status options"
              >
                {CHECK_OPTIONS.map((option) => (
                  <li
                    key={option.value}
                    role="option"
                    tabIndex={-1}
                    aria-selected={option.value === status}
                    className="pull-request-checks__option"
                    onClick={() => {
                      if (busy) return;
                      setStatus(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="pull-request-checks__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
