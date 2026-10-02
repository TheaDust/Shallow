import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../../ui";
import type { PullRequestDetail } from "./pull-request-api";

export interface PullRequestReviewersProps {
  pullRequest: PullRequestDetail;
  /** Requests one eligible account; the server stores the relationship. */
  onRequest(username: string): Promise<{ ok: boolean; message?: string }>;
  /** Deletes the pending-review relationship of one account. */
  onRemove(username: string): Promise<{ ok: boolean; message?: string }>;
}

/**
 * The Reviewers area of a pull request detail page (REQ-6-4).
 *
 * It lists the pending-review relationships of the proposal — never a submitted
 * review decision — and each requested account carries the button
 * `Remove <username>`. The author of an Open or Draft pull request, a Maintain,
 * an Admin and an organization Owner additionally get the `Reviewers` button:
 * it opens the picker with the `Search` textbox whose matching candidates are
 * offered as options named exactly after their usernames. Typing narrows the
 * candidates as the user types, and selecting one stores the request right away
 * — without a separate Save action — closes the picker and leaves the username
 * in this area. Deleting a request happens just as directly: one click on the
 * remove button, without a confirmation step.
 */
export function PullRequestReviewers({ pullRequest, onRequest, onRemove }: PullRequestReviewersProps) {
  const { permissions, reviewerCandidates, reviewers } = pullRequest;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    inputRef.current?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const canManage = permissions.canRequestReviewers;
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? reviewerCandidates.filter((candidate) => candidate.username.toLowerCase().includes(needle))
    : reviewerCandidates;

  const close = () => {
    setOpen(false);
    setQuery("");
    setError(null);
  };

  async function request(username: string) {
    setWorking(true);
    setError(null);
    const result = await onRequest(username);
    setWorking(false);
    if (!result.ok) {
      setError(result.message ?? "The reviewer request could not be saved.");
      return;
    }
    close();
    triggerRef.current?.focus();
  }

  async function remove(username: string) {
    setWorking(true);
    setError(null);
    const result = await onRemove(username);
    setWorking(false);
    if (!result.ok) setError(result.message ?? "The reviewer request could not be removed.");
  }

  return (
    <section className="pull-request-reviewers" aria-label="Reviewers">
      <h2 className="pull-request-reviewers__heading">Reviewers</h2>
      {canManage ? (
        <div className="pull-request-reviewers__picker" ref={rootRef}>
          <Button
            ref={triggerRef}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => {
              setQuery("");
              setError(null);
              setOpen((value) => !value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.preventDefault();
                close();
              }
            }}
          >
            Reviewers
          </Button>
          {open ? (
            <div className="pull-request-reviewers__popover">
              <label className="pull-request-reviewers__search" htmlFor={`${listId}-input`}>
                <span>Search</span>
                <input
                  id={`${listId}-input`}
                  ref={inputRef}
                  type="text"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      close();
                      triggerRef.current?.focus();
                    }
                  }}
                />
              </label>
              <ul className="pull-request-reviewers__options" id={listId} role="listbox" aria-label="Reviewer candidates">
                {matching.map((candidate) => (
                  <li
                    key={candidate.username}
                    role="option"
                    aria-selected={reviewers.some((reviewer) => reviewer.username === candidate.username)}
                    aria-disabled={working || undefined}
                    tabIndex={-1}
                    className="pull-request-reviewers__option"
                    onClick={() => {
                      if (!working) void request(candidate.username);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (!working) void request(candidate.username);
                      }
                    }}
                  >
                    {candidate.username}
                  </li>
                ))}
              </ul>
              {matching.length === 0 ? (
                <p className="pull-request-reviewers__empty">No matching reviewer</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {reviewers.length > 0 ? (
        <ul className="pull-request-reviewers__list">
          {reviewers.map((reviewer) => (
            <li key={reviewer.username} className="pull-request-reviewer">
              <span className="pull-request-reviewer__name">{reviewer.username}</span>
              {canManage ? (
                <Button
                  disabled={working}
                  onClick={() => {
                    void remove(reviewer.username);
                  }}
                >
                  {`Remove ${reviewer.username}`}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pull-request-reviewers__none">No reviewers requested.</p>
      )}
      {error ? (
        <p className="pull-request-reviewers__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
