import { useState } from "react";

import { apiErrorMessage } from "../lib/api";
import {
  saveIssueAssignees,
  saveIssueLabels,
  saveIssueMilestone,
  type IssueDetail,
  type IssueLabel,
  type IssueMilestone,
  type RepositoryIssuePayload,
} from "../lib/issues-api";
import { Button } from "../ui";
import { IssueLabelBadge } from "./IssueLabelBadge";
import {
  AssigneePicker,
  LabelsPicker,
  MilestonePicker,
  NONE_MILESTONE,
} from "./IssuePickers";

type Section = "assignees" | "labels" | "milestone";

export interface IssueMetadataProps {
  owner: string;
  name: string;
  number: number;
  issue: IssueDetail;
  /** Labels defined in the current repository; a label never crosses repositories. */
  labels: readonly IssueLabel[];
  /** Milestones defined in the current repository. */
  milestones: readonly IssueMilestone[];
  /** Accounts that may be assigned to this issue. */
  assignableMembers: readonly string[];
  /** Triage, Maintain and Admin manage the metadata; Read and Write only view it. */
  canManage: boolean;
  onSaved(payload: RepositoryIssuePayload): void;
}

/**
 * The right side of an issue detail page (REQ-5-1-2, REQ-5-3): Assignees, Labels
 * and Milestone, in that order. Each area shows the stored association and, for
 * a viewer with the role it needs, the settings icon that opens its selector.
 * Choosing an option saves immediately and closes the selector, and the page
 * then shows the stored record the server answered with.
 */
export function IssueMetadata({
  owner,
  name,
  number,
  issue,
  labels,
  milestones,
  assignableMembers,
  canManage,
  onSaved,
}: IssueMetadataProps) {
  const [open, setOpen] = useState<Section | null>(null);
  const [failure, setFailure] = useState<{ section: Section; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // The badge of an assigned label keeps the color configured in this repository.
  const configured = (label: IssueLabel) =>
    labels.find((candidate) => candidate.id === label.id) ?? label;

  const run = async (section: Section, action: () => Promise<RepositoryIssuePayload>) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      onSaved(await action());
    } catch (caught) {
      setFailure({
        section,
        message: apiErrorMessage(caught, "The change could not be saved."),
      });
    } finally {
      setBusy(false);
    }
  };

  const settingsIcon = (section: Section) => (
    <Button
      variant="ghost"
      className="issue-meta__settings"
      aria-label={section === "assignees" ? "Assignees" : section === "labels" ? "Labels" : "Milestone"}
      aria-expanded={open === section}
      disabled={busy}
      onClick={() => setOpen((current) => (current === section ? null : section))}
    >
      <span aria-hidden="true">⚙</span>
    </Button>
  );

  const alertOf = (section: Section) =>
    failure?.section === section ? (
      <p className="issue-edit__error" role="alert">
        {failure.message}
      </p>
    ) : null;

  return (
    <aside className="issue-sidebar" aria-label="Issue metadata">
      <section className="issue-meta" aria-labelledby="issue-assignees-heading">
        <div className="issue-meta__header">
          <h2 id="issue-assignees-heading" className="issue-meta__heading">
            Assignees
          </h2>
          {canManage ? settingsIcon("assignees") : null}
        </div>
        {issue.assignees.length > 0 ? (
          <ul className="issue-meta__people">
            {issue.assignees.map((assignee) => (
              <li key={assignee} className="issue-meta__assignee">
                {assignee}
              </li>
            ))}
          </ul>
        ) : (
          <p className="issue-meta__empty">No one assigned</p>
        )}
        {canManage && open === "assignees" ? (
          <AssigneePicker
            members={assignableMembers}
            selected={issue.assignees}
            busy={busy}
            onChoose={(username) => {
              const assigned = !issue.assignees.includes(username);
              setOpen(null);
              void run("assignees", () =>
                saveIssueAssignees(owner, name, number, { username, assigned }),
              );
            }}
          />
        ) : null}
        {alertOf("assignees")}
      </section>

      <section className="issue-meta" aria-labelledby="issue-labels-heading">
        <div className="issue-meta__header">
          <h2 id="issue-labels-heading" className="issue-meta__heading">
            Labels
          </h2>
          {canManage ? settingsIcon("labels") : null}
        </div>
        {issue.labels.length > 0 ? (
          <ul className="issue-meta__labels">
            {issue.labels.map((label) => (
              <li key={label.id}>
                <IssueLabelBadge label={configured(label)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="issue-meta__empty">None yet</p>
        )}
        {canManage && open === "labels" ? (
          <LabelsPicker
            labels={labels}
            selected={issue.labels.map((label) => label.id)}
            busy={busy}
            onChoose={(labelId) => {
              const applied = !issue.labels.some((label) => label.id === labelId);
              setOpen(null);
              void run("labels", () => saveIssueLabels(owner, name, number, { labelId, applied }));
            }}
          />
        ) : null}
        {alertOf("labels")}
      </section>

      <section className="issue-meta" aria-labelledby="issue-milestone-heading">
        <div className="issue-meta__header">
          <h2 id="issue-milestone-heading" className="issue-meta__heading">
            Milestone
          </h2>
          {canManage ? settingsIcon("milestone") : null}
        </div>
        {issue.milestone ? (
          <p className="issue-meta__milestone">{issue.milestone.title}</p>
        ) : (
          <p className="issue-meta__empty">No milestone</p>
        )}
        {canManage && open === "milestone" ? (
          <MilestonePicker
            milestones={milestones}
            currentId={issue.milestone ? issue.milestone.id : null}
            busy={busy}
            onChoose={(milestoneId) => {
              setOpen(null);
              void run("milestone", () =>
                saveIssueMilestone(
                  owner,
                  name,
                  number,
                  milestoneId === NONE_MILESTONE ? null : milestoneId,
                ),
              );
            }}
          />
        ) : null}
        {alertOf("milestone")}
      </section>
    </aside>
  );
}
