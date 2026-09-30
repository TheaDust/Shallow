import type { IssueLabel } from "../lib/issues-api";

/** A classification name of the current repository, shown as a colored badge. */
export function IssueLabelBadge({ label }: { label: IssueLabel }) {
  return (
    <span
      className="issue-label"
      data-label={label.name}
      style={label.color ? { backgroundColor: `#${label.color}` } : undefined}
    >
      {label.name}
    </span>
  );
}
