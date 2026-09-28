import { useEffect, useRef, useState } from "react";

import {
  IssueDetailData,
  IssueMutationResult,
  setIssueAssignee,
  setIssueMilestone,
  toggleIssueLabel,
} from "../../lib/issue-api";
import { RepoOwnerType } from "../../lib/repo-api";

interface IssueMetaPickersProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  number: number;
  data: IssueDetailData;
  canManage: boolean;
  canChangeState: boolean;
  stateSaving: boolean;
  onChangeState: (nextState: "open" | "closed") => Promise<void>;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}

type PickerKind = "assignees" | "labels" | "milestone";

/**
 * The right-side metadata sections (Assignees, Labels, Milestone) with their
 * settings-icon pickers (REQ-5-3) and the Close/Reopen issue button (REQ-5-4).
 * Only Triage, Maintain, or Admin users see the icons or the state button;
 * every option click immediately saves the association, closes the picker,
 * and refreshes the detail through `onChanged`. The assignee picker filters
 * candidates as the user types and only offers accounts with at least Triage
 * permission on the current repository.
 */
export function IssueMetaPickers({
  ownerType,
  ownerName,
  repoName,
  number,
  data,
  canManage,
  canChangeState,
  stateSaving,
  onChangeState,
  onChanged,
  onError,
}: IssueMetaPickersProps) {
  const [open, setOpen] = useState<PickerKind | null>(null);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setOpen(null);
        setAssigneeQuery("");
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(null);
        setAssigneeQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const issue = data.issue;

  async function apply(action: () => Promise<IssueMutationResult>) {
    if (saving) return;
    setSaving(true);
    const outcome = await action();
    setSaving(false);
    if (!outcome.ok) {
      onError("The change could not be saved");
      return;
    }
    setOpen(null);
    setAssigneeQuery("");
    await onChanged();
  }

  function togglePicker(kind: PickerKind) {
    setOpen((current) => (current === kind ? null : kind));
    setAssigneeQuery("");
  }

  function settingsIcon(name: string, kind: PickerKind) {
    if (!canManage) return null;
    return (
      <button
        type="button"
        className="issue-meta__edit"
        aria-label={name}
        aria-expanded={open === kind}
        onClick={() => togglePicker(kind)}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
          <path
            fill="currentColor"
            d="M5.8 1.3l.3-1h3.8l.3 1c.5.2.9.4 1.3.7l.9-.5 1.9 1.9-.5.9c.3.4.5.8.7 1.3l1 .3v3.8l-1 .3c-.2.5-.4.9-.7 1.3l.5.9-1.9 1.9-.9-.5c-.4.3-.8.5-1.3.7l-.3 1H6.1l-.3-1c-.5-.2-.9-.4-1.3-.7l-.9.5-1.9-1.9.5-.9c-.3-.4-.5-.8-.7-1.3l-1-.3V6.1l1-.3c.2-.5.4-.9.7-1.3l-.5-.9 1.9-1.9.9.5c.4-.3.8-.5 1.3-.7zM8 5a3 3 0 100 6 3 3 0 000-6z"
          />
        </svg>
      </button>
    );
  }

  const assigneeOptions = data.assignableMembers.filter((username) =>
    username.toLowerCase().includes(assigneeQuery.trim().toLowerCase()),
  );

  return (
    <aside className="issue-detail__sidebar">
      {canChangeState && (
        <button
          type="button"
          className="button issue-state-button"
          disabled={stateSaving}
          onClick={() => void onChangeState(issue.state === "open" ? "closed" : "open")}
        >
          {issue.state === "open" ? "Close issue" : "Reopen issue"}
        </button>
      )}
      <section className="issue-meta">
        <div className="issue-meta__heading">
          <h2>Assignees</h2>
          {settingsIcon("Assignees", "assignees")}
        </div>
        {issue.assignees.length > 0 ? (
          issue.assignees.map((username) => (
            <p key={username} className="issue-meta__value">
              {username}
            </p>
          ))
        ) : (
          <p className="issue-meta__empty">No one assigned</p>
        )}
        {open === "assignees" && (
          <div className="issue-picker" ref={pickerRef}>
            <div className="issue-picker__search">
              <label htmlFor="search-assignees">Search assignees</label>
              <input
                id="search-assignees"
                type="search"
                value={assigneeQuery}
                onChange={(event) => setAssigneeQuery(event.target.value)}
                placeholder="Filter members"
              />
            </div>
            <div className="issue-picker__options" role="listbox" aria-label="Assignees">
              {assigneeOptions.map((username) => (
                <button
                  key={username}
                  type="button"
                  role="option"
                  aria-selected={issue.assignees.includes(username)}
                  disabled={saving}
                  className="issue-picker__option"
                  onClick={() =>
                    void apply(() =>
                      setIssueAssignee(
                        ownerType,
                        ownerName,
                        repoName,
                        number,
                        username,
                        !issue.assignees.includes(username),
                      ),
                    )
                  }
                >
                  {username}
                </button>
              ))}
              {assigneeOptions.length === 0 && (
                <p className="issue-picker__empty">No matches found.</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="issue-meta">
        <div className="issue-meta__heading">
          <h2>Labels</h2>
          {settingsIcon("Labels", "labels")}
        </div>
        {issue.labels.length > 0 ? (
          <p className="issue-meta__labels">
            {issue.labels.map((label) => (
              <span
                key={label.name}
                className="issue-label"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
              </span>
            ))}
          </p>
        ) : (
          <p className="issue-meta__empty">None yet</p>
        )}
        {open === "labels" && (
          <div className="issue-picker" ref={pickerRef}>
            <div className="issue-picker__options" role="listbox" aria-label="Labels">
              {data.labels.map((label) => (
                <button
                  key={label.name}
                  type="button"
                  role="option"
                  aria-selected={issue.labels.some((applied) => applied.name === label.name)}
                  disabled={saving}
                  className="issue-picker__option"
                  onClick={() => void apply(() => toggleIssueLabel(ownerType, ownerName, repoName, number, label.name))}
                >
                  {label.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="issue-meta">
        <div className="issue-meta__heading">
          <h2>Milestone</h2>
          {settingsIcon("Milestone", "milestone")}
        </div>
        {issue.milestone ? (
          <p className="issue-meta__value">{issue.milestone.title}</p>
        ) : (
          <p className="issue-meta__empty">No milestone</p>
        )}
        {open === "milestone" && (
          <div className="issue-picker" ref={pickerRef}>
            <div className="issue-picker__options" role="listbox" aria-label="Milestone">
              <button
                type="button"
                role="option"
                aria-selected={!issue.milestone}
                disabled={saving}
                className="issue-picker__option"
                onClick={() => void apply(() => setIssueMilestone(ownerType, ownerName, repoName, number, null))}
              >
                None
              </button>
              {data.milestones.map((milestone) => (
                <button
                  key={milestone.id}
                  type="button"
                  role="option"
                  aria-selected={issue.milestone?.id === milestone.id}
                  disabled={saving}
                  className="issue-picker__option"
                  onClick={() =>
                    void apply(() => setIssueMilestone(ownerType, ownerName, repoName, number, milestone.title))
                  }
                >
                  {milestone.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </aside>
  );
}
