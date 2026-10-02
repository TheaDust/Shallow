import type { IssueLabel } from "../../lib/issues-api";

export interface IssueLabelListProps {
  labels: readonly IssueLabel[];
}

/**
 * The colored classification names of one issue. A label is a repository
 * record, so the same chip renders on the list row and on the detail sidebar.
 */
export function IssueLabelList({ labels }: IssueLabelListProps) {
  if (labels.length === 0) return null;
  return (
    <ul className="issue-labels">
      {labels.map((label) => (
        <li key={label.name} className="issue-labels__item">
          <span className="issue-label" style={labelStyle(label)}>
            {label.name}
          </span>
        </li>
      ))}
    </ul>
  );
}

function labelStyle(label: IssueLabel): { backgroundColor: string } | undefined {
  if (!label.color) return undefined;
  return { backgroundColor: `#${label.color.replace(/^#/, "")}` };
}
