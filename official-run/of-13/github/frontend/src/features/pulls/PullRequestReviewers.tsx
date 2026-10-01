import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  removePullRequestReviewer,
  requestPullRequestReviewer,
  type RepositoryPullRequestDetail,
} from "../../lib/pull-requests-api";
import { Button, Dialog } from "../../ui";

export interface PullRequestReviewersProps {
  owner: string;
  name: string;
  detail: RepositoryPullRequestDetail;
  /** The answer of an accepted request: the page shows the stored record. */
  onUpdated(detail: RepositoryPullRequestDetail): void;
}

/**
 * The `Reviewers` area on the right of one pull request detail page: the stored
 * reviewer requests of the record, and — for the author of an Open or Draft
 * pull request, a Maintain, an Admin or the organization Owner — the
 * `Reviewers` button that opens the picker. The picker holds one textbox named
 * `Search`; the matching candidates update while the user types, so selecting
 * an option stores the request immediately and closes the picker. Every
 * requested reviewer carries its own `Remove <username>` button, which deletes
 * the relationship at once and without a confirmation step.
 */
export function PullRequestReviewers({
  owner,
  name,
  detail,
  onUpdated,
}: PullRequestReviewersProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const listboxId = useId();

  const { pullRequest } = detail;
  const requested = pullRequest.reviewers;
  const canManage = detail.canRequestReviewers;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      setError(null);
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  // The candidate options follow the typed text without any submit; the stored
  // requests stay offered, so requesting an already requested reviewer is a
  // stored no-op instead of a dead end.
  const trimmed = query.trim();
  const candidates = trimmed.length === 0
    ? detail.reviewerCandidates
    : detail.reviewerCandidates.filter((username) =>
        username.toLowerCase().includes(trimmed.toLowerCase()),
      );

  async function request(username: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await requestPullRequestReviewer(owner, name, pullRequest.number, username));
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The reviewer was not requested.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(username: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await removePullRequestReviewer(owner, name, pullRequest.number, username));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The reviewer was not removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pull-request-reviewers" aria-label="Reviewers">
      {canManage ? (
        <Button
          type="button"
          variant="ghost"
          className="pull-request-reviewers__trigger"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          Reviewers
        </Button>
      ) : null}
      {requested.length === 0 ? (
        <p className="pull-request-reviewers__empty" role="status">
          {canManage ? "No reviewers requested" : "No reviewers"}
        </p>
      ) : (
        <ul className="pull-request-reviewers__list">
          {requested.map((username) => (
            <li key={username} className="pull-request-reviewers__item">
              <span className="pull-request-reviewers__name">{username}</span>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="pull-request-reviewers__remove"
                  aria-label={`Remove ${username}`}
                  disabled={busy}
                  onClick={() => void remove(username)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="pull-request-reviewers__error" role="alert">
          {error}
        </p>
      ) : null}
      {open ? (
        <Dialog open title="Reviewers" onOpenChange={setOpen}>
          <label className="pull-request-reviewers__field" htmlFor={searchId}>
            Search
          </label>
          <input
            id={searchId}
            ref={inputRef}
            className="pull-request-reviewers__search"
            type="text"
            name="reviewer-search"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const option = candidates[activeIndex];
                if (!option || busy) return;
                void request(option);
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (candidates.length === 0) return;
                setActiveIndex((index) => {
                  const next = index + (event.key === "ArrowDown" ? 1 : -1);
                  return (next + candidates.length) % candidates.length;
                });
              }
            }}
          />
          {candidates.length === 0 ? (
            <p className="pull-request-reviewers__nomatch" role="status">
              No matching reviewer
            </p>
          ) : (
            <ul
              id={listboxId}
              className="pull-request-reviewers__options"
              role="listbox"
              aria-label="Reviewer candidates"
            >
              {candidates.map((username, index) => (
                <li
                  key={username}
                  role="option"
                  tabIndex={-1}
                  aria-selected={requested.includes(username)}
                  className="pull-request-reviewers__option"
                  data-active={index === activeIndex || undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    if (busy) return;
                    void request(username);
                  }}
                >
                  {username}
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      ) : null}
    </section>
  );
}
