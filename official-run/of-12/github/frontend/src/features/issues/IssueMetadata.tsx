import type { MutationOutcome } from "../../lib/api";
import type { IssueLabel, IssueMilestone, IssuePermissions, IssueSummary } from "./issue-api";
import { MetadataPicker, type MetadataPickerOption } from "./MetadataPicker";

/**
 * The right-side metadata of an issue (REQ-5-1-2, REQ-5-3).
 *
 * The three areas — the assignees, the labels and the milestone, in that order
 * — show the stored associations of the work item. Every one of them references
 * an item that already exists in the current repository: an assignable member,
 * a pre-existing label or a pre-existing milestone. The settings icon of an
 * area is a button named after it and opens the selector that adds or removes
 * one association; it appears only for Triage, Maintain and Admin, who are the
 * roles the metadata operations allow, so Read and Write only view the values.
 *
 * `None` is the milestone option that removes the association, and the label
 * and milestone selectors are built from the classification items of the
 * current repository only, so an association with another repository can never
 * be created.
 */
export interface IssueMetadataProps {
  issue: IssueSummary;
  /** The pre-existing labels of the current repository. */
  labels: IssueLabel[];
  /** The pre-existing milestones of the current repository. */
  milestones: IssueMilestone[];
  /** The usernames that may be assigned to this issue. */
  members: string[];
  permissions: IssuePermissions;
  onAssign(username: string): Promise<MutationOutcome<unknown>>;
  onToggleLabel(label: string): Promise<MutationOutcome<unknown>>;
  onSetMilestone(milestone: string | null): Promise<MutationOutcome<unknown>>;
}

/** The badge color of a stored label, falling back to a neutral badge. */
function labelColor(labels: IssueLabel[], name: string): string | null {
  const color = labels.find((label) => label.name === name)?.color ?? "";
  return /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : null;
}

export function IssueMetadata({
  issue,
  labels,
  milestones,
  members,
  permissions,
  onAssign,
  onToggleLabel,
  onSetMilestone,
}: IssueMetadataProps) {
  const assigneeOptions: MetadataPickerOption[] = members.map((username) => ({
    value: username,
    name: username,
    selected: issue.assignees.includes(username),
  }));
  const labelOptions: MetadataPickerOption[] = labels.map((label) => ({
    value: label.name,
    name: label.name,
    selected: issue.labels.includes(label.name),
  }));
  const milestoneOptions: MetadataPickerOption[] = [
    ...milestones.map((milestone) => ({
      value: milestone.title,
      name: milestone.title,
      selected: issue.milestone === milestone.title,
    })),
    // “None” removes the association: a work item carries at most one
    // milestone, so it is a selectable option like every milestone name.
    { value: "None", name: "None", selected: !issue.milestone },
  ];

  return (
    <aside className="repository-issue__sidebar">
      <section className="repository-issue__meta" aria-label="Assignees">
        <div className="repository-issue__meta-head">
          <h2 className="repository-issue__meta-title">Assignees</h2>
          {permissions.canAssignParticipants ? (
            <MetadataPicker
              label="Assignees"
              searchLabel="Search assignees"
              options={assigneeOptions}
              onSelect={onAssign}
            />
          ) : null}
        </div>
        {issue.assignees.length > 0 ? (
          <ul className="repository-issue__assignees">
            {issue.assignees.map((assignee) => (
              <li key={assignee} className="repository-issue__assignee">
                {assignee}
              </li>
            ))}
          </ul>
        ) : (
          <p className="repository-issue__meta-empty">No one assigned</p>
        )}
      </section>
      <section className="repository-issue__meta" aria-label="Labels">
        <div className="repository-issue__meta-head">
          <h2 className="repository-issue__meta-title">Labels</h2>
          {permissions.canApplyLabels ? (
            <MetadataPicker label="Labels" options={labelOptions} onSelect={onToggleLabel} />
          ) : null}
        </div>
        {issue.labels.length > 0 ? (
          <ul className="repository-issue__labels">
            {issue.labels.map((label) => {
              const color = labelColor(labels, label);
              return (
                <li
                  key={label}
                  className="repository-issue__label"
                  style={color ? { backgroundColor: color } : undefined}
                >
                  {label}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="repository-issue__meta-empty">None yet</p>
        )}
      </section>
      <section className="repository-issue__meta" aria-label="Milestone">
        <div className="repository-issue__meta-head">
          <h2 className="repository-issue__meta-title">Milestone</h2>
          {permissions.canSetMilestone ? (
            <MetadataPicker label="Milestone" options={milestoneOptions} onSelect={onSetMilestone} />
          ) : null}
        </div>
        <p className="repository-issue__milestone">{issue.milestone ?? "No milestone"}</p>
      </section>
    </aside>
  );
}
