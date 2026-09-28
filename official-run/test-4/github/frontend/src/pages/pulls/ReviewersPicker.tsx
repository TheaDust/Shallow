import { useState } from "react";

import { PullDetail, removeReviewer, requestReviewer } from "../../lib/pull-api";
import { RepoOwnerType } from "../../lib/repo-api";

interface ReviewersPickerProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  detail: PullDetail;
  onChanged: (pull: PullDetail) => void;
}

/**
 * The Reviewers area on the right side of the PR detail page (REQ-6-4): the
 * Reviewers button opens a picker with a Search textbox; typing an eligible
 * username immediately reveals an option with that exact accessible name.
 * Selecting the option saves the request immediately without a separate Save
 * action, closes the picker, and displays the username in the reviewer area.
 * Each requested reviewer has a Remove <username> button that immediately
 * removes the request without a confirmation step.
 */
export function ReviewersPicker({ ownerType, ownerName, repoName, detail, onChanged }: ReviewersPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches =
    query.trim().length === 0
      ? (detail.reviewerCandidates ?? [])
      : (detail.reviewerCandidates ?? []).filter((candidate) =>
          candidate.username.toLowerCase().includes(query.trim().toLowerCase()),
        );

  async function selectReviewer(username: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await requestReviewer(ownerType, ownerName, repoName, detail.number, username);
      if (outcome.ok) {
        setPickerOpen(false);
        setQuery("");
        onChanged(outcome.pull);
      } else {
        setError(
          typeof outcome.errors.username === "string"
            ? outcome.errors.username
            : "Could not request the reviewer",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(username: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await removeReviewer(ownerType, ownerName, repoName, detail.number, username);
      if (outcome.ok) {
        onChanged(outcome.pull);
      } else {
        setError(
          typeof outcome.errors.username === "string"
            ? outcome.errors.username
            : "Could not remove the reviewer",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pull-sidebar__section" aria-label="Reviewers">
      <h3>Reviewers</h3>
      {(detail.reviewers ?? []).length === 0 ? (
        <p className="pull-sidebar__empty">No reviewers</p>
      ) : (
        <ul className="pull-reviewers">
          {detail.reviewers.map((reviewer) => (
            <li key={reviewer.id} className="pull-reviewers__item">
              <span className="pull-reviewers__name">{reviewer.username}</span>
              {detail.canRequestReviewers && (
                <button
                  type="button"
                  className="button pull-reviewers__remove"
                  onClick={() => void remove(reviewer.username)}
                >
                  Remove {reviewer.username}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.canRequestReviewers && (
        <div className="reviewers-picker">
          {!pickerOpen && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setPickerOpen(true);
                setQuery("");
                setError(null);
              }}
            >
              Reviewers
            </button>
          )}
          {pickerOpen && (
            <div className="reviewers-picker__panel">
              <label className="account-form__label" htmlFor="reviewer-search">
                Search
              </label>
              <input
                id="reviewer-search"
                className="account-form__input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <ul className="reviewers-picker__options" role="listbox" aria-label="Reviewer options">
                {matches.length === 0 ? (
                  <li className="reviewers-picker__empty">No matching reviewer</li>
                ) : (
                  matches.map((candidate) => (
                    <li key={candidate.username}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        className="reviewers-picker__option"
                        disabled={busy}
                        onClick={() => void selectReviewer(candidate.username)}
                      >
                        {candidate.username}
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {error && (
                <p role="alert" className="branch-selector__error">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
