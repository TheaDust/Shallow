import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  apiAddIssueComment,
  apiAddIssueLabel,
  apiAssignIssue,
  apiClearIssueMilestone,
  apiEditIssue,
  apiIssueAssigneeOptions,
  apiIssueLabelOptions,
  apiIssueMilestoneOptions,
  apiRemoveIssueLabel,
  apiRepositoryIssue,
  apiSetIssueMilestone,
  apiSetIssueState,
  apiToggleCommentReaction,
  apiToggleIssueReaction,
  apiUnassignIssue,
} from '../api';
import { useSession } from '../session';
import { formatRelativeTime } from '../format';
import type {
  IssueDetail,
  IssueEditErrors,
  IssueReactionGroup,
} from '../types';

interface IssueDetailPageProps {
  owner: string;
  name: string;
  number: number;
}

/**
 * REQ-5-2-2/REQ-5-2-3: roles allowed to edit an issue title/description and
 * to append discussion comments (Read and Triage may only view; the server
 * re-checks the role on every submission).
 */
const ISSUE_EDIT_ROLES = new Set(['write', 'maintain', 'admin']);

/**
 * REQ-5-3-1: roles allowed to assign/unassign issue participants. This is
 * the explicit module rule — Triage, Maintain, or Admin may assign; Write
 * (which may create/edit/comment) and Read are not assignable.
 */
const ASSIGN_ROLES = new Set(['triage', 'maintain', 'admin']);

/**
 * REQ-5-3-2: roles allowed to apply/remove labels. Same explicit module rule
 * as assignment — Triage, Maintain, or Admin; Write and Read may only view
 * labels.
 */
const LABEL_ROLES = new Set(['triage', 'maintain', 'admin']);

/**
 * REQ-5-3-3: roles allowed to set/remove an issue's milestone. Same explicit
 * module rule as assignment and labels — Triage, Maintain, or Admin; Write
 * and Read may only view the current milestone.
 */
const MILESTONE_ROLES = new Set(['triage', 'maintain', 'admin']);

/**
 * REQ-5-4: roles allowed to close or reopen an issue. Same explicit module
 * rule as assignment/labels/milestone — Triage, Maintain, or Admin; Write
 * and Read may only view the status. The detail page hides the close/reopen
 * controls from everyone else, and the server rejects their submissions.
 */
const STATE_ROLES = new Set(['triage', 'maintain', 'admin']);

/**
 * REQ-5-2-3: the reaction types offered by the reaction menu. Each option is
 * a “reaction type” (the stored association value) with a readable label for
 * the menu item's accessible name.
 */
const REACTION_OPTIONS = [
  { type: '👍', label: 'Thumbs up' },
  { type: '👎', label: 'Thumbs down' },
  { type: '😄', label: 'Laugh' },
  { type: '🎉', label: 'Hooray' },
  { type: '❤️', label: 'Heart' },
  { type: '🚀', label: 'Rocket' },
  { type: '👀', label: 'Eyes' },
];

/**
 * REQ-5-2-3: the reaction picker of one target (the issue itself or one of
 * its comments). Existing reactions render as chips (emoji + count; the chip
 * is a toggle button whose aria-pressed state mirrors whether the signed-in
 * user reacted) and the “Add reaction” button opens a role=menu with one
 * menuitem per reaction type. Selecting an option toggles that reaction for
 * the signed-in user: for the same user, target, and reaction only one
 * association is stored, and selecting it a second time removes it. Only
 * signed-in users who can view the issue get the menu (chips stay visible to
 * everyone).
 */
function ReactionControls({
  groups,
  canReact,
  onToggle,
}: {
  groups: IssueReactionGroup[];
  canReact: boolean;
  onToggle: (reaction: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

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
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      firstItemRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const select = (reaction: string) => {
    setOpen(false);
    triggerRef.current?.focus();
    onToggle(reaction);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      firstItemRef.current?.focus();
    }
  };

  return (
    <div ref={containerRef} className="issue-reactions">
      {groups.map((group) => (
        <button
          key={group.reaction}
          type="button"
          className="reaction-chip"
          aria-label={`${group.reaction} ${group.count}`}
          aria-pressed={group.reactedByMe}
          onClick={() => onToggle(group.reaction)}
        >
          <span aria-hidden="true">{group.reaction}</span> {group.count}
        </button>
      ))}
      {canReact ? (
        <>
          <button
            ref={triggerRef}
            type="button"
            className="reaction-trigger"
            aria-label="Add reaction"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden="true">🙂</span> Add reaction
          </button>
          {open ? (
            <div
              role="menu"
              aria-label="Add reaction"
              className="reaction-menu"
              onKeyDown={handleMenuKeyDown}
            >
              {REACTION_OPTIONS.map((option, index) => (
                <button
                  key={option.type}
                  ref={index === 0 ? firstItemRef : undefined}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="reaction-menu-item"
                  aria-label={`${option.type} ${option.label}`}
                  onClick={() => select(option.type)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      select(option.type);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      close();
                    }
                  }}
                >
                  <span aria-hidden="true">{option.type}</span> {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * REQ-5-3-1: the Assignees settings selector on the right side of the issue
 * detail page. The trigger is a settings-icon button whose accessible name is
 * exactly “Assignees” (only Triage, Maintain, or Admin get it). Opening it
 * shows a textbox named “Search assignees” and one role=option item per
 * assignable member whose exact accessible name is the member username;
 * options filter live as the user types (no Enter or search button is
 * required) and already-assigned members are shown selected. Clicking an
 * option immediately saves the assignment (PUT) or removes it (DELETE) and
 * closes the selector without a separate Save action; reopening it shows the
 * selected member without another search. Non-assignable users never appear
 * (the server filters the options). Each successful change updates the issue
 * record (Assignees metadata + activity timeline) from the server response.
 */
function AssigneeSelector({
  owner,
  name,
  number,
  assignees,
  onChanged,
}: {
  owner: string;
  name: string;
  number: number;
  assignees: string[];
  onChanged: (issue: IssueDetail) => void;
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

  // Load the assignable options while the page is interactive so the popover
  // can show them as soon as it is opened (the server filters out
  // non-assignable accounts).
  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setLoadError(false);
    apiIssueAssigneeOptions(owner, name, number).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setOptions(result.assignable);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, number]);

  // Close the popover when the user clicks outside of it.
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

  // Focus the Search assignees textbox as soon as the selector opens.
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

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = (options ?? []).filter((username) =>
    username.toLowerCase().includes(trimmedQuery)
  );
  const assignedSet = new Set(assignees);
  const showNoMatch = query.trim() !== '' && filtered.length === 0;

  // REQ-5-3-1: clicking a member option immediately saves the assignment
  // (or removes it when the member is already assigned) and closes the
  // selector without a separate Save action; the server response replaces
  // the issue record (Assignees metadata and activity timeline). A rejected
  // request keeps the selector open and shows the server error.
  const select = async (username: string) => {
    if (busy) {
      return;
    }
    const removing = assignedSet.has(username);
    setBusy(true);
    setActionError(null);
    const result = removing
      ? await apiUnassignIssue(owner, name, number, username)
      : await apiAssignIssue(owner, name, number, username);
    if (result.ok) {
      setOpen(false);
      setQuery('');
      setActionError(null);
      onChanged(result.issue);
    } else {
      setActionError(result.message);
    }
    setBusy(false);
  };

  const focusOption = (index: number) => {
    if (filtered.length === 0) {
      return;
    }
    const target = filtered[Math.max(0, Math.min(index, filtered.length - 1))];
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
      const index = filtered.findIndex((u) => u === username);
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const index = filtered.findIndex((u) => u === username);
      focusOption(index - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={containerRef} className="assignee-selector">
      <button
        ref={triggerRef}
        type="button"
        className="issue-assignee-settings-button"
        aria-label="Assignees"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open ? (
        <div
          className="assignee-selector-popover"
          onKeyDown={handlePopoverKeyDown}
        >
          <input
            ref={inputRef}
            type="text"
            className="assignee-search-input"
            aria-label="Search assignees"
            placeholder="Search assignees"
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
            <p role="alert" className="assignee-selector-error">
              Assignees could not be loaded.
            </p>
          ) : options === null ? (
            <p className="assignee-selector-loading">Loading…</p>
          ) : (
            <>
              {filtered.length > 0 ? (
                <ul
                  role="listbox"
                  aria-label="Assignees"
                  className="assignee-option-list"
                >
                  {filtered.map((username) => (
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
                      aria-selected={assignedSet.has(username)}
                      tabIndex={-1}
                      className={`assignee-option${
                        assignedSet.has(username) ? ' selected' : ''
                      }`}
                      onClick={() => void select(username)}
                      onKeyDown={(event) =>
                        handleOptionKeyDown(event, username)
                      }
                    >
                      <span aria-hidden="true" className="assignee-option-check">
                        {assignedSet.has(username) ? '✓' : ''}
                      </span>
                      <span className="assignee-option-name">{username}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {showNoMatch ? (
                <p className="assignee-no-matching">No matching assignee</p>
              ) : null}
            </>
          )}
          {actionError ? (
            <p role="alert" className="assignee-selector-error">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * REQ-5-3-2: the Labels settings selector on the right side of the issue
 * detail page. The trigger is a settings-icon button whose accessible name is
 * exactly “Labels” (only Triage, Maintain, or Admin get it). Opening it shows
 * one role=option item per pre-existing label of the current repository whose
 * exact accessible name is the label name (repository-scoped: labels stored
 * for any other repository never appear); already-applied labels are shown
 * selected. Clicking an option immediately saves the association (PUT) or
 * removes it (DELETE) and closes the selector without a separate Save action;
 * reopening it shows the last saved state. The selector never creates a
 * label. Each successful change updates the issue record (Labels metadata +
 * activity timeline) from the server response.
 */
function LabelSelector({
  owner,
  name,
  number,
  labels,
  onChanged,
}: {
  owner: string;
  name: string;
  number: number;
  labels: string[];
  onChanged: (issue: IssueDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // Load the repository label options while the page is interactive so the
  // popover can show them as soon as it is opened (the server scopes the
  // list to the current repository).
  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setLoadError(false);
    apiIssueLabelOptions(owner, name, number).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setOptions(result.labels);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, number]);

  // Close the popover when the user clicks outside of it.
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
        setActionError(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setActionError(null);
    triggerRef.current?.focus();
  };

  const toggle = () => {
    setOpen((value) => !value);
    if (open) {
      setActionError(null);
      triggerRef.current?.focus();
    }
  };

  const appliedSet = new Set(labels);

  // REQ-5-3-2: clicking a label option immediately saves the association
  // (or removes it when the label is already applied) and closes the selector
  // without a separate Save action; the server response replaces the issue
  // record (Labels metadata and activity timeline). A rejected request keeps
  // the selector open and shows the server error.
  const select = async (labelName: string) => {
    if (busy) {
      return;
    }
    const removing = appliedSet.has(labelName);
    setBusy(true);
    setActionError(null);
    const result = removing
      ? await apiRemoveIssueLabel(owner, name, number, labelName)
      : await apiAddIssueLabel(owner, name, number, labelName);
    if (result.ok) {
      setOpen(false);
      setActionError(null);
      onChanged(result.issue);
    } else {
      setActionError(result.message);
    }
    setBusy(false);
  };

  const focusOption = (index: number) => {
    if (options === null || options.length === 0) {
      return;
    }
    const target = options[Math.max(0, Math.min(index, options.length - 1))];
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
    labelName: string
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void select(labelName);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const index = options ? options.findIndex((l) => l === labelName) : -1;
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const index = options ? options.findIndex((l) => l === labelName) : -1;
      focusOption(index - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={containerRef} className="label-selector">
      <button
        ref={triggerRef}
        type="button"
        className="issue-label-settings-button"
        aria-label="Labels"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open ? (
        <div
          className="label-selector-popover"
          onKeyDown={handlePopoverKeyDown}
        >
          {loadError ? (
            <p role="alert" className="label-selector-error">
              Labels could not be loaded.
            </p>
          ) : options === null ? (
            <p className="label-selector-loading">Loading…</p>
          ) : options.length === 0 ? (
            <p className="label-selector-loading">No labels in this repository</p>
          ) : (
            <ul role="listbox" aria-label="Labels" className="label-option-list">
              {options.map((labelName) => (
                <li
                  key={labelName}
                  ref={(node) => {
                    if (node) {
                      optionRefs.current.set(labelName, node);
                    } else {
                      optionRefs.current.delete(labelName);
                    }
                  }}
                  role="option"
                  aria-selected={appliedSet.has(labelName)}
                  tabIndex={-1}
                  className={`label-option${
                    appliedSet.has(labelName) ? ' selected' : ''
                  }`}
                  onClick={() => void select(labelName)}
                  onKeyDown={(event) =>
                    handleOptionKeyDown(event, labelName)
                  }
                >
                  <span aria-hidden="true" className="label-option-check">
                    {appliedSet.has(labelName) ? '✓' : ''}
                  </span>
                  <span className="issue-label">{labelName}</span>
                </li>
              ))}
            </ul>
          )}
          {actionError ? (
            <p role="alert" className="label-selector-error">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * REQ-5-3-3: the Milestone settings picker on the right side of the issue
 * detail page. The trigger is a settings-icon button whose accessible name is
 * exactly “Milestone” (only Triage, Maintain, or Admin get it; Read and
 * Write users only view the current milestone). Opening it shows one
 * role=option item per pre-existing milestone of the current repository
 * whose exact accessible name is the milestone title (repository-scoped: a
 * milestone stored for any other repository never appears) plus a “None”
 * removal option; the currently associated milestone is shown selected.
 * Clicking a milestone option immediately saves the association (PUT) and
 * closes the picker without a separate Save action; clicking “None” removes
 * the association (DELETE) and closes it. The picker never creates a
 * milestone. Each successful change updates the issue record (Milestone
 * metadata + activity timeline) from the server response.
 */
function MilestoneSelector({
  owner,
  name,
  number,
  milestone,
  onChanged,
}: {
  owner: string;
  name: string;
  number: number;
  milestone: { title: string } | null;
  onChanged: (issue: IssueDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // Load the repository milestone options while the page is interactive so
  // the popover can show them as soon as it is opened (the server scopes the
  // list to the current repository).
  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setLoadError(false);
    apiIssueMilestoneOptions(owner, name, number).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setOptions(result.milestones);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, number]);

  // Close the popover when the user clicks outside of it.
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
        setActionError(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setActionError(null);
    triggerRef.current?.focus();
  };

  const toggle = () => {
    setOpen((value) => !value);
    if (open) {
      setActionError(null);
      triggerRef.current?.focus();
    }
  };

  const currentTitle = milestone ? milestone.title : null;
  // REQ-5-3-3: the picker offers every milestone of the current repository
  // plus the “None” removal option (first), mirroring the single-select
  // semantics of the Milestone metadata.
  const items: string[] = ['None', ...(options ?? [])];

  // REQ-5-3-3: clicking a milestone option immediately saves the association
  // and closes the picker without a separate Save action; clicking “None”
  // removes the association (DELETE). The server response replaces the issue
  // record (Milestone metadata and activity timeline). A rejected request
  // keeps the picker open and shows the server error.
  const select = async (item: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    const result =
      item === 'None'
        ? await apiClearIssueMilestone(owner, name, number)
        : await apiSetIssueMilestone(owner, name, number, item);
    if (result.ok) {
      setOpen(false);
      setActionError(null);
      onChanged(result.issue);
    } else {
      setActionError(result.message);
    }
    setBusy(false);
  };

  const focusOption = (index: number) => {
    if (items.length === 0) {
      return;
    }
    const target = items[Math.max(0, Math.min(index, items.length - 1))];
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
    item: string
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void select(item);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const index = items.findIndex((i) => i === item);
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const index = items.findIndex((i) => i === item);
      focusOption(index - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={containerRef} className="milestone-selector">
      <button
        ref={triggerRef}
        type="button"
        className="issue-milestone-settings-button"
        aria-label="Milestone"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open ? (
        <div
          className="milestone-selector-popover"
          onKeyDown={handlePopoverKeyDown}
        >
          {loadError ? (
            <p role="alert" className="milestone-selector-error">
              Milestones could not be loaded.
            </p>
          ) : options === null ? (
            <p className="milestone-selector-loading">Loading…</p>
          ) : (
            <ul role="listbox" aria-label="Milestone" className="milestone-option-list">
              {items.map((item) => {
                const isNone = item === 'None';
                const selected =
                  item === 'None' ? currentTitle === null : currentTitle === item;
                return (
                  <li
                    key={item}
                    ref={(node) => {
                      if (node) {
                        optionRefs.current.set(item, node);
                      } else {
                        optionRefs.current.delete(item);
                      }
                    }}
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    className={`milestone-option${selected ? ' selected' : ''}`}
                    onClick={() => void select(item)}
                    onKeyDown={(event) => handleOptionKeyDown(event, item)}
                  >
                    <span aria-hidden="true" className="milestone-option-check">
                      {selected ? '✓' : ''}
                    </span>
                    <span className={isNone ? 'milestone-option-none' : 'issue-milestone-title'}>
                      {item}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {actionError ? (
            <p role="alert" className="milestone-selector-error">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * REQ-5-1-1 / REQ-5-1-2 / REQ-5-2-2 / REQ-5-2-3: the issue detail page of
 * one persisted issue number in the current repository. It is the complete
 * read view of the work item: the top shows the number, a heading whose
 * exact accessible name is the complete title (without the issue number), and
 * the visible Open/Closed status; the body displays the complete saved
 * description as readable text; the right side displays Assignees, Labels,
 * and Milestone metadata in that order; and the bottom shows the append-only
 * discussion/activity timeline (creation, comments, edits, and later events)
 * in chronological order. Discussion and activity entries use article
 * semantics. Any user with repository-view permission may read this saved
 * data; only a signed-in user with Write, Maintain, or Admin gets the unique
 * buttons “Edit issue title” (beside the title), “Edit issue description”
 * (beside the description), and the comment editor (labeled “Comment”, submit
 * button named exactly “Comment”). Every signed-in user who can view the
 * issue may add or remove their own reactions on the issue or its comments.
 * Read/Triage/visitors see no edit or comment controls and the server rejects
 * their submissions.
 */
export default function IssueDetailPage({ owner, name, number }: IssueDetailPageProps) {
  const { auth } = useSession();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');
  const [editErrors, setEditErrors] = useState<IssueEditErrors & { general?: string }>({});
  const [saving, setSaving] = useState(false);

  // REQ-5-2-3: the comment editor and the reaction toggles.
  const [commentValue, setCommentValue] = useState('');
  const [commentErrors, setCommentErrors] = useState<{ body?: string; general?: string }>({});
  const [submittingComment, setSubmittingComment] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);

  // REQ-5-4: the Close issue / Reopen issue transition on the detail view.
  const [stateBusy, setStateBusy] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIssue(null);
    setRole(null);
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    setEditingTitle(false);
    setEditingDescription(false);
    setEditErrors({});
    setCommentValue('');
    setCommentErrors({});
    setReactionError(null);
    apiRepositoryIssue(owner, name, number).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setIssue(result.issue);
        setRole(result.role);
      } else if (result.status === 403) {
        setDenied(true);
      } else if (result.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, number]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const canEdit = role !== null && ISSUE_EDIT_ROLES.has(role);
  const canComment = canEdit;
  // REQ-5-3-1: only Triage, Maintain, or Admin may assign/unassign
  // participants (the Assignees settings button is rendered only for them;
  // the server re-checks the role on every submission).
  const canAssign = role !== null && ASSIGN_ROLES.has(role);
  // REQ-5-3-2: only Triage, Maintain, or Admin may apply/remove labels (the
  // Labels settings button is rendered only for them; Read and Write users
  // only view, and the server re-checks the role on every submission).
  const canLabel = role !== null && LABEL_ROLES.has(role);
  // REQ-5-3-3: only Triage, Maintain, or Admin may set/remove the milestone
  // (the Milestone settings button is rendered only for them; Read and Write
  // users only view the current milestone, and the server re-checks the role
  // on every submission).
  const canMilestone = role !== null && MILESTONE_ROLES.has(role);
  // REQ-5-4: only Triage, Maintain, or Admin may close or reopen an issue
  // (the Close issue/Reopen issue button is rendered only for them; Write and
  // Read users only view the status, and the server re-checks the role on
  // every submission).
  const canChangeState = role !== null && STATE_ROLES.has(role);
  const canReact =
    auth.status === 'ready' && auth.user !== null && issue !== null && !denied && !notFound;

  const saveTitle = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setEditErrors({});
    const result = await apiEditIssue(owner, name, number, { title: titleValue });
    if (result.ok) {
      setIssue(result.issue);
      setEditingTitle(false);
    } else {
      setEditErrors(
        result.errors && Object.keys(result.errors).length > 0
          ? result.errors
          : { general: result.message }
      );
    }
    setSaving(false);
  };

  const saveDescription = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setEditErrors({});
    const result = await apiEditIssue(owner, name, number, { body: descriptionValue });
    if (result.ok) {
      setIssue(result.issue);
      setEditingDescription(false);
    } else {
      setEditErrors(
        result.errors && Object.keys(result.errors).length > 0
          ? result.errors
          : { general: result.message }
      );
    }
    setSaving(false);
  };

  const submitComment = async () => {
    if (submittingComment) {
      return;
    }
    if (commentValue.trim() === '') {
      // REQ-5-2-3: whitespace-only text may activate the Comment button; the
      // page shows “Comment is required” and submits nothing (the server
      // enforces the same rule).
      setCommentErrors({ body: 'Comment is required' });
      return;
    }
    if (commentValue.length > 65536) {
      setCommentErrors({ body: 'Comment is too long' });
      return;
    }
    setSubmittingComment(true);
    setCommentErrors({});
    const result = await apiAddIssueComment(owner, name, number, commentValue);
    if (result.ok) {
      setIssue(result.issue);
      setCommentValue('');
    } else {
      setCommentErrors(
        result.errors && Object.keys(result.errors).length > 0
          ? result.errors
          : { general: result.message }
      );
    }
    setSubmittingComment(false);
  };

  const toggleIssueReaction = async (reaction: string) => {
    if (reacting || !issue) {
      return;
    }
    setReacting(true);
    setReactionError(null);
    const result = await apiToggleIssueReaction(owner, name, number, reaction);
    if (result.ok) {
      setIssue(result.issue);
    } else {
      setReactionError(result.message);
    }
    setReacting(false);
  };

  const toggleCommentReaction = async (commentId: string, reaction: string) => {
    if (reacting || !issue) {
      return;
    }
    setReacting(true);
    setReactionError(null);
    const result = await apiToggleCommentReaction(
      owner,
      name,
      number,
      commentId,
      reaction
    );
    if (result.ok) {
      setIssue(result.issue);
    } else {
      setReactionError(result.message);
    }
    setReacting(false);
  };

  // REQ-5-4: closing an Open issue (state 'closed') or reopening a Closed
  // issue (state 'open') immediately saves the transition without an
  // additional confirmation; the server response replaces the issue record
  // (status + appended closed/reopened activity) and the button label flips.
  const changeState = async (nextState: 'open' | 'closed') => {
    if (stateBusy) {
      return;
    }
    setStateBusy(true);
    setStateError(null);
    const result = await apiSetIssueState(owner, name, number, nextState);
    if (result.ok) {
      setIssue(result.issue);
    } else {
      setStateError(result.message);
    }
    setStateBusy(false);
  };

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to view this issue.
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
        <h1>Issue not found</h1>
        <p className="muted-text">
          The issue “{owner}/{name}#{number}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  if (issue === null) {
    return (
      <div className="repository-page">
        {loadError ? (
          <p role="alert" className="form-error">
            The issue could not be loaded.
          </p>
        ) : (
          <p className="loading">Loading…</p>
        )}
      </div>
    );
  }

  const updatedText = formatRelativeTime(issue.updatedAt);

  // REQ-5-2-3: commented activity events link their stored comment, so the
  // entry renders the comment's body and reaction groups. Entries created by
  // older data (without the link) fall back to the event body.
  const commentForEvent = (commentId?: string | null) => {
    if (!commentId) {
      return null;
    }
    return issue.comments.find((comment) => comment.id === commentId) ?? null;
  };

  return (
    <div className="repository-page issue-page">
      <div className="issue-page-header">
        <p className="muted-text">
          <a className="repository-back-link" href={`${repoBase}/issues`}>
            {owner}/{name}
          </a>
          <span aria-hidden="true"> · </span>
          <span>#{issue.number}</span>
        </p>
        <div className="issue-title-row">
          <h1>{issue.title}</h1>
          {canEdit ? (
            <button
              type="button"
              className="issue-edit-button"
              aria-label="Edit issue title"
              aria-expanded={editingTitle}
              onClick={() => {
                if (editingTitle) {
                  setEditingTitle(false);
                } else {
                  setTitleValue(issue.title);
                  setEditingTitle(true);
                }
                setEditErrors({});
              }}
            >
              Edit
            </button>
          ) : null}
        </div>
        <div className="issue-page-status-line">
          <span className={`issue-state issue-state-${issue.state}`}>
            {issue.state === 'open' ? 'Open' : 'Closed'}
          </span>
          <span className="issue-page-author">
            {issue.author ?? 'Unknown'} opened this issue
            {updatedText !== '' ? ` · updated ${updatedText}` : ''}
          </span>
        </div>
        {editingTitle && canEdit ? (
          <form
            className="issue-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTitle();
            }}
          >
            <div className="field">
              <label htmlFor="issue-title-edit">Issue title</label>
              <input
                id="issue-title-edit"
                type="text"
                value={titleValue}
                onChange={(event) => {
                  setTitleValue(event.target.value);
                  setEditErrors((prev) => ({ ...prev, title: undefined }));
                }}
              />
              {editErrors.title ? (
                <p role="alert" className="form-error">
                  {editErrors.title}
                </p>
              ) : null}
            </div>
            {editErrors.general ? (
              <p role="alert" className="form-error">
                {editErrors.general}
              </p>
            ) : null}
            <button
              type="submit"
              className="primary-button save-issue-title-button"
              disabled={saving}
            >
              Save issue title
            </button>
          </form>
        ) : null}
      </div>
      <div className="issue-page-body">
        <div className="issue-page-main">
          <div className="issue-description-row">
            <div className="issue-description">{issue.body || ''}</div>
            {canEdit ? (
              <button
                type="button"
                className="issue-edit-button issue-edit-description-button"
                aria-label="Edit issue description"
                aria-expanded={editingDescription}
                onClick={() => {
                  if (editingDescription) {
                    setEditingDescription(false);
                  } else {
                    setDescriptionValue(issue.body);
                    setEditingDescription(true);
                  }
                  setEditErrors({});
                }}
              >
                Edit
              </button>
            ) : null}
          </div>
          {/* REQ-5-2-3: the issue body itself is a reaction target; the
              reaction row renders the existing groups and the reaction menu
              for signed-in viewers. */}
          <div className="issue-body-reactions">
            <ReactionControls
              groups={issue.reactions ?? []}
              canReact={canReact}
              onToggle={(reaction) => void toggleIssueReaction(reaction)}
            />
          </div>
          {editingDescription && canEdit ? (
            <form
              className="issue-edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDescription();
              }}
            >
              <div className="field">
                <label htmlFor="issue-description-edit">Issue description</label>
                <textarea
                  id="issue-description-edit"
                  value={descriptionValue}
                  onChange={(event) => {
                    setDescriptionValue(event.target.value);
                    setEditErrors((prev) => ({ ...prev, body: undefined }));
                  }}
                  rows={6}
                />
                {editErrors.body ? (
                  <p role="alert" className="form-error">
                    {editErrors.body}
                  </p>
                ) : null}
              </div>
              {editErrors.general ? (
                <p role="alert" className="form-error">
                  {editErrors.general}
                </p>
              ) : null}
              <button
                type="submit"
                className="primary-button save-issue-description-button"
                disabled={saving}
              >
                Save issue description
              </button>
            </form>
          ) : null}
          {/* REQ-5-2-3: the comment editor — the editor is labeled “Comment”
              and its submit button is named exactly “Comment”. Only
              Write/Maintain/Admin accounts get it (Read/Triage/visitors only
              view; the server re-checks the role on every submission). */}
          {canComment ? (
            <form
              className="issue-comment-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitComment();
              }}
            >
              <div className="field">
                <label htmlFor="issue-comment-box">Comment</label>
                <textarea
                  id="issue-comment-box"
                  value={commentValue}
                  onChange={(event) => {
                    setCommentValue(event.target.value);
                    setCommentErrors((prev) => ({ ...prev, body: undefined, general: undefined }));
                  }}
                  rows={4}
                />
                {commentErrors.body ? (
                  <p role="alert" className="form-error">
                    {commentErrors.body}
                  </p>
                ) : null}
                {commentErrors.general ? (
                  <p role="alert" className="form-error">
                    {commentErrors.general}
                  </p>
                ) : null}
              </div>
              <button
                type="submit"
                className="primary-button submit-comment-button"
                disabled={submittingComment}
              >
                Comment
              </button>
            </form>
          ) : null}
          {/* REQ-5-1-2: the bottom of the page shows the discussion timeline:
              sections/records containing “Comment” or “Activity” text over
              time — creation, comment, and edit activities in chronological
              order (REQ-5-2-2 appends the edit records; REQ-5-2-3 appends
              comments and their reactions). Discussion and activity entries
              use article semantics so an invalid submission cannot add an
              article. */}
          <div className="issue-activity">
            <h2>Activity</h2>
            <p className="issue-discussion-count">
              {issue.comments.length === 1
                ? '1 comment'
                : `${issue.comments.length} comments`}
            </p>
            {issue.activity.length === 0 ? (
              <p className="muted-text">No activity yet</p>
            ) : (
              <ul className="issue-activity-list">
                {issue.activity.map((event, index) => {
                  const comment = commentForEvent(event.commentId);
                  return (
                    <li
                      key={`${event.type}-${event.createdAt}-${index}`}
                      className="issue-activity-item"
                    >
                      {event.type === 'commented' ? (
                        <article className="issue-activity-event issue-comment">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} commented
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                          <div className="issue-comment-body">
                            {comment ? comment.body : event.body || ''}
                          </div>
                          <ReactionControls
                            groups={comment ? comment.reactions ?? [] : []}
                            canReact={canReact}
                            onToggle={(reaction) =>
                              comment
                                ? void toggleCommentReaction(comment.id, reaction)
                                : undefined
                            }
                          />
                        </article>
                      ) : event.type === 'edited' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} edited this issue
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : event.type === 'assigned' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} assigned{' '}
                            {event.body || 'a member'} to this issue
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : event.type === 'unassigned' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} unassigned{' '}
                            {event.body || 'a member'} from this issue
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : event.type === 'labeled' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} added the{' '}
                            {event.body || 'label'} label
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : event.type === 'unlabeled' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} removed the{' '}
                            {event.body || 'label'} label
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : event.type === 'milestoned' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} added this to the{' '}
                            {event.body || 'milestone'} milestone
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : event.type === 'demilestoned' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} removed this from the{' '}
                            {event.body || 'milestone'} milestone
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : event.type === 'closed' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} closed this issue
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : event.type === 'reopened' ? (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} reopened this issue
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      ) : (
                        <article className="issue-activity-event">
                          <p className="issue-activity-line">
                            {event.actor ?? 'Unknown'} created this issue
                            {formatRelativeTime(event.createdAt) !== ''
                              ? ` · ${formatRelativeTime(event.createdAt)}`
                              : ''}
                          </p>
                        </article>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {reactionError ? (
              <p role="alert" className="form-error">
                {reactionError}
              </p>
            ) : null}
          </div>
        </div>
        <aside className="issue-page-sidebar">
          <div className="issue-sidebar-section">
            <div className="issue-sidebar-section-header">
              <h2>Assignees</h2>
              {canAssign && issue !== null ? (
                <AssigneeSelector
                  owner={owner}
                  name={name}
                  number={issue.number}
                  assignees={issue.assignees}
                  onChanged={(updated) => setIssue(updated)}
                />
              ) : null}
            </div>
            {issue.assignees.length === 0 ? (
              <p className="muted-text">No one assigned</p>
            ) : (
              <ul className="issue-sidebar-assignees">
                {issue.assignees.map((username) => (
                  <li key={username}>{username}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="issue-sidebar-section">
            <div className="issue-sidebar-section-header">
              <h2>Labels</h2>
              {canLabel && issue !== null ? (
                <LabelSelector
                  owner={owner}
                  name={name}
                  number={issue.number}
                  labels={issue.labels}
                  onChanged={(updated) => setIssue(updated)}
                />
              ) : null}
            </div>
            {issue.labels.length === 0 ? (
              <p className="muted-text">None yet</p>
            ) : (
              <ul className="issue-sidebar-labels">
                {issue.labels.map((labelName) => (
                  <li key={labelName}>
                    <span className="issue-label">{labelName}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="issue-sidebar-section">
            <div className="issue-sidebar-section-header">
              <h2>Milestone</h2>
              {canMilestone && issue !== null ? (
                <MilestoneSelector
                  owner={owner}
                  name={name}
                  number={issue.number}
                  milestone={issue.milestone}
                  onChanged={(updated) => setIssue(updated)}
                />
              ) : null}
            </div>
            {issue.milestone ? (
              <p className="issue-milestone-value">{issue.milestone.title}</p>
            ) : (
              <p className="muted-text">No milestone</p>
            )}
          </div>
          {/* REQ-5-4: the detail page offers “Close issue” while the issue is
              Open and “Reopen issue” while it is Closed, but only to Triage,
              Maintain, or Admin — Write and Read users (and visitors) only
              view the status and see neither control (the server also rejects
              their submissions). Activating either button immediately saves
              the transition without an additional confirmation; the status
              text and the appended closed/reopened activity update from the
              server response, so after reopening and reload the “Close issue”
              button is available again. */}
          {canChangeState && issue !== null ? (
            <div className="issue-sidebar-section issue-state-section">
              {stateError ? (
                <p role="alert" className="form-error issue-state-error">
                  {stateError}
                </p>
              ) : null}
              <button
                type="button"
                className="issue-state-button"
                disabled={stateBusy}
                onClick={() =>
                  void changeState(issue.state === 'open' ? 'closed' : 'open')
                }
              >
                {issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
