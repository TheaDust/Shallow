import { useId, useMemo, useRef, useState } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  removePullRequestReviewer,
  requestPullRequestReviewer,
  type PullRequestPayload,
} from "../lib/pull-requests-api";
import { Button } from "../ui";

export interface PullRequestReviewersProps {
  owner: string;
  name: string;
  number: number;
  /** The accounts currently asked to review, in the stored order. */
  requestedReviewers: readonly string[];
  /** Accounts that may be asked: Write or higher on the repository, not the author. */
  candidates: readonly string[];
  /** The author of an Open or Draft proposal, Maintain, Admin or the Owner. */
  canRequest: boolean;
  /** The stored answer of an accepted or withdrawn request. */
  onSaved(payload: PullRequestPayload): void;
}

/**
 * The Reviewers area on the right side of a pull request (REQ-6-4): a `Reviewers`
 * button opens a picker whose textbox is named `Search`. Typing an eligible
 * username immediately shows an option with that exact accessible name; choosing
 * it saves the reviewer request right away and without a separate save action,
 * closes the picker and displays the account in the area. Every requested account
 * carries its own `Remove <username>` button, which withdraws the request
 * immediately and without a confirmation step while keeping that account's
 * reviews, comments and activity records. A viewer who is neither the author nor
 * a maintainer sees no request and no remove entry, and the server refuses the
 * same requests.
 */
export function PullRequestReviewers({
  owner,
  name,
  number,
  requestedReviewers,
  candidates,
  canRequest,
  onSaved,
}: PullRequestReviewersProps) {
  const inputId = `pull-reviewers-search-${useId()}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const needle = query.trim().toLowerCase();
  const matching = useMemo(
    () =>
      candidates.filter((candidate) => needle === "" || candidate.toLowerCase().includes(needle)),
    [candidates, needle],
  );

  async function run(action: () => Promise<PullRequestPayload>, fallback: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      onSaved(await action());
      setOpen(false);
      setQuery("");
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.username ?? apiErrorMessage(caught, fallback));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const request = (username: string) =>
    run(
      () => requestPullRequestReviewer(owner, name, number, username),
      "The reviewer request could not be saved.",
    );

  return (
    <section className="pull-reviewers" aria-labelledby="pull-reviewers-heading">
      <h3 id="pull-reviewers-heading" className="pull-section-heading">
        Reviewers
      </h3>
      {requestedReviewers.length === 0 ? (
        <p className="pull-reviewers__empty">No reviewers requested.</p>
      ) : (
        <ul className="pull-reviewers__list">
          {requestedReviewers.map((username) => (
            <li key={username} className="pull-reviewers__item">
              <span className="pull-reviewers__username">{username}</span>
              {canRequest ? (
                <Button
                  className="pull-reviewers__remove"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => removePullRequestReviewer(owner, name, number, username),
                      "The reviewer request could not be removed.",
                    )
                  }
                >
                  {`Remove ${username}`}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canRequest ? (
        <div className="pull-reviewers__picker">
          <Button
            aria-expanded={open}
            disabled={busy}
            onClick={() => {
              setQuery("");
              setOpen((current) => !current);
            }}
          >
            Reviewers
          </Button>
          {open ? (
            <div className="pull-reviewers__panel">
              <label className="pull-reviewers__label" htmlFor={inputId}>
                Search
              </label>
              <input
                id={inputId}
                className="pull-reviewers__input"
                type="text"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <ul className="pull-reviewers__options" role="listbox" aria-label="Reviewers">
                {matching.map((username) => (
                  <li
                    key={username}
                    role="option"
                    aria-selected={false}
                    tabIndex={-1}
                    className="pull-reviewers__option"
                    onClick={() => void request(username)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void request(username);
                      }
                    }}
                  >
                    {username}
                  </li>
                ))}
                {needle !== "" && matching.length === 0 ? (
                  <li className="pull-reviewers__none">No matching reviewer</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="form-message form-message--error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
