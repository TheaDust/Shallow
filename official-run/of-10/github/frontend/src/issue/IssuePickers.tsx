import { useState, type ReactNode } from "react";

import type { IssueLabel, IssueMilestone } from "../lib/issues-api";
import { IssueLabelBadge } from "./IssueLabelBadge";

/** The option that removes the milestone association of a work item. */
export const NONE_MILESTONE = "__none__";

interface PickerOption {
  id: string;
  label: string;
  selected: boolean;
  content?: ReactNode;
}

/**
 * The rendered option list of a sidebar picker. Every option is real page
 * content with role `option`, so it can be clicked (or activated with the
 * keyboard) and observed; choosing one saves immediately and closes the picker,
 * which is why no Save button exists.
 */
function PickerList({
  name,
  options,
  emptyText,
  busy,
  onChoose,
}: {
  name: string;
  options: readonly PickerOption[];
  emptyText: string;
  busy: boolean;
  onChoose(id: string): void;
}) {
  if (options.length === 0) {
    return <p className="issue-picker__empty">{emptyText}</p>;
  }
  return (
    <ul role="listbox" aria-label={name} className="issue-picker__options">
      {options.map((option) => (
        <li
          key={option.id}
          role="option"
          className="issue-picker__option"
          aria-selected={option.selected}
          tabIndex={0}
          onClick={() => {
            if (!busy) onChoose(option.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (!busy) onChoose(option.id);
            }
          }}
        >
          <span className="issue-picker__check" aria-hidden="true">
            {option.selected ? "✓" : ""}
          </span>
          {option.content ?? option.label}
        </li>
      ))}
    </ul>
  );
}

export interface AssigneePickerProps {
  /** Accounts that hold at least Triage permission on this repository. */
  members: readonly string[];
  /** Usernames currently assigned to the issue. */
  selected: readonly string[];
  busy: boolean;
  onChoose(username: string): void;
}

/**
 * The assignee selector (REQ-5-3-1). Its textbox filters the options while the
 * user types — pressing Enter or a search button is never required — and its
 * options are named exactly after the member usernames, including the members
 * already assigned to the issue.
 */
export function AssigneePicker({ members, selected, busy, onChoose }: AssigneePickerProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? members.filter((member) => member.toLowerCase().includes(needle))
    : members;

  return (
    <div className="issue-picker">
      <input
        type="text"
        className="issue-picker__search"
        aria-label="Search assignees"
        placeholder="Search assignees"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <PickerList
        name="Assignees"
        emptyText="No matching assignees"
        busy={busy}
        options={matching.map((member) => ({
          id: member,
          label: member,
          selected: selected.includes(member),
        }))}
        onChoose={onChoose}
      />
    </div>
  );
}

export interface LabelsPickerProps {
  /** Labels defined in the current repository only. */
  labels: readonly IssueLabel[];
  selected: readonly string[];
  busy: boolean;
  onChoose(labelId: string): void;
}

/** The label selector (REQ-5-3-2): options are the label names of this repository. */
export function LabelsPicker({ labels, selected, busy, onChoose }: LabelsPickerProps) {
  return (
    <div className="issue-picker">
      <PickerList
        name="Labels"
        emptyText="No labels in this repository"
        busy={busy}
        options={labels.map((label) => ({
          id: label.id,
          label: label.name,
          selected: selected.includes(label.id),
          content: <IssueLabelBadge label={label} />,
        }))}
        onChoose={onChoose}
      />
    </div>
  );
}

export interface MilestonePickerProps {
  /** Milestones defined in the current repository only. */
  milestones: readonly IssueMilestone[];
  currentId: string | null;
  busy: boolean;
  /** `NONE_MILESTONE` removes the association. */
  onChoose(milestoneId: string): void;
}

/**
 * The milestone selector (REQ-5-3-3): one option per milestone of this
 * repository plus "None", which deletes the association. A work item is
 * associated with at most one milestone.
 */
export function MilestonePicker({ milestones, currentId, busy, onChoose }: MilestonePickerProps) {
  const options: PickerOption[] = [
    ...milestones.map((milestone) => ({
      id: milestone.id,
      label: milestone.title,
      selected: milestone.id === currentId,
    })),
    { id: NONE_MILESTONE, label: "None", selected: !currentId },
  ];
  return (
    <div className="issue-picker">
      <PickerList
        name="Milestone"
        emptyText="No milestones in this repository"
        busy={busy}
        options={options}
        onChoose={onChoose}
      />
    </div>
  );
}
