import { useState } from "react";

import {
  removeRepositoryPullRequestReviewer,
  requestRepositoryPullRequestReviewer,
} from "../lib/org-api";
import { Button, Dialog } from "../ui";

export interface PullRequestReviewersProps {
  owner: string;
  name: string;
  number: string;
  /** The pending reviewer requests currently stored on the pull request. */
  requested: readonly string[];
  /** The eligible collaborators the author or a maintainer may request. */
  available: readonly string[];
  /** The author or a Maintain/Admin/Owner manages the requests (REQ-6-4). */
  canManage: boolean;
  /** Reloads the pull request after a request is saved or removed. */
  onChanged(): void;
}

/**
 * The `Reviewers` management of one pull request (REQ-6-4). The unique
 * `Reviewers` button opens a picker whose `Search` textbox filters the eligible
 * collaborators while typing; selecting one saves the pending request
 * immediately, so the exact username stays visible after reload until
 * `Remove <username>` deletes it without touching any submitted review.
 */
export function PullRequestReviewers({
  owner,
  name,
  number,
  requested,
  available,
  canManage,
  onChanged,
}: PullRequestReviewersProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setQuery("");
    setError(null);
  };

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? available.filter((username) => username.toLowerCase().includes(needle))
    : [...available];

  const request = async (username: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await requestRepositoryPullRequestReviewer(owner, name, number, username);
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors.reviewer ?? result.message);
      return;
    }
    close();
    onChanged();
  };

  const remove = async (username: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await removeRepositoryPullRequestReviewer(owner, name, number, username);
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors.reviewer ?? result.message);
      return;
    }
    onChanged();
  };

  return (
    <section className="pull-reviewers" aria-label="Reviewers">
      {canManage ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Reviewers
        </Button>
      ) : null}
      {requested.length === 0 ? (
        <p className="pull-reviewers__empty">No reviewers requested.</p>
      ) : (
        <ul className="pull-reviewers__list">
          {requested.map((username) => (
            <li key={username} className="pull-reviewers__item">
              <span className="pull-reviewers__name">{username}</span>
              {canManage ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Remove ${username}`}
                  onClick={() => void remove(username)}
                >
                  {`Remove ${username}`}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error && !open ? (
        <p className="pull-reviewers__error" role="alert">
          {error}
        </p>
      ) : null}
      {open ? (
        <Dialog
          open
          title="Reviewers"
          onOpenChange={(next) => (next ? setOpen(true) : close())}
        >
          <label htmlFor="pull-reviewer-search">Search</label>
          <input
            id="pull-reviewer-search"
            className="pull-reviewers__search"
            type="text"
            name="reviewer-search"
            aria-label="Search"
            placeholder="Search"
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError(null);
            }}
          />
          <ul className="pull-reviewers__options" role="listbox" aria-label="Reviewers">
            {matching.map((username) => (
              <li key={username}>
                <button
                  type="button"
                  role="option"
                  className="pull-reviewers__option"
                  disabled={busy}
                  onClick={() => void request(username)}
                >
                  {username}
                </button>
              </li>
            ))}
          </ul>
          {matching.length === 0 ? (
            <p className="pull-reviewers__message" role="status">
              No matching reviewer
            </p>
          ) : null}
          {error ? (
            <p className="pull-reviewers__message" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </section>
  );
}
