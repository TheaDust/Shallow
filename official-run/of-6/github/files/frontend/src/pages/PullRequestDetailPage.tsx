import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  apiRepositoryPull,
  apiUpdatePullCheck,
  apiPullRequestReadyForReview,
  apiAddPullRequestInlineComment,
  apiSubmitPullRequestReview,
  apiPullRequestReviewerOptions,
  apiRequestPullRequestReviewer,
  apiRemovePullRequestReviewer,
  apiMergePullRequest,
  apiPullRequestState,
} from '../api';
import { useSession } from '../session';
import { formatRelativeTime } from '../format';
import DiffSummary from '../components/DiffSummary';
import DiffLines from '../components/DiffLines';
import type {
  PullRequestCheck,
  PullRequestDetail,
  PullRequestReviewDecision,
  PullRequestStatus,
} from '../types';

interface PullRequestDetailPageProps {
  owner: string;
  name: string;
  number: number;
  /** The active tab: Conversation, Commits, Files changed, or Checks. */
  tab: string;
}

type PullTab = 'conversation' | 'commits' | 'files' | 'checks';

function statusText(status: PullRequestStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'open':
      return 'Open';
    case 'closed':
      return 'Closed';
    case 'merged':
      return 'Merged';
    default:
      return status;
  }
}

/**
 * REQ-6-4: the Reviewers settings picker on the right side of the pull
 * request detail page. The trigger is a settings-icon button whose
 * accessible name is exactly “Reviewers” (only the PR author of an Open or
 * Draft PR, Maintain, Admin, or the organization Owner get it). Opening it
 * shows a textbox named “Search” and one role=option item per eligible
 * candidate reviewer whose exact accessible name is the account username;
 * options filter live as the user types (no Enter or a separate search
 * button is required) and already-requested reviewers are not offered again.
 * Clicking an option immediately saves the request (PUT) and closes the
 * picker without a separate Save action, so the username appears in the
 * Reviewers area and stays after reload. A rejected request keeps the
 * picker open and shows the server error.
 */
function ReviewerSelector({
  owner,
  name,
  number,
  reviewers,
  onChanged,
}: {
  owner: string;
  name: string;
  number: number;
  reviewers: string[];
  onChanged: (pull: PullRequestDetail, role: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // Load the eligible reviewer candidates while the page is interactive so
  // the picker can show them as soon as it is opened (the server filters
  // out ineligible accounts: non-Write/Maintain/Admin and the PR author).
  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setLoadError(false);
    apiPullRequestReviewerOptions(owner, name, number).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setOptions(result.eligible);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, number]);

  // Close the picker when the user clicks outside of it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery('');
        setActionError(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Focus the Search textbox as soon as the picker opens.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActionError(null);
    triggerRef.current?.focus();
  };

  const toggle = () => {
    setOpen((value) => !value);
    if (open) {
      setQuery('');
      setActionError(null);
      triggerRef.current?.focus();
    }
  };

  const requestedSet = new Set(reviewers);
  const trimmedQuery = query.trim().toLowerCase();
  const candidates = (options ?? []).filter(
    (username) =>
      !requestedSet.has(username) &&
      username.toLowerCase().includes(trimmedQuery)
  );
  const showNoMatch = query.trim() !== '' && candidates.length === 0;

  // REQ-6-4: clicking a candidate option immediately saves the request
  // (no separate Save action) and closes the picker; the server response
  // replaces the detail so the Reviewers area shows the username right away.
  const select = async (username: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    const result = await apiRequestPullRequestReviewer(
      owner,
      name,
      number,
      username
    );
    if (result.ok) {
      setOpen(false);
      setQuery('');
      setActionError(null);
      onChanged(result.pull, result.role);
    } else {
      setActionError(result.message);
    }
    setBusy(false);
  };

  const focusOption = (index: number) => {
    if (candidates.length === 0) {
      return;
    }
    const target = candidates[Math.max(0, Math.min(index, candidates.length - 1))];
    optionRefs.current.get(target)?.focus();
  };

  const handlePopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLLIElement>,
    username: string
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void select(username);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const index = candidates.findIndex((u) => u === username);
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const index = candidates.findIndex((u) => u === username);
      focusOption(index - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={containerRef} className="reviewer-selector">
      <button
        ref={triggerRef}
        type="button"
        className="pull-reviewer-settings-button"
        aria-label="Reviewers"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open ? (
        <div
          className="reviewer-selector-popover"
          onKeyDown={handlePopoverKeyDown}
        >
          <input
            ref={inputRef}
            type="text"
            className="reviewer-search-input"
            aria-label="Search"
            placeholder="Search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActionError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusOption(0);
              }
            }}
          />
          {loadError ? (
            <p role="alert" className="reviewer-selector-error">
              Reviewers could not be loaded.
            </p>
          ) : options === null ? (
            <p className="reviewer-selector-loading">Loading…</p>
          ) : (
            <>
              {candidates.length > 0 ? (
                <ul
                  role="listbox"
                  aria-label="Reviewers"
                  className="reviewer-option-list"
                >
                  {candidates.map((username) => (
                    <li
                      key={username}
                      ref={(node) => {
                        if (node) {
                          optionRefs.current.set(username, node);
                        } else {
                          optionRefs.current.delete(username);
                        }
                      }}
                      role="option"
                      tabIndex={-1}
                      className="reviewer-option"
                      onClick={() => void select(username)}
                      onKeyDown={(event) =>
                        handleOptionKeyDown(event, username)
                      }
                    >
                      <span className="reviewer-option-name">{username}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {showNoMatch ? (
                <p className="reviewer-no-matching">No matching reviewer</p>
              ) : null}
            </>
          )}
          {actionError ? (
            <p role="alert" className="reviewer-selector-error">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * REQ-6-1: the pull request detail page. The PR title is a heading whose
 * accessible name is exactly the persisted title and the current status is
 * visible text. Conversation, Commits, Files changed, and Checks are
 * navigation links (even when visually styled as tabs): Conversation shows
 * the description, activities, and the merge eligibility; Commits shows the
 * commits on the compare branch relative to base; Files changed shows the
 * per-file, per-line differences of the base versus the current compare
 * commit; Checks displays the `test` status of the current compare commit —
 * pending initially — and offers the repository Admin a combobox named
 * “test status” with a “Save” button to update it. A PR without 1 valid
 * non-author approval, with any valid Request changes, or with `test` not
 * equal to success is shown as unmergeable.
 *
 * REQ-6-2-4: a Draft PR shows the “Draft” status marker, a present but
 * disabled “Merge pull request” button, and — for the PR author, Maintain,
 * Admin, or the organization Owner — a “Ready for review” button that opens
 * a confirmation dialog with a single “Confirm” button. Confirming
 * transitions the same PR number to Open (the Draft marker disappears, the
 * title and branches are unchanged, and a “ready for review” activity
 * appears in Conversation); Open persists on reload.
 *
 * REQ-6-3-1: the detail page is the unified read view for the same PR
 * number. Conversation is the timeline for the author's description, the
 * ordinary discussion comments, the review summaries, and the status
 * events; Commits displays a “Commit summary” (the commits on the compare
 * branch relative to base) and Files changed displays the “Changed files”
 * summary of the current diff. All three tabs read the same persisted PR,
 * branch, and commit data and never create comments, reviews, or merges;
 * reloading preserves the heading, branches, and commits.
 */
export default function PullRequestDetailPage({
  owner,
  name,
  number,
  tab,
}: PullRequestDetailPageProps) {
  const { auth } = useSession();
  const [pull, setPull] = useState<PullRequestDetail | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // REQ-6-3-2: which file diff blocks of the Files changed view are
  // expanded (collapsed by default; expanding shows the added/deleted lines
  // and never modifies files, commits, branches, comments, or reviews).
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  // Checks-area state (admin controls).
  const [selectedStatus, setSelectedStatus] = useState<'pending' | 'success' | 'failure'>('pending');
  const [savingCheck, setSavingCheck] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // REQ-6-2-4: Ready-for-review state of a Draft PR. Only the PR author,
  // Maintain, Admin, or the organization Owner may transition it; the flow
  // uses a confirmation dialog containing a single Confirm button.
  const [readyDialogOpen, setReadyDialogOpen] = useState(false);
  const [readying, setReadying] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const readyConfirmRef = useRef<HTMLButtonElement>(null);
  const readyButtonRef = useRef<HTMLButtonElement>(null);

  // REQ-6-5: the merge confirmation state of an eligible Open PR. “Merge
  // pull request” opens a confirmation box whose only selectable method is
  // “Create a merge commit”; the box shows the satisfied/unsatisfied merge
  // conditions and a “Confirm merge” button. Confirming posts the merge;
  // on success the PR displays Merged with the merger, time, and resulting
  // commit identifier (Merged is terminal). A rejected or failed
  // confirmation shows the reasons and changes neither the target branch
  // nor the PR.
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const mergeConfirmRef = useRef<HTMLButtonElement>(null);
  const mergeButtonRef = useRef<HTMLButtonElement>(null);

  // REQ-6-6: the Close/Reopen state transition of an unmerged PR. “Close
  // pull request” immediately sets Closed (no extra confirmation dialog),
  // then “Reopen pull request” immediately restores Open. The system
  // stores the status, operator, and time and records the transition in
  // the activity timeline; closing or reopening never updates any branch.
  // A rejected or failed transition shows the server error and leaves the
  // PR unchanged.
  const [changingStatus, setChangingStatus] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);

  // REQ-6-3-4: the review form of the Files changed view — a non-author
  // Write/Maintain/Admin reviewer activates “Review changes” to open one
  // form with an optional Summary, the Comment/Approve/Request changes radio
  // controls, and a “Submit review” button. A successful submission persists
  // the decision (the Review summary in Conversation and the merge
  // eligibility read it); a rejected or failed submission keeps the form open
  // with the error and persists nothing.
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [reviewSummary, setReviewSummary] = useState('');
  const [reviewDecision, setReviewDecision] =
    useState<PullRequestReviewDecision>('comment');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  // REQ-6-4: state of the Reviewers area — which requested reviewer is
  // currently being removed and the error of a rejected removal (removing a
  // request happens immediately without a confirmation step).
  const [removingReviewer, setRemovingReviewer] = useState<string | null>(null);
  const [reviewerError, setReviewerError] = useState<string | null>(null);

  // Focus the confirmation dialog's single Confirm button when it opens and
  // restore focus to the Ready-for-review button when it closes.
  useEffect(() => {
    if (readyDialogOpen) {
      readyConfirmRef.current?.focus();
    }
  }, [readyDialogOpen]);

  // REQ-6-5: focus the merge confirmation's Confirm merge button when the
  // box opens and restore focus to the Merge pull request button when it
  // closes.
  useEffect(() => {
    if (mergeDialogOpen) {
      mergeConfirmRef.current?.focus();
    }
  }, [mergeDialogOpen]);

  useEffect(() => {
    let cancelled = false;
    setPull(null);
    setRole(null);
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    setCheckError(null);
    setExpandedFiles({});
    apiRepositoryPull(owner, name, number).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setPull(result.pull);
        setRole(result.role);
        const check = result.pull.checks?.test;
        if (check && check.status) {
          setSelectedStatus(check.status);
        }
      } else if (result.status === 403) {
        setDenied(true);
      } else {
        setNotFound(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, number]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to view pull requests in this repository.
        </p>
        {auth.status === 'ready' && !auth.user ? (
          <a className="primary-link" href="#/signin">
            Sign in
          </a>
        ) : null}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Pull request not found</h1>
        <p className="muted-text">
          Pull request #{number} does not exist in {owner}/{name} or is not
          accessible.
        </p>
      </div>
    );
  }

  const activeTab: PullTab =
    tab === 'commits' || tab === 'files' || tab === 'checks' ? tab : 'conversation';

  const tabHref = (nextTab: PullTab) =>
    `${repoBase}/pulls/${number}?tab=${nextTab}`;

  async function handleSaveCheck() {
    if (savingCheck) {
      return;
    }
    setSavingCheck(true);
    setCheckError(null);
    const result = await apiUpdatePullCheck(owner, name, number, selectedStatus);
    setSavingCheck(false);
    if (result.ok) {
      setPull(result.pull);
      setRole(result.role);
      const check = result.pull.checks?.test;
      if (check && check.status) {
        setSelectedStatus(check.status);
      }
    } else {
      setCheckError(result.message);
    }
  }

  const check: PullRequestCheck | undefined = pull?.checks?.test;
  const isAdmin = role === 'admin';

  // REQ-6-3-3: a user with Write, Maintain, or Admin who is not the PR
  // author may comment on an Open PR. Read may view; Draft does not allow
  // review submission (no Add comment buttons). The server re-checks every
  // rule on each submission.
  const canComment =
    pull !== null &&
    pull.status === 'open' &&
    auth.user !== null &&
    (role === 'write' || role === 'maintain' || role === 'admin') &&
    pull.author !== auth.user.username;

  // REQ-6-3-4: the same reviewer rule governs the “Review changes” entry —
  // a non-author Write/Maintain/Admin user may submit Comment, Approve, or
  // Request changes on an Open PR; the author and Draft PRs cannot review.
  const canReview = canComment;

  // REQ-6-4: only the PR author of an Open or Draft PR, Maintain, Admin, or
  // the organization Owner may create or delete reviewer requests (the
  // author check uses the session username against the persisted PR author;
  // role comes from the detail API). Read, Triage, Write (when not the
  // author), and visitors see the Reviewers area read-only with no modify
  // controls; the server re-checks every request.
  const canManageReviewers =
    pull !== null &&
    auth.user !== null &&
    ((pull.author === auth.user.username &&
      (pull.status === 'open' || pull.status === 'draft')) ||
      role === 'maintain' ||
      role === 'admin');

  // REQ-6-4: clicking “Remove <username>” immediately deletes the request
  // without a confirmation step; the returned detail replaces the pull
  // record so the username disappears from the Reviewers area right away
  // and stays gone after reload.
  async function handleRemoveReviewer(username: string) {
    if (removingReviewer) {
      return;
    }
    setRemovingReviewer(username);
    setReviewerError(null);
    const result = await apiRemovePullRequestReviewer(
      owner,
      name,
      number,
      username
    );
    setRemovingReviewer(null);
    if (result.ok) {
      setPull(result.pull);
      setRole(result.role);
    } else {
      setReviewerError(result.message);
    }
  }

  const openReviewForm = () => {
    setReviewError(null);
    setReviewSubmitted(false);
    setReviewFormOpen(true);
  };

  const closeReviewForm = () => {
    setReviewFormOpen(false);
    setReviewSummary('');
    setReviewDecision('comment');
    setReviewError(null);
    setSubmittingReview(false);
  };

  async function handleSubmitReview() {
    if (submittingReview) {
      return;
    }
    setSubmittingReview(true);
    setReviewError(null);
    const result = await apiSubmitPullRequestReview(owner, name, number, {
      decision: reviewDecision,
      explanation: reviewSummary,
    });
    setSubmittingReview(false);
    if (result.ok) {
      setPull(result.pull);
      setRole(result.role);
      setReviewFormOpen(false);
      setReviewSummary('');
      setReviewDecision('comment');
      setReviewSubmitted(true);
    } else {
      setReviewError(result.message);
    }
  }

  async function handleAddInlineComment(
    filePath: string,
    line: number,
    body: string,
    pending: boolean
  ): Promise<string | null> {
    const result = await apiAddPullRequestInlineComment(owner, name, number, {
      filePath,
      line,
      body,
      pending,
    });
    if (result.ok) {
      setPull(result.pull);
      setRole(result.role);
      return null;
    }
    return result.message;
  }

  // REQ-6-5: only Maintain, Admin, or the organization Owner (an effective
  // repository role of maintain or admin) may merge from the PR detail
  // page; every other role sees the disabled merge entry (the server
  // re-checks the role on every confirmation).
  const canMerge =
    pull !== null &&
    auth.user !== null &&
    (role === 'maintain' || role === 'admin');

  // REQ-6-2-4: the author, Maintain, Admin, or organization Owner may mark a
  // Draft as ready for review (the author check uses the session username
  // against the persisted PR author; role comes from the detail API).
  const canReadyForReview =
    pull !== null &&
    pull.status === 'draft' &&
    auth.user !== null &&
    (pull.author === auth.user.username ||
      role === 'maintain' ||
      role === 'admin');

  // REQ-6-6: only the PR author, Maintain, Admin, or the organization Owner
  // may close an unmerged Open or Draft PR and may reopen a Closed PR as
  // Open; for a viewer who is neither the author nor Maintain/Admin/Owner
  // both controls are absent (the server re-checks every transition). Merged
  // is terminal — the page does not display close or reopen operations for
  // a merged PR.
  const canChangeStatus =
    pull !== null &&
    auth.user !== null &&
    (pull.author === auth.user.username ||
      role === 'maintain' ||
      role === 'admin');

  const closePullRequest = () => {
    setStateError(null);
    void handleChangeStatus('closed');
  };

  const reopenPullRequest = () => {
    setStateError(null);
    void handleChangeStatus('open');
  };

  // REQ-6-6: the transition is immediate — there is no extra confirmation
  // dialog. The returned detail replaces the pull record so the status text
  // and the activity timeline update right away and stay after reload.
  async function handleChangeStatus(state: 'open' | 'closed') {
    if (changingStatus) {
      return;
    }
    setChangingStatus(true);
    setStateError(null);
    const result = await apiPullRequestState(owner, name, number, state);
    setChangingStatus(false);
    if (result.ok) {
      setPull(result.pull);
      setRole(result.role);
    } else {
      setStateError(result.message);
    }
  }

  const closeReadyDialog = () => {
    setReadyDialogOpen(false);
    readyButtonRef.current?.focus();
  };

  const handleReadyDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReadyDialog();
    }
  };

  async function handleConfirmReady() {
    if (readying) {
      return;
    }
    setReadying(true);
    setReadyError(null);
    const result = await apiPullRequestReadyForReview(owner, name, number);
    setReadying(false);
    if (result.ok) {
      setPull(result.pull);
      setRole(result.role);
      setReadyDialogOpen(false);
    } else {
      setReadyError(result.message);
    }
  }

  // REQ-6-5: the merge confirmation box. It is only opened from an enabled
  // Merge pull request button; the server rereads the target branch head,
  // the current compare commit, the merge-conflict state, and the
  // protection rules at confirmation time, so a condition that became
  // unsatisfied in the meantime is reported verbatim here and changes
  // neither the target branch nor the PR.
  const closeMergeDialog = () => {
    setMergeDialogOpen(false);
    setMergeError(null);
    mergeButtonRef.current?.focus();
  };

  const handleMergeDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMergeDialog();
    }
  };

  async function handleConfirmMerge() {
    if (merging) {
      return;
    }
    setMerging(true);
    setMergeError(null);
    const result = await apiMergePullRequest(owner, name, number);
    setMerging(false);
    if (result.ok) {
      setPull(result.pull);
      setRole(result.role);
      setMergeDialogOpen(false);
      return;
    }
    const reasonText =
      result.reasons && result.reasons.length > 0
        ? result.reasons.join(' ')
        : result.message;
    setMergeError(reasonText);
    // Re-read the detail so the page reflects the (unchanged) server state
    // and the dialog can show the now-unsatisfied conditions.
    const fresh = await apiRepositoryPull(owner, name, number);
    if (fresh.ok) {
      setPull(fresh.pull);
      setRole(fresh.role);
    }
  }

  return (
    <div className="repository-page pull-detail-page">
      <div className="pull-detail-header">
        <h1 className="pull-title">{pull ? pull.title : ''}</h1>
        <div className="pull-detail-meta">
          <span className="pull-number">#{number}</span>
          {pull ? (
            <>
              <span className={`pull-status pull-status-${pull.status}`}>
                {statusText(pull.status)}
              </span>
              <span className="pull-author">{pull.author ?? 'Unknown'}</span>
              <span className="pull-branches">
                {pull.compareBranch} → {pull.baseBranch}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <nav className="pull-tabs" aria-label="Pull request">
        <a
          className={`pull-tab${activeTab === 'conversation' ? ' active' : ''}`}
          href={tabHref('conversation')}
          aria-current={activeTab === 'conversation' ? 'page' : undefined}
        >
          Conversation
        </a>
        <a
          className={`pull-tab${activeTab === 'commits' ? ' active' : ''}`}
          href={tabHref('commits')}
          aria-current={activeTab === 'commits' ? 'page' : undefined}
        >
          Commits
        </a>
        <a
          className={`pull-tab${activeTab === 'files' ? ' active' : ''}`}
          href={tabHref('files')}
          aria-current={activeTab === 'files' ? 'page' : undefined}
        >
          Files changed
        </a>
        <a
          className={`pull-tab${activeTab === 'checks' ? ' active' : ''}`}
          href={tabHref('checks')}
          aria-current={activeTab === 'checks' ? 'page' : undefined}
        >
          Checks
        </a>
      </nav>

      {loadError ? (
        <p role="alert" className="form-error">
          The pull request could not be loaded.
        </p>
      ) : pull === null ? (
        <p className="loading">Loading…</p>
      ) : (
        <div className="pull-detail-body">
          <div className="pull-detail-main">
          {activeTab === 'conversation' ? (
            <>
              {pull.description ? (
                <div className="pull-description">{pull.description}</div>
              ) : null}
              {/* REQ-6-3-1: Conversation is the timeline for the author's
                  description, ordinary comments, review summaries, and
                  status events. The discussion comments are read-only data
                  (author, verbatim body, and time). */}
              <section
                className="pull-discussion-section"
                aria-label="Discussion"
              >
                <h2>Discussion</h2>
                {(pull.comments ?? []).length === 0 &&
                (pull.inlineComments ?? []).filter((c) => !c.pending).length === 0 ? (
                  <p className="muted-text">
                    No discussion comments yet.
                  </p>
                ) : (
                  <ul className="pull-discussion-list">
                    {(pull.comments ?? []).map((comment) => (
                      <li
                        key={comment.id}
                        className="pull-discussion-item"
                      >
                        <span className="pull-comment-author">
                          {comment.author ?? 'Unknown'}
                        </span>
                        <p className="pull-comment-body">
                          {comment.body}
                        </p>
                        {formatRelativeTime(comment.createdAt) !== '' ? (
                          <span className="pull-comment-time">
                            {formatRelativeTime(comment.createdAt)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {/* REQ-6-3-3: published inline review comments appear in
                        Conversation as well (anchored to their file path and
                        line). Pending Start-a-review drafts stay private and
                        are only shown in the diff view to their author. */}
                    {(pull.inlineComments ?? [])
                      .filter((c) => !c.pending)
                      .map((comment) => (
                        <li
                          key={comment.id}
                          className="pull-discussion-item pull-inline-comment-item"
                        >
                          <span className="pull-comment-author">
                            {comment.author ?? 'Unknown'}
                          </span>
                          <span className="pull-inline-location">
                            on {comment.filePath} line {comment.line + 1}
                          </span>
                          <p className="pull-comment-body">
                            {comment.body}
                          </p>
                          {comment.outdated ? (
                            <span className="inline-comment-outdated">
                              Outdated
                            </span>
                          ) : null}
                          {formatRelativeTime(comment.createdAt) !== '' ? (
                            <span className="pull-comment-time">
                              {formatRelativeTime(comment.createdAt)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                )}
              </section>
              <section className="pull-activity-section" aria-label="Activity">
                <h2>Activity</h2>
                <ul className="pull-activity-list">
                  {pull.activity.map((event) => (
                    <li key={`${event.type}-${event.createdAt}`} className="pull-activity-item">
                      <span className="pull-activity-actor">
                        {event.actor ?? 'Unknown'}
                      </span>{' '}
                      {event.type === 'created'
                        ? 'opened this pull request'
                        : event.type === 'ready_for_review'
                          ? 'marked this pull request as ready for review'
                          : event.type === 'merged'
                            ? 'merged this pull request'
                            : event.type === 'closed'
                              ? 'closed this pull request'
                              : event.type === 'reopened'
                                ? 'reopened this pull request'
                                : event.type.replace(/_/g, ' ')}
                      <span className="pull-activity-time">
                        {formatRelativeTime(event.createdAt) !== ''
                          ? ` · ${formatRelativeTime(event.createdAt)}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              {/* REQ-6-3-1: review summaries stay in the Conversation
                  timeline; REQ-6-3-4: each decision shows the reviewer, the
                  decision status (Approved / Changes requested / Commented),
                  the compare commit it was made on, the explanation, and the
                  time. A new decision by the same reviewer replaces the
                  reviewer's effective decision for the current compare
                  commit while the old record stays in the timeline. */}
              {(pull.reviews ?? []).length > 0 ? (
                <section
                  className="pull-review-summary-section"
                  aria-label="Review summary"
                >
                  <h2>Review summary</h2>
                  <ul className="pull-review-list">
                    {(pull.reviews ?? []).map((review) => (
                      <li key={review.id} className="pull-review-item">
                        <span className="pull-review-reviewer">
                          {review.reviewer ?? 'Unknown'}
                        </span>{' '}
                        <span
                          className={`pull-review-decision pull-review-decision-${review.decision}`}
                        >
                          {review.decision === 'approve'
                            ? 'Approved'
                            : review.decision === 'request_changes'
                              ? 'Changes requested'
                              : 'Commented'}
                        </span>
                        {review.commitId ? (
                          <code className="pull-review-commit">
                            {review.commitId.slice(0, 7)}
                          </code>
                        ) : null}
                        {review.explanation ? (
                          <p className="pull-review-explanation">
                            {review.explanation}
                          </p>
                        ) : null}
                        {formatRelativeTime(review.createdAt) !== '' ? (
                          <span className="pull-review-time">
                            · {formatRelativeTime(review.createdAt)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section className="pull-merge-section" aria-label="Merge">
                {canReadyForReview ? (
                  <button
                    ref={readyButtonRef}
                    type="button"
                    className="primary-button ready-for-review-button"
                    onClick={() => {
                      setReadyError(null);
                      setReadyDialogOpen(true);
                    }}
                  >
                    Ready for review
                  </button>
                ) : null}
                {/* REQ-6-5: Merged is terminal — a merged PR shows the
                    merger, time, and resulting commit identifier instead of
                    a merge entry. On any other status the merge entry stays
                    visible; it is only enabled for a merge-capable
                    Maintain/Admin/organization Owner on an eligible Open
                    PR, while a blocked PR keeps a visible disabled button
                    and explains its unmet review or protection condition
                    before any click. */}
                {pull.status === 'merged' ? (
                  <div className="pull-merged-summary">
                    <p className="merged-by-line">
                      Merged by {pull.mergedBy ?? 'Unknown'}
                      {pull.mergedAt &&
                      formatRelativeTime(pull.mergedAt) !== ''
                        ? ` · ${formatRelativeTime(pull.mergedAt)}`
                        : ''}
                    </p>
                    {pull.mergeCommitId ? (
                      <p className="merged-commit-line">
                        Merge commit{' '}
                        <code>{pull.mergeCommitId.slice(0, 7)}</code>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <button
                      ref={mergeButtonRef}
                      type="button"
                      className="primary-button merge-pull-request-button"
                      disabled={!(canMerge && pull.mergeable)}
                      onClick={() => {
                        setMergeError(null);
                        setMergeDialogOpen(true);
                      }}
                    >
                      Merge pull request
                    </button>
                    {/* REQ-6-6: “Close pull request” immediately sets Closed
                        without an extra confirmation dialog; when the PR is
                        Closed, “Reopen pull request” immediately restores
                        Open. The controls are only rendered for the PR
                        author, Maintain, Admin, or the organization Owner
                        (a viewer who is neither sees neither control) and
                        never for a Merged PR. The transition records the
                        operator and time in the activity timeline and never
                        updates any branch. */}
                    {canChangeStatus ? (
                      pull.status === 'open' || pull.status === 'draft' ? (
                        <button
                          type="button"
                          className="secondary-button pull-close-button"
                          disabled={changingStatus}
                          onClick={closePullRequest}
                        >
                          Close pull request
                        </button>
                      ) : pull.status === 'closed' ? (
                        <button
                          type="button"
                          className="secondary-button pull-reopen-button"
                          disabled={changingStatus}
                          onClick={reopenPullRequest}
                        >
                          Reopen pull request
                        </button>
                      ) : null
                    ) : null}
                    {stateError ? (
                      <p role="alert" className="form-error pull-state-error">
                        {stateError}
                      </p>
                    ) : null}
                    {pull.mergeable ? (
                      <p className="merge-state merge-state-ready">
                        This pull request can be merged.
                      </p>
                    ) : (
                      <div className="merge-state merge-state-blocked">
                        <p>This pull request cannot be merged.</p>
                        <ul className="merge-blocked-reasons">
                          {pull.blockedReasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* REQ-6-5: the merge confirmation box. The only selectable
                  method on the page is “Create a merge commit”; the box
                  displays the satisfied and unsatisfied merge conditions
                  and a “Confirm merge” button. Escape, the overlay, or
                  Cancel closes it and returns focus to Merge pull request. */}
              {mergeDialogOpen ? (
                <div
                  className="modal-overlay"
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) {
                      closeMergeDialog();
                    }
                  }}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="merge-dialog-title"
                    className="merge-confirm-dialog"
                    onKeyDown={handleMergeDialogKeyDown}
                  >
                    <h2 id="merge-dialog-title">Merge pull request</h2>
                    <p className="merge-dialog-pr">
                      #{pull.number} {pull.title}
                    </p>
                    <fieldset className="merge-method-field">
                      <legend>Merge method</legend>
                      <label className="merge-method-radio">
                        <input
                          type="radio"
                          name="pull-merge-method"
                          value="merge_commit"
                          checked
                          onChange={() => {
                            /* The only selectable method is preselected. */
                          }}
                        />
                        Create a merge commit
                      </label>
                    </fieldset>
                    <div className="merge-conditions">
                      <h3>Merge conditions</h3>
                      <ul className="merge-condition-list">
                        {(pull.mergeConditions ?? []).map((condition) => (
                          <li
                            key={condition.label}
                            className={
                              condition.satisfied
                                ? 'merge-condition-satisfied'
                                : 'merge-condition-unsatisfied'
                            }
                          >
                            <span aria-hidden="true">
                              {condition.satisfied ? '✓' : '✗'}
                            </span>{' '}
                            {condition.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {mergeError ? (
                      <p role="alert" className="form-error">
                        {mergeError}
                      </p>
                    ) : null}
                    <div className="merge-dialog-actions">
                      <button
                        ref={mergeConfirmRef}
                        type="button"
                        className="primary-button"
                        disabled={merging}
                        onClick={() => void handleConfirmMerge()}
                      >
                        Confirm merge
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={merging}
                        onClick={closeMergeDialog}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {readyDialogOpen ? (
            <div
              className="modal-overlay"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                  closeReadyDialog();
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="ready-for-review-dialog-title"
                className="ready-for-review-dialog"
                onKeyDown={handleReadyDialogKeyDown}
              >
                <h2 id="ready-for-review-dialog-title">Ready for review</h2>
                <p className="ready-for-review-dialog-text">
                  This pull request will be marked as ready for review and
                  its status changes from Draft to Open.
                </p>
                {readyError ? (
                  <p role="alert" className="form-error">
                    {readyError}
                  </p>
                ) : null}
                <div className="ready-for-review-dialog-actions">
                  {/* REQ-6-2-4: the confirmation is a single Confirm
                      button. */}
                  <button
                    ref={readyConfirmRef}
                    type="button"
                    className="primary-button"
                    disabled={readying}
                    onClick={() => void handleConfirmReady()}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'commits' ? (
            <section
              className="pull-commits-section"
              aria-label="Commit summary"
            >
              {/* REQ-6-3-1: the Commits view displays a Commit summary —
                  the commits on the PR's current compare branch relative to
                  base, newest first. */}
              <h2>Commit summary</h2>
              <p className="commit-summary-count">
                {pull.commits.length}{' '}
                {pull.commits.length === 1 ? 'commit' : 'commits'}
              </p>
              {pull.commits.length === 0 ? (
                <p className="muted-text">
                  No commits on the compare branch relative to the base
                  branch.
                </p>
              ) : (
                <ul className="pull-commits-list">
                  {pull.commits.map((commit) => (
                    <li key={commit.id} className="pull-commit-item">
                      <code className="pull-commit-id">{commit.shortId}</code>
                      <span className="pull-commit-message">{commit.message}</span>
                      <span className="pull-commit-meta">
                        {commit.author ?? 'Unknown'}
                        {formatRelativeTime(commit.createdAt) !== ''
                          ? ` · ${formatRelativeTime(commit.createdAt)}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {activeTab === 'files' ? (
            <section className="pull-files-section" aria-label="Files changed">
              {/* REQ-6-3-4: the reviewer activates “Review changes” to open
                  one review form with an optional Summary field, radio
                  controls named Comment / Approve / Request changes, and a
                  Submit review button. The entry is only rendered for a
                  non-author Write/Maintain/Admin reviewer on an Open PR
                  (the server re-checks every rule on submission). */}
              {canReview ? (
                <div className="pull-review-action-row">
                  <button
                    type="button"
                    className="primary-button review-changes-button"
                    aria-expanded={reviewFormOpen}
                    disabled={submittingReview}
                    onClick={openReviewForm}
                  >
                    Review changes
                  </button>
                  {reviewSubmitted ? (
                    <p role="status" className="review-submitted-status">
                      Review submitted
                    </p>
                  ) : null}
                </div>
              ) : null}
              {reviewFormOpen ? (
                <form
                  className="pull-review-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSubmitReview();
                  }}
                >
                  <div className="field">
                    <label htmlFor="pull-review-summary">Summary</label>
                    <textarea
                      id="pull-review-summary"
                      className="review-summary-textarea"
                      rows={4}
                      value={reviewSummary}
                      disabled={submittingReview}
                      onChange={(e) => {
                        setReviewSummary(e.target.value);
                        setReviewError(null);
                      }}
                    />
                  </div>
                  <fieldset className="pull-review-decision-field">
                    <legend>Review decision</legend>
                    <label className="pull-review-radio">
                      <input
                        type="radio"
                        name="pull-review-decision"
                        value="comment"
                        checked={reviewDecision === 'comment'}
                        disabled={submittingReview}
                        onChange={() => {
                          setReviewDecision('comment');
                          setReviewError(null);
                        }}
                      />
                      Comment
                    </label>
                    <label className="pull-review-radio">
                      <input
                        type="radio"
                        name="pull-review-decision"
                        value="approve"
                        checked={reviewDecision === 'approve'}
                        disabled={submittingReview}
                        onChange={() => {
                          setReviewDecision('approve');
                          setReviewError(null);
                        }}
                      />
                      Approve
                    </label>
                    <label className="pull-review-radio">
                      <input
                        type="radio"
                        name="pull-review-decision"
                        value="request_changes"
                        checked={reviewDecision === 'request_changes'}
                        disabled={submittingReview}
                        onChange={() => {
                          setReviewDecision('request_changes');
                          setReviewError(null);
                        }}
                      />
                      Request changes
                    </label>
                  </fieldset>
                  {reviewError ? (
                    <p role="alert" className="form-error">
                      {reviewError}
                    </p>
                  ) : null}
                  <div className="pull-review-form-actions">
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={submittingReview}
                    >
                      Submit review
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={submittingReview}
                      onClick={closeReviewForm}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {/* REQ-6-3-2: the aggregate statistics show the current PR's
                  number of changed files and the line counts in the format
                  "<addition count> additions, <deletion count> deletions";
                  the changed file paths appear verbatim (plain text, no
                  per-file page) and unchanged files never appear. */}
              <DiffSummary
                files={pull.filesChanged ?? []}
                additions={pull.additions ?? 0}
                deletions={pull.deletions ?? 0}
                fileHref={() => '#'}
                aggregateFormat="comma"
                links={false}
              />
              {(pull.filesChanged ?? []).map((file) => {
                const expanded = !!expandedFiles[file.path];
                const fileComments = (pull.inlineComments ?? []).filter(
                  (c) => c.filePath === file.path
                );
                return (
                  <div key={file.path} className="pull-file-diff">
                    <div className="pull-file-diff-header">
                      <h3 className="pull-file-path">{file.path}</h3>
                      <span className="diff-file-stats">
                        +{file.additions ?? 0} -{file.deletions ?? 0}
                      </span>
                      {/* REQ-6-3-2: each diff block can be expanded to show
                          the added/deleted lines; expanding is read-only. */}
                      <button
                        type="button"
                        className="diff-expand-button"
                        aria-expanded={expanded}
                        aria-label={
                          expanded
                            ? `Collapse diff for ${file.path}`
                            : `Expand diff for ${file.path}`
                        }
                        onClick={() =>
                          setExpandedFiles((prev) => ({
                            ...prev,
                            [file.path]: !prev[file.path],
                          }))
                        }
                      >
                        {expanded ? 'Collapse' : 'Expand'}
                      </button>
                    </div>
                    {/* REQ-6-3-3: inline comments stay visible in the diff
                        view whether the block is expanded or collapsed —
                        published comments show author, body, line, and the
                        Outdated marker when the compare commit moved; the
                        author's pending Start-a-review drafts show the
                        Pending review marker and are never public. */}
                    {fileComments.length > 0 ? (
                      <ul className="pull-file-inline-comments">
                        {fileComments.map((comment) => (
                          <li key={comment.id} className="pull-file-inline-comment">
                            <span className="inline-comment-author">
                              {comment.author ?? 'Unknown'}
                            </span>
                            <span className="inline-comment-line">
                              line {comment.line + 1}
                            </span>
                            {comment.pending ? (
                              <span className="inline-comment-pending">
                                Pending review
                              </span>
                            ) : null}
                            {comment.outdated ? (
                              <span className="inline-comment-outdated">
                                Outdated
                              </span>
                            ) : null}
                            <p className="inline-comment-body">
                              {comment.body}
                            </p>
                            {formatRelativeTime(comment.createdAt) !== '' ? (
                              <span className="inline-comment-time">
                                {formatRelativeTime(comment.createdAt)}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {expanded ? (
                      <DiffLines
                        lines={file.lines ?? []}
                        canComment={canComment}
                        onSubmitComment={
                          canComment
                            ? (line, body, pending) =>
                                handleAddInlineComment(
                                  file.path,
                                  line,
                                  body,
                                  pending
                                )
                            : undefined
                        }
                      />
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}

          {activeTab === 'checks' ? (
            <section className="pull-checks-section" aria-label="Checks">
              <h2>Checks</h2>
              {check ? (
                <div className="check-run-row">
                  <span className="check-run-name">test</span>
                  <span className={`check-run-status check-run-${check.status}`}>
                    test: {check.status}
                  </span>
                  {check.setter ? (
                    <span className="check-run-meta">
                      Set by {check.setter}
                      {check.updatedAt && formatRelativeTime(check.updatedAt) !== ''
                        ? ` · ${formatRelativeTime(check.updatedAt)}`
                        : ''}
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="muted-text">No checks.</p>
              )}
              {isAdmin ? (
                <div className="check-status-form">
                  <div className="field check-status-field">
                    <label htmlFor="test-status-select">test status</label>
                    <select
                      id="test-status-select"
                      value={selectedStatus}
                      onChange={(e) => {
                        setSelectedStatus(e.target.value as 'pending' | 'success' | 'failure');
                        setCheckError(null);
                      }}
                    >
                      <option value="pending">pending</option>
                      <option value="success">success</option>
                      <option value="failure">failure</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={savingCheck}
                    onClick={() => void handleSaveCheck()}
                  >
                    Save
                  </button>
                </div>
              ) : null}
              {checkError ? (
                <p role="alert" className="form-error">
                  {checkError}
                </p>
              ) : null}
            </section>
          ) : null}
          </div>
          {/* REQ-6-4: the Reviewers area on the right side of the PR detail
              page. A reviewer request is a pending-review relationship
              between the PR and a candidate reviewer account — displayed
              here, it is not the same as a submitted review decision. Only
              the PR author of an Open or Draft PR, Maintain, Admin, or the
              organization Owner get the settings picker and the Remove
              buttons; every other viewer sees the requested set read-only
              (the server re-checks the permission on each request). */}
          <aside className="pull-page-sidebar">
            <div className="pull-reviewer-section">
              <div className="pull-reviewer-section-header">
                <h2>Reviewers</h2>
                {canManageReviewers ? (
                  <ReviewerSelector
                    owner={owner}
                    name={name}
                    number={pull.number}
                    reviewers={pull.reviewers ?? []}
                    onChanged={(updated, updatedRole) => {
                      setPull(updated);
                      setRole(updatedRole);
                    }}
                  />
                ) : null}
              </div>
              {reviewerError ? (
                <p role="alert" className="form-error pull-reviewer-error">
                  {reviewerError}
                </p>
              ) : null}
              {(pull.reviewers ?? []).length === 0 ? (
                <p className="muted-text">No reviewers</p>
              ) : (
                <ul className="pull-reviewer-list">
                  {(pull.reviewers ?? []).map((username) => (
                    <li key={username} className="pull-reviewer-item">
                      <span className="pull-reviewer-name">{username}</span>
                      {canManageReviewers ? (
                        <button
                          type="button"
                          className="pull-reviewer-remove-button"
                          disabled={removingReviewer === username}
                          onClick={() => void handleRemoveReviewer(username)}
                        >
                          Remove {username}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
